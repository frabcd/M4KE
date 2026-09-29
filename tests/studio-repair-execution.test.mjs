import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStudioService} from '../server/studio-service.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const spec=width=>({schemaVersion:1,title:'Repair transport fixture',description:'Synthetic workflow test only',units:'mm',requirements:[{id:'R1',text:'Retain the same component during repair'}],assumptions:[],unknowns:['Physical operation is untested'],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[width,30,4]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Measure the component.'],checks:['Compare the dimensions.']}]});
const repairPatch=()=>({updates:[{partId:'body',changes:{shape:{type:'box',size:[42,30,4]}}}]});

// Only orchestration is exercised: model replies and worker bytes are synthetic.
// No local model, native kernel, source library, printer or real project is used.
async function fixture({corruptRepairArtifact=false,transportError=false,initialTimeouts=0}={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-repair-execution-')),designCalls=[],workerBudgets=[];
  let workerCalls=0,inferenceTimeout;
  await mkdir(path.join(root,'cad'),{recursive:true});
  for(const name of ['worker.py','requirements.txt'])await writeFile(path.join(root,'cad',name),'Synthetic fixture; never executed');
  const python=process.env.M4KE_CAD_PYTHON||path.join(root,'.venv-cad',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!process.env.M4KE_CAD_PYTHON){await mkdir(path.dirname(python),{recursive:true});await writeFile(python,'Synthetic injected runner');}
  const handle=createStudioService({root,
    getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'fixture-qwen'}),
    getModels:async()=>[{name:'fixture-qwen',digest:'fixture-model-digest'}],
    localFetch:async(_endpoint,_route,options,timeoutMs)=>{
      const payload=JSON.parse(options.body);
      if(payload.format.properties.checks)return {message:{content:JSON.stringify({checks:[],uncovered:[]})}};
      if(payload.format.properties.concerns)return {message:{content:JSON.stringify({summary:'Synthetic advisory; no physical evidence.',concerns:[]})}};
      designCalls.push(payload);
      inferenceTimeout=timeoutMs;
      if(transportError)throw new Error('Synthetic local inference connection failure',{cause:{code:'ECONNRESET'}});
      return {message:{content:JSON.stringify(payload.format.properties.updates?repairPatch():spec(40))},eval_count:10};
    },
    body:async req=>{let bytes='';for await(const chunk of req)bytes+=chunk;return JSON.parse(bytes);},
    json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));},
    runProcess:async(_exe,args,limits)=>{
      if(args[0]==='-c')return {code:0,stdout:JSON.stringify({version:'SYNTHETIC-NOT-CAD'}),stderr:''};
      if(path.basename(args[0])==='illustrate.py')return {code:1,stdout:'',stderr:'Synthetic illustration unavailable'};
      workerCalls++;workerBudgets.push(limits.timeout);
      if(workerCalls<=initialTimeouts)throw Object.assign(new Error('Synthetic timeout, geometry not evaluated'),{code:'PROCESS_TIMEOUT',status:504,stdout:'retained progress',stderr:'retained phase',elapsedMs:20,lastDiagnostic:{phase:'assembly',operation:'readback',status:'RUNNING',verificationEvidence:false}});
      const input=args[args.indexOf('--input')+1],output=args[args.indexOf('--output')+1],inputBytes=await readFile(input);
      await mkdir(path.join(output,'parts'),{recursive:true});
      if(workerCalls===1){
        await writeFile(path.join(output,'result.json'),JSON.stringify({parts:[],errors:['Synthetic initial worker rejection']}));
        return {code:1,stdout:'',stderr:'Synthetic initial worker rejection'};
      }
      const stl=Buffer.from('SYNTHETIC STL'),step=Buffer.from('SYNTHETIC STEP'),assembly=Buffer.from('SYNTHETIC ASSEMBLY');
      await writeFile(path.join(output,'parts','body.stl'),corruptRepairArtifact?Buffer.from('CHANGED AFTER HASH'):stl);
      await writeFile(path.join(output,'parts','body.step'),step);
      await writeFile(path.join(output,'assembly.step'),assembly);
      await writeFile(path.join(output,'result.json'),JSON.stringify({inputSha256:sha(inputBytes),assemblyStep:'assembly.step',assemblySha256:sha(assembly),parts:[{id:'body',valid:true,solidCount:1,volumeMm3:5040,stl:'parts/body.stl',step:'parts/body.step',sha256:{stl:sha(stl),step:sha(step)}}],checks:[]}));
      return {code:0,stdout:'Synthetic successful transport',stderr:''};
    },
  });
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/studio/`;
  // Ephemeral fixture ports can be reused; never reuse a pooled connection from
  // the previous closed test server. All transport/evidence assertions stay intact.
  const request=(route,data)=>new Promise((resolve,reject)=>{
    const req=http.request(base+route,{method:data===undefined?'GET':'POST',agent:false,timeout:30000,headers:{'content-type':'application/json'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Synthetic fixture transport timeout')));req.end(data===undefined?undefined:JSON.stringify(data));
  });
  const get=async route=>(await request(route)).json();
  const post=(route,data)=>request(route,data);
  return {root,designCalls,workerBudgets,get,post,workerCalls:()=>workerCalls,inferenceTimeout:()=>inferenceTimeout,
    run:async()=>{
      const project=await(await post('projects',{request:'Generate a fresh fixture component'})).json();
      assert.equal((await post(`projects/${project.id}/run`,{})).status,202);
      for(let i=0;i<300;i++){
        const current=await get('projects/'+project.id);
        if(current.workflow.status!=='running')return current;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error('Synthetic workflow did not finish');
    },
    close:async()=>{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});},
  };
}

test('automatic repair clears a prior build-execution failure only after successful hash-readback',async()=>{
  const f=await fixture();
  try{
    const project=await f.run();
    assert.equal(project.workflow.status,'complete',project.workflow.message);
    assert.equal(project.workflow.attempts.length,2);
    assert.equal(f.workerCalls(),2);
    assert.equal(f.designCalls.length,2);
    const [first,second]=await Promise.all(project.workflow.attempts.map(attempt=>f.get('jobs/'+attempt.jobId)));
    assert.equal(first.status,'error');assert.equal(second.status,'complete');
    assert.equal(first.verification.claims.find(c=>c.id==='build-execution').status,'FAIL');
    assert.equal(second.verification.claims.find(c=>c.id==='build-execution').status,'PASS');
    assert.equal(second.verification.claims.find(c=>c.id==='build-execution').critical,true);
    assert.notEqual(first.designHash,second.designHash);
    assert.deepEqual(first.spec.requirements,second.spec.requirements);
    const repairInput=JSON.parse(f.designCalls[1].messages[1].content);
    assert.deepEqual(repairInput.previousSpec,first.spec);
    assert(repairInput.hostFailures.some(error=>error.includes('build-execution')));
    assert.deepEqual(repairInput.validationErrors,[]);
    assert(!f.designCalls[0].format.properties.updates);assert(f.designCalls[1].format.properties.updates);
    const repairRun=JSON.parse(await readFile(path.join(f.root,'data','design-runs',second.provenance.runId+'.json'),'utf8'));
    assert.equal(repairRun.generationMode,'model-geometry-patch');assert.equal(repairRun.parentDesignHash,first.designHash);
    assert.equal(repairRun.designHash,second.designHash);assert.deepEqual(JSON.parse(repairRun.attempts[0].content),repairPatch());
    for(const job of [first,second]){
      assert.equal(job.provenance.origin,'local-qwen');assert.equal(job.provenance.modelGenerationVerified,true);
      assert.equal(job.verification.physical,'UNKNOWN');
      const stored=JSON.parse(await readFile(path.join(f.root,'data','studio-jobs',job.id,'job.json'),'utf8'));
      assert.equal(stored.designHash,job.designHash);
    }
    assert.notEqual(second.verification.overall,'VERIFIED_WITHIN_SCOPE');
    assert(!project.workflow.attempts[1].unresolvedPriorFailures?.length);
  }finally{await f.close();}
});

test('successful worker exit cannot clear repair when an artifact hash is wrong',async()=>{
  const f=await fixture({corruptRepairArtifact:true});
  try{
    const project=await f.run();
    assert.equal(project.workflow.status,'error');
    assert.match(project.workflow.message,/Bounded repair/);
    assert.equal(project.workflow.attempts.length,2);assert.equal(f.workerCalls(),2);assert.equal(f.designCalls.length,2);
    const job=await f.get('jobs/'+project.jobId);
    assert.equal(job.status,'error');assert.match(job.error,/hash missing or mismatched/);
    assert.equal(job.verification.claims.find(c=>c.id==='build-execution').status,'FAIL');
    assert(project.workflow.attempts[1].criticalFailures.includes('build-execution'));
    assert(project.workflow.attempts[1].unresolvedPriorFailures.includes('build-execution'));
    const storedProject=JSON.parse(await readFile(path.join(f.root,'data','studio-projects',project.id+'.json'),'utf8'));
    assert.deepEqual(storedProject.workflow.attempts[1].unresolvedPriorFailures,project.workflow.attempts[1].unresolvedPriorFailures);
    assert.equal(job.verification.physical,'UNKNOWN');
  }finally{await f.close();}
});

test('building a saved refinement retains parent lineage without crediting a freshly generated toy',async()=>{
  const f=await fixture();
  try{
    const project=await f.run(),job=await f.get('jobs/'+project.jobId);
    const file=path.join(f.root,'data','design-runs',job.provenance.runId+'.json'),record=JSON.parse(await readFile(file,'utf8'));
    record.generationMode='model-user-refinement';record.parentDesignHash='a'.repeat(64);await writeFile(file,JSON.stringify(record));
    const response=await f.post('build',{spec:job.spec,runId:record.runId});assert.equal(response.status,202);const rebuilt=await response.json();
    assert.equal(rebuilt.provenance.origin,'local-qwen-refinement');assert.equal(rebuilt.provenance.modelGenerationVerified,false);assert.equal(rebuilt.provenance.modelRefinementVerified,true);assert.equal(rebuilt.provenance.parentDesignHash,record.parentDesignHash);
    for(let i=0;i<300;i++){if((await f.get('jobs/'+rebuilt.id)).status!=='queued'&&(await f.get('jobs/'+rebuilt.id)).status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  }finally{await f.close();}
});

test('design transport failure retains diagnostic provenance and inference config without a model response or CAD',async()=>{
  const f=await fixture({transportError:true});
  try{
    const response=await f.post('design',{request:'Generate a fresh transport-failure fixture',answers:[]});
    assert.equal(response.status,502);
    const result=await response.json();
    assert.match(result.error,/retained diagnostic run/);
    assert.match(result.error,/Synthetic local inference connection failure/);
    assert.equal(result.spec,undefined);
    assert.equal(f.designCalls.length,1);assert.equal(f.workerCalls(),0);
    const folder=path.join(f.root,'data','design-runs'),files=await readdir(folder);
    assert.equal(files.length,1);
    const run=JSON.parse(await readFile(path.join(folder,files[0]),'utf8'));
    assert(result.error.includes(run.runId));assert.equal(files[0],run.runId+'.json');
    assert.equal(run.model,'fixture-qwen');assert.equal(run.modelDigest,'fixture-model-digest');
    assert.equal(run.designHash,null);assert.equal(run.attempts.length,1);
    assert.equal(run.attempts[0].content,null);
    assert.equal(run.attempts[0].error,'Synthetic local inference connection failure');
    assert.equal(run.attempts[0].code,'ECONNRESET');
    assert(run.errors.includes(run.attempts[0].error));
    assert.deepEqual(run.inferenceConfig,{think:f.designCalls[0].think,...f.designCalls[0].options,timeoutMs:f.inferenceTimeout()});
    assert(Number.isFinite(run.inferenceConfig.timeoutMs)&&run.inferenceConfig.timeoutMs>0);
    await assert.rejects(readdir(path.join(f.root,'data','studio-jobs')),{code:'ENOENT'});
  }finally{await f.close();}
});


test('native timeout retries exactly the same design once and preserves diagnostics without Qwen geometry repair',async()=>{
 const f=await fixture({initialTimeouts:1});
 try{
  const p=await f.run();assert.equal(p.workflow.status,'complete',p.workflow.message);
  assert.equal(f.workerCalls(),2);assert.equal(f.designCalls.length,1);
  const [a,b]=p.workflow.attempts;assert.equal(a.designHash,b.designHash);assert.deepEqual(f.workerBudgets,[240000,600000]);assert.equal(b.kind,'infrastructure-retry');assert.equal(b.retryOf,a.jobId);
  const old=await f.get('jobs/'+a.jobId);assert.equal(old.execution.kind,'infrastructure');assert.equal(old.execution.code,'PROCESS_TIMEOUT');
  assert.match(await readFile(path.join(f.root,'data/studio-jobs',a.jobId,'cad-log.txt'),'utf8'),/retained progress/);
  const diagnostic=JSON.parse(await readFile(path.join(f.root,'data/studio-jobs',a.jobId,'EXECUTION-DIAGNOSTICS.json'),'utf8'));assert.equal(diagnostic.lastDiagnostic.operation,'readback');
 }finally{await f.close();}
});
test('two native timeouts stop infrastructure loop without model edits or infinite retries',async()=>{
 const f=await fixture({initialTimeouts:2});
 try{
  const p=await f.run();assert.equal(p.workflow.status,'error');assert.equal(p.workflow.stage,'infrastructure');
  assert.equal(f.workerCalls(),2);assert.equal(f.designCalls.length,1);assert.equal(p.workflow.attempts.length,2);
  assert.equal(p.workflow.attempts[0].designHash,p.workflow.attempts[1].designHash);
 }finally{await f.close();}
});
