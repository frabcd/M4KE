// Bounded, host-owned terminal vocabulary. Source references are documentation,
// not evidence of the identity, dimensions or condition of a purchased module.
const pin=(id,role,extra={})=>({id,role,...extra});
const picoPins=[...Array.from({length:23},(_,i)=>pin(`GP${i}`,'gpio',{gpio:i})),...Array.from({length:3},(_,i)=>pin(`GP${26+i}`,'adc',{gpio:26+i})),pin('GND','ground'),pin('AGND','ground'),pin('3V3(OUT)','logicSupply',{voltageV:3.3}),pin('VSYS','logicInput'),pin('VBUS','usbPower')];
const docs='docs/car-power-and-wiring.md';
const profile=(id,name,role,terminals,catalogId=null,source=docs)=>({id,name,role,terminals,catalogId,source,terminalPositions:'NOT_SOURCE_QUALIFIED'});
export const ELECTRICAL_PROFILES=Object.freeze([
  profile('esp32-devkitc-v4-wroom32e','Espressif ESP32-DevKitC V4 / ESP32-WROOM-32E','controller',[...[4,16,17,18,19,21,22,23,25,26,27,32,33].map(n=>pin(`IO${n}`,'gpio',{gpio:n})),...[34,35].map(n=>pin(`IO${n}`,'adc',{gpio:n})),pin('GND','ground'),pin('3V3','logicSupply',{voltageV:3.3}),pin('5V','usbPower')],null,'https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html'),
  profile('raspberry-pi-pico-r3','Original Raspberry Pi Pico RP2040 R3','controller',picoPins,'raspberry-pi-pico-r3','https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf'),
  profile('adafruit-max4466-1063','Adafruit MAX4466 microphone #1063','microphone',[pin('VCC','sensorSupply'),pin('GND','ground'),pin('OUT','analogOutput')],'adafruit-max4466-1063','https://www.adafruit.com/product/1063'),
  profile('pololu-drv8833-2130','Pololu DRV8833 carrier #2130','driver',[...['AIN1','AIN2','BIN1','BIN2','SLP'].map(t=>pin(t,'digitalInput')),pin('FLT','openDrainOutput'),pin('VIN','motorSupply'),pin('VMM','unused'),pin('GND','ground'),...['AOUT1','AOUT2','BOUT1','BOUT2'].map(t=>pin(t,'motorOutput'))],'pololu-drv8833-2130','https://www.pololu.com/product/2130'),
  ...['1098','992'].map(sku=>profile(`pololu-lp6v-${sku}`,`Pololu LP 6V gearmotor #${sku}`,'motor',[pin('M1','motor'),pin('M2','motor')],`pololu-lp6v-${sku}`,`https://www.pololu.com/product/${sku}`)),
  profile('momentary-arm-no','Normally-open ARM contact (exact part must be identified)','arm',[pin('COM','contact'),pin('NO','contact')]),
  profile('stop-nc','Normally-closed STOP sensing contact (not a power disconnect)','stop',[pin('COM','contact'),pin('NC','contact'),pin('NO','unused')]),
  profile('dc-power-cutoff','Independent mechanical DC power disconnect, ratings unresolved','powerCutoff',[pin('COM','powerContact'),pin('OUT','powerContact')]),
  profile('fuse-series','Series fuse and holder, coordination unresolved','fuse',[pin('IN','powerContact'),pin('OUT','powerContact')]),
  profile('battery-dc','Battery/holder, exact chemistry and maximum ratings unresolved','battery',[pin('+','batteryPositive'),pin('-','ground')]),
  profile('regulator-dc','Regulator, exact topology/rating unresolved','regulator',[pin('VIN','powerInput'),pin('VOUT','powerOutput'),pin('GND','ground')]),
  profile('schottky-series','Logic-branch Schottky diode, exact rating unresolved','diode',[pin('A','anode'),pin('K','cathode')]),
  profile('resistor-pullup','Pull-up resistor, resistance/rating unresolved','resistor',[pin('1','passive'),pin('2','passive')]),
]);
export const profileById=id=>ELECTRICAL_PROFILES.find(p=>p.id===id);
export function electricalPromptContext(){
  return {schemaVersion:1,coordinateFrame:'terminalAnchors.positionMm are MODEL_ASSUMED component-local millimetres; waypointsMm are assembly/world millimetres. Proposed positions are allowed but must not be represented as source-qualified. Absent anchors cannot be drawn.',profiles:ELECTRICAL_PROFILES,controlProfile:'pico-max4466-drv8833-sound-v1',controlProfiles:['pico-max4466-drv8833-sound-v1','esp32-max4466-drv8833-sound-v1'],rules:[
    'Honor explicit ESP32 requests: controller profile esp32-devkitc-v4-wroom32e, control profile esp32-max4466-drv8833-sound-v1. Use IO identifiers, not GP. ADC microphone OUT uses IO34 or IO35 only; these are input-only. Outputs and pulled-up contacts use other listed IO pins. Do not select flash, boot-strapping, UART or unlisted pins. Microphone supply is controller 3V3. 5V stays externally unconnected in the supported USB-only commissioning arrangement; an untethered regulator/USB backfeed design remains unresolved. Controller envelope dimensions and mounting positions are assumptions, not qualified CAD.',
    'For numeric sound-pressure requests, retain control.targetDbSpl (20..140). thresholdDbfs remains a relative commissioning placeholder, never the SPL conversion. No calibration offset may be invented. Generated firmware keeps calibrated mode locked until operator calibration and review. Exactly equal to the threshold stops. SPL weighting/frequency response and physical operation remain UNKNOWN.',
    'Use part IDs already present in the design, with purchased kinds for electrical components. Geometry and electrical identities must agree. An envelope is allowed, but remains identity/fit UNKNOWN.',
    'To show a 3D wire, provide terminalAnchors for BOTH of its used terminals, proposed on the appropriate component surface in that part local frame. These are visual routing assumptions, never manufacturer positions. If even an approximate location cannot be justified, omit it and record the missing visual route explicitly.',
    'Pico terminal names are GP identifiers, NOT header pin numbers. Use GP26, GP27 or GP28 for microphone ADC. Every control role needs a distinct GPIO.',
    'Wire Pico 3V3(OUT) to MAX4466 VCC; microphone GND and driver GND share Pico ground. Never connect motor power to 3V3, VBUS or a GPIO.',
    'Map AIN1/AIN2/BIN1/BIN2/SLP/FLT and microphone OUT to distinct controller GPIOs; pair AOUT1/AOUT2 with left motor M1/M2 and BOUT1/BOUT2 with right motor M1/M2.',
    'ARM NO to its controller GPIO and COM to ground; STOP NC to its GPIO and COM to ground. The STOP input is not the independent motor power cutoff.',
    'Each contact component is separate: ARM uses profile momentary-arm-no; STOP uses stop-nc; motor power cutoff uses dc-power-cutoff. A generic switch cannot serve all three roles. Unused STOP NO and driver VMM terminals stay externally unconnected.',
    'The supported control object names SEVEN DISTINCT part IDs: controllerPartId, microphonePartId, driverPartId, leftMotorPartId, rightMotorPartId, armPartId, stopPartId. The battery, fuse and independent power cutoff are additional physical components, not aliases for ARM/STOP.',
    'control.pwmDuty MUST satisfy 0 < pwmDuty <= 0.5; 1.0 is invalid. This is conservative output-disabled commissioning configuration, not the motor voltage/speed operating-point evidence. thresholdDbfs must match physicsInputs.thresholdDbfs when present; leftPolarity/rightPolarity are exactly +1 or -1.',
    'Include a battery, series fuse, independent DC-rated power cutoff and reviewed motor power path. Generic power profiles do not establish voltage/current, fuse coordination or USB backfeed safety.',
    'Power-profile terminal spelling is exact: battery-dc +/-, fuse-series IN/OUT, dc-power-cutoff COM/OUT, regulator-dc VIN/VOUT/GND, schottky-series A/K. Ground returns connect directly; do not bridge a fuse or switch to make the graph look complete. USB-powered Pico logic may stay a declared bench arrangement; external VSYS needs reviewed Schottky cathode isolation.',
    'Firmware is generated from these exact connections and control settings, remains output-disabled, and requires commissioning. No calibrated sound-pressure or physical-safety claim.',
    'Keep JSON compact. Include anchors only for terminals you actually use, not every pin on a controller. Omit optional waypointsMm unless a deliberate bend is useful; never omit anchors or functional contacts to save tokens. Coincident [0,0,0] placeholders do not establish real terminal positions or fit.',
  ]};
}
