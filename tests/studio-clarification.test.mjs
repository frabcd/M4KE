import test from 'node:test';
import assert from 'node:assert/strict';
import {clarificationFromDraft} from '../server/studio-clarification.mjs';

const reply = () => ({schemaVersion:1,title:'Clarify toy',description:'Please confirm the interface.',units:'mm',requirements:[{id:'R1',text:'Keep the requested toy'}],assumptions:[],unknowns:['Unverified supplier interface'],questions:[{id:'supply',question:'Which exact source?',options:['Specify its rating','Keep the source unresolved']}],parts:[{invalid:'premature geometry'}],assembly:[{partIds:['missing']}],electrical:{invalid:'premature circuit'},physicsInputs:{invalid:1},verificationRequests:[{invalid:true}],buildItems:[{invalid:true}]});

test('mixed response becomes questions, never an accepted design or evidence',()=>{
  const raw=reply(),before=JSON.stringify(raw),result=clarificationFromDraft(raw);
  assert.deepEqual(result.spec.questions,raw.questions);
  assert.deepEqual(result.spec.parts,[]);assert.deepEqual(result.spec.assembly,[]);
  assert.deepEqual(result.discardedFields,['parts','assembly','electrical','physicsInputs','verificationRequests','buildItems']);
  for(const key of ['electrical','physicsInputs','verificationRequests','buildItems'])assert(!(key in result.spec));
  assert.equal(JSON.stringify(raw),before);
});
test('normal design is not rewritten by the clarification channel',()=>{
  assert.equal(clarificationFromDraft({...reply(),questions:[]}),null);
});
test('question validation cannot be bypassed by dropping geometry',()=>{
  assert.throws(()=>clarificationFromDraft({...reply(),questions:[{id:'bad id',question:'Question'}]}));
  assert.throws(()=>clarificationFromDraft({...reply(),questions:[{id:'q',question:'Question',options:['only one']}]}));
  assert.throws(()=>clarificationFromDraft({...reply(),questions:Array.from({length:4},(_,i)=>({id:'q'+i,question:'Question'}))}),/at most three/);
  assert.throws(()=>clarificationFromDraft({...reply(),requirements:[]}));
});
