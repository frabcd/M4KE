import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {createStudioService,architectureBoundSchema,architectureBindingIssues} from '../server/studio-service.mjs';
import {OLLAMA_DESIGN_SCHEMA} from '../server/studio-schema.mjs';
import {designHash} from '../server/studio-contract.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';

// Synthetic model and CAD transport fixture only. These tests do not contact a
// model, prove geometry, run firmware on hardware or create a toy acceptance run.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repo=fileURLToPath(new URL('..',import.meta.url));
function design(){
  const {parts,electrical}=electricalFixture();
  // Different GPIO from the static car reference: the netlist must own the map.
  electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP10';
  electrical.components.find(c=>c.partId==='pico').terminalAnchors.find(a=>a.terminal==='GP2').terminal='GP10';
  electrical.control.thresholdDbfs=-31;
  return {schemaVersion:1,title:'Synthetic electrical API fixture',description:'Not a Qwen benchmark or physical toy',units:'mm',requirements:[{id:'R1',text:'Preserve the chosen pin map and source revision'}],assumptions:['All geometry is synthetic and all purchased bodies are envelopes.'],unknowns:['Physical wiring, ratings and motion are untested.'],questions:[],
    parts:parts.map(p=>({...p,material:'Synthetic envelope only',color:'#123456',shape:{type:'box',size:[20,10,5]}})),
    assembly:[{id:'inspect',title:'Inspect while disconnected',partIds:parts.map(p=>p.id),requires:[],instructions:['Keep all power disconnected.'],checks:['Match every terminal to the intended netlist.']}],
    physicsInputs:{thresholdDbfs:{value:-31,basis:'ASSUMED',source:'Synthetic test input, not measured'}},electrical};
}

