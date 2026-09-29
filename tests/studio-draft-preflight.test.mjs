import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectInitialDraft} from '../server/studio-service.mjs';
const input=(value)=>({value,basis:'ASSUMED',source:'Synthetic test input, not hardware evidence'});
function draft(){return {schemaVersion:1,title:'Synthetic initial draft',description:'Validator regression only',units:'mm',requirements:[{id:'R1',text:'Preserve original target'}],assumptions:[],unknowns:['Physical operation untested'],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[20,20,5]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Inspect unpowered'],checks:['Record dimensions']}],physicsInputs:{}};}
function slowMotion(){return Object.fromEntries(Object.entries({massKg:.2,rollingResistance:.02,wheelRadiusMm:20,driveMotors:2,motorVoltage:6,batteryVoltage:6,motorNoLoadRpm:20,motorStallTorqueNm:.07,targetSpeedMS:.5,accelerationMS2:.1,gradeDeg:0,tractionCoefficient:.5,drivenWeightFraction:.6,transmissionEfficiency:.8,motorContinuousTorqueFraction:.3}).map(([k,v])=>[k,input(v)]));}
test('initial feedback aggregates schema, power, missing wiring and existing numerical screening without mutating model draft',()=>{
 const s=draft();s.parts[0].color='red';s.physicsInputs={...slowMotion(),batteryVoltage:input(7.4),batteryMaxVoltage:input(8.4)};const before=structuredClone(s),r=inspectInitialDraft(s,{components:[]}),text=r.issues.join('\n');assert.equal(r.candidate,null);assert.match(text,/color/);assert.match(text,/7.4 V exceeds/);assert.match(text,/8.4 V exceeds/);assert.match(text,/Powered toys require/);assert.match(text,/motion-operating-point/);assert.deepEqual(s,before);
});
test('catalog source absence is reported alongside a separate malformed field before CAD',()=>{
 const s=draft();s.parts[0].kind='purchased';s.parts[0].shape={type:'catalog',catalogId:'data-only'};s.parts[0].color='blue';const r=inspectInitialDraft(s,{components:[{id:'data-only',geometry:null}]});assert.equal(r.candidate,null);assert.ok(r.issues.some(x=>/color/.test(x)));assert.ok(r.issues.some(x=>/data-only/.test(x)&&/STEP|geometry/.test(x)));
});
test('unknown inputs remain unknown; no manufactured physics failures or default numbers',()=>{
 const s=draft();s.physicsInputs={targetSpeedMS:input(.5),driveMotors:input(2)};const before=structuredClone(s),r=inspectInitialDraft(s,{components:[]});assert.ok(r.candidate);assert.ok(!r.issues.some(x=>/screening FAIL/.test(x)));assert.deepEqual(s,before);
});
test('passive valid drafts and clarification-only replies remain supported',()=>{
 const s=draft();assert.equal(inspectInitialDraft(s,{components:[]}).issues.length,0);s.parts=[];s.assembly=[];s.questions=[{id:'size',question:'What size?',options:['Small','Large']}];s.physicsInputs=slowMotion();assert.equal(inspectInitialDraft(s,{components:[]}).issues.length,0);
});
test('general part bound remains a visible first diagnostic without source-kit substitution',()=>{
 const s=draft();s.parts=Array.from({length:25},(_,i)=>({...s.parts[0],id:'p'+i}));s.assembly[0].partIds=s.parts.map(p=>p.id);s.physicsInputs={driveMotors:input(2)};assert.match(inspectInitialDraft(s,{components:[]}).issues[0],/24 parts/);
});
