import {mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {validateDesignSpec,designHash} from './studio-contract.mjs';
import {validateRepair} from './studio-repair.mjs';
import {OLLAMA_DESIGN_SCHEMA} from './studio-schema.mjs';

const PRINTED=['position','rotation','color','material','shape','fillet','holes','pockets','explanation'];
const SOURCE=['position','rotation','explanation'];
const fail=message=>{throw Object.assign(new Error(message),{status:422});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
function plain(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label}: expected an inert object.`);
  for(const key of Reflect.ownKeys(value))if(typeof key!=='string'||!keys.includes(key)||!('value' in Object.getOwnPropertyDescriptor(value,key)))fail(`${label}: unsupported field or accessor.`);
}
function text(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max)fail(`${label}: expected 1..${max} characters.`);return value.trim();}
const source=part=>part.kind==='purchased'||['catalog','library'].includes(part.shape.type);

/** Editing imported geometry must not count as generating a fresh toy. */
export function refinementProvenance(record){
  if(record.generationMode!=='model-user-refinement')return {};
  if(!/^[0-9a-f]{64}$/.test(record.parentDesignHash||''))fail('Refinement is missing its parent design hash.');
  return {origin:'local-qwen-refinement',modelGenerationVerified:false,modelRefinementVerified:true,generationMode:record.generationMode,parentDesignHash:record.parentDesignHash};
}

/** This user-edit path is separate from automatic failure repair. Colour is an
 * intentional edit here, never a geometry repair or a passed physical check. */
export function buildRefinementSchema(input){
  const spec=validateDesignSpec(input),properties=OLLAMA_DESIGN_SCHEMA.properties.parts.items.properties;
  if(!spec.parts.length)fail('Refinement requires a confirmed concept.');
  const variants=[];
  for(const immutable of [false,true])for(const needsExplanation of [false,true]){
    const ids=spec.parts.filter(p=>source(p)===immutable&&(!p.explanation)===needsExplanation).map(p=>p.id);if(!ids.length)continue;
    const fields=Object.fromEntries((immutable?SOURCE:PRINTED).map(key=>[key,structuredClone(properties[key])]));
    if(fields.shape)fields.shape.anyOf=fields.shape.anyOf.filter(option=>!option.properties.type.enum.some(type=>['catalog','library'].includes(type)));
    variants.push(object({partId:{type:'string',enum:ids},reason:{type:'string'},changes:{...object(fields,needsExplanation?['explanation']:[]),minProperties:1}}));
  }
  return object({action:{type:'string',enum:['patch','questions','redesign']},message:{type:'string'},updates:{type:'array',maxItems:12,items:{anyOf:variants}},questions:structuredClone(OLLAMA_DESIGN_SCHEMA.properties.questions)});
}

/** Model output may propose edits, ask a blocking question, or explicitly route
 * to the existing full designer. It cannot mutate source identities or checks. */
export function applyRefinementResponse(input,reply){
  const original=validateDesignSpec(input);
  plain(reply,['action','message','updates','questions'],'refinement');
  const message=text(reply.message,'message',6000);
  if(!Array.isArray(reply.updates)||reply.updates.length>12||!Array.isArray(reply.questions)||reply.questions.length>4)fail('Refinement needs bounded updates and questions arrays.');
  if(reply.action==='questions'){
    if(reply.updates.length||!reply.questions.length)fail('Questions must not include proposed geometry.');
    const spec=validateDesignSpec({schemaVersion:1,title:original.title,description:message,units:'mm',requirements:original.requirements,assumptions:original.assumptions,unknowns:original.unknowns,questions:reply.questions,parts:[],assembly:[]});
    return {action:'questions',message,spec};
  }
  if(reply.action==='redesign'){
    if(reply.updates.length||reply.questions.length)fail('Full-design routing must not include a partial patch or unanswered question.');
    return {action:'redesign',message};
  }
  if(reply.action!=='patch'||!reply.updates.length||reply.questions.length)fail('Patch requires updates and no unanswered questions.');
  const next=structuredClone(original),seen=new Set(),reasons=[];
  for(const [index,update] of reply.updates.entries()){
    const label=`updates[${index}]`;plain(update,['partId','reason','changes'],label);
    const part=next.parts.find(p=>p.id===update.partId);if(!part||seen.has(part.id))fail(`${label}: unknown or duplicate part ID.`);
    seen.add(part.id);const reason=text(update.reason,`${label}.reason`,1200);
    plain(update.changes,source(part)?SOURCE:PRINTED,`${label}.changes`);
    if(!Object.keys(update.changes).length||Object.values(update.changes).some(v=>v===undefined))fail(`${label}: explicit changes are required.`);
    if(update.changes.shape&&['catalog','library'].includes(update.changes.shape.type))fail('A local edit cannot substitute source geometry. Use the full design decision workflow.');
    const before=JSON.stringify(part);Object.assign(part,structuredClone(update.changes));
    if(JSON.stringify(part)===before)fail(`${label}: unchanged part is not an edit.`);
    if(!part.explanation)fail(`${label}: include explanation of purpose, placement and selection for the changed part.`);
    reasons.push(`${part.name}: ${reason}`);
  }
  const spec=validateRepair(original,validateDesignSpec(next));
  if(designHash(spec)===designHash(original))fail('Refinement did not change the design.');
  return {action:'patch',message:[message,...reasons].join('\n\n').slice(0,12000),spec};
}

/** Describe measurable changes, not an aesthetic score or physical acceptance. */
export function refinementEffects(before,after){
  return after.parts.flatMap(part=>{
    const previous=before.parts.find(p=>p.id===part.id);if(!previous)return [];
    const changed=fields=>fields.filter(key=>JSON.stringify(previous[key])!==JSON.stringify(part[key]));
    const geometry=changed(['shape','fillet','holes','pockets']),placement=changed(['position','rotation']),appearance=changed(['color','material']);
    return geometry.length||placement.length||appearance.length ? [{partId:part.id,geometry,placement,appearance}] : [];
  });
}

export function buildRefinementMessages({project,context,message,history=[],skill,validationErrors=[],failedReply=null}){
  if(typeof skill!=='string'||!skill.trim())fail('Missing runtime refinement skill.');
  const data={message,brief:{request:project.request,answers:project.answers||[],budget:project.budget||null},selectedPartContext:context,previousSpec:project.spec,
    editMap:project.spec.parts.map(p=>({partId:p.id,editable:source(p)?SOURCE:PRINTED,needsExplanation:!p.explanation})),validationErrors,failedReply};
  if(JSON.stringify(data).length>120000)fail('Refinement context exceeds 120KB.');
  return [{role:'system',content:skill},...history.map(entry=>({role:entry.role,content:entry.role==='assistant'?JSON.stringify({message:entry.message}):entry.message})),{role:'user',content:JSON.stringify(data)}];
}

/** Small model-authored responses avoid regenerating unchanged CAD. Each failed
 * attempt and the parent hash are retained; nothing is applied in this function. */
export async function generateRefinement({root,project,context,message,history,settings,installed,skills,infer,signal,inspect}){
  const runId=randomUUID(),started=Date.now(),at=new Date().toISOString(),schema=buildRefinementSchema(project.spec),attempts=[],errors=[];
  const inferenceConfig={think:false,temperature:0.2,num_ctx:32768,num_predict:3000,timeoutMs:240000};
  let result=null,failedReply=null;
  const folder=path.join(root,'data','design-runs');await mkdir(folder,{recursive:true});
  async function save(status){
    const record={runId,at,status,generationMode:'model-user-refinement',parentDesignHash:designHash(project.spec),projectId:project.id,revision:project.revision,selectedPartIds:context.selectedPartIds,model:settings.model,modelDigest:installed.digest||null,skillHashes:{refine:skills.hashes.refine},outputSchemaHash:hash(JSON.stringify(schema)),inferenceConfig,request:message,attempts,errors,designHash:result?.spec?designHash(result.spec):null,elapsedMs:Date.now()-started};
    const file=path.join(folder,runId+'.json');await writeFile(file+'.tmp',JSON.stringify(record,null,2));await rename(file+'.tmp',file);return record;
  }
  await save('running');
  try{
    for(let attempt=0;attempt<2;attempt++){
      const messages=buildRefinementMessages({project,context,message,history,skill:skills.refine,validationErrors:errors,failedReply});
      const answer=await infer(settings.endpoint,'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:settings.model,stream:false,think:false,format:schema,messages,options:{temperature:inferenceConfig.temperature,num_ctx:inferenceConfig.num_ctx,num_predict:inferenceConfig.num_predict}})},inferenceConfig.timeoutMs,signal);
      const content=String(answer.message?.content||'');
      attempts.push({attempt:attempt+1,content:content.slice(0,40000),evalCount:answer.eval_count,promptEvalCount:answer.prompt_eval_count??null,doneReason:answer.done_reason,inferenceMetrics:answer.inferenceMetrics||null});
      await save('running');
      try{
        if(answer.done_reason==='length'||content.length>40000)throw new Error('Refinement was truncated. Return a concise patch, or route complex changes to redesign; do not drop part changes.');
        failedReply=JSON.parse(content.replace(/^\s*```(?:json)?\s*/i,'').replace(/\s*```\s*$/,''));
        const candidate=applyRefinementResponse(project.spec,failedReply);
        if(candidate.action==='patch'){
          candidate.effects=refinementEffects(project.spec,candidate.spec);
          if(!candidate.effects.length)throw new Error('This changes explanation text only. A design modification must change geometry, placement, material or colour. Use read-only Ask for explanations.');
          const issues=await inspect(candidate.spec);if(issues.length)throw new Error(issues.join('; ').slice(0,4000));
        }
        result=candidate;break;
      }catch(error){errors.push(error.message);await save('running');}
    }
  }catch(error){errors.push(error.message);await save('rejected');throw error;}
  const record=await save(result?(result.action==='patch'?'accepted':result.action==='questions'?'clarification':'delegated'):'rejected');
  if(!result)fail(`Local model refinement failed after ${attempts.length} bounded attempts; diagnostic ${runId}: ${errors.at(-1)}`);
  return {...result,model:settings.model,metrics:{runId,elapsedMs:record.elapsedMs,attempts:attempts.length,evalCount:attempts.at(-1)?.evalCount,generationMode:record.generationMode,parentDesignHash:record.parentDesignHash},warnings:['Candidate intent only; unchanged design fields are preserved. Explicit confirmation and separate verification are required.']};
}
