import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStudioService,tutorialHTML,PRINTERS,csvCell} from '../server/studio-service.mjs';
import {validateDesignSpec,designHash,verifyDesign} from '../server/studio-contract.mjs';
import {OLLAMA_DESIGN_SCHEMA,designSchemaForDraft} from '../server/studio-schema.mjs';
import {readiness as stagedReady,plan as stagedPlan,payload as stagedPayload} from './helpers/staged-generation-fixture.mjs';
import {partitionGeneration} from '../server/studio-generation-stages.mjs';

test('opt-in staged HTTP workflow asks questions before geometry and never prices them',async()=>{
  const before=process.env.M4KE_STAGED_GENERATION;process.env.M4KE_STAGED_GENERATION='1';
  const f=await fixture({reply:{...stagedReady(),status:'questions',questions:[{id:'battery',question:'Which battery?'}]}});
  try{
    assert.equal((await(await requestFixture(f.url+'/api/studio/capabilities')).json()).workflow.stagedGeneration,true);
    const p=await (await requestFixture(f.url+'/api/studio/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:'fixture'})})).json();
    const started=await (await requestFixture(f.url+`/api/studio/projects/${p.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'design',expectedRevision:p.revision})})).json();assert.ok(started.workflow?.generationId,JSON.stringify(started));
    let end;for(let i=0;i<200;i++){end=await(await requestFixture(f.url+`/api/studio/projects/${p.id}`)).json();if(end.workflow.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(end.workflow.status,'questions',end.workflow.message);assert.equal(end.pendingQuestions.length,1);assert.equal(end.spec,undefined);assert.equal(end.designHash,undefined);assert.equal(end.priceSearch,undefined);assert.equal(f.calls.length,1);
  }finally{if(before===undefined)delete process.env.M4KE_STAGED_GENERATION;else process.env.M4KE_STAGED_GENERATION=before;await f.close();}
});
test('opt-in staged HTTP concept publishes accepted hash and automatic pricing only at completion',async()=>{
  const before=process.env.M4KE_STAGED_GENERATION;process.env.M4KE_STAGED_GENERATION='1';const p=stagedPlan(),units=partitionGeneration(p),responses=[stagedReady(),p,...units.map(u=>{const v=stagedPayload(p,u);if(u.kind==='part')for(const part of v.items)part.explanation={purpose:'Fixture',placementReason:'Fixture',selectionReason:'Fixture'};return v;})];
  const f=await fixture({reply:n=>responses[n-1]});
  try{
    const project=await(await requestFixture(f.url+'/api/studio/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:'Inspect fixture'})})).json();
    const start=await(await requestFixture(f.url+`/api/studio/projects/${project.id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'design',expectedRevision:project.revision})})).json();assert.ok(start.workflow?.generationId,JSON.stringify(start));
    let end;for(let i=0;i<300;i++){end=await(await requestFixture(f.url+`/api/studio/projects/${project.id}`)).json();if(end.workflow.status!=='running')break;assert.equal(end.spec,undefined);await new Promise(r=>setTimeout(r,10));}
    assert.equal(end.workflow.status,'draft',end.workflow.message);assert.equal(end.designHash,designHash(end.spec));assert.equal(end.priceSearch.designHash,end.designHash);assert.equal(f.calls.length,responses.length);assert.equal(end.workflow.canCancel,false);
  }finally{if(before===undefined)delete process.env.M4KE_STAGED_GENERATION;else process.env.M4KE_STAGED_GENERATION=before;await f.close();}
});
test('staged HTTP resume preserves earlier batch and rejects stale project revision',async()=>{
 const before=process.env.M4KE_STAGED_GENERATION;process.env.M4KE_STAGED_GENERATION='1';const p=stagedPlan(5),units=partitionGeneration(p);let calls=0,failed=false;
 const reply=()=>{calls++;if(calls===1)return stagedReady();if(calls===2)return p;if(calls===4&&!failed){failed=true;throw Error('fixture transport disconnected');}const u=units[calls-(failed?4:3)];const v=stagedPayload(p,u);if(u.kind==='part')for(const part of v.items)part.explanation={purpose:'Fixture',placementReason:'Fixture',selectionReason:'Fixture'};return v;};
 const f=await fixture({reply});const send=async(id,body)=>requestFixture(f.url+`/api/studio/projects/${id}/run`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const settle=async(id)=>{for(let i=0;i<200;i++){const p=await(await requestFixture(f.url+`/api/studio/projects/${id}`)).json();if(p.workflow.status!=='running')return p;await new Promise(r=>setTimeout(r,10));}throw Error('workflow timeout');};
 try{
  const project=await(await requestFixture(f.url+'/api/studio/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:'Inspect fixture'})})).json();await send(project.id,{mode:'design',expectedRevision:project.revision});const stopped=await settle(project.id);assert.equal(stopped.workflow.status,'error');assert.equal(stopped.workflow.canResume,true);assert.equal(stopped.spec,undefined);
  assert.equal((await send(project.id,{mode:'design',expectedRevision:1,resumeGenerationId:stopped.workflow.generationId})).status,409);assert.equal(calls,4);
  assert.equal((await send(project.id,{mode:'design',expectedRevision:stopped.revision,resumeGenerationId:stopped.workflow.generationId})).status,202);const end=await settle(project.id);assert.equal(end.workflow.status,'draft',end.workflow.message);assert.equal(end.spec.parts.length,5);assert.equal(calls,7);
 }finally{if(before===undefined)delete process.env.M4KE_STAGED_GENERATION;else process.env.M4KE_STAGED_GENERATION=before;await f.close();}
});

// Each short-lived fixture gets fresh sockets. Windows can immediately reuse a
// closed listener's port; a process-global fetch pool must not cross fixtures.
// Transport errors still reject: no retries or successful fallback responses.
function requestFixture(url, options = {}) {
  return new Promise((resolve, reject) => {
    const { body, ...requestOptions } = options;
    const request = http.request(url, { ...requestOptions, agent: false, timeout: 30_000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode,
        headers: response.headers,
      })));
    });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Fixture HTTP request timed out')));
    request.end(body);
  });
}

