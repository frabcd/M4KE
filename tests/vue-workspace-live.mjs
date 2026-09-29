/** Opt-in REAL Qwen/native-CAD acceptance. Run only from a fresh isolated DGX checkout.
 * M4KE_LIVE_ALLOW_ISOLATED=1 M4KE_LIVE_ISOLATED_ROOT=/.../m4ke-vue-acceptance-...
 * M4KE_LIVE_URL=http://127.0.0.1:4293 QWEN_MODEL=... OLLAMA_URL=http://127.0.0.1:11434
 * M4KE_CAD_PYTHON=/.../.venv-cad/bin/python node tests/vue-workspace-live.mjs
 * Starts and stops its own server; never targets an existing server or project.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {unzipSync} from 'fflate';
import {designHash} from '../server/studio-contract.mjs';

const urlText=process.env.M4KE_LIVE_URL;
if(process.env.M4KE_LIVE_ALLOW_ISOLATED!=='1'||!urlText||!process.env.M4KE_LIVE_ISOLATED_ROOT)throw Error('Explicit isolated opt-in, root and URL are required; no default production target.');
const base=new URL(urlText);
assert.equal(base.protocol,'http:');assert.equal(base.hostname,'127.0.0.1');
assert(!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname==='/');
assert(/^[0-9]+$/.test(base.port)&&Number(base.port)>=1024&&!['4173','4174','11434'].includes(base.port),'Use a dedicated non-production loopback port.');
assert.equal(process.platform,'linux','The live harness runs on the isolated DGX, not through a production tunnel.');
const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
assert.equal(await realpath(process.env.M4KE_LIVE_ISOLATED_ROOT),root);
assert.equal(await realpath(process.cwd()),root);
assert(path.basename(root).startsWith('m4ke-vue-acceptance-'),'Isolated checkout basename must start m4ke-vue-acceptance-.');
const dataDir=path.join(root,'data');
try{assert(!(await lstat(dataDir)).isSymbolicLink(),'Never use a production data symlink.');}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['studio-projects','studio-jobs','design-runs']){
  try{const target=path.join(dataDir,name);assert(!(await lstat(target)).isSymbolicLink());assert.equal((await readdir(target)).length,0,`${name} must be fresh; never resume or replace prior evidence.`);}catch(e){if(e.code!=='ENOENT')throw e;}
}
assert(process.env.QWEN_MODEL&&!/cloud/i.test(process.env.QWEN_MODEL),'Set the exact installed local Qwen tag.');
const ollama=new URL(process.env.OLLAMA_URL||'');assert.equal(ollama.hostname,'127.0.0.1');assert.equal(ollama.protocol,'http:');
assert(!ollama.username&&!ollama.password&&!ollama.search&&!ollama.hash&&ollama.pathname==='/');
await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(Number(base.port),'127.0.0.1',()=>probe.close(resolve));});
await mkdir(path.join(root,'test-results'),{recursive:true});
const out=await mkdtemp(path.join(root,'test-results','vue-dgx-'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={schema:'m4ke-vue-live-acceptance-1',startedAt:new Date().toISOString(),scope:'Fresh real-Qwen two-piece tabletop toy; not the car benchmark, not physical validation.',root,base:base.origin,model:process.env.QWEN_MODEL,output:out,physical:'UNKNOWN',checks:[],nativeRuns:[],status:'RUNNING'};
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
const artifact=(name,data)=>writeFile(path.join(out,name),typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data,null,2));
async function check(name,fn){const details=await fn();report.checks.push({name,status:'PASS',details:details??null,at:new Date().toISOString()});await save();console.log(JSON.stringify({check:name,status:'PASS',at:new Date().toISOString()}));return details;}
function request(route,body,method=body===undefined?'GET':'POST',raw=false){
  return new Promise((resolve,reject)=>{
    const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
    const req=http.request(new URL(route,base),{method,headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}},res=>{
      const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>64*1024*1024){res.destroy(Error('Live response exceeds 64 MiB limit.'));return;}chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>{try{const bytes=Buffer.concat(chunks),value=raw?bytes:JSON.parse(bytes.toString('utf8'));if(res.statusCode<200||res.statusCode>=300)throw Object.assign(Error(`${method} ${route}: HTTP ${res.statusCode}; ${raw?'artifact unavailable':value.error||'request failed'}`),{status:res.statusCode});resolve({value,headers:res.headers});}catch(e){reject(e);}});
    });
    req.setTimeout(22*60*1000,()=>req.destroy(Error('Bounded live HTTP deadline exceeded.')));req.on('error',reject);if(bytes)req.write(bytes);req.end();
  });
}
const api=async(route,body,method)=>(await request(route,body,method)).value;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,stopping=false;
async function stop(){
  if(!server||stopping)return;stopping=true;
  try{process.kill(-server.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
  for(let n=0;n<30&&server.exitCode===null&&server.signalCode===null;n++)await pause(100);
  if(server.exitCode===null&&server.signalCode===null){try{process.kill(-server.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}}
  report.cleanup={ownedServerPid:server.pid,signal:server.signalCode,exitCode:server.exitCode,productionTouched:false};await save();
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{report.status='INTERRUPTED';report.failure={message:`Interrupted by ${signal}; unfinished observations are not a pass.`};void stop().finally(()=>process.exit(130));});
async function settled(projectId,label){
  const began=Date.now();let prior='';
  while(Date.now()-began<30*60*1000){
    const p=await api(`/api/studio/projects/${projectId}`);
    const state=p.workflow?.status+':'+p.workflow?.stage;
    if(state!==prior){console.log(JSON.stringify({phase:label,state,revision:p.revision,at:new Date().toISOString()}));prior=state;}
    if(p.workflow?.status!=='running')return p;
    assert(server.exitCode===null&&server.signalCode===null,'Isolated server exited unexpectedly.');await pause(1500);
  }
  throw Error(`${label} exceeded the bounded workflow deadline.`);
}
const projectFile=id=>path.join(dataDir,'studio-projects',id+'.json');
async function generationRecord(p,label){
  assert(p.metrics?.runId,'Real generation must retain a run ID.');
  const bytes=await readFile(path.join(dataDir,'design-runs',p.metrics.runId+'.json')),r=JSON.parse(bytes);
  assert.equal(r.designHash,p.designHash);assert.equal(r.model,process.env.QWEN_MODEL);assert(r.modelDigest);
  const summary={runId:r.runId,sha256:hash(bytes),model:r.model,modelDigest:r.modelDigest,designHash:r.designHash,elapsedMs:r.elapsedMs,attempts:r.attempts.map(a=>({attempt:a.attempt,evalCount:a.evalCount,doneReason:a.doneReason,outputSchemaHash:a.outputSchemaHash})),skillHashes:r.skillHashes};
  await artifact(label+'-generation.json',summary);return summary;
}
async function verify(p,label){
  const acceptedHash=p.designHash;
  await api(`/api/studio/projects/${p.id}/run`,{mode:'verify',expectedRevision:p.revision});
  const done=await settled(p.id,label);await artifact(label+'-project.json',done);
  assert(['complete','error'].includes(done.workflow.status),'Verification must finish explicitly.');
  assert(done.workflow.attempts.length>0,'No native attempt was created.');
  assert.equal(done.workflow.attempts[0].designHash,acceptedHash,'Initial verify regenerated or changed the saved design.');
  for(const attempt of done.workflow.attempts){
    const job=await api('/api/studio/jobs/'+attempt.jobId);await artifact(label+'-'+job.id+'-job.json',job);
    assert.equal(job.designHash,attempt.designHash);assert.equal(job.verification.physical,'UNKNOWN');assert.equal(job.execution?.kind,'native','Infrastructure unavailability does not pass native acceptance.');
    const item={label,jobId:job.id,designHash:job.designHash,status:job.status,execution:job.execution,overall:job.verification.overall,physical:'UNKNOWN',criticalFailures:job.verification.claims.filter(c=>c.critical&&c.status==='FAIL').map(c=>c.id),artifacts:[],artifactChecksComplete:false};
    report.nativeRuns.push(item);await save();
    if(job.status==='complete'){
      const dir=path.join(dataDir,'studio-jobs',job.id),input=await readFile(path.join(dir,'design.json'));
      assert.equal(job.cad.inputSha256,hash(input));assert.equal(job.cad.revisionHash,job.designHash);
      for(const part of job.cad.parts)for(const type of ['stl','step']){
        assert(typeof part[type]==='string'&&part[type].length<=220&&part[type].split('/').length<=3&&part[type].split('/').every(segment=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/.test(segment)&&segment!=='.'&&segment!=='..'),'Native artifact path must use bounded safe relative segments.');
        const response=await request(`/api/studio/jobs/${job.id}/files/cad/${part[type]}`,undefined,'GET',true);
        assert.equal(hash(response.value),part.sha256[type]);item.artifacts.push({partId:part.id,type,sha256:hash(response.value),bytes:response.value.length});
      }
      const packaged=await request(`/api/studio/jobs/${job.id}/package`,undefined,'GET',true),entries=unzipSync(packaged.value);
      const hashes=JSON.parse(Buffer.from(entries['ARTIFACT-HASHES.json']).toString());for(const [name,expected] of Object.entries(hashes)){assert(entries[name],name);assert.equal(hash(entries[name]),expected,name);}
      await artifact(label+'-'+job.id+'-package.zip',packaged.value);item.package={sha256:hash(packaged.value),bytes:packaged.value.length,checkedEntries:Object.keys(hashes).length};
    }else{
      assert.equal(job.verification.overall,'FAILED');
      const diagnostic=await request(`/api/studio/jobs/${job.id}/diagnostics`,undefined,'GET',true);assert(String(diagnostic.headers['content-disposition']).includes('M4KE-FAILED-'));
      await artifact(label+'-'+job.id+'-diagnostics.zip',diagnostic.value);
      await assert.rejects(()=>api(`/api/studio/jobs/${job.id}/package`),e=>e.status===409);
      item.diagnostics={sha256:hash(diagnostic.value),bytes:diagnostic.value.length};
    }
    item.artifactChecksComplete=true;await save();
  }
  return done;
}
try{
  server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:base.port},detached:true,stdio:['ignore','pipe','pipe']});
  let log='';server.stdout.on('data',b=>{log=(log+b.toString()).slice(-16000);});server.stderr.on('data',b=>{log=(log+b.toString()).slice(-16000);});
  await check('isolated server configured and native worker probe passed; inference not yet tested',async()=>{
    let ready=false;for(let n=0;n<200;n++){if(server.exitCode!==null)throw Error('Owned server exited: '+log);if(log.includes('M4KE local workspace:')){ready=true;break;}await pause(100);}assert(ready,'Isolated server did not start.');
    const health=await api('/api/health'),cap=await api('/api/studio/capabilities');assert.equal(health.model,process.env.QWEN_MODEL);assert.equal(health.cloudFallback,false);assert.equal(cap.cad.available,true);assert.equal(cap.cloudFallback,false);assert.equal((await api('/api/studio/projects')).projects.length,0);
    return {pid:server.pid,model:health.model,nativeVersion:cap.cad.version,cloudFallback:false,inferenceReadiness:'NOT_YET_TESTED'};
  });
  let p=await api('/api/studio/projects',{name:'Real Qwen Vue acceptance — tabletop toy',request:'Create a small two-piece tabletop stacking/balancing toy for an adult-supervised hackathon demonstration. All pieces are PLA FDM printed; no electronics, motors, batteries, screws, purchased parts or library components. Use a smooth flat table and only gentle hand movement. Keep the whole toy within 100 × 100 × 100 mm. Choose sensible dimensions and a simple printable construction yourself, with no more than two printed pieces. You may choose reversible cosmetic and dimensional details without asking me; record all assumptions. No physical measurements or testing have been performed: do not invent evidence. Include an explanation of every part, assembly instructions, and known limitations.',answers:[],budget:''});
  report.projectId=p.id;await save();
  await api(`/api/studio/projects/${p.id}/run`,{mode:'design',expectedRevision:p.revision});p=await settled(p.id,'fresh-draft');
  if(p.workflow.status==='questions'){
    await artifact('clarification-project.json',p);
    const answers=p.spec.questions.map(q=>({id:q.id,answer:'For this isolated adult-supervised tabletop prototype, choose reversible dimensions, arrangement and appearance yourself. Use PLA FDM, no electronics or purchased components, and no more than two printed parts inside 100 mm per axis. Physical tests and measured material/fit data are unavailable; explicitly retain them as unknown. Do not fabricate measurements.'}));
    p=await api(`/api/studio/projects/${p.id}`,{expectedRevision:p.revision,answers},'PUT');await api(`/api/studio/projects/${p.id}/run`,{mode:'design',expectedRevision:p.revision});p=await settled(p.id,'clarified-draft');
  }
  await check('fresh real-Qwen draft stops before CAD and records genuine explanations',async()=>{
    await artifact('draft-project.json',p);assert.equal(p.workflow.status,'draft',p.workflow.message);assert.equal(p.workflow.stage,'refine');assert.equal(p.jobId,null);assert.equal(p.workflow.attempts.length,0);assert.equal(p.designHash,designHash(p.spec));assert(p.spec.parts.length>0&&p.spec.parts.length<=2);assert(p.spec.parts.every(part=>part.kind==='printed'&&part.explanation));assert(!p.spec.electrical);
    return generationRecord(p,'draft');
  });
  // One baseline native run makes old-evidence invalidation a non-vacuous live assertion.
  p=await verify(p,'baseline');const oldJobId=p.jobId;assert(oldJobId,'Baseline must retain its actual native job.');
  const oldJobBytes=await readFile(path.join(dataDir,'studio-jobs',oldJobId,'job.json'));
  const selected=p.spec.parts.find(part=>part.kind==='printed'&&part.shape.type==='box')||p.spec.parts.find(part=>part.kind==='printed');
  assert(selected,'The toy must contain a printed part.');const context={expectedRevision:p.revision,designHash:p.designHash,selectedPartIds:[selected.id]};
  await check('selected-part ask is read-only against exact saved project bytes',async()=>{
    const before=await readFile(projectFile(p.id)),reply=await api(`/api/studio/projects/${p.id}/assistant`,{...context,mode:'ask',message:'Explain what the selected printed piece does, why it is here, and why it was selected. Distinguish recorded design rationale from your present interpretation. State what remains physically untested.'});
    assert.deepEqual(await readFile(projectFile(p.id)),before);assert.deepEqual(reply.context.selectedPartIds,[selected.id]);assert.deepEqual(reply.context.parts,[selected]);assert.equal(reply.context.designHash,p.designHash);assert.equal(reply.model,process.env.QWEN_MODEL);assert(reply.message.trim());await artifact('ask-response.json',reply);return {projectSha256:hash(before),revision:p.revision,selectedPartIds:reply.context.selectedPartIds};
  });
  let proposal;
  await check('real-Qwen candidate stays separate until explicit confirmation',async()=>{
    const before=await readFile(projectFile(p.id));const instruction=selected.shape.type==='box'?'Increase only the selected printed part outer X dimension by exactly 2 mm.':'Increase the selected printed piece height by 2 mm.';
    const reply=await api(`/api/studio/projects/${p.id}/assistant`,{...context,mode:'propose',message:instruction+' Keep the toy purpose, original requirements, physics inputs, verification requests, all existing part identities and assembly decisions unchanged. Preserve all parts; add no hardware. Make only necessary placement adjustments to avoid newly introduced overlap and explain each changed part. This is only a proposed geometry change, not evidence of physical success.'});
    assert.deepEqual(await readFile(projectFile(p.id)),before);proposal=reply.proposal;assert(proposal?.id);assert.equal(proposal.baseRevision,p.revision);assert.equal(proposal.baseDesignHash,p.designHash);assert.notEqual(proposal.designHash,p.designHash);assert(proposal.changes.some(change=>change.partId===selected.id));assert.equal(proposal.designHash,designHash(proposal.spec));await artifact('proposal-response.json',reply);
    await generationRecord({metrics:proposal.metrics,designHash:proposal.designHash},'proposal');return {proposalId:proposal.id,baseRevision:p.revision,designHash:proposal.designHash,changes:proposal.changes};
  });
  await check('explicit application creates new revision and preserves but invalidates prior native evidence',async()=>{
    const priorRevision=p.revision,priorHash=p.designHash;p=await api(`/api/studio/projects/${p.id}/proposals/${proposal.id}/apply`,{expectedRevision:priorRevision,designHash:priorHash});
    assert.equal(p.revision,priorRevision+1);assert.equal(p.designHash,proposal.designHash);assert(!p.jobId);assert(!p.verification);assert.equal(p.workflow.status,'draft');assert.equal(p.appliedProposal.parent.jobId,oldJobId);assert.equal(p.appliedProposal.parent.designHash,priorHash);assert.deepEqual(await readFile(path.join(dataDir,'studio-jobs',oldJobId,'job.json')),oldJobBytes);
    await assert.rejects(()=>api(`/api/studio/projects/${p.id}/proposals/${proposal.id}/apply`,{expectedRevision:priorRevision,designHash:priorHash}),e=>e.status===409);await artifact('applied-project.json',p);return {revision:p.revision,designHash:p.designHash,retainedPriorJobId:oldJobId,priorJobSha256:hash(oldJobBytes)};
  });
  const accepted=p.designHash;p=await verify(p,'accepted-verify');
  await check('confirmed design reaches native verification without initial regeneration',async()=>({acceptedDesignHash:accepted,firstAttemptDesignHash:p.workflow.attempts[0].designHash,finalDesignHash:p.designHash,workflowStatus:p.workflow.status,attempts:p.workflow.attempts.length,physical:'UNKNOWN'}));
  report.status='SOFTWARE_ACCEPTANCE_PASSED';report.finalProject={id:p.id,revision:p.revision,designHash:p.designHash,jobId:p.jobId,workflowStatus:p.workflow.status,verificationOverall:p.verification?.overall,physical:'UNKNOWN'};
}catch(error){report.status='FAILED';report.failure={message:error.message,stack:error.stack};process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await stop();await save();console.log(JSON.stringify({status:report.status,output:out,projectId:report.projectId,checks:report.checks.length,nativeAttempts:report.nativeRuns.length,failure:report.failure?.message||null,physical:'UNKNOWN'}));}
