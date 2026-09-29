import test from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_JSON_SCHEMA as schema, OLLAMA_DESIGN_SCHEMA, designSchemaForDraft, normalizeGeneratedDraft, requireGeneratedExplanations } from '../server/studio-schema.mjs';
import { PHYSICS_RANGES, validateDesignSpec } from '../server/studio-contract.mjs';
import {validateElectrical} from '../server/studio-electrical.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';

// Test-only evaluator for the small JSON Schema vocabulary used here. Production
// continues to use validateDesignSpec, not this helper or a model's assertions.
function accepts(rule, value) {
  if (rule.anyOf) return rule.anyOf.some((branch) => accepts(branch, value));
  if (rule.enum && !rule.enum.includes(value)) return false;
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (rule.required.some((key) => !Object.hasOwn(value, key))) return false;
    return Object.entries(value).every(([key, item]) => Object.hasOwn(rule.properties, key) && accepts(rule.properties[key], item));
  }
  if (rule.type === 'array') return Array.isArray(value) && value.length >= rule.minItems && value.length <= rule.maxItems && value.every((item) => accepts(rule.items, item));
  if (rule.type === 'string') return typeof value === 'string' && (rule.minLength === undefined || value.length >= rule.minLength) && (rule.maxLength === undefined || value.length <= rule.maxLength) && (!rule.pattern || new RegExp(rule.pattern).test(value));
  if (rule.type === 'number' || rule.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (rule.type !== 'integer' || Number.isInteger(value)) && (rule.minimum === undefined || value >= rule.minimum) && (rule.maximum === undefined || value <= rule.maximum);
  throw new Error(`Unexpected test schema type: ${rule.type}`);
}

function fixture() {
  return { schemaVersion: 1, title: 'Bench block', description: 'Unverified test geometry', units: 'mm',
    requirements: [{ id: 'R1', text: 'One bench block' }], assumptions: [], unknowns: ['Physical fit is untested'], questions: [],
    parts: [{ id: 'base', name: 'Base', kind: 'printed', material: 'PLA proposed', color: '#247AAB', shape: { type: 'box', size: [10, 20, 30] }, position: [0, 0, 0], rotation: [0, 0, 0] }],
    assembly: [{ id: 'inspect', title: 'Inspect', partIds: ['base'], requires: [], instructions: ['Inspect after manufacture'], checks: ['Record cracks or loose fragments'] }],
  };
}

test('generation records source no-ops without changing raw input or accepting machining',()=>{
  const raw=fixture();raw.parts[0].kind='purchased';raw.parts[0].shape={type:'catalog',catalogId:'source'};
  const canonical=validateDesignSpec(raw);raw.parts[0].holes=[];raw.parts[0].pockets=[];raw.parts[0].fillet=0;
  const before=structuredClone(raw),result=normalizeGeneratedDraft(raw);
  assert.deepEqual(raw,before);assert.equal(result.changes.length,3);assert.deepEqual(validateDesignSpec(result.draft),canonical);
  assert.throws(()=>validateDesignSpec(raw),/cannot be modified/);
  for(const operation of [{holes:[{axis:'z',diameter:3,position:[0,0,0]}]},{pockets:[{size:[3,3,3],position:[0,0,0]}]},{fillet:1}]){
    assert.throws(()=>validateDesignSpec(normalizeGeneratedDraft({...canonical,parts:[{...canonical.parts[0],...operation}]}).draft),/cannot be modified/);
  }
  const printed=fixture();printed.parts[0].holes=[];assert.deepEqual(normalizeGeneratedDraft(printed),{draft:printed,changes:[]});
});

test('every generated electrical block requires anchors even with no physics inputs',()=>{
  for(const draft of [null,{parts:[{id:'p'}],physicsInputs:{},electrical:{components:[{partId:'p'}],control:{}}}]){
    const decoder=designSchemaForDraft(draft);
    assert(decoder.properties.electrical.properties.components.items.required.includes('terminalAnchors'));
    assert.equal(decoder.required.includes('electrical'),Boolean(draft));
    if(draft)assert(decoder.properties.electrical.required.includes('control'));
  }
  assert(!OLLAMA_DESIGN_SCHEMA.properties.electrical.properties.components.items.required.includes('terminalAnchors'));
});