const sample=()=>({schemaVersion:1,title:'Test toy',description:'A test solid',units:'mm',requirements:[{id:'R1',text:'A dimensioned toy'}],assumptions:[],unknowns:['Physical test pending'],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[40,30,4]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Measure the part.'],checks:['Compare to the drawing.']}]});

async function fixture(options={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-studio-'));
  const calls=[];
  const handle=createStudioService({root,getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'qwen3.8:27b'}),getModels:async()=>{if(options.tagDelay)await new Promise(r=>setTimeout(r,options.tagDelay));return [{name:options.modelName||'qwen3.8:27b',digest:'fixture'}];},localFetch:async(...args)=>{calls.push(args);if(options.onInfer)await options.onInfer(root,calls.length);return {message:{content:JSON.stringify(typeof options.reply==='function'?options.reply(calls.length):options.reply||sample())},eval_count:50,done_reason:typeof options.doneReason==='function'?options.doneReason(calls.length):options.doneReason||'stop'};},body:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b);},json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}});
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  return {root,url,calls,close:async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}

test('printer catalog has no default and H2C is an explicit option',()=>{assert(PRINTERS.some(p=>p.id==='bambu-h2c'));assert(PRINTERS.length>2);assert(PRINTERS.every(p=>!p.default));});
test('BOM neutralizes spreadsheet formula prefixes without changing ordinary text',()=>{assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell('  +1'),'"\'  +1"');assert.equal(csvCell('Motor'),'"Motor"');assert.equal(csvCell(1),'"1"');});
test('kernel round-trip and mesh failures cannot disappear behind valid solids',()=>{const s=validateDesignSpec(sample());const report=verifyDesign(s,{revisionHash:designHash(s),parts:[{id:'body',valid:true,solidCount:1,volumeMm3:4800}],checks:[{id:'body:step',label:'STEP round trip',status:'FAIL',method:'reimport',observed:10,required:0.00001,details:'Dimension mismatch'}]});assert.equal(report.overall,'FAILED');assert.equal(report.claims.find(c=>c.id==='kernel-body:step').status,'FAIL');});
test('offline tutorial escapes source text and keeps physical unknown visible',()=>{const s=sample();s.title='<img src=x onerror=alert(1)>';const spec=validateDesignSpec(s),html=tutorialHTML(spec,verifyDesign(spec),designHash(spec));assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('physical operation is UNKNOWN'));assert(html.includes('not machine-ready G-code'));});
test('offline tutorial orders prerequisites before dependants without changing the design',()=>{const s=sample();s.assembly.unshift({id:'assemble',title:'Assemble after inspection',partIds:['body'],requires:['inspect'],instructions:['Use inspected parts.'],checks:['Inspection complete.']});const spec=validateDesignSpec(s),html=tutorialHTML(spec,verifyDesign(spec),designHash(spec));assert(html.indexOf('1. Inspect')<html.indexOf('2. Assemble after inspection'));assert.equal(spec.assembly[0].id,'assemble');});
test('offline tutorial preserves critical failure and disables progression acknowledgements',()=>{const spec=validateDesignSpec(sample()),verification=verifyDesign(spec);verification.claims.push({id:'fixture-fail',critical:true,status:'FAIL',label:'Electrical test',method:'Fixture',details:'Fixture failure'});verification.overall='FAILED';const html=tutorialHTML(spec,verification,designHash(spec));assert(html.includes('STOP: critical verification failed.'));assert(html.includes('type="checkbox" disabled'));});
test('studio API sends actual normalized skills, exact local tag and saves design provenance',async()=>{const f=await fixture();try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'Make a test toy',answers:[]})});assert.equal(res.status,200);const data=await res.json();assert.equal(data.spec.parts[0].id,'body');assert.match(data.designHash,/^[a-f0-9]{64}$/);assert(data.skillHashes);assert.equal(data.metrics.attempts,1);const payload=JSON.parse(f.calls[0][2].body);assert.equal(payload.model,'qwen3.8:27b');assert.equal(payload.think,false);assert.equal(payload.options.num_predict,10000);assert(payload.messages[0].content.length>500);assert.equal(data.verification.physical,'UNKNOWN');}finally{await f.close();}});
test('unavailable exact model is not silently substituted',async()=>{const f=await fixture({modelName:'another-model'});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,409);assert.equal(f.calls.length,0);}finally{await f.close();}});

