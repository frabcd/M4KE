import test from 'node:test';
import assert from 'node:assert/strict';
import {engineeringChecks} from '../engineering/physics.mjs';
import {validateDesignSpec,verifyDesign,designHash} from '../server/studio-contract.mjs';
const n=value=>({value,basis:'ASSUMED',source:'Synthetic test input, not supplier evidence'});
const motion=()=>Object.fromEntries(Object.entries({massKg:.3,rollingResistance:.03,wheelRadiusMm:30,driveMotors:2,motorVoltage:6,batteryVoltage:6,motorNoLoadRpm:270,motorStallTorqueNm:.04315,targetSpeedMS:.5,accelerationMS2:.5,gradeDeg:0,tractionCoefficient:.6,drivenWeightFraction:.65,transmissionEfficiency:.9,motorContinuousTorqueFraction:.25,motorNoLoadA:.04,motorStallA:.36,batteryCapacityAh:2,batteryUsableFraction:.7,logicCurrentA:.05}).map(([key,value])=>[key,n(value)]));
const c=(p,id)=>engineeringChecks(p).find(c=>c.id===id);
const spec=()=>({schemaVersion:1,title:'Test',description:'Test fixture',units:'mm',requirements:[{id:'R1',text:'Inspect'}],assumptions:[],unknowns:[],questions:[],parts:[{id:'part',name:'Part',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[40,30,8]},position:[0,0,4],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['part'],requires:[],instructions:['Inspect'],checks:['Record result']}]});

