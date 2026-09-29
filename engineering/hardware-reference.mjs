import {designHash, validateDesignSpec} from '../server/studio-contract.mjs';

const EXPECTED = Object.freeze({
  motor_l: 'pololu-lp6v-1098', motor_r: 'pololu-lp6v-1098',
  wheel_l: 'pololu-wheel-1420', wheel_r: 'pololu-wheel-1420',
  bracket_l: 'pololu-bracket-1086', bracket_r: 'pololu-bracket-1086',
  caster: 'pololu-caster-950', pico: 'raspberry-pi-pico-r3', driver: 'pololu-drv8833-2130',
});

// A package binding, not a source-verifier or purchase order. No filesystem/network.
export function buildKitHardwareReference(kitId, input, catalog) {
  if (kitId !== 'sound-car-v1') return null;
  const spec = validateDesignSpec(input);
  const byId = new Map((catalog?.components || []).map(c => [c.id, c]));
  const parts = new Map(spec.parts.map(p => [p.id, p]));
  for (const [partId, catalogId] of Object.entries(EXPECTED)) {
    if (parts.get(partId)?.shape?.catalogId !== catalogId) throw new Error(`Kit hardware mismatch: ${partId} must reference ${catalogId}; do not substitute the legacy #992 motor.`);
    if (!byId.get(catalogId)?.geometry?.sha256) throw new Error(`Missing source geometry binding: ${catalogId}`);
  }
  const groups = new Map();
  for (const part of spec.parts.filter(p => p.kind === 'purchased')) {
    const catalogId = part.shape.type === 'catalog' ? part.shape.catalogId : part.id === 'microphone_board' ? 'adafruit-max4466-1063' : null;
    const source = byId.get(catalogId);
    if (!source) throw new Error(`Unbound purchased part in kit hardware reference: ${part.id}`);
    let item = groups.get(catalogId);
    if (!item) {
      item = {
        catalogId, name: source.name, manufacturer: source.manufacturer, sku: source.sku,
        variant: source.variant, revision: source.revision ?? null,
        quantity: 0, quantityUnit: 'individual modelled component', modelPartIds: [],
        purchasePackageQuantity: null, purchaseNote: 'Model count is not supplier package count; confirm whether the listing supplies a pair or includes hardware.',
        geometryRepresentation: part.shape.type === 'catalog' ? 'HASH_BOUND_CATALOG_STEP' : 'SOURCE_DERIVED_PCB_OUTLINE_ONLY',
        sourceGeometrySha256: part.shape.type === 'catalog' ? source.geometry.sha256 : null,
        geometryBoundsMm: part.shape.type === 'catalog' ? structuredClone(source.geometry.boundsMm ?? null) : null,
        sourceUrls: structuredClone(source.sourceUrls ?? []), sourceArtifacts: structuredClone(source.sourceArtifacts ?? []),
        ratings: structuredClone(source.ratings ?? {}), interfaces: structuredClone(source.interfaces ?? []),
        price: null, stock: null, physicalFit: 'UNKNOWN',
        limitations: structuredClone(source.limitations ?? []),
      };
      groups.set(catalogId, item);
    }
    item.quantity += 1;
    item.modelPartIds.push(part.id);
  }
  if (!groups.has('adafruit-max4466-1063')) throw new Error('Kit microphone board reference is missing.');

  const extras = [
    ['motor-supply', '4-AA NiMH power candidate, holder, restraints and regulated rail', null, 'portablePowerCandidate identifies exact proposed sources, not released hardware. Maximum charged voltage/current, complete mass, packaging and restraint remain unverified.'],
    ['logic-supply', 'Pico logic supply through regulated 5 V and external Schottky ORing diode', null, 'Candidate netlist provided; USB/backfeed and loaded rail behavior untested. No direct motor VIN to Pico power rails.'],
    ['fuse', 'Littelfuse 0297002.H and 0FHM0001ZXJ-T candidate', 1, 'Provisional 2 A rating needs actual pack/startup/fault/wire coordination; not small-motor stall protection.'],
    ['power-disconnect', 'NKK MN12SS1W01 mechanical disconnect candidate', 1, 'Exact source and terminal functions provided; mounting, inrush and motor-power isolation untested. Software STOP is not independent power removal.'],
    ['arm-button', 'Omron B3F-1002-G normally-open ARM candidate', 1, 'Source-backed switch and pull-up proposed; PCB/button mounting, contact pairing and wiring require inspection.'],
    ['stop-contact', 'Omron D2F-01L-D3 normally-closed STOP candidate', 1, 'COM-NC netlist provided; mounting and low-voltage contact reliability untested; sensing does not independently interrupt power.'],
    ['fasteners', 'Matched bracket, caster, PCB and retainer screws, nuts and washers', null, 'Four bracket, two caster, four Pico, two microphone and two retainer mounting locations exist; lengths, engagement, tool access and final hardware counts remain unverified.'],
    ['interconnect', 'Rated wire, headers or soldered leads, connectors, insulated terminals and strain relief', null, 'Exact pin/header population, wire gauge, solder joints, cable paths and retention are not represented.'],
    ['guards', 'Required finger/cable guards and protected battery/electrical enclosure', null, 'Hazard review and actual use conditions determine needed protection; none is claimed complete.'],
  ].map(([id, name, proposedQuantity, reason]) => ({id, name, proposedQuantity, quantityBasis: 'Architecture requirement, not a purchase order', geometryRepresented: false, status: 'UNKNOWN', blocksPhysicalRelease: true, reason}));

  return {
    schemaVersion: 1, referenceId: 'sound-car-v1-job-hardware-reference', kitId,
    designHash: designHash(spec), catalogRevision: catalog.catalogRevision ?? null,
    status: 'SOURCE_BOUND_CANDIDATE_NOT_A_COMPLETE_BOM_NOT_RELEASED_FOR_POWER',
    scope: 'Actual kit-selected hardware. Replaces the legacy #992 baseline for this exact design only; does not alter general designs.',
    sourceBoundary: 'Catalog source paths, hashes and labels are preserved evidence references, not new physical measurements or source-verification results.',
    components: [...groups.values()],
    printedParts: spec.parts.filter(p => p.kind === 'printed').map(p => ({partId: p.id, name: p.name, quantity: 1, material: p.material, processValidated: false})),
    operatingInputs: structuredClone(spec.physicsInputs ?? {}),
    additionalRequiredItems: extras,
    portablePowerCandidate: buildPortablePowerCandidate(spec, byId),
    fastenerCandidate: buildFastenerCandidate(spec),
    releaseBlockers: [
      ...extras.map(item => ({id: item.id, status: 'UNKNOWN', reason: item.reason})),
      {id: 'microphone-populated-geometry', status: 'UNKNOWN', reason: 'MAX4466 drawing is only the source-derived PCB outline and holes, not complete microphone/capacitor/header geometry or clearance.'},
      {id: 'firmware-operating-point', status: 'UNKNOWN', reason: 'Firmware includes separate commissioning and explicit continuous_while_loud profiles, both output-disabled by default. Kit motor arithmetic assumes nominal applied voltage, not the bench PWM operating point; neither profile is physical proof of speed, self-noise rejection or stopping distance.'},
      {id: 'source-fit-and-process', status: 'UNKNOWN', reason: 'Source CAD is not physical fit. Confirm exact variants, tolerances, D-shaft phase, press fit, actual printed process, material strength, retention and tool access.'},
      {id: 'physical-function', status: 'UNKNOWN', reason: 'Measure complete mass, loaded speed/current/temperature, traction, quiet-stop distance/latency and motor-self-noise. No hardware commissioning result exists.'},
    ],
    firmwareGuide: 'firmware/sound-car/README.md',
    powerGuide: 'docs/car-power-and-wiring.md',
    legacyReference: {path: 'components/car-reference.json', applicability: 'Historical module/wiring research only, not this kit BOM or motor selection'},
    purchasingAuthorized: false, printAuthorized: false, motorOutputAuthorized: false,
  };
}

