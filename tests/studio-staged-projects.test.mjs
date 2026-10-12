import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {createProjectStore}from'../server/studio-projects.mjs';
const delay=()=>new Promise(r=>setTimeout(r,5));
import {randomUUID} from 'node:crypto';
import {createStagedService} from '../server/studio-staged-service.mjs';
import {createGenerationCheckpointStore} from '../server/studio-generation-checkpoints.mjs';
test('restart does not offer resume when readiness attempts are exhausted',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-eligibility-')),project={id:randomUUID(),revision:1,request:'Fixture',answers:[],budget:''};
 const config={root,enabled:()=>true,getSettings:()=>({provider:'ollama',model:'fixture'}),getModels:async()=>[{name:'fixture',digest:'digest'}],localCatalog:async()=>({components:[]}),sourcing:{call:async()=>({entries:[],snapshotSha256:'fixture'})}};const service=createStagedService(config);
 const prepared=await service.prepareWorkflow(project,{mode:'design'});project.workflow={...prepared,mode:'design'};
 assert.equal(await service.resumeState(project),true);
 const store=createGenerationCheckpointStore({root}),saved=await store.inspect({projectId:project.id,generationId:prepared.generationId}),h=await store.load({projectId:project.id,generationId:prepared.generationId,identity:saved.state.identity});
 for(let n=0;n<2;n++)await h.reserve({unitKey:'readiness',tokenLimit:1500,timeoutMs:180000});
 assert.equal(await createStagedService(config).resumeState(project),false);
});
test('owned cancellation blocks late publication and retains admission until exit',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-staged-projects-'));let release,entered=false,exited=false,pricing=0;
 const gate=new Promise(r=>release=r);const store=createProjectStore({root,prepareWorkflow:async()=>({canCancel:true}),execute:async(p,i,save,signal)=>{entered=true;await gate;try{await save({spec:{unsafe:true},workflow:{status:'draft'}});}finally{exited=true;}},priceDesign:()=>{pricing++;}});
 const p=await store.create({request:'fixture'});await store.start(p.id,{mode:'design',expectedRevision:p.revision});while(!entered)await delay();const current=await store.get(p.id);
 await assert.rejects(()=>store.cancel(p.id,{expectedRevision:current.revision,workflowId:'wrong'}));
 await store.cancel(p.id,{expectedRevision:current.revision,workflowId:current.workflow.id});assert.equal(store.isRunning(),true);assert.equal(exited,false);await assert.rejects(()=>store.start(p.id,{mode:'design'}));
 release();while(store.isRunning())await delay();const end=await store.get(p.id);assert.equal(end.workflow.status,'error');assert.equal(end.spec,undefined);assert.equal(pricing,0);
 await store.cancel(p.id,{expectedRevision:end.revision,workflowId:end.workflow.id});
});
test('resume requires current revision and matching generation before executor runs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-staged-projects-'));let calls=0;
 const store=createProjectStore({root,prepareWorkflow:async(p,i)=>{if(i.resumeGenerationId)throw Object.assign(Error('stale checkpoint'),{status:409});return {};},execute:async()=>{calls++;}});const p=await store.create({request:'fixture'});
 await assert.rejects(()=>store.start(p.id,{resumeGenerationId:'bad'}));await assert.rejects(()=>store.start(p.id,{expectedRevision:99,resumeGenerationId:p.id}));await assert.rejects(()=>store.start(p.id,{expectedRevision:p.revision,resumeGenerationId:p.id}),/stale checkpoint/);assert.equal(calls,0);assert.equal((await store.get(p.id)).revision,p.revision);
});
