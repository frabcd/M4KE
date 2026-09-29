import {validateDesignSpec} from '../server/studio-contract.mjs';
export {getKitVerificationPlan} from './verification-plan.mjs';

const REQUIRED=['raspberry-pi-pico-r3','pololu-drv8833-2130','pololu-lp6v-1098','pololu-bracket-1086','pololu-wheel-1420','pololu-caster-950'];
const PARAMETERS=Object.freeze({
  lengthMm:{label:'Chassis length',unit:'mm',minimum:150,maximum:200,default:180},
  widthMm:{label:'Chassis width',unit:'mm',minimum:100,maximum:130,default:100},
  targetSpeedMS:{label:'Target speed',unit:'m/s',minimum:.05,maximum:1,default:.5},
  thresholdDbfs:{label:'Relative loudness threshold',unit:'dBFS',minimum:-60,maximum:-5,default:-25},
});
const list=catalog=>Array.isArray(catalog?.components)?catalog.components:[];
export function getKitOptions(catalog){
  const missingComponents=REQUIRED.filter(id=>!list(catalog).some(c=>c.id===id&&c.geometry?.step&&c.geometry?.sha256));
  if(!list(catalog).some(c=>c.id==='adafruit-max4466-1063'&&c.interfaces?.some(i=>i.id==='mounting-holes'&&i.dimensions?.centresMmXY)))missingComponents.push('adafruit-max4466-1063');
  return [{id:'sound-car-v1',name:'Sound-threshold car',description:'Source-backed rolling-base candidate with an explicit physics plan. Power, microphone packaging and physical commissioning remain unresolved.',availability:missingComponents.length?'unavailable':'candidate',missingComponents,parameters:structuredClone(PARAMETERS)}];
}

export function compileKit(kitId,parameters={},catalog){
  if(kitId!=='sound-car-v1')throw new Error('Unknown kit ID. Generic designs are not automatically converted to cars.');
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new Error('Kit parameters must be an object.');
  const p={};for(const key of Object.keys(parameters))if(!Object.hasOwn(PARAMETERS,key))throw new Error(`Unsupported kit parameter ${key}`);
  for(const [key,rule] of Object.entries(PARAMETERS)){
    const value=parameters[key]??rule.default;
    if(typeof value!=='number'||!Number.isFinite(value)||value<rule.minimum||value>rule.maximum)throw new Error(`${key} must be ${rule.minimum}..${rule.maximum} ${rule.unit}`);
    p[key]=value;
  }
  const missing=getKitOptions(catalog)[0].missingComponents;if(missing.length)throw new Error('Kit source geometry unavailable: '+missing.join(', '));
  return buildCar(p,catalog,parameters);
}