test('unchanged legacy intent can be copied but edited geometry needs a new explanation',()=>{
  const previous=fixture(),decoder=requireGeneratedExplanations(designSchemaForDraft(null),previous),part=decoder.properties.parts.items;
  assert(part.anyOf);assert.deepEqual(part.anyOf[1].enum,[previous.parts[0]]);
  assert(part.anyOf[0].required.includes('explanation'));
  const edited={...previous.parts[0],shape:{type:'box',size:[54,35,4]}};
  assert.equal(accepts(part.anyOf[0],edited),false);
  assert.equal(accepts(part.anyOf[0],{...edited,explanation:{purpose:'Mount',placementReason:'Origin',selectionReason:'PLA'}}),true);
  assert(!previous.parts[0].explanation);
});

test('schema is JSON-serializable, deeply frozen and closes every object', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema);
  function walk(rule) {
    assert.equal(Object.isFrozen(rule), true);
    if (rule.type === 'object') { assert.equal(rule.additionalProperties, false); for (const child of Object.values(rule.properties)) walk(child); }
    if (rule.type === 'array') walk(rule.items);
    for (const branch of rule.anyOf || []) walk(branch);
  }
  walk(schema);
  assert.equal(accepts(schema, fixture()), true);
  assert.doesNotThrow(() => validateDesignSpec(fixture()));
});

test('required keys, unsupported keys, enums and string caps are bounded', () => {
  for (const key of schema.required) { const spec = fixture(); delete spec[key]; assert.equal(accepts(schema, spec), false, key); }
  for (const [key, value] of [['code', 'run()'], ['units', 'cm'], ['schemaVersion', 2], ['title', ''], ['title', 'x'.repeat(161)], ['description', 'x'.repeat(4001)]]) {
    assert.equal(accepts(schema, { ...fixture(), [key]: value }), false, key);
  }
  const spec = fixture(); spec.parts[0].shape.code = 'run()'; assert.equal(accepts(schema, spec), false);
  spec.parts[0] = { ...fixture().parts[0], kind: 'executable' }; assert.equal(accepts(schema, spec), false);
  spec.parts[0] = { ...fixture().parts[0], color: 'red' }; assert.equal(accepts(schema, spec), false);
  spec.parts[0] = { ...fixture().parts[0], id: '../unsafe' }; assert.equal(accepts(schema, spec), false);
});

test('40-question regression is rejected; schema mirrors the validator 10-question ceiling', () => {
  const spec = fixture(); spec.parts = []; spec.assembly = [];
  const questions = (count) => Array.from({ length: count }, (_, n) => ({ id: `Q${n}`, question: `Essential question ${n}?`, options: ['First', 'Second'] }));
  for (const count of [1, 3, 10]) { spec.questions = questions(count); assert.equal(accepts(schema, spec), true); assert.doesNotThrow(() => validateDesignSpec(spec)); }
  for (const count of [11, 40]) { spec.questions = questions(count); assert.equal(accepts(schema, spec), false); assert.throws(() => validateDesignSpec(spec), /questions/); }
  assert.equal(accepts(schema.properties.questions.items, { id: 'Q1', question: 'Which?', options: ['Only'] }), false);
  assert.equal(accepts(schema.properties.questions.items, { id: 'Q1', question: 'Which?', options: Array(7).fill('Choice') }), false);
});

