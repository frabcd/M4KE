import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesignSpec,designHash,verifyDesign} from '../server/studio-contract.mjs';
import {validateRepair} from '../server/studio-repair.mjs';
import {buildModelRepairSchema,applyModelRepair} from '../server/studio-model-repair.mjs';
import {validateGenerationPlan,partitionGeneration,assembleGeneration,validateGenerationUnit} from '../server/studio-generation-stages.mjs';
import {plan,readiness,payload} from './helpers/staged-generation-fixture.mjs';
import {Euler,Matrix4} from 'three';

const frame=(id,position=[0,0,0],rotation=[0,0,0])=>({id,position,rotation});
export function parametricFixture(){return {
 schemaVersion:1,geometryVersion:2,title:'Geometry contract fixture',description:'Hand-authored regression, not model performance',units:'mm',
 requirements:[{id:'R1',text:'Cap contacts the top datum'}],assumptions:[],unknowns:[],questions:[],
 parts:[
 {id:'base',name:'Base',kind:'printed',material:'PLA',color:'#808080',shape:{type:'box',size:[30,30,6]},position:[0,0,0],rotation:[0,0,0],datums:[frame('top',[0,0,3])]},
 {id:'cap',name:'Cap',kind:'printed',material:'PLA',color:'#808080',shape:{type:'profileExtrusion',points:[[-5,-5],[5,-5],[5,5],[-5,5]],height:6},position:[99,99,99],rotation:[0,0,0],datums:[frame('bottom')]}
 ],
 placement:{version:1,roots:[{partId:'base',reason:'Assembly reference'}],attachments:[{id:'join',requirementId:'R1',parentId:'base',parentDatum:'top',childId:'cap',childDatum:'bottom',offset:{position:[0,0,0],rotation:[0,0,0]},verification:{type:'contact',maxGapMm:.01,maxIntersectionMm3:.001}}]},
 assembly:[{id:'assemble',title:'Assemble',partIds:['base','cap'],requires:[],instructions:['Align declared datums'],checks:['Measure contact']}]};}

test('v2 resolves a declared child after geometry without mutating the submitted design',()=>{
 const raw=parametricFixture(),snapshot=structuredClone(raw),spec=validateDesignSpec(raw);
 assert.deepEqual(spec.parts[1].position,[0,0,3]);assert.deepEqual(raw,snapshot);
 assert.deepEqual(validateDesignSpec(spec),spec);assert.equal(designHash(spec),designHash(raw));
 raw.parts[0].shape.size[2]=10;raw.parts[0].datums[0].position[2]=5;
 assert.deepEqual(validateDesignSpec(raw).parts[1].position,[0,0,5]);assert.notEqual(designHash(raw),designHash(spec));
});
test('v2 accepts a compatible bounded loft and rejects crossed profiles and mismatched winding',()=>{
 const raw=parametricFixture();raw.parts[1].shape={type:'profileLoft',sections:[{z:0,points:[[-5,-5],[5,-5],[5,5],[-5,5]]},{z:20,points:[[-3,-3],[3,-3],[3,3],[-3,3]]}]};
 assert.equal(validateDesignSpec(raw).parts[1].shape.type,'profileLoft');
 raw.parts[1].shape.sections[1].points.reverse();assert.throws(()=>validateDesignSpec(raw),/winding/);
 raw.parts[1].shape={type:'profileExtrusion',points:[[0,0],[3,3],[0,3],[3,0]],height:5};assert.throws(()=>validateDesignSpec(raw),/profile/);
});
test('v2 graph rejects missing datum, cycles, unbound parts, conflicting parents and unknown requirement',()=>{
 for(const [edit,pattern] of [
  [s=>s.placement.attachments[0].parentDatum='missing',/datum/],
  [s=>s.placement.roots=[],/root/],
  [s=>s.placement.attachments=[],/unbound/],
  [s=>s.placement.attachments.push({...s.placement.attachments[0],id:'second'}),/parent/],
  [s=>s.placement.attachments[0].requirementId='missing',/requirement/],
 ]){const s=parametricFixture();edit(s);assert.throws(()=>validateDesignSpec(s),pattern);}
});
test('v2 cannot silently downgrade or weaken relationship checks during automatic repair',()=>{
 const s=parametricFixture(),next=structuredClone(s);next.placement.attachments[0].verification.maxGapMm=.1;
 assert.throws(()=>validateRepair(s,next),/placement|attachment/);
 const old=structuredClone(s);delete old.geometryVersion;assert.throws(()=>validateDesignSpec(old),/geometryVersion/);
});
test('targeted datum repair recalculates descendants while preserving attachment checks',()=>{
 const s=parametricFixture();assert.doesNotThrow(()=>buildModelRepairSchema(s));
 const next=applyModelRepair(s,{updates:[{partId:'base',changes:{shape:{type:'box',size:[30,30,10]},datums:[frame('top',[0,0,5])]}}]});
 assert.deepEqual(next.parts[1].position,[0,0,5]);assert.deepEqual(next.placement,s.placement);
});
test('v1 retains its historical structure and hash normalization',()=>{
 const s=parametricFixture();delete s.geometryVersion;delete s.placement;for(const p of s.parts)delete p.datums;s.parts[1].shape={type:'box',size:[10,10,6]};
 const clean=validateDesignSpec(s);assert.ok(!('geometryVersion'in clean));assert.equal(designHash(clean),designHash(s));
});
test('a current-hash native report cannot omit declared attachment evidence',()=>{
 const s=validateDesignSpec(parametricFixture());const report=verifyDesign(s,{revisionHash:designHash(s),parts:[],checks:[]});
 assert.equal(report.claims.find(c=>c.id==='attachment-evidence-join')?.status,'UNKNOWN');
});
test('composite frames agree independently with Three XYZ rotation and reject cyclic subassemblies',()=>{
 const s=parametricFixture();s.parts[0].rotation=[15,25,40];s.parts[0].position=[12,-8,5];
 const resolved=validateDesignSpec(s),p=resolved.parts[1].position;
 const expected=[12+3*Math.sin(25*Math.PI/180),-8-3*Math.sin(15*Math.PI/180)*Math.cos(25*Math.PI/180),5+3*Math.cos(15*Math.PI/180)*Math.cos(25*Math.PI/180)];
 assert.ok(p.every((v,i)=>Math.abs(v-expected[i])<1e-8));assert.deepEqual(validateDesignSpec(resolved),resolved);
 s.parts.push({...structuredClone(s.parts[1]),id:'loose'});s.assembly[0].partIds.push('loose');
 s.placement.roots=[{partId:'base',reason:'Reference'}];Object.assign(s.placement.attachments[0],{parentId:'loose',parentDatum:'bottom'});
 s.placement.attachments.push({...structuredClone(s.placement.attachments[0]),id:'cycle',parentId:'cap',childId:'loose'});
 assert.throws(()=>validateDesignSpec(s),/cyclic/);
});

