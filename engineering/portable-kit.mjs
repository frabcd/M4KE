import {designHash, validateDesignSpec, verifyDesign} from '../server/studio-contract.mjs';
import {compileKit,rotate} from './kit.mjs';

const SOURCES = Object.freeze({
  nkk:{url:'https://www.nkkswitches.com.cn/pdf/toggle_M.pdf',sha256:'a2a058e80ed4b7a342d7443114c5db9fe620259d1206eaf9aaf7fa611c9397f5',pages:'A57/A58/A61',basis:'VISUALLY_REVIEWED_MANUFACTURER_DRAWING'},
  arm:{url:'https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf',sha256:'be9cf69e5f43fb7689448a2097c19858e5643c0e2e49cd77d018881543e27a1f',pages:'2–4',basis:'VISUALLY_REVIEWED_MANUFACTURER_DRAWING'},
  stop:{url:'https://omronfs.omron.com/en_US/ecb/products/pdf/en-d2f.pdf',sha256:'d3f2ed08101cf7ec6f57577643225f73faa5475026dda0072bcddf2d99fb04db',pages:'2–5',basis:'VISUALLY_REVIEWED_MANUFACTURER_DRAWING'},
  holder:{url:'https://www.pololu.com/product/1159',basis:'PUBLISHED_PACKAGE_DIMENSIONS'},
  regulator:{url:'https://www.pololu.com/product/4085',basis:'PUBLISHED_PACKAGE_DIMENSIONS'},
  fuse:{url:'https://www.littelfuse.com/assetdocs/0fhm0001zxj-t-2d-print?assetguid=921afcbd-065f-46c9-bcf7-00546532d5da',basis:'APPROXIMATE_PUBLISHED_BODY_ENVELOPE_NOT_LEADS'},
});
const round=n=>Math.round(n*1e7)/1e7;
const hole=(x,y,d=2.3,axis='z',z=0)=>({axis,diameter:d,position:[x,y,z]});
const pocket=(size,position)=>({size,position});

/** Separate revision, never an implicit replacement for sound-car-v1.
 * Published package envelopes are intentionally not represented as catalog STEP.
 * Only the reviewed default180x100 base is supported; rejects silent rescaling.
 */
