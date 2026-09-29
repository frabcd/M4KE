import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileKit} from '../engineering/kit.mjs';
import {compilePortableKit,partBounds} from '../engineering/portable-kit.mjs';
import {designHash,validateDesignSpec,verifyDesign} from '../server/studio-contract.mjs';

const catalog=JSON.parse(fs.readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const base=()=>compileKit('sound-car-v1',{},catalog);
const make=()=>compilePortableKit(base(),catalog);
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('portable revision is separate, deterministic and does not mutate the base or catalog',()=>{
  const b=base(),before=structuredClone(b),catalogBefore=JSON.stringify(catalog);
  const {spec,revision}=compilePortableKit(b,catalog);
  assert.deepEqual(b,before);assert.equal(JSON.stringify(catalog),catalogBefore);
  assert.equal(revision.baseDesignHash,designHash(b));assert.equal(revision.designHash,designHash(spec));
  assert.notEqual(revision.designHash,revision.baseDesignHash);
  assert.deepEqual(compilePortableKit(b,catalog),{spec,revision});
  assert.equal(revision.id,'sound-car-portable-reg5-candidate-v1');
  assert.equal(spec.parts.length,48);assert.equal(spec.parts.filter(p=>p.kind==='printed').length,22);
  assert.equal(revision.physicalStatus,'UNKNOWN');assert.equal(revision.nativeStatus,'NOT_RUN');
});

test('a modified, resized or differently sourced base cannot silently reuse reviewed interfaces',()=>{
  const moved=base();moved.parts.find(p=>p.id==='pico').position[0]+=1;
  assert.throws(()=>compilePortableKit(moved,catalog),/unchanged reviewed base geometry/);
  assert.throws(()=>compilePortableKit(compileKit('sound-car-v1',{lengthMm:190},catalog),catalog),/no silent scaling/);
  const swapped=base();swapped.parts.find(p=>p.id==='motor_l').shape.catalogId='pololu-lp6v-992';
  assert.throws(()=>compilePortableKit(swapped,catalog),/reviewed motor_l/);
  assert.throws(()=>compilePortableKit(base(),{components:[]}),/unavailable/);
});

test('the old source parts and source-matched mounting coordinates remain unchanged',()=>{
  const b=base(),{spec}=make();
  for(const p of b.parts){const changed=spec.parts.find(x=>x.id===p.id);
    if(p.id==='chassis'){
      assert.deepEqual(changed.shape,p.shape);assert.deepEqual(changed.position,p.position);
      assert.deepEqual(changed.holes.slice(0,p.holes.length),p.holes);assert.equal(changed.holes.length,20);
    } else assert.deepEqual(changed,p);
  }
  assert.equal(spec.parts.find(p=>p.id==='microphone_board').shape.type,'box');
  assert.match(spec.parts.find(p=>p.id==='microphone_board').source,/not exact populated/);
});

test('48-part host bound and assembly/feature caps remain strict',()=>{
  const {spec}=make();assert.doesNotThrow(()=>validateDesignSpec(spec));
  for(const p of spec.parts){assert.ok((p.holes||[]).length<=24);assert.ok((p.pockets||[]).length<=8);}
  assert.ok(spec.assembly.every(s=>s.partIds.length<=24));
  const tooMany=structuredClone(spec);tooMany.parts.push({...tooMany.parts[0],id:'part_49'});
  assert.throws(()=>validateDesignSpec(tooMany));
  assert.ok(spec.assembly.find(s=>s.id==='commission').requires.includes('portable_controls'));
  assert.equal(spec.assembly.at(-1).id,'commission');
});

test('NKK standard-hardware seat respects the visually checked source maximum',()=>{
  const {spec,revision}=make(),nkk=revision.interfaces.nkk;
  assert.ok(nkk.seatThicknessMm<=nkk.sourceMaximumPanelMm);near(nkk.seatThicknessMm,2.4);
  const bridge=spec.parts.find(p=>p.id==='control_gantry');
  assert.ok(bridge.holes.some(h=>h.diameter===6.5&&h.position[0]===0));
  assert.ok(bridge.holes.some(h=>h.diameter===2.2&&h.position[0]===6.1));
  assert.ok(bridge.pockets.some(p=>p.size[2]===1.6));
  const terminal=partBounds(spec.parts.find(p=>p.id==='power_switch_lugs'),catalog);
  near(terminal[2][0],64.1);near(terminal[2][1],68.6);
  assert.equal(nkk.sourceTolerance,null);assert.equal(nkk.backNutReservedMm,3);
});

test('battery retention and underside caster relief have explicit nominal dimensions, not fit certification',()=>{
  const {spec,revision}=make(),byId=new Map(spec.parts.map(p=>[p.id,p]));
  const holder=partBounds(byId.get('battery_holder'),catalog);
  assert.deepEqual(holder,[[2.5,73.5],[-32.5,32.5],[33,53]]);
  assert.equal(revision.interfaces.battery.trayPocketMm[0]-71,1);
  near(partBounds(byId.get('battery_rear_clamp'),catalog)[2][1],57);
  assert.ok(revision.interfaces.battery.underTrayReliefTopZmm>revision.interfaces.battery.casterTipAssumedZmm);
  assert.deepEqual(revision.proposedFasteners.map(f=>f.locations),[2,2]);
});

test('ARM and STOP use separate source-reviewed cases, terminals, mounting and movement envelopes',()=>{
  const {spec,revision}=make();
  assert.equal(spec.parts.filter(p=>p.id.startsWith('arm_lead_')).length,4);
  const arm=spec.parts.find(p=>p.id==='arm_cradle');
  for(const x of [-3.25,3.25])for(const y of [-2.25,2.25])assert.ok(arm.holes.some(h=>h.position[0]===x&&h.position[1]===y&&h.diameter===1.8));
  const stop=spec.parts.find(p=>p.id==='stop_body');
  assert.equal(stop.holes[0].axis,'y');near(stop.holes[1].position[0]-stop.holes[0].position[0],6.5);
  assert.match(spec.parts.find(p=>p.id==='stop_lever_motion').name,/not solid blade/);
  assert.match(revision.interfaces.stop.sourceHoles,/oblong/);
});

test('source-derived subparts are grouped into actual BOM identities and never masquerade as catalog STEP',()=>{
  const {spec,revision}=make();const ids=revision.componentGroups.flatMap(g=>g.partIds);
  assert.equal(new Set(ids).size,ids.length);assert.equal(revision.componentGroups.length,6);
  for(const id of ids){const p=spec.parts.find(p=>p.id===id);assert.equal(p.kind,'purchased');assert.notEqual(p.shape.type,'catalog');assert.match(p.source,/SOURCE_DERIVED_ENVELOPE/);}
  for(const group of revision.componentGroups)assert.equal(group.physicalFit,'UNKNOWN');
  for(const key of ['nkk','arm','stop'])assert.match(revision.sourceDimensions[key].sha256,/^[a-f0-9]{64}$/);
});

test('new power domain and conservative mass/axle scenarios cannot inherit old battery/runtime assumptions',()=>{
  const {spec,revision}=make();assert.equal(spec.physicsInputs.batteryVoltage.value,5);
  assert.equal(spec.physicsInputs.logicCurrentA.value,.25);
  for(const key of ['batteryCapacityAh','batteryUsableFraction','batteryMaxVoltage','batteryMaxA'])assert.equal(spec.physicsInputs[key],undefined);
  const {items,totalMassG}=revision.massBudget;
  near(totalMassG[0],items.reduce((s,i)=>s+i.massG[0],0));near(totalMassG[1],items.reduce((s,i)=>s+i.massG[1],0));
  assert.ok(totalMassG[0]>250&&totalMassG[1]<650);
  near(spec.physicsInputs.massKg.value,totalMassG[1]/1000,1e-7);
  const axle=revision.axleLoadScreen;assert.ok(axle.cgXmm[0]<axle.cgXmm[1]);
  near(axle.drivenWeightFraction[0],(axle.casterXmm-axle.cgXmm[1])/(axle.casterXmm-axle.axleXmm));
  assert.ok(axle.drivenWeightFraction[0]>0&&axle.drivenWeightFraction[1]<1);
  assert.equal(spec.physicsInputs.massKg.basis,'ASSUMED');assert.equal(spec.physicsInputs.drivenWeightFraction.basis,'ASSUMED');
  assert.equal(revision.powerDomain.rawSeriesPackNominalV,4.8);assert.equal(revision.powerDomain.motorRailNominalV,5);
  assert.equal(revision.powerDomain.runtimeEstimate,null);
  assert.equal(revision.operatingPointSensitivity.nominal.status,'PASS');assert.equal(revision.operatingPointSensitivity.slowerMotor.status,'FAIL');
});

test('nominal analytical screening is conditional and matched excessive load/speed controls fail',()=>{
  const {spec}=make(),v=verifyDesign(spec),claim=(v,id)=>v.claims.find(c=>c.id===id);
  assert.equal(v.physical,'UNKNOWN');assert.equal(v.overall,'UNVERIFIED');
  assert.equal(claim(v,'motion-operating-point').status,'PASS');
  assert.equal(claim(v,'maximum-supply-voltage').status,'UNKNOWN');
  const fast=structuredClone(spec);fast.physicsInputs.targetSpeedMS.value=1;
  assert.equal(claim(verifyDesign(fast),'motion-operating-point').status,'FAIL');
  const heavy=structuredClone(spec);heavy.physicsInputs.massKg.value=1;
  assert.equal(claim(verifyDesign(heavy),'motion-operating-point').status,'FAIL');
  const slippery=structuredClone(spec);slippery.physicsInputs.tractionCoefficient.value=.2;
  assert.equal(claim(verifyDesign(slippery),'traction-margin').status,'FAIL');
});

test('requirements persist and limitations remain explicit rather than using CAD as release',()=>{
  const b=base(),{spec,revision}=make();assert.deepEqual(spec.requirements.slice(0,b.requirements.length),b.requirements);
  assert.equal(spec.requirements.at(-1).id,'R7');
  assert.ok(spec.unknowns.some(s=>s.includes('strain-relief')));
  assert.ok(spec.unknowns.some(s=>s.includes('continuous motor')));
  assert.ok(revision.limits.some(s=>s.includes('child-safety')));
});
