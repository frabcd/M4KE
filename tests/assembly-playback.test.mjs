import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyFrame,assemblyOffset} from '../src/viewport/assembly-playback.mjs';
const parts=['base','motor','cover'].map(id=>({id}));
const steps=[{id:'base',partIds:['base'],requires:[]},{id:'motor',partIds:['base','motor'],requires:['base']},{id:'cover',partIds:['cover'],requires:['motor']},{id:'check',partIds:['base','motor','cover'],requires:['cover']}];
test('tutorial follows prerequisite closure without moving already assembled parts',()=>{
  const before=JSON.stringify({parts,steps});
  assert.deepEqual(assemblyFrame(steps,parts,'motor',0),{stepId:'motor',settledIds:['base'],activeIds:['base','motor'],movingIds:['motor'],progress:0});
  assert.deepEqual(assemblyFrame(steps,parts,'check',1).movingIds,[]);
  assert.equal(JSON.stringify({parts,steps}),before);
});
test('tutorial rejects missing or cyclic dependencies and unknown geometry',()=>{
  assert.throws(()=>assemblyFrame(steps,parts,'absent'),/missing/);
  assert.throws(()=>assemblyFrame([{id:'x',partIds:[],requires:['x']}],parts,'x'),/cycle/);
  assert.throws(()=>assemblyFrame([{id:'x',partIds:[],requires:['y']}],parts,'x'),/prerequisite missing/);
  assert.throws(()=>assemblyFrame([{id:'x',partIds:['absent'],requires:[]}],parts,'x'),/part missing/);
});
test('illustrative motion clamps progress, ends exactly at design position and has no overshoot',()=>{
  assert.equal(assemblyOffset(0,60),60);assert.equal(assemblyOffset(1,60),0);
  assert.equal(assemblyOffset(NaN,60),0);assert.equal(assemblyOffset(-1,60),60);
  const values=Array.from({length:101},(_,i)=>assemblyOffset(i/100,60));
  assert(values.every((n,i)=>n>=0&&n<=60&&(!i||n<=values[i-1])));
});
