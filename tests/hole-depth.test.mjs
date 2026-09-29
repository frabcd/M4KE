import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesignSpec,designHash} from '../server/studio-contract.mjs';
import {OLLAMA_DESIGN_SCHEMA} from '../server/studio-schema.mjs';
import {applyModelRepair,buildModelRepairSchema} from '../server/studio-model-repair.mjs';
import {geometryIntentIssues} from '../server/studio-generation-diagnostics.mjs';

const bore=(diameter=4,depth,center=0)=>({axis:'z',diameter,position:[0,0,center],...(depth===undefined?{}:{depth})});
const design=(holes=[bore()])=>({schemaVersion:1,title:'Bore regression',description:'Synthetic test fixture',units:'mm',requirements:[{id:'R1',text:'Preserve the bore floor.'}],assumptions:[],unknowns:[],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#808080',shape:{type:'box',size:[20,20,20]},position:[0,0,0],rotation:[0,0,0],holes}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Inspect the bore.'],checks:['Measure its depth.']}]});
test('optional depth survives host validation, hash and model repair',()=>{
 const original=design(),candidate=applyModelRepair(original,{updates:[{partId:'body',changes:{holes:[bore(4,5,7.5)]}}]});
 assert.equal(candidate.parts[0].holes[0].depth,5);
 assert.notEqual(designHash(candidate),designHash(original));
 assert.equal(Object.hasOwn(original.parts[0].holes[0],'depth'),false);
 assert.deepEqual(candidate.requirements,original.requirements);
});
test('legacy holes receive no depth default or canonical mutation',()=>{
 const original=design();assert.deepEqual(validateDesignSpec(original),original);
 assert.equal(designHash(validateDesignSpec(original)),designHash(original));
});
test('initial and repair grammars expose optional bounded depth',()=>{
 const hole=OLLAMA_DESIGN_SCHEMA.properties.parts.items.properties.holes.items;
 assert.deepEqual(hole.properties.depth,{type:'number',minimum:0.5,maximum:500});
 assert(!hole.required.includes('depth'));
 const schema=buildModelRepairSchema(design());
 assert.deepEqual(schema.properties.updates.items.anyOf[0].properties.changes.properties.holes.items,hole);
});
test('depth must be finite millimetres within the bounded grammar',()=>{
 for(const d of [0,-1,.49,501,true,null,'5',NaN,Infinity])assert.throws(()=>validateDesignSpec(design([bore(4,d)])),/depth/);
 for(const d of [.5,500])assert.equal(validateDesignSpec(design([bore(4,d)])).parts[0].holes[0].depth,d);
});
test('counterbore plus smaller through bore is permitted in either order',()=>{
 const holes=[bore(10,5,7.5),bore(4)];
 for(const list of [holes,[...holes].reverse()])assert.deepEqual(geometryIntentIssues(design(list)),[]);
});
test('coaxial blind cuts may occupy disjoint or partially overlapping axial intervals',()=>{
 for(const center of [-7.5,5])assert.deepEqual(geometryIntentIssues(design([bore(4,5,7.5),bore(4,5,center)])),[]);
});
test('a cut contained both radially and axially still fails preflight',()=>{
 for(const holes of [[bore(10),bore(4,5,7.5)],[bore(10,10,5),bore(4,5,5)],[bore(10),bore(4,undefined,200)]])assert.match(geometryIntentIssues(design(holes)).join('\n'),/hole 1.*contained/);
});