async function fixture({reply=design(),designReplies=[],architectureReplies=[],repairReply=null,workerFailure=false,omitFirmware=false,workerResultMode='success'}={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-electrical-service-')),calls=[],workers=[];
  let designIndex=0,architectureIndex=0;
  await mkdir(path.join(root,'cad'),{recursive:true});
  for(const name of ['worker.py','requirements.txt'])await writeFile(path.join(root,'cad',name),'SYNTHETIC NEVER EXECUTED');
  if(!omitFirmware){await mkdir(path.join(root,'firmware','sound-car'),{recursive:true});for(const name of ['main.py','controller.py'])await writeFile(path.join(root,'firmware','sound-car',name),await readFile(path.join(repo,'firmware','sound-car',name)));}
  const python=process.env.M4KE_CAD_PYTHON||path.join(root,'.venv-cad',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!process.env.M4KE_CAD_PYTHON){await mkdir(path.dirname(python),{recursive:true});await writeFile(python,'Injected synthetic runner');}
  const handle=createStudioService({root,getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'fixture-qwen'}),getModels:async()=>[{name:'fixture-qwen',digest:'synthetic-model-digest'}],
    localFetch:async(_endpoint,_route,options)=>{
      const payload=JSON.parse(options.body);calls.push(payload);let response;
      if(payload.format.properties.concerns)response={summary:'Synthetic advisory only.',concerns:[]};
      else if(payload.format.properties.checks)response={checks:[],uncovered:[]};
      else if(payload.format.properties.updates)response=repairReply;
      else if(payload.format.properties.powerArchitecture){assert.ok(architectureIndex<architectureReplies.length,'Unexpected architecture inference in synthetic fixture');response=architectureReplies[architectureIndex++];}
      else response=designIndex<designReplies.length?designReplies[designIndex++]:reply;
      return {message:{content:JSON.stringify(response)},done_reason:'stop',eval_count:10};
    },
    body:async req=>{let data='';for await(const chunk of req)data+=chunk;return JSON.parse(data);},
    json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},
    runProcess:async(_exe,args)=>{
      if(args[0]==='-c')return {code:0,stdout:'{"version":"SYNTHETIC-NOT-CAD"}',stderr:''};
      if(path.basename(args[0])==='illustrate.py')return {code:1,stdout:'',stderr:'No synthetic projection'};
      const input=args[args.indexOf('--input')+1],output=args[args.indexOf('--output')+1],bytes=await readFile(input),spec=JSON.parse(bytes);workers.push({input,sha256:sha(bytes),spec});
      await mkdir(path.join(output,'parts'),{recursive:true});
      if(workerFailure){await writeFile(path.join(output,'result.json'),JSON.stringify({schemaVersion:1,ok:false,parts:[],checks:[],errors:['Synthetic native failure']}));return {code:2,stdout:'',stderr:'Synthetic native failure'};}
      const records=[];
      for(const p of spec.parts){const hashes={};for(const kind of ['stl','step']){const body=Buffer.from(`SYNTHETIC ${kind} ${p.id}`);await writeFile(path.join(output,'parts',p.id+'.'+kind),body);hashes[kind]=sha(body);}records.push({id:p.id,valid:true,solidCount:1,volumeMm3:1000,stl:`parts/${p.id}.stl`,step:`parts/${p.id}.step`,sha256:hashes});}
      const assembly=Buffer.from('SYNTHETIC ASSEMBLY');await writeFile(path.join(output,'assembly.step'),assembly);
      const checkFailed=workerResultMode.startsWith('check-fail'),checks=checkFailed?[{id:'assembly-overlap',label:'Synthetic completed interference check',status:'FAIL',method:'Synthetic transport fixture, not native geometry evidence',observed:{overlaps:[{parts:[spec.parts[0].id,spec.parts[1].id],volumeMm3:2}]},required:'No positive intersections',details:'Intentionally failed mock result to test diagnostic delivery. Not a real engineering finding.'}]:[];
      const inputSha256=workerResultMode==='check-fail-wrong-input'?'0'.repeat(64):sha(bytes);
      const resultParts=workerResultMode==='check-fail-missing-part'?records.slice(1):workerResultMode==='check-fail-duplicate-part'?[...records.slice(0,-1),records[0]]:records;
      await writeFile(path.join(output,'result.json'),JSON.stringify({schemaVersion:1,title:spec.title,units:'mm',ok:workerResultMode==='success'||workerResultMode==='check-fail-ok-true',inputSha256,assemblyStep:'assembly.step',assemblySha256:sha(assembly),parts:resultParts,checks,errors:checkFailed?['Synthetic completed interference FAIL']:[]}));
      if(workerResultMode==='check-fail-tampered')await writeFile(path.join(output,records[0].step),'SYNTHETIC MODIFIED AFTER HASH');
      return {code:workerResultMode==='success'?0:2,stdout:'Synthetic worker completed; not native evidence',stderr:checkFailed?'Synthetic completed verification FAIL':''};
    }});
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(error){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/studio/`;
  // Each fixture owns a short-lived ephemeral listener; never reuse its pooled
  // connection after Windows assigns that same port to the next fixture.
  const request=(route,value)=>new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method:value===undefined?'GET':'POST',agent:false,timeout:30000,headers:{'content-type':'application/json'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });
    req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Electrical HTTP fixture timeout')));
    req.end(value===undefined?undefined:JSON.stringify(value));
  });
  const get=route=>request(route),post=(route,value)=>request(route,value);
  const generate=async()=>{const response=await post('design',{request:'Synthetic fixture input'});assert.equal(response.status,200);return response.json();};
  const build=async generated=>{const response=await post('build',{spec:generated.spec,runId:generated.metrics.runId});assert.equal(response.status,202);const queued=await response.json();for(let i=0;i<300;i++){const job=await(await get('jobs/'+queued.id)).json();if(!['running','queued'].includes(job.status))return job;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Synthetic build did not finish');};
  return {root,calls,workers,get,post,generate,build,close:async()=>{await new Promise(resolve=>server.close(resolve));const absolute=path.resolve(root);assert.equal(path.dirname(absolute),path.resolve(tmpdir()));assert.match(path.basename(absolute),/^m4ke-electrical-service-/);await rm(absolute,{recursive:true,force:true});}};
}

test('model electrical contract survives API, native boundary, guide and hash-bound package without fixed-car fallback',async()=>{
  const f=await fixture();try{
    const generated=await f.generate();assert.equal(generated.designHash,designHash(generated.spec));assert.ok(f.calls[0].format.properties.electrical);
    const record=JSON.parse(await readFile(path.join(f.root,'data','design-runs',generated.metrics.runId+'.json'),'utf8'));assert.equal(record.designHash,generated.designHash);assert.deepEqual(JSON.parse(record.attempts[0].content).electrical,design().electrical);
    const job=await f.build(generated);assert.equal(job.status,'complete',job.error);assert.equal(job.provenance.origin,'local-qwen');assert.equal(job.provenance.modelGenerationVerified,true);assert.equal(job.electrical.designHash,job.designHash);assert.equal(job.designHash,generated.designHash);assert.equal(job.electrical.status,'UNVERIFIED');assert.equal(job.verification.physical,'UNKNOWN');assert.equal(job.electrical.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.equal(job.electrical.firmware.pins.LEFT_IN1_GP,10);assert.equal(job.firmware,undefined);assert.equal(job.kitId,undefined);
    assert.deepEqual(f.workers[0].spec.electrical,generated.spec.electrical);
    const response=await f.get(`jobs/${job.id}/package`);assert.equal(response.status,200);const zip=unzipSync(new Uint8Array(await response.arrayBuffer())),hashes=JSON.parse(strFromU8(zip['ARTIFACT-HASHES.json']));
    const expected=['electrical/netlist.json','electrical/wiring.svg','electrical/connections.csv','electrical/README.md','firmware/config.py','firmware/main.py','firmware/controller.py','firmware/README.md'];
    assert.deepEqual([...job.electrical.files].sort(),expected.sort());
    for(const name of expected){assert.ok(zip[name],name);assert.equal(sha(zip[name]),job.artifactHashes[name],name);assert.equal(hashes[name],job.artifactHashes[name],name);const direct=await f.get(`jobs/${job.id}/files/${name}`);assert.equal(direct.status,200);if(name==='electrical/wiring.svg'){assert.equal(direct.headers.get('content-type'),'image/svg+xml');assert.equal(direct.headers.get('content-disposition'),'inline; filename="wiring.svg"');assert.equal(direct.headers.get('x-content-type-options'),'nosniff');assert.equal(direct.headers.get('cache-control'),'no-store');assert.equal(direct.headers.get('content-security-policy'),"sandbox; default-src 'none'; style-src 'unsafe-inline'");}assert.equal(sha(Buffer.from(await direct.arrayBuffer())),hashes[name]);}
    const netlist=JSON.parse(strFromU8(zip['electrical/netlist.json']));assert.equal(netlist.designHash,job.designHash);assert.deepEqual(netlist.electrical,generated.spec.electrical);assert.deepEqual(netlist.firmware,job.electrical.firmware);
    for(const connection of generated.spec.electrical.connections){assert.ok(strFromU8(zip['electrical/connections.csv']).includes(connection.id));assert.ok(strFromU8(zip['electrical/wiring.svg']).includes(connection.id));}
    assert.match(strFromU8(zip['firmware/config.py']),/LEFT_IN1_GP = 10\n/);assert.match(strFromU8(zip['firmware/config.py']),/THRESHOLD_DBFS = -31\n/);assert.match(strFromU8(zip['firmware/config.py']),/MOTOR_OUTPUT_ENABLED = False/);assert.ok(strFromU8(zip['firmware/config.py']).includes(job.designHash));
    assert.ok(strFromU8(zip['BUILD-GUIDE.html']).includes('electrical/wiring.svg'));assert.ok(strFromU8(zip['BUILD-GUIDE.html']).includes('GP10'));assert.ok(strFromU8(zip['BUILD-GUIDE.html']).includes(job.designHash));
    assert.equal(zip['CAR-HARDWARE-REFERENCE.json'],undefined);assert.equal(zip['firmware/POWER-AND-WIRING.md'],undefined);
  }finally{await f.close();}
});

test('changed electrical revision cannot reuse the original model generation identity',async()=>{
  const f=await fixture();try{const generated=await f.generate(),changed=structuredClone(generated.spec);changed.electrical.control.pwmDuty=.3;const response=await f.post('build',{spec:changed,runId:generated.metrics.runId});assert.equal(response.status,409);assert.match((await response.json()).error,/provenance does not match/);assert.equal(f.workers.length,0);}finally{await f.close();}
});

test('electrical artifact tampering blocks both direct delivery and package export',async()=>{
  const f=await fixture();try{const job=await f.build(await f.generate());assert.equal(job.status,'complete',job.error);for(const name of ['electrical/netlist.json','electrical/wiring.svg','electrical/connections.csv','electrical/README.md','firmware/config.py']){const file=path.join(f.root,'data','studio-jobs',job.id,name),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('\nTAMPERED')]));for(const route of [`jobs/${job.id}/files/${name}`,`jobs/${job.id}/package`]){const response=await f.get(route);assert.equal(response.status,409,name);assert.match((await response.json()).error,/changed after verification/);}await writeFile(file,original);}assert.equal((await f.get(`jobs/${job.id}/package`)).status,200);}finally{await f.close();}
});

test('failed electrical topology stays failed and cannot export firmware or enable guide progression',async()=>{
  const reply=design();reply.electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP26';
  const f=await fixture({reply});try{const generated=await f.generate();assert.equal(generated.verification.overall,'FAILED');const job=await f.build(generated);assert.equal(job.status,'complete',job.error);assert.equal(job.verification.overall,'FAILED');assert.equal(job.electrical.status,'FAIL');assert.equal(job.electrical.firmware.status,'BLOCKED');assert.ok(job.verification.claims.some(c=>c.id==='electrical-gpio-exclusive'&&c.status==='FAIL'));const response=await f.get(`jobs/${job.id}/package`);assert.equal(response.status,200);const zip=unzipSync(new Uint8Array(await response.arrayBuffer()));assert.ok(zip['electrical/netlist.json']);assert.equal(zip['firmware/config.py'],undefined);assert.equal(zip['CAR-HARDWARE-REFERENCE.json'],undefined);assert.match(strFromU8(zip['BUILD-GUIDE.html']),/STOP: critical verification failed/);assert.match(strFromU8(zip['BUILD-GUIDE.html']),/type="checkbox" disabled/);assert.equal((await f.get(`jobs/${job.id}/files/firmware/config.py`)).status,404);}finally{await f.close();}
});

test('new model output for a powered toy cannot omit electrical and fall through to fixed reference firmware',async()=>{
  const reply=design();delete reply.electrical;const f=await fixture({reply});try{const response=await f.post('design',{request:'Synthetic powered fixture'});assert.equal(response.status,422);assert.match((await response.json()).error,/Powered toys require the structured electrical block/);assert.equal(f.calls.length,2);assert.equal(f.workers.length,0);}finally{await f.close();}
});

test('automatic workflow requests an electrical-only model repair and binds the repaired firmware to its new revision',async()=>{
  const reply=design();reply.electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP26';
  const f=await fixture({reply,repairReply:{updates:[],electrical:design().electrical}});try{
    const created=await f.post('projects',{request:'Synthetic automatic electrical repair fixture'});assert.equal(created.status,201);const project=await created.json();assert.equal((await f.post(`projects/${project.id}/run`,{})).status,202);
    let finished;for(let i=0;i<400;i++){finished=await(await f.get('projects/'+project.id)).json();if(finished.workflow.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(finished.workflow.status,'complete',finished.workflow.message);assert.equal(finished.workflow.attempts.length,2);assert.equal(finished.workflow.attempts[1].kind,'model-repair');assert.equal(f.workers.length,2);
    const [first,second]=await Promise.all(finished.workflow.attempts.map(async a=>(await f.get('jobs/'+a.jobId)).json()));
    assert.equal(first.electrical.firmware.status,'BLOCKED');assert.equal(second.electrical.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.notEqual(first.designHash,second.designHash);assert.equal(second.electrical.designHash,second.designHash);
    assert.deepEqual(first.spec.requirements,second.spec.requirements);assert.deepEqual(first.spec.physicsInputs,second.spec.physicsInputs);assert.deepEqual(first.spec.electrical.control,second.spec.electrical.control);assert.deepEqual(first.spec.parts,second.spec.parts);
    assert.ok(first.verification.claims.some(c=>c.id==='electrical-gpio-exclusive'&&c.status==='FAIL'));assert.ok(second.verification.claims.some(c=>c.id==='electrical-gpio-exclusive'&&c.status==='PASS'));assert.deepEqual(finished.workflow.attempts[1].unresolvedPriorFailures||[],[]);
    const patchCalls=f.calls.filter(c=>c.format.properties.updates);assert.equal(patchCalls.length,1);assert.ok(JSON.parse(patchCalls[0].messages[1].content).hostFailures.some(f=>f.includes('electrical-gpio-exclusive')));
    const response=await f.get(`jobs/${second.id}/package`);assert.equal(response.status,200);const zip=unzipSync(new Uint8Array(await response.arrayBuffer()));assert.ok(strFromU8(zip['firmware/config.py']).includes(second.designHash));assert.equal(JSON.parse(strFromU8(zip['electrical/netlist.json'])).designHash,second.designHash);assert.match(strFromU8(zip['firmware/config.py']),/LEFT_IN1_GP = 10\n/);
  }finally{await f.close();}
});

test('failed native execution and missing firmware source cannot expose partial electrical packages',async()=>{
  for(const options of [{workerFailure:true},{omitFirmware:true}]){const f=await fixture(options);try{const job=await f.build(await f.generate());assert.equal(job.status,'error');assert.equal(job.verification.overall,'FAILED');assert.equal((await f.get(`jobs/${job.id}/package`)).status,409);assert.equal((await f.get(`jobs/${job.id}/files/electrical/netlist.json`)).status,409);}finally{await f.close();}}
});

test('complete hash-bound code-2 CAD results retain failed checks while exposing diagnostic model and wiring artifacts',async()=>{
  const f=await fixture({workerResultMode:'check-fail'});try{
    const job=await f.build(await f.generate());assert.equal(job.status,'complete',job.error);assert.equal(job.execution.code,'COMPLETED_WITH_FAILED_CHECKS');assert.equal(job.cad.ok,false);assert.equal(job.verification.overall,'FAILED');assert.equal(job.verification.physical,'UNKNOWN');assert.equal(job.cad.parts.length,design().parts.length);
    const collision=job.verification.claims.find(c=>c.id==='kernel-assembly-overlap');assert.equal(collision.status,'FAIL');assert.equal(collision.critical,true);assert.match(collision.details,/Not a real engineering finding/);
    assert.equal(job.electrical.designHash,job.designHash);assert.equal(job.electrical.firmware.status,'GENERATED_OUTPUT_DISABLED');
    const response=await f.get(`jobs/${job.id}/package`);assert.equal(response.status,200);const zip=unzipSync(new Uint8Array(await response.arrayBuffer()));
    for(const name of ['cad/assembly.step','electrical/netlist.json','electrical/wiring.svg','electrical/connections.csv','BUILD-GUIDE.html']){assert.ok(zip[name],name);assert.equal(sha(zip[name]),job.artifactHashes[name],name);const direct=await f.get(`jobs/${job.id}/files/${name}`);assert.equal(direct.status,200,name);assert.equal(sha(Buffer.from(await direct.arrayBuffer())),job.artifactHashes[name]);}
    const verification=JSON.parse(strFromU8(zip['verification.json']));assert.equal(verification.overall,'FAILED');assert.equal(verification.claims.find(c=>c.id==='kernel-assembly-overlap').status,'FAIL');
    assert.match(strFromU8(zip['BUILD-GUIDE.html']),/STOP: critical verification failed/);assert.match(strFromU8(zip['BUILD-GUIDE.html']),/type="checkbox" disabled/);assert.match(strFromU8(zip['firmware/config.py']),/MOTOR_OUTPUT_ENABLED = False/);
  }finally{await f.close();}
});

test('code-2 admission never bypasses input lineage, artifact hashes, exact coverage or explicit failed-check evidence',async()=>{
  for(const workerResultMode of ['check-fail-wrong-input','check-fail-tampered','check-fail-missing-part','check-fail-duplicate-part','check-fail-ok-true','unexplained-code2']){
    const f=await fixture({workerResultMode});try{const job=await f.build(await f.generate());assert.equal(job.status,'error',workerResultMode);assert.equal(job.verification.overall,'FAILED');for(const suffix of ['package','files/electrical/wiring.svg','files/cad/assembly.step'])assert.equal((await f.get(`jobs/${job.id}/${suffix}`)).status,409,workerResultMode+' '+suffix);}
    finally{await f.close();}
  }
});

function powerDraft(){
  const draft=design();delete draft.electrical;
  Object.assign(draft.physicsInputs,Object.fromEntries(Object.entries({batteryVoltage:7.4,batteryMaxVoltage:8.4,motorVoltage:6}).map(([key,value])=>[key,{value,basis:'ASSUMED',source:'Synthetic inconsistent fixture, not physical evidence'}])));
  return draft;
}
function architecture(){
  return {questions:[],selectedCatalogIds:[],physicsInputs:{...design().physicsInputs,...Object.fromEntries(Object.entries({batteryVoltage:5,batteryMaxVoltage:5.5,motorVoltage:6}).map(([key,value])=>[key,{value,basis:'ASSUMED',source:'Synthetic conditional planning input, not physical evidence'}]))},assumptions:['Synthetic supplies only.'],unknowns:['Physical performance is untested.'],powerArchitecture:'Synthetic compatible motor supply; remaining circuit reviewed separately.'};
}
function fullPlanDesign(plan){const draft=design();draft.physicsInputs=structuredClone(plan.physicsInputs);return draft;}
const userData=call=>JSON.parse(call.messages.find(m=>m.role==='user').content);
async function onlyRun(f){const dir=path.join(f.root,'data','design-runs'),names=await readdir(dir);assert.equal(names.length,1);return JSON.parse(await readFile(path.join(dir,names[0]),'utf8'));}

test('missing wiring and known voltage contradictions reach architecture planning and the bound full-design retry together',async()=>{
  const first=powerDraft(),before=structuredClone(first),plan=architecture(),second=fullPlanDesign(plan);
  const f=await fixture({designReplies:[first,second],architectureReplies:[plan]});try{
    const response=await f.post('design',{request:'Synthetic powered feedback fixture'}),generated=await response.json();assert.equal(response.status,200,generated.error);assert.equal(f.calls.length,3);assert.equal(f.workers.length,0);
    const planning=userData(f.calls[1]);assert.deepEqual(planning.rejectedArchitecture.physicsInputs,before.physicsInputs);assert.equal(planning.preservedTargets.thresholdDbfs,-31);assert.match(planning.hostFailures.join('; '),/batteryVoltage 7.4 V exceeds motorVoltage 6 V/);assert.match(planning.hostFailures.join('; '),/batteryMaxVoltage 8.4 V exceeds motorVoltage 6 V/);
    const retry=userData(f.calls[2]);assert.equal(retry.repairErrors.length,1);assert.match(retry.repairErrors[0],/batteryVoltage 7.4 V exceeds motorVoltage 6 V/);assert.match(retry.repairErrors[0],/batteryMaxVoltage 8.4 V exceeds motorVoltage 6 V/);assert.match(retry.repairErrors[0],/Powered toys require the structured electrical block/);assert.deepEqual(retry.failedDraft,before);assert.deepEqual(first,before);assert.deepEqual(retry.acceptedArchitecturePlan,plan);
    assert.deepEqual(f.calls[2].format.properties.physicsInputs.const,plan.physicsInputs);assert.deepEqual(generated.spec.physicsInputs,plan.physicsInputs);assert.deepEqual(generated.spec.electrical,second.electrical);
    const record=await onlyRun(f),replan=record.architectureReplanning;assert.equal(record.attempts.length,2);assert.deepEqual(JSON.parse(record.attempts[0].content),before);assert.equal(record.designHash,generated.designHash);assert.equal(replan.status,'ACCEPTED');assert.equal(replan.modelDigest,'synthetic-model-digest');assert.equal(replan.physical,'UNKNOWN');assert.equal(replan.verificationEvidence,false);assert.equal(replan.attempts.length,1);assert.deepEqual(JSON.parse(replan.attempts[0].content),plan);assert.deepEqual(replan.plan,plan);assert.match(replan.planHash,/^[a-f0-9]{64}$/);assert.ok(replan.unknowns.length);
    const job=await f.build(generated);assert.equal(job.status,'complete',job.error);assert.deepEqual(f.workers[0].spec.physicsInputs,plan.physicsInputs);assert.equal(job.designHash,generated.designHash);assert.equal(job.electrical.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.equal(job.verification.physical,'UNKNOWN');
  }finally{await f.close();}
});

test('architecture questions return a clarification-only response without invented CAD or another full-design call',async()=>{
  const first=powerDraft(),plan={questions:[{id:'supply',question:'Which available supply must the design accommodate?',options:['First measured supply','Second measured supply']}],selectedCatalogIds:[],physicsInputs:{},assumptions:[],unknowns:['Supply selection is unanswered.'],powerArchitecture:'Awaiting essential supply selection.'};
  const f=await fixture({designReplies:[first],architectureReplies:[plan]});try{
    const response=await f.post('design',{request:'Synthetic clarification fixture'}),generated=await response.json();assert.equal(response.status,200,generated.error);assert.equal(f.calls.length,2);assert.equal(f.workers.length,0);assert.deepEqual(generated.spec.questions,plan.questions);assert.deepEqual(generated.spec.requirements,first.requirements);assert.deepEqual(generated.spec.parts,[]);assert.deepEqual(generated.spec.assembly,[]);assert.equal(generated.spec.electrical,undefined);assert.equal(generated.spec.physicsInputs,undefined);assert.equal(generated.verification.physical,'UNKNOWN');
    const record=await onlyRun(f);assert.equal(record.attempts.length,1);assert.equal(record.architectureReplanning.status,'QUESTIONS');assert.deepEqual(record.architectureReplanning.plan,plan);assert.equal(record.architectureReplanning.verificationEvidence,false);assert.equal(record.designHash,generated.designHash);
  }finally{await f.close();}
});

test('two failed architecture attempts stop before another full draft or CAD and retain both raw failures',async()=>{
  const first=powerDraft(),bad=architecture();bad.physicsInputs=structuredClone(first.physicsInputs);
  const f=await fixture({designReplies:[first],architectureReplies:[bad,bad]});try{
    const response=await f.post('design',{request:'Synthetic unresolved architecture fixture'});assert.equal(response.status,422);assert.match((await response.json()).error,/architecture replanning did not resolve/);assert.equal(f.calls.length,3);assert.equal(f.workers.length,0);assert.ok(f.calls.slice(1).every(c=>c.format.properties.powerArchitecture));assert.deepEqual(userData(f.calls[2]).previousPlan,bad);assert.match(userData(f.calls[2]).hostFailures.join('; '),/batteryMaxVoltage 8.4 V exceeds/);
    const record=await onlyRun(f),replan=record.architectureReplanning;assert.equal(record.attempts.length,1);assert.equal(record.designHash,null);assert.equal(replan.status,'FAILED');assert.equal(replan.plan,null);assert.equal(replan.planHash,null);assert.equal(replan.attempts.length,2);assert.equal(replan.verificationEvidence,false);for(const entry of replan.attempts){assert.deepEqual(JSON.parse(entry.content),bad);assert.match(entry.issues.join('; '),/batteryVoltage 7.4 V exceeds/);}
  }finally{await f.close();}
});

test('full-design output cannot silently change an accepted architecture even when the changed voltage is otherwise valid',async()=>{
  const first=powerDraft(),plan=architecture(),changed=fullPlanDesign(plan);changed.physicsInputs.batteryVoltage.value=4.9;
  const f=await fixture({designReplies:[first,changed],architectureReplies:[plan]});try{
    const response=await f.post('design',{request:'Synthetic post-plan drift fixture'});assert.equal(response.status,422);assert.match((await response.json()).error,/changed the model-selected architecture physicsInputs/);assert.equal(f.calls.length,3);assert.equal(f.workers.length,0);
    const record=await onlyRun(f);assert.equal(record.designHash,null);assert.equal(record.attempts.length,2);assert.equal(record.architectureReplanning.status,'ACCEPTED');assert.deepEqual(record.architectureReplanning.plan.physicsInputs,plan.physicsInputs);assert.deepEqual(JSON.parse(record.attempts[1].content).physicsInputs,changed.physicsInputs);
  }finally{await f.close();}
});

test('architecture decoder binding clones schema and restricts only model-selected inputs and native identities',()=>{
  const base=structuredClone(OLLAMA_DESIGN_SCHEMA),plan=architecture();plan.selectedCatalogIds=['native-b','native-a'];const before=structuredClone(plan),bound=architectureBoundSchema(base,plan);
  assert.deepEqual(base,OLLAMA_DESIGN_SCHEMA);assert.deepEqual(plan,before);assert.notEqual(bound,base);assert.deepEqual(bound.properties.physicsInputs,{const:plan.physicsInputs});assert.ok(bound.required.includes('physicsInputs'));assert.deepEqual(bound.properties.parts.items.properties.shape.anyOf.find(s=>s.properties.type.enum.includes('catalog')).properties.catalogId.enum,plan.selectedCatalogIds);
  bound.properties.physicsInputs.const.batteryVoltage.value=2;assert.equal(plan.physicsInputs.batteryVoltage.value,5);
  const primitiveOnly=architectureBoundSchema(base,architecture());assert.ok(primitiveOnly.properties.parts.items.properties.shape.anyOf.every(s=>!s.properties.type.enum.includes('catalog')));assert.ok(primitiveOnly.properties.parts.items.properties.shape.anyOf.some(s=>s.properties.type.enum.includes('box')));assert.deepEqual(architectureBoundSchema(base,null),base);
});

test('architecture host binding rejects altered numeric provenance and exact source-set drift but allows key order and repeated instances',()=>{
  const plan=architecture();plan.selectedCatalogIds=['native-b','native-a'];const spec={physicsInputs:structuredClone(plan.physicsInputs),parts:[{shape:{type:'catalog',catalogId:'native-a'}},{shape:{type:'catalog',catalogId:'native-b'}},{shape:{type:'catalog',catalogId:'native-a'}},{shape:{type:'box',size:[1,1,1]}}]};
  spec.physicsInputs=Object.fromEntries(Object.entries(spec.physicsInputs).reverse().map(([key,v])=>[key,{source:v.source,basis:v.basis,value:v.value}]));assert.deepEqual(architectureBindingIssues(spec,plan),[]);assert.deepEqual(architectureBindingIssues(spec,null),[]);
  for(const mutate of [s=>s.physicsInputs.batteryVoltage.value=4.9,s=>s.physicsInputs.batteryVoltage.basis='MEASURED',s=>s.physicsInputs.batteryVoltage.source='Invented provenance',s=>delete s.physicsInputs.thresholdDbfs,s=>delete s.physicsInputs]){const changed=structuredClone(spec);mutate(changed);assert.match(architectureBindingIssues(changed,plan).join('; '),/physicsInputs/);}
  for(const mutate of [s=>s.parts=s.parts.filter(p=>p.shape.catalogId!=='native-b'),s=>s.parts.push({shape:{type:'catalog',catalogId:'undeclared'}}),s=>s.parts[1].shape.catalogId='replacement']){const changed=structuredClone(spec);mutate(changed);assert.match(architectureBindingIssues(changed,plan).join('; '),/catalog selections differ/);}
});