test('array cardinality limits match bounded design grammar', () => {
  for (const [key, min, max] of [['requirements', 1, 40], ['assumptions', 0, 40], ['unknowns', 0, 40], ['questions', 0, 10], ['parts', 0, 24], ['assembly', 0, 48]]) {
    assert.equal(schema.properties[key].minItems, min, key); assert.equal(schema.properties[key].maxItems, max, key);
    const seed = key === 'questions' ? { id: 'Q', question: 'Which?' } : key === 'assumptions' ? 'Assumed' : fixture()[key][0];
    assert.equal(accepts(schema.properties[key], Array(max + 1).fill(seed)), false, key);
  }
  const step = schema.properties.assembly.items.properties;
  for (const [key, min, max] of [['partIds', 1, 24], ['requires', 0, 47], ['instructions', 1, 12], ['checks', 1, 12]]) { assert.equal(step[key].minItems, min); assert.equal(step[key].maxItems, max); }
});

test('shape branches reject mixed keys and bound every vector and hole', () => {
  const part = schema.properties.parts.items;
  const valid = fixture().parts[0];
  for (const shape of [{ type: 'box', size: [1, 500, 10] }, { type: 'cylinder', radius: 250, height: 500 }]) assert.equal(accepts(part, { ...valid, shape }), true);
  for (const shape of [{ type: 'sphere', radius: 10 }, { type: 'box', size: [10, 10, 10], radius: 10 }, { type: 'box', size: [0, 10, 10] }, { type: 'box', size: [10, 501, 10] }, { type: 'box', size: [10, 10] }, { type: 'cylinder', radius: 251, height: 20 }]) assert.equal(accepts(part, { ...valid, shape }), false);
  for (const [key, value] of [['position', [501, 0, 0]], ['rotation', [0, -361, 0]], ['position', [NaN, 0, 0]], ['fillet', 101], ['fillet', -1]]) assert.equal(accepts(part, { ...valid, [key]: value }), false);
  const hole = { axis: 'z', diameter: 2, position: [0, 0, 0] };
  assert.equal(accepts(part, { ...valid, holes: Array(24).fill(hole) }), true);
  assert.equal(accepts(part, { ...valid, holes: Array(25).fill(hole) }), false);
  for (const invalid of [{ ...hole, axis: 'q' }, { ...hole, diameter: 0.5 }, { ...hole, position: [0, 0, 501] }]) assert.equal(accepts(part, { ...valid, holes: [invalid] }), false);
});

test('physics bounds come directly from the authoritative contract', () => {
  const physics = schema.properties.physicsInputs;
  assert.deepEqual(Object.keys(physics.properties), Object.keys(PHYSICS_RANGES));
  assert.deepEqual(physics.required, []);
  for (const [key, [min, max]] of Object.entries(PHYSICS_RANGES)) {
    const rule = physics.properties[key];
    assert.equal(rule.properties.value.minimum, min, key); assert.equal(rule.properties.value.maximum, max, key);
    const record = (value) => ({ value, basis: 'ASSUMED', source: 'Explicit test assumption' });
    for (const value of [min, max]) assert.equal(accepts(rule, record(value)), true, key);
    for (const value of [min - 1, max + 1, NaN, Infinity]) assert.equal(accepts(rule, record(value)), false, key);
    assert.equal(accepts(rule, { ...record(min), basis: 'VERIFIED' }), false, key);
    assert.equal(accepts(rule, { value: min, basis: 'USER' }), false, key);
  }
  assert.equal(accepts(physics.properties.driveMotors, { value: 1.5, basis: 'USER', source: 'test' }), false);
  assert.equal(accepts(physics, { unknownRating: {} }), false);
});

test('semantic crossfields and dynamic fillets still require authoritative validation', () => {
  const cycle = fixture(); cycle.assembly[0].requires = ['inspect'];
  assert.equal(accepts(schema, cycle), true); assert.throws(() => validateDesignSpec(cycle), /cycle/);
  const fillet = fixture(); fillet.parts[0].fillet = 5;
  assert.equal(accepts(schema, fillet), true); assert.throws(() => validateDesignSpec(fillet), /fillet/);
  const empty = fixture(); empty.parts = []; empty.assembly = [];
  assert.equal(accepts(schema, empty), true); assert.throws(() => validateDesignSpec(empty), /essential clarification/);
  const textOnly = fixture(); textOnly.title = '   ';
  assert.equal(accepts(schema, textOnly), true); assert.throws(() => validateDesignSpec(textOnly), /title/);
});

