import {validateDesignSpec,designHash} from './studio-contract.mjs';
import {validateRepair} from './studio-repair.mjs';
import {OLLAMA_DESIGN_SCHEMA} from './studio-schema.mjs';

const PRINTED=['position','rotation','fillet','holes','pockets','shape'];
const PURCHASED=['position','rotation'];
const fail=message=>{throw Object.assign(new Error(message),{status:422});};
function object(value,allowed,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(`${label}: expected a plain JSON object.`);
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string'||!allowed.includes(key)))fail(`${label}: unsupported field.`);
  if(Reflect.ownKeys(value).some(key=>!('value' in Object.getOwnPropertyDescriptor(value,key))))fail(`${label}: accessors are forbidden.`);
  return value;
}
function updates(value,label,minimum){
  if(!Array.isArray(value)||value.length<minimum||value.length>12)fail(`${label}: expected ${minimum}..12 updates.`);
  return value;
}
function changes(value,allowed,label){
  object(value,allowed,label);
  if(!Object.keys(value).length||Object.values(value).some(v=>v===undefined))fail(`${label}: at least one explicit change is required.`);
  try{return structuredClone(value);}catch{fail(`${label}: inert JSON data is required.`);}
}
const schemaObject=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});

/** Model-selected edits only: the full design and acceptance predicates stay host-owned. */
export function buildModelRepairSchema(input){
  const spec=validateDesignSpec(input);
  if(!spec.parts.length)fail('Model repair requires existing design parts.');
  const properties=OLLAMA_DESIGN_SCHEMA.properties.parts.items.properties;
  const variants=[];
  for(const [kind,allowed] of [['printed',PRINTED],['purchased',PURCHASED]]){
    // A printed library source is still immutable source geometry: only its pose
    // may be repaired, just like a purchased source. Never propose a replacement primitive.
    const ids=spec.parts.filter(part=>kind==='purchased'?(part.kind==='purchased'||part.shape.type==='library'):(part.kind===kind&&part.shape.type!=='library')).map(part=>part.id);
    if(!ids.length)continue;
    const fields=Object.fromEntries(allowed.map(key=>[key,structuredClone(properties[key])]));
    if(fields.shape)fields.shape.anyOf=fields.shape.anyOf.filter(option=>!option.properties.type.enum.some(type=>['catalog','library'].includes(type)));
    variants.push(schemaObject({partId:{type:'string',enum:ids},changes:{...schemaObject(fields,[]),minProperties:1}}));
  }
  const assemblyProperties=OLLAMA_DESIGN_SCHEMA.properties.assembly.items.properties;
  const schema=schemaObject({
    updates:{type:'array',minItems:spec.electrical?0:1,maxItems:12,items:{anyOf:variants}},
    assemblyUpdates:{type:'array',minItems:0,maxItems:12,items:schemaObject({
      stepId:{type:'string',enum:spec.assembly.map(step=>step.id)},
      changes:{...schemaObject({instructions:structuredClone(assemblyProperties.instructions),checks:structuredClone(assemblyProperties.checks)},[]),minProperties:1},
    })},
  },['updates']);
  if(spec.electrical){
    // Reuse the runtime grammar projection: the host still enforces bounded
    // strings, but decoder-level repetitions caused earlier llama.cpp failures.
    const baseElectrical=OLLAMA_DESIGN_SCHEMA.properties.electrical;
    const electrical=structuredClone(baseElectrical);
    electrical.properties.components.minItems=spec.electrical.components.length;
    electrical.properties.components.maxItems=spec.electrical.components.length;
    electrical.properties.components.items={anyOf:spec.electrical.components.map(c=>schemaObject({partId:{const:c.partId},profileId:{const:c.profileId},terminalAnchors:structuredClone(baseElectrical.properties.components.items.properties.terminalAnchors)},['partId','profileId']))};
    if(spec.electrical.control){electrical.required.push('control');electrical.properties.control={const:structuredClone(spec.electrical.control)};}
    else delete electrical.properties.control;
    for(const end of ['from','to'])electrical.properties.connections.items.properties[end].properties.partId={type:'string',enum:spec.electrical.components.map(c=>c.partId)};
    schema.properties.electrical=electrical;
  }
  return schema;
}

/** Ignore IDs, ordering and wire colours: those alone do not repair connectivity. */
function electricalBehavior(e){
  if(!e)return null;
  const components=e.components.map(c=>({partId:c.partId,anchors:(c.terminalAnchors||[]).map(a=>({terminal:a.terminal,positionMm:a.positionMm})).sort((a,b)=>a.terminal.localeCompare(b.terminal))})).sort((a,b)=>a.partId.localeCompare(b.partId));
  const connections=e.connections.map(c=>{const a=`${c.from.partId}:${c.from.terminal}`,b=`${c.to.partId}:${c.to.terminal}`,forward=a<b;return {endpoints:forward?[a,b]:[b,a],wireAwg:c.wireAwg,waypointsMm:forward?(c.waypointsMm||[]):[...c.waypointsMm||[]].reverse()};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {components,connections};
}

/** Apply an inert patch, never executable CAD code or a replacement specification. */
export function applyModelRepair(input,rawPatch){
  const original=validateDesignSpec(input),next=structuredClone(original);
  object(rawPatch,original.electrical?['updates','assemblyUpdates','electrical']:['updates','assemblyUpdates'],'repair');
  const seen=new Set();
  for(const [index,update] of updates(rawPatch.updates,'updates',original.electrical?0:1).entries()){
    const label=`updates[${index}]`;object(update,['partId','changes'],label);
    const part=next.parts.find(part=>part.id===update.partId);
    if(!part)fail(`${label}: unknown existing part ID.`);
    if(seen.has(part.id))fail(`${label}: duplicate part ID ${part.id}.`);
    seen.add(part.id);
    Object.assign(part,changes(update.changes,part.kind==='printed'?PRINTED:PURCHASED,label+'.changes'));
  }
  if(rawPatch.electrical!==undefined)next.electrical=changes(rawPatch.electrical,['schemaVersion','components','connections','control'],'electrical');
  if(rawPatch.assemblyUpdates!==undefined){
    const steps=new Set();
    for(const [index,update] of updates(rawPatch.assemblyUpdates,'assemblyUpdates',0).entries()){
      const label=`assemblyUpdates[${index}]`;object(update,['stepId','changes'],label);
      const step=next.assembly.find(step=>step.id===update.stepId);
      if(!step)fail(`${label}: unknown existing assembly step ID.`);
      if(steps.has(step.id))fail(`${label}: duplicate assembly step ID ${step.id}.`);
      steps.add(step.id);
      Object.assign(step,changes(update.changes,['instructions','checks'],label+'.changes'));
    }
  }
  const result=validateRepair(original,validateDesignSpec(next));
  // Prose, colours, renamed wires and reordered arrays cannot fix host failures.
  const geometryChanged=JSON.stringify(result.parts)!==JSON.stringify(original.parts);
  const electricalChanged=JSON.stringify(electricalBehavior(result.electrical))!==JSON.stringify(electricalBehavior(original.electrical));
  if((!geometryChanged&&!electricalChanged)||designHash(result)===designHash(original))fail('Repair patch did not change geometry or electrical connections/anchors; refusing an unchanged repair.');
  return result;
}
