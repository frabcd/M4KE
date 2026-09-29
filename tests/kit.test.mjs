import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileKit,getKitOptions,getKitVerificationPlan,rotate} from '../engineering/kit.mjs';
import {verifyDesign} from '../server/studio-contract.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const make=(parameters={})=>compileKit('sound-car-v1',parameters,catalog);

test('kit is explicit, bounded and refuses unknown/incomplete catalog selections',()=>{
  assert.equal(getKitOptions(catalog)[0].availability,'candidate');
  assert.throws(()=>compileKit('generic',{},catalog),/not automatically converted/);
  assert.throws(()=>make({prompt:'other toy'}),/Unsupported/);
  for(const parameters of [{widthMm:99},{lengthMm:149},{lengthMm:201},{targetSpeedMS:NaN},{thresholdDbfs:0}]) assert.throws(()=>make(parameters));
  assert.throws(()=>compileKit('sound-car-v1',{}, {components:[]}),/unavailable/);
  const missing=structuredClone(catalog);missing.components=missing.components.filter(c=>c.id!=='adafruit-max4466-1063');
  assert.equal(getKitOptions(missing)[0].availability,'unavailable');
});

test('compiler never silently substitutes stale interfaces or scales supplier solids',()=>{
  const stale=structuredClone(catalog);stale.components.find(c=>c.id==='pololu-bracket-1086').interfaces.find(i=>i.id==='chassis-mounting-holes').sourceSha256='0'.repeat(64);
  assert.throws(()=>compileKit('sound-car-v1',{},stale),/reconciliation/);
  const s=make();assert.equal(s.parts.length,20);assert.equal(s.parts.filter(p=>p.kind==='printed').length,10);
  for(const p of s.parts.filter(p=>p.shape.type==='catalog'))assert.deepEqual(Object.keys(p.shape).sort(),['catalogId','type']);
  assert.match(s.parts.find(p=>p.id==='microphone_board').source,/not exact populated/);
  assert.ok(!s.parts.some(p=>/battery/.test(p.id)));assert.ok(s.unknowns.some(x=>/battery/.test(x)));
});

test('source-matched holes are projected with the same XYZ Euler transform as the worker',()=>{
  const s=make(),chassis=s.parts.find(p=>p.id==='chassis');assert.equal(chassis.holes.length,14);
  const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<1e-6);
  assert.ok(near(rotate([1,2,3],[90,90,0]),[3,1,2]));
  const pico=s.parts.find(p=>p.id==='pico'),source=catalog.components.find(c=>c.id==='raspberry-pi-pico-r3');
  for(const [index,point] of source.interfaces.find(i=>i.id==='mounting-holes').dimensions.centresMm.entries()){
    const world=rotate(point,pico.rotation).map((v,i)=>v+pico.position[i]);
    const spacer=s.parts.find(p=>p.id===`pico_standoff_${index}`);
    assert.ok(near(world.slice(0,2),spacer.position.slice(0,2)));
    assert.ok(Math.abs(world[2]-(spacer.position[2]+3))<1e-6);
    assert.ok(chassis.holes.some(h=>near(h.position.slice(0,2),world.slice(0,2))));
  }
});

test('default car arithmetic is conditional, excessive target fails, all physical requirements stay unknown',()=>{
  const s=make({targetSpeedMS:.5}),v=verifyDesign(s);
  assert.equal(v.claims.find(c=>c.id==='motion-operating-point').status,'PASS');
  assert.equal(v.claims.find(c=>c.id==='maximum-supply-voltage').status,'UNKNOWN');
  assert.equal(v.physical,'UNKNOWN');assert.equal(v.overall,'UNVERIFIED');
  assert.equal(verifyDesign(make({targetSpeedMS:1})).claims.find(c=>c.id==='motion-operating-point').status,'FAIL');
  const plan=getKitVerificationPlan('sound-car-v1',s);assert.equal(plan.requirements.length,s.requirements.length);
  assert.ok(plan.requirements.every(r=>r.status==='UNKNOWN'&&r.physicalAcceptance.every(a=>a.status==='UNKNOWN')));
  assert.deepEqual(plan.requirements.map(r=>r.text),s.requirements.map(r=>r.text));
  assert.ok(plan.requirements.find(r=>r.requirementId==='R5').hostClaimIds.includes('kernel-chassis:mesh'));
  assert.equal(getKitVerificationPlan('other',s),null);
});
