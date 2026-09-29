import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {validateEndpoint,validateModel,parseModelReply,createServer} from '../server/index.mjs';

test('DGX-only inference accepts loopback and rejects LAN or cloud endpoints', () => {
  for (const endpoint of ['http://localhost:11434','http://127.0.0.1:11434','http://[::1]:11434']) assert.equal(validateEndpoint(endpoint),endpoint);
  assert.equal(validateEndpoint(''),'');
  for (const endpoint of ['http://192.168.2.100:11434','http://10.1.2.3:11434','https://172.16.0.2:11434','https://api.openai.com','http://8.8.8.8','http://192.168.2.1.evil.com','http://user:pass@127.0.0.1','http://127.0.0.1/api','file:///a','http://[::ffff:8.8.8.8]','http://localhost?x=1']) assert.throws(() => validateEndpoint(endpoint));
});
test('model tags never silently substitute or use cloud', () => {
  assert.equal(validateModel('qwen3.8:8b'),'qwen3.8:8b');
  assert.throws(() => validateModel('qwen3-cloud'));
});
test('valid proposal is parsed and invalid proposal withheld', () => {
  assert.deepEqual(parseModelReply('{"message":"Test before operating","proposal":{"label":"Trial","changes":{"width":250,"rpm":1000}}}').proposal,{label:'Trial',changes:{width:250,rpm:1000}});
  assert.equal(parseModelReply('{"message":"Trial","proposal":{"changes":{"rpm":99999}}}').proposal,undefined);
  assert.equal(parseModelReply('{"message":"Trial","proposal":{"changes":{"code":"evil"}}}').proposal,undefined);
  assert.equal(parseModelReply('plain local answer').message,'plain local answer');
  assert.throws(() => parseModelReply(''));
});
test('unconfigured API stays explicit, protects origins and host', async () => {
  const server = createServer(); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await (await fetch(base+'/api/health')).json(); assert.equal(health.endpointConfigured,false); assert.equal(health.cloudFallback,false);
    assert.equal((await fetch(base+'/api/models')).status,503);
    assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"message":"test"}'})).status,503);
    assert.equal((await fetch(base+'/api/settings',{headers:{Origin:'https://evil.example'}})).status,403);
    const hostStatus = await new Promise((resolve,reject) => { const req = http.get(base+'/api/settings',{headers:{Host:'evil.example'}},res => { res.resume(); resolve(res.statusCode); }); req.on('error',reject); }); assert.equal(hostStatus,403);
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"endpoint":"https://example.com","model":"qwen3.8"}'})).status,400);
    assert.equal((await fetch(base+'/..%5cserver.mjs')).status,403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('offline Ollama fixture verifies exact-model check and bounded proposal transport', async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  let chatCalls = 0, capabilityCalls = 0;
  const fixture = http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json');
    if (req.url === '/api/tags') return res.end(JSON.stringify({models:[{name:'qwen3.8:fixture',size:123}]}));
    if (req.url === '/api/show') {
      let text = ''; for await (const chunk of req) text += chunk;
      assert.deepEqual(JSON.parse(text),{model:'qwen3.8:fixture'});capabilityCalls++;
      return res.end(JSON.stringify({thinking:{values:[false,true],default:true}}));
    }
    if (req.url === '/api/chat') {
      let text = ''; for await (const chunk of req) text += chunk;
      const request = JSON.parse(text); assert.equal(request.model,'qwen3.8:fixture'); assert.equal(request.stream,true); assert.equal(request.think,false);
      chatCalls++;
      if (request.messages[0].content.includes('sound-threshold car')) {
        const user = JSON.parse(request.messages[1].content);
        return res.end(JSON.stringify({done:true,eval_count:42,message:{content:JSON.stringify({message:'Fixture only, not real inference',parameters:{length:180,width:user.request==='invalid car'?999:120,wheelDiameter:50,threshold:-25}})}}));
      }
      return res.end(JSON.stringify({done:true,message:{content:JSON.stringify({message:'Fixture only: test clearance',proposal:{label:'Trial',changes:{clearance:2}}})}}));
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise(resolve => fixture.listen(0,'127.0.0.1',resolve));
  const reservation = http.createServer(); await new Promise(resolve => reservation.listen(0,'127.0.0.1',resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath,['server/index.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),OLLAMA_URL:`http://127.0.0.1:${fixture.address().port}`,QWEN_MODEL:'qwen3.8:fixture'},stdio:['ignore','pipe','pipe']});
  try {
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject) => setTimeout(() => reject(new Error('Fixture server startup timeout')),5000).unref())]);
    const base = `http://127.0.0.1:${port}`;
    const send = data => fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const unavailable = await send({message:'hello',model:'missing-model'}); assert.equal(unavailable.status,409); assert.equal(chatCalls,0);
    const valid = await send({message:'Improve clearance',project:{parameters:{clearance:1}}}); assert.equal(valid.status,200);
    const answer = await valid.json(); assert.deepEqual(answer.proposal.changes,{clearance:2}); assert.equal(chatCalls,1);
    const car = await send({mode:'car',message:'Design a car'}); assert.equal(car.status,200); assert.deepEqual((await car.json()).parameters,{length:180,width:120,wheelDiameter:50,threshold:-25});
    const invalidCar = await send({mode:'car',message:'invalid car'}); assert.equal(invalidCar.status,502); assert.match((await invalidCar.json()).error,/Invalid width/);
    assert.equal(capabilityCalls,3);assert.equal(chatCalls,3);
  } finally { child.kill(); await once(child,'exit'); await new Promise(resolve => fixture.close(resolve)); }
});
