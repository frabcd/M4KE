// Real TLS sockets only on loopback; injected transport never contacts a physical printer.
import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,X509Certificate} from 'node:crypto';
import {createLanMonitor,packet,decodePacket} from '../printing/lan-monitor.mjs';
const exec=promisify(execFile),serial='M4KETESTSERIAL01',dummyCode='TESTONLY8',target={model:'bambu-h2c',ip:'192.168.20.30',serial};
async function fixture(){
 const directory=await mkdtemp(path.join(tmpdir(),'m4ke-loopback-tls-')),sockets=new Set(),received=[];let server;
 try{
  await exec(process.env.OPENSSL_EXE||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','key.pem','-out','cert.pem','-days','1','-subj','/CN='+serial],{cwd:directory,timeout:15000,windowsHide:true});
  const [key,cert]=await Promise.all(['key.pem','cert.pem'].map(name=>readFile(path.join(directory,name))));const certificate=new X509Certificate(cert),fingerprint=createHash('sha256').update(certificate.raw).digest('hex');
  server=tls.createServer({key,cert,minVersion:'TLSv1.2'},socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});let pending=Buffer.alloc(0);socket.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);let frame;while((frame=decodePacket(pending))){pending=pending.subarray(frame.bytes);received.push(frame);if(frame.header===0x10){assert(frame.body.includes(Buffer.from(dummyCode)));socket.write(packet(0x20,Buffer.from([0,0])));}if(frame.header===0x82){assert(frame.body.includes(Buffer.from(`device/${serial}/report`)));const topic=Buffer.from(`device/${serial}/report`),size=Buffer.alloc(2);size.writeUInt16BE(topic.length);const response=Buffer.concat([packet(0x90,Buffer.from([0,1,0])),packet(0x30,Buffer.concat([size,topic,Buffer.from(JSON.stringify({print:{gcode_state:'IDLE',mc_percent:0,nozzle_temper:23,private_field:'withheld'}}))]))]);socket.write(response.subarray(0,3));setTimeout(()=>{if(!socket.destroyed)socket.write(response.subarray(3));},5);}}});});
  server.on('tlsClientError',()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');
  const connect=(options,ready)=>{assert.equal(options.host,target.ip);assert.equal(options.port,8883);assert.equal(options.rejectUnauthorized,false);return tls.connect({...options,host:'127.0.0.1',port:server.address().port},ready);};
  return {received,fingerprint,connect,expiredNow:Date.parse(certificate.validTo)+1000,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}};
 }catch(error){for(const socket of sockets)socket.destroy();if(server?.listening)await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});throw error;}
}
test('real loopback TLS inspection transmits zero MQTT or credential bytes',async()=>{const f=await fixture();try{const receipt=await createLanMonitor({connect:f.connect,timeoutMs:2000})('inspect',target);assert.equal(receipt.certificate.fingerprint,f.fingerprint);assert.equal(receipt.certificate.serialMatches,true);assert.equal(receipt.certificate.dateValid,true);assert.equal(receipt.authenticated,false);assert.equal(receipt.connectionClosed,true);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.received.length,0);}finally{await f.close();}});
test('real TLS pin serial and validity failures close before credential transmission',async()=>{const f=await fixture();try{const config={...target,fingerprint:f.fingerprint,accessCode:dummyCode,trustConfirmed:true};for(const [input,now]of [[{...config,fingerprint:'0'.repeat(64)},undefined],[{...config,serial:'OTHERTESTSERIAL'},undefined],[config,()=>f.expiredNow]]){await assert.rejects(createLanMonitor({connect:f.connect,timeoutMs:2000,...now?{now}:{}})('check',input),/mismatch/);}await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.received.length,0);}finally{await f.close();}});
test('real TLS fragmented MQTT authenticates and subscribes only, then closes with whitelisted report',async()=>{const f=await fixture();try{const receipt=await createLanMonitor({connect:f.connect,timeoutMs:2000})('check',{...target,fingerprint:f.fingerprint,accessCode:dummyCode,trustConfirmed:true});assert.equal(receipt.status,'READ_ONLY_REPORT_RECEIVED');assert.deepEqual(receipt.report,{state:'IDLE',mc_percent:0,nozzle_temper:23});assert.equal(receipt.connectionClosed,true);assert.equal(receipt.printSent,false);assert.equal(receipt.uploadSent,false);assert(!JSON.stringify(receipt).includes(dummyCode));assert(!JSON.stringify(receipt).includes('private_field'));assert.deepEqual(f.received.slice(0,2).map(frame=>frame.header>>4),[1,8]);assert(f.received.every(frame=>[1,8,14].includes(frame.header>>4)));}finally{await f.close();}});
