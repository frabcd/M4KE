import test from 'node:test';import assert from 'node:assert/strict';
import {validateReadiness,validateGenerationPlan,partitionGeneration,validateGenerationUnit,assembleGeneration,dependentUnitKeys} from '../server/studio-generation-stages.mjs';
import {readiness,plan,payload} from './helpers/staged-generation-fixture.mjs';
test('readiness rejects geometry, contradictory status and excess questions',()=>{
  assert.deepEqual(validateReadiness(readiness()),readiness());
  assert.throws(()=>validateReadiness({...readiness(),parts:[]}));
  assert.throws(()=>validateReadiness({...readiness(),status:'questions'}));
  assert.throws(()=>validateReadiness({...readiness(),status:'questions',questions:Array.from({length:4},(_,i)=>({id:'q'+i,question:'Which?'}))}));
});
test('plan enforces immutable metadata, references and global limits',()=>{
  assert.deepEqual(validateGenerationPlan(plan(),{readiness:readiness()}),plan());
  for(const mutate of [p=>p.parts.push(p.parts[0]),p=>p.requirements[0].text='changed',p=>p.assembly[0].partIds=['missing'],p=>p.parts[0].identity={type:'catalog',catalogId:'unadmitted'}]){
    const p=plan();mutate(p);assert.throws(()=>validateGenerationPlan(p,{readiness:readiness(),sources:{catalogIds:[],libraryHashes:[]}}));
  }
  assert.throws(()=>validateGenerationPlan(plan(25),{readiness:readiness()}));
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
  const p=plan(7);p.electrical={components:p.parts.slice(0,5).map(p=>({partId:p.id,profileId:'unknown'})),connections:Array.from({length:13},(_,i)=>({id:'w'+i,from:{partId:'p0',terminal:'t'+i},to:{partId:'p1',terminal:'t'+i},kind:'signal'})),control:false};
  const units=partitionGeneration(validateGenerationPlan(p,{readiness:readiness()}));
  for(const [kind,sizes]of[['part',[3,3,1]],['electricalComponent',[4,1]],['connection',[12,1]]])assert.deepEqual(units.filter(u=>u.kind===kind).map(u=>u.ids.length),sizes);
  const closure=dependentUnitKeys(units,['part-0']);assert.ok(!closure.has('part-1'));assert.ok(units.filter(u=>u.kind!=='part').every(u=>closure.has(u.key)));
  assert.equal(dependentUnitKeys(units,['plan']).size,units.length+1);
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
import {READINESS_SCHEMA,assertGenerationSchema} from '../server/studio-generation-stages.mjs';
import {ollamaProjection} from '../server/studio-schema.mjs';
test('decoder readiness alternatives enforce the same status/question invariant as host',()=>{const question={id:'q1',question:'Which interface?'};for(const schema of [READINESS_SCHEMA,ollamaProjection(READINESS_SCHEMA)]){assert.doesNotThrow(()=>assertGenerationSchema(readiness(),schema));assert.doesNotThrow(()=>assertGenerationSchema({...readiness(),status:'questions',questions:[question]},schema));assert.throws(()=>assertGenerationSchema({...readiness(),status:'ready',questions:[question]},schema));assert.throws(()=>assertGenerationSchema({...readiness(),status:'questions',questions:[]},schema));}});