function buildCar(p,catalog,provided){
  const byId=new Map(list(catalog).map(c=>[c.id,c]));
  const motor=byId.get('pololu-lp6v-1098'),bracket=byId.get('pololu-bracket-1086'),wheel=byId.get('pololu-wheel-1420'),caster=byId.get('pololu-caster-950'),pico=byId.get('raspberry-pi-pico-r3');
  const iface=(component,id)=>{const i=component.interfaces?.find(i=>i.id===id);if(!i||i.reconciliation!=='source-step-to-catalog-local-reconciled'||i.sourceSha256!==component.geometry.sha256)throw new Error(`Source interface reconciliation required for ${component.id}/${id}`);return i;};
  const bracketHoles=iface(bracket,'chassis-mounting-holes'),picoHoles=iface(pico,'mounting-holes'),casterHoles=iface(caster,'mounting-holes');
  const wheelBore=iface(wheel,'hub-bore'),motorShaft=iface(motor,'native-output-shaft');
  const parts=[],chassisHoles=[];
  const round=n=>Math.round(n*1e7)/1e7;
  const addPart=(id,name,kind,material,color,shape,position,extra={})=>{const item={id,name,kind,material,color,shape,position:position.map(round),rotation:[0,0,0],...extra};parts.push(item);return item;};
  const printed=(id,name,size,position,extra={})=>addPart(id,name,'printed','PLA proposed; process and fit coupon required','#277DAD',{type:'box',size},position,extra);
  const sourcePart=(id,catalogId,rotation,origin)=>{
    const component=byId.get(catalogId),frame=component.geometry.frame,translation=component.geometry.sourceToLocal?.translationMm;
    if(!translation||frame.rotationDeg.some(x=>x!==0))throw new Error(`Unsupported source frame for kit: ${catalogId}`);
    const offset=rotate(translation,rotation);
    return addPart(id,component.name,'purchased',component.manufacturer+' source assembly',/pico|drv/.test(id)?'#176A47':/wheel/.test(id)?'#333A40':'#AAB2B8',{type:'catalog',catalogId},origin.map((v,i)=>v-offset[i]),{rotation,source:`${component.sourceUrls?.[0]||component.sourceArtifacts?.[0]?.url}; source geometry ${component.geometry.sha256}; exact physical fit UNKNOWN`});
  };
  const sourcePoint=(point,rotation,origin)=>rotate(point,rotation).map((v,i)=>v+origin[i]);
  const hole=(x,y,diameter=2.4)=>({axis:'z',diameter,position:[round(x),round(y),0]});
  const radius=wheelBore.dimensions.nominalOuterDiameterMm/2,axleX=-p.lengthMm/2+40,axisY=p.widthMm/2-12,axleZ=radius;
  const chassisTop=axleZ+bracketHoles.dimensions.sourceContactPlane.valueMm,chassisThickness=4,chassisZ=chassisTop-2;
  for(const side of [-1,1]){
    const suffix=side<0?'l':'r',rotation=[90,side*90,0],origin=[axleX,side*axisY,axleZ];
    sourcePart('bracket_'+suffix,'pololu-bracket-1086',rotation,origin);
    sourcePart('motor_'+suffix,'pololu-lp6v-1098',[90,side<0?0:180,0],origin);
    // Entry starts 0.48mm after the observed shaft boss; 8.8mm insertion is a
    // reviewed design allowance, not a measured press-fit tolerance.
    const entry=motorShaft.sourceCoordinates.centresMm[0][2]+.48;
    const wheelSourceOffset=entry-wheelBore.sourceCoordinates.centresMm[0][0];
    sourcePart('wheel_'+suffix,'pololu-wheel-1420',rotation,[axleX,side*(axisY+wheelSourceOffset),axleZ]);
    for(const point of bracketHoles.sourceCoordinates.centresMm){const w=sourcePoint(point,rotation,origin);chassisHoles.push(hole(w[0],w[1],2.5));}
  }
  const casterOrigin=[p.lengthMm/2-18,0,casterHoles.dimensions.sourceBallLowestPointMm[2]],casterRotation=[180,0,0];
  sourcePart('caster','pololu-caster-950',casterRotation,casterOrigin);
  const casterPlane=casterOrigin[2]-casterHoles.dimensions.sourceContactPlane.valueMm;
  const spacerHeight=chassisTop-chassisThickness-casterPlane;
  if(spacerHeight<2)throw new Error('Insufficient positive caster spacer height.');
  const casterMountPoints=casterHoles.sourceCoordinates.centresMm.map(v=>sourcePoint(v,casterRotation,casterOrigin));
  for(const point of casterMountPoints)chassisHoles.push(hole(point[0],point[1],2.4));
  printed('caster_spacer','Caster drop spacer',[24,17,round(spacerHeight)],[casterOrigin[0],0,casterPlane+spacerHeight/2],{holes:casterMountPoints.map(v=>hole(v[0]-casterOrigin[0],v[1],2.4)),fillet:.5,source:'Mount centres from Pololu #950 native source; spacer thickness calculated from wheel ground plane and chassis underside.'});

  const picoRotation=[90,90,0],picoCenter=[-p.lengthMm/2+34,4,chassisTop+6+1.865];
  const pPart=addPart('pico',pico.name,'purchased','Raspberry Pi source PCB assembly','#176A47',{type:'catalog',catalogId:pico.id},picoCenter,{rotation:picoRotation,source:`${pico.sourceUrls[0]}; four mounting holes reconciled with exact Pico R3 STEP`});
  for(const [i,point] of picoHoles.dimensions.centresMm.entries()){
    const at=rotate(point,picoRotation).map((v,j)=>v+pPart.position[j]);chassisHoles.push(hole(at[0],at[1],2.3));
    addPart('pico_standoff_'+i,'Pico spacer '+(i+1),'printed','PLA proposed','#277DAD',{type:'cylinder',radius:3,height:6},[at[0],at[1],chassisTop+3],{holes:[hole(0,0,2.3)],source:'6mm stand-off height is a design choice; XY centres are exact source mounting locations, Ø2.3 print holes require a coupon.'});
  }

  const driverX=axleX+30,driverY=-p.widthMm/2+21,driver=byId.get('pololu-drv8833-2130');
  sourcePart('driver',driver.id,[0,0,0],[driverX-6.35,driverY-10.16,chassisTop+3]);
  for(const sign of [-1,1]){
    const x=driverX+sign*(6.35+3.5),mountX=x+sign*2;
    chassisHoles.push(hole(mountX,driverY,2.3));
    printed('driver_rail_'+(sign<0?'l':'r'),'DRV8833 edge retainer rail',[8,26,6],[x,driverY,chassisTop+3],{holes:[hole(sign*2,0,2.3)],pockets:[{size:[5,22,2],position:[-sign*3.5,0,1]}],source:'Edge channel uses manufacturer 12.7×20.32mm PCB outline and 1.57mm board thickness. Clearance 0.43 mm is ASSUMED; component/header access and retention force require fit test. No electrical header hole is used as a screw mount.'});
  }
  // Manufacturer Eagle geometry supports only a dimensional board representation,
  // not a detailed STEP claim. No invented amplifier/connector geometry is drawn.
  const mic=byId.get('adafruit-max4466-1063'),micHoles=mic?.interfaces?.find(i=>i.id==='mounting-holes');
  if(!micHoles?.dimensions?.centresMmXY)throw new Error('MAX4466 source board-hole reference missing.');
  const micX=axleX+30,micY=p.widthMm/2-20,micZ=chassisTop+6+.8;
  addPart('microphone_board','MAX4466 module — source-derived PCB outline, component detail unavailable','purchased','Manufacturer Eagle board dimensions; not supplier STEP','#1A6551',{type:'box',size:[21.59,13.97,1.6]},[micX,micY,micZ],{holes:micHoles.dimensions.centresMmXY.map(([x,y])=>hole(y-10.795,x-6.985,2.5)),source:'Adafruit #1063 Eagle source board and manufacturer PCB thickness. This is a dimensional envelope, not exact populated-module geometry.'});
  for(const [i,[x,y]] of micHoles.dimensions.centresMmXY.entries()){
    const at=[micX+y-10.795,micY+x-6.985];chassisHoles.push(hole(...at,2.3));
    addPart('mic_standoff_'+i,'Microphone spacer '+(i+1),'printed','PLA proposed','#277DAD',{type:'cylinder',radius:2.8,height:6},[...at,chassisTop+3],{holes:[hole(0,0,2.3)],source:'XY holes from Eagle source; spacer height and clearances assumed, populated-board/tool clearance unresolved.'});
  }
  printed('chassis','Parametric chassis with source-matched mounting holes',[p.lengthMm,p.widthMm,chassisThickness],[0,0,chassisZ],{holes:chassisHoles,fillet:1,pockets:[{size:[3,26,8],position:[p.lengthMm/2-42,-12,0]},{size:[3,26,8],position:[p.lengthMm/2-42,18,0]}],source:'Motor bracket, caster and Pico holes project exact reviewed source coordinates; driver rails/microphone supports and power-bay tie slots are declared design choices.'});
  parts.sort((a,b)=>a.id==='chassis'?-1:b.id==='chassis'?1:0);
  const num=(value,basis,source)=>({value,basis,source});
  const rating=(key,scale=1)=>{const r=motor.ratings[key];if(!r||!Number.isFinite(r.value))throw new Error('Missing motor source rating '+key);return num(r.value*scale,'MANUFACTURER',`${motor.id}; ${r.sourceArtifact}; ${r.notes||''}`);};
  const assumed=(value,source)=>num(value,'ASSUMED',source);
  const physicsInputs={massKg:assumed(.35,'Unweighed preliminary complete-car mass; replace with per-component/measured total.'),rollingResistance:assumed(.03,'Smooth indoor floor screening coefficient; measure wheel/floor drag.'),wheelRadiusMm:num(radius,'MANUFACTURER','Pololu #1420 nominal 60 mm wheel drawing; loaded radius unmeasured.'),driveMotors:num(2,'USER','Two-wheel differential drive candidate chosen explicitly as sound-car-v1.'),motorVoltage:rating('voltageV'),batteryVoltage:assumed(4.8,'Candidate 4-cell NiMH nominal option only; exact pack/SKU/protection not selected.'),motorStallA:rating('theoreticalStallCurrentA'),motorNoLoadA:rating('noLoadCurrentA'),motorNoLoadRpm:rating('noLoadRpm'),motorStallTorqueNm:rating('theoreticalStallTorqueKgfCm',.0980665),driverContinuousA:num(driver.ratings.continuousCurrentPerChannelA.value,'MANUFACTURER','Pololu #2130 per-channel room-temperature rating, thermal conditions must be checked.'),driverMinVoltage:num(2.7,'MANUFACTURER','Pololu #2130 supply minimum'),driverMaxVoltage:num(10.8,'MANUFACTURER','Pololu #2130 supply maximum'),targetSpeedMS:num(p.targetSpeedMS,Object.hasOwn(provided,'targetSpeedMS')?'USER':'ASSUMED','Kit target; speed must be measured on selected floor.'),thresholdDbfs:num(p.thresholdDbfs,Object.hasOwn(provided,'thresholdDbfs')?'USER':'ASSUMED','Relative ADC RMS threshold, not calibrated SPL.'),accelerationMS2:assumed(.5,'Proposed gentle startup acceleration for screening, no closed-loop speed controller assumed.'),gradeDeg:assumed(0,'Level smooth-floor benchmark, no ramp claim.'),tractionCoefficient:assumed(.6,'Unmeasured rubber/smooth-floor friction coefficient.'),drivenWeightFraction:assumed(.65,'Unmeasured mass distribution on driven axle.'),transmissionEfficiency:assumed(.9,'Additional wheel/coupling losses only; motor rating already refers to gearbox output.'),motorContinuousTorqueFraction:assumed(.25,'Conservative screening limit fraction of theoretical stall; not a measured continuous torque rating.')};
  // Geometry defines an approximate beam span, not process-specific strength.
  // Missing material allowables deliberately produce UNKNOWN in beam-screening.
  Object.assign(physicsInputs, {
    beamSpanMm:assumed(casterOrigin[0]-axleX,'Approximate support-centre span from this CAD layout; real bracket reactions differ.'),
    beamWidthMm:assumed(p.widthMm,'Gross rectangular section only; ignores mounting holes and tie-slot section loss.'),
    beamThicknessMm:assumed(chassisThickness,'Nominal CAD thickness; printed thickness, anisotropy and process not measured.'),
    structuralLoadN:assumed(.35*9.80665,'Preliminary 350 g own-weight load only; distribution, impact and battery placement unresolved.'),
  });
  const req=[['R1',`Length ${p.lengthMm} mm within 150–200 mm; two driven 60 mm wheels and a passive caster.`],['R2',`Target forward speed ${p.targetSpeedMS} m/s on a level smooth floor with only its own load.`],['R3','Move forward while sound exceeds adjustable relative loudness threshold; remove drive when at/below it.'],['R4','Purchased motor, wheel, bracket, caster and controller geometry must be tied to cached manufacturer sources.'],['R5','Printable chassis and holders must have matching mounting locations and checked geometry, not floating envelope modules.'],['R6','Power source, wiring, disconnect/arm/fault behavior and physical quiet-stop must be commissioned before motion.']];
  const assembly=[
    {id:'inspect_prints',title:'Print and inspect only the printed mechanical pieces',partIds:parts.filter(x=>x.kind==='printed').map(x=>x.id),requires:[],instructions:['Choose the actual printer/nozzle/filament; slice only printed parts. No printer is defaulted.','Print a fit coupon first for Ø2.3/2.4/2.5 mm holes and the 2 mm driver channel; correct printer compensation, not supplier dimensions.','Inspect the chassis, six board spacers, two driver rails and caster spacer.'],checks:['All printed solids pass current-revision mesh checks; full slice preview reviewed.','Measure hole diameters, caster spacer thickness and edge-holder channel; record results, do not prefillPASS.']},
    {id:'drive',title:'Fit the source-matched motor brackets and driven wheels',partIds:['chassis','bracket_l','bracket_r','motor_l','motor_r','wheel_l','wheel_r'],requires:['inspect_prints'],instructions:['With all power absent, fit each #1098 motor in a #1086 bracket following the manufacturer guidance.','Mount bracket pairs through the 18 mm spaced chassis holes with the supplier-specified #2-56 fasteners; verify actual screw length/engagement for the 4 mm chassis.','Align each 3 mm D-shaft with its #1420 wheel; support the shaft/motor as the manufacturer directs. Never hammer a gearbox shaft.'],checks:['Both shafts align with the wheel bores and turn freely; no chassis/tire interference.','Bracket screws are secure and tool access is possible; keep wheel/shaft pressing force and fitUNKNOWN until checked.']},
    {id:'support',title:'Install caster with the calculated drop spacer',partIds:['chassis','caster','caster_spacer'],requires:['drive'],instructions:['Mount #950 caster below its spacer through source-matched 13.462 mm hole spacing.','Select actual M2/#2 bolt length after measuring the full stack; rounded drawing 13.5 mm is not substituted for native hole positions.'],checks:['Both wheels and caster contact a level surface without rocking.','Caster rotates freely, all non-wheel ground clearance is measured.']},
    {id:'boards',title:'Mount Pico and retain the motor-driver board',partIds:['chassis','pico',...parts.filter(x=>x.id.startsWith('pico_standoff')).map(x=>x.id),'driver','driver_rail_l','driver_rail_r'],requires:['support'],instructions:['Use four 6 mm spacers under the Pico R3 source mounting holes; retain using compatible M2 hardware after checking the actual bolt/washer/nut stack.','Place DRV8833 in the two printed edge channels; use the chassis fasteners on the rails, never its electrical header holes.','Test USB/header access with real cables; do not crush PCB components or force a tight channel.'],checks:['No populated-component collision with spacers, rails, screw heads or cables.','Boards remain secure during gentle unpowered handling; no copper-to-fastener short.']},
    {id:'sound_power',title:'Fit microphone and resolve the remaining power design',partIds:['chassis','microphone_board','mic_standoff_0','mic_standoff_1','pico','driver','motor_l','motor_r'],requires:['boards'],instructions:['MAX4466 board outline/hole locations are source-derived, but populated geometry is unavailable: physically inspect its underside before fitting the two spacers.','Do not energize the car: exact battery/holder, fuse, independent power disconnect, connectors and wiring gauges remain release blockers.','Use the included Pico/MAX4466/DRV8833 reference wiring only after confirming component revision and 3.3 V ADC compatibility; source geometry does not validate wiring.'],checks:['Selected power source maximum charged voltage/current, protection and secure restraint are recorded.','Microphone board/components fit without contact or pinching; quiet/loud threshold is calibrated relatively.']},
    {id:'commission',title:'Commission software, stop behavior and target motion',partIds:['pico','driver','microphone_board','motor_l','motor_r','wheel_l','wheel_r','caster'],requires:['sound_power'],instructions:['Keep firmware output disabled until wiring/stop checks pass; start with wheels raised and independent motor power cutoff reachable.','Test boot-disarmed, threshold, stale/fault/disarm and physical power cutoff.','Then test on an unobstructed level floor: record timed speed, stopping distance, running current and motor temperatures. Remove external sound to test motor-self-noise latching.'],checks:['Observed loaded speed meets target under the declared conditions, not merely no-loadRPM.','Quiet stops drive; measured coast distance/latency acceptable; motor noise alone never maintains motion.','Physical observations are recorded separately; analytical PASS is not physical PASS.']},
  ];
  return validateDesignSpec({schemaVersion:1,title:'Sound car v1 — source-backed rolling-base candidate',description:'Explicit kit selection creates a source-backed mechanical/electronics arrangement with calculated operating-point screening. It remains UNVERIFIED until exact power, fit, process and physical commissioning evidence exist; it is not a complete ready-to-energize toy.',units:'mm',requirements:req.map(([id,text])=>({id,text})),assumptions:[...Object.entries(PARAMETERS).filter(([key])=>!Object.hasOwn(provided,key)).map(([key])=>`${key}=${p[key]} is a proposed editable kit default.`),'PLA proposed; material/process are not automatically selected or strength-certified.','Chassis thickness 4 mm; Pico/microphone spacers 6 mm; hole clearances and driver retention channel require print fit coupons.','60 mm manufacturer wheels replace the old 50 mm fixture assumption; source part identity takes priority over an invented wheel.','Motor and bracket source origins are aligned from the shared 12×10 mm family interface; nominal D-flat phase is aligned upward, physical press-fit tolerance remains unmeasured.','Mass 350 g, smooth-floor Crr 0.03, grip 0.6, 65% driven weight, acceleration 0.5 m/s² and downstream efficiency 0.9 are explicit screening assumptions.'],unknowns:['Exact battery, holder, fuse, switch, connectors, wire ratings and maximum charged voltage are not selected; no energization release.','MAX4466 has only source-derived board geometry; microphone/component/connector keepouts and exact populated height are not completely modelled.','Fastener quantities and lengths must be finalized against the measured stacks; BOM currently does not include every washer/nut/cable.','Motor/bracket interfaces, D-shaft angular phase, wheel insertion force, caster clearance, source CAD revision differences and driver edge retention require physical fit review.','Printed process material strength, anisotropy, creep, impact and screw retention not tested; no structural FEA.','Actual complete mass, tire friction, load distribution, loaded motor curve, battery sag, thermal limits, sound self-noise and stopping distance not measured.'],questions:[],parts,assembly,physicsInputs});
}

export function rotate(vector,degrees){
  let [x,y,z]=vector;const [rx,ry,rz]=degrees.map(d=>d*Math.PI/180);
  [x,y]=[x*Math.cos(rz)-y*Math.sin(rz),x*Math.sin(rz)+y*Math.cos(rz)];
  [x,z]=[x*Math.cos(ry)+z*Math.sin(ry),-x*Math.sin(ry)+z*Math.cos(ry)];
  [y,z]=[y*Math.cos(rx)-z*Math.sin(rx),y*Math.sin(rx)+z*Math.cos(rx)];return [x,y,z];
}
