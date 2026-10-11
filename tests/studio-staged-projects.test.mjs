import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {createProjectStore}from'../server/studio-projects.mjs';
const delay=()=>new Promise(r=>setTimeout(r,5));
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
