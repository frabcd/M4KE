import test from 'node:test';import assert from 'node:assert/strict';
import {validateReadiness,validateGenerationPlan,partitionGeneration,validateGenerationUnit,assembleGeneration,dependentUnitKeys} from '../server/studio-generation-stages.mjs';
import {readiness,plan,payload,proposal} from './helpers/staged-generation-fixture.mjs';
import {validateGenerationProposal,planProposalSchema} from '../server/studio-generation-stages.mjs';

test('host copies intake text exactly while model proposes only bounded new disclosures',()=>{
 const r={...readiness(),assumptions:['原始假设：不改变'],unknowns:['原始缺口：未经实测']},p={...plan(),assumptions:[...r.assumptions,'New assumption'],unknowns:[...r.unknowns,'New uncertainty']};
 const before=JSON.stringify(r),generated=proposal(p,r),result=validateGenerationProposal(generated,{readiness:r});
 assert.deepEqual(result.requirements,r.requirements);assert.deepEqual(result.assumptions,p.assumptions);assert.deepEqual(result.unknowns,p.unknowns);assert.equal(JSON.stringify(r),before);
 for(const key of ['requirements','assumptions','unknowns'])assert.throws(()=>validateGenerationProposal({...generated,[key]:[]},{readiness:r}),/unsupported key/);
 const full={...r,assumptions:Array(40).fill('A'),unknowns:Array(40).fill('U')},schema=planProposalSchema(full);
 assert.equal(schema.properties.newAssumptions.maxItems,0);assert.equal(schema.properties.newUnknowns.maxItems,0);
 assert.throws(()=>validateGenerationProposal({...generated,newAssumptions:['Overflow']},{readiness:full}),/cardinality/);
});
test('plan decoder admits only frozen native source identities, not electrical profile IDs',()=>{
 const sources={catalogIds:['pololu-wheel-1420'],libraryHashes:['a'.repeat(64)]},schema=planProposalSchema(readiness(),sources),identity=schema.properties.parts.items.properties.identity;
 for(const candidate of [{type:'box'},{type:'catalog',catalogId:'pololu-wheel-1420'},{type:'library',sourceSha256:'a'.repeat(64)}])assert.doesNotThrow(()=>assertGenerationSchema(candidate,identity));
 for(const candidate of [{type:'catalog',catalogId:':momentary-arm-no'},{type:'catalog',catalogId:'esp32-devkitc-v4-wroom32e'},{type:'library',sourceSha256:'b'.repeat(64)}])assert.throws(()=>assertGenerationSchema(candidate,identity));
 const empty=planProposalSchema(readiness(),{catalogIds:[],libraryHashes:[]}).properties.parts.items.properties.identity;
 assert.equal(empty.anyOf.length,1);assert.doesNotThrow(()=>assertGenerationSchema({type:'box'},empty));assert.throws(()=>assertGenerationSchema({type:'catalog',catalogId:'invented'},empty));
});
test('readiness rejects geometry, contradictory status and excess questions',()=>{
  assert.deepEqual(validateReadiness(readiness()),readiness());
  assert.throws(()=>validateReadiness({...readiness(),parts:[]}));
  assert.throws(()=>validateReadiness({...readiness(),status:'questions'}));
  assert.throws(()=>validateReadiness({...readiness(),status:'questions',questions:Array.from({length:4},(_,i)=>({id:'q'+i,question:'Which?'}))}));
});
test('proposal ID rosters map exactly to stored plan without accepting full-design prose',()=>{
 const p=plan();p.buildItems=['mount-screws'];p.verificationRequests=['bed-envelope'];const raw=proposal(p),context={readiness:readiness()};
 assert.deepEqual(raw.buildItemIds,p.buildItems);assert.deepEqual(raw.verificationIds,p.verificationRequests);
 const stored=validateGenerationProposal(raw,context);assert.deepEqual(stored,p);assert.equal(stored.verificationIds,undefined);
 assert.throws(()=>validateGenerationProposal({...raw,verificationRequests:['bed-envelope']},context),/unsupported key/);
 assert.throws(()=>validateGenerationProposal({...raw,verificationIds:['Check all parts fit the printer.']},context),/no permitted shape/);
});
test('staged ASCII ID decoder rejects prose while host retains maximum ID length',()=>{
 const full=planProposalSchema(readiness()),decoded=ollamaProjection(full,{asciiIds:true}),ids=decoded.properties.buildItemIds.anyOf[0].items;
 assert.equal(ids.pattern,'^[A-Za-z][A-Za-z0-9_-]*$');
 for(const id of ['mount-screw','Check all parts fit.','bad:id','']){
  const raw={...proposal(plan()),buildItemIds:[id]};
  if(id==='mount-screw')assert.doesNotThrow(()=>assertGenerationSchema(raw,decoded));else assert.throws(()=>assertGenerationSchema(raw,decoded));
 }
 const oversized={...proposal(plan()),buildItemIds:['a'.repeat(65)]};assert.doesNotThrow(()=>assertGenerationSchema(oversized,decoded));assert.throws(()=>validateGenerationProposal(oversized,{readiness:readiness()}));
 assert.equal(ollamaProjection(full).properties.buildItemIds.anyOf[0].items.pattern,undefined,'Legacy projection remains unchanged');
});
test('proposal binds electrical profile to its own part and decoder rejects unrelated catalog CAD',()=>{
 const p=plan(2);p.parts.forEach(part=>part.kind='purchased');p.parts[0].identity={type:'catalog',catalogId:'pololu-lp6v-1098'};
 p.electrical={components:[{partId:'p0',profileId:'pololu-lp6v-1098'},{partId:'p1',profileId:'battery-dc'}],connections:[],control:false};
 const sources={catalogIds:['pololu-lp6v-1098','pololu-bracket-1086'],libraryHashes:[]},raw=proposal(p),decoder=ollamaProjection(planProposalSchema(readiness(),sources),{asciiIds:true});
 assert.equal(raw.electrical.components,undefined);assert.equal(raw.parts[1].profileId,'battery-dc');assert.doesNotThrow(()=>assertGenerationSchema(raw,decoder));
 assert.deepEqual(validateGenerationProposal(raw,{readiness:readiness(),sources}),p);
 const wrong=structuredClone(raw);wrong.parts[1].identity={type:'catalog',catalogId:'pololu-bracket-1086'};assert.throws(()=>assertGenerationSchema(wrong,decoder));assert.throws(()=>validateGenerationProposal(wrong,{readiness:readiness(),sources}));
 const dropped=structuredClone(raw);dropped.electrical=null;assert.throws(()=>validateGenerationProposal(dropped,{readiness:readiness(),sources}),/profiles require/);
 const duplicated=structuredClone(raw);duplicated.electrical.components=p.electrical.components;assert.throws(()=>validateGenerationProposal(duplicated,{readiness:readiness(),sources}),/no permitted shape/);
});
test('plan enforces immutable metadata, references and global limits',()=>{
  assert.deepEqual(validateGenerationPlan(plan(),{readiness:readiness()}),plan());
  for(const mutate of [p=>p.parts.push(p.parts[0]),p=>p.requirements[0].text='changed',p=>p.assembly[0].partIds=['missing'],p=>p.parts[0].identity={type:'catalog',catalogId:'unadmitted'}]){
    const p=plan();mutate(p);assert.throws(()=>validateGenerationPlan(p,{readiness:readiness(),sources:{catalogIds:[],libraryHashes:[]}}));
  }
  assert.throws(()=>validateGenerationPlan(plan(25),{readiness:readiness()}));
});
test('planning diagnostics identify uncovered parts and colliding supply IDs for bounded retry',()=>{
 const p=plan(2);p.assembly[0].partIds=['p0'];
 assert.throws(()=>validateGenerationPlan(p,{readiness:readiness()}),/missing part IDs p1/);
 p.assembly[0].partIds.push('p1');p.buildItems=['p1'];
 assert.throws(()=>validateGenerationPlan(p,{readiness:readiness()}),/collides with part: p1/);
});
test('planning retry names the exact invalid assembly reference and its namespace',()=>{
 const p=plan(2);p.assembly[0].partIds.push('wire-harness');
 assert.throws(()=>validateGenerationPlan(p,{readiness:readiness()}),e=>e.message.includes('assembly inspect.partIds')&&e.message.includes('wire-harness')&&e.message.includes('parts[].id'));
 p.assembly[0].partIds.pop();p.assembly[0].requires=['p0'];
 assert.throws(()=>validateGenerationPlan(p,{readiness:readiness()}),e=>e.message.includes('assembly inspect.requires')&&e.message.includes('p0')&&e.message.includes('assembly[].id'));
});
test('one bounded planning retry receives simultaneous roster defects',()=>{
 const p=plan(2);p.assembly[0].partIds=['p0','wire-harness'];p.buildItems=['p0'];
 assert.throws(()=>validateGenerationPlan(p,{readiness:readiness()}),e=>e.message.includes('wire-harness')&&e.message.includes('missing part IDs p1')&&e.message.includes('collides with part: p0')&&e.message.length<1000);
});
test('planning can disclose new assumptions and unknowns without erasing intake evidence',()=>{
  const ready={...readiness(),assumptions:['User delegated reversible material choice'],unknowns:['Physical fit has not been tested']};
  const p={...plan(),assumptions:[...ready.assumptions,'MODEL_ASSUMED prototype material'],unknowns:[...ready.unknowns,'Newly discovered interface measurement missing']};
  assert.deepEqual(validateGenerationPlan(p,{readiness:ready}),p);
  for(const key of ['assumptions','unknowns']){
    const dropped=structuredClone(p);dropped[key].shift();
    assert.throws(()=>validateGenerationPlan(dropped,{readiness:ready}),/readiness/);
    const rewritten=structuredClone(p);rewritten[key][0]='Now verified';
    assert.throws(()=>validateGenerationPlan(rewritten,{readiness:ready}),/readiness/);
    const reordered=structuredClone(p);reordered[key].reverse();
    assert.throws(()=>validateGenerationPlan(reordered,{readiness:ready}),/readiness/);
  }
  const changed=structuredClone(p);changed.requirements[0].text='Another user goal';
  assert.throws(()=>validateGenerationPlan(changed,{readiness:ready}),/readiness requirements/);
});

