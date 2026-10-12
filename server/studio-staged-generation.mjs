import {performance} from 'node:perf_hooks';
import {parseGenerationJson} from './studio-generation-json.mjs';
import {READINESS_SCHEMA,PLAN_SCHEMA,validateReadiness,validateGenerationPlan,partitionGeneration,schemaForGenerationUnit,validateGenerationUnit,assembleGeneration,dependentUnitKeys} from './studio-generation-stages.mjs';
import {descriptorFor,dependencyHashes,canResumeGeneration} from './studio-generation-checkpoints.mjs';

const special=key=>({key,kind:key,ids:[],dependsOn:[],tokenLimit:key==='readiness'?1500:4000,timeoutMs:key==='readiness'?180000:300000});
function stopped(message,canResume=false){return Object.assign(new Error(message),{canResume});}
function questionsSpec(r){return {schemaVersion:1,title:'Clarification required',description:'Essential inputs are needed before proceeding.',units:'mm',requirements:r.requirements,assumptions:r.assumptions,unknowns:r.unknowns,questions:r.questions,parts:[],assembly:[]};}

/** No CAD/price side effects here. Only a fully admitted result may leave this runner. */
export async function runStagedGeneration({identity,contextSnapshot,store,infer,buildMessages,admit,signal,onProgress=()=>{},resumeGenerationId}){
  signal?.throwIfAborted();
  const args={projectId:identity.identity.projectId,identity},h=resumeGenerationId?await store.load({...args,generationId:resumeGenerationId}):await store.create({...args,contextSnapshot});
  if(['accepted','questions','exhausted'].includes(h.snapshot().status))throw stopped('Generation is terminal; start a new generation explicitly.');
  const reused=new Set(h.snapshot().units.map(r=>r.key));let current='readiness',lateQuestions=null;
  const progress=async(stage,extra={})=>{const s=h.snapshot();await onProgress({generationId:h.id,stage,unitKey:current,declaredUnits:s.plan?partitionGeneration(s.plan).length:0,validatedUnits:s.units.filter(r=>!r.descriptor.parentKey).length,reusedUnits:s.units.filter(r=>reused.has(r.key)&&!r.descriptor.parentKey).length,remaining:h.remaining(),elapsedMs:2400000-h.remaining().activeMs,...extra});};
  const remainingAttempts=key=>{const s=h.snapshot();return (key.includes('~')?1:2)-s.reservations.filter(r=>r.unitKey===key&&r.round===s.repairRounds).length;};
  async function request(unit,schema,validate,diagnostic=null){
    current=unit.key;signal?.throwIfAborted();
    const state=h.snapshot(),dependencies=state.units.filter(r=>unit.dependsOn.includes(r.key)).map(r=>({key:r.key,payload:r.payload}));
    const repairContext=state.repairContext[unit.key]||state.repairContext[unit.parentKey]||null;
    const messages=[...await buildMessages({unit,contextSnapshot:h.context}),{role:'user',content:JSON.stringify({stage:unit.kind,assignedIds:unit.ids,readiness:state.readiness,plan:state.plan,dependencies,validationError:diagnostic,repairContext,instruction:'Return exactly this stage schema. Preserve the immutable roster, identities and requirements. Do not repeat completed units. Address the supplied repair diagnostic using the failed payload and current dependencies; do not repeat the failed geometry. If an essential input is missing, return a readiness response with status questions instead.'})}];
    if(Buffer.byteLength(JSON.stringify(messages),'utf8')+unit.tokenLimit+1024>65536)throw stopped('Generation context exceeds the bounded context window.');
    const reservation=await h.reserve({unitKey:unit.key,tokenLimit:unit.tokenLimit,timeoutMs:unit.timeoutMs});
    const timeout=AbortSignal.timeout(reservation.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout,start=performance.now();let settled=false;
    try{
      await progress(unit.kind,{attempt:3-remainingAttempts(unit.key)});combined.throwIfAborted();
      const response=await infer({unit,schema:unit.key==='readiness'?schema:{anyOf:[schema,READINESS_SCHEMA]},messages,config:{numPredict:unit.tokenLimit,timeoutMs:reservation.timeoutMs,numCtx:65536},signal:combined,onProgress:()=>{}});
      combined.throwIfAborted();
      const outcome=response.doneReason==='length'?'length':'stop';await h.settle(reservation.reservationId,{elapsedMs:performance.now()-start,outcome,evalCount:response.metrics?.evalCount??null,promptEvalCount:response.metrics?.promptEvalCount??null});settled=true;
      if(outcome==='length')throw Object.assign(stopped('Truncated unit '+unit.key),{truncated:true});
      const raw=parseGenerationJson(response.content);
      if(raw?.status==='questions'){lateQuestions=validateReadiness(raw);throw Object.assign(stopped('Essential clarification required'),{questions:true});}
      return validate(raw);
    }catch(error){
      if(!settled){await h.settle(reservation.reservationId,{elapsedMs:performance.now()-start,outcome:combined.aborted?'cancelled':'error'});throw Object.assign(error,{canResume:remainingAttempts(unit.key)>0,transport:true});}
      throw error;
    }
  }
  async function validatedRequest(unit,schema,validate){
    let diagnostic=null;
    while(remainingAttempts(unit.key)>0){
      try{return await request(unit,schema,validate,diagnostic);}catch(e){if(signal?.aborted||e.questions||e.transport||e.truncated||e.canResume===false||e.code==='CHECKPOINT_CONFLICT')throw e;if(remainingAttempts(unit.key)<=0)throw Object.assign(e,{canResume:false});diagnostic=String(e.message).slice(0,1000);await progress('retrying',{message:diagnostic});}
    }
    throw stopped('Retry budget exhausted for '+unit.key);
  }
  async function unit(u){
    if(h.snapshot().units.some(r=>r.key===u.key))return;
    const split=h.snapshot().splits.includes(h.snapshot().repairRounds+':'+u.key);
    let value;
    if(!split){try{value=await validatedRequest(u,schemaForGenerationUnit(h.snapshot().plan,u),v=>validateGenerationUnit(h.snapshot().plan,u,v,h.snapshot().units));}
      catch(e){if(!e.truncated||u.ids.length<2||remainingAttempts(u.key)!==1)throw e;await h.startSplit(u.key);}}
    if(value===undefined){
      for(let i=0;i<u.ids.length;i++)await unit(descriptorFor(h.snapshot().plan,u.key+'~'+i));
      value={items:u.ids.flatMap((_,i)=>h.snapshot().units.find(r=>r.key===u.key+'~'+i).payload.items)};
    }
    signal?.throwIfAborted();await h.saveUnit({descriptor:u,payload:value,dependencyHashes:dependencyHashes(h.snapshot(),u)});await progress(u.kind);
  }
  try{
    await h.finish('running');await progress('readiness');
    if(!h.snapshot().readiness)await h.saveReadiness(await validatedRequest(special('readiness'),READINESS_SCHEMA,validateReadiness));
    const ready=h.snapshot().readiness;
    if(ready.status==='questions'){await h.finish('questions');return {status:'questions',spec:questionsSpec(ready),generationId:h.id,metrics:h.remaining()};}
    if(!h.snapshot().plan)await h.savePlan(await validatedRequest(special('plan'),PLAN_SCHEMA,v=>validateGenerationPlan(v,{readiness:ready,sources:h.context.sources})));
    const units=partitionGeneration(h.snapshot().plan);
    for(;;){
      for(const u of units)await unit(u);
      signal?.throwIfAborted();await progress('validation');const raw=assembleGeneration(h.snapshot().plan,h.snapshot().units),result=await admit(raw,{plan:h.snapshot().plan});
      if(result.spec&&result.issues.length===0){signal?.throwIfAborted();await h.finish('accepted');await progress('accepted');return {status:'accepted',spec:result.spec,generationId:h.id,metrics:h.remaining()};}
      const issues=result.issues||[];
      if(!issues.length||issues.some(i=>i.attribution!=='exact'||!i.unitKeys?.length||i.unitKeys.some(k=>!units.some(u=>u.key===k)))||h.snapshot().repairRounds>=1)throw stopped(issues.map(i=>i.message).join('; ')||'Global admission failed');
      const changed=[...dependentUnitKeys(units,issues.flatMap(i=>i.unitKeys))];await h.beginRepair({keys:changed,reason:issues.map(i=>i.message).join('; ').slice(0,2000)});
    }
  }catch(error){
    if(lateQuestions){await h.finish('questions');return {status:'questions',spec:questionsSpec(lateQuestions),generationId:h.id,metrics:h.remaining()};}
    const canResume=Boolean((error.canResume===true||signal?.aborted)&&canResumeGeneration(h.snapshot()));
    await h.finish(canResume?'stopped':'exhausted');await progress(canResume?'stopped':'exhausted',{canResume,message:String(error.message).slice(0,1000)});
    throw Object.assign(error,{generationId:h.id,canResume});
  }
}
