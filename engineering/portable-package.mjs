import {isDeepStrictEqual} from 'node:util';
import {designHash,validateDesignSpec} from '../server/studio-contract.mjs';
import {compileKit} from './kit.mjs';
import {compilePortableKit} from './portable-kit.mjs';
import {PORTABLE_KIT_ID} from './kit-registry.mjs';
import {buildKitHardwareReference,validatePowerCandidate} from './hardware-reference.mjs';
import {getKitVerificationPlan} from './verification-plan.mjs';

const copy=value=>structuredClone(value);
const fail=message=>{throw new Error('Portable package binding: '+message);};
const round=value=>Math.round(value*1e9)/1e9;

function bind(input,catalog,revision){
  const spec=validateDesignSpec(input),hash=designHash(spec);
  if(revision?.id!==PORTABLE_KIT_ID||revision.designHash!==hash)fail('revision identity or design hash mismatch');
  // Only explicit compiler-supported target choices may differ from the frozen default.
  // A manual geometry/source edit needs its own newly reviewed revision and metadata.
  const parameters={};for(const key of ['targetSpeedMS','thresholdDbfs'])if(spec.physicsInputs?.[key]?.basis==='USER')parameters[key]=spec.physicsInputs[key].value;
  // The chooser explicitly submits the fixed dimensions. That does not resize
  // geometry, but removes their default-assumption labels and changes lineage.
  // Reconstruct only these two compiler-permitted metadata states, then retain
  // the full spec/revision equality check (never normalize away source changes).
  for(const [key,value]of [['lengthMm',180],['widthMm',100]])if(!spec.assumptions.includes(`${key}=${value} is a proposed editable kit default.`))parameters[key]=value;
  const base=compileKit('sound-car-v1',parameters,catalog),expected=compilePortableKit(base,catalog);
  if(designHash(expected.spec)!==hash||!isDeepStrictEqual(expected.spec,spec))fail('specification differs from the reviewed portable compiler/source core');
  if(!isDeepStrictEqual(expected.revision,revision))fail('component groups, source receipts or scenario metadata differ from this exact revision');
  if(spec.parts.length!==48||spec.parts.filter(part=>part.kind==='printed').length!==22)fail('unexpected portable inventory');
  return {spec,hash,base,revision:copy(revision)};
}