test('partition limits and dependency invalidation preserve independent parts',()=>{
  const p=plan(7);p.parts.slice(0,5).forEach(part=>part.kind='purchased');p.electrical={components:p.parts.slice(0,5).map(p=>({partId:p.id,profileId:'unknown'})),connections:Array.from({length:13},(_,i)=>({id:'w'+i,from:{partId:'p0',terminal:'t'+i},to:{partId:'p1',terminal:'t'+i},kind:'signal'})),control:false};
  const units=partitionGeneration(validateGenerationPlan(p,{readiness:readiness()}));
  for(const [kind,sizes]of[['part',[3,3,1]],['electricalComponent',[4,1]],['connection',[12,1]]])assert.deepEqual(units.filter(u=>u.kind===kind).map(u=>u.ids.length),sizes);
  const closure=dependentUnitKeys(units,['part-0']);assert.ok(!closure.has('part-1'));assert.ok(units.filter(u=>u.kind!=='part').every(u=>closure.has(u.key)));
  assert.equal(dependentUnitKeys(units,['plan']).size,units.length+1);
});
test('planning rejects electrical source substitutions before freezing identities and endpoints',()=>{
 const p=plan();p.parts[0].kind='purchased';p.parts[0].identity={type:'catalog',catalogId:'pololu-drv8833-2130'};
 p.electrical={components:[{partId:'p0',profileId:'adafruit-max4466-1063'}],connections:[],control:false};
 const context={readiness:readiness(),sources:{catalogIds:['pololu-drv8833-2130'],libraryHashes:[]}};
 assert.throws(()=>validateGenerationPlan(p,context),/electrical\/CAD identity conflict/);
 p.parts[0].identity={type:'box'};assert.doesNotThrow(()=>validateGenerationPlan(p,context));
 p.electrical.connections=[{id:'wire',from:{partId:'p0',terminal:'invented'},to:{partId:'p0',terminal:'GND'},kind:'ground'}];
 assert.throws(()=>validateGenerationPlan(p,context),/unknown profile terminal/);
 p.electrical.connections[0].from.terminal='VCC';assert.doesNotThrow(()=>validateGenerationPlan(p,context));
 p.parts[0].kind='printed';assert.throws(()=>validateGenerationPlan(p,context),/must be purchased/);
});
test('units reject missing extra duplicate IDs and changed poses; assembly uses roster order',()=>{
  const p=validateGenerationPlan(plan(4),{readiness:readiness()}),units=partitionGeneration(p),u=units[0];
  for(const mutate of [v=>v.items.pop(),v=>v.items.push(v.items[0]),v=>v.items[0].id='extra',v=>v.items[0].position=[5,0,0],v=>v.items[0].source='different']){
    const v=payload(p,u);mutate(v);assert.throws(()=>validateGenerationUnit(p,u,v,[]));
  }
  const records=[];
  for(const unit of units){const v=payload(p,unit);v.items?.reverse();records.push({key:unit.key,status:'UNIT_VALIDATED',payload:validateGenerationUnit(p,unit,v,records)});}
  const spec=assembleGeneration(p,records);assert.deepEqual(spec.parts.map(x=>x.id),p.parts.map(x=>x.id));assert.equal(spec.electrical,undefined);
  assert.throws(()=>assembleGeneration(p,records.slice(1)));
});
import {READINESS_SCHEMA,assertGenerationSchema,schemaForGenerationUnit} from '../server/studio-generation-stages.mjs';
import {ollamaProjection} from '../server/studio-schema.mjs';
import {ELECTRICAL_PROFILES} from '../server/studio-electrical-profiles.mjs';

