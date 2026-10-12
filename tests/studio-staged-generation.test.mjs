import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp}from'node:fs/promises';import {tmpdir}from'node:os';import path from'node:path';import {randomUUID}from'node:crypto';
import {createGenerationCheckpointStore,generationIdentity,hashGenerationValue}from'../server/studio-generation-checkpoints.mjs';
import {runStagedGeneration}from'../server/studio-staged-generation.mjs';import {validateDesignSpec}from'../server/studio-contract.mjs';import {plan,readiness,payload}from'./helpers/staged-generation-fixture.mjs';
import {assertGenerationSchema} from '../server/studio-generation-stages.mjs';
import {ollamaProjection} from '../server/studio-schema.mjs';
const response=v=>({content:JSON.stringify(v),doneReason:'stop',metrics:{evalCount:1}});
test('later-stage decoder permits its payload or questions, never a ready-only response',async()=>{
 const c=await setup(1),base=c.infer,seen=[];
 c.infer=async args=>{
  const normal=await base(args);
  // This runner fixture otherwise uses a color outside the decoder's fixed palette.
  if(args.unit.kind==='part'){
   const decoded=JSON.parse(normal.content);for(const part of decoded.items)part.color='#808080';normal.content=JSON.stringify(decoded);
  }
  assertGenerationSchema(JSON.parse(normal.content),args.schema);
  if(args.unit.key!=='readiness'){
   seen.push(args.unit.kind);
   for(const schema of [args.schema,ollamaProjection(args.schema)]){
    assertGenerationSchema(JSON.parse(normal.content),schema);
    assert.throws(()=>assertGenerationSchema(readiness(),schema),/no permitted shape/);
    assertGenerationSchema({...readiness(),status:'questions',questions:[{id:'q',question:'Confirm an essential input?'}]},schema);
    assert.throws(()=>assertGenerationSchema({...readiness(),status:'questions'},schema));
   }
  }
  return normal;
 };
 assert.equal((await runStagedGeneration(c)).status,'accepted');
 assert.ok(seen.includes('plan'));assert.ok(seen.includes('part'));assert.ok(seen.includes('metadata'));assert.ok(seen.includes('assembly'));
});
async function setup(n=5){const root=await mkdtemp(path.join(tmpdir(),'m4ke-runner-'));const contextSnapshot={sources:{catalogIds:[],libraryHashes:[]}},identity=generationIdentity({projectId:randomUUID(),request:'fixture',answers:[],model:{digest:'a'},skillHash:'b',schemaHash:'c',sourceHash:'d',contextHash:hashGenerationValue(contextSnapshot)}),calls=[],p=plan(n);return {root,identity,contextSnapshot,store:createGenerationCheckpointStore({root}),calls,p,buildMessages:()=>[{role:'system',content:'Fixture upstream skill'}],infer:async({unit})=>{calls.push(unit.key);return response(unit.key==='readiness'?readiness():unit.key==='plan'?p:payload(p,unit));},admit:raw=>({spec:validateDesignSpec(raw),issues:[]})};}
test('essential questions stop before plan, geometry or admission',async()=>{
 const c=await setup();let admitted=false;c.infer=async({unit})=>{c.calls.push(unit.key);return response({...readiness(),status:'questions',questions:[{id:'battery',question:'Which battery?'}]});};c.admit=()=>{admitted=true;throw Error('must not admit');};
 const result=await runStagedGeneration(c);assert.equal(result.status,'questions');assert.deepEqual(c.calls,['readiness']);assert.equal(admitted,false);assert.deepEqual(result.spec.parts,[]);
});
test('truncated second batch splits once without regenerating first batch',async()=>{
 const c=await setup(),base=c.infer;c.infer=async args=>{if(args.unit.key==='part-1'){c.calls.push('part-1');return {content:'{"items":[',doneReason:'length'};}return base(args);};
 const result=await runStagedGeneration(c);assert.equal(result.status,'accepted');assert.equal(c.calls.filter(k=>k==='part-0').length,1);assert.ok(c.calls.includes('part-1~0'));assert.ok(c.calls.includes('part-1~1'));assert.equal(result.spec.parts.length,5);
});
test('transport failure resumes from durable units with unchanged hashes',async()=>{
 const c=await setup(),base=c.infer;let generationId;c.onProgress=p=>{generationId=p.generationId;};c.infer=async args=>{if(args.unit.key==='part-1')throw Error('offline');return base(args);};await assert.rejects(()=>runStagedGeneration(c),e=>e.canResume===true);
 const old=await c.store.load({projectId:c.identity.identity.projectId,generationId,identity:c.identity}),hash=old.snapshot().units[0].payloadHash;
 const result=await runStagedGeneration({...c,store:createGenerationCheckpointStore({root:c.root}),infer:base,resumeGenerationId:generationId});assert.equal(result.status,'accepted');assert.equal(c.calls.filter(k=>k==='part-0').length,1);
 const loaded=await createGenerationCheckpointStore({root:c.root}).load({projectId:c.identity.identity.projectId,generationId,identity:c.identity});assert.equal(loaded.snapshot().units[0].payloadHash,hash);
});
test('single-item truncation and unknown final admission error never become accepted',async()=>{
 const c=await setup(1),base=c.infer;c.infer=args=>args.unit.kind==='part'?{content:'{}',doneReason:'length'}:base(args);await assert.rejects(()=>runStagedGeneration(c),e=>!e.canResume);
 const d=await setup(1);d.admit=()=>({spec:null,issues:[{message:'unknown',unitKeys:[],attribution:'unknown'}]});await assert.rejects(()=>runStagedGeneration(d),/unknown/);assert.equal(d.calls.filter(k=>k==='part-0').length,1);
});
test('queued cancellation makes no inference call and prompt overflow stops explicitly',async()=>{
 const c=await setup();const ctl=new AbortController();ctl.abort();await assert.rejects(()=>runStagedGeneration({...c,signal:ctl.signal}));assert.equal(c.calls.length,0);
 const d=await setup();await assert.rejects(()=>runStagedGeneration({...d,buildMessages:()=>[{role:'system',content:'x'.repeat(65536)}]}),/context/);assert.equal(d.calls.length,0);
});
test('known final error repairs one batch and its dependencies only',async()=>{
 const c=await setup(5);let n=0;c.admit=raw=>++n===1?{spec:null,issues:[{message:'local issue',unitKeys:['part-1'],attribution:'exact'}]}:{spec:validateDesignSpec(raw),issues:[]};const result=await runStagedGeneration(c);assert.equal(result.status,'accepted');assert.equal(c.calls.filter(k=>k==='part-0').length,1);assert.equal(c.calls.filter(k=>k==='part-1').length,2);
});
test('global repair sends failed payload and triggering diagnostic after restart',async()=>{
 const c=await setup(5),base=c.infer;let id,repairCalls=0,admissions=0;
 c.onProgress=p=>{id=p.generationId;};c.admit=raw=>++admissions===1?{spec:null,issues:[{message:'p3: fixture shoulder missing',unitKeys:['part-1'],attribution:'exact'}]}:{spec:validateDesignSpec(raw),issues:[]};
 c.infer=async args=>{if(args.unit.key==='part-1'&&c.calls.includes('part-1')){repairCalls++;if(repairCalls===1)throw Error('fixture disconnect during repair');const prompt=JSON.parse(args.messages.at(-1).content);assert.match(JSON.stringify(prompt.repairContext),/shoulder missing/);assert.equal(prompt.repairContext.previousPayload.items[0].id,'p3');}return base(args);};
 await assert.rejects(()=>runStagedGeneration(c),/disconnect/);
 const result=await runStagedGeneration({...c,store:createGenerationCheckpointStore({root:c.root}),resumeGenerationId:id});assert.equal(result.status,'accepted');assert.equal(c.calls.filter(k=>k==='part-0').length,1);
});
test('late clarification returns no partial geometry and bounded invalid output stops',async()=>{
 const c=await setup(),base=c.infer;c.infer=args=>args.unit.key==='part-1'?response({...readiness(),status:'questions',questions:[{id:'q',question:'Confirm material?'}]}):base(args);
 const result=await runStagedGeneration(c);assert.equal(result.status,'questions');assert.deepEqual(result.spec.parts,[]);
 const d=await setup(1),normal=d.infer;let attempts=0;d.infer=args=>args.unit.kind==='part'?(attempts++,response({items:[]})):normal(args);
 await assert.rejects(()=>runStagedGeneration(d));assert.equal(attempts,2);
});
test('cancel between validated units retains resumable state',async()=>{
 const c=await setup(),ctl=new AbortController();c.onProgress=p=>{if(p.stage==='part'&&p.validatedUnits===1)ctl.abort();};
 await assert.rejects(()=>runStagedGeneration({...c,signal:ctl.signal}),e=>e.canResume===true);assert.equal(c.calls.includes('part-1'),false);
});