/** Pure package preparation. No filesystem, supplier request, purchase or printer action. */
export function buildPortableHardwareReference(input,catalog,inputRevision){
  const {spec,hash,base,revision}=bind(input,catalog,inputRevision);
  const original=buildKitHardwareReference('sound-car-v1',base,catalog);
  const sourcePower=copy(original.portablePowerCandidate);
  const groupById=new Map(revision.componentGroups.map(group=>[group.id,group]));
  const groupsFor={holder:'battery',cells:'battery',regulator:'regulator',disconnect:'disconnect',fuse:'fuse_holder',fuse_holder:'fuse_holder',arm:'arm',stop:'stop'};
  const contained=new Set(['cells','fuse']);
  const powerComponents=sourcePower.components.map(component=>{
    const geometryGroup=groupById.get(groupsFor[component.id]),isContained=contained.has(component.id);
    const limits=[component.limits];
    if(component.id==='holder')limits[0]='Source-derived holder/body envelope with a proposed removable tray and clamps is now present. Internal switch rating, cell contacts, source tolerances, restraint and physical fit remain UNKNOWN.';
    if(component.id==='fuse_holder')limits[0]='Approximate holder body is represented with a cradle/lid; leads and bend radii are not source solids. Holder rating does not uprate the battery-holder leads. Wire transitions, restraint and fuse coordination remain UNKNOWN.';
    if(component.id==='cells')limits.push('Four cells are procurement units within the reserved holder envelope; no individual cell solids or contact model are supplied.');
    if(component.id==='fuse')limits.push('The fuse is a separate procurement unit; its installed shape is not a separately verified solid. The holder body envelope does not prove insertion or service clearance.');
    return {...component,id:'power-'+component.id,candidateId:component.id,designHash:hash,
      quantityUnit:'individual installed component',purchasePackageQuantity:null,
      purchaseNote:component.id==='cells'?'Quantity 4 means four installed cells; BK-3MCD/4H is a four-cell package, not four packages. Confirm current listing contents.':/pullup$/.test(component.id)?'Quantity 1 means one installed resistor, not one entire supplier pack; referenced listing contains 25. Confirm current pack contents.':'Installed quantity is not supplier package count; verify current listing contents.',
      geometryGroupId:geometryGroup?.id||null,
      modelPartIds:geometryGroup&&!isContained?[...geometryGroup.partIds]:[],
      containingEnvelopePartIds:geometryGroup&&isContained?[...geometryGroup.partIds]:[],
      geometryRepresented:!!geometryGroup&&!isContained,
      geometryRepresentation:geometryGroup?(isContained?'CONTAINED_ITEM_NOT_SEPARATELY_MODELLED':'SOURCE_DERIVED_ENVELOPE_GROUP'):'NOT_MODELLED',
      keepoutPartIds:component.id==='stop'?['stop_lever_motion']:[],
      limits:limits.join(' '),physicalFit:'UNKNOWN',physicalStatus:'UNKNOWN',price:null,currency:'CNY',stock:null,
      geometrySources:geometryGroup?[copy(geometryGroup.source)]:[],
    };
  });
  const components=[...original.components.map(component=>({...copy(component),id:component.catalogId,designHash:hash,geometryRepresented:true,geometryGroupId:component.catalogId,containingEnvelopePartIds:[],keepoutPartIds:[],currency:'CNY',price:null,stock:null})),...powerComponents];
  const p=spec.physicsInputs,rail=p.batteryVoltage.value,logic=p.logicCurrentA.value,efficiency=sourcePower.electricalScreen.assumedEfficiency;
  const motors=p.driveMotors.value*p.motorStallA.value*rail/p.motorVoltage.value,output=motors+logic,rawPack=revision.powerDomain.rawSeriesPackNominalV;
  const power={
    id:'sound-car-portable-reg5-power-package-v1',designHash:hash,status:'CANDIDATE_PARTIALLY_REPRESENTED_IN_THIS_REVISION_NOT_RELEASED',
    sourceReviewDate:sourcePower.reviewedDate,components:copy(powerComponents),nets:copy(sourcePower.nets),
    referencePinout:sourcePower.referencePinout,fuseInstallation:sourcePower.fuseInstallation,unconnected:copy(sourcePower.unconnected),wiringMethod:sourcePower.wiringMethod,
    batteryDerivation:copy(sourcePower.batteryDerivation),powerDomain:copy(revision.powerDomain),
    electricalScreen:{status:'CONDITIONAL_ARITHMETIC_NOT_POWER_TEST',nominalMotorRailV:rail,regulatedOutputRangeV:sourcePower.electricalScreen.regulatedOutputRangeV,
      twoMotorTheoreticalStallA:round(motors),assumedLogicAllowanceA:logic,nominalOutputBudgetA:round(output),nominalOutputBudgetW:round(rail*output),
      assumedEfficiency:efficiency,rawPackNominalVoltageV:rawPack,nominalPackInputBudgetA:round(rail*output/(rawPack*efficiency)),
      inputs:{driveMotors:copy(p.driveMotors),motorStallA:copy(p.motorStallA),motorVoltage:copy(p.motorVoltage),motorRail:copy(p.batteryVoltage),logicAllowance:copy(p.logicCurrentA),efficiency:{value:efficiency,basis:'ASSUMED',source:'Inherited explicit screening scenario, not measured regulator efficiency.'}},
      limits:'Uses this revision: nominal regulated 5 V and ASSUMED 250 mA logic allowance, not the legacy 150 mA screen. Linear scaling of theoretical stall is not continuous operation or measured startup. Does not prove source sag, thermal margin, transient response, fuse/wire coordination or default commissioning-PWM speed. Never deliberately stall motors. No runtime estimate.'},
    currentDesignMotorVoltageV:rail,requiresDesignRevision:false,
    scope:'This IS the separate regulated-5V candidate revision. Its source-derived power/control envelopes are partial geometry, not populated supplier CAD or physical approval.',
    supersedesLegacyAssumptions:['The original rolling-base 4.8 V motor-rail assumption.','The earlier power proposal 0.15 A logic allowance and unplaced layout coordinates.'],
    requiredPhysicalTests:copy(sourcePower.requiredPhysicalTests),physicalResults:'UNKNOWN',runtimeMinutes:null,
  };
  power.topologyChecks=validatePowerCandidate(power);
  const fasteners={
    designHash:hash,status:'PROPOSED_STACKS_AND_LOCATIONS_NOT_RELEASED',existingMountCandidates:copy(original.fastenerCandidate),
    portableThroughStacks:copy(revision.proposedFasteners).map(item=>({...item,grade:null,torqueNm:null,physicalFit:'UNKNOWN'})),
    additionalMountLocations:[
      ['wire-channel',['wire_channel','chassis'],2],['switch-terminal-cup',['switch_terminal_guard','control_gantry'],2],
      ['fuse-cradle-and-lid',['fuse_lid','fuse_cradle','battery_rear_clamp'],2],['regulator-cradle-and-lid',['regulator_lid','regulator_cradle','control_gantry'],2],
      ['arm-holder-and-lid',['arm_lid','arm_cradle','control_gantry'],2],['stop-bracket-base',['stop_bracket','control_gantry'],2],['stop-switch-side',['stop_body','stop_bracket'],2],
    ].map(([id,partIds,locations])=>({id,partIds,locations,threadProposal:'M2 candidate; reconcile actual source hole and hardware tolerances',sku:null,lengthMm:null,grade:null,torqueNm:null,physicalFit:'UNKNOWN',basis:'Designed mounting locations, not a complete screw/nut/washer order. Check shared stacks, nut capture, tool approach, bending and engagement.'})),
    nkkMountHardware:{partId:'power_switch_bushing',threadSource:'1/4-40 external bushing envelope',hardware:'Manufacturer standard locking ring, washers and nuts; reconcile the exact supplied set.',quantity:null,grade:null,torqueNm:null,backNutReservedMm:revision.interfaces.nkk.backNutReservedMm,backNutDimensionSource:null,physicalFit:'UNKNOWN',note:'The 3 mm rear-nut space is a design allowance, not a verified nut dimension. Do not invent a hardware stack or substitute metric thread.'},
    limitations:['Existing source-supported 14-location fastener proposal remains scoped to the original mounts only. It is not the full portable hardware count.',
      'The new four tray/clamp through stacks and seven pairs of accessory mounting locations are proposals, not physically checked joints or confirmed purchase quantities.',
      'Long M2 sourcing, buckling/handling, printed compression, edge distances, washer/copper clearance, tool access and thread engagement remain UNKNOWN. No tightening torque or new material grade is invented.',
      'No new screw/nut/washer solids, harness retention hardware or tool sweep are represented. Source envelope clearances do not certify fit.'],
  };
  const additionalRequiredItems=[
    {id:'unmodelled-electrical-parts',name:'External Schottky diode and ARM/STOP pull-up resistors',componentIds:['power-isolation_diode','power-arm_pullup','power-stop_pullup'],geometryRepresented:false,reason:'Candidate components are listed once above; their solder joints, insulation, placement and retention are not modelled.'},
    {id:'fasteners-and-nkk-hardware',name:'Complete reconciled fastener, nut, washer and switch hardware schedule',geometryRepresented:false,reason:'Existing stacks plus new through-stacks/accessory mounts require exact lengths, grades where sourced, engagement, tool access and supplied NKK hardware reconciliation; not a complete order.'},
    {id:'harness-and-transitions',name:'Exact rated wire, connectors, insulated 14-to-24-AWG transitions and strain relief',geometryRepresented:false,reason:'Protected channel and exit holes reserve space only. No exact harness lengths, bend radii, insulation, connector/contact ratings or pull-test evidence.'},
    {id:'populated-microphone-clearance',name:'Actual MAX4466 populated board/component and cable envelope',geometryRepresented:true,geometryRepresentation:'PCB_OUTLINE_ONLY',reason:'The original microphone remains a source-derived PCB outline, not complete amplifier/capacitor/header geometry.'},
    {id:'protection-and-access',name:'Actual cell-contact, fuse, cutoff, hot-surface and moving-part protection',geometryRepresented:true,geometryRepresentation:'PARTIAL_SUPPORT_AND_GUARD_CAD',reason:'Battery tray/clamps, pockets and terminal cup now exist as candidate CAD. Impact, finger/cable access, full lever travel, cell-cover service and protective adequacy are unverified.'},
  ].map(item=>({...item,proposedQuantity:null,quantityBasis:'Unresolved qualification work or additional hardware; do not duplicate listed purchase candidates',status:'UNKNOWN',blocksPhysicalRelease:true}));
  const releaseBlockers=[...additionalRequiredItems.map(item=>({id:item.id,status:'UNKNOWN',reason:item.reason})),
    {id:'source-envelopes-and-process',status:'UNKNOWN',reason:'Verify actual variants, component tolerances, printed coupons, lead/component clearances, source switch travel and standard hardware. Mesh validity is not fit or material-strength evidence.'},
    {id:'battery-power-transients',status:'UNKNOWN',reason:'Measure charged/loaded pack limits, regulator startup/cooling/transients, logic demand, USB backfeed, fault behavior and independent motor cutoff. Fuse coordination and undervoltage cell protection remain unresolved.'},
    {id:'retention-and-loads',status:'UNKNOWN',reason:'Declared mass/CG/axle scenarios are not weighed or guaranteed bounds. Test retention, printed support load paths and real fastener stacks; no child-safety certification.'},
    {id:'physical-motion-and-sound',status:'UNKNOWN',reason:`Measure loaded speed, current/temperature, traction, self-noise, quiet drive-disable/coast distance and fault/STOP behavior. The -20% motor-speed sensitivity scenario is ${revision.operatingPointSensitivity.slowerMotor.status} for this revision's target; this scenario is not a robust or physical performance guarantee.`},
    {id:'firmware-operating-point',status:'UNKNOWN',reason:'Firmware remains output-disabled. Commissioning defaults to bounded low PWM; continuous_while_loud is a separate deliberate profile. Full-rail arithmetic does not prove either operating point.'},
  ];
  return {schemaVersion:1,referenceId:'sound-car-portable-reg5-job-hardware-reference',kitId:PORTABLE_KIT_ID,designHash:hash,baseDesignHash:revision.baseDesignHash,catalogRevision:catalog.catalogRevision??null,
    status:'SOURCE_BOUND_PORTABLE_CANDIDATE_NOT_A_COMPLETE_BOM_NOT_RELEASED_FOR_POWER',
    scope:'This exact 48-part revision only. Geometry subparts and motion keepouts are not separate physical purchases. Original supplier component identities plus explicit power/control procurement candidates; unknowns remain open.',
    sourceBoundary:'Source facts and hashes are inherited evidence references, not new source verification, live quotes or physical measurements.',
    components,printedParts:spec.parts.filter(part=>part.kind==='printed').map(part=>({partId:part.id,name:part.name,quantity:1,material:part.material,processValidated:false})),
    componentGroups:copy(revision.componentGroups),operatingInputs:copy(spec.physicsInputs),portablePowerCandidate:power,fastenerCandidate:fasteners,
    massBudget:copy(revision.massBudget),axleLoadScreen:copy(revision.axleLoadScreen),operatingPointSensitivity:copy(revision.operatingPointSensitivity),
    additionalRequiredItems,releaseBlockers,verificationPlan:portablePlan(spec,hash),
    sourceRevisionMetadataStatus:'Compiler metadata only; native CAD checks belong to the current job report, not this wrapper.',
    legacyReference:{path:'components/car-reference.json',applicability:'Historical module research only. Its #992 motor and old 4.8 V/150 mA/layout assumptions do not define this portable candidate.'},
    legacyPowerGuide:{path:'docs/car-power-and-wiring.md',applicability:'Source/netlist background only. Earlier unplaced coordinates, 150 mA arithmetic and current-20-part labels are superseded by this reference and PORTABLE-REVISION.json.'},
    physicalValidation:'UNKNOWN',purchasingAuthorized:false,printAuthorized:false,motorOutputAuthorized:false};
}