test('mixed model questions reach the user once while premature geometry stays diagnostic only',async()=>{
  const raw={...sample(),questions:[{id:'interface',question:'Which exact interface?'}],electrical:{invalid:'not accepted'}};
  const f=await fixture({reply:raw});
  try{
    const response=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'toy'})});
    assert.equal(response.status,200);const result=await response.json();assert.equal(f.calls.length,1);
    assert.deepEqual(result.spec.parts,[]);assert.deepEqual(result.spec.assembly,[]);assert(!result.spec.electrical);
    assert.equal(result.spec.questions[0].id,'interface');assert.equal(result.verification.physical,'UNKNOWN');
    const saved=JSON.parse(await readFile(path.join(f.root,'data/design-runs',result.metrics.runId+'.json'),'utf8'));
    assert.equal(saved.status,'clarification');assert.equal(saved.clarification.geometryAccepted,false);
    assert.deepEqual(JSON.parse(saved.attempts[0].content),raw);
    const build=await requestFixture(f.url+'/api/studio/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({spec:result.spec,runId:result.metrics.runId})});
    assert.equal(build.status,409);assert.match((await build.json()).error,/clarif|question|part/i);
  }finally{await f.close();}
});

test('each completed failed model attempt is durable before the next inference begins',async()=>{
  let witnessed=false;
  const f=await fixture({reply:count=>count===1?{...sample(),parts:[sample().parts[0],sample().parts[0]]}:sample(),onInfer:async(root,count)=>{
    if(count!==2)return;
    const dir=path.join(root,'data','design-runs'),files=(await readdir(dir)).filter(x=>x.endsWith('.json'));
    assert.equal(files.length,1);const saved=JSON.parse(await readFile(path.join(dir,files[0]),'utf8'));
    assert.equal(saved.status,'running');assert.equal(saved.designHash,null);assert.equal(saved.attempts.length,1);
    assert.match(saved.attempts[0].content,/Body/);assert(saved.errors.length);witnessed=true;
  }});
  try{
    const response=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'Make a small toy'})});
    assert.equal(response.status,200);const result=await response.json();assert(witnessed);
    const saved=JSON.parse(await readFile(path.join(f.root,'data','design-runs',result.metrics.runId+'.json'),'utf8'));
    assert.equal(saved.status,'accepted');assert.equal(saved.attempts.length,2);assert(saved.errors.length);assert.equal(saved.designHash,result.designHash);
  }finally{await f.close();}
});
test('design inference uses the output schema and persists its identity',async()=>{
  const f=await fixture();
  try{
    const response=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'test toy'})});
    assert.equal(response.status,200);
    const result=await response.json(),payload=JSON.parse(f.calls[0][2].body);
    assert.deepEqual(payload.format,designSchemaForDraft(null));
    const provenance=JSON.parse(await readFile(path.join(f.root,'data','design-runs',result.metrics.runId+'.json'),'utf8'));
    assert.equal(provenance.outputSchemaHash,createHash('sha256').update(JSON.stringify(designSchemaForDraft(null))).digest('hex'));
    assert.equal(provenance.designHash,result.designHash);
  }finally{await f.close();}
});
test('concurrent design admission locks before awaiting model discovery',async()=>{const f=await fixture({tagDelay:100});try{const send=()=>requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});const responses=await Promise.all([send(),send()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,429]);assert.equal(f.calls.length,1);}finally{await f.close();}});
test('invalid model output gets one bounded repair then no CAD execution',async()=>{const f=await fixture({reply:{code:'process.exit()'}});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,422);assert.equal(f.calls.length,2);}finally{await f.close();}});
test('unresolved clarification prevents native build, even with a part preview',async()=>{const f=await fixture();try{const spec=sample();spec.questions=[{id:'q1',question:'What size?'}];const res=await requestFixture(f.url+'/api/studio/build',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({spec})});assert.equal(res.status,409);assert.match((await res.json()).error,/Answer/);}finally{await f.close();}});
test('job identifiers reject traversal and interrupted jobs are not reported complete',async()=>{const f=await fixture();try{let res=await requestFixture(f.url+'/api/studio/jobs/not-a-uuid');assert.equal(res.status,400);const id='12345678-1234-4234-8234-123456789abc';await mkdir(path.join(f.root,'data','studio-jobs',id),{recursive:true});await writeFile(path.join(f.root,'data','studio-jobs',id,'job.json'),JSON.stringify({id,status:'running',designHash:'old'}));res=await requestFixture(f.url+'/api/studio/jobs/'+id);const data=await res.json();assert.equal(data.status,'error');assert.match(data.error,/restarted/);}finally{await f.close();}});
test('artifact delivery rejects bytes changed after the recorded geometry check',async()=>{const f=await fixture();try{const id='12345678-1234-4234-8234-123456789abc',dir=path.join(f.root,'data','studio-jobs',id);await mkdir(path.join(dir,'cad','parts'),{recursive:true});const hash=createHash('sha256').update('original').digest('hex');await writeFile(path.join(dir,'cad','parts','body.stl'),'original');await writeFile(path.join(dir,'job.json'),JSON.stringify({id,status:'complete',cad:{assemblyStep:'assembly.step',parts:[{id:'body',stl:'parts/body.stl',step:'parts/body.step',sha256:{stl:hash}}]},artifactHashes:{'cad/parts/body.stl':hash}}));const url=f.url+`/api/studio/jobs/${id}/files/cad/parts/body.stl`;assert.equal((await requestFixture(url)).status,200);await writeFile(path.join(dir,'cad','parts','body.stl'),'modified');const res=await requestFixture(url);assert.equal(res.status,409);assert.match((await res.json()).error,/changed after verification/);}finally{await f.close();}});

