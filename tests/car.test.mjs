import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CAR,validateCar,controllerDecision,carChecks,carPackage} from '../shared/car-contract.mjs';
const baseline={level:-20,threshold:-25,armed:true,emergencyStop:false,ageMs:0};
test('sound threshold is strict and deterministic',()=>{assert.equal(controllerDecision(baseline).moving,true);for(const level of [-25,-26,-120])assert.equal(controllerDecision({...baseline,level}).moving,false);});
test('controller fails closed on missing invalid and stale samples',()=>{for(const level of [NaN,Infinity,undefined,1,-121])assert.equal(controllerDecision({...baseline,level}).moving,false);for(const ageMs of [251,NaN,-1,Infinity])assert.equal(controllerDecision({...baseline,ageMs}).moving,false);assert.equal(controllerDecision({...baseline,threshold:NaN}).moving,false);});
test('stop and disarm override loud sound',()=>{assert.equal(controllerDecision({...baseline,emergencyStop:true}).moving,false);assert.equal(controllerDecision({...baseline,armed:false}).moving,false);});
test('generated parameters must satisfy template bounds',()=>{assert.deepEqual(validateCar({...DEFAULT_CAR,code:'not executable'}),DEFAULT_CAR);for(const value of [null,{}, {...DEFAULT_CAR,width:999},{...DEFAULT_CAR,threshold:'-25'}])assert.throws(()=>validateCar(value));});
test('package keeps physical proof separate from passing software checks',()=>{const p=carPackage(DEFAULT_CAR,2,'template');assert.ok(carChecks(DEFAULT_CAR).every(x=>x.status==='PASS'));assert.match(p.physicalValidation,/UNKNOWN/);assert.match(p.manufacturingReadiness,/BLOCKED/);assert.equal(p.controller.hardwareConnected,false);assert.equal(p.parts.length,6);});
