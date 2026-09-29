import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesignSpec,designHash,verifyDesign} from '../server/studio-contract.mjs';
import {DESIGN_JSON_SCHEMA} from '../server/studio-schema.mjs';

const fixture=()=>({schemaVersion:1,title:'Integral stand',description:'Bounded test, no physical claim',units:'mm',requirements:[{id:'R1',text:'One printed stand'}],assumptions:[],unknowns:[],questions:[],parts:[{id:'stand',name:'Stand',kind:'printed',material:'PLA',color:'#123456',shape:{type:'union',solids:[{type:'box',size:[40,30,8],position:[0,0,0],rotation:[0,0,0]},{type:'cylinder',radius:5,height:30,position:[0,0,17],rotation:[0,0,0]}]},position:[0,0,4],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['stand'],requires:[],instructions:['Inspect after printing'],checks:['Physical fit remains untested']} ]});
test('printed union canonicalizes without mutating input or claiming connected/functional proof',()=>{
 const s=fixture(),before=JSON.stringify(s),clean=validateDesignSpec(s);assert.equal(JSON.stringify(s),before);assert.deepEqual(clean.parts[0].shape,s.parts[0].shape);
 assert.equal(verifyDesign(s).overall,'UNVERIFIED');const prior=designHash(s);s.parts[0].shape.solids[1].position[2]++;assert.notEqual(designHash(s),prior);
});
test('union members have strict cardinality/types/finite frames, no recursion/catalog/code/purchased shape',()=>{
 for(const edit of [p=>p.kind='purchased',p=>p.shape.solids.pop(),p=>p.shape.solids=Array(9).fill(p.shape.solids[0]),p=>p.shape.solids[0].type='union',p=>p.shape.solids[0].type='catalog',p=>p.shape.solids[0].code='execute()',p=>p.shape.solids[0].rotation=[0,Infinity,0],p=>p.shape.solids[0].position=[251,0,0],p=>p.shape.solids[0].radius=3,p=>p.fillet=4]){const s=fixture();edit(s.parts[0]);assert.throws(()=>validateDesignSpec(s));}
 const rule=DESIGN_JSON_SCHEMA.properties.parts.items.properties.shape.anyOf.find(x=>x.properties.type.enum[0]==='union');assert.equal(rule.properties.solids.maxItems,8);assert.equal(rule.properties.solids.minItems,2);assert.equal(rule.properties.solids.items.anyOf.length,2);
});
test('legacy primitive canonical bytes remain stable',()=>{
 const s=fixture();s.parts[0].shape={type:'box',size:[40,30,8]};const v=validateDesignSpec(s);
 assert.deepEqual(Object.keys(v.parts[0].shape),['type','size']);assert.equal('solids' in v.parts[0].shape,false);
 assert.equal(designHash(s),designHash(v));
});
