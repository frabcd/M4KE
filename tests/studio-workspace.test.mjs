import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createProjectStore,designChanges} from '../server/studio-projects.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';
import {createStudioService} from '../server/studio-service.mjs';
import {designHash,validateDesignSpec} from '../server/studio-contract.mjs';

const sample=()=>({schemaVersion:1,title:'Test shell',description:'An untested shell',units:'mm',requirements:[{id:'R1',text:'Keep the selected dimensions and materials as assumptions'}],assumptions:[],unknowns:['Physical test pending'],questions:[],parts:[{id:'shell',name:'Shell',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[40,30,4]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['shell'],requires:[],instructions:['Measure the part.'],checks:['Compare to the drawing.']}]});
const candidate=()=>{const s=sample();s.parts[0].shape.size[0]=42;s.parts[0].explanation={purpose:'Protect the mechanism',placementReason:'An assumed two mm clearance is proposed',selectionReason:'PLA is a prototype material, not a certified safety selection'};return s;};
const requestFor=p=>({expectedRevision:p.revision,designHash:p.designHash,selectedPartIds:['shell']});
async function storeFixture(assistant){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-workspace-'));
  const store=createProjectStore({root,execute:async(_p,_i,save)=>save({workflow:{status:'draft',stage:'refine'}}),assistant});
  return {root,store,close:()=>rm(root,{recursive:true,force:true})};
}

test('part explanations are optional intent and absent legacy designs keep their canonical hash',()=>{
  const s=sample(),normalized=validateDesignSpec(s),hash=designHash(s);
  assert(!Object.hasOwn(normalized.parts[0],'explanation'));
  assert.equal(designHash(normalized),hash);
  const explained=candidate();assert.equal(validateDesignSpec(explained).parts[0].explanation.purpose,'Protect the mechanism');
  assert.notEqual(designHash(explained),hash);
  explained.parts[0].explanation.status='PASS';assert.throws(()=>validateDesignSpec(explained),/unsupported key/);
  delete explained.parts[0].explanation.status;explained.parts[0].explanation.purpose='';assert.throws(()=>validateDesignSpec(explained),/nonempty/);
});

test('name and separate view version preserve design, project revision, verification and job linkage',async()=>{
  const f=await storeFixture();try{
    let p=await f.store.create({name:'My workspace',request:'Make a shell',spec:sample()});
    p.verification={overall:'UNKNOWN'};p.jobId='12345678-1234-4234-8234-123456789abc';
    const file=path.join(f.root,'data','studio-projects',p.id+'.json');await writeFile(file,JSON.stringify(p));
    p=await f.store.update(p.id,{name:'Renamed',expectedRevision:p.revision});
    assert.equal(p.name,'Renamed');assert.equal(p.verification.overall,'UNKNOWN');assert(p.jobId);
    const before=await readFile(file,'utf8'),view=await f.store.getView(p.id);
    const changed=await f.store.putView(p.id,{expectedVersion:view.version,selectedPartIds:['shell'],activePartId:'shell',hiddenPartIds:['shell'],projection:'orthographic'});
    assert.equal(changed.version,1);assert.equal(await readFile(file,'utf8'),before);
    await assert.rejects(f.store.putView(p.id,{expectedVersion:0,hiddenPartIds:[]}),e=>e.status===409);
    await assert.rejects(f.store.putView(p.id,{expectedVersion:1,hiddenPartIds:['not-a-part']}),/unknown/);
    await assert.rejects(f.store.putView(p.id,{expectedVersion:1,selectedPartIds:[],activePartId:'shell'}),/must be selected/);
    assert.equal((await f.store.list())[0].title,'Renamed');
    assert.equal((await f.store.getView(p.id)).hiddenPartIds[0],'shell');
  }finally{await f.close();}
});

test('assistant receives frozen server-resolved context; asking never mutates the project',async()=>{
  let observed,release;
  const gate=new Promise(resolve=>release=resolve);
  const f=await storeFixture(async input=>{observed=input;await gate;return {message:'An interpretation, not original evidence',spec:candidate(),model:'fixture'};});
  try{
    const p=await f.store.create({request:'A shell',spec:sample()}),file=path.join(f.root,'data','studio-projects',p.id+'.json'),before=await readFile(file,'utf8');
    const pending=f.store.assist(p.id,{...requestFor(p),mode:'ask',message:'Why here?'});
    while(!observed)await new Promise(r=>setTimeout(r,1));
    await f.store.putView(p.id,{expectedVersion:0,selectedPartIds:[],activePartId:null});
    release();const reply=await pending;
    assert.deepEqual(reply.context.selectedPartIds,['shell']);assert.equal(reply.context.parts[0].shape.size[0],40);
    assert.equal(await readFile(file,'utf8'),before);assert(!Object.hasOwn(reply,'spec'));assert(!Object.hasOwn(reply,'proposal'));
    await assert.rejects(f.store.assist(p.id,{...requestFor(p),mode:'ask',message:'Hi',selectedPartIds:['fake']}),/unknown/);
    await assert.rejects(f.store.assist(p.id,{...requestFor(p),mode:'ask',message:'Hi',designHash:'wrong'}),e=>e.status===409);
  }finally{release();await f.close();}
});

