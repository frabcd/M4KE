import tls from 'node:tls';
import {isIP} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';

// A bounded, read-only LAN operation, not a print transport. Never emits PUBLISH.
export const PRINTER_MODELS=['bambu-h2c','bambu-a1','bambu-a1-mini','bambu-p1s','bambu-x1c'];
const error=message=>Object.assign(new Error(message),{status:400});
const SHA=/^[a-f0-9]{64}$/;
export function validateTarget(value,{credentials=false}={}){
  const allowed=credentials?['model','ip','serial','fingerprint','accessCode','trustConfirmed']:['model','ip','serial'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw error('Invalid LAN printer fields.');
  const {model,ip,serial}=value;
  if(!PRINTER_MODELS.includes(model))throw error('Choose a printer model explicitly. No default printer.');
  if(typeof ip!=='string'||isIP(ip)!==4)throw error('Enter a private IPv4 printer address, not a hostname or URL.');
  const octets=ip.split('.').map(Number);
  if(!(octets[0]===10||(octets[0]===172&&octets[1]>=16&&octets[1]<=31)||(octets[0]===192&&octets[1]===168))||[0,255].includes(octets[3]))throw error('Only an individual RFC1918 LAN address is allowed. No public, loopback or broadcast target.');
  if(typeof serial!=='string'||!/^[A-Za-z0-9_-]{6,40}$/.test(serial))throw error('Enter the serial number from the physical printer.');
  if(credentials&&(typeof value.fingerprint!=='string'||!SHA.test(value.fingerprint)||value.trustConfirmed!==true||typeof value.accessCode!=='string'||!/^[A-Za-z0-9]{8,32}$/.test(value.accessCode)))throw error('Confirm the inspected certificate and enter the local LAN access code. Never use an account password.');
  return {...value};
}
export function certificateInfo(cert,serial,now=Date.now()){
  if(!cert?.raw||!Buffer.isBuffer(cert.raw)||cert.raw.length>65536)throw error('The printer did not present a bounded certificate.');
  const fingerprint=createHash('sha256').update(cert.raw).digest('hex');
  const starts=Date.parse(cert.valid_from),ends=Date.parse(cert.valid_to);
  const matches=cert.subject?.CN===serial,valid=Number.isFinite(starts)&&Number.isFinite(ends)&&starts<=now&&now<=ends;
  return {fingerprint,serialMatches:matches,dateValid:valid,trust:'EXPLICIT_FINGERPRINT_PIN_NOT_CA_VALIDATION'};
}
const mqttString=text=>{const b=Buffer.from(text);if(b.length>65535)throw error('MQTT field too large.');const n=Buffer.alloc(2);n.writeUInt16BE(b.length);return Buffer.concat([n,b]);};
export function packet(type,body=Buffer.alloc(0)){
  if(body.length>262144)throw error('Packet too large.');const length=[];let n=body.length;do{let byte=n%128;n=Math.floor(n/128);if(n)byte|=128;length.push(byte);}while(n);
  return Buffer.concat([Buffer.from([type,...length]),body]);
}
export function decodePacket(buffer){
  if(buffer.length<2)return null;let length=0,multiplier=1,i=1;
  for(;i<=4;i++){if(i>=buffer.length)return null;const b=buffer[i];length+=(b&127)*multiplier;if(length>262144)throw error('Printer packet exceeds the receive limit.');if(!(b&128))break;multiplier*=128;}
  if(i>4)throw error('Invalid MQTT packet length.');if(buffer.length<i+1+length)return null;
  return {header:buffer[0],body:buffer.subarray(i+1,i+1+length),bytes:i+1+length};
}
export function summarizeReport(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!value.print||typeof value.print!=='object'||Array.isArray(value.print))return null;
  const p=value.print,result={};
  if(['IDLE','RUNNING','PAUSE','FINISH','FAILED','PREPARE','SLICING'].includes(p.gcode_state))result.state=p.gcode_state;
  for(const [key,min,max]of [['mc_percent',0,100],['bed_temper',-50,200],['nozzle_temper',-50,450]])if(typeof p[key]==='number'&&Number.isFinite(p[key])&&p[key]>=min&&p[key]<=max)result[key]=p[key];
  return Object.keys(result).length?result:null;
}

