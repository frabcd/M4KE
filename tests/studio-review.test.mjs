import test from 'node:test';
import assert from 'node:assert/strict';
import {runAdvisoryReview,validateAdvisory,compactReviewContext,reviewSchema} from '../server/studio-review.mjs';
const spec={title:'Fixture',description:'Fixture only',units:'mm',requirements:[{id:'R1',text:'Physical function'},{id:'R2',text:'Source geometry'}],assumptions:['Nominal voltage only'],unknowns:['No bench test'],parts:[],assembly:[],physicsInputs:{}};
const report={revisionHash:'hash',overall:'UNVERIFIED',physical:'UNKNOWN',claims:[{id:'shape',status:'PASS',critical:true},{id:'physical',label:'Physical behavior',status:'UNKNOWN',critical:true,observed:'No test',details:'Not measured'}],limitations:['Not a physical test']};
const skills={design:'Design skill bytes',verify:'Original review skill bytes: do not override host statuses',dyson:'Dyson-inspired skill',hashes:{verify:'hash'}};
const valid=()=>({summary:'Advisory only: physical evidence remains missing.',concerns:[{requirementId:'R1',severity:'critical',problem:'Physical behavior is untested.',suggestedTest:'Measure behavior under declared conditions.',missingEvidence:['Recorded bench observations']}]});
const args=infer=>({spec,report,skills,model:'local-model',endpoint:'http://127.0.0.1:11434',infer});

test('review schema is small and omits expensive maxLength/pattern string grammar',()=>{
  const schema=reviewSchema(spec);assert.equal(schema.properties.concerns.maxItems,6);
  assert.deepEqual(schema.properties.concerns.items.properties.requirementId.enum,['R1','R2']);
  assert.ok(!JSON.stringify(schema).includes('maxLength'));assert.ok(!JSON.stringify(schema).includes('pattern'));
});

test('compact context preserves every requirement and every host check id/status',()=>{
  const context=compactReviewContext(spec,report);
  assert.deepEqual(context.spec.requirements,spec.requirements);
  assert.deepEqual(context.report.checkIndex.map(c=>[c.id,c.status]),report.claims.map(c=>[c.id,c.status]));
  assert.equal(context.report.unresolvedChecks.length,1);assert.equal(context.report.physical,'UNKNOWN');
});

test('valid advisory retains raw output/metrics without mutating source evidence',async()=>{
  const before=JSON.stringify(report);let calls=0;
  const result=await runAdvisoryReview(args(async(endpoint,path,init,timeout)=>{
    calls++;const body=JSON.parse(init.body);assert.equal(path,'/api/chat');assert.equal(timeout,120000);
    assert.equal(body.think,false);assert.match(body.messages[0].content,/Original review skill bytes/);
    return {message:{content:JSON.stringify(valid())},eval_count:123,prompt_eval_count:456,done_reason:'stop'};
  }));
  assert.equal(result.status,'advisory');assert.equal(calls,1);assert.equal(result.attempts[0].metrics.eval_count,123);
  assert.equal(result.attempts[0].raw,JSON.stringify(valid()));assert.equal(result.structuredConcerns[0].requirementId,'R1');
  assert.equal(typeof result.concerns[0],'string');assert.equal(result.doesNotChangeEvidence,true);
  assert.equal(result.physical,'UNKNOWN');assert.equal(JSON.stringify(report),before);
});

test('truncation triggers one bounded concise retry; initial raw failure is retained',async()=>{
  let calls=0;
  const result=await runAdvisoryReview(args(async(endpoint,path,init)=>{
    calls++;const body=JSON.parse(init.body);
    if(calls===1)return {message:{content:'{"summary":"cut'},done_reason:'length',eval_count:1800};
    assert.equal(body.format.properties.concerns.maxItems,3);assert.equal(body.options.num_predict,2400);
    assert.match(body.messages.at(-1).content,/shorter complete JSON/);
    return {message:{content:JSON.stringify(valid())},done_reason:'stop'};
  }));
  assert.equal(result.status,'advisory');assert.equal(calls,2);assert.equal(result.attempts.length,2);
  assert.match(result.attempts[0].error,/truncated/);assert.equal(result.attempts[0].raw,'{"summary":"cut');
});

test('host rejects wrong ids, missing evidence, severity and status override fields',()=>{
  for(const mutate of [v=>v.concerns[0].requirementId='invented',v=>v.concerns[0].severity='PASS',v=>v.concerns[0].missingEvidence=[],v=>v.concerns[0].status='PASS',v=>v.status='VERIFIED',v=>v.concerns[0].problem='x'.repeat(421)]){
    const value=valid();mutate(value);assert.throws(()=>validateAdvisory(value,spec));
  }
  assert.throws(()=>validateAdvisory({...valid(),concerns:Array(7).fill(valid().concerns[0])},spec));
});

test('two invalid or unavailable attempts return unavailable, never fake advisory success',async()=>{
  let calls=0;const result=await runAdvisoryReview(args(async()=>{calls++;throw new Error('Local model timed out');}));
  assert.equal(calls,2);assert.equal(result.status,'unavailable');assert.equal(result.attempts.length,2);
  assert.ok(result.attempts.every(a=>a.error.includes('timed out')));
  const empty=await runAdvisoryReview(args(async()=>({message:{content:JSON.stringify({summary:'Nothing to do',concerns:[]})}})));
  assert.equal(empty.status,'unavailable');assert.match(empty.attempts[0].error,/critical/);
  const missing=await runAdvisoryReview({...args(()=>{throw Error('must not call');}),endpoint:''});
  assert.equal(missing.status,'unavailable');assert.equal(missing.attempts.length,0);
});