test('planning decoder rejects invented pins without rewriting supported terminal names',()=>{
 const endpoint=ollamaProjection(planProposalSchema(readiness()),{asciiIds:true}).properties.electrical.anyOf[0].properties.connections.items.properties.from;
 for(const profile of ELECTRICAL_PROFILES)for(const terminal of profile.terminals)assert.doesNotThrow(()=>assertGenerationSchema({partId:'controller',terminal:terminal.id},endpoint));
 for(const terminal of ['IO5','GPIO4','34','invented'])assert.throws(()=>assertGenerationSchema({partId:'controller',terminal},endpoint));
 const p=plan();p.parts[0].kind='purchased';p.electrical={components:[{partId:'p0',profileId:'esp32-devkitc-v4-wroom32e'}],connections:[{id:'wire',from:{partId:'p0',terminal:'GP4'},to:{partId:'p0',terminal:'GND'},kind:'signal'}],control:false};
 // A pin valid on another profile must still fail the exact component check.
 assert.throws(()=>validateGenerationProposal(proposal(p),{readiness:readiness()}),e=>e.message.includes('p0:GP4')&&e.message.includes('esp32-devkitc-v4-wroom32e')&&e.message.includes('IO4')&&!e.message.includes('IO5'));
});

test('connection decoder freezes both endpoints and kind for each assigned wire',()=>{
 const p=plan(2);p.electrical={components:[{partId:'p0',profileId:'battery-dc'},{partId:'p1',profileId:'fuse-series'}],connections:[{id:'supply',from:{partId:'p0',terminal:'+'},to:{partId:'p1',terminal:'IN'},kind:'power'}],control:false};
 const unit=partitionGeneration(p).find(u=>u.kind==='connection'),wire={...p.electrical.connections[0],color:'#808080',wireAwg:24};
 for(const schema of [schemaForGenerationUnit(p,unit),ollamaProjection(schemaForGenerationUnit(p,unit),{asciiIds:true})]){
  assert.doesNotThrow(()=>assertGenerationSchema({items:[wire]},schema));
  for(const mutate of [w=>w.from.terminal='-',w=>w.to.partId='p0',w=>w.kind='signal',w=>w.id='other']){
   const bad=structuredClone(wire);mutate(bad);assert.throws(()=>assertGenerationSchema({items:[bad]},schema));
  }
 }
});