// Offline source notes reviewed 2026-09-27. These additional components are NOT
// in the immutable CAD catalog or placed in the current assembly. No live lookup.
function buildPortablePowerCandidate(spec, byId) {
  const candidate = (id, manufacturer, sku, quantity, sourceUrl, facts, limits) =>
    ({id, manufacturer, sku, quantity, sourceUrl, facts, limits,
      sourceBasis: 'PUBLISHED_SOURCE_REVIEW_NOT_PHYSICAL_MEASUREMENT',
      geometryRepresented: false, physicalStatus: 'UNKNOWN', price: null, stock: null});
  const components = [
    candidate('cells', 'Panasonic', 'BK-3MCD/4H', 4, 'https://panasonic.jp/battery/products/BK-3MCD_4H/spec.html',
      {chemistry: 'NiMH', cellNominalVoltageV: 1.2, cellMinimumCapacityMah: 2000, cellApproxMassG: 28, cellDimensionsMm: [14.5,50.5], purchasedPackageCells: 4},
      'Four matched cells in series, charge outside car in compatible charger. Maximum charged voltage and continuous current guarantee not established; no charger/BMS in this design.'),
    candidate('holder', 'Generic, supplied by Pololu', '1159', 1, 'https://www.pololu.com/product/1159',
      {cells: 4, dimensionsMm: [71,65,20], leadAwg: 24, leadLengthInches: 6},
      'Internal switch current rating and cell-contact resistance unknown. It is not the independent disconnect. No current CAD fit or restraint.'),
    candidate('regulator', 'Pololu', '4085 / S13V20F5', 1, 'https://www.pololu.com/product/4085',
      {inputRangeV: [2.8,22], outputV: 5, outputToleranceFraction: .03, typicalOutputRangeA: [1,2.5], dimensionsMm: [8.9,12.1,5.6]},
      'Output current depends on input voltage and cooling; not unconditional 2 A. No reverse-polarity protection. 2.8 V is not a safe NiMH pack discharge cutoff.'),
    candidate('isolation_diode', 'Vishay', '1N5817-E3/54', 1, 'https://www.vishay.com/docs/88525/1n5817.pdf',
      {reverseVoltageV: 20, averageForwardCurrentA: 1, package: 'DO-41', cathode: 'band'},
      '1 A rating has datasheet temperature/lead conditions; diode serves logic branch only, not motors.'),
    candidate('disconnect', 'NKK', 'MN12SS1W01', 1, 'https://www.nkkswitches.com/pdf/MN_ToggleSections_DP.pdf',
      {contact: 'SPDT ON-ON', resistiveRatingA: 4, resistiveRatingVdc: 30, panelHoleMm: 6.5, commonTerminal: '2', switchedTerminal: '3'},
      'Terminal 1 unused and insulated. Confirm terminal identity with continuity test. Resistive rating is not motor/inrush lifetime verification or certified emergency stop.'),
    candidate('fuse', 'Littelfuse', '0297002.H', 1, 'https://www.littelfuse.com/assetdocs/littelfuse-datasheet-297-mini32v?assetguid=42c9dd21-a88e-4328-8e67-2f832444faf1',
      {ratedA: 2, ratedVdc: 32, package: 'MINI', ratingSelection: 'PROVISIONAL'},
      '2 A is only a short-circuit coordination candidate, NOT stall protection; validate wire/contact heating, startup pulse and fuse curve before use.'),
    candidate('fuse_holder', 'Littelfuse', '0FHM0001ZXJ-T', 1, 'https://www.littelfuse.com/assetdocs/0fhm0001zxj-t-2d-print?assetguid=921afcbd-065f-46c9-bcf7-00546532d5da',
      {ratedA: 20, ratedVdc: 58, leadAwg: 14, approximateBodyMm: [41,15,11]},
      'Holder rating does not uprate 24 AWG battery-box leads; insulated wire-size transitions, restraint and packaging remain unresolved.'),
    candidate('arm', 'Omron', 'B3F-1002-G', 1, 'https://components.omron.com/us-en/system/files/2023-01/datasheet_pdf/A070-E1.pdf',
      {contact: 'SPST-NO, gold', ratedCurrentRangeA: [.0001,.05], ratedVoltageRangeV: [3,24]},
      'Use opposite electrical contact groups, not two internally shorted legs. Datasheet bottom-view numbering differs from top view; verify unpowered continuity.'),
    candidate('stop', 'Omron', 'D2F-01L-D3', 1, 'https://components.omron.com/sites/default/files/datasheet_pdf/B036-E1.pdf',
      {contact: 'SPDT, gold, hinge lever, solder terminals', ratedA: .1, ratedVdc: 30, minimumLoadReference: '1 mA at 5 VDC'},
      'Use COM-NC for normal closed sensing. 3.3 V / approximately 1.5 mA microload reliability remains to be confirmed; not an independent safety-rated power cutoff.'),
    candidate('arm_pullup', 'Generic, supplied by Adafruit', '2784', 1, 'https://www.adafruit.com/product/2784',
      {resistanceOhm: 10000, toleranceFraction: .05, ratedW: .25}, 'External 3.3 V pull-up; approximately .33 mA closed-contact current. Pack contains 25; quantity is one resistor.'),
    candidate('stop_pullup', 'Generic, supplied by Adafruit', '2782', 1, 'https://www.adafruit.com/product/2782',
      {resistanceOhm: 2200, toleranceFraction: .05, ratedW: .25}, 'External 3.3 V pull-up; approximately 1.5 mA closed-contact current. Pack contains 25; quantity is one resistor.'),
  ];
  const nets = [
    ['PACK_POS', ['holder.+','fuse_holder.IN']],
    ['FUSED_POS', ['fuse_holder.OUT','disconnect.2']],
    ['SWITCHED_PACK', ['disconnect.3','regulator.VIN']],
    ['REGULATED_5V', ['regulator.VOUT','driver.VIN','isolation_diode.A']],
    ['LOGIC_VSYS', ['isolation_diode.K','pico.39_VSYS']],
    ['GND', ['holder.-','regulator.GND','driver.GND','pico.38_GND','pico.33_AGND','microphone.GND','arm.contact_B','stop.COM']],
    ['LOGIC_3V3', ['pico.36_3V3_OUT','microphone.VCC','arm_pullup.1','stop_pullup.1']],
    ['MIC', ['microphone.OUT','pico.31_GP26']],
    ['AIN1', ['pico.4_GP2','driver.AIN1']], ['AIN2', ['pico.5_GP3','driver.AIN2']],
    ['BIN1', ['pico.6_GP4','driver.BIN1']], ['BIN2', ['pico.7_GP5','driver.BIN2']],
    ['SLEEP', ['pico.9_GP6','driver.SLP']], ['FAULT', ['pico.10_GP7','driver.FLT']],
    ['ARM', ['pico.19_GP14','arm.contact_A','arm_pullup.2']],
    ['STOP', ['pico.20_GP15','stop.NC','stop_pullup.2']],
    ['MOTOR_L1', ['driver.AOUT1','motor_l.terminal_1']], ['MOTOR_L2', ['driver.AOUT2','motor_l.terminal_2']],
    ['MOTOR_R1', ['driver.BOUT1','motor_r.terminal_1']], ['MOTOR_R2', ['driver.BOUT2','motor_r.terminal_2']],
  ].map(([id,nodes])=>({id,nodes}));
  const stall = byId.get('pololu-lp6v-1098').ratings.theoreticalStallCurrentA.value;
  const ratedV = byId.get('pololu-lp6v-1098').ratings.voltageV.value;
  const motorCurrentA = 2*stall*5/ratedV;
  const plan = {
    id: 'sound-car-power-aa-reg5-candidate-v1', status: 'CANDIDATE_NOT_IN_CURRENT_CAD_NOT_RELEASED',
    reviewedDate: '2026-09-27', designHash: designHash(spec), components, nets,
    referencePinout: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf',
    fuseInstallation: 'Install fuse in matching holder, adjacent to battery positive, before disconnect/regulator. Protect unfused lead from abrasion.',
    unconnected: ['pico.40_VBUS','driver.VMM','stop.NO','disconnect.1'],
    wiringMethod: 'Soldered short insulated leads; no motor current through a breadboard or Pico/microphone ground lead. Common star return near regulator/driver. Exact harness lengths, connectors, wire ratings and strain relief still need approval.',
    batteryDerivation: {seriesCells: 4, nominalVoltageV: 4.8, minimumNameplateCapacityMah: 2000, approximateCellMassG: 112, maximumChargedVoltageV: null, runtimeMinutes: null},
    electricalScreen: {
      status: 'CONDITIONAL_ARITHMETIC_NOT_POWER_TEST', regulatedOutputRangeV: [4.85,5.15],
      nominalMotorRailV: 5, twoMotorTheoreticalStallA: motorCurrentA,
      assumedLogicAllowanceA: .15, nominalOutputBudgetA: motorCurrentA+.15,
      assumedEfficiency: .85, nominalPackInputBudgetA: 5*(motorCurrentA+.15)/(4.8*.85),
      limits: 'Linear voltage scaling of published theoretical stall current plus ASSUMED 150 mA logic allowance. Does not include measured inrush, brush/inductive transients, regulator cooling/current curve, fuse coordination or battery sag. Never intentionally stall motors to test this arithmetic.',
    },
    currentDesignMotorVoltageV: spec.physicsInputs?.batteryVoltage?.value ?? null,
    requiresDesignRevision: true,
    requiredPhysicalTests: ['polarity-and-insulation','regulator-startup-loaded-rails','usb-external-power-isolation','disconnect-removes-motor-power','fuse-wire-coordination','pack-contact-heating','mass-and-battery-restraint','continuous-profile-quiet-stop-and-self-noise'],
    physicalResults: 'UNKNOWN',
  };
  plan.topologyChecks = validatePowerCandidate(plan);
  return plan;
}

