// Synthetic software fixture, never a generated toy or a physical acceptance record.
export function electricalFixture(){
  const records=[['pico','raspberry-pi-pico-r3'],['mic','adafruit-max4466-1063'],['driver','pololu-drv8833-2130'],['left','pololu-lp6v-1098'],['right','pololu-lp6v-1098'],['arm','momentary-arm-no'],['stop','stop-nc'],['battery','battery-dc'],['cutoff','dc-power-cutoff'],['fuse','fuse-series']];
  const parts=records.map(([id,profileId],i)=>({id,name:id,kind:'purchased',shape:!['pico','driver','left','right'].includes(id)?{type:'box',size:[20,10,5]}:{type:'catalog',catalogId:profileId},position:[i*25,0,0],rotation:[0,0,0]}));
  const components=records.map(([partId,profileId])=>({partId,profileId,terminalAnchors:[]}));let n=0;
  const connections=[];const wire=(a,at,b,bt,kind='signal')=>{connections.push({id:'wire_'+(++n),from:{partId:a,terminal:at},to:{partId:b,terminal:bt},kind,color:kind==='ground'?'#202020':'#EE5533',wireAwg:24});for(const [id,t]of[[a,at],[b,bt]]){const c=components.find(c=>c.partId===id);if(!c.terminalAnchors.some(a=>a.terminal===t))c.terminalAnchors.push({terminal:t,positionMm:[0,c.terminalAnchors.length,3]});}};
  for(const [gp,t]of[[2,'AIN1'],[3,'AIN2'],[4,'BIN1'],[5,'BIN2'],[6,'SLP'],[7,'FLT']])wire('pico','GP'+gp,'driver',t);
  wire('pico','GP26','mic','OUT');wire('pico','3V3(OUT)','mic','VCC','power');wire('pico','GND','mic','GND','ground');wire('pico','GND','driver','GND','ground');
  wire('pico','GP14','arm','NO');wire('arm','COM','pico','GND','ground');wire('pico','GP15','stop','NC');wire('stop','COM','pico','GND','ground');
  wire('driver','AOUT1','left','M1','motor');wire('driver','AOUT2','left','M2','motor');wire('driver','BOUT1','right','M1','motor');wire('driver','BOUT2','right','M2','motor');
  wire('battery','+','fuse','IN','power');wire('fuse','OUT','cutoff','COM','power');wire('cutoff','OUT','driver','VIN','power');wire('battery','-','pico','GND','ground');
  return {parts,electrical:{schemaVersion:1,components,connections,control:{profile:'pico-max4466-drv8833-sound-v1',controllerPartId:'pico',microphonePartId:'mic',driverPartId:'driver',leftMotorPartId:'left',rightMotorPartId:'right',armPartId:'arm',stopPartId:'stop',thresholdDbfs:-25,leftPolarity:1,rightPolarity:-1,pwmDuty:.2}}};
}