function portablePlan(spec,hash){
  const plan=getKitVerificationPlan('sound-car-v1',spec);plan.kitId=PORTABLE_KIT_ID;plan.revisionHash=hash;
  const requirement=plan.requirements.find(item=>item.requirementId==='R7');if(!requirement)fail('portable R7 requirement missing');
  requirement.hostClaimIds=['schema','cad-solids','kernel-assembly:overlaps','manufacturing','electrical-nominal','maximum-supply-voltage','physical'];
  requirement.physicalAcceptance=[
    'Measure the actual four-cell holder, service access and tray/clamp capture; test retention without cell compression or contact with caster hardware.',
    'Reconcile NKK 2.4 mm panel seat, manufacturer nut/ring/washer set and proposed rear-nut clearance; confirm full lever motion and accessible independent motor-power cutoff.',
    'Verify ARM contact groups and COM-NC STOP with unpowered continuity tests; inspect button/bracket mounting, travel and lead/solder insulation.',
    'Qualify wire ratings, insulation, bends, exit holes, strain relief and fuse coordination; verify regulator/VSYS/3V3 rails and USB backfeed before any enabled motor test.',
    'Record design/firmware hashes and physical observations for boot-disarmed, STOP/wire-break, fault, quiet coast and motor-self-noise; retain failed tests.',
  ].map((action,index)=>({id:`R7-physical-${index+1}`,action,status:'UNKNOWN'}));
  return plan;
}