test('project API persists on server and automatic local intake pauses for essential questions',async()=>{
  const spec=sample();spec.parts=[];spec.assembly=[];spec.questions=[{id:'size',question:'What size?'}];
  const f=await fixture({reply:spec});
  try{
    const send=(url,data,method='POST')=>requestFixture(f.url+url,{method,headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify(data)});
    let res=await send('/api/studio/projects',{request:'Design a toy',answers:[]});assert.equal(res.status,201);const project=await res.json();
    res=await send(`/api/studio/projects/${project.id}/run`,{});assert.equal(res.status,202);
    let done;for(let i=0;i<100;i++){done=await(await requestFixture(f.url+`/api/studio/projects/${project.id}`)).json();if(done.workflow?.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(done.workflow.status,'questions');assert.equal(done.spec.questions[0].id,'size');assert(!done.jobId);
    assert.equal(JSON.parse(f.calls[0][2].body).messages[1].role,'user');assert(JSON.parse(JSON.parse(f.calls[0][2].body).messages[1].content).localCatalog.offline);
    res=await send(`/api/studio/projects/${project.id}`,{expectedRevision:1,request:'stale'},'PUT');assert.equal(res.status,409);
    const listed=await(await requestFixture(f.url+'/api/studio/projects')).json();assert.equal(listed.projects[0].id,project.id);
    const catalog=await(await requestFixture(f.url+'/api/studio/catalog')).json();assert.equal(catalog.runtimeNetworkRequired,false);
  }finally{await f.close();}
});

// Even parseable JSON cannot be accepted when the model reports truncation.
test('repeated token-limit completions stop after one larger-budget retry, even for parseable JSON',async()=>{const f=await fixture({doneReason:'length'});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,422);assert.match((await res.json()).error,/truncated/);assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>JSON.parse(c[2].body).options.num_predict),[10000,20000]);const files=await readdir(path.join(f.root,'data/design-runs'));const receipt=JSON.parse(await readFile(path.join(f.root,'data/design-runs',files.find(x=>x.endsWith('.json'))),'utf8'));assert.equal(receipt.status,'rejected');assert.equal(receipt.designHash,null);assert.deepEqual(receipt.attempts.map(a=>a.inferenceConfig.num_predict),[10000,20000]);assert(!await readdir(path.join(f.root,'data/studio-jobs')).catch(()=>[]).then(x=>x.length));}finally{await f.close();}});