// These checks concern the proposed netlist only. They cannot inspect real wires.
export function validatePowerCandidate(plan) {
  const entries = Array.isArray(plan?.nets) ? plan.nets : [];
  const memberships = new Map();
  for(const net of entries) for(const node of net.nodes || []) {
    const set = memberships.get(node)||new Set();set.add(net.id);memberships.set(node,set);
  }
  const together = (...nodes) => nodes.every(n=>memberships.get(n)?.size===1) && nodes.every(n=>[...memberships.get(n)][0]===[...memberships.get(nodes[0])][0]);
  const row = (id,valid,reason)=>({id,status:valid?'PASS':'FAIL',evidenceScope:'CANDIDATE_NETLIST_ONLY',reason});
  return [
    row('netlist-no-duplicate-nodes', [...memberships.values()].every(s=>s.size===1) && new Set(entries.map(n=>n.id)).size===entries.length, 'Every explicit endpoint belongs to one named net.'),
    row('netlist-fused-mechanical-disconnect', together('holder.+','fuse_holder.IN')&&together('fuse_holder.OUT','disconnect.2')&&together('disconnect.3','regulator.VIN')&&new Set(['holder.+','disconnect.2','disconnect.3'].map(n=>[...(memberships.get(n)||[])][0])).size===3, 'Fuse precedes mechanical disconnect; component internals still require physical inspection.'),
    row('netlist-pico-diode-or', together('regulator.VOUT','driver.VIN','isolation_diode.A')&&together('isolation_diode.K','pico.39_VSYS')&&![...(memberships.get('isolation_diode.A')||[])].some(n=>memberships.get('isolation_diode.K')?.has(n))&&!memberships.has('pico.40_VBUS'), 'Regulated supply enters external diode anode; band/cathode goes to VSYS, never VBUS. Onboard USB D1 remains intact.'),
    row('netlist-adc-domain', together('pico.36_3V3_OUT','microphone.VCC')&&together('microphone.OUT','pico.31_GP26')&&!together('microphone.VCC','regulator.VOUT'), 'Microphone powered from 3.3 V; ADC is not connected to the 5 V rail.'),
    row('netlist-stop-nc', together('pico.20_GP15','stop.NC','stop_pullup.2')&&together('stop.COM','pico.38_GND')&&together('stop_pullup.1','pico.36_3V3_OUT')&&!memberships.has('stop.NO'), 'NC sense opens on press or wire break; not a power-cutting circuit.'),
    row('netlist-common-return', together('holder.-','regulator.GND','driver.GND','pico.38_GND','microphone.GND'), 'Electrical common reference, not permission to route motor current through signal wiring.'),
    row('netlist-firmware-pin-contract', [['pico.4_GP2','driver.AIN1'],['pico.5_GP3','driver.AIN2'],['pico.6_GP4','driver.BIN1'],['pico.7_GP5','driver.BIN2'],['pico.9_GP6','driver.SLP'],['pico.10_GP7','driver.FLT'],['pico.19_GP14','arm.contact_A','arm_pullup.2'],['arm_pullup.1','pico.36_3V3_OUT']].every(nodes=>together(...nodes)), 'Proposed GP-to-physical-pin assignment matches reference firmware; motor polarity still requires wheels-raised inspection.'),
  ];
}

