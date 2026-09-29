import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileDesignKit,PORTABLE_KIT_ID} from '../engineering/kit-registry.mjs';
import {buildPortableHardwareReference,portableComponentGroupRows} from '../engineering/portable-package.mjs';
import {designHash} from '../server/studio-contract.mjs';
const catalog=JSON.parse(readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
const fixture=parameters=>{const {spec,portableRevision}=compileDesignKit(PORTABLE_KIT_ID,parameters||{},catalog);return {spec,revision:portableRevision,reference:buildPortableHardwareReference(spec,catalog,portableRevision)};};
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('portable hardware reference binds the exact full revision, 22 print parts and unchanged caller inputs',()=>{
 const {spec,portableRevision:revision}=compileDesignKit(PORTABLE_KIT_ID,{},catalog),before=JSON.stringify({spec,revision,catalog});const reference=buildPortableHardwareReference(spec,catalog,revision);
 assert.equal(JSON.stringify({spec,revision,catalog}),before);assert.equal(reference.designHash,designHash(spec));assert.equal(reference.baseDesignHash,revision.baseDesignHash);assert.notEqual(reference.designHash,reference.baseDesignHash);assert.equal(reference.printedParts.length,22);assert(reference.printedParts.every(part=>part.processValidated===false));assert.equal(reference.physicalValidation,'UNKNOWN');
 for(const key of ['purchasingAuthorized','printAuthorized','motorOutputAuthorized'])assert.equal(reference[key],false);
});
test('stale metadata, geometry edits and changed source core are rejected instead of regrouped',()=>{
 const {spec,revision}=fixture();for(const mutate of [r=>r.designHash='0'.repeat(64),r=>r.baseDesignHash='0'.repeat(64),r=>r.componentGroups[0].quantity=4,r=>r.massBudget.totalMassG[1]=1]){const changed=structuredClone(revision);mutate(changed);assert.throws(()=>buildPortableHardwareReference(spec,catalog,changed),/binding/);}
 const edited=structuredClone(spec);edited.parts.find(part=>part.id==='power_tray').position[0]+=1;const forged={...revision,designHash:designHash(edited)};assert.throws(()=>buildPortableHardwareReference(edited,catalog,forged),/reviewed portable compiler/);
 const changedCatalog=structuredClone(catalog);changedCatalog.components.find(c=>c.id==='pololu-lp6v-1098').ratings.noLoadRpm.value+=1;assert.throws(()=>buildPortableHardwareReference(spec,changedCatalog,revision),/source core/);
});
test('purchase groups never count source envelopes, lead shapes or a lever keepout as individual purchases',()=>{
 const {reference}=fixture(),rows=portableComponentGroupRows(reference),byId=new Map(rows.map(row=>[row.componentId,row]));assert.equal(rows.length,18);assert.equal(new Set(rows.map(row=>row.componentId)).size,18);
 for(const id of ['pololu-lp6v-1098','pololu-wheel-1420','pololu-bracket-1086']){assert.equal(byId.get(id).quantity,2);assert.equal(byId.get(id).purchasePackageQuantity,null);assert.match(byId.get(id).purchaseNote,/package count/);}
 assert.equal(byId.get('power-holder').quantity,1);assert.equal(byId.get('power-cells').quantity,4);assert.deepEqual(byId.get('power-cells').modelPartIds,[]);assert.deepEqual(byId.get('power-cells').containingEnvelopePartIds,['battery_holder']);assert.match(byId.get('power-cells').purchaseNote,/not four packages/);
 assert.equal(byId.get('power-fuse_holder').quantity,1);assert.equal(byId.get('power-fuse').quantity,1);assert.equal(byId.get('power-disconnect').quantity,1);assert.equal(byId.get('power-disconnect').modelPartIds.length,4);assert.equal(byId.get('power-arm').quantity,1);assert.equal(byId.get('power-arm').modelPartIds.length,6);assert.equal(byId.get('power-stop').quantity,1);assert.deepEqual(byId.get('power-stop').keepoutPartIds,['stop_lever_motion']);
 assert(!rows.some(row=>row.componentId.startsWith('arm_lead_')));assert(rows.every(row=>row.price===null&&row.stock===null&&row.physicalFit==='UNKNOWN'));assert.equal(byId.get('adafruit-max4466-1063').geometryRepresentation,'SOURCE_DERIVED_PCB_OUTLINE_ONLY');
});
test('new 5V and 250mA screen cannot inherit the old 150mA result or motor-rail assumption',()=>{
 const {spec,reference}=fixture(),power=reference.portablePowerCandidate,screen=power.electricalScreen;
 assert.equal(reference.operatingInputs.batteryVoltage.value,5);assert.equal(screen.nominalMotorRailV,5);assert.equal(screen.assumedLogicAllowanceA,.25);assert.deepEqual(screen.inputs.logicAllowance,spec.physicsInputs.logicCurrentA);near(screen.twoMotorTheoreticalStallA,.6);near(screen.nominalOutputBudgetA,.85);near(screen.nominalOutputBudgetW,4.25);near(screen.nominalPackInputBudgetA,5*.85/(4.8*.85));
 assert.equal(screen.rawPackNominalVoltageV,4.8);assert.equal(power.currentDesignMotorVoltageV,5);assert.equal(power.requiresDesignRevision,false);assert.equal(power.runtimeMinutes,null);assert.equal(power.batteryDerivation.runtimeMinutes,null);assert.equal(power.batteryDerivation.minimumNameplateCapacityMah,2000);assert.equal(power.physicalResults,'UNKNOWN');assert(power.topologyChecks.every(check=>check.status==='PASS'&&check.evidenceScope==='CANDIDATE_NETLIST_ONLY'));
});
test('represented supports are distinguished from unmodelled wiring, contained items and physical fit',()=>{
 const {reference}=fixture(),byId=new Map(reference.components.map(item=>[item.id,item]));
 for(const id of ['power-holder','power-regulator','power-fuse_holder','power-disconnect','power-arm','power-stop'])assert.equal(byId.get(id).geometryRepresented,true);
 for(const id of ['power-cells','power-fuse','power-isolation_diode','power-arm_pullup','power-stop_pullup'])assert.equal(byId.get(id).geometryRepresented,false);
 assert(reference.additionalRequiredItems.some(item=>item.id==='harness-and-transitions'&&item.geometryRepresented===false));assert(reference.additionalRequiredItems.some(item=>item.id==='protection-and-access'&&item.geometryRepresented===true&&item.geometryRepresentation==='PARTIAL_SUPPORT_AND_GUARD_CAD'));
 assert(reference.releaseBlockers.length>=10);assert(reference.releaseBlockers.every(item=>item.status==='UNKNOWN'));assert.match(reference.legacyPowerGuide.applicability,/150 mA/);
});
test('all new fastener proposals and R7 tests remain unreleased and have no invented grades or torque',()=>{
 const {reference}=fixture(),fasteners=reference.fastenerCandidate;assert.equal(fasteners.portableThroughStacks.length,2);assert.deepEqual(fasteners.portableThroughStacks.map(item=>item.gripMm),[36,64]);assert.equal(fasteners.additionalMountLocations.length,7);
 for(const item of [...fasteners.portableThroughStacks,...fasteners.additionalMountLocations]){assert.equal(item.grade,null);assert.equal(item.torqueNm,null);assert.equal(item.physicalFit,'UNKNOWN');}
 assert.equal(fasteners.nkkMountHardware.backNutReservedMm,3);assert.equal(fasteners.nkkMountHardware.backNutDimensionSource,null);assert.equal(fasteners.nkkMountHardware.quantity,null);
 const plan=reference.verificationPlan;assert.equal(plan.kitId,PORTABLE_KIT_ID);assert.equal(plan.revisionHash,reference.designHash);assert(plan.requirements.every(item=>item.status==='UNKNOWN'));const r7=plan.requirements.find(item=>item.requirementId==='R7');assert.equal(r7.physicalAcceptance.length,5);assert(r7.physicalAcceptance.every(item=>item.status==='UNKNOWN'));
});
test('changed explicit speed and threshold choices receive their own bound package and independent rows',()=>{
 const {spec,reference}=fixture({targetSpeedMS:.3,thresholdDbfs:-35});assert.equal(reference.designHash,designHash(spec));assert.equal(reference.operatingInputs.targetSpeedMS.value,.3);assert.equal(reference.operatingInputs.thresholdDbfs.value,-35);assert.equal(reference.operatingPointSensitivity.slowerMotor.status,'PASS');assert.match(reference.releaseBlockers.find(item=>item.id==='physical-motion-and-sound').reason,/scenario is PASS/);const rows=portableComponentGroupRows(reference);rows[0].modelPartIds.push('mutated');assert(!reference.components[0].modelPartIds.includes('mutated'));assert.throws(()=>portableComponentGroupRows({kitId:'sound-car-v1',components:[]}),/validated portable/);
});
