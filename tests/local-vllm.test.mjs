import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {vllmFetch} from '../server/studio-vllm.mjs';
import {localFetch,validateProvider} from '../server/index.mjs';

async function fixture(handler){
  const server=http.createServer((req,res)=>{res.setHeader('Connection','close');return handler(req,res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};
}
const options={method:'POST',body:JSON.stringify({model:'test-local',messages:[{role:'user',content:'Test only'}],think:false,format:{type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false},options:{temperature:0.2,num_predict:123,num_ctx:65536}})};
const event=item=>'data: '+JSON.stringify(item)+'\r\n\r\n';
const final=event({model:'test-local',choices:[{delta:{},finish_reason:'stop'}]})+event({choices:[],usage:{prompt_tokens:12,completion_tokens:7}})+'data: [DONE]\r\n\r\n';

test('provider selection is explicit and preserves legacy default',()=>{
  assert.equal(validateProvider(), 'ollama');assert.equal(validateProvider('vllm'),'vllm');
  for(const v of ['openai','cloud','',null])assert.throws(()=>validateProvider(v));
});
test('vLLM inventory uses served IDs without inventing a weight digest or download size',async()=>{
  const f=await fixture((req,res)=>{assert.equal(req.url,'/v1/models');res.end(JSON.stringify({data:[{id:'test-local',max_model_len:65536}]}));});
  try{const r=await localFetch(f.url,'/api/tags',{},3000,undefined,undefined,'vllm');assert.equal(r.models[0].name,'test-local');assert.equal(r.models[0].digest,'');assert.equal(r.models[0].size,0);}finally{await f.close();}
});
test('vLLM structured stream preserves schema and UTF8 but never publishes reasoning',async()=>{
  let payload;const events=[];
  const f=await fixture(async(req,res)=>{
    assert.equal(req.url,'/v1/chat/completions');let body='';for await(const x of req)body+=x;payload=JSON.parse(body);
    const bytes=Buffer.from(event({model:'test-local',choices:[{delta:{reasoning:'PRIVATE_THOUGHT',content:'{"message":"你好"}'}}]})+final);
    for(let i=0;i<bytes.length;i+=5)res.write(bytes.subarray(i,i+5));res.end();
  });
  try{
    const r=await localFetch(f.url,'/api/chat',options,3000,undefined,x=>events.push(x),'vllm');
    assert.deepEqual(payload.response_format.json_schema.schema,JSON.parse(options.body).format);
    assert.equal(payload.max_tokens,123);assert.equal(payload.chat_template_kwargs.enable_thinking,false);assert.equal(payload.include_reasoning,false);
    assert.deepEqual(JSON.parse(r.message.content),{message:'你好'});assert.equal(r.eval_count,7);assert.equal(r.prompt_eval_count,12);
    assert.equal(r.done_reason,'stop');assert.equal(r.inferenceMetrics.provider,'vllm');assert(!('eval_duration' in r));
    assert(!JSON.stringify({r,events}).includes('PRIVATE_THOUGHT'));assert(!JSON.stringify(events).includes('你好'));
    assert.equal(events[0].phase,'waiting');assert.equal(events.at(-1).phase,'response_received');
  }finally{await f.close();}
});
test('vLLM truncated response remains truncated for authoritative callers to reject',async()=>{
  const f=await fixture((req,res)=>res.end(event({choices:[{delta:{content:'{}'},finish_reason:'length'}]})+'data: [DONE]\n\n'));
  try{assert.equal((await vllmFetch(f.url,'/api/chat',options)).done_reason,'length');}finally{await f.close();}
});
test('malformed, incomplete, wrong-model and tool-call responses fail closed',async()=>{
  const streams=[
    event({choices:[{delta:{content:'{}'}}]}),
    event({model:'other',choices:[{delta:{content:'{}'}}]})+final,
    event({choices:[{delta:{tool_calls:[{function:{name:'exec'}}]}}]})+final,
    event({error:{message:'private error'}})+final,
    final,
    event({choices:[{delta:{content:'{}'}}]})+final+event({choices:[]}),
    event({choices:[{delta:{content:'{}'},finish_reason:'stop'}]})+event({choices:[{delta:{content:'extra'}}]})+'data: [DONE]\n\n',
    'data: not JSON\n\n',
  ];
  for(const stream of streams){const f=await fixture((req,res)=>res.end(stream));try{await assert.rejects(vllmFetch(f.url,'/api/chat',options));}finally{await f.close();}}
});
test('vLLM local-only boundary, HTTP errors and redirect never trigger fallback',async()=>{
  await assert.rejects(vllmFetch('https://example.com','/api/tags'),/loopback/);
  await assert.rejects(vllmFetch('http://127.0.0.1:1','/api/pull'),/Unsupported/);
  for(const code of [400,500,302]){
    let count=0;const f=await fixture((req,res)=>{count++;res.writeHead(code,{Location:'https://example.com'});res.end('not model output');});
    try{await assert.rejects(vllmFetch(f.url,'/api/chat',options,1000));assert.equal(count,1);}finally{await f.close();}
  }
});
test('vLLM cancellation does not promote a partial reply or completion event',async()=>{
  const abort=new AbortController(),events=[];
  const f=await fixture((req,res)=>{res.write(event({choices:[{delta:{content:'partial'}}]}));setTimeout(()=>abort.abort(),20);});
  try{await assert.rejects(vllmFetch(f.url,'/api/chat',options,3000,abort.signal,e=>events.push(e)));assert(!events.some(e=>e.phase==='response_received'));}finally{await f.close();}
});