test('candidate is separate until confirmation, invalidates old evidence and preserves archived attempts',async()=>{
  const f=await storeFixture(async()=>({message:'Review the wider shell',spec:candidate(),model:'fixture'}));try{
    const p=await f.store.create({request:'Make shell',spec:sample()});
    p.workflow={id:'12345678-1234-4234-8234-123456789abc',status:'error',attempts:[{jobId:'retained'}]};p.verification={overall:'FAILED'};p.jobId='12345678-1234-4234-8234-123456789abc';
    const file=path.join(f.root,'data','studio-projects',p.id+'.json');await writeFile(file,JSON.stringify(p));const before=await readFile(file,'utf8');
    const response=await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Widen the shell'});
    assert.equal(await readFile(file,'utf8'),before);assert.equal(response.proposal.changes[0].partId,'shell');assert(response.proposal.changes[0].fields.includes('shape'));
    const applied=await f.store.applyProposal(p.id,response.proposal.id,{expectedRevision:p.revision,designHash:p.designHash});
    assert.equal(applied.spec.parts[0].shape.size[0],42);assert.equal(applied.revision,p.revision+1);assert.equal(applied.verification,undefined);assert.equal(applied.jobId,undefined);
    assert.equal(applied.workflow.status,'draft');assert.equal(applied.appliedProposal.parent.jobId,p.jobId);
    const archived=JSON.parse(await readFile(path.join(f.root,'data','studio-projects',p.id+'-runs',p.workflow.id+'.json'),'utf8'));assert.equal(archived.workflow.attempts[0].jobId,'retained');assert.equal(archived.designHash,p.designHash);
    await assert.rejects(f.store.applyProposal(p.id,response.proposal.id,{expectedRevision:applied.revision,designHash:applied.designHash}),e=>e.status===409);
  }finally{await f.close();}
});

test('candidate questions use the frozen server proposal, retain labels and never apply or verify it',async()=>{
  const received=[];
  const f=await storeFixture(async input=>{received.push(input);return {message:input.mode==='ask'?'Proposed wider shell, not applied or verified.':'Review wider shell',spec:candidate(),model:'fixture'};});
  try{
    const p=await f.store.create({request:'Shell',spec:sample()});
    const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Widen'})).proposal;
    const file=path.join(f.root,'data','studio-projects',p.id+'.json'),before=await readFile(file,'utf8');
    const input={...requestFor(p),mode:'ask',message:'Why wider?',proposalId:proposal.id};
    const reply=await f.store.assist(p.id,input),observed=received.at(-1);
    assert.equal(observed.project.spec.parts[0].shape.size[0],40);
    assert.equal(observed.proposal.spec.parts[0].shape.size[0],42);
    assert.equal(reply.context.parts[0].shape.size[0],42);
    assert.equal(reply.context.designHash,proposal.designHash);
    assert.equal(reply.context.baseDesignHash,p.designHash);
    assert.equal(reply.context.basis,'candidate');
    assert.equal(reply.conversation.at(-1).proposalId,proposal.id);
    assert.equal(reply.conversation.at(-1).basis,'candidate');
    assert(!reply.proposal&&!reply.spec);
    assert.equal(await readFile(file,'utf8'),before);
    await assert.rejects(f.store.assist(p.id,{...input,mode:'propose'}),/read-only/);
    await assert.rejects(f.store.assist(p.id,{...input,proposalId:'../escape'}),/valid proposal/);
    const p2=await f.store.create({request:'Other',spec:sample()});
    await assert.rejects(f.store.assist(p2.id,{...requestFor(p2),...input,expectedRevision:p2.revision,designHash:p2.designHash}),e=>e.status===404);
    await f.store.update(p.id,{expectedRevision:p.revision,name:'New revision'});
    const current=await f.store.get(p.id);
    await assert.rejects(f.store.assist(p.id,{...input,...requestFor(current)}),/stale/);
  }finally{await f.close();}
});

test('candidate-only part is valid ask context but not a confirmed view preference',async()=>{
  const extra=candidate();
  extra.parts.push({...structuredClone(extra.parts[0]),id:'cap',name:'New cap',shape:{type:'box',size:[8,8,4]},position:[0,0,12]});
  extra.assembly[0].partIds.push('cap');
  const received=[];
  const f=await storeFixture(async input=>{received.push(input);return {message:'Unapplied cap proposal.',spec:extra,model:'fixture'};});
  try{
    const p=await f.store.create({request:'Shell',spec:sample()});
    const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Add a cap'})).proposal;
    const file=path.join(f.root,'data','studio-projects',p.id+'.json'),before=await readFile(file,'utf8');
    const reply=await f.store.assist(p.id,{...requestFor(p),mode:'ask',message:'Why this cap?',proposalId:proposal.id,selectedPartIds:['cap']});
    assert.deepEqual(reply.context.selectedPartIds,['cap']);
    assert.equal(reply.context.parts[0].id,'cap');
    assert.equal(received.at(-1).project.spec.parts.some(part=>part.id==='cap'),false);
    await assert.rejects(f.store.putView(p.id,{expectedVersion:0,selectedPartIds:['cap'],activePartId:'cap'}));
    assert.equal(await readFile(file,'utf8'),before);
  }finally{await f.close();}
});

