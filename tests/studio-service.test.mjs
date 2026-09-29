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
    assert.equal(done.workflow.status,'questions');assert.equal(done.spec.questions[0].id,'size');assert.equal(done.jobId,null);
    assert.equal(JSON.parse(f.calls[0][2].body).messages[1].role,'user');assert(JSON.parse(JSON.parse(f.calls[0][2].body).messages[1].content).localCatalog.offline);
    res=await send(`/api/studio/projects/${project.id}`,{expectedRevision:1,request:'stale'},'PUT');assert.equal(res.status,409);
    const listed=await(await requestFixture(f.url+'/api/studio/projects')).json();assert.equal(listed.projects[0].id,project.id);
    const catalog=await(await requestFixture(f.url+'/api/studio/catalog')).json();assert.equal(catalog.runtimeNetworkRequired,false);
  }finally{await f.close();}
});

// Even parseable JSON cannot be accepted when the model reports truncation.
test('token-limit completion is rejected and bounded rather than accepted as a design',async()=>{const f=await fixture({doneReason:'length'});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,422);assert.match((await res.json()).error,/truncated/);assert.equal(f.calls.length,3);}finally{await f.close();}});

// Truncation recovery is an extra FORMAT attempt, not an unbounded engineering repair.
test('one truncation plus an invalid complete draft can recover on bounded third attempt',async()=>{const f=await fixture({doneReason:n=>n===1?'length':'stop',reply:n=>n===2?{bad:true}:sample()});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,200);assert.equal(f.calls.length,3);const third=JSON.parse(f.calls[2][2].body);assert.match(third.messages[0].content,/FORMAT REPAIR/);assert.equal((await res.json()).metrics.attempts,3);}finally{await f.close();}});

test('truncation on second format attempt also gets exactly one final opportunity',async()=>{const f=await fixture({doneReason:n=>n===2?'length':'stop',reply:n=>n===1?{bad:true}:sample()});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'toy'})});assert.equal(res.status,200);assert.equal(f.calls.length,3);const payload=JSON.parse(f.calls[2][2].body);assert.equal(payload.options.num_ctx,65536);assert(Object.keys(payload.format.properties).indexOf('electrical')<Object.keys(payload.format.properties).indexOf('assembly'));}finally{await f.close();}});

test('powered draft retry requires wiring in decoder schema instead of repeating optional omission',async()=>{const powered=sample();powered.physicsInputs={driveMotors:{value:2,basis:'ASSUMED',source:'Synthetic fixture'},thresholdDbfs:{value:-25,basis:'ASSUMED',source:'Synthetic fixture'}};const f=await fixture({reply:powered});try{const res=await requestFixture(f.url+'/api/studio/design',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify({request:'Synthetic powered toy'})});assert.equal(res.status,422);assert.equal(f.calls.length,2);const first=JSON.parse(f.calls[0][2].body),second=JSON.parse(f.calls[1][2].body);assert(!first.format.required.includes('electrical'));assert(second.format.required.includes('electrical'));assert(second.format.properties.electrical.required.includes('control'));assert(second.format.properties.electrical.properties.components.items.required.includes('terminalAnchors'));assert(!OLLAMA_DESIGN_SCHEMA.required.includes('electrical'));}finally{await f.close();}});
