import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createGenerationCheckpointStore,generationIdentity,hashGenerationValue} from '../server/studio-generation-checkpoints.mjs';
import {plan,readiness,payload} from './helpers/staged-generation-fixture.mjs';import {partitionGeneration} from '../server/studio-generation-stages.mjs';
export const identity=()=>generationIdentity({projectId:randomUUID(),request:'fixture',answers:[],budget:null,mode:'generate',parentDesignHash:null,inputRevision:1,model:{digest:'a'.repeat(64),name:'fixture',settings:{temperature:0}},skillHash:'b'.repeat(64),schemaHash:'c'.repeat(64),sourceHash:'d'.repeat(64),contextHash:hashGenerationValue({fixture:true})});
test('repair reservation atomically invalidates units and retains bounded repair evidence',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-atomic-repair-')),i=identity(),store=createGenerationCheckpointStore({root}),h=await store.create({projectId:i.identity.projectId,identity:i,contextSnapshot:{fixture:true}}),p=plan();
 await h.saveReadiness(readiness());await h.savePlan(p);const u=partitionGeneration(p)[0];await h.saveUnit({descriptor:u,payload:payload(p,u),dependencyHashes:{plan:hashGenerationValue(p)}});
 await h.beginRepair({keys:[u.key],reason:'Known fixture failure'});
 const restored=await createGenerationCheckpointStore({root}).load({projectId:i.identity.projectId,generationId:h.id,identity:i});assert.equal(restored.snapshot().repairRounds,1);assert.equal(restored.snapshot().units.length,0);assert.equal(restored.snapshot().repairContext[u.key].previousPayload.items[0].id,'p0');
});
test('identity conflicts carry application HTTP 409 status',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-conflict-')),i=identity(),store=createGenerationCheckpointStore({root}),h=await store.create({projectId:i.identity.projectId,identity:i,contextSnapshot:{fixture:true}});
 await assert.rejects(()=>store.load({projectId:i.identity.projectId,generationId:h.id,identity:generationIdentity({...i.identity,request:'changed'})}),e=>e.status===409);
});
test('checkpoint survives restart but rejects changed identity and corrupted payload',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-checkpoint-')),i=identity(),store=createGenerationCheckpointStore({root});
 const h=await store.create({projectId:i.identity.projectId,identity:i,contextSnapshot:{fixture:true}});await h.saveReadiness(readiness());await h.savePlan(plan());
 const u=partitionGeneration(plan())[0];await h.saveUnit({descriptor:u,payload:payload(plan(),u),dependencyHashes:{plan:hashGenerationValue(plan())}});
 const loaded=await createGenerationCheckpointStore({root}).load({projectId:i.identity.projectId,generationId:h.id,identity:i});assert.equal(loaded.snapshot().units[0].payloadHash,hashGenerationValue(payload(plan(),u)));
 for(const change of ['request','skillHash','sourceHash','contextHash','schemaHash']){const input={...i.identity,[change]:'changed'};await assert.rejects(()=>store.load({projectId:i.identity.projectId,generationId:h.id,identity:generationIdentity(input)}));}
 await assert.rejects(()=>store.load({projectId:randomUUID(),generationId:h.id,identity:i}));await assert.rejects(()=>store.load({projectId:'../escape',generationId:h.id,identity:i}));
 const file=path.join(root,'data/design-checkpoints',i.identity.projectId,h.id,'state.json');const state=JSON.parse(await readFile(file,'utf8'));state.units[0].payload.items[0].name='tampered';await writeFile(file,JSON.stringify(state));await assert.rejects(()=>store.load({projectId:i.identity.projectId,generationId:h.id,identity:i}));
});
test('canonical answers ignore order/progress revision but preserve semantic changes',()=>{
 const a=identity().identity;const x={...a,answers:[{id:'b',answer:'2'},{id:'a',answer:'1'}]};assert.equal(generationIdentity(x).hash,generationIdentity({...x,inputRevision:99,answers:[...x.answers].reverse()}).hash);assert.notEqual(generationIdentity(x).hash,generationIdentity({...x,answers:[]}).hash);
});
test('checkpoint rejects oversized payloads, invalid dependencies and unsafe paths',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-checkpoint-')),i=identity(),store=createGenerationCheckpointStore({root}),h=await store.create({projectId:i.identity.projectId,identity:i,contextSnapshot:{fixture:true}});
 await h.saveReadiness(readiness());await h.savePlan(plan());const u=partitionGeneration(plan())[0];
 await assert.rejects(()=>h.saveUnit({descriptor:u,payload:{text:'x'.repeat(262145)},dependencyHashes:{}}));
 await assert.rejects(()=>h.saveUnit({descriptor:u,payload:payload(plan(),u),dependencyHashes:{plan:'wrong'}}));await assert.rejects(()=>h.finish('PASS'));
 const dir=path.join(root,'data/design-checkpoints',i.identity.projectId,h.id);await writeFile(path.join(dir,'abandoned.tmp'),'incomplete');assert.equal((await store.load({projectId:i.identity.projectId,generationId:h.id,identity:i})).snapshot().units.length,0);
 const other=await mkdtemp(path.join(tmpdir(),'m4ke-checkpoint-link-'));await mkdir(path.join(other,'data'));await symlink(path.join(root,'data/design-checkpoints'),path.join(other,'data/design-checkpoints'),'junction');await assert.rejects(()=>createGenerationCheckpointStore({root:other}).create({projectId:i.identity.projectId,identity:i,contextSnapshot:{fixture:true}}),/symlink/);
});