test('near-gimbal and exact-gimbal rotations preserve the original orientation',()=>{
 for(const pitch of [89.99,89.999999,-89.99,90,-90]){
  const s=parametricFixture();s.parts[0].rotation=[30,pitch,40];s.parts[0].datums[0].position=[0,0,0];
  const child=validateDesignSpec(s).parts[1];
  const matrix=r=>new Matrix4().makeRotationFromEuler(new Euler(...r.map(x=>x*Math.PI/180),'XYZ')).elements;
  const a=matrix(s.parts[0].rotation),b=matrix(child.rotation);
  assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-9),`orientation lost at pitch ${pitch}: ${child.rotation}`);
 }
});

test('composed near-singular frames remain within the native orientation tolerance',()=>{
 for(const pitch of [89.99999999,89.9999999999,-89.99999999,-89.9999999999]){
  const s=parametricFixture();s.parts[0].rotation=[30,pitch,40];s.parts[0].datums[0].position=[0,0,0];
  s.parts[0].datums[0].rotation=[13,27,58];s.parts[1].datums[0].rotation=[13,27,58];
  const child=validateDesignSpec(s).parts[1],matrix=r=>new Matrix4().makeRotationFromEuler(new Euler(...r.map(x=>x*Math.PI/180),'XYZ')).elements;
  const a=matrix(s.parts[0].rotation),b=matrix(child.rotation);
  assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-7),`composed orientation lost at ${pitch}: ${child.rotation}`);
 }
});
test('staged v2 preserves declared topology but obtains datum coordinates from the completed geometry units',()=>{
 const p=plan(2);p.geometryVersion=2;p.placement=parametricFixture().placement;
 p.placement.roots[0].partId='p0';Object.assign(p.placement.attachments[0],{parentId:'p0',childId:'p1'});
 p.parts[0].datumIds=['top'];p.parts[1].datumIds=['bottom'];p.parts[1].identity={type:'profileExtrusion'};
 const checked=validateGenerationPlan(p,{readiness:readiness()});const records=[];
 for(const u of partitionGeneration(checked)){const v=payload(checked,u);if(u.kind==='part')for(const part of v.items){part.datums=[frame(part.id==='p0'?'top':'bottom',part.id==='p0'?[0,0,5]:[0,0,0])];if(part.id==='p1')part.shape=parametricFixture().parts[1].shape;}
   records.push({key:u.key,status:'UNIT_VALIDATED',payload:validateGenerationUnit(checked,u,v,records)});}
 const spec=validateDesignSpec(assembleGeneration(checked,records));assert.deepEqual(spec.parts[1].position,[0,0,5]);assert.equal(spec.geometryVersion,2);
});