test('motion uses radius converted from mm and loaded speed not no-load speed',()=>{
  const p=motion(),r=c(p,'motion-operating-point');assert.equal(r.status,'PASS');
  assert.ok(Math.abs(r.observed.requiredRpm-(.5*60/(2*Math.PI*.03)))<1e-10);
  assert.ok(r.observed.loadedRpm<r.observed.noLoadRpm);assert.ok(r.observed.requiredForceN>.3*9.80665*.03);
  assert.match(r.details,/Conditional screening only/);assert.match(r.details,/ASSUMED/);
});
test('130rpm reference motor fails 0.5m/s target on 50mm wheel even before loaded margin',()=>{
  const p=motion();p.motorNoLoadRpm=n(130);p.wheelRadiusMm=n(25);
  const r=c(p,'motion-operating-point');assert.equal(r.status,'FAIL');assert.equal(r.observed.speedOK,false);assert.ok(r.observed.requiredRpm>190);
});
test('excessive load fails usable torque; traction independently fails on poor floor',()=>{
  const p=motion();p.massKg=n(5);p.accelerationMS2=n(3);assert.equal(c(p,'motion-operating-point').status,'FAIL');
  const slippery=motion();slippery.tractionCoefficient=n(.01);assert.equal(c(slippery,'traction-margin').status,'FAIL');
});
test('grade and lower voltage reduce margin; overvoltage cannot masquerade as improved success',()=>{
  const p=motion(),base=c(p,'motion-operating-point').observed.predictedSpeedMS;p.gradeDeg=n(10);assert.ok(c(p,'motion-operating-point').observed.predictedSpeedMS<base);
  const low=motion();low.batteryVoltage=n(4.8);assert.ok(c(low,'motion-operating-point').observed.predictedSpeedMS<base);
  const high=motion();high.batteryVoltage=n(9);assert.equal(c(high,'motion-operating-point').status,'FAIL');
});
test('missing critical motion input remains UNKNOWN and never substitutes a default',()=>{
  const p=motion();delete p.drivenWeightFraction;const r=c(p,'motion-operating-point');assert.equal(r.status,'UNKNOWN');assert.deepEqual(r.observed,['drivenWeightFraction']);
  assert.deepEqual(engineeringChecks({thresholdDbfs:n(-25)}),[]);
});
test('motorized target cannot omit every optional motion trigger to hide operating-point and traction gaps',()=>{
  const p=Object.fromEntries(Object.entries({targetSpeedMS:.5,massKg:.5,rollingResistance:.02,wheelRadiusMm:30,driveMotors:2,motorTorqueNm:.074,motorVoltage:6,batteryVoltage:6}).map(([key,value])=>[key,n(value)]));
  const before=structuredClone(p),missing=['motorNoLoadRpm','motorStallTorqueNm','accelerationMS2','gradeDeg','tractionCoefficient','drivenWeightFraction','transmissionEfficiency','motorContinuousTorqueFraction'];
  for(const id of ['motion-operating-point','traction-margin']){const r=c(p,id);assert.equal(r.status,'UNKNOWN');assert.deepEqual(r.observed,missing);assert.equal(r.critical,true);}
  assert.deepEqual(p,before);
  assert.equal(c({targetSpeedMS:n(.5)},'motion-operating-point'),undefined);
});
test('nominal battery voltage alone exposes all missing maximum-supply inputs',()=>{
  const p={batteryVoltage:n(6)},r=c(p,'maximum-supply-voltage');
  assert.equal(r.status,'UNKNOWN');assert.deepEqual(r.observed,['batteryMaxVoltage','driverMinVoltage','driverMaxVoltage','motorVoltage']);
  assert.deepEqual(p,{batteryVoltage:n(6)});
});
test('usable torque gate never invents a missing stall or usable value',()=>{
  const usable={motorTorqueNm:n(.02)},stall={motorStallTorqueNm:n(.08)};
  assert.equal(c(usable,'usable-torque-basis').status,'UNKNOWN');assert.deepEqual(c(usable,'usable-torque-basis').observed,['motorStallTorqueNm']);
  assert.equal(c(stall,'usable-torque-basis').status,'UNKNOWN');assert.deepEqual(c(stall,'usable-torque-basis').observed,['motorTorqueNm']);
  assert.deepEqual(usable,{motorTorqueNm:n(.02)});assert.deepEqual(stall,{motorStallTorqueNm:n(.08)});
});
test('equal or above-stall usable claims fail the numeric screen; lower values stay unqualified UNKNOWN',()=>{
  const p={motorTorqueNm:n(.08),motorStallTorqueNm:n(.08)};
  assert.equal(c(p,'usable-torque-basis').status,'FAIL');
  p.motorTorqueNm.value=.09;assert.equal(c(p,'usable-torque-basis').status,'FAIL');
  p.motorTorqueNm.value=.02;let r=c(p,'usable-torque-basis');assert.equal(r.status,'UNKNOWN');assert.equal(r.observed.usableFractionOfStall,.25);
  for(const input of Object.values(p)){input.basis='MANUFACTURER';input.source='Verified continuous rating; not stall torque';}
  assert.equal(c(p,'usable-torque-basis').status,'UNKNOWN');
  p.motorTorqueNm.source='theoretical stall torque';r=c(p,'usable-torque-basis');assert.equal(r.status,'UNKNOWN');assert.equal(r.observed.usableFractionOfStall,.25);
});
test('current and runtime are labelled estimates, and impossible current ordering fails',()=>{
  const p=motion();assert.equal(c(p,'motor-operating-current').status,'PASS');assert.ok(c(p,'runtime-estimate').observed.minutes>0);assert.match(c(p,'runtime-estimate').details,/not a runtime guarantee/);
  p.motorStallA=n(.01);assert.equal(c(p,'motor-operating-current').status,'FAIL');
});
test('full-charge supply uses maximum not nominal battery voltage',()=>{
  const p={batteryMaxVoltage:n(8.4),driverMinVoltage:n(2.7),driverMaxVoltage:n(10.8),motorVoltage:n(6)};assert.equal(c(p,'maximum-supply-voltage').status,'FAIL');p.batteryMaxVoltage=n(6);assert.equal(c(p,'maximum-supply-voltage').status,'PASS');
});
test('beam screening has known dimensional solution and fails thin/weak section',()=>{
  const p=Object.fromEntries(Object.entries({beamSpanMm:100,beamWidthMm:20,beamThicknessMm:4,structuralLoadN:10,materialModulusMPa:2000,materialAllowableMPa:20,structuralSafetyFactor:2,maxDeflectionMm:2}).map(([k,v])=>[k,n(v)]));
  const r=c(p,'beam-screening');assert.equal(r.status,'PASS');assert.ok(Math.abs(r.observed.stressMPa-4.6875)<1e-10);assert.ok(Math.abs(r.observed.deflectionMm-.9765625)<1e-10);p.beamThicknessMm=n(1);assert.equal(c(p,'beam-screening').status,'FAIL');
});
test('catalog is purchased-only, immutable and path-free',()=>{
  const s=spec();s.parts[0].shape={type:'catalog',catalogId:'pico-r3'};assert.throws(()=>validateDesignSpec(s),/only allowed for purchased/);s.parts[0].kind='purchased';assert.equal(validateDesignSpec(s).parts[0].shape.catalogId,'pico-r3');
  s.parts[0].shape.catalogId='../../secret';assert.throws(()=>validateDesignSpec(s),/stable ASCII/);s.parts[0].shape.catalogId='pico-r3';s.parts[0].holes=[];assert.throws(()=>validateDesignSpec(s),/cannot be modified/);
});
test('catalog positive multi-solid evidence is allowed; printed multi-solid still fails',()=>{
  const s=spec();s.parts[0].kind='purchased';s.parts[0].shape={type:'catalog',catalogId:'pico-r3'};
  const evidence={revisionHash:designHash(s),parts:[{id:'part',valid:true,solidCount:17,volumeMm3:50}],errors:[]};assert.equal(verifyDesign(s,evidence).claims.find(c=>c.id==='cad-solids').status,'PASS');
  const printed=spec();evidence.revisionHash=designHash(printed);assert.equal(verifyDesign(printed,evidence).claims.find(c=>c.id==='cad-solids').status,'FAIL');
});
test('pocket grammar is bounded printed-only inert cut data',()=>{
  const s=spec();s.parts[0].pockets=[{size:[30,20,10],position:[0,0,6]}];assert.equal(validateDesignSpec(s).parts[0].pockets.length,1);
  s.parts[0].kind='purchased';assert.throws(()=>validateDesignSpec(s),/only allowed on printed/);s.parts[0].kind='printed';s.parts[0].pockets[0].path='/tmp/code';assert.throws(()=>validateDesignSpec(s),/unsupported key/);
});
test('new physics is propagated to overall FAILED without declaring physical validation',()=>{
  const s=spec();s.physicsInputs=motion();s.physicsInputs.motorNoLoadRpm=n(10);const r=verifyDesign(s);assert.equal(r.overall,'FAILED');assert.equal(r.physical,'UNKNOWN');
});