test('candidate reply is rejected if its parent changes in flight; corrupted proposal hashes never reach inference',async()=>{
  let release,entered=false;const gate=new Promise(r=>release=r);
  const f=await storeFixture(async input=>{if(input.mode==='ask'){entered=true;await gate;}return {message:'Unverified candidate',spec:candidate()};});
  try{
    const p=await f.store.create({request:'Shell',spec:sample()});
    const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Widen'})).proposal;
    const input={...requestFor(p),mode:'ask',message:'Explain',proposalId:proposal.id};
    const pending=f.store.assist(p.id,input);
    while(!entered)await new Promise(r=>setTimeout(r,1));
    await f.store.applyProposal(p.id,proposal.id,{expectedRevision:p.revision,designHash:p.designHash});
    const rejected=assert.rejects(pending,e=>e.status===409);release();await rejected;
    assert.equal((await f.store.getConversation(p.id)).entries.length,2);
    const current=await f.store.get(p.id),p2=await f.store.create({request:'Other',spec:sample()});
    const other=(await f.store.assist(p2.id,{...requestFor(p2),mode:'propose',message:'Widen'})).proposal;
    const file=path.join(f.root,'data','studio-projects',`${p2.id}-proposal-${other.id}.json`);other.designHash='bad';await writeFile(file,JSON.stringify(other));
    await assert.rejects(f.store.assist(p2.id,{...requestFor(p2),mode:'ask',message:'Explain',proposalId:other.id}),/identity changed/);
    assert.equal(current.spec.parts[0].shape.size[0],42);
  }finally{release();await f.close();}
});

test('changed acceptance requirements require separate acknowledgment and stale candidates still reject',async()=>{
  let bad=true;const f=await storeFixture(async()=>{const spec=candidate();if(bad)spec.requirements[0].text='No requirements';return {message:'Candidate',spec};});try{
    const p=await f.store.create({request:'Shell',spec:sample()});
    const changed=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Change'})).proposal;assert.equal(changed.decisionChanges.length,1);await assert.rejects(f.store.applyProposal(p.id,changed.id,{expectedRevision:p.revision,designHash:p.designHash}),/explicitly accept/);
    bad=false;const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Widen'})).proposal;
    const renamed=await f.store.update(p.id,{expectedRevision:p.revision,name:'Later revision'});
    await assert.rejects(f.store.applyProposal(p.id,proposal.id,{expectedRevision:renamed.revision,designHash:renamed.designHash}),/stale/);
    const p2=await f.store.create({request:'Other shell',spec:sample()});
    await assert.rejects(f.store.applyProposal(p2.id,proposal.id,{expectedRevision:p2.revision,designHash:p2.designHash}),e=>e.status===404);
    assert.equal((await f.store.get(p.id)).designHash,p.designHash);
  }finally{await f.close();}
});

test('verify mode rejects unsaved decisions and unsupported modes before running',async()=>{
  const f=await storeFixture();try{
    const p=await f.store.create({request:'Shell'});
    await assert.rejects(f.store.start(p.id,{mode:'verify'}),/saved design/);
    await assert.rejects(f.store.start(p.id,{mode:'verify',answers:[]}),/save decisions/);
    await assert.rejects(f.store.start(p.id,{mode:'not-a-mode'}),/Invalid workflow mode/);
    assert.equal(f.store.isRunning(),false);
  }finally{await f.close();}
});

test('saved brief changes cannot silently verify or refine the prior concept',async()=>{
  const f=await storeFixture(async()=>({message:'Must never be called',spec:candidate()}));try{
    const p=await f.store.create({request:'Make shell',spec:sample()});
    const revised=await f.store.update(p.id,{expectedRevision:p.revision,request:'Make a different mechanism'});
    assert.equal(revised.requiresDesignUpdate,true);assert.equal(revised.designHash,p.designHash);
    await assert.rejects(f.store.start(p.id,{mode:'verify',expectedRevision:revised.revision}),e=>e.status===409&&/brief changed/.test(e.message));
    await assert.rejects(f.store.assist(p.id,{...requestFor(revised),mode:'ask',message:'Has my new mechanism passed?'}),e=>e.status===409&&/brief changed/.test(e.message));
    const renamed=await f.store.update(p.id,{expectedRevision:revised.revision,name:'Renamed pending concept'});
    assert.equal(renamed.requiresDesignUpdate,true);
    assert.equal((await f.store.get(p.id)).revision,renamed.revision);
  }finally{await f.close();}
});

test('candidate differences include assembly and global changes rather than hiding them as geometry only',()=>{
  const a=sample(),b=candidate();b.assembly[0].instructions=['Fit the wider shell'];b.description='Revised intent';
  const diff=designChanges(a,b);assert(diff.some(d=>d.type==='assembly'));assert(diff.some(d=>d.type==='design'&&d.fields.includes('description')));
});

