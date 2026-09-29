import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileKit} from '../engineering/kit.mjs';
import {buildKitHardwareReference} from '../engineering/hardware-reference.mjs';
import {designHash} from '../server/studio-contract.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const spec=()=>compileKit('sound-car-v1',{targetSpeedMS:.5},catalog);

test('kit reference follows exact selected hardware, source geometry and model quantities',()=>{
  const s=spec(),reference=buildKitHardwareReference('sound-car-v1',s,catalog);
  assert.equal(reference.designHash,designHash(s));
  const motor=reference.components.find(c=>c.catalogId==='pololu-lp6v-1098');
  assert.equal(motor.sku,'1098');assert.equal(motor.quantity,2);assert.equal(motor.ratings.noLoadRpm.value,270);
  assert.equal(motor.ratings.theoreticalStallTorqueKgfCm.value,.44);assert.ok(motor.sourceGeometrySha256);
  const wheels=reference.components.find(c=>c.catalogId==='pololu-wheel-1420');
  assert.equal(wheels.quantity,2);assert.equal(wheels.ratings.diameterMm.value,60);
  assert.equal(wheels.purchasePackageQuantity,null);
  assert.ok(!reference.components.some(c=>c.sku==='992'));assert.equal(reference.printedParts.length,10);
});

test('missing sources and legacy motor substitution cannot silently receive kit bindings',()=>{
  const s=spec();s.parts.find(p=>p.id==='motor_l').shape.catalogId='pololu-lp6v-992';
  assert.throws(()=>buildKitHardwareReference('sound-car-v1',s,catalog),/hardware mismatch/);
  assert.throws(()=>buildKitHardwareReference('sound-car-v1',spec(),{components:[]}),/source geometry/);
  assert.equal(buildKitHardwareReference('generic',{},{}),null);
});

test('outline-only microphone, extra hardware and bench PWM mismatch remain release blockers',()=>{
  const r=buildKitHardwareReference('sound-car-v1',spec(),catalog);
  assert.equal(r.components.find(c=>c.catalogId==='adafruit-max4466-1063').geometryRepresentation,'SOURCE_DERIVED_PCB_OUTLINE_ONLY');
  for(const id of ['motor-supply','logic-supply','fuse','power-disconnect','arm-button','stop-contact','fasteners','interconnect','guards']){
    const item=r.additionalRequiredItems.find(x=>x.id===id);assert.equal(item.geometryRepresented,false);assert.equal(item.blocksPhysicalRelease,true);
  }
  assert.match(r.releaseBlockers.find(x=>x.id==='firmware-operating-point').reason,/not the bench PWM operating point/);
  assert.ok(r.releaseBlockers.every(x=>x.status==='UNKNOWN'));
  assert.equal(r.motorOutputAuthorized,false);assert.equal(r.printAuthorized,false);assert.equal(r.purchasingAuthorized,false);
});

test('hardware artifact is detached data and preserves declared operating assumptions',()=>{
  const s=spec(),r=buildKitHardwareReference('sound-car-v1',s,catalog);
  assert.equal(r.operatingInputs.batteryVoltage.basis,'ASSUMED');
  r.components[0].sourceUrls.push('mutated');assert.ok(!JSON.stringify(catalog).includes('mutated'));
  r.operatingInputs.massKg.value=99;assert.equal(s.physicsInputs.massKg.value,.35);
});
