import test from 'node:test';import assert from 'node:assert/strict';
import {admitGeneratedDesign}from'../server/studio-generation-admission.mjs';
import {plan,payload}from'./helpers/staged-generation-fixture.mjs';import {partitionGeneration,assembleGeneration}from'../server/studio-generation-stages.mjs';
const fixture=()=>{const p=plan();return {p,spec:assembleGeneration(p,partitionGeneration(p).map(u=>({key:u.key,status:'UNIT_VALIDATED',payload:payload(p,u)})))};};
test('global admission rejects assembly omissions, cycles and missing explanations',()=>{
 const {p,spec}=fixture();const ctx={request:'fixture',catalog:{components:[]},plan:p};assert.ok(admitGeneratedDesign(spec,ctx).spec);
 for(const change of [s=>s.assembly=[],s=>s.assembly[0].requires=['inspect'],s=>s.physicsInputs={driveMotors:{value:2,basis:'ASSUMED',source:'fixture'}}]){const s=structuredClone(spec);change(s);assert.equal(admitGeneratedDesign(s,ctx).spec,null);}
 assert.equal(admitGeneratedDesign(spec,{...ctx,requirePartExplanations:true}).spec,null);
});
test('attribution uses validator path evidence and unknown errors stop repair',()=>{
 const {p,spec}=fixture();spec.parts[0].shape.size=[-1,10,10];const result=admitGeneratedDesign(spec,{request:'fixture',catalog:{components:[]},plan:p});assert.equal(result.issues[0].attribution,'exact');assert.deepEqual(result.issues[0].unitKeys,['part-0']);
 const s=fixture().spec;s.assembly=[];const unknown=admitGeneratedDesign(s,{request:'fixture',catalog:{components:[]},plan:p});assert.equal(unknown.issues[0].attribution,'unknown');
});
