import {designHash,validateDesignSpec,verifyDesign} from '../server/studio-contract.mjs';
import {compileKit} from './kit.mjs';
import {compilePortableKit,partBounds} from './portable-kit.mjs';
import {REVIEWED_DESIGN_HASH,FASTENER_SOURCES} from './portable-fasteners.mjs';

export const PORTABLE_V2_ID='sound-car-portable-reg5-fasteners-v2';
const round=n=>Math.round(n*1e7)/1e7;
const pocket=(size,position)=>({size,position});

/** Separate prototype; no source geometry scaling, runtime registration or physical release. */
export function compilePortableKitV2(input,catalog){
  const parent=validateDesignSpec(input);
  if(designHash(parent)!==REVIEWED_DESIGN_HASH)throw new Error('Portable v2 requires exact reviewed r3 parent');
  const original=compilePortableKit(compileKit('sound-car-v1',{lengthMm:180,widthMm:100,targetSpeedMS:.5,thresholdDbfs:-25},catalog),catalog);
  if(designHash(original.spec)!==REVIEWED_DESIGN_HASH)throw new Error('Portable v2 source catalog differs from reviewed parent');
  const spec=structuredClone(parent),byId=new Map(spec.parts.map(p=>[p.id,p]));
  const p=id=>byId.get(id),worldPocket=(part,size,world)=>part.pockets.push(pocket(size,world.map((n,i)=>n-part.position[i])));
  const rear=p('battery_rear_clamp'),gantry=p('control_gantry');
  // Battery clearance remainsZ53. Lower roofs thicken upwards only.
  rear.shape.size=[28,76,23];rear.position[2]=48.5;
  rear.pockets=[pocket([30,67,18],[0,0,-4.5])]; // worldZ35..53, openX
  gantry.shape.size[0]=28;
  gantry.pockets=[pocket([30,67,18],[0,0,-17]),pocket([30,67,21],[0,0,9.5]),pocket([17,17,1.6],[0,0,23.2])];
  const captures=[];
  // A side-open rectangular slot stops a full4mm-AF nut turning; it is not a
  // strength claim. Nut is retained by its installed stud; no drop-in glue.
  for(const [part,xs,y]of [[rear,[-9,9],0],[gantry,[-8,8],-22],[gantry,[-9.2,9.2],0]])for(const x of xs){
    const end=Math.sign(x)*14.5,inner=x-Math.sign(x)*2.5,center=(end+inner)/2;
    worldPocket(part,[Math.abs(end-inner),4.2,1.8],[part.position[0]+center,y,55.9]);
    captures.push({partId:part.id,centreXYmm:[part.position[0]+x,y],slotZmm:[55,56.8],nutZmm:[55.2,56.8],nutAFmm:4,slotAFclearanceMm:4.2,entryFace:Math.sign(x)<0?'-X':'+X',tipZmm:54.4,batteryTopZmm:53});
  }
  for(const id of ['fuse_holder_body','fuse_cradle','fuse_lid','regulator_body','regulator_cradle','regulator_lid'])p(id).position[2]+=3;
  const guard=p('switch_terminal_guard');guard.shape.size[2]=21;guard.position[2]=70.5;
  guard.pockets=[pocket([15,10.9,23],[0,0,2.5])]; // floor60..61.5
  for(const h of guard.holes)if(h.axis==='y')h.position[2]=-4; // exits stayworld66.5
  // Keep source switch together, lower0.4mm; collar+nut+ring3.2 fits3.4 allowance.
  for(const id of ['power_switch_body','power_switch_bushing','power_switch_lever','power_switch_lugs'])p(id).position[2]-=.4;
  const stop=p('stop_bracket');
  for(const h of stop.holes)if(h.axis==='z')h.position[1]=-4.5;
  for(const h of gantry.holes)if(h.axis==='z'&&Math.abs(h.position[0])===7&&h.position[1]===22)h.position[1]=17.5;
  const channel=p('wire_channel');channel.shape.size[1]=10;channel.pockets[0].size[1]=6;

  const joints=[];
  const rod=(id,xy,low,high,length,{axis='z',captured=false}={})=>{
    const nutLow=captured?55.2:low-.3-1.6,tip=captured?54.4:low-.3-1.6-1.6;
    joints.push({id,axis,centre:xy,thread:'M2x0.4',kind:'cut_rod',sku:FASTENER_SOURCES.rod.sku,lengthMm:length,rangeMm:[round(tip),round(tip+length)],
      nuts:[{faceMm:nutLow,heightMm:1.6,AFmm:4,captured},{faceMm:high+.3,heightMm:1.6,AFmm:4,captured:false}],
      washers:[...(captured?[]:[{faceMm:low-.3,thicknessMm:.3,ODmm:5,IDmm:2.2}]),{faceMm:high,thicknessMm:.3,ODmm:5,IDmm:2.2}],
      bearingFacesMm:[low,high],tipClearanceToBatteryMm:captured?1.4:null,physicalFit:'UNKNOWN',torqueNm:null});
  };
  for(const y of [-35.5,35.5]){rod('rear-'+y,[18.5,y],21,60,46);rod('front-'+y,[57.5,y],21,85,71);}
  for(const x of [9.5,27.5])rod('fuse-'+x,[x,0],56.8,77,25.5,{captured:true});
  for(const x of [49.5,65.5])rod('regulator-'+x,[x,-22],56.8,72,20.5,{captured:true});
  for(const x of [48.3,66.7])rod('guard-'+x,[x,0],56.8,85,33.5,{captured:true});
  for(const x of [51.5,63.5])rod('arm-'+x,[x,-22],81,91.4,18);
  for(const x of [50.5,64.5])rod('stop-base-'+x,[x,17.5],81,99,25);
  for(const x of [54.25,60.75])rod('stop-side-'+x,[x,92.5],16,24.8,16,{axis:'y'});
  for(const x of [6,64])joints.push({id:'channel-'+x,axis:'z',centre:[x,44],thread:'M2x0.4',kind:'cap_screw',sku:FASTENER_SOURCES.screw10.sku,lengthMm:10,rangeMm:[17.3,27.3],head:{faceMm:27.3,heightMm:2,diameterMm:3.8},nuts:[{faceMm:19.1,heightMm:1.6,AFmm:4,captured:false}],washers:[{faceMm:20.7,thicknessMm:.3,ODmm:5,IDmm:2.2},{faceMm:27,thicknessMm:.3,ODmm:5,IDmm:2.2}],bearingFacesMm:[21,27],physicalFit:'UNKNOWN',torqueNm:null});
  for(const j of joints){const [start,end]=j.rangeMm,lo=Math.min(...j.nuts.map(n=>n.faceMm)),hi=Math.max(...j.nuts.map(n=>n.faceMm+n.heightMm));j.nutFullHeightCovered=start<=lo+1e-8&&end>=hi-1e-8;j.projectionsMm=j.kind==='cut_rod'?[round(lo-start),round(end-hi)]:[round(lo-start)];if(!j.nutFullHeightCovered||j.projectionsMm.some(n=>n<.8-1e-8))throw new Error('V2 hardware coverage error '+j.id);}
  const nkkHardware=[{id:'nkk-rear-nut',sku:'AT513H',centre:[57.5,0],zMm:[78.7,80.2],AFmm:8,outerDrawingMm:9,innerMm:6.35},
    {id:'nkk-lock-ring',sku:'AT507H',centre:[57.5,0],zMm:[80.2,81],outerMm:12,innerMm:6.35,tab:{x:63.6,y:0,widthMm:2,heightMm:1.7,holeMm:2.2}},
    {id:'nkk-lock-washer',sku:'AT509',centre:[57.5,0],zMm:[83.4,83.9],outerMm:10.2,innerMm:6.4},
    {id:'nkk-front-nut',sku:'AT513H',centre:[57.5,0],zMm:[83.9,85.4],AFmm:8,outerDrawingMm:9,innerMm:6.35}];
  spec.title='Sound car portable regulated-5V fastener prototype v2';
  spec.description='Separately versioned correction of proven r3 omitted-hardware keepout conflicts; sourced parts retain dimensions. Captive nuts, fastening and service paths remain physical prototypes, not a fabrication release.';
  spec.assumptions=spec.assumptions.filter(s=>!s.includes('3mm backside')).concat(['V2 captured nuts use sourcedM2 AF4mm/height1.6mm and proposed4.2x1.8mm lateral pockets; print tolerances/preload/locking remain UNKNOWN.','V2 source-derived switch group is rigidly lowered0.4mm; no supplier shape scaling. Ring collar and nut stack still needs actual tab/thread inspection.']);
  spec.unknowns.push('V2 responds to actual r3 fastener-envelope interference. Native hardware and tool sweeps must pass separately; polymer creep, nut retention, wiring and battery removal remain physical UNKNOWN.');
  spec.requirements.push({id:'R8',text:'Fastener hardware must avoid battery/terminal keepouts, cover actual nut height, allow assembly/service tools, and retain failed parent evidence; no physical approval from CAD.'});
  for(const step of spec.assembly){
    if(step.id==='portable_tray')step.instructions=['Use this v2 revision only; no old r3 print mixing. Pre-insert six captive nuts into lateral slots with cells removed, then retain them with the reviewed rods.','Fit the unpowered holder and removable roof assemblies. Primary rear/full-height front rods use46/71mm nominal cuts, not old grip estimates.','Remove the rear clamp and unplug the harness before lifting the holder; cell service through an inaccessible cover is not assumed.'];
    if(step.id==='portable_power')step.instructions=['Fused/regulator components and pockets sit3mm above r3. Use the captured lower nuts rather than hardware below the battery roof.','Insert rods to the documentedZ54.4 lower-tip datum; inspect nut engagement, deburring and separation from the actual holder.','Follow the separately qualified harness/insulation guide; no powered release follows from these slots.'];
    if(step.id==='portable_controls')step.instructions=['Install relocated STOP bracket base before STOP switch/ARM/cutoff so nut tools can enter; keep source side holes unchanged. Reverse this order for service.','Keep the NKK group at the v2 axial position; source inch nuts and ring/washer are not metric substitutes. Verify ring tab and full lever motion.','Outputs remain disabled. Inspect physical tool access, wiring, nut locking and source tolerances before powered commissioning.'];
  }
  const mass=structuredClone(original.revision.massBudget);
  for(const item of mass.items){const part=byId.get(item.id);if(part?.kind==='printed'){const v=volumeWithoutPockets(part);item.massG=[v/1000*1.15*.5,v/1000*1.3];item.xMm=partBounds(part,catalog)[0];}}
  mass.limits+=' V2 re-evaluates each printed pocket union; hardware remains in the original explicit35..95g power/control/harness/fastener allowance, not measured or silently certified.';
  mass.totalMassG=[0,1].map(i=>mass.items.reduce((s,p)=>s+p.massG[i],0));
  const cg=[weighted(mass.items,false),weighted(mass.items,true)],fraction=[(72-cg[1])/122,(72-cg[0])/122];
  spec.physicsInputs.massKg={value:round(mass.totalMassG[1]/1000),basis:'ASSUMED',source:'V2 recomputed printed pocket volume plus explicit parent source/planning mass intervals; hardware allowance is not weighed.'};
  spec.physicsInputs.drivenWeightFraction={value:round(Math.max(.01,fraction[0])),basis:'ASSUMED',source:'V2 static independent mass/CG interval; no dynamic/tipping or measured axle load.'};
  spec.physicsInputs.structuralLoadN={value:round(spec.physicsInputs.massKg.value*9.80665),basis:'ASSUMED',source:'V2 upper own-weight scenario; not local roof/nut bearing or print-strength qualification.'};
  const clean=validateDesignSpec(spec),slow=structuredClone(clean);slow.physicsInputs.motorNoLoadRpm.value*=.8;slow.physicsInputs.motorNoLoadRpm.basis='ASSUMED';
  const claim=s=>verifyDesign(s).claims.find(c=>c.id==='motion-operating-point');
  return {spec:clean,revision:{id:PORTABLE_V2_ID,designHash:designHash(clean),parentDesignHash:REVIEWED_DESIGN_HASH,parentFailure:{path:'test-results/portable-fasteners-r3-20260927/native-report.json',sha256:'edf6eb6a35c6d31ff84687ecdeecfbdea36eebb94e571d3f4165c4b388e7f80e',status:'HARDWARE_KEEP_OUT_INTERFERENCE'},
    status:'PROTOTYPE_NOT_PHYSICAL_RELEASE',physicalStatus:'UNKNOWN',nativeStatus:'NOT_RUN',sourceDimensions:structuredClone(FASTENER_SOURCES),componentGroups:structuredClone(original.revision.componentGroups),
    changedPartIds:clean.parts.filter(p=>JSON.stringify(p)!==JSON.stringify(parent.parts.find(o=>o.id===p.id))).map(p=>p.id),capturedNuts:captures,fastenerJoints:joints,nkkHardware,
    hardwareBasis:'SOURCE_DIMENSIONED_IDEAL_ENVELOPES_NOT_MANUFACTURER_THREAD_CAD',massBudget:mass,axleLoadScreen:{cgXmm:cg,drivenWeightFraction:fraction},
    operatingPointSensitivity:{nominal:claim(clean),slowerMotor:claim(slow),physicalStatus:'UNKNOWN'},
    toolAndService:{status:'REQUIRES_NATIVE_AND_PHYSICAL_REVIEW',sequence:'Bench-preassemble captive nuts; STOP base before switch and other controls. Remove source holder only after rear clamp removal and unplugging harness.',
      batteryRemovalProposal:[{removePartIds:['fuse_holder_body','fuse_cradle','fuse_lid','battery_rear_clamp'],reason:'Remove supported fuse assembly and disconnect harness first.'},{translateHolderMm:[-30,0,0],reason:'Slide towards rear to leave front gantry capture; must test against actual tray/supports before claiming accessible.'}],
      gaugeAssumptions:{nutToolOuterDiameterMm:6,straightHexStemDiameterMm:1.74,nutInsertionAllowanceMm:.2},
      limits:'No exact tool SKU/handle/swept human access or harness flexibility is inferred.'},
    releaseBlockers:['Actual native all-part and hardware/tool/service evidence must be reviewed before prototype fabrication.','Print tolerance, captive-nut bearing/creep, vibration retention and cut-tip guarding require measurements.','Source battery-holder service cover, populated modules, solder and wire clearances remain unqualified.','Nominal motion arithmetic and -20percent sensitivity are not guaranteed0.5m/s; physical tests stay UNKNOWN.'],purchasingAuthorized:false,printAuthorized:false,motorOutputAuthorized:false}};
}

