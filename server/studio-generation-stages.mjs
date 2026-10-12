import {isDeepStrictEqual as equal} from 'node:util';
import {DESIGN_JSON_SCHEMA} from './studio-schema.mjs';
import {ELECTRICAL_JSON_SCHEMA} from './studio-electrical.mjs';
import {validateGenerationItem} from './studio-contract.mjs';
import {parseGenerationJson} from './studio-generation-json.mjs';

const D=DESIGN_JSON_SCHEMA.properties,E=ELECTRICAL_JSON_SCHEMA.properties;
const obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const arr=(items,maxItems,minItems=0)=>({type:'array',items,minItems,maxItems});
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$',minLength:1,maxLength:64};
const text={type:'string',minLength:1,maxLength:2000};
const bool={type:'boolean'},nullable=s=>({anyOf:[s,{type:'null'}]});
// Decoder and host share the cross-field invariant; never repair status after
// generation or discard questions to force an otherwise inconsistent pass.
export const READINESS_SCHEMA={anyOf:[
  obj({status:{const:'ready'},requirements:D.requirements,assumptions:D.assumptions,unknowns:D.unknowns,questions:{...D.questions,maxItems:0}}),
  obj({status:{const:'questions'},requirements:D.requirements,assumptions:D.assumptions,unknowns:D.unknowns,questions:{...D.questions,minItems:1,maxItems:3}}),
]};
const identity={anyOf:[obj({type:{enum:['box','cylinder','union']}}),obj({type:{const:'catalog'},catalogId:id}),obj({type:{const:'library'},sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$'}})]};
export const PLAN_SCHEMA=obj({title:D.title,description:D.description,units:D.units,requirements:D.requirements,assumptions:D.assumptions,unknowns:D.unknowns,
  parts:arr(obj({id,kind:D.parts.items.properties.kind,position:D.parts.items.properties.position,rotation:D.parts.items.properties.rotation,source:nullable(text),identity,interfaceIntent:text}),24,1),
  assembly:arr(obj({id,partIds:arr(id,24,1),requires:arr(id,47)}),48,1),
  electrical:nullable(obj({components:arr(obj({partId:id,profileId:text}),32,1),connections:arr(obj({id,from:E.connections.items.properties.from,to:E.connections.items.properties.to,kind:E.connections.items.properties.kind}),96),control:bool})),
  buildItems:nullable(arr(id,40)),verificationRequests:nullable(arr(id,12)),physicsInputs:bool});

function fail(message){throw Object.assign(new Error(message),{code:'GENERATION_CONTRACT'});}
/** Small validator for the closed schema vocabulary used here (not arbitrary JSON Schema). */
export function assertGenerationSchema(value,schema,path='output'){
  if(schema.anyOf){if(!schema.anyOf.some(s=>{try{assertGenerationSchema(value,s,path);return true;}catch{return false;}}))fail(path+': no permitted shape');return;}
  if('const'in schema&&!equal(value,schema.const))fail(path+': incorrect constant');
  if(schema.enum&&!schema.enum.some(x=>equal(x,value)))fail(path+': incorrect enum');
  if(schema.type==='null'&&value!==null)fail(path+': expected null');
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))fail(path+': expected object');
    for(const k of Object.keys(value))if(!Object.hasOwn(schema.properties,k))fail(path+': unsupported key '+k);
    for(const k of schema.required||[])if(!Object.hasOwn(value,k))fail(path+': missing '+k);
    for(const [k,v]of Object.entries(value))assertGenerationSchema(v,schema.properties[k],path+'.'+k);
  }
  if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))fail(path+': array cardinality');
    value.forEach((v,i)=>assertGenerationSchema(v,schema.items,`${path}[${i}]`));
  }
  if(schema.type==='string'&&(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||!value.trim()||/[\u0000-\u001f\u007f]/.test(value)||(schema.pattern&&!new RegExp(schema.pattern).test(value))))fail(path+': invalid text');
  if(['number','integer'].includes(schema.type)&&(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)||(schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum)))fail(path+': invalid number');
  if(schema.type==='boolean'&&typeof value!=='boolean')fail(path+': expected boolean');
}
function safe(raw,schema){const v=parseGenerationJson(JSON.stringify(raw));assertGenerationSchema(v,schema);return v;}
function unique(xs){if(new Set(xs).size!==xs.length)fail('duplicate roster identifiers');}
export function validateReadiness(raw){
  const r=safe(raw,READINESS_SCHEMA);unique(r.requirements.map(x=>x.id));unique(r.questions.map(x=>x.id));
  if((r.status==='ready')!==(r.questions.length===0))fail('readiness status contradicts questions');return r;
}
export function validateGenerationPlan(raw,{readiness,sources={catalogIds:[],libraryHashes:[]}}={}){
  const p=safe(raw,PLAN_SCHEMA);
  for(const k of ['requirements','assumptions','unknowns'])if(!equal(p[k],readiness?.[k]))fail('immutable readiness '+k);
  const ids=new Set(p.parts.map(x=>x.id)),steps=new Set(p.assembly.map(x=>x.id));
  unique(p.parts.map(x=>x.id));unique(p.assembly.map(x=>x.id));
  for(const part of p.parts){
    if(part.identity.type==='catalog'&&(part.kind!=='purchased'||!sources.catalogIds.includes(part.identity.catalogId)))fail('unadmitted catalog identity');
    if(part.identity.type==='library'&&!sources.libraryHashes.includes(part.identity.sourceSha256))fail('unadmitted library identity');
    if(part.identity.type==='union'&&part.kind!=='printed')fail('union must be printed');
  }
  const refs=(xs,set)=>{unique(xs);if(xs.some(x=>!set.has(x)))fail('unknown reference');};
  for(const s of p.assembly){refs(s.partIds,ids);refs(s.requires,steps);}
  const visited=new Set(),active=new Set();function visit(id){if(active.has(id))fail('assembly cycle');if(visited.has(id))return;active.add(id);p.assembly.find(s=>s.id===id).requires.forEach(visit);active.delete(id);visited.add(id);}steps.forEach(visit);
  if(p.parts.some(part=>!p.assembly.some(s=>s.partIds.includes(part.id))))fail('assembly coverage');
  if(p.electrical){const selected=new Set(p.electrical.components.map(c=>c.partId));refs([...p.electrical.components.map(c=>c.partId)],ids);unique(p.electrical.connections.map(c=>c.id));
    for(const c of p.electrical.connections)if(!selected.has(c.from.partId)||!selected.has(c.to.partId))fail('connection reference');}
  for(const k of ['buildItems','verificationRequests'])if(p[k])unique(p[k]);
  if(p.buildItems?.some(x=>ids.has(x)))fail('build item collides with part');return p;
}
export function partitionGeneration(p){
  const units=[];
  const add=(kind,ids,max,dependsOn)=>{for(let i=0;i<ids.length;i+=max)units.push({key:kind+'-'+i/max,kind,ids:ids.slice(i,i+max),dependsOn:[...dependsOn],tokenLimit:3000,timeoutMs:240000});};
  add('part',p.parts.map(x=>x.id),3,['plan']);
  if(p.electrical){add('electricalComponent',p.electrical.components.map(x=>x.partId),4,['plan',...units.map(x=>x.key)]);add('connection',p.electrical.connections.map(x=>x.id),12,['plan',...units.map(x=>x.key)]);}
  add('metadata',['metadata'],1,['plan',...units.map(x=>x.key)]);
  const deps=['plan',...units.map(x=>x.key)];
  add('assembly',p.assembly.map(x=>x.id),4,deps);if(p.buildItems)add('buildItem',p.buildItems,8,deps);
  return units;
}
export function dependentUnitKeys(units,keys){const result=new Set(keys);let change=true;while(change){change=false;for(const u of units)if(!result.has(u.key)&&u.dependsOn.some(k=>result.has(k))){result.add(u.key);change=true;}}return result;}
export function schemaForGenerationUnit(p,u){
  if(u.kind==='metadata')return obj({...p.physicsInputs?{physicsInputs:D.physicsInputs}:{},...p.verificationRequests!==null?{verificationRequests:D.verificationRequests}:{},...p.electrical?.control?{control:E.control}:{}});
  const schemas={part:D.parts.items,assembly:D.assembly.items,buildItem:D.buildItems.items,electricalComponent:E.components.items,connection:E.connections.items};
  if(!schemas[u.kind])fail('unknown unit kind');return obj({items:arr(schemas[u.kind],u.ids.length,u.ids.length)});
}
export function validateGenerationUnit(p,u,raw,completed){
  const v=safe(raw,schemaForGenerationUnit(p,u)),getItems=kind=>completed.filter(r=>r.status==='UNIT_VALIDATED'&&r.key.startsWith(kind+'-')).flatMap(r=>r.payload.items);
  const ctx={knownPartIds:new Set(p.parts.map(x=>x.id)),knownStepIds:new Set(p.assembly.map(x=>x.id)),knownComponentIds:new Set(p.electrical?.components.map(c=>c.partId)||[]),parts:getItems('part'),requirements:p.requirements};
  if(u.kind==='metadata'){
    const clean=validateGenerationItem('metadata',v,ctx);
    if(p.verificationRequests!==null&&!equal(clean.verificationRequests.map(x=>x.id).sort(),[...p.verificationRequests].sort()))fail('verification roster mismatch');return clean;
  }
  const key=u.kind==='electricalComponent'?'partId':'id';
  const ids=v.items.map(x=>x[key]);unique(ids);if(!equal([...ids].sort(),[...u.ids].sort()))fail('unit roster mismatch');
  const items=v.items.map(x=>validateGenerationItem(u.kind,x,ctx));
  for(const x of items){
    if(u.kind==='part'){
      const r=p.parts.find(r=>r.id===x.id),{type,catalogId,sourceSha256}=x.shape,identity={type,...catalogId?{catalogId}:{},...sourceSha256?{sourceSha256}:{}};
      if(!equal(identity,r.identity)||x.kind!==r.kind||!equal(x.position,r.position)||!equal(x.rotation,r.rotation)||(x.source??null)!==r.source)fail('immutable part identity/pose/source');
    }
    if(u.kind==='assembly'){const r=p.assembly.find(r=>r.id===x.id);if(!equal(x.partIds,r.partIds)||!equal(x.requires,r.requires))fail('immutable assembly references');}
    if(u.kind==='electricalComponent'&&x.profileId!==p.electrical.components.find(r=>r.partId===x.partId).profileId)fail('immutable electrical identity');
    if(u.kind==='connection'){const r=p.electrical.connections.find(r=>r.id===x.id);if(!equal(x.from,r.from)||!equal(x.to,r.to)||x.kind!==r.kind)fail('immutable connection topology');}
  }
  return {items:u.ids.map(id=>items.find(x=>x[key]===id))};
}
export function assembleGeneration(p,records){
  const units=partitionGeneration(p),validated=[];
  for(const u of units){const rs=records.filter(r=>r.key===u.key&&r.status==='UNIT_VALIDATED');if(rs.length!==1)fail('missing/duplicate unit '+u.key);validated.push({...rs[0],payload:validateGenerationUnit(p,u,rs[0].payload,validated)});}
  const items=kind=>validated.filter(r=>r.key.startsWith(kind+'-')).flatMap(r=>r.payload.items);
  const metadata=validated.find(r=>r.key==='metadata-0').payload,{control,...rest}=metadata;
  return {schemaVersion:1,...Object.fromEntries(['title','description','units','requirements','assumptions','unknowns'].map(k=>[k,p[k]])),questions:[],parts:items('part'),assembly:items('assembly'),...rest,...p.buildItems!==null?{buildItems:items('buildItem')}:{},...p.electrical?{electrical:{schemaVersion:1,components:items('electricalComponent'),connections:items('connection'),...control?{control}:{}}}:{}};
}
