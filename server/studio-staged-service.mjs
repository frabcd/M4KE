import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createGenerationCheckpointStore,generationIdentity,hashGenerationValue,canResumeGeneration} from './studio-generation-checkpoints.mjs';
import {runStagedGeneration} from './studio-staged-generation.mjs';
import {loadStudioSkills,buildDesignMessages} from './studio-skills.mjs';
import {DESIGN_JSON_SCHEMA,ollamaProjection} from './studio-schema.mjs';
import {searchCandidateContext,candidateSearchQuery} from './studio-candidate-context.mjs';
import {createLibraryContext} from './studio-model-library.mjs';
import {catalogContext} from './studio-catalog.mjs';import {electricalPromptContext} from './studio-electrical.mjs';
import {admitGeneratedDesign} from './studio-generation-admission.mjs';
import {designHash,verifyDesign} from './studio-contract.mjs';import {REQUEST_GUIDANCE} from './studio-request-constraints.mjs';
const conflict=message=>Object.assign(new Error(message),{status:409});
const validatorFiles=['studio-contract.mjs','studio-electrical.mjs','studio-electrical-profiles.mjs','studio-generation-stages.mjs','studio-generation-admission.mjs','studio-generation-checkpoints.mjs','studio-generation-json.mjs','studio-staged-generation.mjs','studio-request-constraints.mjs','studio-generation-diagnostics.mjs','studio-schema.mjs','studio-catalog.mjs'];

