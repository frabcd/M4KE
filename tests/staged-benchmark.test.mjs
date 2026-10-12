import test from 'node:test';
import assert from 'node:assert/strict';
import {benchmarkReceipt,compareBenchmarks,runBenchmark} from '../scripts/benchmark-staged-generation.mjs';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createGenerationCheckpointStore,generationIdentity,hashGenerationValue} from '../server/studio-generation-checkpoints.mjs';

test('clarification and partial results cannot claim CAD, preview or current prices',()=>{
  const p={request:'fixture',answers:[],budget:'',workflow:{status:'questions'},pendingQuestions:[{id:'power',question:'Supply voltage?'}]};
  const r=benchmarkReceipt({project:p,checkpoint:null,job:null,elapsedMs:2000});
  assert.equal(r.admission,'NOT_ACCEPTED');assert.equal(r.nativeCad,'NOT_TESTED');assert.equal(r.preview,'NOT_TESTED');assert.equal(r.pricing,'NOT_TESTED');assert.equal(r.questions.length,1);
});
test('comparison refuses different inputs, model identity, source context and nonaccepted results',()=>{
  const a={inputHash:'a',model:{digest:'d'},sourceHash:'s',contextHash:'c',admission:'ACCEPTED',elapsedMs:2000};
  for(const changes of [{inputHash:'b'},{model:{digest:'x'}},{sourceHash:'x'},{contextHash:'x'},{admission:'NOT_ACCEPTED'}])assert.throws(()=>compareBenchmarks(a,{...a,...changes}));
  assert.equal(compareBenchmarks(a,{...a,elapsedMs:4000}).ratio,2);
});
test('receipt separates admitted output from mismatched native and price artifacts',()=>{
  const project={request:'fixture',answers:[],budget:'',designHash:'good',workflow:{status:'draft'},priceSearch:{designHash:'stale'},spec:{parts:[{}],questions:[]}};
  const checkpoint={status:'accepted',protocol:1,identity:{identity:{model:{digest:'d'},sourceHash:'s',schemaHash:'x',skillHash:'y',contextHash:'c'}},reservations:[{evalCount:12,promptEvalCount:34}],units:[]};
  const r=benchmarkReceipt({project,checkpoint,job:{designHash:'stale',status:'complete',cad:{parts:[{}]}},elapsedMs:2000});
  assert.equal(r.admission,'ACCEPTED');assert.equal(r.nativeCad,'NOT_TESTED');assert.equal(r.pricing,'NOT_TESTED');assert.equal(r.calls[0].promptEvalCount,34);
});
test('benchmark refuses execution without explicit coordination and bounded config before any request',async()=>{
  let calls=0;const fetchJson=async()=>{calls++;};
  await assert.rejects(()=>runBenchmark({endpoint:'http://127.0.0.1:4173',fetchJson}),/coordination/);
  await assert.rejects(()=>runBenchmark({coordinated:true,endpoint:'http://127.0.0.1:4173',fetchJson}),/explicit/);
  assert.equal(calls,0);
});
test('collector reads real checkpoint state and refuses a legacy endpoint before run',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'staged-bench-'));const projectId=randomUUID(),context={sources:{catalogIds:[],libraryHashes:[]}};
  const identity=generationIdentity({projectId,request:'fixture',answers:[],budget:'',model:{name:'fixture',digest:'d'},skillHash:'s',sourceHash:'r',schemaHash:'c',contextHash:hashGenerationValue(context)});
  const handle=await createGenerationCheckpointStore({root}).create({projectId,identity,contextSnapshot:context});await handle.finish('questions');
  const project={id:projectId,request:'fixture',answers:[],budget:'',revision:1,pendingQuestions:[{id:'q',question:'Confirm?'}]};let enabled=false,runs=0;
  const fetchJson=async url=>{
    if(url.endsWith('/api/settings'))return {model:'fixture',provider:'ollama'};
    if(url.endsWith('/capabilities'))return {workflow:{stagedGeneration:enabled}};
    if(url.endsWith('/projects'))return {projects:[]};
    throw Error('Unexpected '+url);
  };
  const opts={coordinated:true,endpoint:'http://127.0.0.1:4173',model:'fixture',dataRoot:root,out:path.join(root,'result'),brief:{request:'fixture',answers:[],budget:''},timeoutMs:1000};
  await assert.rejects(()=>runBenchmark({...opts,fetchJson}),/staged/i);assert.equal(runs,0);
  enabled=true;
  const result=await runBenchmark({...opts,fetchJson:async(url,options)=>{
    if(url.endsWith('/projects')&&options.method==='POST'){await mkdir(path.join(root,'data/studio-projects'));await writeFile(path.join(root,'data/studio-projects',projectId+'.json'),JSON.stringify(project));return project;}
    if(url.endsWith('/run')){runs++;return {...project,workflow:{id:randomUUID(),generationId:handle.id,status:'questions'}};}
    return fetchJson(url,options);
  }});
  assert.equal(result.admission,'NOT_ACCEPTED');assert.equal(result.model.digest,'d');assert.equal(runs,1);
});
