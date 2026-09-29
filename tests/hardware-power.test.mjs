import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileKit} from '../engineering/kit.mjs';
import {buildKitHardwareReference,validatePowerCandidate} from '../engineering/hardware-reference.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const reference=()=>buildKitHardwareReference('sound-car-v1',compileKit('sound-car-v1',{},catalog),catalog);

test('portable power candidate preserves actual design assumptions and physical unknowns',()=>{
  const r=reference(),p=r.portablePowerCandidate;
  assert.equal(r.operatingInputs.batteryVoltage.value,4.8);
  assert.equal(p.electricalScreen.nominalMotorRailV,5);
  assert.equal(p.currentDesignMotorVoltageV,4.8);assert.equal(p.requiresDesignRevision,true);
  assert.equal(p.batteryDerivation.minimumNameplateCapacityMah,2000);
  assert.equal(p.batteryDerivation.approximateCellMassG,112);
  assert.equal(p.batteryDerivation.maximumChargedVoltageV,null);
  assert.equal(p.batteryDerivation.runtimeMinutes,null);
  assert.ok(p.components.every(c=>c.sourceUrl.startsWith('https://')&&c.physicalStatus==='UNKNOWN'&&!c.geometryRepresented));
  assert.equal(p.components.find(x=>x.id==='fuse').facts.ratingSelection,'PROVISIONAL');
  assert.ok(Math.abs(p.electricalScreen.twoMotorTheoreticalStallA-.6)<1e-12);
  assert.ok(Math.abs(p.electricalScreen.nominalPackInputBudgetA-.9191176470588236)<1e-12);
  assert.equal(p.physicalResults,'UNKNOWN');assert.equal(r.motorOutputAuthorized,false);
});

test('candidate netlist passes only its explicit topology checks',()=>{
  const checks=validatePowerCandidate(reference().portablePowerCandidate);
  assert.equal(checks.length,7);
  assert.ok(checks.every(c=>c.status==='PASS'&&c.evidenceScope==='CANDIDATE_NETLIST_ONLY'));
});

test('negative controls reject diode reversal, VBUS tie, STOP NO and signal swaps',()=>{
  const mutate=(from,to)=>{const p=reference().portablePowerCandidate;for(const net of p.nets)net.nodes=net.nodes.map(n=>n===from?to:n);return validatePowerCandidate(p);};
  for(const [a,b,id] of [['isolation_diode.A','isolation_diode.K','netlist-pico-diode-or'],['pico.39_VSYS','pico.40_VBUS','netlist-pico-diode-or'],['stop.NC','stop.NO','netlist-stop-nc'],['pico.4_GP2','pico.5_GP3','netlist-firmware-pin-contract'],['microphone.VCC','regulator.VOUT','netlist-adc-domain']]){
    assert.equal(mutate(a,b).find(x=>x.id===id).status,'FAIL');
  }
  const p=reference().portablePowerCandidate;p.nets.find(n=>n.id==='SWITCHED_PACK').nodes.push('holder.+');
  assert.equal(validatePowerCandidate(p).find(x=>x.id==='netlist-fused-mechanical-disconnect').status,'FAIL');
});

test('fastener candidate counts actual mounting locations but does not manufacture fit evidence',()=>{
  const r=reference(),f=r.fastenerCandidate;
  assert.equal(f.bracket.lengthMm,11.1125);assert.equal(f.bracket.thread,'#2-56');
  assert.equal(f.stacks.reduce((s,x)=>s+x.quantity,0)+f.bracket.quantity,14);
  assert.deepEqual(f.additionalQuantity,{m2Screws16mm:8,m2Screws20mm:2,m2Nuts:10,peekWashers:20});
  assert.ok(f.stacks.every(x=>x.physicalFit==='UNKNOWN'&&!x.geometryRepresented&&x.nominalProtrusionBeyondNutMm>.8));
  assert.ok(Math.abs(f.stacks.find(x=>x.id==='caster').gripMm-16.454975)<1e-6);
});

test('firmware defaults remain locked and pin labels agree with netlist artifact',()=>{
  const config=fs.readFileSync(new URL('../firmware/sound-car/config.py',import.meta.url),'utf8');
  assert.match(config,/MOTOR_OUTPUT_ENABLED = False/);assert.match(config,/BEHAVIOR_PROFILE = 'commissioning'/);
  assert.match(config,/CONTINUOUS_PROFILE_REVIEWED = False/);
  const p=reference().portablePowerCandidate;
  for(const [key,gp] of [['MIC',26],['LEFT_IN1',2],['LEFT_IN2',3],['RIGHT_IN1',4],['RIGHT_IN2',5],['SLEEP',6],['FAULT',7],['ARM',14],['STOP',15]]){
    assert.match(config,new RegExp(`${key}_GP = ${gp}\\b`));
    assert.ok(p.nets.some(n=>n.nodes.some(v=>v.endsWith(`_GP${gp}`))));
  }
});
