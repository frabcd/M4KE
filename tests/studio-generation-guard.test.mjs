import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStudioService} from '../server/studio-service.mjs';
import {validateDesignSpec,designHash} from '../server/studio-contract.mjs';

// Schema/model-transport fixtures only, never a physical toy or native CAD run.
const original=()=>validateDesignSpec({schemaVersion:1,title:'Generation guard fixture',description:'Synthetic repair transport',units:'mm',requirements:[{id:'R1',text:'Retain a body no wider than 40 mm'}],assumptions:[],unknowns:['Physical operation is unknown'],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[50,30,4]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Inspect the part.'],checks:['Measure the width.']}],verificationRequests:[{id:'width',requirementId:'R1',type:'envelope',partIds:['body'],maxSizeMm:[40,30,4]}]});
const changed=()=>{const spec=original();spec.parts[0].shape.size[0]=38;return spec;};
const patch=width=>({updates:[{partId:'body',changes:{shape:{type:'box',size:[width,30,4]}}}]});
const initialError='kernel-request:width: synthetic observed width 50 mm exceeds immutable 40 mm requirement';

async function fixture(replies){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-generation-guard-')),calls=[];
  let cadCalls=0;
  const handle=createStudioService({root,getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'fixture-qwen'}),getModels:async()=>[{name:'fixture-qwen',digest:'fixture-only'}],
    localFetch:async(_endpoint,_route,options)=>{const payload=JSON.parse(options.body);calls.push(payload);assert(payload.format.properties.updates,'Engineering repair must use the bounded patch schema');return {message:{content:JSON.stringify(replies[Math.min(calls.length-1,replies.length-1)])},eval_count:10};},
    runProcess:async()=>{cadCalls++;throw new Error('Generation guard must not execute CAD');},
    body:async req=>{let bytes='';for await(const chunk of req)bytes+=chunk;return JSON.parse(bytes);},
    json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},
  });
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {calls,cadCalls:()=>cadCalls,
    design:()=>fetch(`http://127.0.0.1:${server.address().port}/api/studio/design`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'Repair the supplied synthetic failed specification',previousSpec:original(),repairErrors:[initialError]})}),
    records:async()=>{const folder=path.join(root,'data','design-runs');return Promise.all((await readdir(folder)).map(async name=>JSON.parse(await readFile(path.join(folder,name),'utf8'))));},
    close:async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});},
  };
}

test('unchanged engineering patch consumes the existing second model attempt instead of accepting unchanged geometry',async()=>{
  const f=await fixture([patch(50),patch(38)]);
  try{
    const response=await f.design();assert.equal(response.status,200);const result=await response.json();
    assert.equal(f.calls.length,2);assert.equal(result.metrics.attempts,2);assert.equal(result.designHash,designHash(changed()));
    assert.equal(f.cadCalls(),0);
    const second=JSON.parse(f.calls[1].messages[1].content);
    assert.deepEqual(second.previousSpec,original());assert(second.validationErrors.length>0);assert(second.hostFailures.includes(initialError));
    const [record]=await f.records();assert.equal(record.attempts.length,2);assert.equal(record.designHash,result.designHash);
    assert.equal(record.generationMode,'model-geometry-patch');assert.equal(record.parentDesignHash,designHash(original()));
    assert.deepEqual(JSON.parse(record.attempts[0].content),patch(50));assert.deepEqual(JSON.parse(record.attempts[1].content),patch(38));
  }finally{await f.close();}
});

test('two unchanged engineering patches stop with retained patches and no accepted design or CAD',async()=>{
  const f=await fixture([patch(50)]);
  try{
    const response=await f.design();assert.equal(response.status,422);const result=await response.json();
    assert.equal(result.spec,undefined);assert.equal(f.calls.length,2);assert.equal(f.cadCalls(),0);
    const records=await f.records();assert.equal(records.length,1);
    assert.equal(records[0].designHash,null);assert.equal(records[0].attempts.length,2);assert(records[0].errors.length>1);
    assert.equal(records[0].generationMode,'model-geometry-patch');assert.equal(records[0].parentDesignHash,designHash(original()));
    for(const attempt of records[0].attempts)assert.deepEqual(JSON.parse(attempt.content),patch(50));
  }finally{await f.close();}
});

test('a patch cannot edit a verification predicate instead of fixing its geometry',async()=>{
  const invalid={updates:[{partId:'body',changes:{maxSizeMm:[100,30,4]}}]};
  const f=await fixture([invalid,patch(38)]);
  try{
    const response=await f.design();assert.equal(response.status,200);const result=await response.json();
    assert.equal(f.calls.length,2);assert.equal(f.cadCalls(),0);
    assert.deepEqual(result.spec.verificationRequests,original().verificationRequests);
    assert.equal(result.designHash,designHash(changed()));
    const second=JSON.parse(f.calls[1].messages[1].content);assert(second.validationErrors.length>0);assert(second.hostFailures.includes(initialError));
    const [record]=await f.records();assert.equal(record.generationMode,'model-geometry-patch');assert.equal(record.parentDesignHash,designHash(original()));
    assert.deepEqual(JSON.parse(record.attempts[0].content),invalid);assert.deepEqual(JSON.parse(record.attempts[1].content),patch(38));
  }finally{await f.close();}
});

test('repair transport explains actual coordinate frames without weakening the frozen checks',async()=>{
  const f=await fixture([patch(38)]);
  try{
    const response=await f.design();assert.equal(response.status,200);
    const result=await response.json();assert.equal(f.calls.length,1);assert.equal(f.cadCalls(),0);
    const system=f.calls[0].messages.filter(message=>message.role==='system').map(message=>message.content).join('\n');
    assert.match(system,/CENTERED on their local origin/);
    assert.match(system,/NOT its bottom face or lower corner/);
    assert.match(system,/world bottom Z = position\[2\] - H\/2/);
    assert.match(system,/Source CAD keeps its supplied bounds\/origin/);
    assert.match(system,/local Z, then Y, then X/);
    assert.match(system,/making a functional joint float is not a repair/);
    const input=JSON.parse(f.calls[0].messages[1].content);
    assert.deepEqual(input.previousSpec,original());assert(input.hostFailures.includes(initialError));
    assert.deepEqual(result.spec.requirements,original().requirements);
    assert.deepEqual(result.spec.verificationRequests,original().verificationRequests);
    assert.equal(result.designHash,designHash(changed()));
  }finally{await f.close();}
});
