import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {validateElectrical,electricalChecks,resolveElectricalSummary,buildElectricalArtifacts,electricalPromptContext,electricalDraftIssues,ELECTRICAL_JSON_SCHEMA} from '../server/studio-electrical.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';
import {engineeringChecks} from '../engineering/physics.mjs';
const hash='a'.repeat(64),check=(s,id)=>electricalChecks(s).find(c=>c.id==='electrical-'+id),fails=s=>electricalChecks(s).filter(c=>c.status==='FAIL');
const wire=(s,from,to,kind='signal')=>s.electrical.connections.push({id:'extra_'+s.electrical.connections.length,from:{partId:from[0],terminal:from[1]},to:{partId:to[0],terminal:to[1]},kind,color:'#123456',wireAwg:22});

test('electrical contract is bounded, inert and rejects duplicate IDs/connections',()=>{
  const s=electricalFixture();assert.deepEqual(validateElectrical(s.electrical,s),s.electrical);assert.equal(ELECTRICAL_JSON_SCHEMA.properties.components.maxItems,32);
  const bad=structuredClone(s.electrical);bad.executable='foo';assert.throws(()=>validateElectrical(bad,s),/unsupported key/);
  const duplicates=structuredClone(s.electrical);duplicates.connections.push({...duplicates.connections[0],id:'different'});assert.throws(()=>validateElectrical(duplicates,s),/duplicate/);
  for(const value of [NaN,Infinity,0,.50001]){const bad=structuredClone(s.electrical);bad.control.pwmDuty=value;assert.throws(()=>validateElectrical(bad,s));}
  const badComponent=structuredClone(s.electrical);badComponent.components[0].partId='absent';assert.throws(()=>validateElectrical(badComponent,s),/existing design part/);
  const badControl=structuredClone(s.electrical);badControl.control.stopPartId='arm';assert.throws(()=>validateElectrical(badControl,s),/duplicate/);
});
test('consistent fixture has no FAIL but source identities and harness remain UNKNOWN',()=>{
  const s=electricalFixture();assert.deepEqual(fails(s),[]);assert.equal(check(s,'identity').status,'UNKNOWN');assert.equal(check(s,'ratings').status,'UNKNOWN');assert.equal(check(s,'control-binding').status,'PASS');assert.equal(check(s,'independent-cutoff').status,'PASS');assert.ok(electricalChecks(s).filter(c=>c.id!=='electrical-routing').every(c=>c.critical===true));
});
test('firmware derives changed pins and settings from the same netlist; source adapter unchanged',async()=>{
  const s=electricalFixture();s.electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP10';s.electrical.components[0].terminalAnchors.find(a=>a.terminal==='GP2').terminal='GP10';s.electrical.control.thresholdDbfs=-31.5;
  const {files,summary}=await buildElectricalArtifacts(s,hash);assert.equal(summary.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.match(files['firmware/config.py'],/LEFT_IN1_GP = 10/);assert.match(files['firmware/config.py'],/THRESHOLD_DBFS = -31.5/);assert.match(files['firmware/config.py'],/RIGHT_POLARITY = -1/);assert.match(files['firmware/config.py'],/MOTOR_OUTPUT_ENABLED = False/);assert.match(files['firmware/config.py'],/CONTINUOUS_PROFILE_REVIEWED = False/);
  assert.equal(files['firmware/main.py'],await readFile(new URL('../firmware/sound-car/main.py',import.meta.url),'utf8'));assert.equal(files['firmware/controller.py'],await readFile(new URL('../firmware/sound-car/controller.py',import.meta.url),'utf8'));
  const saved=JSON.parse(files['electrical/netlist.json']);assert.equal(saved.designHash,hash);assert.deepEqual(saved.electrical,s.electrical);assert.equal(saved.firmware.sourceSha256['config.py'],createHash('sha256').update(files['firmware/config.py']).digest('hex'));
});
test('unknown terminal, malformed profile, missing return and wrong ADC each block firmware',async()=>{
  for(const mutate of [s=>s.electrical.connections[0].to.terminal='NOT_A_PIN',s=>s.electrical.components[0].profileId='not-a-supported-controller',s=>s.electrical.connections=s.electrical.connections.filter(c=>!(c.to.partId==='driver'&&c.to.terminal==='GND')),s=>s.electrical.connections.find(c=>c.to.partId==='mic'&&c.to.terminal==='OUT').from.terminal='GP22']){const s=electricalFixture();mutate(s);const out=await buildElectricalArtifacts(s,hash);assert.equal(out.summary.firmware.status,'BLOCKED');assert.equal(out.files['firmware/main.py'],undefined);}
});
test('catalog identity mismatch and 3D-printed electronics are FAIL',()=>{
  const s=electricalFixture();s.parts[0].shape.catalogId='pololu-drv8833-2130';assert.equal(check(s,'identity').status,'FAIL');const p=electricalFixture();p.parts[0].kind='printed';assert.equal(check(p,'identity').status,'FAIL');
});
test('supply shorts, GPIO fanout and tied motor outputs are rejected',()=>{
  for(const pair of [[['pico','3V3(OUT)'],['driver','VIN']],[['driver','AOUT1'],['driver','AOUT2']],[['pico','GP2'],['pico','GND']],[['battery','+'],['pico','VSYS']],[['pico','VBUS'],['battery','+']]]){const s=electricalFixture();wire(s,...pair);assert.equal(check(s,'rail-conflicts').status,'FAIL',JSON.stringify(pair));}
  const s=electricalFixture();s.electrical.connections.find(c=>c.to.terminal==='AIN2').from.terminal='GP2';assert.equal(check(s,'gpio-exclusive').status,'FAIL');assert.equal(check(s,'control-binding').status,'FAIL');
});
test('NC STOP, NO ARM, motor channel and independent cutoff cannot be silently substituted',()=>{
  const s=electricalFixture();s.electrical.connections.find(c=>c.to.partId==='stop').to.terminal='NO';assert.equal(check(s,'control-binding').status,'FAIL');
  const bypass=electricalFixture();wire(bypass,['battery','+'],['driver','VIN'],'power');assert.equal(check(bypass,'independent-cutoff').status,'FAIL');
  const fuse=electricalFixture();wire(fuse,['battery','+'],['cutoff','COM'],'power');assert.equal(check(fuse,'independent-cutoff').status,'FAIL');
  const motor=electricalFixture();motor.electrical.connections.find(c=>c.from.terminal==='AOUT1').to.partId='right';assert.equal(check(motor,'control-binding').status,'FAIL');
  const contact=electricalFixture();wire(contact,['stop','COM'],['stop','NC'],'ground');assert.equal(check(contact,'control-binding').status,'FAIL');
});
test('wire rendering is transform-correct and missing anchors never become centers',()=>{
  const s=electricalFixture();s.parts[0].position=[10,20,30];s.parts[0].rotation=[0,0,90];s.electrical.components[0].terminalAnchors.find(a=>a.terminal==='GP2').positionMm=[2,0,0];s.electrical.connections[0].waypointsMm=[[50,60,70]];
  let summary=resolveElectricalSummary(s,hash);assert.deepEqual(summary.connections[0].fromAnchorMm,[10,22,30]);assert.deepEqual(summary.connections[0].polylineMm[1],[50,60,70]);assert.equal(summary.components[0].terminalAnchors[0].basis,'MODEL_ASSUMED');
  s.electrical.components[0].terminalAnchors=[];summary=resolveElectricalSummary(s,hash);assert.equal(summary.connections[0].polylineMm,undefined);assert.equal(summary.connections[0].routingStatus,'MISSING_ANCHORS');
});
test('exports share connection count, escape text, and never include an executable failed design',async()=>{
  const s=electricalFixture();s.electrical.components[0].profileId='<script>';s.electrical.connections[0].to.terminal='<script>alert(1)</script>';const {files,summary}=await buildElectricalArtifacts(s,hash);assert.match(files['electrical/wiring.svg'],/&lt;script&gt;/);assert.doesNotMatch(files['electrical/wiring.svg'],/<script>/);assert.equal(files['electrical/connections.csv'].split('\r\n').length,s.electrical.connections.length+1);assert.equal(summary.firmware.status,'BLOCKED');assert.equal(Object.keys(files).some(k=>k.startsWith('firmware/')),false);assert.equal(Object.keys(files).some(k=>k.endsWith('.stl')),false);
});
test('non-electronic projects remain untouched; unknown control produces no fixed reference firmware',async()=>{
  assert.deepEqual(electricalChecks({parts:[]}),[]);assert.deepEqual((await buildElectricalArtifacts({parts:[]},hash)).files,{});const s=electricalFixture();delete s.electrical.control;const result=await buildElectricalArtifacts(s,hash);assert.equal(result.summary.firmware.status,'NOT_REQUESTED');assert.equal(result.files['firmware/config.py'],undefined);assert.throws(()=>resolveElectricalSummary(s,'bad\nMOTOR_OUTPUT_ENABLED=True'),/SHA256/);
});
test('prompt context uses host-owned profiles and no qualified coordinate claims',()=>{
  const ctx=electricalPromptContext();assert.ok(ctx.profiles.length>=10);assert.match(ctx.coordinateFrame,/MODEL_ASSUMED/);assert.ok(ctx.profiles.every(p=>p.terminalPositions==='NOT_SOURCE_QUALIFIED'));assert.equal(ctx.profiles.find(p=>p.id==='pololu-drv8833-2130').catalogId,'pololu-drv8833-2130');
});
test('initial-format feedback aggregates missing roles, controls and anchors without hiding UNKNOWN evidence',()=>{
  const s=electricalFixture();assert.deepEqual(electricalDraftIssues(s),[]);assert.equal(check(s,'ratings').status,'UNKNOWN');
  s.electrical.control.armPartId='cutoff';s.electrical.control.stopPartId='cutoff';s.electrical.control.pwmDuty=1;s.electrical.components=s.electrical.components.filter(c=>!['arm','stop','fuse'].includes(c.partId));for(const c of s.electrical.components)delete c.terminalAnchors;
  const issues=electricalDraftIssues(s);assert.ok(issues.some(i=>i.includes('DISTINCT')||i.includes('distinct')));assert.ok(issues.some(i=>i.includes('armPartId needs profile role arm')));assert.ok(issues.some(i=>i.includes('stopPartId needs profile role stop')));assert.ok(issues.some(i=>i.includes('pwmDuty')&&i.includes('0.5')));assert.ok(issues.some(i=>i.includes('fuse')));assert.ok(issues.some(i=>i.includes('terminalAnchor')));assert.ok(issues.length<=6);
  for(const value of [null,{}, {electrical:{}},{electrical:{components:null,connections:[]}}])assert.deepEqual(electricalDraftIssues(value),[]);
  const legacy=electricalFixture();for(const c of legacy.electrical.components)delete c.terminalAnchors;assert.doesNotThrow(()=>validateElectrical(legacy.electrical,legacy));assert.equal(resolveElectricalSummary(legacy,hash).status,'UNVERIFIED');assert.equal(electricalDraftIssues(legacy).length,1);
});
test('initial draft catches voltage and missing-isolation architecture before immutable repair',()=>{
  const s=electricalFixture();s.physicsInputs={batteryVoltage:{value:7.4},batteryMaxVoltage:{value:8.4},motorVoltage:{value:6},driverMaxVoltage:{value:10.8}};wire(s,['cutoff','OUT'],['pico','VSYS'],'power');
  const issues=electricalDraftIssues(s);assert.ok(issues.some(i=>i.includes('batteryVoltage 7.4 V exceeds motorVoltage 6 V')));assert.ok(issues.some(i=>i.includes('batteryMaxVoltage 8.4 V exceeds motorVoltage 6 V')));assert.ok(issues.some(i=>i.includes('VSYS is wired without an isolating diode component')));assert.ok(issues.length<=8);
  const unknown=electricalFixture();unknown.physicsInputs={motorVoltage:{value:6}};assert.deepEqual(electricalDraftIssues(unknown),[]);assert.equal(check(unknown,'ratings').status,'UNKNOWN');
  const mismatch=electricalFixture();mismatch.parts[0].shape.catalogId='pololu-drv8833-2130';assert.ok(electricalDraftIssues(mismatch).some(i=>i.includes('electrical/CAD identity conflict')));
  const repairable=electricalFixture();repairable.electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP26';assert.equal(check(repairable,'gpio-exclusive').status,'FAIL');assert.deepEqual(electricalDraftIssues(repairable),[],'A wiring-only FAIL can still take the bounded repair path');
});
test('firmware/physics threshold agreement and external VSYS isolation are enforced',()=>{
  const s=electricalFixture();s.physicsInputs={thresholdDbfs:{value:-32}};assert.equal(check(s,'control-binding').status,'FAIL');
  const ext=electricalFixture();wire(ext,['cutoff','OUT'],['pico','VSYS'],'power');assert.equal(check(ext,'control-binding').status,'FAIL');
  const diode=electricalFixture();diode.parts.push({id:'logic_diode',name:'Assumed logic Schottky',kind:'purchased',shape:{type:'box',size:[5,3,3]},position:[0,0,0],rotation:[0,0,0]});diode.electrical.components.push({partId:'logic_diode',profileId:'schottky-series'});wire(diode,['logic_diode','A'],['pico','VSYS'],'power');assert.equal(check(diode,'control-binding').status,'FAIL');
});

function logicPart(s,id,profileId){s.parts.push({id,name:'Synthetic '+id,kind:'purchased',shape:{type:'box',size:[5,3,3]},position:[0,0,0],rotation:[0,0,0]});s.electrical.components.push({partId:id,profileId});}
function isolatedLogic(s){logicPart(s,'logic_diode','schottky-series');wire(s,['logic_diode','K'],['pico','VSYS'],'power');return s;}

test('USB-only bench logic remains critical UNKNOWN and is not silently treated as an onboard power source',async()=>{
  const s=electricalFixture(),before=structuredClone(s),logic=check(s,'logic-power-path');assert.equal(logic.status,'UNKNOWN');assert.equal(logic.critical,true);assert.equal(logic.observed.modeledOnboardPath,false);assert.equal(logic.observed.externalVsysConnected,false);assert.equal(logic.observed.powerScope,'USB_BENCH_ONLY_OR_UNSPECIFIED');assert.equal(logic.observed.untetheredReadiness,'UNKNOWN');assert.match(logic.details,/not an untethered battery-powered design/);assert.deepEqual(s,before);
  const {summary,files}=await buildElectricalArtifacts(s,hash);assert.equal(summary.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.match(files['electrical/README.md'],/USB bench power/);assert.match(files['firmware/config.py'],/MOTOR_OUTPUT_ENABLED = False/);
});

test('external VSYS with a floating isolation diode or unpowered regulator fails and blocks firmware',async()=>{
  for(const mode of ['floating-diode','floating-regulator','reversed-regulator','ungrounded-regulator']){
    const s=isolatedLogic(electricalFixture());
    if(mode!=='floating-diode'){logicPart(s,'logic_regulator','regulator-dc');if(mode!=='ungrounded-regulator')wire(s,['logic_regulator','GND'],['pico','GND'],'ground');wire(s,['logic_regulator',mode==='reversed-regulator'?'VIN':'VOUT'],['logic_diode','A'],'power');if(['reversed-regulator','ungrounded-regulator'].includes(mode))wire(s,['cutoff','OUT'],['logic_regulator',mode==='reversed-regulator'?'VOUT':'VIN'],'power');}
    const logic=check(s,'logic-power-path');assert.equal(logic.status,'FAIL',mode);assert.equal(logic.observed.externalVsysConnected,true);assert.equal(logic.observed.modeledOnboardPath,false);assert.match(logic.details,/no modeled battery source/);
    const {summary,files}=await buildElectricalArtifacts(s,hash);assert.equal(summary.firmware.status,'BLOCKED',mode);assert.equal(files['firmware/config.py'],undefined,mode);
  }
});

test('source-backed forward isolated logic path is modeled but ratings and portable operation stay UNKNOWN',()=>{
  for(const withRegulator of [false,true]){
    const s=isolatedLogic(electricalFixture());
    if(withRegulator){logicPart(s,'logic_regulator','regulator-dc');wire(s,['cutoff','OUT'],['logic_regulator','VIN'],'power');wire(s,['logic_regulator','VOUT'],['logic_diode','A'],'power');wire(s,['logic_regulator','GND'],['pico','GND'],'ground');}
    else wire(s,['cutoff','OUT'],['logic_diode','A'],'power');
    const logic=check(s,'logic-power-path');assert.equal(logic.status,'UNKNOWN');assert.equal(logic.observed.modeledOnboardPath,true);assert.equal(logic.observed.powerScope,'MODELED_ONBOARD_PATH_UNQUALIFIED');assert.equal(logic.observed.untetheredReadiness,'UNKNOWN');assert.deepEqual(logic.observed.sourcePaths,[{sourcePartId:'battery',diodePartId:'logic_diode',sourceToAnode:true,commonReturn:true}]);assert.deepEqual(fails(s),[]);
    s.electrical.connections=s.electrical.connections.filter(c=>!(c.from.partId==='battery'&&c.from.terminal==='-'));assert.equal(check(s,'logic-power-path').status,'FAIL');
  }
});
test('full-rail speed arithmetic never verifies the exported commissioning PWM mode',async()=>{
  const s=electricalFixture();s.physicsInputs=Object.fromEntries(Object.entries({massKg:.3,rollingResistance:.03,wheelRadiusMm:30,driveMotors:2,motorVoltage:6,batteryVoltage:6,motorNoLoadRpm:270,motorStallTorqueNm:.04315,targetSpeedMS:.5,accelerationMS2:.5,gradeDeg:0,tractionCoefficient:.6,drivenWeightFraction:.65,transmissionEfficiency:.9,motorContinuousTorqueFraction:.25}).map(([key,value])=>[key,{value,basis:'ASSUMED',source:'Synthetic test conditions; no physical evidence'}]));
  assert.equal(engineeringChecks(s.physicsInputs).find(c=>c.id==='motion-operating-point').status,'PASS');
  const drive=check(s,'drive-settings');assert.equal(drive.status,'UNKNOWN');assert.equal(drive.critical,true);assert.deepEqual(drive.observed,{targetSpeedMS:.5,commissioningPwmDuty:.2,behaviorProfile:'commissioning',motorOutputEnabled:false,maximumContinuousMs:2000,physicalSpeed:'UNKNOWN'});assert.match(drive.details,/does not automatically change PWM_DUTY/);
  const {files,summary}=await buildElectricalArtifacts(s,hash);assert.equal(summary.firmware.status,'GENERATED_OUTPUT_DISABLED');assert.match(files['firmware/config.py'],/PWM_DUTY = 0.2/);assert.match(files['firmware/config.py'],/MAX_CONTINUOUS_MS = 2000/);assert.match(files['firmware/config.py'],/MOTOR_OUTPUT_ENABLED = False/);
  s.physicsInputs.targetSpeedMS.value=0;assert.equal(check(s,'drive-settings'),undefined);
});
test('generated firmware runs existing mock adapter regression suite with a remapped GPIO',async t=>{
  const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');const available=spawnSync(python,['--version'],{encoding:'utf8'});if(available.status!==0){t.skip('Python unavailable; firmware mock tests not executed');return;}
  const s=electricalFixture();s.electrical.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP10';s.electrical.components[0].terminalAnchors.find(a=>a.terminal==='GP2').terminal='GP10';
  const {files}=await buildElectricalArtifacts(s,hash);const folder=await mkdtemp(path.join(tmpdir(),'m4ke-netlist-firmware-'));
  try{for(const [name,content]of Object.entries(files))if(name.startsWith('firmware/'))await writeFile(path.join(folder,path.basename(name)),content);for(const name of ['test_controller.py','test_adapter.py'])await copyFile(new URL('../firmware/sound-car/'+name,import.meta.url),path.join(folder,name));const run=spawnSync(python,['-m','unittest','test_controller','test_adapter'],{cwd:folder,encoding:'utf8',timeout:15000});assert.equal(run.status,0,run.stderr);assert.match(run.stderr,/Ran 17 tests/);}
  finally{const resolved=path.resolve(folder),base=path.resolve(tmpdir());assert.ok(path.dirname(resolved)===base&&path.basename(resolved).startsWith('m4ke-netlist-firmware-'));await rm(resolved,{recursive:true,force:true});}
});

test('initial feedback reports known overvoltage and missing electrical together without mutating facts',()=>{
  const s={parts:[{id:'synthetic'}],physicsInputs:{driveMotors:{value:2},batteryVoltage:{value:7.4},batteryMaxVoltage:{value:8.4},motorVoltage:{value:6}}},before=structuredClone(s);
  const issues=electricalDraftIssues(s);assert.equal(issues.length,2);assert.ok(issues.some(i=>i.includes('batteryVoltage 7.4 V exceeds motorVoltage 6 V')&&i.includes('batteryMaxVoltage 8.4 V exceeds motorVoltage 6 V')));assert.ok(issues.some(i=>i.includes('Powered toys require the structured electrical block')));assert.deepEqual(s,before);
  s.electrical={components:null,connections:[]};assert.ok(electricalDraftIssues(s).some(i=>i.includes('batteryVoltage 7.4')),'Malformed netlist must not suppress independently known voltage contradictions');
  for(const value of [undefined,null,NaN,Infinity,'7.4']){const unknown={parts:[{id:'synthetic'}],physicsInputs:{driveMotors:{value:2},batteryVoltage:{value},motorVoltage:{value:6}}};const found=electricalDraftIssues(unknown);assert.deepEqual(found,[],'Missing-only wiring remains the service structural guard, without inventing a voltage conflict');assert.equal(unknown.physicsInputs.batteryVoltage.value,value);}
  assert.deepEqual(electricalDraftIssues({parts:[],physicsInputs:{driveMotors:{value:2}}}),[],'Clarification-only drafts do not require a circuit');
  assert.deepEqual(electricalDraftIssues({parts:[{id:'passive'}],physicsInputs:{}}),[],'No powered behavior is invented');
});

test('missing-only electrical defers to existing structural validation priority',()=>{
  const draft={parts:Array.from({length:25},(_,i)=>({id:'part_'+i})),physicsInputs:{driveMotors:{value:2},batteryVoltage:{value:5},motorVoltage:{value:6}}};
  assert.deepEqual(electricalDraftIssues(draft),[],'The authoritative 24-part validation must run before the existing missing-wiring guard');
});
