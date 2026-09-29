import {designHash,validateDesignSpec} from '../server/studio-contract.mjs';

export const FASTENER_REVIEW_ID='portable-r3-fastener-review-v1';
export const REVIEWED_DESIGN_HASH='99f4362c0af81f882f2fd7e3c9b1a2eb809aff54b03da0a55883283b943a529d';
const round=n=>Math.round(n*1e7)/1e7;
const source=(sku,url,dimensions)=>({sku,url,dimensions,reviewedDate:'2026-09-27',basis:'SUPPLIER_PUBLISHED_DIMENSIONS',stock:null,price:null,strengthClass:null});
export const FASTENER_SOURCES=Object.freeze({
  rod:source('HTB-M2-1000-A2','https://www.accu.co.uk/metric-threaded-bars/14719-HTB-M2-1000-A2',{thread:'M2 x 0.4',lengthMm:1000,material:'A2 stainless',standard:'DIN 976-1'}),
  nut:source('HPN-M2-A2','https://www.accu.co.uk/hexagon-nuts/7884-HPN-M2-A2',{heightMm:1.6,heightToleranceMm:[-.25,0],acrossFlatsMm:4,acrossFlatsToleranceMm:[-.18,0],pitchMm:.4,material:'A2 stainless',standard:'DIN 934'}),
  washer:source('HPW-M2-V1-PK','https://www.accu.co.uk/metric-flat-washers/404101-HPW-M2-V1-PK',{outerDiameterMm:5,outerDiameterToleranceMm:[-.36,0],innerDiameterMm:2.2,thicknessMm:.3,material:'PEEK',standard:'ISO 7089',listedPackQuantity:100}),
  screw16:source('SSC-M2-16-A2','https://www.accu.co.uk/metric-cap-head-screws/2774-SSC-M2-16-A2',{lengthMm:16,fullThread:true,headDiameterMm:3.8,headHeightMm:2,driveAFmm:1.5,material:'A2 stainless',standard:'DIN 912 / ISO 4762'}),
  screw20:source('SSC-M2-20-A2-BL','https://www.accu.co.uk/metric-cap-head-screws/151771-SSC-M2-20-A2-BL',{lengthMm:20,headDiameterMm:3.8,headHeightMm:2,driveAFmm:1.5,material:'A2 stainless',finish:'AccuBlack'}),
  screw10:source('WF2331','https://www.westfieldfasteners.co.uk/Bolts-Screws-Metric/A2-ISO-4762-Cap-Screw-M2x10mm.html',{lengthMm:10,headDiameterMaxMm:3.8,headHeightMaxMm:2,driveAFmm:1.5,pitchMm:.4,material:'A2 stainless',standard:'ISO 4762 / DIN 912',threadNote:'Supplier table gives generic b=16mm for this 10mm SKU; inspect actual complete thread, do not claim16mm thread exists on10mm screw.'}),
  bracket:source('Pololu1086 included hardware','https://www.pololu.com/product/1086',{thread:'#2-56',lengthMm:11.1125,screwsPerPair:4,nutsPerPair:4}),
  nkk:{url:'https://www.nkkswitches.com.cn/pdf/toggle_M.pdf',sha256:'a2a058e80ed4b7a342d7443114c5db9fe620259d1206eaf9aaf7fa611c9397f5',page:'A62 (PDF page15)',reviewedDate:'2026-09-27',basis:'VISUALLY_REVIEWED_MANUFACTURER_DRAWING',items:[
    {sku:'AT513H',quantity:2,thread:'1/4-40',heightMm:1.5,acrossFlatsMm:8,acrossCornersDrawingMm:9},
    {sku:'AT507H',quantity:1,outerDiameterMm:12,nominalBoreMm:6.3,thicknessMm:.8,tabHeightMm:1.7},
    {sku:'AT509',quantity:1,outerDiameterMm:10.2,innerDiameterMm:6.4,thicknessMm:.5},
  ],limit:'Use inch H hardware for the selected S1 bushing, never AT513M/M6. Dimensions do not establish assembled order, tolerances or clamp torque.'},
});

/** Nominal arithmetic, not thread-strength/print/tolerance qualification. */
export function calculateStack({gripMm,lengthMm,nuts=1,washers=2,pitchMm=.4}){
  if(![gripMm,lengthMm,pitchMm].every(n=>Number.isFinite(n)&&n>0)||![nuts,washers].every(n=>Number.isInteger(n)&&n>=0)||nuts<1)throw new Error('Invalid nominal fastener stack');
  const hardwareMm=nuts*1.6+washers*.3,extra=lengthMm-gripMm-hardwareMm;
  const projectionPerEndMm=extra/nuts;
  return {gripMm,lengthMm,nuts,washers,hardwareMm:round(hardwareMm),availableProjectionMm:round(extra),projectionPerEndMm:round(projectionPerEndMm),
    assumedProjectionTargetMm:2*pitchMm,nominalThreadCoverage:extra>=0?'FULL_NUT_HEIGHT_POSSIBLE':'TOO_SHORT',
    projectionScreen:projectionPerEndMm+1e-9>=2*pitchMm?'MEETS_ASSUMED_TWO_PITCH_TARGET':'BELOW_ASSUMED_TWO_PITCH_TARGET',
    limit:'Equal protrusions for a two-nut rod; single-nut screw length is measured under head. Two-pitch target is an explicit review convention, not a sourced load rating. No tolerance/strength or locking proof.'};
}

