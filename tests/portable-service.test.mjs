import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,cp} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {createStudioService} from '../server/studio-service.mjs';
import {compileDesignKit,PORTABLE_KIT_ID} from '../engineering/kit-registry.mjs';
import {designHash} from '../server/studio-contract.mjs';
import {OLLAMA_DESIGN_SCHEMA} from '../server/studio-schema.mjs';

const projectRoot=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
// All native data below is an explicitly synthetic transport fixture. No CadQuery,
// supplier, DGX, printer, physical measurement or production job is used or modified.
async function fixture(options={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-portable-service-')),calls=[],workerCalls=[];
  const catalog=JSON.parse(await readFile(path.join(projectRoot,'catalog','manifest.json'),'utf8'));
  await mkdir(path.join(root,'catalog','models'),{recursive:true});const syntheticInventory=[];
  for(const c of catalog.components.filter(c=>c.geometry?.step)){
    const bytes=Buffer.from('SYNTHETIC SOURCE STEP TRANSPORT FIXTURE '+c.id),old=c.geometry.sha256;
    c.geometry.step='models/'+c.id+'.step';c.geometry.sha256=sha(bytes);
    for(const i of c.interfaces||[])if(i.sourceSha256===old){
      // Preserve compiler-facing dimensions, but never carry real native-face
      // evidence across synthetic STEP bytes. The injected worker is transport
      // only; a real native mate tool must reject this empty surface inventory.
      i.sourceSha256=c.geometry.sha256;i.sourceArtifact=c.geometry.step;
      i.evidenceArtifact='interface-surface-inventory.json';i.faceIndices=[];
      i.verification='SYNTHETIC_TRANSPORT_ONLY';i.physicalFit='UNKNOWN';
    }
    syntheticInventory.push({path:c.geometry.step,sha256:c.geometry.sha256,coordinateFrame:'SYNTHETIC_TRANSPORT_FIXTURE_NOT_NATIVE',cylinders:[],verification:'SYNTHETIC_TRANSPORT_ONLY'});
    await writeFile(path.join(root,'catalog',c.geometry.step),bytes);
  }
  const inventoryBytes=Buffer.from(JSON.stringify(syntheticInventory));
  for(const c of catalog.components)for(const i of c.interfaces||[])if(i.verification==='SYNTHETIC_TRANSPORT_ONLY')i.evidenceSha256=sha(inventoryBytes);
  await writeFile(path.join(root,'catalog','interface-surface-inventory.json'),inventoryBytes);
  await writeFile(path.join(root,'catalog','manifest.json'),JSON.stringify(catalog));
  // Fixtures need one guide, not historical archives and nested npm installs.
  for(const dir of ['cad','firmware','components'])await cp(path.join(projectRoot,dir),path.join(root,dir),{recursive:true});
  await mkdir(path.join(root,'docs'),{recursive:true});
  await cp(path.join(projectRoot,'docs/car-power-and-wiring.md'),path.join(root,'docs/car-power-and-wiring.md'));
  const python=path.join(root,'.venv-cad',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  await mkdir(path.dirname(python),{recursive:true});await writeFile(python,'fixture runner is injected; never executed');
  const handle=createStudioService({root,
    getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'fixture-qwen'}),getModels:async()=>[{name:'fixture-qwen',digest:'fixture-only'}],
    localFetch:async(...args)=>{calls.push(JSON.parse(args[2].body));return {message:{content:JSON.stringify(options.modelReply||{summary:'Fixture advisory only; no physical validation.',concerns:[{requirementId:'R1',severity:'major',problem:'Physical observation is missing.',suggestedTest:'Measure the assembled prototype.',missingEvidence:['physical observation']}] })},eval_count:10};},
    body:async req=>{let b='';for await(const c of req)b+=c;return JSON.parse(b);},
    json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},
    runProcess:async(_exe,args)=>{
      if(args[0]==='-c')return {code:0,stdout:JSON.stringify({version:'FIXTURE-NOT-CAD'}),stderr:''};
      if(path.basename(args[0])==='illustrate.py')return {code:1,stdout:'',stderr:'No fixture illustrations; no image substitute.'};
      workerCalls.push(args);const input=args[args.indexOf('--input')+1],output=args[args.indexOf('--output')+1],bytes=await readFile(input),spec=JSON.parse(bytes);
      await mkdir(path.join(output,'parts'),{recursive:true});
      if(options.workerFail){await writeFile(path.join(output,'result.json'),JSON.stringify({errors:['synthetic controlled worker rejection'],parts:[]}));return {code:1,stdout:'fixture rejected',stderr:'synthetic controlled worker rejection'};}
      const parts=[];
      for(const p of spec.parts){const stl='parts/'+p.id+'.stl',step='parts/'+p.id+'.step',stlBytes=Buffer.from('SYNTHETIC STL '+p.id),stepBytes=Buffer.from('SYNTHETIC STEP '+p.id);await writeFile(path.join(output,stl),stlBytes);await writeFile(path.join(output,step),stepBytes);parts.push({id:p.id,name:p.name,kind:p.kind,stl,step,valid:true,solidCount:1,volumeMm3:1,sha256:{stl:sha(stlBytes),step:sha(stepBytes)}});}
      const assembly=Buffer.from('SYNTHETIC ASSEMBLY');await writeFile(path.join(output,'assembly.step'),assembly);
      await writeFile(path.join(output,'result.json'),JSON.stringify({inputSha256:sha(bytes),parts,assemblyStep:'assembly.step',assemblySha256:sha(assembly),checks:options.checkFail?[{id:'fixture-controlled-failure',status:'FAIL',label:'Fixture failure',details:'Synthetic failure retained'}]:[]}));
      return {code:0,stdout:'Synthetic transport fixture only',stderr:''};
    },
  });
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  const get=route=>fetch(url+'/api/studio/'+route);
  const post=(route,data)=>fetch(url+'/api/studio/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  const wait=async route=>{for(let n=0;n<300;n++){const value=await(await get(route)).json(),status=value.workflow?.status||value.status;if(!['running','queued'].includes(status)){await new Promise(r=>setTimeout(r,10));return value;}await new Promise(r=>setTimeout(r,10));}throw new Error('Fixture timeout');};
  const run=async(parameters={})=>{const project=await(await post('projects',{request:'Explicit portable source-kit test'})).json();assert.equal((await post('projects/'+project.id+'/run',{kitId:PORTABLE_KIT_ID,parameters})).status,202);const done=await wait('projects/'+project.id);return {project:done,job:done.jobId?await(await get('jobs/'+done.jobId)).json():null};};
  return {root,catalog,calls,workerCalls,get,post,wait,run,close:async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}

test('catalog exposes portable separately and fixed dimensions without changing the old route or general schema',async()=>{
 const f=await fixture();try{const c=await(await f.get('catalog')).json();assert.deepEqual(c.kits.map(k=>k.id),['sound-car-v1',PORTABLE_KIT_ID]);assert.equal(c.kits[1].parameters.lengthMm.minimum,180);assert.equal(c.kits[1].parameters.lengthMm.maximum,180);assert.equal(c.kits[1].parameters.widthMm.minimum,100);assert.equal(c.kits[1].manufacturingRelease,false);assert.equal(c.kits[0].parameters.lengthMm.minimum,150);assert.equal(OLLAMA_DESIGN_SCHEMA.properties.parts.maxItems,24);assert.equal(f.workerCalls.length,0);}finally{await f.close();}
});

test('portable automatic route freezes exact revision and ships grouped purchases, R7 and locked 5V guide with package hashes',async()=>{
 const f=await fixture();try{
  const chooserParameters={lengthMm:180,widthMm:100,targetSpeedMS:.5,thresholdDbfs:-25};const {project,job}=await f.run(chooserParameters);assert.equal(project.workflow.status,'complete',project.workflow.message);assert.equal(project.workflow.repairLimit,0);assert.equal(job.status,'complete',job.error);assert.equal(job.spec.parts.length,48);assert.equal(job.spec.parts.filter(p=>p.kind==='printed').length,22);assert.equal(job.designHash,designHash(job.spec));assert.equal(job.kitId,PORTABLE_KIT_ID);
  assert.deepEqual(job.portableRevision,compileDesignKit(PORTABLE_KIT_ID,chooserParameters,f.catalog).portableRevision);assert.equal(job.portableRevision.nativeStatus,'NOT_RUN');assert.equal(job.verification.physical,'UNKNOWN');assert.equal(f.workerCalls.length,1);assert.equal(f.calls.length,1);assert(!f.calls.some(c=>c.format===OLLAMA_DESIGN_SCHEMA));
  const artifact=async name=>{const r=await f.get(`jobs/${job.id}/files/${name}`);assert.equal(r.status,200,name);return Buffer.from(await r.arrayBuffer());};
  const revision=await artifact('PORTABLE-REVISION.json');assert.equal(sha(revision),job.provenance.portableRevisionSha256);assert.deepEqual(JSON.parse(revision),job.portableRevision);
  const h=JSON.parse(await artifact('KIT-HARDWARE-REFERENCE.json')),groups=JSON.parse(await artifact('PORTABLE-COMPONENT-GROUPS.json'));assert.equal(h.designHash,job.designHash);assert.equal(h.components.length,18);assert.equal(h.printedParts.length,22);assert.equal(groups.rows.length,18);assert.equal(groups.rows.find(c=>c.componentId==='power-cells').quantity,4);assert.equal(groups.rows.find(c=>c.componentId==='power-holder').quantity,1);assert.equal(groups.rows.find(c=>c.componentId==='power-stop').quantity,1);assert.deepEqual(groups.rows.find(c=>c.componentId==='power-stop').keepoutPartIds,['stop_lever_motion']);assert.equal(groups.rows.find(c=>c.componentId==='pololu-lp6v-1098').quantity,2);assert.equal(groups.rows.find(c=>c.componentId==='adafruit-max4466-1063').geometryRepresentation,'SOURCE_DERIVED_PCB_OUTLINE_ONLY');
  assert.equal((await artifact('PURCHASE-BOM.csv')).toString().split('\r\n').length,19);assert.equal((await artifact('GEOMETRY-INVENTORY.csv')).toString().split('\r\n').length,49);
  const plan=JSON.parse(await artifact('VERIFICATION-PLAN.json'));assert.equal(plan.kitPlan.kitId,PORTABLE_KIT_ID);assert.equal(plan.kitPlan.revisionHash,job.designHash);assert.equal(plan.kitPlan.requirements.find(r=>r.requirementId==='R7').physicalAcceptance.length,5);
  const guide=(await artifact('PORTABLE-BUILD-GUIDE.md')).toString();assert.match(guide,/ASSUMED 0.25 A/);assert.match(guide,/4.25 W/);assert.match(guide,/MOTOR_OUTPUT_ENABLED = False/);assert.match(guide,/R7-physical-5/);assert.equal(guide,(await artifact('firmware/POWER-AND-WIRING.md')).toString());assert.match((await artifact('firmware/config.py')).toString(),/^MOTOR_OUTPUT_ENABLED = False$/m);assert.match(job.firmware.notes,/0.25 A/);assert.doesNotMatch(job.firmware.notes,/requires a new design revision/);const firmwareReadme=(await artifact('firmware/README.md')).toString();assert.doesNotMatch(firmwareReadme,/not placed in the current CAD|future design revision/);assert.match(firmwareReadme,/This IS the separate nominal regulated-5V revision/);
  const response=await f.get('jobs/'+job.id+'/package');assert.equal(response.status,200);const zip=unzipSync(new Uint8Array(await response.arrayBuffer())),manifest=JSON.parse(Buffer.from(zip['ARTIFACT-HASHES.json']));for(const [name,hash]of Object.entries(manifest))assert.equal(sha(zip[name]),hash,name);for(const name of ['PORTABLE-REVISION.json','PURCHASE-BOM.csv','GEOMETRY-INVENTORY.csv','PORTABLE-BUILD-GUIDE.md'])assert(manifest[name]);
  const frozenInventory=JSON.parse(Buffer.from(zip['catalog/interface-surface-inventory.json']));assert(frozenInventory.every(r=>r.verification==='SYNTHETIC_TRANSPORT_ONLY'&&r.cylinders.length===0),'Transport fixture must not inherit real native surface claims');
 }finally{await f.close();}
});

test('48-part worker rejection retains diagnostics and stops without invoking 24-part Qwen repair',async()=>{
 const f=await fixture({workerFail:true});try{const {project,job}=await f.run();assert.equal(project.workflow.status,'error');assert.equal(project.workflow.attempts.length,1);assert.equal(project.workflow.repairLimit,0);assert.match(project.workflow.message,/24-part Qwen/);assert.equal(job.status,'error');assert.equal(job.spec.parts.length,48);assert.equal(f.workerCalls.length,1);assert.equal(f.calls.length,0);assert.equal((await f.get('jobs/'+job.id+'/package')).status,409);const diag=await f.get('jobs/'+job.id+'/diagnostics');assert.equal(diag.status,200);const zip=unzipSync(new Uint8Array(await diag.arrayBuffer()));assert(zip['cad-log.txt']);assert.equal(JSON.parse(Buffer.from(zip['PORTABLE-REVISION.json'])).designHash,job.designHash);}finally{await f.close();}
});

test('a completed native fixture with critical FAIL stops the portable workflow and keeps its failed evidence',async()=>{
 const f=await fixture({checkFail:true});try{const {project,job}=await f.run();assert.equal(project.workflow.status,'error');assert.equal(job.status,'complete');assert.equal(job.verification.overall,'FAILED');assert.equal(project.workflow.attempts.length,1);assert.equal(job.spec.parts.length,48);assert.equal(f.calls.length,1);assert(f.calls[0].format.properties.concerns);assert(project.workflow.attempts[0].criticalFailures.includes('kernel-fixture-controlled-failure'));}finally{await f.close();}
});

test('manual portable rebuild requires exact stored parent lineage and rejects edits, imported metadata and missing parent',async()=>{
 const f=await fixture();try{
  const {job}=await f.run(),parentBytes=await readFile(path.join(f.root,'data','studio-jobs',job.id,'job.json'));
  let r=await f.post('build',{spec:job.spec});assert.equal(r.status,409);assert.match((await r.json()).error,/unqualified/);
  r=await f.post('build',{spec:job.spec,portableRevision:job.portableRevision});assert.equal(r.status,409);
  const changed=structuredClone(job.spec);changed.parts.find(p=>p.id==='power_tray').position[0]+=1;
  r=await f.post('build',{spec:changed,sourceParentJobId:job.id});assert.equal(r.status,409);assert.match((await r.json()).error,/hash differs/);
  r=await f.post('build',{spec:job.spec,sourceParentJobId:job.id});assert.equal(r.status,202,await r.clone().text());const queued=await r.json(),rebuilt=await f.wait('jobs/'+queued.id);assert.equal(rebuilt.status,'complete',rebuilt.error);assert.equal(rebuilt.provenance.sourceParentJobId,job.id);assert.equal(rebuilt.provenance.sourceParentDesignHash,job.designHash);assert.deepEqual(rebuilt.portableRevision,job.portableRevision);assert.deepEqual(await readFile(path.join(f.root,'data','studio-jobs',job.id,'job.json')),parentBytes);assert.equal(f.workerCalls.length,2);
 }finally{await f.close();}
});

test('generic model output cannot exploit the host 48-part grammar to bypass its 24-part schema',async()=>{
 const catalog=JSON.parse(await readFile(path.join(projectRoot,'catalog','manifest.json'),'utf8')),reply=compileDesignKit(PORTABLE_KIT_ID,{},catalog).spec;
 const f=await fixture({modelReply:reply});try{const r=await f.post('design',{request:'general toy'});assert.equal(r.status,422);assert.match((await r.json()).error,/24 parts/);assert.equal(f.calls.length,2);assert(f.calls.every(call=>call.format.properties.parts.maxItems===24));assert.equal(f.workerCalls.length,0);}finally{await f.close();}
});