/** Rows for PORTABLE-COMPONENT-GROUPS.json/CSV. One installed component identity,
 * not one envelope solid. Call only with the validated reference returned above. */
export function portableComponentGroupRows(reference){
  if(reference?.kitId!==PORTABLE_KIT_ID||!Array.isArray(reference.components))fail('expected a validated portable hardware reference');
  return reference.components.map(component=>({
    componentId:component.id,designHash:reference.designHash,sku:component.sku,name:component.name||component.sku,manufacturer:component.manufacturer,
    quantity:component.quantity,quantityUnit:component.quantityUnit,purchasePackageQuantity:component.purchasePackageQuantity,purchaseNote:component.purchaseNote,
    geometryGroupId:component.geometryGroupId,modelPartIds:copy(component.modelPartIds),containingEnvelopePartIds:copy(component.containingEnvelopePartIds),keepoutPartIds:copy(component.keepoutPartIds),
    geometryRepresentation:component.geometryRepresentation,price:null,currency:'CNY',stock:null,physicalFit:'UNKNOWN',
  }));
}

/** Revision-specific offline instructions; never inherit the legacy 150 mA guide. */
export function portablePowerGuide(reference){
  if(reference?.kitId!==PORTABLE_KIT_ID)fail('expected portable reference for guide');
  const power=reference.portablePowerCandidate,s=power.electricalScreen;
  return `# Portable regulated-5V candidate — power and assembly review

Design SHA256: ${reference.designHash}
Status: CAD CANDIDATE ONLY. Physical validation UNKNOWN. NOT released for fabrication or power.

## Start with the right inventory
PORTABLE-REVISION.json is the immutable compiler revision, not a native test result. verification.json contains the separate job checks. Read BUILD-GUIDE.html in prerequisite order, PORTABLE-COMPONENT-GROUPS.json, PURCHASE-BOM.csv and VERIFICATION-PLAN.json together. There are 48 geometry items, 22 proposed printed parts and 18 grouped purchase candidate identities. GEOMETRY-INVENTORY.csv / BOM.csv are NOT a shopping list. A switch body, lever and terminals are one switch; stop_lever_motion is reserved motion space, never a purchase or printable lever. Four installed cells mean one verified four-cell listing, not four packs. Holder and fuse holder are each distinct from their cells and fuse. No prices, stock, final fastener order or physical fits are established.

## Mechanical review before cells or power
1. Keep cells removed and disconnect USB and motor power while fitting parts. Use the revision chassis, power_tray, battery_rear_clamp, control_gantry and wire_channel, not the old rolling-base layout. Reconcile actual holder and populated electronics against the envelopes. The MAX4466 is still only a PCB outline.
2. Measure the proposed rear and front through stacks, all accessory mounts, actual nuts/washers, engagement and tool access before choosing screws. No new screw grade or torque is specified. The reserved 3 mm NKK rear-nut allowance is not a sourced nut dimension. Follow the source 2.4 mm panel seat and supplied locking hardware; do not force the switch through unrecessed material.
3. Check cell-cover service, holder restraint without cell compression, regulator and fuse pocket clearances, cable exits and full cutoff/STOP travel. The regulator/fuse/control shapes are source-derived envelopes, not populated manufacturer STEP.
4. Resolve exact harness ratings, insulated transitions, connector/contact ratings, bend radii and strain relief. Wiring corridors and guard CAD do not prove insulation, finger protection or a pull test. Do not route motor current through signal-ground breadboard paths.

## Candidate power domains — not measured performance
The raw four-cell NiMH pack is nominal 4.8 V / 2 Ah. The separate regulator proposes a nominal 5 V motor rail, not a 4.8 V motor rail. Logic allowance is ASSUMED 0.25 A, not the historical 0.15 A. The nominal arithmetic gives ${s.twoMotorTheoreticalStallA} A theoretical combined motor stall plus ${s.assumedLogicAllowanceA} A logic = ${s.nominalOutputBudgetA} A / ${s.nominalOutputBudgetW} W at the regulator output. At assumed efficiency ${s.assumedEfficiency}, nominal raw-pack input is ${s.nominalPackInputBudgetA} A. These are conditional calculations, not continuous-current, startup, fuse, thermal or runtime tests. Never deliberately stall motors. Charged/loaded pack limits, sag, regulator transients and actual current remain UNKNOWN. No runtime estimate is provided.

## Exact candidate netlist
Reconcile every terminal against the actual supplier variant and source pinout before soldering. The fuse must be placed near the holder positive lead; qualify fuse/wire coordination and the thin holder-lead transitions rather than treating a holder rating as a wire rating. Independent cutoff precedes the regulator. Schottky anode is on regulated 5 V, cathode toward Pico VSYS. Never put the 5 V motor rail on Pico 3V3 or microphone/ADC.

${power.nets.map(net=>'- '+net.id+': '+net.nodes.join(' ↔ ')).join('\n')}

Pico physical-pin and GP labels above refer to the original non-wireless Pico/Pico H. Confirm variant and orientation. ARM uses the opposite B3F electrical contact groups, not guessed visual rows. STOP uses COM–NC so opening the loop requests stop; NC is not proof of fail-safe physical braking. Confirm continuity with power removed. Unconnected candidate terminals: ${JSON.stringify(power.unconnected)}.

## Firmware stays locked
The supplied config keeps MOTOR_OUTPUT_ENABLED = False, BEHAVIOR_PROFILE = 'commissioning', CONTINUOUS_PROFILE_REVIEWED = False. No package/build/download unlocks outputs. Pin/controller software is reused, but this document replaces the legacy power/layout instructions. Relative THRESHOLD_DBFS is not calibrated dB SPL. Commissioning's low PWM and bounded run cap do not implement a validated 0.5 m/s operating point. continuous_while_loud is a separate deliberate profile only after physical review; do not simply remove the commissioning limit. Quiet/STOP disables drive and coasts, not instantaneous braking. Motor self-noise may keep the threshold exceeded.

## R7 physical acceptance — all UNKNOWN
${reference.verificationPlan.requirements.find(item=>item.requirementId==='R7').physicalAcceptance.map(item=>'- '+item.id+': '+item.action+' ['+item.status+']').join('\n')}

Before any enabled motor trial, have a competent adult inspect unpowered polarity/continuity, insulated retention, protection, correct rails and USB backfeed behavior with a current-limited setup. Keep wheels raised, a reachable independent motor cutoff and a clear test area. Record the exact design/firmware hashes, tests and failures; begin floor trials only after the electrical and raised-wheel checks. A software PASS or topology check cannot authorize power. No child-safety certification is claimed.

## Remaining release blockers
${reference.releaseBlockers.map(item=>'- '+item.id+': '+item.reason+' ['+item.status+']').join('\n')}
`;
}
