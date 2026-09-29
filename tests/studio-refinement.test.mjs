import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {applyRefinementResponse,buildRefinementSchema,buildRefinementMessages,generateRefinement,refinementProvenance,refinementEffects} from '../server/studio-refinement.mjs';
import {designHash,validateDesignSpec} from '../server/studio-contract.mjs';

const explanation={purpose:'Protect the mechanism',placementReason:'Proposed central shell',selectionReason:'PLA prototype; physical fit untested'};
const sample=()=>({schemaVersion:1,title:'Shell',description:'Concept',units:'mm',requirements:[{id:'R1',text:'PLA shell'}],assumptions:['Nominal geometry'],unknowns:['Physical fit'],questions:[],parts:[{id:'shell',name:'Shell',kind:'printed',material:'PLA',color:'#ffffff',shape:{type:'box',size:[40,30,4]},position:[0,0,0],rotation:[0,0,0],explanation}],assembly:[{id:'inspect',title:'Inspect',partIds:['shell'],requires:[],instructions:['Measure'],checks:['Compare']}],verificationRequests:[{id:'envelope',requirementId:'R1',type:'envelope',partIds:['shell'],maxSizeMm:[50,40,5]}]});
const patch=()=>({action:'patch',message:'I propose changing display colour only.',updates:[{partId:'shell',reason:'Requested blue; not purchased pigment.',changes:{color:'#0000ff'}}],questions:[]});

test('legacy explanation is constrained at decoding, and geometry effects are distinct from colour',()=>{
  const s=sample();delete s.parts[0].explanation;
  assert.deepEqual(buildRefinementSchema(s).properties.updates.items.anyOf[0].properties.changes.required,['explanation']);
  const after=structuredClone(sample());after.parts[0].fillet=.5;
  assert.deepEqual(refinementEffects(sample(),after),[{partId:'shell',geometry:['fillet'],placement:[],appearance:[]}]);
  after.parts[0].fillet=undefined;after.parts[0].explanation.purpose='New prose';
  assert.deepEqual(refinementEffects(sample(),after),[]);
});

test('refinement provenance can never be counted as fresh model-generated geometry',()=>{
  assert.deepEqual(refinementProvenance({generationMode:'full-design'}),{});
  const result=refinementProvenance({generationMode:'model-user-refinement',parentDesignHash:'a'.repeat(64)});
  assert.equal(result.origin,'local-qwen-refinement');assert.equal(result.modelGenerationVerified,false);assert.equal(result.modelRefinementVerified,true);assert.equal(result.parentDesignHash,'a'.repeat(64));
  assert.throws(()=>refinementProvenance({generationMode:'model-user-refinement'}),/parent design hash/);
});

test('colour edits preserve all geometry, checks, source input and original hash until confirmation',()=>{
  const s=sample(),before=JSON.stringify(s),reply=applyRefinementResponse(s,patch());
  assert.equal(JSON.stringify(s),before);assert.equal(reply.spec.parts[0].color,'#0000FF');
  const expected=validateDesignSpec(s);expected.parts[0].color='#0000FF';assert.deepEqual(reply.spec,expected);
  assert.notEqual(designHash(reply.spec),designHash(s));assert.match(reply.message,/not purchased/);
});

test('refinement rejects unsupported fields, stale IDs, no-ops and duplicate updates',()=>{
  for(const mutation of [p=>p.updates[0].changes.requirements=[],p=>p.updates[0].partId='invented',p=>p.updates[0].changes.color='#ffffff',p=>p.updates.push(structuredClone(p.updates[0])),p=>p.updates[0].reason='',p=>p.updates[0].changes.shape={type:'library',sourceSha256:'a'.repeat(64)}]){
    const p=patch();mutation(p);assert.throws(()=>applyRefinementResponse(sample(),p));
  }
  const p=patch();Object.defineProperty(p.updates[0].changes,'shape',{get(){throw new Error('Must not execute');},enumerable:true});assert.throws(()=>applyRefinementResponse(sample(),p),/accessor/);
});

test('catalog, purchased and printed-library identities and appearances are immutable in compact edits',()=>{
  for(const part of [{kind:'purchased',shape:{type:'box',size:[40,30,4]}},{kind:'printed',shape:{type:'library',sourceSha256:'a'.repeat(64)}}]){
    const s=sample();Object.assign(s.parts[0],part);
    assert.throws(()=>applyRefinementResponse(s,patch()),/unsupported/);
    const p=patch();p.updates[0].changes={position:[10,0,0]};assert.equal(applyRefinementResponse(s,p).spec.parts[0].position[0],10);
    p.updates[0].changes={shape:{type:'box',size:[41,30,4]}};assert.throws(()=>applyRefinementResponse(s,p),/unsupported/);
    const schema=buildRefinementSchema(s);assert.deepEqual(Object.keys(schema.properties.updates.items.anyOf[0].properties.changes.properties),['position','rotation','explanation']);
  }
});