/** Exact immutable r3 only. Never mutates a spec or approves a modified assembly. */
export function buildPortableFastenerReview(input,{nativeReport=null}={}){
  const spec=validateDesignSpec(input),hash=designHash(spec);
  if(hash!==REVIEWED_DESIGN_HASH)throw new Error('Fastener review requires the exact reviewed r3 design hash; changed/default-metadata variants need separate review');
  const parts=new Map(spec.parts.map(p=>[p.id,p]));
  const zFace=(id,top)=>{const p=parts.get(id);return p.position[2]+(top?.5:-.5)*(p.shape.size?.[2]??p.shape.height);};
  const added=[];
  function add(id,partIds,centres,low,high,length,mode='rod',status='CONDITIONAL_NOMINAL_ONLY',note='',axis='z',washers=2){
    const nuts=mode==='rod'?2:1;
    added.push({id,quantity:centres.length,partIds,axis,centresWorldMm:centres,bearingFacesWorldMm:[low,high],
      sourceId:mode==='rod'?'rod':'screw10',cutLengthMm:mode==='rod'?length:null,sku:FASTENER_SOURCES[mode==='rod'?'rod':'screw10'].sku,
      stack:calculateStack({gripMm:high-low,lengthMm:length,nuts,washers}),status,note,physicalFit:'UNKNOWN',torqueNm:null,lockingMethod:'NOT_QUALIFIED'});
  }
  const ys=[-35.5,35.5];
  add('rear-primary',['chassis','power_tray','battery_rear_clamp'],ys.map(y=>[18.5,y]),zFace('chassis',false),zFace('battery_rear_clamp',true),43);
  add('front-primary',['chassis','power_tray','control_gantry'],ys.map(y=>[57.5,y]),zFace('chassis',false),zFace('control_gantry',true),71);
  add('wire-channel',['chassis','wire_channel'],[[6,44],[64,44]],21,27,10,'screw','CONDITIONAL_NOMINAL_ONLY','Only one underside washer. A top Ø5 washer collides with the4mm channel. Bare Ø3.8 cap head has only0.1mm nominal side clearance; not a printable tolerance guarantee. Grip is floor2+chassis4, not whole channel10+chassis4.','z',1);
  add('switch-terminal-cup',['control_gantry','switch_terminal_guard'],[[48.3,0],[66.7,0]],53,85,39,'rod','BLOCKED_KEEP_OUT_INTERFERENCE','Lower nut/washer intersects battery reserved envelope; does not become acceptable with longer screws.');
  add('fuse-cradle-and-lid',['battery_rear_clamp','fuse_cradle','fuse_lid'],[[9.5,0],[27.5,0]],53,74,28,'rod','BLOCKED_KEEP_OUT_INTERFERENCE','Lower nut/washer intersects battery; screw hole also breaks into cradle cavity by0.15mm nominal.');
  add('regulator-cradle-and-lid',['control_gantry','regulator_cradle','regulator_lid'],[[49.5,-22],[65.5,-22]],53,69,23,'rod','BLOCKED_KEEP_OUT_INTERFERENCE','Lower nut/washer intersects battery. Module envelope is not populated source CAD.');
  add('arm-holder-and-lid',['control_gantry','arm_cradle','arm_lid'],[[51.5,-22],[63.5,-22]],81,91.4,18,'rod','CONDITIONAL_NOMINAL_ONLY','Install before the regulator/cutoff; engage lower nuts beneath the upper deck. Top washer projects0.5mm beyond lid edge; contact stress unknown.');
  add('stop-bracket-base',['control_gantry','stop_bracket'],[[50.5,22],[64.5,22]],81,87,13,'rod','BLOCKED_KEEP_OUT_INTERFERENCE','Actual floor bearing face isZ87, not box topZ99. Ordinary cap heads atZ87.3..89.3 intersect terminal keepout.');
  add('stop-switch-side',['stop_bracket','stop_body'],[[54.25,92.5],[60.75,92.5]],16,24.8,16,'rod','CONDITIONAL_NOMINAL_ONLY','Coordinates are[X,Z], axisY. Install before other controls for access. Source holes areØ2(+.12/0); nominal M2 is not tolerance-qualified clearance. Manufacturer switch mounting torque0.08–0.1N·m does NOT qualify the printed bracket.','y');
  const base=[
    {id:'brackets',quantity:4,sourceId:'bracket',thread:'#2-56',status:'INCLUDED_SOURCE_HARDWARE_FIT_UNKNOWN'},
    ...[['pico',4,11,16,'screw16'],['microphone',2,11.6,16,'screw16'],['driver-rails',2,10,16,'screw16'],['caster',2,16.454975,20,'screw20']].map(([id,quantity,gripMm,lengthMm,sourceId])=>({id,quantity,sourceId,stack:calculateStack({gripMm,lengthMm}),status:'INHERITED_NOMINAL_STACK_NOT_NATIVE_HARDWARE_QUALIFIED'})),
  ];
  let evidence={status:'NOT_PROVIDED'};
  if(nativeReport){
    if(nativeReport.designHash!==hash||nativeReport.jobId!=='38cebecc-a570-42c1-9f9d-2b09dc306c53'||nativeReport.scope!=='SOURCE_DIMENSIONED_HARDWARE_ENVELOPES_VS_ACTUAL_FROZEN_STEP'||!nativeReport.allPredictionsMatched||nativeReport.records?.length!==34)throw new Error('Native fastener evidence lineage or audit mismatch');
    evidence={status:'READ_ONLY_NATIVE_PROBES_REPORTED',jobId:nativeReport.jobId,cadResultSha256:nativeReport.cadResultSha256,records:structuredClone(nativeReport.records),limit:'Caller must separately verify report/source file hashes. Reported observations do not promote physical status.'};
  }
  const cutRows=added.filter(s=>s.cutLengthMm).map(s=>({id:s.id,quantity:s.quantity,lengthMm:s.cutLengthMm,status:s.status}));
  return {schemaVersion:1,id:FASTENER_REVIEW_ID,designHash:hash,status:'BLOCKED_HARDWARE_KEEP_OUT_INTERFERENCE',physicalStatus:'UNKNOWN',
    sourceDimensions:structuredClone(FASTENER_SOURCES),baseMounts:base,addedMounts:added,nativeEvidence:evidence,
    quantities:{baseLocations:14,addedLocations:18,totalMountLocations:32,baseM2Screws16:8,baseM2Screws20:2,addedM2Screws10:2,cutRodSegments:16,m2Nuts:44,peekWashers:54,includedBracketScrews:4,includedBracketNuts:4,nkkSuppliedPieces:4},
    quantityBoundary:'Exact hypothetical installed schedule for all32 locations, including8 BLOCKED locations; NOT an approved shopping list. Eighteen existing component identities do not include this hardware. Washer purchase unit is100, not54 packs.',
    cutPlan:{sourceSku:FASTENER_SOURCES.rod.sku,rows:cutRows,totalNominalMm:round(cutRows.reduce((s,r)=>s+r.quantity*r.lengthMm,0)),stockLengthMm:1000,
      proposedCutToleranceMm:.2,method:'Cut away from electronics, deburr and gauge each end with a verified matching nut; protect eyes, clamp stock, collect all swarf. Cut tolerance is a proposed acceptance target, not supplier capability. Inspect full nut engagement. No cuts performed.',
      stockPiecesNominal:1,purchaseAuthorized:false,limit:'Reserve cutting loss and damaged ends. Do not fabricate blocked rows before a new assembly revision.'},
    toolAccess:{status:'SEQUENCE_PROPOSAL_NOT_TOOL_SWEEP_PROOF',tools:['1.5mm straight hex key for selected cap screws','4mm nut tool; its outer envelope must be measured','8mm spanner for NKK AT513H; do not grip the lever'],
      sequence:['Remove cells and all power. Preassemble hardware on removable clamp/gantry off the chassis.','Fit base electronics and inspect washer-to-copper/component clearance; source STEP may omit solder/headers.','Do not install the blocked fuse/regulator/guard/STOP-base hardware into r3.','For a separately corrected revision, retain hardware before seating holder; assemble STOP bracket before its switch and the ARM/cutoff, keeping a reverse removal route.','Primary studs can be counter-held from above/below; load is in a narrow printed leg, so no inferred preload torque.'],
      primaryEdgeDistancesMm:{holeRadius:1.15,legWidth:4.5,innerHoleEdge:.85,outerHoleEdge:1.35,topWasherOverhangTowardOpening:.5},
      limit:'Access order is not a verified torque, tool swing, insulation or strength result. Nuts need a qualified anti-loosening method; no adhesive chemistry assumed compatible.'},
    nkkStackReview:{status:'ASSEMBLY_ORDER_REQUIRES_RECONCILIATION',sourcePage:'A62',actualNutThicknessMm:1.5,oldUnverifiedRearAllowanceMm:3,
      lowerOrderCandidateMm:{collar:.9,nut:1.5,lockingRing:.8,total:3.2,available:3,deficit:.2},
      alternatives:['If the ring is below the panel, move the entire source-derived switch group down at least0.2mm plus chosen tolerance in a NEW revision; never scale it.','A top-side locking-ring order may fit axially, but manufacturer installation order/tab orientation and antirotation engagement must first be verified.'],
      limit:'A smaller nut alone does not prove the full stack. No inferred thread substitution or fully tightened fit.'},
    purchasingAuthorized:false,printAuthorized:false,motorOutputAuthorized:false,
  };
}
