import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryIntentDiagnostics} from '../server/studio-generation-diagnostics.mjs';
import {admitGeneratedDesign} from '../server/studio-generation-admission.mjs';
import {plan,payload} from './helpers/staged-generation-fixture.mjs';
import {partitionGeneration,assembleGeneration} from '../server/studio-generation-stages.mjs';
const cylinder=(radius,height,position=[0,0,0],rotation=[0,0,0])=>({type:'cylinder',radius,height,position,rotation});
const box=(size,position=[0,0,0],rotation=[0,0,0])=>({type:'box',size,position,rotation});
const spec=solids=>({parts:[{id:'body',name:'Body',kind:'printed',shape:{type:'union',solids},position:[0,0,0],rotation:[0,0,0]}]});
const disconnected=s=>geometryIntentDiagnostics(s).filter(d=>d.code==='DISCONNECTED_UNION');
test('real failed union: transverse nose offset cannot fuse unrotated cylinders',()=>{
 const s=spec([cylinder(22,140),cylinder(12,30,[75,0,0])]),before=structuredClone(s);
 const issues=disconnected(s);assert.equal(issues.length,1);assert.equal(issues[0].partId,'body');
 assert.match(issues[0].message,/41.*mm/);assert.match(issues[0].message,/Z/);assert.deepEqual(s,before);
});
test('axis-corrected cylinders can connect; rejection never claims a topology pass',()=>{
 assert.deepEqual(disconnected(spec([cylinder(22,140,[0,0,0],[0,90,0]),cylinder(12,30,[75,0,0],[0,90,0])])),[]);
});
test('connectivity is transitive even when bridging solid appears last',()=>{
 assert.deepEqual(disconnected(spec([box([10,10,10]),box([10,10,10],[18,0,0]),box([12,5,5],[9,0,0])])),[]);
});
test('composite XYZ rotations and long box extents are respected',()=>{
 assert.deepEqual(disconnected(spec([box([60,4,4],[0,0,0],[0,0,90]),box([4,4,4],[0,29,0])])),[]);
 const s=spec([box([4,4,60],[0,0,0],[90,90,0]),box([4,4,4],[29,0,0])]);
 assert.deepEqual(disconnected(s),[]);
});
test('multiple connected components produce one bounded part diagnostic',()=>{
 assert.equal(disconnected(spec([box([4,4,4]),box([4,4,4],[10,0,0]),box([4,4,4],[20,0,0])])).length,1);
});
test('touching or overlapping bounds are inconclusive, not rejected',()=>{
 assert.deepEqual(disconnected(spec([box([10,10,10]),box([10,10,10],[10,0,0])])),[]);
 // AABB overlap is NOT proof of a true union: diagonal cylinders can still miss.
 assert.deepEqual(disconnected(spec([cylinder(5,10),cylinder(5,10,[9,9,0])])),[]);
});
test('separate parts and immutable source components are not assumed fused',()=>{
 const s=spec([box([4,4,4]),box([4,4,4],[10,0,0])]);s.parts[0].kind='purchased';assert.deepEqual(disconnected(s),[]);
 assert.deepEqual(disconnected({parts:[{id:'a',kind:'printed',shape:{type:'box',size:[10,10,10]}},{id:'b',kind:'printed',shape:{type:'box',size:[10,10,10]},position:[100,0,0]}]}),[]);
});
test('global admission rejects disconnected union with exact repair-unit attribution',()=>{
 const p=plan(),s=assembleGeneration(p,partitionGeneration(p).map(u=>({key:u.key,status:'UNIT_VALIDATED',payload:payload(p,u)})));
 s.parts[0].shape={type:'union',solids:[cylinder(22,140),cylinder(12,30,[75,0,0])]};
 const result=admitGeneratedDesign(s,{request:'fixture',catalog:{components:[]},plan:p});
 assert.equal(result.spec,null);const issue=result.issues.find(i=>i.code==='DISCONNECTED_UNION');
 assert.equal(issue.attribution,'exact');assert.deepEqual(issue.unitKeys,['part-0']);
});