test('assembly decoder freezes each assigned step and its exact references without freezing prose',()=>{
 const p=plan(3);p.assembly=[{id:'base',partIds:['p0'],requires:[]},{id:'attach',partIds:['p1','p2'],requires:['base']}];
 const u=partitionGeneration(p).find(u=>u.kind==='assembly'),good=payload(p,u),before=JSON.stringify(p);
 for(const schema of [schemaForGenerationUnit(p,u),ollamaProjection(schemaForGenerationUnit(p,u),{asciiIds:true})]){
  assert.doesNotThrow(()=>assertGenerationSchema(good,schema));
  for(const mutate of [v=>v.items[0].id='invented',v=>v.items[0].partIds=['p1'],v=>v.items[1].partIds.reverse(),v=>v.items[1].partIds.push('p0'),v=>v.items[1].requires=[],v=>v.items[0].requires=['attach']]){
   const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertGenerationSchema(bad,schema),'Decoder must reject changed references before host admission');
   assert.throws(()=>validateGenerationUnit(p,u,bad,[]));
  }
  const prose=structuredClone(good);prose.items.reverse();prose.items[0].instructions=['Model-authored detailed instruction'];assert.doesNotThrow(()=>assertGenerationSchema(prose,schema));
  assert.equal(validateGenerationUnit(p,u,prose,[]).items[1].instructions[0],'Model-authored detailed instruction');
 }
 assert.equal(JSON.stringify(p),before);
 const duplicate=structuredClone(good);duplicate.items[1]=duplicate.items[0];assert.throws(()=>validateGenerationUnit(p,u,duplicate,[]),/duplicate/);
 const split={...u,ids:['attach']};assert.doesNotThrow(()=>assertGenerationSchema({items:[good.items[1]]},schemaForGenerationUnit(p,split)));
 assert.throws(()=>assertGenerationSchema({items:[good.items[0]]},schemaForGenerationUnit(p,split)));
});