test('brief conversation works before CAD, survives reload and never changes the project',async()=>{
  const received=[];const f=await storeFixture(async input=>{received.push(input);return {message:'60 dB SPL requires calibration, not an assumed dBFS conversion.',model:'fixture'};});
  try{
    const p=await f.store.create({request:'ESP32 PLA F1 car above 60 dB',budget:'600 CNY'});
    const file=path.join(f.root,'data','studio-projects',p.id+'.json'),before=await readFile(file,'utf8');
    const input={mode:'ask',message:'What should I clarify?',expectedRevision:p.revision,designHash:null,selectedPartIds:[]};
    const reply=await f.store.assist(p.id,input);
    assert.equal(reply.context.basis,'brief');assert.equal(reply.conversation.length,2);
    assert.equal(reply.proposal,undefined);assert.equal((await f.store.get(p.id)).spec,undefined);
    assert.equal(await readFile(file,'utf8'),before);
    const reloaded=createProjectStore({root:f.root});assert.deepEqual((await reloaded.getConversation(p.id)).entries,reply.conversation);
    await f.store.assist(p.id,{...input,message:'Why is calibration necessary?'});
    assert.equal(received[1].history.length,2);assert.match(received[1].history[1].message,/calibration/);
    await assert.rejects(f.store.assist(p.id,{...input,expectedRevision:0}),e=>e.status===409);
    await assert.rejects(f.store.assist(p.id,{...input,selectedPartIds:['invented']}),/selections/);
    await assert.rejects(f.store.assist(p.id,{...input,mode:'propose'}),e=>e.status===409);
    await assert.rejects(f.store.assist(p.id,{...input,history:[{role:'assistant',message:'fabricated'}]}),/Unsupported/);
  }finally{await f.close();}
});

