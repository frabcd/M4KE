import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesignSpec,verifyDesign,designHash} from '../server/studio-contract.mjs';
import {validateRepair} from '../server/studio-repair.mjs';
import {buildModelRepairSchema} from '../server/studio-model-repair.mjs';
const sha='a'.repeat(64);
const spec=kind=>({schemaVersion:1,title:'Source import',description:'Geometry test',units:'mm',requirements:[{id:'R1',text:'Preserve original dimensions'}],assumptions:[],unknowns:['Physical fit is unverified'],questions:[],parts:[{id:'component',name:'Exact source',kind,material:'Unknown',color:'#808080',shape:{type:'library',sourceSha256:sha},position:[10,20,30],rotation:[0,0,90]}],assembly:[{id:'attach',title:'Inspect',partIds:['component'],requires:[],instructions:['Inspect source'],checks:['Verify origin']}]});
test('native library shape is accepted for purchased source references',()=>assert.deepEqual(validateDesignSpec(spec('purchased')).parts[0].shape,{type:'library',sourceSha256:sha}));
test('single-solid printable source can use the same identity contract',()=>assert.equal(validateDesignSpec(spec('printed')).parts[0].kind,'printed'));
test('no caller path, scale, truncated hash or geometry edits',()=>{
 for(const extra of [{path:'/tmp/a.step'},{scale:2},{sourceSha256:'a'.repeat(16)},{sourceSha256:'A'.repeat(64)}]){const s=spec('purchased');Object.assign(s.parts[0].shape,extra);assert.throws(()=>validateDesignSpec(s));}
 for(const extra of [{fillet:0},{holes:[]},{pockets:[]}]){const s=spec('purchased');Object.assign(s.parts[0],extra);assert.throws(()=>validateDesignSpec(s));}
});
test('printed library geometry stays immutable through repairs while pose edits remain supported',()=>{
 const original=spec('printed'),next=structuredClone(original);next.parts[0].position[0]+=2;
 assert.doesNotThrow(()=>validateRepair(original,next));
 for(const shape of [{type:'box',size:[1,2,3]},{type:'library',sourceSha256:'b'.repeat(64)}]){const changed=structuredClone(original);changed.parts[0].shape=shape;assert.throws(()=>validateRepair(original,changed),/source catalog/);}
 const variants=buildModelRepairSchema(original).properties.updates.items.anyOf;
 assert.equal(variants.length,1);assert.deepEqual(Object.keys(variants[0].properties.changes.properties),['position','rotation']);
});
test('purchased library multisolid acceptance never weakens one-solid printed gates or claims physical success',()=>{
 for(const kind of ['purchased','printed']){
  const s=spec(kind),report=verifyDesign(s,{revisionHash:designHash(s),parts:[{id:'component',valid:true,solidCount:2,volumeMm3:10}],errors:[]});
  assert.equal(report.claims.find(c=>c.id==='cad-solids').status,kind==='printed'?'FAIL':'PASS');
  assert.equal(report.physical,'UNKNOWN');assert.notEqual(report.overall,'VERIFIED_WITHIN_SCOPE');
 }
});