test('part decoder freezes each assigned identity, pose and nullable source like host validation',()=>{
 const p=plan(2),u=partitionGeneration(p)[0],good=payload(p,u);for(const part of good.items)part.color='#808080';
 for(const schema of [schemaForGenerationUnit(p,u),ollamaProjection(schemaForGenerationUnit(p,u))]){
  assert.doesNotThrow(()=>assertGenerationSchema(good,schema));
  for(const mutate of [v=>v.items[0].position=[0,-60,18],v=>v.items[0].rotation=[90,0,0],v=>v.items[0].kind='purchased',v=>v.items[0].source='invented',v=>v.items[0].shape={type:'cylinder',radius:18,height:140},v=>v.items[0].id='outside']){
   const bad=structuredClone(good);mutate(bad);assert.throws(()=>assertGenerationSchema(bad,schema));
  }
 }
});
test('decoder readiness alternatives enforce the same status/question invariant as host',()=>{const question={id:'q1',question:'Which interface?'};for(const schema of [READINESS_SCHEMA,ollamaProjection(READINESS_SCHEMA)]){assert.doesNotThrow(()=>assertGenerationSchema(readiness(),schema));assert.doesNotThrow(()=>assertGenerationSchema({...readiness(),status:'questions',questions:[question]},schema));assert.throws(()=>assertGenerationSchema({...readiness(),status:'ready',questions:[question]},schema));assert.throws(()=>assertGenerationSchema({...readiness(),status:'questions',questions:[]},schema));}});


test('proposal decoder prevents profiles on an unpowered plan or printed part',()=>{
 const context={readiness:readiness(),sources:{catalogIds:['pololu-lp6v-1098'],libraryHashes:[]}};
 const p=plan(2),plain=proposal(p),powered=structuredClone(plain);
 powered.parts[0].kind='purchased';powered.parts[0].profileId='battery-dc';powered.electrical={connections:[],control:false};
 for(const decoder of [planProposalSchema(context.readiness,context.sources),ollamaProjection(planProposalSchema(context.readiness,context.sources),{asciiIds:true})]){
  assert.doesNotThrow(()=>assertGenerationSchema(plain,decoder));
  assert.doesNotThrow(()=>assertGenerationSchema(powered,decoder));
  const orphan=structuredClone(powered);orphan.electrical=null;
  assert.throws(()=>assertGenerationSchema(orphan,decoder),'No circuit must require null profiles in the decoder, not only final validation');
  const printed=structuredClone(powered);printed.parts[0].kind='printed';
  assert.throws(()=>assertGenerationSchema(printed,decoder),'Electrical components cannot be printed shells');
 }
 assert.deepEqual(validateGenerationProposal(plain,context),p);
});


test('decoder requires version 2 for profile shapes or named datums while retaining legacy plans',()=>{
 const context={readiness:readiness(),sources:{catalogIds:[],libraryHashes:[]}};
 for(const decoder of [planProposalSchema(context.readiness,context.sources),ollamaProjection(planProposalSchema(context.readiness,context.sources),{asciiIds:true})]){
  assert.doesNotThrow(()=>assertGenerationSchema(proposal(plan()),decoder));
  for(const change of [p=>p.parts[0].identity={type:'profileLoft'},p=>p.parts[0].identity={type:'profileExtrusion'},p=>p.parts[0].datumIds=['mount'],p=>p.placement={version:1,roots:p.parts.map(part=>({partId:part.id,reason:'Regression root'})),attachments:[]}]){
   const raw=proposal(plan());change(raw);
   assert.throws(()=>assertGenerationSchema(raw,decoder),'V2 features must not decode without their version');
   raw.geometryVersion=2;assert.doesNotThrow(()=>assertGenerationSchema(raw,decoder));
  }
 }
});