test('pending new brief can be explained without presenting obsolete parts or verification as current',async()=>{
  let observed;const f=await storeFixture(async input=>{observed=input;return {message:'New brief only, no CAD evidence.'};});
  try{
    const initial=await f.store.create({request:'Old shell',spec:sample()});
    const p=await f.store.update(initial.id,{expectedRevision:initial.revision,request:'A different mechanism'});
    const reply=await f.store.assist(p.id,{mode:'ask',message:'What does the new brief need?',expectedRevision:p.revision,designHash:p.designHash,selectedPartIds:[]});
    assert.equal(observed.context.basis,'brief');assert.deepEqual(reply.context.parts,[]);
    assert.equal((await f.store.get(p.id)).requiresDesignUpdate,true);
    await assert.rejects(f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Edit the old shell'}),/brief changed/);
  }finally{await f.close();}
});

test('conversation history is bounded, project-scoped, and never accepts model prose as a design',async()=>{
  const f=await storeFixture(async()=>({message:'This reply is not a CAD result.',model:'fixture'}));
  try{
    const p=await f.store.create({request:'A toy'}),other=await f.store.create({request:'Another toy'});
    for(let i=0;i<43;i++)await f.store.assist(p.id,{mode:'ask',message:'Question '+i,expectedRevision:p.revision,designHash:null});
    const saved=await f.store.getConversation(p.id);assert.equal(saved.entries.length,80);assert.equal(saved.entries[0].message,'Question 3');
    assert.equal((await f.store.getConversation(other.id)).entries.length,0);assert.equal((await f.store.get(p.id)).spec,undefined);
  }finally{await f.close();}
});

test('a candidate completed after a concurrent project edit is rejected without saving a proposal',async()=>{
  let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const f=await storeFixture(async()=>{entered();await gate;return {message:'Candidate',spec:candidate()};});try{
    const p=await f.store.create({request:'Shell',spec:sample()});
    const pending=f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Widen'});await started;
    await f.store.update(p.id,{expectedRevision:p.revision,name:'Changed while inferring'});release();
    await assert.rejects(pending,e=>e.status===409);
    assert(!(await readdir(path.join(f.root,'data','studio-projects'))).some(n=>n.includes('-proposal-')));
    assert.equal((await f.store.get(p.id)).spec.parts[0].shape.size[0],40);
  }finally{release();await f.close();}
});

test('candidate admission preserves electrical controls, purchased identity and acceptance-driving physics',async()=>{
  const e=electricalFixture(),spec=sample();spec.parts.push(...e.parts.map(p=>({...p,material:'Purchased module',color:'#303030'})));spec.assembly[0].partIds=spec.parts.map(p=>p.id);spec.electrical=e.electrical;
  spec.physicsInputs={targetSpeedMS:{value:.5,basis:'USER',source:'User target'}};
  let change=()=>{};const f=await storeFixture(async()=>{const next=structuredClone(spec);next.parts[0].position[0]=1;change(next);return {message:'Candidate',spec:next};});try{
    const p=await f.store.create({request:'Controlled shell',spec});
    for(const mutation of [s=>{s.electrical.control.thresholdDbfs=-35;},s=>{s.physicsInputs.targetSpeedMS.value=.1;},s=>{s.parts.find(p=>p.kind==='purchased').shape={type:'box',size:[1,1,1]};}]){
      change=mutation;await assert.rejects(f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Move only the shell'}),/Repair (changed|replaced)/);
    }
    assert.equal((await f.store.get(p.id)).designHash,p.designHash);
  }finally{await f.close();}
});

function request(url,data,method=data?'POST':'GET'){
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method,agent:false,timeout:30000,headers:{'content-type':'application/json'}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('HTTP fixture timeout')));req.end(data?JSON.stringify(data):undefined);
  });
}
async function apiFixture(options={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-workspace-api-')),calls=[];
  // Synthetic transport only: this proves publication semantics, not geometry.
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  let runProcess;
  if(options.native){
    await mkdir(path.join(root,'cad'),{recursive:true});
    for(const name of ['worker.py','requirements.txt'])await writeFile(path.join(root,'cad',name),'SYNTHETIC NEVER EXECUTED');
    if(!process.env.M4KE_CAD_PYTHON){const python=path.join(root,'.venv-cad',process.platform==='win32'?'Scripts/python.exe':'bin/python');await mkdir(path.dirname(python),{recursive:true});await writeFile(python,'Injected synthetic runner');}
    runProcess=async(_exe,args)=>{
      if(args[0]==='-c')return {code:0,stdout:'{"version":"SYNTHETIC-NOT-CAD"}',stderr:''};
      if(path.basename(args[0])==='illustrate.py')return {code:1,stdout:'',stderr:'No synthetic projection'};
      const input=args[args.indexOf('--input')+1],output=args[args.indexOf('--output')+1],bytes=await readFile(input),spec=JSON.parse(bytes);
      await mkdir(path.join(output,'parts'),{recursive:true});const parts=[];
      for(const p of spec.parts){const hashes={};for(const ext of ['stl','step']){const content=Buffer.from(`SYNTHETIC ${p.id} ${ext}`);await writeFile(path.join(output,'parts',p.id+'.'+ext),content);hashes[ext]=sha(content);}parts.push({id:p.id,valid:true,solidCount:1,volumeMm3:1000,stl:`parts/${p.id}.stl`,step:`parts/${p.id}.step`,sha256:hashes});}
      const assembly=Buffer.from('SYNTHETIC ASSEMBLY');await writeFile(path.join(output,'assembly.step'),assembly);
      const checks=options.native==='fail'?[{id:'assembly-overlap',label:'Synthetic blocking failure',status:'FAIL',method:'Synthetic fixture',observed:'Forced failure',required:'No overlap'}]:[];
      await writeFile(path.join(output,'result.json'),JSON.stringify({schemaVersion:1,title:spec.title,units:'mm',ok:!checks.length,inputSha256:sha(bytes),parts,checks,errors:checks.length?['Synthetic failure']:[],assemblyStep:'assembly.step',assemblySha256:sha(assembly)}));
      return {code:checks.length?2:0,stdout:'Synthetic test runner, not native evidence',stderr:''};
    };
  }
  const handle=createStudioService({root,runProcess,getSettings:()=>({endpoint:'http://127.0.0.1:11434',model:'fixture-local',provider:options.provider||'ollama'}),getModels:async()=>[{name:'fixture-local',digest:'fixture-only'}],localFetch:async(...args)=>{const payload=JSON.parse(args[2].body);calls.push(payload);return {message:{content:JSON.stringify(options.reply?options.reply(payload,calls.length):payload.format.properties.action?{action:'patch',message:'I propose widening the selected shell by two mm.',updates:[{partId:'shell',reason:'Requested extra width; fit is unverified.',changes:{shape:candidate().parts[0].shape,explanation:candidate().parts[0].explanation}}],questions:[]}:payload.format.properties.message?{message:'The selected shell protects the mechanism; placement is untested.'}:payload.messages[0].content.startsWith('REFINEMENT')?candidate():{...sample(),parts:sample().parts.map(p=>({...p,explanation:{purpose:'Shell',placementReason:'Assumed placement',selectionReason:'Prototype material'}}))})},eval_count:20,done_reason:'stop'};},body:async req=>{let bytes='';for await(const chunk of req)bytes+=chunk;return JSON.parse(bytes);},json:(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));}});
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end('{}');}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
  return {root,calls,url,close:async()=>{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}
async function settled(url){for(let i=0;i<300;i++){const p=(await request(url)).data;if(p.workflow?.status!=='running')return p;await new Promise(r=>setTimeout(r,10));}throw new Error('Workflow did not finish');}

test('HTTP brief assistant receives saved requirements and dialogue, never a stale specification',async()=>{
  const f=await apiFixture();try{
    const p=(await request(f.url+'/api/studio/projects',{request:'ESP32 F1 PLA 60 dB',budget:'600 CNY'})).data,url=f.url+'/api/studio/projects/'+p.id;
    const input={mode:'ask',message:'What information is missing?',expectedRevision:p.revision,designHash:null,selectedPartIds:[]};
    const reply=await request(url+'/assistant',input);assert.equal(reply.status,200);
    let payload=JSON.parse(f.calls[0].messages[1].content);assert.equal(payload.spec,null);assert.equal(payload.verification,null);assert.equal(payload.brief.budget,'600 CNY');
    assert.equal(f.calls[0].format.properties.message.type,'string');assert.equal(f.calls[0].think,false);
    assert.equal((await request(url+'/conversation')).data.entries.length,2);
    await request(url+'/assistant',{...input,message:'Explain your answer.'});
    const messages=f.calls[1].messages;assert.deepEqual(messages.map(m=>m.role),['system','user','assistant','user']);
    assert.equal(messages[1].content,input.message);assert.equal(JSON.parse(messages[2].content).message,reply.data.message);
    payload=JSON.parse(messages.at(-1).content);assert.equal(payload.message,'Explain your answer.');assert.equal(payload.spec,null);
    assert.equal(payload.context.revision,p.revision);assert.equal(payload.conversationHistory,undefined);
    assert.match(messages[0].content,/FINAL user turn/);
    assert.equal((await request(url)).data.revision,p.revision);assert.equal(f.calls.length,2);
    await assert.rejects(readdir(path.join(f.root,'data','studio-jobs')),e=>e.code==='ENOENT');
  }finally{await f.close();}
});

test('explainer rejects malformed or mutating replies before persisting dialogue',async()=>{
  for(const reply of [{message:'Explanation',proposal:{parts:[]}},{message:''},{message:123},['not-an-explanation']]){
    const f=await apiFixture({reply:()=>reply});try{
      const p=(await request(f.url+'/api/studio/projects',{request:'A toy'})).data,url=f.url+'/api/studio/projects/'+p.id;
      const result=await request(url+'/assistant',{mode:'ask',message:'Explain',expectedRevision:p.revision,designHash:null});
      assert.equal(result.status,502);assert.equal((await request(url+'/conversation')).data.entries.length,0);assert.equal((await request(url)).data.revision,p.revision);
    }finally{await f.close();}
  }
});

test('HTTP workflow draft stops before native verification; verify uses that exact saved spec without regeneration',async()=>{
  const f=await apiFixture();try{
    const created=await request(f.url+'/api/studio/projects',{name:'Workspace',request:'Create a shell'});assert.equal(created.status,201);
    const url=f.url+'/api/studio/projects/'+created.data.id;
    assert.equal((await request(url+'/run',{mode:'design',expectedRevision:created.data.revision})).status,202);
    const draft=await settled(url);assert.equal(draft.workflow.status,'draft');assert.equal(draft.workflow.stage,'refine');assert.equal(draft.workflow.attempts.length,0);assert.equal(f.calls.length,1);
    assert.equal(draft.jobId,null);await assert.rejects(readdir(path.join(f.root,'data','studio-jobs')),e=>e.code==='ENOENT');
    const hash=draft.designHash;
    assert.equal((await request(url+'/run',{mode:'verify',expectedRevision:draft.revision})).status,202);
    const verified=await settled(url);assert.equal(verified.designHash,hash);assert.equal(f.calls.length,1);assert.equal(verified.workflow.status,'error');assert.match(verified.workflow.message,/Native CAD worker is not ready/);
  }finally{await f.close();}
});

test('HTTP ask and propose/apply use exact selection and local model without premature project writes',async()=>{
  const f=await apiFixture({native:true});try{
    const p=(await request(f.url+'/api/studio/projects',{name:'Toy',request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const ask=await request(url+'/assistant',{...requestFor(p),mode:'ask',message:'Why shell?'});assert.equal(ask.status,200);assert.deepEqual(ask.data.context.selectedPartIds,['shell']);assert.equal(ask.data.model,'fixture-local');
    assert.equal((await request(url)).data.revision,p.revision);
    const context=JSON.parse(f.calls[0].messages[1].content);assert.equal(context.context.parts[0].id,'shell');assert.match(f.calls[0].messages[0].content,/read-only/);
    const response=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Widen two mm'});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal((await request(url)).data.designHash,p.designHash);
    const genData=JSON.parse(f.calls[1].messages.at(-1).content);assert.deepEqual(genData.selectedPartContext.selectedPartIds,['shell']);
    const applied=await request(url+'/proposals/'+response.data.proposal.id+'/apply',{expectedRevision:p.revision,designHash:p.designHash});assert.equal(applied.status,200);assert.equal(applied.data.spec.parts[0].shape.size[0],42);assert.equal(applied.data.workflow.status,'draft');assert.equal(response.data.proposal.nativeChecksPassed,true);assert.equal(applied.data.jobId,response.data.proposal.jobId);assert.equal(applied.data.verification.revisionHash,applied.data.designHash);
    assert.equal((await request(url+'/view')).data.version,0);
    const view=await request(url+'/view',{expectedVersion:0,hiddenPartIds:['shell']},'PUT');assert.equal(view.status,200);assert.equal(view.data.version,1);
  }finally{await f.close();}
});

test('modification clarification is a real reply, not an error or a project mutation',async()=>{
  const clarification={...sample(),parts:[],assembly:[],questions:[{id:'width',question:'How wide should it be?',options:['42 mm','44 mm']}]};
  const f=await storeFixture(async()=>({message:'I need the target width before changing the shell.',spec:clarification,model:'fixture'}));
  try{
    const p=await f.store.create({request:'Make a shell',spec:sample()});
    const file=path.join(f.root,'data','studio-projects',p.id+'.json'),before=await readFile(file,'utf8');
    const response=await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Make it wider'});
    assert.equal(response.questions[0].id,'width');assert.match(response.message,/target width/);
    assert.equal(response.proposal,undefined);assert.equal(await readFile(file,'utf8'),before);
  }finally{await f.close();}
});

test('compact HTTP refinement can ask essential questions without creating a proposal or native job',async()=>{
  const f=await apiFixture({reply:()=>({action:'questions',message:'What clearance should I use?',updates:[],questions:[{id:'gap',question:'Which clearance?',options:['1 mm','2 mm']}]})});
  try{
    const p=(await request(f.url+'/api/studio/projects',{request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const reply=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Adjust the gap'});
    assert.equal(reply.status,200,JSON.stringify(reply.data));assert.equal(reply.data.proposal,undefined);assert.equal(reply.data.questions[0].id,'gap');
    assert.deepEqual((await request(url)).data,p);assert.equal((await request(url+'/conversation')).data.entries.length,2);
    await assert.rejects(readdir(path.join(f.root,'data','studio-jobs')),e=>e.code==='ENOENT');
  }finally{await f.close();}
});

test('compact model can explicitly route a larger change to the full designer, retaining selection and request',async()=>{
  const f=await apiFixture({native:true,reply:payload=>payload.format.properties.action?{action:'redesign',message:'This needs a full candidate and assembly review.',updates:[],questions:[]}:candidate()});
  try{
    const p=(await request(f.url+'/api/studio/projects',{request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const reply=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Widen two mm and review assembly'});
    assert.equal(reply.status,200,JSON.stringify(reply.data));assert.equal(f.calls.length,2);assert(reply.data.proposal.metrics.refinementRouteRunId);
    assert((f.calls[1].format.properties.parts.items.anyOf?.[0]||f.calls[1].format.properties.parts.items).required.includes('explanation'),'Full local refinements must decode the intent required by the host');
    const full=JSON.parse(f.calls[1].messages.at(-1).content);assert.deepEqual(full.selectedPartContext.selectedPartIds,['shell']);assert.match(full.request,/Widen two mm and review assembly/);
    assert.equal(reply.data.proposal.spec.parts[0].shape.size[0],42);assert.deepEqual((await request(url)).data,p);
    const runs=await readdir(path.join(f.root,'data','design-runs'));assert.equal(runs.length,2);
  }finally{await f.close();}
});

test('new design mode requires actual model explanations; omitted intent gets bounded format rejection',async()=>{
  const f=await apiFixture({reply:()=>sample()});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'Make a shell'})).data,url=f.url+'/api/studio/projects/'+p.id;
    await request(url+'/run',{mode:'design',expectedRevision:p.revision});const done=await settled(url);
    assert.equal(done.workflow.status,'error');assert.match(done.workflow.message,/Every new part needs explanation/);
    assert.equal(f.calls.length,2);assert((f.calls[0].format.properties.parts.items.anyOf?.[0]||f.calls[0].format.properties.parts.items).required.includes('explanation'));
    assert.equal(done.spec,undefined);
  }finally{await f.close();}
});


test('delivery failure keeps the published model and its evidence, retaining failed attempts separately',async()=>{
  const f=await apiFixture({native:'fail',provider:'codex-bridge',reply:payload=>payload.format.properties.updates?{updates:[]} : candidate()});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'Widen the shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    p.jobId='12345678-1234-4234-8234-123456789abc';p.verification={revisionHash:p.designHash,overall:'UNKNOWN',claims:[]};
    await writeFile(path.join(f.root,'data','studio-projects',p.id+'.json'),JSON.stringify(p));
    const response=await request(url+'/run',{mode:'deliver',expectedRevision:p.revision});assert.equal(response.status,202);
    const done=await settled(url);assert.equal(done.workflow.status,'error');assert.equal(done.designHash,p.designHash);assert.deepEqual(done.spec,p.spec);assert.equal(done.jobId,p.jobId);assert.deepEqual(done.verification,p.verification);assert(done.workflow.attempts.length>=1);
  }finally{await f.close();}
});

test('delivery publishes only the checked candidate and never calls an online advisory model',async()=>{
  const f=await apiFixture({native:true,provider:'codex-bridge',reply:()=>candidate()});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'Create a shell'})).data,url=f.url+'/api/studio/projects/'+p.id;
    await request(url+'/run',{mode:'deliver',expectedRevision:p.revision});const done=await settled(url);
    assert.equal(done.workflow.status,'complete');assert.equal(done.verification.revisionHash,done.designHash);assert(done.jobId);assert.equal(f.calls.length,1);
  }finally{await f.close();}
});

test('failed native candidate cannot create an applicable proposal or mutate the published design',async()=>{
  const f=await apiFixture({native:'fail',reply:payload=>payload.format.properties.action?{action:'patch',message:'Widen',updates:[{partId:'shell',reason:'Requested width',changes:{shape:candidate().parts[0].shape}}],questions:[]}:payload.format.properties.updates?{updates:[]} : candidate()});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const reply=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Widen two mm'});assert(reply.status>=400);assert.equal(reply.data.proposal,undefined);assert.deepEqual((await request(url)).data,p);
    assert(!(await readdir(path.join(f.root,'data','studio-projects'))).some(n=>n.includes('-proposal-')));
  }finally{await f.close();}
});

