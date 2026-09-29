import { PHYSICS_RANGES } from './studio-contract.mjs';
import {ELECTRICAL_JSON_SCHEMA} from './studio-electrical.mjs';

// Ollama's format accepts a JSON Schema, not an example response:
// https://docs.ollama.com/capabilities/structured-outputs
// Keep this grammar inert and bounded. validateDesignSpec remains authoritative
// for trimmed/control-free text, unique IDs, references/DAG, part coverage,
// clarification-only empty parts and geometry-dependent fillet limits.
const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const id = () => ({ type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' });
const number = (minimum, maximum, type = 'number') => ({ type, minimum, maximum });
const array = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const vector = (min, max) => array(number(min, max), 3, 3);
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

const unionPrimitive = {anyOf:[
  object({type:{type:'string',enum:['box']},size:vector(1,500),position:vector(-250,250),rotation:vector(-360,360)}),
  object({type:{type:'string',enum:['cylinder']},radius:number(1,250),height:number(1,500),position:vector(-250,250),rotation:vector(-360,360)}),
]};
const shape = {
  anyOf: [
    object({ type: { type: 'string', enum: ['box'] }, size: vector(1, 500) }),
    object({ type: { type: 'string', enum: ['cylinder'] }, radius: number(1, 250), height: number(1, 500) }),
    object({ type: { type:'string', enum:['union'] }, solids:array(unionPrimitive,2,8) }),
    object({ type: { type: 'string', enum: ['catalog'] }, catalogId: id() }),
    object({ type: { type:'string', enum:['library'] }, sourceSha256:{type:'string',pattern:'^[a-f0-9]{64}$',minLength:64,maxLength:64} }),
  ],
};
const hole = object({ axis: { type: 'string', enum: ['x', 'y', 'z'] }, diameter: number(1, 500), position: vector(-500, 500), depth: number(0.5, 500) }, ['axis', 'diameter', 'position']);
const part = object({
  id: id(), name: text(160), kind: { type: 'string', enum: ['printed', 'purchased'] },
  material: text(160), color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  shape, position: vector(-500, 500), rotation: vector(-360, 360),
  explanation: object({purpose:text(1000),placementReason:text(1000),selectionReason:text(1000)}),
  fillet: number(0, 100), holes: array(hole, 0, 24), pockets: array(object({size:vector(0.5,500),position:vector(-500,500)}),0,8), source: text(),
}, ['id', 'name', 'kind', 'material', 'color', 'shape', 'position', 'rotation']);
const question = object({ id: id(), question: text(), options: array(text(240), 2, 6) }, ['id', 'question']);
const verificationRequest={anyOf:[
  object({id:id(),requirementId:id(),type:{type:'string',enum:['envelope']},partIds:array(id(),1,48),maxSizeMm:vector(1,1000)}),
  object({id:id(),requirementId:id(),type:{type:'string',enum:['shaftHole']},shaftPartId:id(),holePartId:id(),holeIndex:number(0,23,'integer'),minimumEngagementMm:number(.1,500),diametralClearanceMm:array(number(0,5),2,2)}),
  object({id:id(),requirementId:id(),type:{type:'string',enum:['catalogMate']},shaftPartId:id(),shaftInterfaceId:id(),borePartId:id(),boreInterfaceId:id(),minimumEngagementMm:number(.1,500),diametralClearanceMm:array(number(0,5),2,2)}),
  object({id:id(),requirementId:id(),type:{type:'string',enum:['rotationSweep']},partIds:array(id(),1,8),axis:{type:'string',enum:['x','y','z']},originMm:vector(-500,500),minDeg:number(-180,0),maxDeg:number(0,180),framePartId:id()},['id','requirementId','type','partIds','axis','originMm','minDeg','maxDeg']),
]};
const assembly = object({
  id: id(), title: text(160), partIds: array(id(), 1, 24), requires: array(id(), 0, 47),
  instructions: array(text(), 1, 12), checks: array(text(), 1, 12),
});
const physicsInputs = object(Object.fromEntries(Object.entries(PHYSICS_RANGES).map(([key, [min, max]]) => [key, object({
  value: number(min, max, key === 'driveMotors' ? 'integer' : 'number'),
  basis: { type: 'string', enum: ['ASSUMED', 'USER', 'MANUFACTURER', 'MEASURED'] }, source: text(),
})])), []);

function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

export const DESIGN_JSON_SCHEMA = freeze(object({
  schemaVersion: { type: 'integer', enum: [1] }, title: text(160), description: text(4000),
  units: { type: 'string', enum: ['mm'] },
  requirements: array(object({ id: id(), text: text() }), 1, 40),
  assumptions: array(text(), 0, 40), unknowns: array(text(), 0, 40), questions: array(question, 0, 10),
  parts: array(part, 0, 24), electrical:ELECTRICAL_JSON_SCHEMA, assembly: array(assembly, 0, 48), physicsInputs, verificationRequests:array(verificationRequest,0,12), buildItems:array(object({id:id(),name:text(160),kind:{type:'string',enum:['fastener','connector','consumable','tool']},quantity:number(.001,10000),unit:{type:'string',enum:['piece','mm','g','set']},specification:text(500),source:text(),partIds:array(id(),1,24)}),0,40),
}, ['schemaVersion', 'title', 'description', 'units', 'requirements', 'assumptions', 'unknowns', 'questions', 'parts', 'assembly']));

// Some llama.cpp-backed runtimes reject large bounded string repetitions during
// grammar initialization. Avoid those decoder constraints without weakening the
// authoritative validator. This is a projection, not a second contract to drift.
// https://github.com/ggml-org/llama.cpp/issues/25746
// A small enum avoids unconstrained named colours without restoring expensive
// regex grammars. The authoritative contract still accepts every valid RGB hex.
const decoderColors=['#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00','#00FFFF','#FF00FF','#FF8000','#800080','#808080','#202020','#247AAB','#F2AC43'];
function ollamaProjection(value) {
  if (Array.isArray(value)) return value.map(ollamaProjection);
  if (!value || typeof value !== 'object') return value;
  const compatible=Object.fromEntries(Object.entries(value)
    .filter(([key]) => value.type !== 'string' || !['maxLength', 'pattern'].includes(key))
    .map(([key, child]) => [key, ollamaProjection(child)]));
  if(value.type==='string'&&value.pattern==='^#[0-9a-fA-F]{6}$')compatible.enum=[...decoderColors];
  return compatible;
}

export const OLLAMA_DESIGN_SCHEMA = freeze(ollamaProjection(DESIGN_JSON_SCHEMA));

/** A prior unaccepted powered draft cannot omit its wiring again on format retry.
 * This specializes only the decoder contract, not the design or evidence.
 */
export function designSchemaForDraft(draft){
  const schema=structuredClone(OLLAMA_DESIGN_SCHEMA);
  // New circuit output always supplies proposed endpoint coordinates. This is
  // a decoder constraint only; legacy designs and their hashes stay untouched.
  schema.properties.electrical.properties.components.items.required.push('terminalAnchors');
  if(draft?.parts?.length&&(draft.electrical||draft.physicsInputs?.driveMotors||draft.physicsInputs?.thresholdDbfs)){
    schema.required.push('electrical');
    const electrical=schema.properties.electrical;
    if(draft.electrical?.control||draft.physicsInputs?.thresholdDbfs)electrical.required.push('control');
  }
  return schema;
}

/** Model-output boundary only. Empty optional operations are not machining.
 * Keep the raw response and this audit alongside it; never rewrite saved specs.
 * Nonempty features remain untouched and are rejected by the host validator. */
export function normalizeGeneratedDraft(input){
  const draft=structuredClone(input),changes=[];
  if(Array.isArray(draft?.parts))for(const [index,part] of draft.parts.entries()){
    if(!['catalog','library'].includes(part?.shape?.type))continue;
    for(const key of ['holes','pockets','fillet']){
      const value=part[key];
      if((key==='fillet'&&value===0)||(key!=='fillet'&&Array.isArray(value)&&value.length===0)){
        delete part[key];changes.push({path:`parts[${index}].${key}`,partId:part.id,removed:value,reason:'Empty source-geometry operation; source bytes unchanged'});
      }
    }
  }
  return {draft,changes};
}

/** Unchanged legacy parts may be copied exactly, without inventing historical
 * rationale. Every new or edited part must have an explicit design explanation. */
export function requireGeneratedExplanations(schema,previousSpec=null){
  const explained=structuredClone(schema.properties.parts.items);
  if(!explained.required.includes('explanation'))explained.required.push('explanation');
  const legacy=(previousSpec?.parts||[]).filter(part=>!part.explanation);
  schema.properties.parts.items=legacy.length?{anyOf:[explained,{enum:structuredClone(legacy)}]}:explained;
  return schema;
}