function volumeWithoutPockets(part){
  if(part.shape.type==='cylinder')return Math.PI*part.shape.radius**2*part.shape.height;
  const size=part.shape.size,boxes=(part.pockets||[]).map(p=>p.size.map((v,i)=>[Math.max(-size[i]/2,p.position[i]-v/2),Math.min(size[i]/2,p.position[i]+v/2)]));
  const axes=size.map((v,i)=>[...new Set([-v/2,v/2,...boxes.flatMap(b=>b[i]).filter(x=>x>=-v/2&&x<=v/2)])].sort((a,b)=>a-b));let volume=0;
  for(let i=1;i<axes[0].length;i++)for(let j=1;j<axes[1].length;j++)for(let k=1;k<axes[2].length;k++){const indices=[i,j,k],c=indices.map((n,a)=>(axes[a][n]+axes[a][n-1])/2);if(!boxes.some(b=>b.every((r,a)=>c[a]>r[0]&&c[a]<r[1])))volume+=indices.reduce((v,n,a)=>v*(axes[a][n]-axes[a][n-1]),1);}return volume;
}
function weighted(items,max){let lo=Math.min(...items.map(i=>i.xMm[0])),hi=Math.max(...items.map(i=>i.xMm[1]));for(let n=0;n<80;n++){const r=(lo+hi)/2;let balance=0;for(const i of items){const d=i.xMm[max?1:0]-r;balance+=i.massG[max?(d>=0?1:0):(d>=0?0:1)]*d;}if(balance>0)lo=r;else hi=r;}return(lo+hi)/2;}