test('truncation recovery retains schema and required fields, with each budget saved before retry',async()=>{
  let witnessed=false;
  const f=await fixture({doneReason:n=>n===1?'length':'stop',onInfer:async(root,count)=>{
    if(count!==2)return;
    const dir=path.join(root,'data/design-runs'),files=await readdir(dir);
    const saved=JSON.parse(await readFile(path.join(dir,files.find(x=>x.endsWith('.json'))),'utf8'));
    assert.equal(saved.designHash,null);assert.equal(saved.attempts[0].doneReason,'length');assert.equal(saved.attempts[0].inferenceConfig.num_predict,10000);assert.equal(saved.inferenceConfig.num_predict,20000);assert.match(saved.errors[0],/truncated/);witnessed=true;
  }});
  try{
    const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'toy'})});
    assert.equal(res.status,200);assert(witnessed);const result=await res.json();assert.equal(result.metrics.attempts,2);
    const [first,second]=f.calls.map(c=>JSON.parse(c[2].body));assert.deepEqual(second.format,first.format);assert.equal(second.options.num_predict,20000);assert.equal(f.calls[1][3],1200000);assert.match(second.messages[0].content,/required design and electrical fields/);
    assert.deepEqual(result.spec.requirements,sample().requirements);assert.deepEqual(result.spec.parts,sample().parts);
  }finally{await f.close();}
});

