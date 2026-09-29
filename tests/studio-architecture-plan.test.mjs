import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PHYSICS_RANGES} from '../server/studio-contract.mjs';
import {architectureCatalogContext,architecturePlanSchema,validateArchitecturePlan,inspectArchitecturePlan,planArchitecture} from '../server/studio-architecture-plan.mjs';

// Entirely synthetic inference/catalog fixtures. No model, CAD, network or real toy.
const rating=(value,unit)=>({value,unit,basis:'MANUFACTURER_PUBLISHED'});
const catalog={manifestSha256:'c'.repeat(64),components:[
  ...[['slow',20],['fast',300]].map(([id,rpm])=>({id,name:'Synthetic '+id,geometry:{step:'models/'+id+'.step',sha256:'a'.repeat(64)},ratings:{voltageV:rating(6,'V'),noLoadRpm:rating(rpm,'rpm'),theoreticalStallTorqueKgfCm:rating(1,'kgf*cm'),theoreticalStallCurrentA:rating(.5,'A')},interfaces:[{type:'shaft-axis',dimensions:{axis:[0,0,1],diameterMm:3},sourceCoordinates:{never:'copy this large source record'}}]})),
  {id:'data-only',name:'Metadata only',geometry:null,ratings:{},interfaces:[]}
]};
const input=(value,basis='ASSUMED')=>({value,basis,source:'Synthetic test provenance; no physical evidence'});
const inputs=rpm=>Object.fromEntries(Object.entries({massKg:.2,rollingResistance:.02,wheelRadiusMm:30,driveMotors:2,motorVoltage:6,batteryVoltage:5,motorNoLoadRpm:rpm,motorStallTorqueNm:.0980665,targetSpeedMS:.5,thresholdDbfs:-25,accelerationMS2:.1,gradeDeg:0,tractionCoefficient:.5,drivenWeightFraction:.6,transmissionEfficiency:.8,motorContinuousTorqueFraction:.3,batteryMaxVoltage:5.5,driverMinVoltage:2.7,driverMaxVoltage:10.8}).map(([key,value])=>[key,input(value)]));
const failed=()=>({parts:[{id:'motor',shape:{type:'catalog',catalogId:'slow'}}],physicsInputs:inputs(20),requirements:[{id:'R1',text:'Synthetic target .5'}],assumptions:[]});
const good=()=>({questions:[],selectedCatalogIds:['fast'],physicsInputs:inputs(300),assumptions:['Friction and loads are synthetic assumptions.'],unknowns:['Physical operation is UNKNOWN.'],powerArchitecture:'Synthetic compatible one-domain motor supply; logic isolation requires later netlist review.'});
const bad=()=>({...good(),selectedCatalogIds:['slow'],physicsInputs:inputs(20)});
const questions=()=>({questions:[{id:'source',question:'Which measured constraint applies?',options:['First supplied value','Second supplied value']}],selectedCatalogIds:[],physicsInputs:{},assumptions:[],unknowns:['Missing fact'],powerArchitecture:'Pending essential clarification.'});
const skill=await readFile(new URL('../skills/prompt-to-cad/runtime-architecture.md',import.meta.url),'utf8');
const skillHash=createHash('sha256').update(skill).digest('hex');
const args=(infer)=>({request:'Synthetic architecture test; do not build.',answers:[],failedDraft:failed(),catalog,skills:{architecture:skill,hashes:{architecture:skillHash}},model:'fixture-local-model',endpoint:'http://127.0.0.1:11434',infer});
const answer=plan=>({message:{content:JSON.stringify(plan)},done_reason:'stop',eval_count:100,total_duration:1000});

test('compact schema carries source IDs and contract physics, not geometry or source documents',()=>{
  const ctx=architectureCatalogContext(catalog,failed()),schema=architecturePlanSchema(catalog,failed());
  assert.deepEqual(schema.properties.selectedCatalogIds.items.enum,['slow','fast']);assert.equal(schema.properties.physicsInputs.anyOf[0].properties.targetSpeedMS.properties.value.maximum,5);assert.equal(schema.additionalProperties,false);
  assert.equal(ctx.components.find(c=>c.id==='data-only').nativeAvailable,false);assert.ok(!JSON.stringify(ctx).includes('sourceCoordinates'));assert.ok(!JSON.stringify(ctx).includes('never'));assert.equal(ctx.catalogHash,catalog.manifestSha256);
  assert.deepEqual(Object.keys(schema.properties),['questions','selectedCatalogIds','physicsInputs','assumptions','unknowns','powerArchitecture']);
});