export function createLanMonitor({connect=tls.connect,timeoutMs=20000,now=()=>Date.now()}={}){
  let busy=false;
  return async function operate(mode,input){
    if(!['inspect','check'].includes(mode))throw error('Only certificate inspection and read-only status are supported.');
    const config=validateTarget(input,{credentials:mode==='check'});
    if(busy)throw Object.assign(new Error('One LAN check is already running.'),{status:429});busy=true;
    try{return await new Promise((resolve,reject)=>{
      let socket,done=false,authenticated=false,subscribed=false,pending=Buffer.alloc(0),received=0,info;
      const base=()=>({model:config.model,ip:config.ip,serial:config.serial,checkedAt:new Date(now()).toISOString(),readOnly:true,printSent:false,uploadSent:false,connectionClosed:true,physicalValidation:'UNKNOWN'});
      const finish=(failure,result)=>{if(done)return;done=true;clearTimeout(timer);if(socket){if(authenticated&&!socket.destroyed)socket.end(packet(0xe0));socket.destroy();}if(failure)reject(failure);else resolve({...base(),...result});};
      const timer=setTimeout(()=>finish(subscribed?null:error('LAN check timed out before authentication and subscription completed.'),{status:'SUBSCRIBED_NO_REPORT',authenticated:true,subscribed:true,report:null,certificate:info}),Math.min(20000,Math.max(10,timeoutMs)));
      try{
        // Discovery sends no secret. Check authenticates only AFTER exact fingerprint,
        // physical serial CN and validity dates match the explicitly trusted pin.
        socket=connect({host:config.ip,port:8883,servername:config.serial,minVersion:'TLSv1.2',rejectUnauthorized:false},()=>{
          if(done)return;
          try{
            info=certificateInfo(socket.getPeerCertificate(),config.serial,now());
            if(mode==='inspect'){finish(null,{status:'CERTIFICATE_OBSERVED_NOT_TRUSTED',authenticated:false,subscribed:false,certificate:info});return;}
            if(info.fingerprint!==config.fingerprint||!info.serialMatches||!info.dateValid)throw error('Certificate pin, serial or validity mismatch. No access code was sent. Reinspect the physical device; do not bypass this check.');
            const header=Buffer.concat([mqttString('MQTT'),Buffer.from([4,0xc2,0,25])]);
            const payload=Buffer.concat([mqttString('m4ke-'+randomBytes(8).toString('hex')),mqttString('bblp'),mqttString(config.accessCode)]);
            socket.write(packet(0x10,Buffer.concat([header,payload])));
          }catch(e){finish(e);}
        });
        socket.on('error',()=>finish(error('LAN TLS connection failed. Check the physical printer address, LAN mode and network route.')));
        socket.on('close',()=>{if(!done)finish(error('Printer closed the connection before a complete read-only result.'));});
        socket.on('data',chunk=>{
          if(done)return;
          try{
            received+=chunk.length;if(received>1048576||pending.length+chunk.length>262149)throw error('Printer response exceeds the bounded receive limit.');
            pending=Buffer.concat([pending,chunk]);let frame;
            while((frame=decodePacket(pending))){pending=pending.subarray(frame.bytes);const {header,body}=frame,type=header>>4;
              if(type===2){
                if(authenticated||header!==0x20||body.length!==2||body[0]!==0||body[1]!==0)throw error('Printer rejected authentication or returned an invalid CONNACK. Check the LAN access code and supported mode.');
                authenticated=true;socket.write(packet(0x82,Buffer.concat([Buffer.from([0,1]),mqttString(`device/${config.serial}/report`),Buffer.from([0])])));
              }else if(type===9){
                if(!authenticated||subscribed||header!==0x90||body.length!==3||body.readUInt16BE(0)!==1||body[2]!==0)throw error('Printer rejected the exact read-only report subscription.');subscribed=true;
              }else if(type===3){
                if(!authenticated||body.length<2)throw error('Invalid report packet.');const qos=(header>>1)&3,n=body.readUInt16BE(0),offset=2+n+(qos===1?2:0);
                if(qos>1||body.length<offset)throw error('Unsupported report delivery.');
                const topic=body.subarray(2,2+n).toString('utf8');if(topic!==`device/${config.serial}/report`)throw error('Printer returned another device topic.');
                if(qos===1)socket.write(packet(0x40,body.subarray(2+n,4+n)));
                if(!subscribed)continue;let parsed;try{parsed=JSON.parse(body.subarray(offset).toString('utf8'));}catch{throw error('Printer report was not JSON.');}
                const report=summarizeReport(parsed);if(report){finish(null,{status:'READ_ONLY_REPORT_RECEIVED',authenticated:true,subscribed:true,report,reportRetained:Boolean(header&1),certificate:info});return;}
              }else throw error('Unexpected packet on the read-only printer channel.');
            }
          }catch(e){finish(e);}
        });
      }catch{finish(error('Could not open the LAN status connection.'));}
    });}finally{config.accessCode='';busy=false;}
  };
}
