import {createHash,randomUUID} from 'node:crypto';
import {lstat,mkdir,open,rename,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';import path from 'node:path';import {isDeepStrictEqual as equal} from 'node:util';
import {parseGenerationJson} from './studio-generation-json.mjs';
import {validateReadiness,validateGenerationPlan,partitionGeneration,validateGenerationUnit} from './studio-generation-stages.mjs';

export const GENERATION_LIMITS=Object.freeze({requests:64,requestedOutputTokens:60000,activeMs:2400000,recordBytes:4194304,unitBytes:262144,units:128,totalBytes:33554432});
const PROTOCOL=1,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clone=x=>structuredClone(x);
function fail(message){throw Object.assign(new Error(message),{code:'CHECKPOINT_CONFLICT',statusCode:409});}
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export const hashGenerationValue=v=>createHash('sha256').update(canonical(v)).digest('hex');
export function generationIdentity(input){
  const identity=parseGenerationJson(JSON.stringify({...input,protocol:PROTOCOL,limits:GENERATION_LIMITS}),{maxBytes:4194304});
  if(!UUID.test(identity.projectId)||!identity.model?.digest||!identity.skillHash||!identity.schemaHash||!identity.sourceHash||!identity.contextHash)fail('incomplete generation identity');
  if(!Array.isArray(identity.answers))fail('answers must be an array');
  identity.answers.sort((a,b)=>canonical(a).localeCompare(canonical(b),'en'));
  const {inputRevision,...semantic}=identity;
  return {identity,hash:hashGenerationValue(semantic)};
}
function exactKeys(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('unexpected checkpoint fields');}
async function safePath(target,{create=false,file=false}={}){
  const absolute=path.resolve(target),parsed=path.parse(absolute);let current=parsed.root;
  const segments=absolute.slice(parsed.root.length).split(path.sep);
  for(let i=0;i<segments.length;i++){
    current=path.join(current,segments[i]);const last=i===segments.length-1;
    let stat;try{stat=await lstat(current);}catch(e){if(e.code!=='ENOENT')throw e;if(last&&file)return;if(!create)throw e;try{await mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}stat=await lstat(current);}
    if(stat.isSymbolicLink())fail('symlink checkpoint path');if(!(last&&file)&&!stat.isDirectory())fail('checkpoint directory required');if(last&&file&&!stat.isFile())fail('checkpoint regular file required');
  }
}
async function readJson(file){await safePath(file,{file:true});const fd=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const stat=await fd.stat();if(!stat.isFile()||stat.size>GENERATION_LIMITS.recordBytes)fail('oversized/nonregular checkpoint');return parseGenerationJson(await fd.readFile('utf8'),{maxBytes:GENERATION_LIMITS.recordBytes});}finally{await fd.close();}}
async function writeJson(file,value){
  const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>GENERATION_LIMITS.recordBytes)fail('checkpoint size limit');
  await safePath(file,{file:true});const tmp=file+'.'+randomUUID()+'.tmp';const fd=await open(tmp,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await safePath(file,{file:true});await rename(tmp,file);}finally{await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
const allowedStatuses=['running','stopped','questions','accepted','exhausted'];
function remaining(s){return {requests:64-s.reservations.length,requestedOutputTokens:60000-s.reservations.reduce((n,r)=>n+r.tokenLimit,0),activeMs:2400000-s.reservations.reduce((n,r)=>n+(r.elapsedMs??r.timeoutMs),0)};}
function requestLimit(key){return key==='readiness'?[1500,180000]:key==='plan'?[4000,300000]:[3000,240000];}
function validateBudget(s){
  if(![0,1].includes(s.repairRounds)||!Array.isArray(s.splits)||s.splits.length>64)fail('corrupt retry ledger');
  const ids=new Set(),counts=new Map();
  for(const r of s.reservations){
    exactKeys(r,['id','unitKey','round','tokenLimit','timeoutMs','elapsedMs','outcome','evalCount','promptEvalCount']);
    if(!UUID.test(r.id)||ids.has(r.id)||![0,1].includes(r.round)||r.round>s.repairRounds)fail('corrupt reservation');ids.add(r.id);
    if(!['readiness','plan'].includes(r.unitKey))descriptorFor(s.plan,r.unitKey);
    const limits=requestLimit(r.unitKey);if(!Number.isInteger(r.tokenLimit)||r.tokenLimit<1||r.tokenLimit>limits[0]||!Number.isInteger(r.timeoutMs)||r.timeoutMs<1||r.timeoutMs>limits[1])fail('reservation bounds');
    if(r.elapsedMs!==null&&(!Number.isFinite(r.elapsedMs)||r.elapsedMs<0||r.elapsedMs>r.timeoutMs))fail('elapsed bounds');
    if(![null,'stop','length','error','cancelled'].includes(r.outcome)||(r.outcome===null)!==(r.elapsedMs===null))fail('reservation outcome');
    for(const k of ['evalCount','promptEvalCount'])if(r[k]!==null&&(!Number.isInteger(r[k])||r[k]<0||r[k]>1000000))fail('token measurement');
    const key=r.round+':'+r.unitKey;counts.set(key,(counts.get(key)||0)+1);if(counts.get(key)>(r.unitKey.includes('~')?1:2))fail('retry budget');
  }
  for(const v of Object.values(remaining(s)))if(!Number.isFinite(v)||v<0)fail('generation budget exhausted');
}
function validateState(s,projectId,id,identity,context){
  exactKeys(s,['protocol','projectId','id','identity','status','readiness','plan','planHash','units','invalidations','reservations','splits','repairRounds','createdAt','updatedAt']);
  if(s.protocol!==PROTOCOL||s.projectId!==projectId||s.id!==id||!allowedStatuses.includes(s.status)||generationIdentity(s.identity.identity).hash!==identity.hash||s.identity.hash!==identity.hash)fail('stale checkpoint identity');
  if(hashGenerationValue(context)!==identity.identity.contextHash)fail('changed context snapshot');
  if(!Array.isArray(s.units)||s.units.length>128||!Array.isArray(s.reservations)||s.reservations.length>64||!Array.isArray(s.invalidations)||s.invalidations.length>128)fail('checkpoint count bounds');
  if(s.readiness)validateReadiness(s.readiness);
  if(s.plan){validateGenerationPlan(s.plan,{readiness:s.readiness,sources:context.sources});if(s.planHash!==hashGenerationValue(s.plan))fail('corrupt plan');}
  else if(s.units.length)fail('units without plan');
  validateBudget(s);
  const seen=new Set(),checked=[];
  for(const r of s.units){
    exactKeys(r,['key','descriptor','payload','payloadHash','dependencyHashes','planHash','status']);
    if(seen.has(r.key)||r.status!=='UNIT_VALIDATED'||r.key!==r.descriptor?.key||r.planHash!==s.planHash||r.payloadHash!==hashGenerationValue(r.payload))fail('corrupt unit');
    const expected=descriptorFor(s.plan,r.key);if(!equal(r.descriptor,expected))fail('unassigned descriptor');
    if(Buffer.byteLength(JSON.stringify(r))>GENERATION_LIMITS.unitBytes)fail('unit size limit');
    const dependencies=dependencyHashes(s,r.descriptor);
    if(!equal(r.dependencyHashes,dependencies))fail('stale dependency');
    if(!equal(validateGenerationUnit(s.plan,r.descriptor,r.payload,checked),r.payload))fail('unit not normalized');
    seen.add(r.key);checked.push(r);
  }
}
export function descriptorFor(plan,key){
  const units=partitionGeneration(plan),base=units.find(u=>u.key===key);if(base)return base;
  const match=/^(.+)~(\d+)$/.exec(key);const parent=match&&units.find(u=>u.key===match[1]);const index=Number(match?.[2]);
  if(!parent||!Number.isInteger(index)||index>=parent.ids.length||parent.ids.length<2)fail('unknown unit');
  return {...parent,key,ids:[parent.ids[index]],parentKey:parent.key};
}
export function dependencyHashes(state,descriptor){return Object.fromEntries(descriptor.dependsOn.map(k=>{const hash=k==='plan'?state.planHash:state.units.find(r=>r.key===k)?.payloadHash;if(!hash)fail('missing dependency '+k);return [k,hash];}));}
/** One admitted application writer; handles serialize transitions for their generation. */
export function createGenerationCheckpointStore({root,now=()=>Date.now()}={}){
  const base=path.join(path.resolve(root),'data','design-checkpoints'),handles=new Map();
  const directory=(projectId,id)=>{if(!UUID.test(projectId)||!UUID.test(id))fail('invalid project/generation ID');return path.join(base,projectId,id);};
  function handle(dir,initial,context){
    let state=initial,tail=Promise.resolve();const ownedReservations=new Set();
    const transition=fn=>{const promise=tail.then(async()=>{const next=clone(state);await fn(next);next.updatedAt=now();validateState(next,next.projectId,next.id,next.identity,context);await writeJson(path.join(dir,'state.json'),next);state=next;return clone(state);});tail=promise.catch(()=>{});return promise;};
    return {id:state.id,context:clone(context),snapshot:()=>clone(state),
      remaining:()=>remaining(state),
      async reserve({unitKey,tokenLimit,timeoutMs}){
        const reservationId=randomUUID();let reservedTimeout;
        await transition(s=>{
          const [maxTokens,maxTime]=requestLimit(unitKey);if(!Number.isInteger(tokenLimit)||tokenLimit<1||tokenLimit>maxTokens||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>maxTime)fail('request limits');
          if(!['readiness','plan'].includes(unitKey))descriptorFor(s.plan,unitKey);
          const spent=s.reservations.filter(r=>r.unitKey===unitKey&&r.round===s.repairRounds),splitKey=s.repairRounds+':'+unitKey;
          if(spent.length>=(unitKey.includes('~')?1:2)||s.splits.includes(splitKey))fail('retry budget exhausted');
          if(unitKey.includes('~')&&!s.splits.includes(s.repairRounds+':'+unitKey.split('~')[0]))fail('split not reserved');
          const left=remaining(s);if(left.requests<1||left.requestedOutputTokens<tokenLimit||left.activeMs<1)fail('generation budget exhausted');
          reservedTimeout=Math.floor(Math.min(timeoutMs,left.activeMs));
          s.reservations.push({id:reservationId,unitKey,round:s.repairRounds,tokenLimit,timeoutMs:reservedTimeout,elapsedMs:null,outcome:null,evalCount:null,promptEvalCount:null});
        });ownedReservations.add(reservationId);return {reservationId,timeoutMs:reservedTimeout};
      },
      settle:(reservationId,{elapsedMs,outcome,evalCount=null,promptEvalCount=null})=>transition(s=>{
        const r=s.reservations.find(r=>r.id===reservationId);if(!ownedReservations.has(reservationId)||!r||r.outcome!==null)fail('orphaned or settled reservation');
        if(!Number.isFinite(elapsedMs)||elapsedMs<0)fail('invalid elapsed time');
        Object.assign(r,{elapsedMs:Math.min(elapsedMs,r.timeoutMs),outcome,evalCount,promptEvalCount});
      }),
      startSplit:key=>transition(s=>{
        const descriptor=descriptorFor(s.plan,key),attempts=s.reservations.filter(r=>r.unitKey===key&&r.round===s.repairRounds),split=s.repairRounds+':'+key;
        if(descriptor.ids.length<2||attempts.length!==1||attempts[0].outcome!=='length'||s.splits.includes(split))fail('split retry exhausted');s.splits.push(split);
      }),
      beginRepair:()=>transition(s=>{if(s.repairRounds!==0)fail('final repair exhausted');s.repairRounds=1;}),
      saveReadiness:r=>transition(s=>{const clean=validateReadiness(r);if(s.readiness&&!equal(s.readiness,clean))fail('immutable readiness');s.readiness=clean;}),
      savePlan:p=>transition(s=>{const clean=validateGenerationPlan(p,{readiness:s.readiness,sources:context.sources});if(s.plan&&!equal(clean,s.plan))fail('immutable plan');s.plan=clean;s.planHash=hashGenerationValue(clean);}),
      saveUnit:record=>transition(s=>{exactKeys(record,['descriptor','payload','dependencyHashes']);const d=record.descriptor,clean=validateGenerationUnit(s.plan,d,record.payload,s.units);if(!equal(record.dependencyHashes,dependencyHashes(s,d)))fail('stale dependency');if(s.units.some(r=>r.key===d.key))fail('unit already exists; invalidate explicitly');s.units.push({key:d.key,descriptor:d,payload:clean,payloadHash:hashGenerationValue(clean),dependencyHashes:record.dependencyHashes,planHash:s.planHash,status:'UNIT_VALIDATED'});}),
      invalidate:(keys,reason)=>transition(s=>{if(typeof reason!=='string'||reason.length>2000)fail('invalid reason');const removed=s.units.filter(r=>keys.includes(r.key)||keys.includes(r.descriptor.parentKey));s.invalidations.push({keys:removed.map(r=>r.key),hashes:removed.map(r=>r.payloadHash),reason});s.units=s.units.filter(r=>!removed.includes(r));}),
      finish:status=>transition(s=>{if(!allowedStatuses.includes(status))fail('invalid status');s.status=status;}),
    };
  }
  return {
    async create({projectId,identity,contextSnapshot}){
      if(identity.hash!==generationIdentity(identity.identity).hash||projectId!==identity.identity.projectId)fail('invalid identity');
      const id=randomUUID(),dir=directory(projectId,id);await safePath(dir,{create:true});
      const state={protocol:PROTOCOL,projectId,id,identity:clone(identity),status:'running',readiness:null,plan:null,planHash:null,units:[],invalidations:[],reservations:[],splits:[],repairRounds:0,createdAt:now(),updatedAt:now()};
      validateState(state,projectId,id,identity,contextSnapshot);await writeJson(path.join(dir,'context.json'),contextSnapshot);await writeJson(path.join(dir,'state.json'),state);
      const h=handle(dir,state,contextSnapshot);handles.set(dir,h);return h;
    },
    async load({projectId,generationId,identity}){
      const dir=directory(projectId,generationId);await safePath(dir);const context=await readJson(path.join(dir,'context.json')),s=await readJson(path.join(dir,'state.json'));validateState(s,projectId,generationId,identity,context);
      if(handles.has(dir)){const h=handles.get(dir);if(!equal(h.snapshot(),s))fail('concurrent checkpoint writer');return h;}
      const h=handle(dir,s,context);handles.set(dir,h);return h;
    },
  };
}