test('Ollama projection removes large string grammar constraints and narrows colour decoding only', () => {
  let removed = 0;
  function compare(full, compatible) {
    if (Array.isArray(full)) { assert.equal(compatible.length, full.length); full.forEach((value, index) => compare(value, compatible[index])); return; }
    if (!full || typeof full !== 'object') { assert.deepEqual(compatible, full); return; }
    assert.equal(Object.isFrozen(compatible), true);
    const expectedKeys = Object.keys(full).filter((key) => full.type !== 'string' || !['maxLength', 'pattern'].includes(key));
    const colorRule=full.type==='string'&&full.pattern==='^#[0-9a-fA-F]{6}$';
    assert.deepEqual(Object.keys(compatible),colorRule?[...expectedKeys,'enum']:expectedKeys);
    if(colorRule)assert.ok(compatible.enum.every(color=>new RegExp(full.pattern).test(color)));
    removed += Object.keys(full).length - expectedKeys.length;
    for (const key of expectedKeys) compare(full[key], compatible[key]);
  }
  compare(schema, OLLAMA_DESIGN_SCHEMA);
  assert.ok(removed > 0);
  assert.equal(schema.properties.title.maxLength, 160);
  assert.equal(OLLAMA_DESIGN_SCHEMA.properties.questions.maxItems, 10);
  assert.equal(OLLAMA_DESIGN_SCHEMA.properties.title.minLength, 1);
  assert.equal(accepts(OLLAMA_DESIGN_SCHEMA, fixture()), true);
  const forty = fixture(); forty.questions = Array.from({ length: 40 }, (_, i) => ({ id: `Q${i}`, question: 'Which?' }));
  assert.equal(accepts(OLLAMA_DESIGN_SCHEMA, forty), false);
  const long = fixture(); long.title = 'x'.repeat(161);
  assert.equal(accepts(OLLAMA_DESIGN_SCHEMA, long), true); assert.throws(() => validateDesignSpec(long), /title/);
  const unsafeId = fixture(); unsafeId.parts[0].id = '../unsafe';
  assert.equal(accepts(OLLAMA_DESIGN_SCHEMA, unsafeId), true); assert.throws(() => validateDesignSpec(unsafeId), /identifier/);
});

test('normal and adaptive decoders constrain part and wire colours while host accepts arbitrary valid hex',()=>{
  for(const decoder of [OLLAMA_DESIGN_SCHEMA,designSchemaForDraft({parts:[{id:'p'}],physicsInputs:{thresholdDbfs:{value:-25}}})]){
    for(const rule of [decoder.properties.parts.items.properties.color,decoder.properties.electrical.properties.connections.items.properties.color]){
      assert.ok(rule.enum.length>=8&&rule.enum.length<=20);assert.ok(rule.enum.every(color=>/^#[0-9A-F]{6}$/.test(color)));assert.equal(rule.pattern,undefined);for(const bad of ['red','black','#123','#GG0000'])assert.equal(accepts(rule,bad),false);assert.equal(accepts(rule,'#FF0000'),true);
    }
  }
  const part=fixture();part.parts[0].color='#a1B2c3';assert.doesNotThrow(()=>validateDesignSpec(part));assert.equal(schema.properties.parts.items.properties.color.enum,undefined);
  const electrical=electricalFixture();electrical.electrical.connections[0].color='#a1B2c3';const before=structuredClone(electrical);assert.equal(validateElectrical(electrical.electrical,electrical).connections[0].color,'#A1B2C3');assert.deepEqual(electrical,before);assert.equal(schema.properties.electrical.properties.connections.items.properties.color.enum,undefined);
});