test('decoder requires every valid existing numerical key or the strictly empty clarification alternative without a root union',()=>{
  const old=failed();old.physicsInputs=Object.fromEntries(Object.entries(PHYSICS_RANGES).slice(0,30).map(([key,[minimum]])=>[key,input(minimum)]));
  const before=structuredClone(old),schema=architecturePlanSchema(catalog,old),[complete,empty]=schema.properties.physicsInputs.anyOf;
  assert.equal(schema.type,'object');assert.equal(schema.anyOf,undefined);assert.deepEqual(complete.required,Object.keys(old.physicsInputs));assert.equal(complete.required.length,30);assert.deepEqual(empty,{type:'object',properties:{},required:[],additionalProperties:false});assert.deepEqual(old,before);
  for(const key of complete.required){assert.ok(complete.properties[key]);assert.deepEqual(complete.properties[key].required,['value','basis','source']);}
  const passive=architecturePlanSchema(catalog,{});assert.deepEqual(passive.properties.physicsInputs.required,[]);assert.equal(passive.properties.physicsInputs.anyOf,undefined);
});

test('omitted existing physics keys and unresolved maximum-voltage missing inputs are explicitly enumerated',()=>{
  const old=failed();old.physicsInputs.batteryMaxVoltage.value=8.4;
  const p=good();for(const key of ['batteryMaxVoltage','driverMinVoltage','motorVoltage','tractionCoefficient'])delete p.physicsInputs[key];
  const result=inspectArchitecturePlan(p,{failedDraft:old,catalog});assert.equal(result.status,'FAILED');
  const missing=result.issues.find(x=>x.startsWith('Non-question architecture omitted'));
  for(const key of ['batteryMaxVoltage','driverMinVoltage','motorVoltage','tractionCoefficient'])assert.ok(missing.includes(key),key);
  const voltage=result.issues.find(x=>x.startsWith('maximum-supply-voltage: previously'));
  assert.match(voltage,/Missing inputs for this check: batteryMaxVoltage, driverMinVoltage, motorVoltage/);
  const empty={...good(),physicsInputs:{},selectedCatalogIds:[]};assert.equal(inspectArchitecturePlan(empty,{failedDraft:old,catalog}).status,'FAILED');
  assert.equal(inspectArchitecturePlan(questions(),{failedDraft:old,catalog}).status,'QUESTIONS');
});

test('one malformed prior field cannot erase other valid inputs or a known supply failure',()=>{
  const old=failed();old.physicsInputs.batteryMaxVoltage.value=8.4;old.physicsInputs.beamSpanMm=input(NaN);
  const p=good();delete p.physicsInputs.batteryMaxVoltage;
  const schema=architecturePlanSchema(catalog,old),required=schema.properties.physicsInputs.anyOf[0].required;
  assert.ok(required.includes('batteryMaxVoltage'));assert.ok(required.includes('driverMinVoltage'));assert.ok(!required.includes('beamSpanMm'));
  const issues=inspectArchitecturePlan(p,{failedDraft:old,catalog}).issues.join('\n');assert.match(issues,/maximum-supply-voltage: previously known failure/);assert.match(issues,/Missing inputs for this check: batteryMaxVoltage/);
});

test('previously complete numerical context cannot be silently shortened even when omitted check had no prior FAIL',()=>{
  const old=failed(),p=good();delete p.physicsInputs.driverMinVoltage;
  const result=inspectArchitecturePlan(p,{failedDraft:old,catalog});assert.equal(result.status,'FAILED');assert.match(result.issues.join('\n'),/omitted required physicsInputs: driverMinVoltage/);
  delete old.physicsInputs.driverMinVoltage;const unknown=inspectArchitecturePlan(p,{failedDraft:old,catalog});assert.equal(unknown.status,'ACCEPTED');assert.equal(unknown.checks.find(c=>c.id==='maximum-supply-voltage').status,'UNKNOWN');
});

