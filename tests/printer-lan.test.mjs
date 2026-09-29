import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {createLanMonitor,validateTarget,certificateInfo,packet,decodePacket,summarizeReport} from '../printing/lan-monitor.mjs';
import {createPrinterService} from '../server/studio-printer.mjs';

const raw=Buffer.from('synthetic-test-certificate-not-a-device'),serial='TESTSERIAL01';
const fingerprint=createHash('sha256').update(raw).digest('hex');
const certificate={raw,subject:{CN:serial},valid_from:'Jan 1 2020 GMT',valid_to:'Jan 1 2040 GMT'};
const target={model:'bambu-h2c',ip:'192.168.4.10',serial};
const config={...target,fingerprint,accessCode:'TEST0000',trustConfirmed:true};
function fake({cert=certificate,script=()=>{}}={}){
  const state={writes:[],connections:0};
  state.connect=(options,ready)=>{state.connections++;state.options=options;const socket=new EventEmitter();state.socket=socket;
    socket.getPeerCertificate=()=>cert;socket.destroy=()=>{socket.destroyed=true;};socket.end=b=>{state.writes.push(b);};
    socket.write=b=>{state.writes.push(b);queueMicrotask(()=>script(b,socket));};queueMicrotask(ready);return socket;
  };return state;
}
function reportPacket(s=serial,value={print:{gcode_state:'IDLE',mc_percent:0,nozzle_temper:24}}){const t=Buffer.from(`device/${s}/report`),n=Buffer.alloc(2);n.writeUInt16BE(t.length);return packet(0x30,Buffer.concat([n,t,Buffer.from(JSON.stringify(value))]));}
function happyScript(b,s){if(b[0]===0x10)s.emit('data',packet(0x20,Buffer.from([0,0])));if(b[0]===0x82)s.emit('data',Buffer.concat([packet(0x90,Buffer.from([0,1,0])),reportPacket()]));}