function buildFastenerCandidate(spec) {
  const part=id=>spec.parts.find(p=>p.id===id);
  const chassis=part('chassis').shape.size[2], spacer=part('caster_spacer').shape.size[2];
  const stack=(id,quantity,gripMm,lengthMm,sku,sourceUrl)=>({id,quantity,gripMm,lengthMm,sku,sourceUrl,
    thread:'M2 x 0.4', nut:'Accu HPN-M2-A2', washers:'2 x Accu HPW-M2-V1-PK per location',
    proposedNutHeightMm:1.6, proposedTotalWasherThicknessMm:.6,
    nominalProtrusionBeyondNutMm:lengthMm-gripMm-1.6-.6,
    arithmeticScope:'Nominal stack only; excludes dimensional tolerances, component contact, nut access and printed compression.',
    geometryRepresented:false, physicalFit:'UNKNOWN'});
  return {status:'CANDIDATE_STACKS_NOT_RELEASED',
    bracket:{quantity:4,thread:'#2-56',lengthMm:11.1125, includedWith:'Pololu #1086 pair',
      sourceUrl:'https://www.pololu.com/product/1086',nutIncluded:true,
      limit:'Manufacturer includes 7/16-inch screws, not assumed 1/4-inch screws. Do not relabel M2; check actual captured-nut engagement and tip clearance for 4 mm chassis.'},
    stacks:[
      stack('pico',4,chassis+part('pico_standoff_0').shape.height+1,16,'SSC-M2-16-A2','https://www.accu.co.uk/metric-cap-head-screws/2774-SSC-M2-16-A2'),
      stack('microphone',2,chassis+part('mic_standoff_0').shape.height+part('microphone_board').shape.size[2],16,'SSC-M2-16-A2','https://www.accu.co.uk/metric-cap-head-screws/2774-SSC-M2-16-A2'),
      stack('driver_rails',2,chassis+part('driver_rail_l').shape.size[2],16,'SSC-M2-16-A2','https://www.accu.co.uk/metric-cap-head-screws/2774-SSC-M2-16-A2'),
      stack('caster',2,chassis+spacer+1.524,20,'SSC-M2-20-A2-BL','https://www.accu.co.uk/metric-cap-head-screws/151771-SSC-M2-20-A2-BL'),
    ],
    sharedSources:{nuts:'https://www.accu.co.uk/hexagon-nuts/7884-HPN-M2-A2',washers:'https://www.accu.co.uk/metric-flat-washers/404101-HPW-M2-V1-PK'},
    additionalQuantity:{m2Screws16mm:8,m2Screws20mm:2,m2Nuts:10,peekWashers:20},
    limitations:['These quantities cover existing 14 mount locations only; power and control hardware need additional mounts.',
      'PEEK washer OD 5 mm and screw head OD 3.8 mm require actual PCB copper/component clearance; insulation is not established by a washer alone.',
      'Pico PCB thickness 1 mm and caster flange 1.524 mm come from selected source geometry, not measured boards.',
      'Driver rail screws protrude nominally 3.8 mm beyond the nut; clearance and sharp-end guarding unverified.',
      'No screw/nut/washer solids or driver-tool sweeps are in the current CAD; nominal stack arithmetic is not a fit PASS.'],
  };
}
