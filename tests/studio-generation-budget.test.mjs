import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {randomUUID}from'node:crypto';
import {createGenerationCheckpointStore,generationIdentity,hashGenerationValue}from'../server/studio-generation-checkpoints.mjs';
import {readiness,plan}from'./helpers/staged-generation-fixture.mjs';
import {partitionGeneration}from'../server/studio-generation-stages.mjs';
async function setup(n=24){const root=await mkdtemp(path.join(tmpdir(),'m4ke-budget-')),i=generationIdentity({projectId:randomUUID(),request:'test',answers:[],model:{digest:'a'},skillHash:'b',schemaHash:'c',sourceHash:'d',contextHash:hashGenerationValue({})});const store=createGenerationCheckpointStore({root}),h=await store.create({projectId:i.identity.projectId,identity:i,contextSnapshot:{}});await h.saveReadiness(readiness());await h.savePlan(plan(n));return {root,i,h};}
test('planning reserves its larger allowance within the unchanged total budget',async()=>{
 const {h}=await setup();const r=await h.reserve({unitKey:'plan',tokenLimit:5000,timeoutMs:300000});
 assert.equal(h.remaining().requestedOutputTokens,55000);assert.equal(h.remaining().requests,63);assert.equal(h.remaining().activeMs,2100000);
 await h.settle(r.reservationId,{elapsedMs:100,outcome:'length'});assert.equal(h.remaining().requestedOutputTokens,55000);
 await assert.rejects(()=>h.reserve({unitKey:'plan',tokenLimit:5001,timeoutMs:300000}));
});
test('allowances are reserved before dispatch and cannot be refunded on restart',async()=>{
 const {root,i,h}=await setup();const r=await h.reserve({unitKey:'readiness',tokenLimit:1500,timeoutMs:180000});assert.equal(h.remaining().requests,63);assert.equal(h.remaining().activeMs,2220000);
 const restored=await createGenerationCheckpointStore({root}).load({projectId:i.identity.projectId,generationId:h.id,identity:i});assert.deepEqual(restored.remaining(),h.remaining());
 // A receipt orphaned by restart must never settle or publish later.
 await assert.rejects(()=>restored.settle(r.reservationId,{elapsedMs:10,outcome:'stop'}));
 await assert.rejects(()=>h.reserve({unitKey:'readiness',tokenLimit:1501,timeoutMs:180000}));
});
test('settlement releases unused time only, retry counters and split children stay bounded',async()=>{
 const {h}=await setup();const r=await h.reserve({unitKey:'part-0',tokenLimit:3000,timeoutMs:240000});await h.settle(r.reservationId,{elapsedMs:1000,outcome:'length',evalCount:25});assert.equal(h.remaining().requestedOutputTokens,57000);assert.equal(h.remaining().activeMs,2399000);
 await assert.rejects(()=>h.settle(r.reservationId,{elapsedMs:1,outcome:'stop'}));
 await h.startSplit('part-0');const child=await h.reserve({unitKey:'part-0~0',tokenLimit:3000,timeoutMs:240000});await h.settle(child.reservationId,{elapsedMs:1,outcome:'error'});
 await assert.rejects(()=>h.reserve({unitKey:'part-0~0',tokenLimit:3000,timeoutMs:240000}));await assert.rejects(()=>h.reserve({unitKey:'part-0',tokenLimit:3000,timeoutMs:240000}));
 for(const tokenLimit of [0,-1,NaN])await assert.rejects(()=>h.reserve({unitKey:'part-1',tokenLimit,timeoutMs:240000}));
 await h.beginRepair({keys:[],reason:'Budget-only fixture'});await assert.rejects(()=>h.beginRepair({keys:[],reason:'Budget-only fixture'}));
});
test('active time cannot exceed forty minutes even when requests crash',async()=>{
 const {h}=await setup();
 for(let i=0;i<8;i++)await h.reserve({unitKey:'part-'+i,tokenLimit:3000,timeoutMs:240000});
 await h.reserve({unitKey:'assembly-0',tokenLimit:3000,timeoutMs:240000});await h.reserve({unitKey:'metadata-0',tokenLimit:3000,timeoutMs:240000});
 assert.equal(h.remaining().activeMs,0);await assert.rejects(()=>h.reserve({unitKey:'plan',tokenLimit:4000,timeoutMs:300000}),/budget/);
});
test('requested output cap persists even when actual output was short',async()=>{
 const {h}=await setup();
 const keys=partitionGeneration(h.snapshot().plan).map(u=>u.key);
 for(const key of keys)for(let i=0;i<2;i++){const r=await h.reserve({unitKey:key,tokenLimit:3000,timeoutMs:240000});await h.settle(r.reservationId,{elapsedMs:1,outcome:'error',evalCount:1});}
 assert.equal(h.remaining().requestedOutputTokens,0);await h.beginRepair({keys:[],reason:'Budget-only fixture'});await assert.rejects(()=>h.reserve({unitKey:'part-0',tokenLimit:1,timeoutMs:1}),/budget/);
});
