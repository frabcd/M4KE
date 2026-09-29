import test from 'node:test';
import assert from 'node:assert/strict';
import {createCodexBridge,buildCodexPrompt,BRIDGE_MODEL} from '../scripts/codex-demo-bridge.mjs';
import {validateProvider} from '../server/studio-inference-config.mjs';

test('online bridge is explicit; default provider stays Ollama',()=>{
  assert.equal(validateProvider(),'ollama');assert.equal(validateProvider('codex-bridge'),'codex-bridge');
  assert.throws(()=>buildCodexPrompt({model:'qwen',messages:[]}));
  const text=buildCodexPrompt({model:BRIDGE_MODEL,format:'json',messages:[{role:'user',content:'Make a toy'}]});
  assert.match(text,/Do not use tools/);assert.match(text,/Return one JSON object/);
});
test('loopback bridge returns actual provider, rejects browser origins and never calls Qwen',async()=>{
  let calls=0;const server=createCodexBridge({execute:async()=>{calls++;return '{"message":"test"}';}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/health').then(r=>r.json())).onlineRequired,true);
    assert.equal((await fetch(base+'/api/chat',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:'{}'})).status,403);
    assert.equal(calls,0);
    const res=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:BRIDGE_MODEL,format:'json',messages:[{role:'user',content:'test'}]})});
    const events=(await res.text()).trim().split('\n').filter(Boolean).map(JSON.parse);assert.equal(events.at(-1).executionProvider,'codex-bridge');assert.equal(events.at(-1).model,BRIDGE_MODEL);assert.equal(calls,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('bridge errors do not substitute a model or fabricate a completion',async()=>{
  const server=createCodexBridge({execute:async()=>{throw Error('test unavailable');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:BRIDGE_MODEL,messages:[{role:'user',content:'test'}]})});const lines=(await res.text()).trim().split('\n').filter(Boolean).map(JSON.parse);assert.match(lines.at(-1).error,/unavailable/);assert.equal(lines.some(x=>x.done===true),false);}
  finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('bridge timeout aborts execution and releases its single request slot',async()=>{
  let aborted=false;
  const server=createCodexBridge({timeoutMs:50,execute:async(_prompt,signal)=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted=true;reject(Error('Request timed out'));},{once:true});
  })});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const res=await fetch(base+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:BRIDGE_MODEL,messages:[{role:'user',content:'test'}]})});
    const events=(await res.text()).trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(aborted,true);assert.match(events.at(-1).error,/timed out/);
    assert.equal(events.some(e=>e.done===true),false);
    assert.equal((await fetch(base+'/health').then(r=>r.json())).busy,false);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
