import test from 'node:test';
import assert from 'node:assert/strict';
import {electricalFixture} from './studio-electrical-fixture.mjs';
import {electricalChecks,buildElectricalArtifacts,validateElectrical} from '../server/studio-electrical.mjs';
import {requestConstraints,requestConstraintIssues} from '../server/studio-request-constraints.mjs';
const request='声音超过60分贝的时候前进 小于的时候停止。 使用esp32 包装外壳 使用pla材质3d打印 使用f1的形状 600 cny';
function fixture(){
 const s=electricalFixture(), c=s.electrical.components[0];
 c.profileId='esp32-devkitc-v4-wroom32e'; s.parts[0].shape={type:'box',size:[55,28,13]};
 const pins={GP2:'IO16',GP3:'IO17',GP4:'IO18',GP5:'IO19',GP6:'IO21',GP7:'IO22',GP26:'IO34',GP14:'IO23',GP15:'IO25','3V3(OUT)':'3V3',GND:'GND'};
 for(const a of c.terminalAnchors)a.terminal=pins[a.terminal];
 for(const w of s.electrical.connections)for(const e of [w.from,w.to])if(e.partId==='pico')e.terminal=pins[e.terminal];
 s.electrical.control.profile='esp32-max4466-drv8833-sound-v1';s.electrical.control.targetDbSpl=60;return s;
}
test('explicit ESP32 and 60 dB are not replaced by Pico and relative noise',()=>{
 assert.equal(requestConstraintIssues(request,electricalFixture()).length,2);
 assert.deepEqual(requestConstraintIssues(request,fixture()),[]);
 assert.deepEqual(requestConstraints('relative -25 dBFS'),{esp32:false,targetDbSpl:null});
 assert.equal(requestConstraints('60 dB SPL').targetDbSpl,60);
});
test('ESP32 netlist derives real IO GPIO numbers; calibration and fit stay UNKNOWN',()=>{
 const s=fixture();assert.equal(validateElectrical(s.electrical,s).control.targetDbSpl,60);
 const checks=electricalChecks(s);assert.deepEqual(checks.filter(c=>c.status==='FAIL'),[]);
 const binding=checks.find(c=>c.id==='electrical-control-binding');assert.equal(binding.observed.pins.MIC_GP,34);assert.equal(binding.observed.pins.LEFT_IN1_GP,16);
 assert.equal(checks.find(c=>c.id==='electrical-spl-calibration').status,'UNKNOWN');
});
test('ESP32 input-only pin cannot drive a motor and mismatched firmware blocks export',async()=>{
 const s=fixture();s.electrical.connections[0].from.terminal='IO35';
 assert.equal((await buildElectricalArtifacts(s,'a'.repeat(64))).summary.firmware.status,'BLOCKED');
 const wrong=fixture();wrong.electrical.control.profile='pico-max4466-drv8833-sound-v1';
 assert.equal((await buildElectricalArtifacts(wrong,'a'.repeat(64))).summary.firmware.status,'BLOCKED');
});
test('ESP32 export preserves 60 SPL target, commissioning locks and watchdog minimum',async()=>{
 const {files,summary}=await buildElectricalArtifacts(fixture(),'b'.repeat(64));assert.equal(summary.firmware.status,'GENERATED_OUTPUT_DISABLED');
 for(const pattern of [/TARGET_DB_SPL = 60/,/SPL_CALIBRATION_OFFSET_DB = None/,/SPL_CALIBRATION_REVIEWED = False/,/BOARD_PROFILE = 'esp32'/,/WDT_TIMEOUT_MS = 2000/,/MOTOR_OUTPUT_ENABLED = False/])assert.match(files['firmware/config.py'],pattern);
 assert.match(files['firmware/main.py'],/adc.atten\(ADC.ATTN_11DB\)/);assert.match(files['firmware/README.md'],/ESP32-WROOM-32E/);
});