test('plan contract rejects injected fields, malformed physics, duplicate IDs and mixed clarification',()=>{
  assert.deepEqual(validateArchitecturePlan(good()),good());
  for(const mutate of [p=>p.code='run()',p=>p.selectedCatalogIds=['fast','fast'],p=>p.physicsInputs.massKg.value=NaN,p=>p.physicsInputs.driveMotors.value=1.5,p=>p.physicsInputs.massKg.basis='VERIFIED',p=>p.physicsInputs.extra=input(1),p=>p.powerArchitecture='',p=>p.questions=[...questions().questions]]){const p=good();mutate(p);assert.throws(()=>validateArchitecturePlan(p));}
  assert.doesNotThrow(()=>validateArchitecturePlan(questions()));
  const accessor=good();Object.defineProperty(accessor,'physicsInputs',{get(){throw Error('getter executed');}});assert.throws(()=>validateArchitecturePlan(accessor),/unsupported key\/accessor/);
});

test('accepted architecture is conditional with UNKNOWNs, not physical or source qualification',()=>{
  const p=good(),before=structuredClone(p),r=inspectArchitecturePlan(p,{failedDraft:failed(),catalog});assert.equal(r.status,'ACCEPTED');assert.deepEqual(r.issues,[]);assert.equal(r.checks.find(c=>c.id==='motion-operating-point').status,'PASS');assert.ok(r.unknowns.includes('Physical operation is UNKNOWN.'));assert.deepEqual(p,before);assert.equal(r.plan.physicsInputs.massKg.basis,'ASSUMED');
});

test('all existing numeric failures, source contradictions and voltage conflicts are aggregated',()=>{
  const p=bad();p.physicsInputs.batteryVoltage.value=7.4;p.physicsInputs.batteryMaxVoltage.value=8.4;p.physicsInputs.motorNoLoadRpm.value=21;
  const r=inspectArchitecturePlan(p,{failedDraft:failed(),catalog}),all=r.issues.join('\n');assert.equal(r.status,'FAILED');assert.match(all,/contradicts selected slow/);assert.match(all,/7.4 V exceeds/);assert.match(all,/8.4 V exceeds/);assert.match(all,/motion-operating-point/);assert.match(all,/maximum-supply-voltage/);
});

test('targets, missing-input laundering and discarding published motor identities cannot clear failure',()=>{
  for(const mutate of [p=>p.physicsInputs.targetSpeedMS.value=.01,p=>delete p.physicsInputs.targetSpeedMS,p=>p.physicsInputs.thresholdDbfs.value=-40,p=>delete p.physicsInputs.motorNoLoadRpm,p=>p.selectedCatalogIds=[]]){const p=good();mutate(p);assert.equal(inspectArchitecturePlan(p,{failedDraft:failed(),catalog}).status,'FAILED');}
  const old=failed();old.physicsInputs.massKg=input(.2,'USER');const p=good();p.physicsInputs.massKg.value=.01;assert.match(inspectArchitecturePlan(p,{failedDraft:old,catalog}).issues.join('\n'),/Preserve original massKg/);
  const p2=good();p2.selectedCatalogIds=['data-only'];assert.match(inspectArchitecturePlan(p2,{failedDraft:failed(),catalog}).issues.join('\n'),/no admitted source STEP/);
});

test('missing facts stay UNKNOWN for an architecture with no prior known failure; passive and questions remain valid',()=>{
  const p=good();delete p.physicsInputs.motorNoLoadRpm;const old=failed();delete old.physicsInputs.motorNoLoadRpm;
  const r=inspectArchitecturePlan(p,{failedDraft:old,catalog});assert.equal(r.status,'ACCEPTED');assert.equal(r.checks.find(c=>c.id==='motion-operating-point').status,'UNKNOWN');assert.ok(r.unknowns.some(x=>x.id==='motion-operating-point'));
  const passive={...good(),selectedCatalogIds:[],physicsInputs:{},powerArchitecture:'Passive mechanism; no electrical power.'};assert.equal(inspectArchitecturePlan(passive,{failedDraft:{},catalog}).status,'ACCEPTED');assert.equal(inspectArchitecturePlan(questions(),{failedDraft:failed(),catalog}).status,'QUESTIONS');
});