test('printer target is explicit, bounded, private IPv4 only',()=>{
  assert.deepEqual(validateTarget(target),target);
  for(const ip of ['127.0.0.1','8.8.8.8','localhost','192.168.1.0','192.168.1.255','169.254.1.1','172.32.1.2','::1','192.168.1.1:8883'])assert.throws(()=>validateTarget({...target,ip}));
  for(const patch of [{model:''},{serial:'+/report'},{url:'https://example.com'},{port:443}])assert.throws(()=>validateTarget({...target,...patch}));
  assert.throws(()=>validateTarget({...config,trustConfirmed:false},{credentials:true}));
  assert.throws(()=>validateTarget({...config,accessCode:'\nnot-code'},{credentials:true}));
});
test('certificate inspection is explicitly untrusted and sends no credential packets',async()=>{
  const f=fake(),run=createLanMonitor({connect:f.connect});const result=await run('inspect',target);
  assert.equal(result.status,'CERTIFICATE_OBSERVED_NOT_TRUSTED');assert.equal(result.certificate.fingerprint,fingerprint);assert.equal(result.authenticated,false);assert.equal(f.writes.length,0);assert.equal(f.socket.destroyed,true);assert.equal(f.options.port,8883);assert.equal(f.options.servername,serial);
});
test('pin, physical serial and validity enforced BEFORE credential transmission',async()=>{
  for(const [cfg,cert]of [[{...config,fingerprint:'0'.repeat(64)},certificate],[config,{...certificate,subject:{CN:'OTHER'}}],[config,{...certificate,valid_to:'Jan 1 2020 GMT'}]]){
    const f=fake({cert});await assert.rejects(createLanMonitor({connect:f.connect})('check',cfg),/mismatch/);assert.equal(f.writes.length,0);assert.equal(f.socket.destroyed,true);
  }
});
test('authenticated exact-topic subscription receives whitelisted state and emits no control/publish',async()=>{
  const f=fake({script:happyScript});const result=await createLanMonitor({connect:f.connect})('check',config);
  assert.equal(result.status,'READ_ONLY_REPORT_RECEIVED');assert.equal(result.authenticated,true);assert.equal(result.subscribed,true);assert.equal(result.report.state,'IDLE');assert.equal(result.printSent,false);assert.equal(result.uploadSent,false);assert.equal(result.connectionClosed,true);
  assert.deepEqual(f.writes.map(b=>b[0]>>4),[1,8,14]);assert.equal(f.writes.some(b=>b.includes(Buffer.from('/request'))),false);assert.equal(JSON.stringify(result).includes(config.accessCode),false);assert.equal(f.socket.destroyed,true);
});
test('auth denial closes channel without subscription or leaked credential in error',async()=>{
  const f=fake({script:(b,s)=>{if(b[0]===0x10)s.emit('data',packet(0x20,Buffer.from([0,5])));}});
  await assert.rejects(createLanMonitor({connect:f.connect})('check',config),e=>/rejected/.test(e.message)&&!e.message.includes(config.accessCode));assert.deepEqual(f.writes.map(b=>b[0]>>4),[1]);
});
test('retained broker reports are explicitly marked, never promoted to fresh telemetry',async()=>{
  const f=fake({script:(b,s)=>{if(b[0]===0x10)s.emit('data',packet(0x20,Buffer.from([0,0])));if(b[0]===0x82){const report=reportPacket();report[0]=0x31;s.emit('data',Buffer.concat([packet(0x90,Buffer.from([0,1,0])),report]));}}});
  const receipt=await createLanMonitor({connect:f.connect})('check',config);assert.equal(receipt.reportRetained,true);assert.equal(receipt.connectionClosed,true);assert.equal(receipt.physicalValidation,'UNKNOWN');
});
test('no-report timeout proves subscription only, not printer behavior',async()=>{
  const f=fake({script:(b,s)=>{if(b[0]===0x10)s.emit('data',packet(0x20,Buffer.from([0,0])));if(b[0]===0x82)s.emit('data',packet(0x90,Buffer.from([0,1,0])));}});
  const result=await createLanMonitor({connect:f.connect,timeoutMs:15})('check',config);assert.equal(result.status,'SUBSCRIBED_NO_REPORT');assert.equal(result.report,null);assert.equal(result.physicalValidation,'UNKNOWN');
});
test('one bounded connection at a time and failed operation releases admission',async()=>{
  const f=fake(),run=createLanMonitor({connect:f.connect,timeoutMs:20});const first=run('check',config);await assert.rejects(run('inspect',target),e=>e.status===429);await assert.rejects(first,/timed out/);await run('inspect',target);assert.equal(f.connections,2);
});
test('foreign report topic, malformed control, overlong data and invalid SUBACK fail closed',async()=>{
  for(const payload of [reportPacket('OTHERSERIAL'),Buffer.from([0xff,0]),Buffer.alloc(262150),packet(0x90,Buffer.from([0,1,0x80]))]){
    const f=fake({script:(b,s)=>{if(b[0]===0x10)s.emit('data',packet(0x20,Buffer.from([0,0])));if(b[0]===0x82)s.emit('data',payload);}});await assert.rejects(createLanMonitor({connect:f.connect})('check',config));assert.equal(f.writes.some(b=>b[0]>>4===3),false);assert.equal(f.socket.destroyed,true);
  }
});
test('MQTT parser bounds fragmentation and reports never expose raw names or extra fields',()=>{
  const b=packet(0x30,Buffer.alloc(200));assert.equal(decodePacket(b.subarray(0,2)),null);assert.equal(decodePacket(b.subarray(0,20)),null);assert.equal(decodePacket(b).body.length,200);assert.throws(()=>decodePacket(Buffer.from([0x30,255,255,255,255,127])));
  assert.deepEqual(summarizeReport({print:{gcode_state:'IDLE',mc_percent:999,nozzle_temper:'30',secret:'private',gcode_file:'private.3mf'}}),{state:'IDLE'});assert.equal(summarizeReport({print:{}}),null);assert.equal(certificateInfo(certificate,serial).serialMatches,true);
});
test('HTTP adapter has no mutation endpoints and removes input secret after success/error',async()=>{
  const responses=[],input={...config};const service=createPrinterService({body:async()=>input,json:(_r,s,v)=>responses.push({s,v}),operate:async()=>({status:'fixture'})});
  const req={method:'POST',headers:{'content-type':'application/json'}};assert.equal(await service(req,{},'/api/studio/printer/print'),false);await service(req,{},'/api/studio/printer/check');assert.equal(input.accessCode,'');
  await service({method:'GET'},{},'/api/studio/printer');assert.equal(responses.at(-1).v.defaultPrinter,null);assert.equal(responses.at(-1).v.hardwareTested,false);
  const rejected={...config},bad=createPrinterService({body:async()=>rejected,json:()=>{},operate:async()=>{throw new Error('fixture');}});await assert.rejects(bad(req,{},'/api/studio/printer/check'));assert.equal(rejected.accessCode,'');
});