test('legacy changed parts need new recorded candidate explanations, not fabricated historical intent',()=>{
  const s=sample();delete s.parts[0].explanation;
  assert.throws(()=>applyRefinementResponse(s,patch()),/include explanation/);
  const p=patch();p.updates[0].changes.explanation=explanation;
  assert.equal(applyRefinementResponse(s,p).spec.parts[0].explanation.purpose,explanation.purpose);assert.equal(s.parts[0].explanation,undefined);
});

test('essential questions contain no candidate; full redesign remains an explicit available route',()=>{
  const s=sample(),question={action:'questions',message:'Which clearance?',updates:[],questions:[{id:'clearance',question:'What clearance is required?',options:['1 mm','2 mm']}]};
  const result=applyRefinementResponse(s,question);assert.deepEqual(result.spec.parts,[]);assert.equal(result.spec.questions.length,1);
  assert.throws(()=>applyRefinementResponse(s,{...question,updates:patch().updates}),/must not include/);
  const full=applyRefinementResponse(s,{action:'redesign',message:'The requested new support needs a full candidate and assembly update.',updates:[],questions:[]});assert.equal(full.action,'redesign');assert.equal(full.spec,undefined);
  assert.throws(()=>applyRefinementResponse(s,{...patch(),action:'redesign'}),/partial patch/);
});

test('latest user request and frozen selection follow role-aware history',()=>{
  const project={spec:sample(),request:'Shell',answers:[],budget:'600 CNY'},context={selectedPartIds:['shell'],revision:2,designHash:designHash(project.spec)};
  const messages=buildRefinementMessages({project,context,message:'Make it blue',history:[{role:'user',message:'Why?'},{role:'assistant',message:'Explanation.'}],skill:'Runtime contract'});
  assert.deepEqual(messages.map(m=>m.role),['system','user','assistant','user']);const data=JSON.parse(messages.at(-1).content);assert.equal(data.message,'Make it blue');assert.deepEqual(data.selectedPartContext,context);
  assert.equal(data.brief.budget,'600 CNY');assert.equal(messages[2].content,JSON.stringify({message:'Explanation.'}));
});

test('bounded retry keeps failed model patch, exact parent and accepted full hash without mutating input',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-refinement-')),spec=sample(),before=JSON.stringify(spec),calls=[];
  try{
    const result=await generateRefinement({root,project:{id:'fixture',revision:3,request:'Shell',spec},context:{selectedPartIds:['shell']},message:'Blue',history:[],settings:{endpoint:'http://127.0.0.1:11434',model:'fixture'},installed:{digest:'fixture'},skills:{refine:'Contract',hashes:{refine:'fixture'}},inspect:()=>[],infer:async(_url,_route,opts)=>{
      calls.push(JSON.parse(opts.body));const p=patch();if(calls.length===1)p.updates[0].partId='missing';return {message:{content:JSON.stringify(p)},done_reason:'stop',eval_count:70};
    }});
    assert.equal(calls.length,2);assert.equal(calls[0].options.num_predict,3000);assert.equal(JSON.stringify(spec),before);
    const retry=JSON.parse(calls[1].messages.at(-1).content);assert.match(retry.validationErrors[0],/unknown/);assert.equal(retry.failedReply.updates[0].partId,'missing');
    const record=JSON.parse(await readFile(path.join(root,'data/design-runs',result.metrics.runId+'.json'),'utf8'));
    assert.equal(record.status,'accepted');assert.equal(record.generationMode,'model-user-refinement');assert.equal(record.parentDesignHash,designHash(spec));assert.equal(record.designHash,designHash(result.spec));assert.equal(record.attempts.length,2);
    assert.deepEqual(record.selectedPartIds,['shell']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('truncated model responses and new deterministic failures never become candidates',async()=>{
  for(const truncated of [true,false]){
    const root=await mkdtemp(path.join(tmpdir(),'m4ke-refinement-reject-'));let count=0;
    try{
      await assert.rejects(generateRefinement({root,project:{id:'fixture',revision:1,request:'Shell',spec:sample()},context:{selectedPartIds:[]},message:'Blue',settings:{endpoint:'http://127.0.0.1:11434',model:'fixture'},installed:{},skills:{refine:'Contract',hashes:{}},inspect:()=>['New geometry failure'],infer:async()=>{count++;return {message:{content:JSON.stringify(patch())},done_reason:truncated?'length':'stop'};}}),/bounded attempts/);
      assert.equal(count,2);const files=await readdir(path.join(root,'data/design-runs'));const record=JSON.parse(await readFile(path.join(root,'data/design-runs',files[0]),'utf8'));assert.equal(record.status,'rejected');assert.equal(record.designHash,null);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});