export function compilePortableKit(baseSpec,catalog) {
  const original=validateDesignSpec(baseSpec),baseHash=designHash(original);
  const spec=structuredClone(original),byId=new Map(spec.parts.map(p=>[p.id,p]));
  const expected={motor_l:'pololu-lp6v-1098',motor_r:'pololu-lp6v-1098',wheel_l:'pololu-wheel-1420',wheel_r:'pololu-wheel-1420',pico:'raspberry-pi-pico-r3',driver:'pololu-drv8833-2130'};
  for(const [id,source] of Object.entries(expected))if(byId.get(id)?.shape?.catalogId!==source)throw new Error(`Portable revision requires reviewed ${id}/${source}`);
  const chassis=byId.get('chassis');
  if(spec.parts.length!==20||JSON.stringify(chassis?.shape?.size)!=='[180,100,4]'||JSON.stringify(chassis.position)!=='[0,0,23]')throw new Error('Portable layout supports only the reviewed 20-part 180x100x4 source car; no silent scaling.');
  const geometry=p=>JSON.stringify([p.id,p.kind,p.shape,p.position,p.rotation,p.holes||[],p.pockets||[],p.fillet||0]);
  for(const reference of compileKit('sound-car-v1',{},catalog).parts)if(geometry(byId.get(reference.id)||{})!==geometry(reference))throw new Error(`Portable layout requires unchanged reviewed base geometry: ${reference.id}`);
  const groups=[];
  const add=(id,name,kind,shape,position,source,extra={})=>{if(byId.has(id))throw new Error(`Duplicate portable part ${id}`);const p={id,name,kind,material:kind==='printed'?'Proposed polymer; selected printed-process allowables required':'Source-derived package envelope; not print material',color:kind==='printed'?'#277DAD':'#ABB3BD',shape,position,rotation:[0,0,0],source,...extra};spec.parts.push(p);byId.set(id,p);return p;};
  const box=(id,name,size,position,extra={})=>add(id,name,'printed',{type:'box',size},position,'Portable design proposal: nominal clearances require process coupon and source-tolerance review.',extra);
  const env=(id,name,size,position,key,extra={})=>add(id,name+' [source envelope]','purchased',{type:'box',size},position,`SOURCE_DERIVED_ENVELOPE; ${SOURCES[key].url}; ${SOURCES[key].sha256||'package dimensions only'}; not manufacturer STEP or physical fit`,extra);
  const group=(id,sku,partIds,key)=>groups.push({id,sku,quantity:1,partIds,source:structuredClone(SOURCES[key]),representation:'SOURCE_DERIVED_ENVELOPE',physicalFit:'UNKNOWN'});
  const cut=(part,feature)=>(part.pockets??=[]).push(feature);
  const drill=(part,feature)=>(part.holes??=[]).push(feature);

  // Seat is8mm above the old chassis. Underside relief clears caster hardware;
  // the removable crossbars share four M2 through-fastener locations with tray.
  const clampXs=[18.5,57.5],legYs=[-35.5,35.5];
  const tray=box('power_tray','Battery support tray with underside hardware relief',[82,76,12],[38,0,31],{
    pockets:[pocket([72,66,8],[0,0,6]),pocket([72,66,6],[0,0,-3]),pocket([8,10,6],[40.731,0,-3])],
    holes:clampXs.flatMap(x=>legYs.map(y=>hole(x-38,y))),
  });
  for(const x of clampXs)for(const y of legYs)drill(chassis,hole(x,y));
  env('battery_holder','Pololu1159 holder containing four matched NiMH cells',[71,65,20],[38,0,43],'holder');
  group('battery','Pololu1159 holder +4 Panasonic BK-3MCD cells',['battery_holder'],'holder');
  const rear=box('battery_rear_clamp','Removable rear battery clamp',[22,76,20],[18.5,0,47],{
    pockets:[pocket([24,67,18],[0,0,-3])],holes:legYs.map(y=>hole(0,y)),
  });
  const gantry=box('control_gantry','Battery clamp and raised control bridge',[22,76,48],[57.5,0,61],{
    pockets:[pocket([24,67,18],[0,0,-17]),pocket([24,67,24],[0,0,8]),pocket([17,17,1.6],[0,0,23.2])],
    holes:[...legYs.map(y=>hole(0,y)),hole(0,0,6.5),hole(6.1,0,2.2)],
  });
  // Control seat bottom81/top83.4 =2.4mm <=source2.6 maximum. The lower
  // switch back-nut allowance is a3mm proposal, not a sourced nut dimension.
  env('power_switch_body','NKK MN12SS1W01 body',[13,7.9,9.4],[57.5,0,73.3],'nkk');
  add('power_switch_bushing','NKK bushing nominal thread envelope','purchased',{type:'cylinder',radius:3.175,height:8.9},[57.5,0,82.45],`SOURCE_DERIVED_ENVELOPE; ${SOURCES.nkk.url}; 1/4-40 external thread envelope; not thread geometry`,{color:'#C6CACE'});
  add('power_switch_lever','NKK lever neutral-position envelope','purchased',{type:'cylinder',radius:1.4,height:10.5},[57.5,0,92.15],`SOURCE_DERIVED_ENVELOPE; ${SOURCES.nkk.url}; neutral envelope only;25 degree total throw, precise pivot not sourced`,{color:'#D6DBE0'});
  env('power_switch_lugs','NKK three-lug reserved solder/terminal envelope',[10.2,2,4.5],[57.5,0,66.35],'nkk');
  group('disconnect','NKK MN12SS1W01',['power_switch_body','power_switch_bushing','power_switch_lever','power_switch_lugs'],'nkk');
  const guard=box('switch_terminal_guard','Removable insulated switch-terminal cup',[22,15,24],[57.5,0,69],{
    pockets:[pocket([15,10.9,26],[0,0,2.5])],
    holes:[hole(-9.2,0),hole(9.2,0),hole(-4.7,0,4,'y',-2.5),hole(0,0,4,'y',-2.5),hole(4.7,0,4,'y',-2.5)],
  });
  for(const x of [-9.2,9.2])drill(gantry,hole(x,0));

  // Actual source body only; free leads and minimum bend envelopes are separate.
  env('fuse_holder_body','Littelfuse0FHM0001ZXJ-T body with MINI fuse',[15,41,11],[18.5,0,64.5],'fuse');
  group('fuse_holder','Littelfuse0FHM0001ZXJ-T +0297002.H',['fuse_holder_body'],'fuse');
  const fuseCradle=box('fuse_cradle','Removable fuse-holder pocket',[22,48,15],[18.5,0,64.5],{
    pockets:[pocket([16,42,16],[0,0,2.5]),pocket([7,50,7],[0,0,0])],holes:[hole(-9,0),hole(9,0)],
  });
  box('fuse_lid','Serviceable fuse-pocket lid',[22,48,2],[18.5,0,73],{holes:[hole(-9,0),hole(9,0)],pockets:[pocket([8,20,4],[0,0,0])]});
  for(const x of [-9,9])drill(rear,hole(x,0));

  env('regulator_body','Pololu4085 S13V20F5 module',[12.1,8.9,5.6],[57.5,-22,62.8],'regulator');
  group('regulator','Pololu4085 / S13V20F5',['regulator_body'],'regulator');
  box('regulator_cradle','Insulated regulator pocket with lead exits',[20,18,10],[57.5,-22,62],{
    pockets:[pocket([12.6,9.4,10],[0,0,3]),pocket([22,5,4],[0,0,1])],holes:[hole(-8,0),hole(8,0)],
  });
  box('regulator_lid','Vented regulator retention lid',[20,18,2],[57.5,-22,68],{holes:[hole(-8,0),hole(8,0)],pockets:[pocket([6,6,4],[0,0,0])]});
  for(const x of [-8,8])drill(gantry,hole(x,-22));

  // B3F case and four independent lead envelopes permit an explicit support
  // floor without treating an empty rectangular gap between leads as solid.
  const armZ=87;
  env('arm_case','Omron B3F1002G case maximum XY',[6.2,6.2,3.4],[57.5,-22,armZ+1.7],'arm');
  add('arm_plunger','B3F plunger source-tolerance envelope','purchased',{type:'cylinder',radius:1.75,height:1},[57.5,-22,armZ+3.9],`SOURCE_DERIVED_ENVELOPE; ${SOURCES.arm.url}; nominal exposed0.9mm represented by1mm bounded kernel minimum; actual4.3+/-0.2 overall height`);
  const armLegIds=[];let li=0;
  for(const x of [-3.25,3.25])for(const y of [-2.25,2.25]){
    const id='arm_lead_'+li++;armLegIds.push(id);env(id,'B3F soldered lead clearance',[1.2,1,3.5],[57.5+x,-22+y,armZ-1.75],'arm');
  }
  group('arm','Omron B3F-1002-G',['arm_case','arm_plunger',...armLegIds],'arm');
  const armMount=box('arm_cradle','ARM switch captive-body holder',[16,14,5.4],[57.5,-22,87.7],{
    pockets:[pocket([6.6,6.6,6],[0,0,2.3])],holes:[hole(-6,0),hole(6,0)],
  });
  const armLid=box('arm_lid','ARM switch retaining plate',[16,14,1],[57.5,-22,90.9],{holes:[hole(0,0,4.5),hole(-6,0),hole(6,0)]});
  for(const x of [-3.25,3.25])for(const y of [-2.25,2.25]){
    drill(armMount,hole(x,y,1.8));drill(gantry,hole(x,-22+y,1.8));
  }
  for(const x of [-6,6])drill(gantry,hole(x,-22));

  const stopBottom=91;
  env('stop_body','Omron D2F01LD3 body',[12.8,5.8,6.5],[57.5,21.9,stopBottom+3.25],'stop',{
    holes:[hole(-3.25,0,2,'y',-1.75),hole(3.25,0,2,'y',-1.75)],
  });
  env('stop_lugs','D2F D3 terminal reserved envelope',[12.36,1,3.5],[57.5,21.9,stopBottom-1.75],'stop');
  env('stop_lever_motion','D2F hinge-lever free-travel keepout, not solid blade',[13.6,3,5],[57.5,21.9,100],'stop');
  group('stop','Omron D2F-01L-D3',['stop_body','stop_lugs','stop_lever_motion'],'stop');
  box('stop_bracket','STOP side-bolted bracket and terminal floor',[18,12,14],[57.5,22,92],{
    pockets:[pocket([20,10,14],[0,2,2])],
    holes:[hole(-3.25,0,2.3,'y',.5),hole(3.25,0,2.3,'y',.5),hole(-7,0),hole(7,0)],
  });
  for(const x of [-7,7])drill(gantry,hole(x,22));

  box('wire_channel','Protected high-side harness channel',[70,8,10],[35,44,30],{
    pockets:[pocket([72,4,10],[0,0,2])],holes:[hole(-29,0),hole(29,0)],
  });
  for(const x of [6,64])drill(chassis,hole(x,44));

  spec.title='Sound car portable regulated-5V candidate — separate revision';
  spec.description='Source-car rolling base plus removable battery retention, protected power/control pockets, exact source-derived switch envelopes and a separate regulated5V power architecture. Native geometry and analytical screening do not prove physical function.';
  chassis.source += ' Portable revision adds six explicit tray/channel mount holes; original manufacturer interface coordinates preserved.';
  spec.assumptions=spec.assumptions.filter(s=>!s.includes('Mass 350 g')).concat([
    'Portable candidate is only reviewed at180x100mm. No automatic resizing or source-part scaling.',
    'Regulated5V rail replaces the base4.8V nominal assumption only in this new revision. Do not use previous job checks as evidence for it.',
    'Tray and pocket clearances are nominal engineering allowances. Switch sources lack complete package tolerances; validate coupons and real components.',
    'S1 switch seat2.4mm with manufacturer standard hardware.3mm backside nut allowance is a proposal, not an exact hardware source dimension.',
  ]);
  spec.unknowns=spec.unknowns.filter(s=>!s.startsWith('Exact battery, holder')&&!s.startsWith('Fastener quantities')).concat([
    'Power source/protection/control identities and nominal layout are selected as candidates, not certified: pack limits, fuse/harness coordination, regulator transients and continuous motor operation require measurements.',
    'M2 clamp, enclosure and switch hardware final torque/engagement/tool access need fit review; source geometry cannot validate printed tolerances.',
    'Soldered harness has protected reserved corridors but exact insulation, connectors, bend radius, source-switch nut dimensions and strain-relief pull test remain unresolved.',
    'Case/terminal/lever geometry for new controls is source-derived envelope, not manufacturer STEP; motion envelopes are not an exact moving-contact mechanism.',
  ]);
  spec.requirements.push({id:'R7',text:'Portable regulated5V power revision must retain the four-cell holder, provide accessible independent cutoff, ARM/NC STOP controls and protected wiring without overriding physical UNKNOWN.'});
  const oldSound=spec.assembly.find(s=>s.id==='sound_power');
  oldSound.instructions=oldSound.instructions.map(s=>s.startsWith('Do not energize')?'Review the portable revision power BOM and netlist; no energization release follows from CAD. Exact power/control candidates now have dedicated support/retention steps.':s);
  const oldCommission=spec.assembly.find(s=>s.id==='commission');oldCommission.requires=['portable_controls'];
  const step=(id,title,partIds,requires,instructions,checks)=>spec.assembly.push({id,title,partIds,requires,instructions,checks});
  step('portable_tray','Install removable battery tray and power channel',['chassis','power_tray','battery_holder','battery_rear_clamp','control_gantry','wire_channel'],['sound_power'],[
    'Use only the new revision chassis holes. Fit four M2 through-fasteners at X18.5/57.5,Y+/-35.5; check new clamp grip lengths before choosing bolts.',
    'Place four matched NiMH cells inside the source1159 holder, seat the unpowered holder atZ33, and install removable crossbars. Never compress the cells or block their cover/switch.',
    'Keep caster hardware below underside relief and insulated from the holder; do not replace the old4.8V calculation with a5V claim without this revision.'
  ],['Measure seat, source holder tolerance and clamp capture; no rattle or cell damage.','Keep independent cutoff accessible; remove cells before reworking supports.']);
  step('portable_power','Install protected regulator and fuse pockets',['regulator_body','regulator_cradle','regulator_lid','fuse_holder_body','fuse_cradle','fuse_lid','wire_channel'],['portable_tray'],[
    'Fit source4085 regulator and MINI fuse holder into isolated pockets; supplier STEP is unavailable, so inspect actual populated board and body before tightening lids.',
    'Follow the exact fuse/disconnect/regulator/Schottky netlist. Route rated insulated leads through exits and channel; no motor current through signal ground rails.',
    'The fuse lid is removable for service; verify fuse/wire coordination and temperature before powered operation.'
  ],['Check body and cable-bend clearance, no terminal shorts or pinching.','Verify no reverse polarity or USB backfeed with outputs locked before commissioning.']);
  step('portable_controls','Install and inspect power cutoff, ARM and NC STOP',[
    'control_gantry','power_switch_body','power_switch_bushing','power_switch_lever','power_switch_lugs','switch_terminal_guard',
    'arm_case','arm_plunger',...armLegIds,'arm_cradle','arm_lid','stop_body','stop_lugs','stop_lever_motion','stop_bracket'],['portable_power'],[
    'NKK S1 uses a2.4mm recessed seat, Ø6.5 main hole and Ø2.2 antirotation hole6.1mm apart, standard lock ring/washers/nuts. Do not mount through unrecessed4mm material.',
    'Preserve the B3F opposite electrical-row wiring. Confirm each lead with a meter; do not assume top/bottom-view numbering.',
    'Attach D2F by its6.5mm-spaced side holes; use COM–NC. Its lever box is a reserved motion envelope, not a printable lever.',
    'Keep outputs disabled. Commissioning and continuous_while_loud firmware profiles are distinct; quiet removes drive and coasts, never guaranteed instantaneous braking.'
  ],['Verify operator access, full lever motion, printed side-hole alignment, solder insulation and accessible cutoff.','All physical functionality remains UNKNOWN until the separate recorded tests.']);
  spec.assembly=spec.assembly.filter(s=>s.id!=='commission');spec.assembly.push(oldCommission);
  const massBudget=buildMassBudget(spec,catalog);
  const axleX=byId.get('motor_l').position[0],casterX=byId.get('caster_spacer').position[0];
  const cgBounds=[weightedExtreme(massBudget.items,false),weightedExtreme(massBudget.items,true)];
  const drivenFractionBounds=[(casterX-cgBounds[1])/(casterX-axleX),(casterX-cgBounds[0])/(casterX-axleX)];
  const assumed=(value,source)=>({value:round(value),basis:'ASSUMED',source});
  spec.physicsInputs.massKg=assumed(massBudget.totalMassG[1]/1000,'Portable mass budget upper scenario; not weighed. Includes cell/source masses, assumed hardware/harness ranges and printed fill/density assumptions.');
  spec.physicsInputs.drivenWeightFraction=assumed(Math.max(.01,Math.min(1,drivenFractionBounds[0])),'Static two-support reaction from worst forward CG in declared independent mass/position intervals; not measured, no dynamic load transfer.');
  spec.physicsInputs.batteryVoltage=assumed(5,'Regulated motor-rail nominal5V from Pololu4085 candidate, not raw battery voltage; transients/drop/PWM unmeasured.');
  spec.physicsInputs.logicCurrentA=assumed(.25,'Portable regulated5V domain allowance; measured logic and regulator transient current unknown.');
  spec.physicsInputs.structuralLoadN=assumed(spec.physicsInputs.massKg.value*9.80665,'Own-weight screening uses new upper mass scenario; holes, print process and local support stresses remain unresolved.');
  delete spec.physicsInputs.batteryCapacityAh;delete spec.physicsInputs.batteryUsableFraction;delete spec.physicsInputs.batteryMaxVoltage;delete spec.physicsInputs.batteryMaxA;
  const clean=validateDesignSpec(spec);
  const motion=s=>verifyDesign(s).claims.find(c=>c.id==='motion-operating-point');
  const slowMotor=structuredClone(clean);slowMotor.physicsInputs.motorNoLoadRpm={value:clean.physicsInputs.motorNoLoadRpm.value*.8,basis:'ASSUMED',source:'Engineering sensitivity scenario, not a claimed manufacturer tolerance: no-load speed20% below nominal.'};
  const revision={id:'sound-car-portable-reg5-candidate-v1',baseDesignHash:baseHash,designHash:designHash(clean),status:'CAD_CANDIDATE_NOT_PHYSICAL_RELEASE',
    componentGroups:groups,sourceDimensions:structuredClone(SOURCES),massBudget,
    powerDomain:{motorRailNominalV:5,rawSeriesPackNominalV:4.8,rawPackCapacityAh:2,runtimeEstimate:null,reason:'Do not divide raw battery Ah by5V rail current. Regulator efficiency, minimum loaded pack voltage, usable capacity, inrush and actual duty are not measured.'},
    operatingPointSensitivity:{nominal:{status:motion(clean).status,observed:motion(clean).observed},slowerMotor:{status:motion(slowMotor).status,observed:motion(slowMotor).observed,basis:'ASSUMED20_PERCENT_LOWER_NO_LOAD_RPM'},physicalStatus:'UNKNOWN',limits:'No inferred robust0.5m/s claim. Firmware commissioning PWM remains20%; this screen uses full nominal motor rail, not default firmware duty.'},
    axleLoadScreen:{basis:'CONDITIONAL_STATIC_INTERVAL_MODEL',axleXmm:axleX,casterXmm:casterX,cgXmm:cgBounds,drivenWeightFraction:drivenFractionBounds,limits:'Independent declared mass and center-position intervals only. No verified all-condition bound, lateral stability, braking, floor unevenness or dynamic transfer.'},
    interfaces:{battery:{seatZmm:33,nominalHolderMm:[71,65,20],trayPocketMm:[72,66],clampInsideMm:67,casterTipAssumedZmm:28.245025,underTrayReliefTopZmm:31},
      nkk:{seatThicknessMm:2.4,sourceMaximumPanelMm:2.6,mainHoleMm:6.5,lockingHoleMm:2.2,lockingHoleSpacingMm:6.1,bodyFrontZmm:78,terminalLowZmm:64.1,backNutReservedMm:3,sourceTolerance:null},
      arm:{leadPatternMm:[6.5,4.5],printedLeadHoleMm:1.8,casePocketMm:[6.6,6.6],sourceMaximumBodyXYmm:[6.2,6.2]},
      stop:{mountSpacingMm:6.5,printedHoleMm:2.3,sourceHoles:'left2.2x2 oblong, rightØ2.0; conservative2mm body holes drawn',leverMaxFromBaseMm:11.5}},
    proposedFasteners:[{locations:2,role:'rear clamp/tray/chassis',gripMm:36,thread:'M2',lengthSelection:'Measure whole stack; rear approximately40mm screw including nut/washers. Not a supplier SKU or release.'},{locations:2,role:'front tall gantry/tray/chassis',gripMm:64,thread:'M2',lengthSelection:'Long through-fasteners approximately70mm; sourcing and buckling/handling qualification pending.'}],
    wiringKeepouts:[{id:'side_harness',boundsMm:[[0,70],[42,46],[27,35]],basis:'DESIGN_RESERVED_CORRIDOR',maximumBundleDiameterAssumedMm:4},{id:'switch_solder_space',boundsMm:[[50,65],[-5.45,5.45],[58.5,68.6]],basis:'DESIGN_RESERVED_SPACE',individualExitDiameterMm:4}],
    physicalStatus:'UNKNOWN',nativeStatus:'NOT_RUN',limits:['Base20part source identities preserved; no manufacturer CAD scaling.','Purchased envelope subparts must be grouped by componentGroups, never counted as separate physical purchases.','No exact populatedMAX4466 geometry invented.','Source dimensions and planning allowances are not physical fit, wire qualification or child-safety evidence.']};
  return {spec:clean,revision};
}