test('candidate application rejects missing or mismatched check identity',async()=>{
  const f=await apiFixture({native:true});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const reply=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Widen two mm'});assert.equal(reply.status,200);
    const proposal=reply.data.proposal;
    // Job is cached by the service; tamper the proposal to refer to an absent job instead.
    const file=path.join(f.root,'data','studio-projects',p.id+'-proposal-'+proposal.id+'.json');const stored=JSON.parse(await readFile(file));stored.jobId='12345678-1234-4234-8234-123456789abc';await writeFile(file,JSON.stringify(stored));
    const applied=await request(url+'/proposals/'+proposal.id+'/apply',{expectedRevision:p.revision,designHash:p.designHash});assert(applied.status>=400);assert.equal((await request(url)).data.designHash,p.designHash);
  }finally{await f.close();}
});


test('user target changes are explicit while repair cannot weaken targets or remove checks',async()=>{
  const {validateUserRefinement,validateRepair}=await import('../server/studio-repair.mjs');
  const original=sample();original.verificationRequests=[{id:'bounds',requirementId:'R1',type:'envelope',partIds:['shell'],maxSizeMm:[40,30,4]}];
  const next=structuredClone(original);next.requirements[0].text='Explicitly approved width 42 mm';next.parts[0].shape.size[0]=42;next.verificationRequests[0].maxSizeMm[0]=42;
  assert.equal(validateUserRefinement(original,next).parts[0].shape.size[0],42);assert.throws(()=>validateRepair(original,next),/requirement/);
  const removed=structuredClone(next);removed.verificationRequests=[];assert.throws(()=>validateUserRefinement(original,removed),/remove, replace or detach/);
  const f=await storeFixture(async()=>({message:'Change the target width to 42 mm',spec:next}));try{
    const p=await f.store.create({request:'Width 40 mm',spec:original});const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'Width 42 mm'})).proposal;
    assert.equal(proposal.decisionChanges.length,2);await assert.rejects(f.store.applyProposal(p.id,proposal.id,{expectedRevision:p.revision,designHash:p.designHash}),/explicitly accept/);
    const applied=await f.store.applyProposal(p.id,proposal.id,{expectedRevision:p.revision,designHash:p.designHash,acceptDecisionChanges:true});assert.equal(applied.spec.parts[0].shape.size[0],42);assert.match(applied.request,/User-confirmed refinement.*Width 42 mm/);assert.equal(applied.appliedProposal.parent.request,p.request);
  }finally{await f.close();}
});

