import test from 'node:test';
import assert from 'node:assert/strict';
import * as service from '../server/studio-service.mjs';
import {inspectArchitecturePlan} from '../server/studio-architecture-plan.mjs';
import {engineeringChecks} from '../engineering/physics.mjs';

const input = value => ({value,basis:'ASSUMED',source:'Synthetic regression assumption, not evidence'});
const old = () => ({parts:[],physicsInputs:{motorTorqueNm:input(.04),motorStallTorqueNm:input(.04)}});
const plan = () => ({questions:[],selectedCatalogIds:[],physicsInputs:{motorTorqueNm:input(.02),motorStallTorqueNm:input(.04)},assumptions:['Operating point is provisional.'],unknowns:['Actual usable torque remains unqualified.'],powerArchitecture:'Synthetic consistency regression only.'});
const catalog={components:[]};
const part=(id,name,extra={})=>({id,name,kind:'printed',material:'ASSUMED PLA',color:'#808080',shape:{type:'box',size:[40,30,4]},position:[0,0,0],rotation:[0,0,0],...extra});
const spec=parts=>({schemaVersion:1,title:'Feature regression',description:'Synthetic geometry only',units:'mm',requirements:[{id:'R1',text:'Real openings, not positive feature placeholders.'}],assumptions:[],unknowns:['Physical tests not performed'],questions:[],parts,assembly:[{id:'inspect',title:'Inspect',partIds:parts.map(p=>p.id),requires:[],instructions:['Inspect geometry.'],checks:['Measure openings.']}]});

test('corrected below-stall numbers may proceed to CAD while physical qualification remains UNKNOWN',()=>{
 const before=old(),proposed=plan();
 const result=inspectArchitecturePlan(proposed,{failedDraft:before,catalog});
 assert.equal(result.status,'ACCEPTED');
 assert.equal(result.checks.find(c=>c.id==='usable-torque-basis').status,'UNKNOWN');
 assert(result.unknowns.some(c=>c.id==='usable-torque-basis'));
 assert.equal(engineeringChecks(proposed.physicsInputs).find(c=>c.id==='usable-torque-basis').status,'UNKNOWN');
 assert.equal(before.physicsInputs.motorTorqueNm.value,.04);
});
test('missing or still contradictory torque cannot clear a previous failure',()=>{
 for(const change of [p=>delete p.physicsInputs.motorStallTorqueNm,p=>p.physicsInputs.motorTorqueNm.value=.04,p=>p.physicsInputs.motorTorqueNm.value=.05]){
  const p=plan();change(p);assert.equal(inspectArchitecturePlan(p,{failedDraft:old(),catalog}).status,'FAILED');
 }
});
test('unresolved supply overvoltage is still rejected',()=>{
 const p=plan();Object.assign(p.physicsInputs,{batteryMaxVoltage:input(8.4),motorVoltage:input(6),driverMinVoltage:input(2.7),driverMaxVoltage:input(10.8)});
 assert.equal(inspectArchitecturePlan(p,{failedDraft:old(),catalog}).status,'FAILED');
});
test('initial generation rejects solid vent-slot placeholders before freezing',()=>{
 const result=service.inspectInitialDraft(spec([part('lid','Lid'),part('vent1','Vent slot 1',{shape:{type:'box',size:[2,8,4.1]},position:[0,0,5]})]),catalog);
 assert.match(result.issues.join('\n'),/vent1.*(?:subtractive|cut|pocket)/i);
});
test('nested coaxial through-holes are diagnosed as redundant, not stepped bores',()=>{
 const p=part('bearing_holder','Bearing holder',{holes:[{axis:'z',diameter:22,position:[0,0,15]},{axis:'z',diameter:8,position:[0,0,-15]}]});
 assert.match(service.inspectInitialDraft(spec([p]),catalog).issues.join('\n'),/hole 1.*(?:contained|duplicate|redundant)/i);
});
test('separation along a through-hole axis does not make a second mounting hole',()=>{
 const p=part('support','Support',{holes:[{axis:'x',diameter:4.5,position:[-20,0,0]},{axis:'x',diameter:4.5,position:[20,0,0]}]});
 assert.match(service.inspectInitialDraft(spec([p]),catalog).issues.join('\n'),/hole 1.*(?:contained|duplicate|redundant)/i);
});
test('real rectangular cuts and separated through-holes remain accepted',()=>{
 const p=part('lid','Vented cover',{pockets:[{size:[2,8,5],position:[0,0,0]}],holes:[{axis:'z',diameter:3,position:[-15,0,0]},{axis:'z',diameter:3,position:[15,0,0]}]});
 assert.deepEqual(service.inspectInitialDraft(spec([p]),catalog).issues,[]);
});
test('a physical vent insert is not mistaken for a missing slot',()=>{
 assert.deepEqual(service.inspectInitialDraft(spec([part('insert','Vent insert')]),catalog).issues,[]);
});
test('worker JSON errors survive diagnostic-only stderr for model repair',()=>{
 assert.equal(typeof service.nativeBuildFailureMessage,'function');
 const error='SpecError: pedestal: hole 1 does not remove material (outside or duplicate hole)';
 const run={stdout:JSON.stringify({ok:false,errors:[error]}),stderr:'M4KE_DIAGNOSTIC {"phase":"part-build","status":"ERROR"}'};
 assert.match(service.nativeBuildFailureMessage(run,{ok:false,errors:[error]}),/hole 1 does not remove material/);
 assert.match(service.nativeBuildFailureMessage(run,null),/hole 1 does not remove material/);
});
test('worker error fallback is bounded and ignores non-string error fields',()=>{
 assert.equal(typeof service.nativeBuildFailureMessage,'function');
 assert(service.nativeBuildFailureMessage({stdout:'bad json',stderr:'x'.repeat(8000)},{errors:[{code:'invalid'}]}).length<=1500);
});