function primitiveVolumeUpper(part){
  if(part.shape.type==='cylinder')return Math.PI*part.shape.radius**2*part.shape.height;
  const size=part.shape.size;if(!size)return 0;
  const boxes=(part.pockets||[]).map(p=>p.size.map((v,i)=>[Math.max(-size[i]/2,p.position[i]-v/2),Math.min(size[i]/2,p.position[i]+v/2)]));
  const axes=size.map((v,i)=>[...new Set([-v/2,v/2,...boxes.flatMap(b=>b[i]).filter(x=>x>=-v/2&&x<=v/2)])].sort((a,b)=>a-b));
  let volume=0;
  for(let i=1;i<axes[0].length;i++)for(let j=1;j<axes[1].length;j++)for(let k=1;k<axes[2].length;k++){
    const indices=[i,j,k],center=indices.map((n,a)=>(axes[a][n]+axes[a][n-1])/2);
    if(!boxes.some(b=>b.every((range,a)=>center[a]>range[0]&&center[a]<range[1])))volume+=indices.reduce((v,n,a)=>v*(axes[a][n]-axes[a][n-1]),1);
  }return volume;
}
function buildMassBudget(spec,catalog){
  const items=[
    {id:'cells',massG:[106.4,117.6],xMm:[35,41],basis:'Panasonic28g/cell typical; +/-5% planning allowance ASSUMED',source:'https://panasonic.jp/battery/products/BK-3MCD_4H/spec.html'},
    {id:'motors_pair',massG:[18,22],xMm:[-53,-47],basis:'Pololu9.5g each nominal; range ASSUMED',source:'https://www.pololu.com/product/1098/specs'},
    {id:'wheels_pair',massG:[20,26],xMm:[-52,-48],basis:'Pololu0.4oz per wheel=11.34g nominal; range ASSUMED',source:'https://www.pololu.com/product/1420/specs'},
    {id:'holder_empty',massG:[20,50],xMm:[33,43],basis:'ASSUMED until sourced or weighed'},
    {id:'pico_driver_mic',massG:[6,20],xMm:[-65,-15],basis:'ASSUMED combined electronics mass and center'},
    {id:'brackets_pair',massG:[1,6],xMm:[-55,-45],basis:'ASSUMED'},
    {id:'caster',massG:[1,8],xMm:[70,74],basis:'ASSUMED'},
    {id:'power_controls_fasteners_harness',massG:[35,95],xMm:[5,60],basis:'ASSUMED; switch/fuse-holder wiring and long fasteners not yet weighed'},
  ];
  for(const p of spec.parts.filter(p=>p.kind==='printed')){
    const volume=primitiveVolumeUpper(p),bounds=partBounds(p,catalog);
    items.push({id:p.id,massG:[volume/1000*1.15*.5,volume/1000*1.3],xMm:bounds[0],basis:'ASSUMED polymer density1.15..1.30g/cm3 and material occupancy50..100%; box pocket union subtracted, holes/fillets not subtracted. Not a slicer weight or certified bound.'});
  }
  return {status:'DECLARED_SCENARIOS_NOT_MEASURED_BOUNDS',items,totalMassG:[0,1].map(i=>items.reduce((s,p)=>s+p.massG[i],0)),limits:'Ranges are explicit engineering budgets, not guaranteed manufacturer tolerances. Replace with exact weighed/slicer/material values before release; no STEP-volume mass for purchased components.'};
}
function weightedExtreme(items,maximize){
  let lo=Math.min(...items.map(x=>x.xMm[0])),hi=Math.max(...items.map(x=>x.xMm[1]));
  for(let i=0;i<80;i++){const r=(lo+hi)/2;let balance=0;for(const item of items){const x=item.xMm[maximize?1:0],d=x-r;const m=item.massG[maximize?(d>=0?1:0):(d>=0?0:1)];balance+=m*d;}if(balance>0)lo=r;else hi=r;}return (lo+hi)/2;
}
export function partBounds(part,catalog){
  const dims=part.shape.type==='catalog'?catalog.components.find(c=>c.id===part.shape.catalogId)?.geometry?.boundsMm:part.shape.type==='box'?part.shape.size:[part.shape.radius*2,part.shape.radius*2,part.shape.height];
  if(!dims)throw new Error(`Missing bounds ${part.id}`);const corners=[];
  for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])corners.push(rotate([x*dims[0],y*dims[1],z*dims[2]],part.rotation).map((v,i)=>v+part.position[i]));
  return [0,1,2].map(i=>[Math.min(...corners.map(c=>c[i])),Math.max(...corners.map(c=>c[i]))]);
}