test('project progress exposes the truncation reason and larger retry budget',async()=>{
  let release,entered;const paused=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const f=await fixture({doneReason:'length',onInfer:async(root,count)=>{if(count===2){entered();await gate;}}});
  try{
    const post=(url,data)=>requestFixture(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    const project=await(await post(f.url+'/api/studio/projects',{request:'toy',answers:[]})).json();
    assert.equal((await post(f.url+`/api/studio/projects/${project.id}/run`,{})).status,202);
    await paused;
    const current=await(await requestFixture(f.url+`/api/studio/projects/${project.id}`)).json();
    assert.equal(current.workflow.inference.retryReason,'output-truncated');assert.equal(current.workflow.inference.attempt,2);assert.equal(current.workflow.inference.previousTokenLimit,10000);assert.equal(current.workflow.inference.tokenLimit,20000);assert(!current.jobId);
    release();let done;for(let n=0;n<100;n++){done=await(await requestFixture(f.url+`/api/studio/projects/${project.id}`)).json();if(done.workflow.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    assert.equal(done.workflow.status,'error');assert.equal(f.calls.length,2);assert(!done.jobId);
  }finally{release();await f.close();}
});

// Truncation recovery is an extra FORMAT attempt, not an unbounded engineering repair.
test('geometry patch repeated truncation stops after one larger-budget recovery',async()=>{
  const f=await fixture({doneReason:'length',reply:{updates:[{partId:'body',changes:{position:[0,0,5]}}]}});
  try{
    const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'Repair toy',previousSpec:sample(),repairErrors:['Geometry fixture failed']})});
    assert.equal(res.status,422);assert.match((await res.json()).error,/No further token-limit retry/);
    assert.deepEqual(f.calls.map(c=>JSON.parse(c[2].body).options.num_predict),[4500,9000]);
    const files=await readdir(path.join(f.root,'data/design-runs'));
    const receipt=JSON.parse(await readFile(path.join(f.root,'data/design-runs',files.find(x=>x.endsWith('.json'))),'utf8'));
    assert.equal(receipt.status,'rejected');assert.equal(receipt.designHash,null);
  }finally{await f.close();}
});

test('geometry patch truncated on its second attempt receives the promised final recovery',async()=>{
  const patch={updates:[{partId:'body',changes:{position:[0,0,5]}}]};
  const f=await fixture({doneReason:n=>n===2?'length':'stop',reply:n=>n===1?{updates:[]}:patch});
  try{
    const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:'Repair toy',previousSpec:sample(),repairErrors:['Geometry fixture failed']})});
    assert.equal(res.status,200);const result=await res.json();
    assert.equal(result.metrics.attempts,3);
    assert.deepEqual(f.calls.map(c=>JSON.parse(c[2].body).options.num_predict),[4500,4500,9000]);
    assert.deepEqual(result.spec.parts[0].position,[0,0,5]);
    assert.deepEqual(result.spec.requirements,sample().requirements);
    const receipt=JSON.parse(await readFile(path.join(f.root,'data/design-runs',result.metrics.runId+'.json'),'utf8'));
    assert.equal(receipt.generationMode,'model-geometry-patch');assert.equal(receipt.status,'accepted');
  }finally{await f.close();}
});
test('one truncation plus an invalid complete draft can recover on bounded third attempt',async()=>{const f=await fixture({doneReason:n=>n===1?'length':'stop',reply:n=>n===2?{bad:true}:sample()});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,200);assert.equal(f.calls.length,3);const third=JSON.parse(f.calls[2][2].body);assert.match(third.messages[0].content,/FORMAT REPAIR/);assert.equal((await res.json()).metrics.attempts,3);}finally{await f.close();}});

test('truncation on second format attempt also gets exactly one final opportunity',async()=>{const f=await fixture({doneReason:n=>n===2?'length':'stop',reply:n=>n===1?{bad:true}:sample()});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,200);assert.equal(f.calls.length,3);const payload=JSON.parse(f.calls[2][2].body);assert.equal(payload.options.num_ctx,65536);assert(Object.keys(payload.format.properties).indexOf('electrical')<Object.keys(payload.format.properties).indexOf('assembly'));}finally{await f.close();}});

test('powered draft retry requires wiring in decoder schema instead of repeating optional omission',async()=>{const powered=sample();powered.physicsInputs={driveMotors:{value:2,basis:'ASSUMED',source:'Synthetic fixture'},thresholdDbfs:{value:-25,basis:'ASSUMED',source:'Synthetic fixture'}};const f=await fixture({reply:powered});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'Synthetic powered toy'})});assert.equal(res.status,422);assert.equal(f.calls.length,2);const first=JSON.parse(f.calls[0][2].body),second=JSON.parse(f.calls[1][2].body);assert(!first.format.required.includes('electrical'));assert(second.format.required.includes('electrical'));assert(second.format.properties.electrical.required.includes('control'));assert(second.format.properties.electrical.properties.components.items.required.includes('terminalAnchors'));assert(!OLLAMA_DESIGN_SCHEMA.required.includes('electrical'));}finally{await f.close();}});