/** Narrow fresh-generation adapter. Legacy refinement and native repair stay outside. */
export function createStagedService({root,getSettings,getModels,localCatalog,infer,sourcing,enabled=()=>process.env.M4KE_STAGED_GENERATION==='1'}){
  const store=createGenerationCheckpointStore({root});
  const supported=(p,i)=>enabled()&&getSettings().provider!=='codex-bridge'&&!p.spec?.parts?.length&&i.mode!=='verify'&&!i.kitId;
  async function prepare(project,input,{create=true}={}){
    if(!supported(project,input)){if(input.resumeGenerationId)throw conflict('Resume is unavailable for this generation route.');return {};}
    const settings={...getSettings()},installed=(await getModels(settings.endpoint)).find(m=>m.name===settings.model);
    if(!installed?.digest)throw conflict('Exact installed model and digest are required for staged generation.');
    const skills=await loadStudioSkills(),catalog=await localCatalog(),request=project.request+(project.budget?`\nUser budget with currency: ${project.budget}`:''),candidateContext=await searchCandidateContext(root,candidateSearchQuery(request,project.answers||[])),libraryContext=await createLibraryContext(root,request).catch(()=>null);
    const validatorHash=hashGenerationValue(await Promise.all(validatorFiles.map(async f=>[f,hashGenerationValue(await readFile(new URL(f,import.meta.url),'utf8'))])));
    const sourceHash=hashGenerationValue({catalog,candidateContext,libraryContext});
    let contextSnapshot;
    if(input.resumeGenerationId)contextSnapshot=(await store.inspect({projectId:project.id,generationId:input.resumeGenerationId})).context;
    else{
      const sourced=await sourcing.call('search_cached_parts',{query:'',limit:8});
      const sourcingContext={provider:'m4ke-offline-sourcing',snapshotSha256:sourced.snapshotSha256,networkUsed:false,completeBom:false,entries:sourced.entries};
      const messages=buildDesignMessages({request,answers:Object.fromEntries(project.answers.map(a=>[a.id,a.answer])),skills,catalog:catalogContext(catalog),candidateContext,libraryContext,sourcingContext,electricalProfiles:electricalPromptContext()});
      messages[0].content+='\n'+REQUEST_GUIDANCE+'\nThis invocation returns only the assigned staged schema. Preserve all upstream design obligations; never invent unanswered user choices.';
      contextSnapshot={messages,sources:{catalogIds:catalog.components.map(c=>c.id),libraryHashes:libraryContext?.data.records.map(r=>r.sourceSha256)||[]},candidateContext,libraryContext,sourcingContext,skillHashes:skills.hashes,catalogHash:catalog.manifestSha256||null};
    }
    const identity=generationIdentity({projectId:project.id,inputRevision:project.revision,request:project.request,answers:project.answers,budget:project.budget,mode:input.mode||'auto',parentDesignHash:null,model:{name:settings.model,digest:installed.digest,settings:{temperature:.2,think:false,num_ctx:65536}},skillHash:hashGenerationValue(skills.hashes),schemaHash:hashGenerationValue({schema:DESIGN_JSON_SCHEMA,validatorHash}),sourceHash,contextHash:hashGenerationValue(contextSnapshot)});
    let h;
    if(input.resumeGenerationId){h=await store.load({projectId:project.id,generationId:input.resumeGenerationId,identity});if(!canResumeGeneration(h.snapshot()))throw conflict('This generation cannot resume within its remaining allowances; start over explicitly.');}
    else if(create)h=await store.create({projectId:project.id,identity,contextSnapshot});
    return {canCancel:true,canResume:false,generationId:h?.id,identity,contextSnapshot,catalog,settings,installed};
  }
  return {
    async prepareWorkflow(p,i){const prepared=await prepare(p,i);return prepared.generationId?{canCancel:true,canResume:false,generationId:prepared.generationId,generationState:'ready'}:{};},
    async resumeState(p){if(!p.workflow?.generationId)return false;try{const result=await prepare(p,{mode:p.workflow.mode,resumeGenerationId:p.workflow.generationId},{create:false});return Boolean(result.generationId);}catch{return false;}},
    async generate(project,input,signal,onProgress){
      const prepared=await prepare(project,{...input,mode:project.workflow.mode,resumeGenerationId:project.workflow.generationId},{create:false});
      const {identity,contextSnapshot,catalog,settings,installed}=prepared;
      const result=await runStagedGeneration({identity,contextSnapshot,store,resumeGenerationId:prepared.generationId,signal,onProgress,buildMessages:({contextSnapshot})=>contextSnapshot.messages,
        infer:async({schema,messages,config,signal})=>{const answer=await infer(settings.endpoint,'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:settings.model,stream:false,think:false,format:ollamaProjection(schema),messages,options:{temperature:.2,num_ctx:config.numCtx,num_predict:config.numPredict}})},config.timeoutMs,signal,undefined,settings.provider,{retryInfrastructure:false});return {content:String(answer.message?.content||''),doneReason:answer.done_reason,metrics:{evalCount:answer.eval_count??null,promptEvalCount:answer.prompt_eval_count??null}};},
        admit:(raw,{plan})=>admitGeneratedDesign(raw,{request:project.request,catalog,plan,requirePartExplanations:['design','deliver'].includes(project.workflow.mode)}),
      });
      signal?.throwIfAborted();const spec=result.spec,hash=designHash(spec),runId=randomUUID();
      const record={runId,at:new Date().toISOString(),status:result.status==='accepted'?'accepted':'clarification',generationMode:'staged-design',generationId:result.generationId,model:settings.model,modelDigest:installed.digest,skillHashes:contextSnapshot.skillHashes,catalogHash:contextSnapshot.catalogHash,candidateContext:contextSnapshot.candidateContext,libraryContext:contextSnapshot.libraryContext,request:project.request,answers:project.answers,designHash:result.status==='accepted'?hash:null,attempts:[],metrics:result.metrics};
      const dir=path.join(root,'data/design-runs');await mkdir(dir,{recursive:true});const target=path.join(dir,runId+'.json'),temp=target+'.tmp';await writeFile(temp,JSON.stringify(record));await rename(temp,target);
      return {spec,designHash:result.status==='accepted'?hash:null,model:settings.model,metrics:{...result.metrics,runId,generationId:result.generationId,staged:true},verification:verifyDesign(spec)};
    },
  };
}