test('printed consumable description updates require explicit confirmation; procurement and repair stay frozen',async()=>{
  const {validateUserRefinement,validateRepair}=await import('../server/studio-repair.mjs');
  const original=sample();original.buildItems=[{id:'pla',name:'PLA',kind:'consumable',quantity:10,unit:'g',specification:'40 mm printed plate',source:'Proposed stock',partIds:['shell']}];
  const next=structuredClone(original);next.parts[0].shape.size[0]=42;next.buildItems[0].specification='42 mm printed plate';
  assert.doesNotThrow(()=>validateUserRefinement(original,next));assert.throws(()=>validateRepair(original,next),/build item/);
  for(const [field,value] of [['quantity',20],['source','Different supplier'],['unit','set'],['kind','fastener']]){
    const invalid=structuredClone(next);invalid.buildItems[0][field]=value;assert.throws(()=>validateUserRefinement(original,invalid),/build item/);
  }
  const unchanged=structuredClone(original);unchanged.buildItems[0].specification='42 mm';assert.throws(()=>validateUserRefinement(original,unchanged),/build item/);
  const f=await storeFixture(async()=>({message:'Proposed resized plate and matching consumable description',spec:next}));
  try{
    const p=await f.store.create({request:'Plate',spec:original});const proposal=(await f.store.assist(p.id,{...requestFor(p),mode:'propose',message:'42 mm'})).proposal;
    assert.equal(proposal.decisionChanges[0].field,'buildItems');assert.equal(proposal.decisionChanges[0].before[0].specification,'40 mm printed plate');
    await assert.rejects(f.store.applyProposal(p.id,proposal.id,{expectedRevision:p.revision,designHash:p.designHash}),/explicitly accept/);
    const applied=await f.store.applyProposal(p.id,proposal.id,{expectedRevision:p.revision,designHash:p.designHash,acceptDecisionChanges:true});assert.equal(applied.spec.buildItems[0].specification,'42 mm printed plate');
  }finally{await f.close();}
});

