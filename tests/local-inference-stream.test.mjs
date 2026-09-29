import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {localFetch} from '../server/index.mjs';
import {resolveThinkingControl} from '../server/studio-inference-config.mjs';

async function fixture(run){
  // Each fixture owns a short-lived ephemeral origin. Do not let fetch pool a
  // socket that teardown closes before Windows reuses that origin for a test.
  const server=http.createServer((req,res)=>{res.setHeader('Connection','close');return run(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
const options={method:'POST',body:JSON.stringify({model:'test-local',stream:false})};
test('Ollama streaming collects content across split UTF8 chunks without exposing thinking',async()=>{
  let payload;const f=await fixture(async(req,res)=>{let body='';for await(const c of req)body+=c;payload=JSON.parse(body);res.writeHead(200,{'Content-Type':'application/x-ndjson'});const bytes=Buffer.from([JSON.stringify({message:{thinking:'private reasoning'}}),JSON.stringify({message:{content:'{"标题":'}}),JSON.stringify({message:{content:'"toy"}'}}),JSON.stringify({done:true,done_reason:'stop',eval_count:9,message:{content:''}})].join('\n'));for(let i=0;i<bytes.length;i+=7)res.write(bytes.subarray(i,i+7));res.end();});
  try{const answer=await localFetch(f.url,'/api/chat',options,5000);assert.equal(payload.stream,true);assert.deepEqual(JSON.parse(answer.message.content),{标题:'toy'});assert.equal(answer.eval_count,9);assert(!JSON.stringify(answer).includes('private reasoning'));}finally{await f.close();}
});
for(const [name,stream,error] of [['truncated','{"message":{"content":"partial"}}\n',/without a completion/],['engine error','{"error":"out of memory"}\n',/out of memory/],['post-terminal','{"done":true}\n{"message":{"content":"late"}}',/after completion/]])test(name,async()=>{const f=await fixture((req,res)=>res.end(stream));try{await assert.rejects(localFetch(f.url,'/api/chat',options,5000),error);}finally{await f.close();}});
test('explicit inference deadline remains enforced while stream is active',async()=>{const f=await fixture((req,res)=>{res.writeHead(200);res.write('{"message":{"content":"a"}}\n');});try{await assert.rejects(localFetch(f.url,'/api/chat',options,50));}finally{await f.close();}});
test('non-chat endpoint retains ordinary JSON handling',async()=>{const f=await fixture((req,res)=>res.end('{"models":[]}'));try{assert.deepEqual(await localFetch(f.url,'/api/tags'),{models:[]});}finally{await f.close();}});

test('progress reports measured output counts without leaking content or private reasoning',async()=>{
  const events=[];
  const f=await fixture((req,res)=>res.end([
    JSON.stringify({message:{thinking:'NEVER PUBLISH THIS'}}),
    JSON.stringify({message:{content:'{"message":"hello"}'}}),
    JSON.stringify({done:true,eval_count:6,eval_duration:2000000000}),
  ].join('\n')));
  try{
    const answer=await localFetch(f.url,'/api/chat',options,5000,undefined,event=>events.push(event));
    assert.equal(events[0].phase,'waiting');
    assert.equal(events.at(-1).phase,'response_received');
    assert.equal(events.at(-1).outputCharacters,19);
    assert(Number.isFinite(answer.inferenceMetrics.firstContentMs));
    assert(answer.inferenceMetrics.elapsedMs>=answer.inferenceMetrics.firstContentMs);
    assert(!JSON.stringify(events).includes('hello'));
    assert(!JSON.stringify({...answer,events}).includes('NEVER PUBLISH'));
  }finally{await f.close();}
});

test('cancelled inference does not manufacture a completion metric',async()=>{
  const events=[],abort=new AbortController();
  const f=await fixture((req,res)=>{res.writeHead(200);res.write('{"message":{"content":"partial"}}\n');setTimeout(()=>abort.abort(),20);});
  try{await assert.rejects(localFetch(f.url,'/api/chat',options,5000,abort.signal,e=>events.push(e)));assert(!events.some(e=>e.phase==='response_received'));}finally{await f.close();}
});

test('a confirmed dead local runner gets one identical replay and an explicit recovery metric',async()=>{
  const bodies=[],events=[];
  const f=await fixture(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;bodies.push(body);
    if(bodies.length===1){res.writeHead(500);res.end(JSON.stringify({error:'CUDA error: an illegal memory access was encountered'}));return;}
    res.end('{"message":{"content":"ok"}}\n{"done":true,"done_reason":"stop"}\n');
  });
  try{
    const result=await localFetch(f.url,'/api/chat',options,5000,undefined,p=>events.push(p));
    assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(result.message.content,'ok');assert.equal(result.inferenceMetrics.infrastructureRetries,1);
    assert(events.some(e=>e.phase==='recovering'));assert(!JSON.stringify(events).includes('illegal memory'));
  }finally{await f.close();}
});

test('runner recovery is bounded and does not retry ordinary errors or non-inference endpoints',async()=>{
  for(const [pathname,error,expected] of [['/api/chat','runner process has terminated: aborted',2],['/api/chat','invalid model configuration',1],['/api/tags','runner process has terminated',1]]){
    let calls=0;const f=await fixture((req,res)=>{calls++;res.writeHead(500);res.end(JSON.stringify({error}));});
    try{await assert.rejects(localFetch(f.url,pathname,options,5000),error=>{
      assert.match(error.message,/HTTP 500/);assert.equal(error.infrastructureRetries,expected-1);
      if(expected===2)assert.match(error.message,/request and design were not changed/);
      return true;
    });assert.equal(calls,expected);}finally{await f.close();}
  }
});

test('the original deadline can abort runner recovery before any replay',async()=>{
  let calls=0;const f=await fixture((req,res)=>{calls++;res.writeHead(500);res.end('{"error":"runner process has terminated"}');});
  try{await assert.rejects(localFetch(f.url,'/api/chat',options,80));assert.equal(calls,1);}finally{await f.close();}
});

test('thinking controls use exact installed metadata, not family-name assumptions',()=>{
  const qwen={values:[false,'low','medium','xhigh'],default:'medium'},oss={values:['low','medium','high'],default:'medium'};
  assert.equal(resolveThinkingControl(false,qwen).selected,false);
  assert.equal(resolveThinkingControl(true,qwen).selected,'medium');
  assert.equal(resolveThinkingControl('xhigh',qwen).selected,'xhigh');
  assert.equal(resolveThinkingControl(false,oss).selected,'low');
  assert.equal(resolveThinkingControl(null,oss).selected,'medium');
  assert.equal(resolveThinkingControl(true,{values:[false,true],default:true}).selected,true);
  assert.equal(resolveThinkingControl(false,undefined).basis,'legacy-no-metadata');
  assert.throws(()=>resolveThinkingControl('xhigh',oss),/does not support/);
  for(const meta of [null,{}, {values:[],default:false},{values:['low'],default:'high'},{values:[false,false],default:false},{values:[42],default:42}])assert.throws(()=>resolveThinkingControl(false,meta),/metadata/);
  for(const preference of [2,{},'invented level','x'.repeat(33)])assert.throws(()=>resolveThinkingControl(preference,oss),/preference/);
});

test('Ollama resolves named-only reasoning and preserves the exact request and privacy boundary',async()=>{
  const calls=[];
  const f=await fixture(async(req,res)=>{let body='';for await(const c of req)body+=c;const data=JSON.parse(body);calls.push({path:req.url,data});
    if(req.url==='/api/show')return res.end(JSON.stringify({thinking:{values:['low','medium','high'],default:'medium'},template:'PRIVATE TEMPLATE'}));
    res.end('{"message":{"thinking":"PRIVATE THOUGHT"}}\n{"message":{"content":"ok"},"done":true,"done_reason":"stop"}\n');
  });
  const input={model:'fixture-local',think:false,messages:[{role:'user',content:'unchanged request'}],format:{type:'object'},options:{num_predict:80}};
  try{const answer=await localFetch(f.url,'/api/chat',{method:'POST',body:JSON.stringify(input)},5000);
    assert.deepEqual(calls[0],{path:'/api/show',data:{model:'fixture-local'}});
    assert.deepEqual(calls[1].data,{...input,think:'low',stream:true});
    assert.equal(answer.inferenceMetrics.thinkingControl.selected,'low');
    assert.equal(answer.inferenceMetrics.thinkingControl.requested,false);
    assert(!JSON.stringify(answer).includes('PRIVATE'));
  }finally{await f.close();}
});

test('legacy metadata preserves boolean controls and is labelled as unqualified',async()=>{
  let sent;const f=await fixture(async(req,res)=>{if(req.url==='/api/show')return res.end('{"capabilities":["completion"]}');let b='';for await(const c of req)b+=c;sent=JSON.parse(b);res.end('{"done":true,"message":{"content":"ok"}}\n');});
  try{const answer=await localFetch(f.url,'/api/chat',{method:'POST',body:JSON.stringify({model:'fixture',think:false})},5000);assert.equal(sent.think,false);assert.equal(answer.inferenceMetrics.thinkingControl.basis,'legacy-no-metadata');}finally{await f.close();}
});

test('metadata errors, unsupported levels and cancellation cannot start inference or silently fall back',async()=>{
  for(const mode of ['http-error','invalid','unsupported','oversized','deadline']){
    let chats=0;const f=await fixture((req,res)=>{
      if(req.url!=='/api/show'){chats++;return res.end('{"done":true}\n');}
      if(mode==='http-error'){res.writeHead(503);return res.end('{}');}
      if(mode==='invalid')return res.end('{"thinking":{"values":[],"default":false}}');
      if(mode==='oversized')return res.end(' '.repeat(2097153));
      if(mode==='deadline'){res.writeHead(200);res.write('{');return;}
      res.end('{"thinking":{"values":["low"],"default":"low"}}');
    });
    try{await assert.rejects(localFetch(f.url,'/api/chat',{method:'POST',body:JSON.stringify({model:'fixture',think:'high'})},mode==='deadline'?50:5000));assert.equal(chats,0);}finally{await f.close();}
  }
});

for(const phase of ['metadata','inference','runner-error'])test(`original deadline bounds stalled ${phase} reads even when stream cancellation never settles`,{timeout:2000},async t=>{
  let released=0,cancelled=0,chats=0;
  const reader={read:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock:()=>{released++;}};
  const mock=t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/api/chat'))chats++;
    return {ok:phase!=='runner-error',status:phase==='runner-error'?500:200,body:{getReader:()=>reader}};
  });
  // The interval only keeps the synthetic transport alive for AbortSignal's
  // unref'ed timer; the real HTTP fixture already has an active socket.
  const alive=setInterval(()=>{},1000),started=performance.now();
  try{
    await assert.rejects(localFetch('http://127.0.0.1:11434','/api/chat',{method:'POST',body:JSON.stringify({model:'fixture',...(phase==='metadata'?{think:false}:{})})},50),/timeout|abort/i);
    assert(performance.now()-started<1000,'Cleanup must not extend a 50 ms inference deadline indefinitely.');
    assert.equal(released,1);assert.equal(cancelled,1);assert.equal(chats,phase==='metadata'?0:1);
  }finally{clearInterval(alive);mock.mock.restore();}
});