test('bounded model retry receives every host failure and retains raw/hash lineage without modifying failed draft',async()=>{
  const calls=[],replies=[answer(bad()),answer(good())],options=args(async(endpoint,route,options,timeout,signal)=>{calls.push({endpoint,route,payload:JSON.parse(options.body),timeout,signal});return replies.shift();}),before=structuredClone(options.failedDraft);
  const result=await planArchitecture(options);assert.equal(result.status,'ACCEPTED');assert.equal(calls.length,2);assert.deepEqual(options.failedDraft,before);assert.deepEqual(result.plan,good());
  const retry=JSON.parse(calls[1].payload.messages[1].content);assert.ok(retry.hostFailures.some(x=>x.includes('motion-operating-point')));assert.deepEqual(retry.previousPlan,bad());assert.equal(retry.preservedTargets.targetSpeedMS,.5);assert.deepEqual(new Set(retry.requiredPhysicsKeys),new Set(Object.keys(options.failedDraft.physicsInputs)));assert.deepEqual(calls[0].payload.format.properties.physicsInputs.anyOf[0].required,retry.requiredPhysicsKeys);assert.equal(calls[0].payload.think,false);assert.equal(calls[0].payload.options.num_ctx,16384);assert.equal(calls[0].payload.options.num_predict,3000);assert.equal(calls[0].timeout,300000);
  assert.equal(result.record.attempts[0].content,JSON.stringify(bad()));assert.equal(result.record.attempts[1].content,JSON.stringify(good()));assert.match(result.record.planHash,/^[0-9a-f]{64}$/);assert.equal(result.record.modelSkillHash,skillHash);assert.equal(result.record.catalogHash,catalog.manifestSha256);assert.equal(result.record.physical,'UNKNOWN');assert.equal(result.record.verificationEvidence,false);
});

test('partial numeric plan retry receives exact omitted keys and keeps the complete decoder requirement',async()=>{
  const old=failed();old.physicsInputs.batteryMaxVoltage.value=8.4;
  const partial=good();for(const key of ['batteryMaxVoltage','driverMinVoltage','motorVoltage'])delete partial.physicsInputs[key];
  const calls=[],replies=[answer(partial),answer(good())];
  const result=await planArchitecture({...args(async(_endpoint,_route,options)=>{calls.push(JSON.parse(options.body));return replies.shift();}),failedDraft:old});
  assert.equal(result.status,'ACCEPTED');assert.equal(calls.length,2);assert.deepEqual(calls[0].format,calls[1].format);
  const retry=JSON.parse(calls[1].messages[1].content);assert.deepEqual(retry.previousPlan,partial);
  const missing=retry.hostFailures.find(x=>x.startsWith('Non-question architecture omitted'));
  for(const key of ['batteryMaxVoltage','driverMinVoltage','motorVoltage']){assert.ok(missing.includes(key));assert.ok(retry.requiredPhysicsKeys.includes(key));assert.ok(calls[1].format.properties.physicsInputs.anyOf[0].required.includes(key));}
  assert.match(retry.hostFailures.join('\n'),/maximum-supply-voltage: previously known failure.*Missing inputs for this check: batteryMaxVoltage, driverMinVoltage, motorVoltage/);
  assert.equal(result.record.attempts[0].content,JSON.stringify(partial));assert.equal(result.record.attempts[1].content,JSON.stringify(good()));assert.deepEqual(result.plan.physicsInputs,good().physicsInputs);
});

test('model failure, truncation and transport remain bounded; no fixed-plan fallback',async()=>{
  let n=0;const unchanged=await planArchitecture(args(async()=>{n++;return answer(bad());}));assert.equal(n,2);assert.equal(unchanged.status,'FAILED');assert.equal(unchanged.plan,null);assert.equal(unchanged.record.planHash,null);
  n=0;const truncated=await planArchitecture(args(async()=>{n++;return {...answer(good()),done_reason:'length'};}));assert.equal(n,2);assert.equal(truncated.status,'FAILED');assert.ok(truncated.record.errors.every(x=>x.includes('truncated')));
  n=0;const transport=await planArchitecture(args(async()=>{n++;throw Object.assign(Error('Synthetic transport failure'),{code:'ECONNRESET'});}));assert.equal(n,1);assert.equal(transport.status,'FAILED');assert.equal(transport.record.attempts[0].code,'ECONNRESET');
});

test('model clarification is returned without geometry and cancellation does not invoke inference',async()=>{
  const result=await planArchitecture(args(async()=>answer(questions())));assert.equal(result.status,'QUESTIONS');assert.deepEqual(result.plan.questions,questions().questions);assert.equal(result.plan.parts,undefined);
  const controller=new AbortController();controller.abort();let called=false;const cancelled=await planArchitecture({...args(async()=>{called=true;return answer(good());}),signal:controller.signal});assert.equal(called,false);assert.equal(cancelled.status,'FAILED');assert.equal(cancelled.record.cancelled,true);
  await assert.rejects(planArchitecture({...args(async()=>answer(good())),skills:{architecture:skill,hashes:{architecture:'wrong'}}}),/hash mismatch/);
});