test('essential follow-up questions keep a published design intact in delivery mode',async()=>{
  const clarification={...sample(),parts:[],assembly:[],questions:[{id:'size',question:'Which size?',options:['40 mm','42 mm']}]};
  const f=await apiFixture({native:true,provider:'codex-bridge',reply:()=>clarification});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'Change size',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    await request(url+'/run',{mode:'deliver',expectedRevision:p.revision});const done=await settled(url);assert.equal(done.workflow.status,'questions');assert.equal(done.designHash,p.designHash);assert.deepEqual(done.spec,p.spec);assert.equal(done.pendingQuestions[0].id,'size');
  }finally{await f.close();}
});


test('online refinement uses one designer call and has no nonexistent compact route run',async()=>{
  const f=await apiFixture({native:true,provider:'codex-bridge',reply:()=>candidate()});try{
    const p=(await request(f.url+'/api/studio/projects',{request:'A shell',spec:sample()})).data,url=f.url+'/api/studio/projects/'+p.id;
    const reply=await request(url+'/assistant',{...requestFor(p),mode:'propose',message:'Widen two mm'});assert.equal(reply.status,200,JSON.stringify(reply.data));assert.equal(f.calls.length,1);assert.equal(reply.data.proposal.nativeChecksPassed,true);assert.equal(reply.data.proposal.metrics.refinementRouteRunId,undefined);
    assert((f.calls[0].format.properties.parts.items.anyOf?.[0]||f.calls[0].format.properties.parts.items).required.includes('explanation'));
  }finally{await f.close();}
});
