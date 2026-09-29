import { createHash } from 'node:crypto';
import { controllerDecision } from '../shared/car-contract.mjs';
import { engineeringChecks } from '../engineering/physics.mjs';
import {validateElectrical,electricalChecks} from './studio-electrical.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BASE_KEYS = ['schemaVersion', 'title', 'description', 'units', 'requirements', 'assumptions', 'unknowns', 'questions', 'parts', 'assembly', 'physicsInputs', 'verificationRequests', 'electrical', 'buildItems'];
const PART_KEYS = ['id', 'name', 'kind', 'material', 'color', 'shape', 'position', 'rotation', 'fillet', 'holes', 'pockets', 'source', 'explanation'];
export const PHYSICS_RANGES = Object.freeze(Object.fromEntries(Object.entries({
  massKg: [0.01, 10], rollingResistance: [0, 2], wheelRadiusMm: [1, 250], motorTorqueNm: [0.00001, 20],
  driveMotors: [1, 8], motorVoltage: [1, 24], batteryVoltage: [1, 24], motorStallA: [0.001, 100],
  driverContinuousA: [0.001, 100], batteryMaxA: [0.001, 100], targetSpeedMS: [0, 5], thresholdDbfs: [-60, -5],
  motorNoLoadRpm: [1, 100000], motorStallTorqueNm: [0.00001, 20], motorNoLoadA: [0, 100],
  accelerationMS2: [0, 10], gradeDeg: [0, 45], tractionCoefficient: [0.01, 2], drivenWeightFraction: [0.01, 1],
  transmissionEfficiency: [0.01, 1], motorContinuousTorqueFraction: [0.01, 1],
  batteryMaxVoltage: [1, 24], driverMinVoltage: [0, 24], driverMaxVoltage: [1, 24],
  batteryCapacityAh: [0.001, 100], batteryUsableFraction: [0.01, 1], logicCurrentA: [0, 20],
  beamSpanMm: [1, 500], beamWidthMm: [1, 500], beamThicknessMm: [1, 100], structuralLoadN: [0.001, 10000],
  materialModulusMPa: [1, 1000000], materialAllowableMPa: [0.1, 10000], structuralSafetyFactor: [1, 20], maxDeflectionMm: [0.001, 100],
}).map(([key, bounds]) => [key, Object.freeze(bounds)])));

function fail(path, message) { throw new Error(`${path}: ${message}`); }
function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path, 'expected a plain object');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key)) fail(path, `unsupported key ${String(key)}`);
    if (!('value' in Object.getOwnPropertyDescriptor(value, key))) fail(path, 'accessors are not allowed');
  }
  return value;
}
function string(value, path, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path, `expected nonempty text up to ${max} characters`);
  return value.trim();
}
function id(value, path) { if (typeof value !== 'string' || !ID.test(value)) fail(path, 'expected a stable ASCII identifier'); return value; }
function number(value, min, max, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `expected a finite number between ${min} and ${max}`);
  return value === 0 ? 0 : value;
}
function array(value, min, max, path, mapper) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected ${min}..${max} items`);
  return Array.from(value, (item, index) => mapper(item, `${path}[${index}]`));
}
function textList(value, max, path) { return array(value, 0, max, path, (item, p) => string(item, p)); }
function unique(values, path) { if (new Set(values).size !== values.length) fail(path, 'duplicate identifiers or references'); }
function vector(value, min, max, path) { return array(value, 3, 3, path, (n, p) => number(n, min, max, p)); }
function oneOf(value, values, path) { if (!values.includes(value)) fail(path, `expected one of ${values.join(', ')}`); return value; }

function unionPrimitive(value, path) {
  object(value, ['type', 'size', 'radius', 'height', 'position', 'rotation'], path);
  let clean;
  if (value.type === 'box') {
    object(value, ['type', 'size', 'position', 'rotation'], path);
    clean = {type:'box', size:vector(value.size, 1, 500, `${path}.size`)};
  } else if (value.type === 'cylinder') {
    object(value, ['type', 'radius', 'height', 'position', 'rotation'], path);
    clean = {type:'cylinder', radius:number(value.radius, 1, 250, `${path}.radius`), height:number(value.height, 1, 500, `${path}.height`)};
  } else fail(`${path}.type`, 'union members must be basic boxes or cylinders, not recursive or catalog shapes');
  return {...clean, position:vector(value.position, -250, 250, `${path}.position`), rotation:vector(value.rotation, -360, 360, `${path}.rotation`)};
}
const primitiveMinimum = shape => shape.type === 'box' ? Math.min(...shape.size) : Math.min(shape.radius * 2, shape.height);

/** Strict, inert data only: no executable CAD scripts, templates, links to execute or extra keys. */
export function validateDesignSpec(input) {
  object(input, BASE_KEYS, 'design');
  if (input.schemaVersion !== 1) fail('schemaVersion', 'expected 1');
  if (input.units !== 'mm') fail('units', 'expected mm; unit conversion must be explicit before submission');
  const spec = {
    schemaVersion: 1, title: string(input.title, 'title', 160), description: string(input.description, 'description', 4000), units: 'mm',
    requirements: array(input.requirements, 1, 40, 'requirements', (r, path) => {
      object(r, ['id', 'text'], path); return { id: id(r.id, `${path}.id`), text: string(r.text, `${path}.text`) };
    }),
    assumptions: textList(input.assumptions, 40, 'assumptions'), unknowns: textList(input.unknowns, 40, 'unknowns'),
    questions: array(input.questions, 0, 10, 'questions', (q, path) => {
      object(q, ['id', 'question', 'options'], path);
      const item = { id: id(q.id, `${path}.id`), question: string(q.question, `${path}.question`) };
      if (q.options !== undefined) item.options = array(q.options, 2, 6, `${path}.options`, (x, p) => string(x, p, 240));
      return item;
    }),
    parts: array(input.parts, 0, 48, 'parts', (part, path) => {
      object(part, PART_KEYS, path);
      const shape = object(part.shape, ['type', 'size', 'radius', 'height', 'catalogId', 'sourceSha256', 'solids'], `${path}.shape`);
      let cleanShape;
      if (shape.type === 'box') {
        object(shape, ['type', 'size'], `${path}.shape`);
        cleanShape = { type: 'box', size: vector(shape.size, 1, 500, `${path}.shape.size`) };
      } else if (shape.type === 'cylinder') {
        object(shape, ['type', 'radius', 'height'], `${path}.shape`);
        cleanShape = { type: 'cylinder', radius: number(shape.radius, 1, 250, `${path}.shape.radius`), height: number(shape.height, 1, 500, `${path}.shape.height`) };
      } else if (shape.type === 'union') {
        object(shape, ['type', 'solids'], `${path}.shape`);
        if (part.kind !== 'printed') fail(`${path}.shape`, 'union geometry is only allowed for printed parts');
        cleanShape = {type:'union', solids:array(shape.solids, 2, 8, `${path}.shape.solids`, unionPrimitive)};
      } else if (shape.type === 'library') {
        object(shape, ['type','sourceSha256'], `${path}.shape`);
        if(typeof shape.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(shape.sourceSha256))fail(`${path}.shape.sourceSha256`,'full lowercase source SHA256 required');
        if(part.fillet!==undefined||part.holes!==undefined||part.pockets!==undefined)fail(path,'library source geometry cannot be modified');
        cleanShape={type:'library',sourceSha256:shape.sourceSha256};
      } else if (shape.type === 'catalog') {
        object(shape, ['type', 'catalogId'], `${path}.shape`);
        if (part.kind !== 'purchased') fail(`${path}.shape`, 'catalog geometry is only allowed for purchased parts');
        cleanShape = {type:'catalog', catalogId:id(shape.catalogId, `${path}.shape.catalogId`)};
        if (part.fillet !== undefined || part.holes !== undefined || part.pockets !== undefined) fail(path, 'catalog geometry cannot be modified by request features');
      } else fail(`${path}.shape.type`, 'only box, cylinder, printed union, catalog and SHA-bound library geometry are supported');
      if (typeof part.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(part.color)) fail(`${path}.color`, 'expected #RRGGBB');
      const result = {
        id: id(part.id, `${path}.id`), name: string(part.name, `${path}.name`, 160),
        kind: oneOf(part.kind, ['printed', 'purchased'], `${path}.kind`), material: string(part.material, `${path}.material`, 160), color: part.color.toUpperCase(),
        shape: cleanShape, position: vector(part.position, -500, 500, `${path}.position`), rotation: vector(part.rotation, -360, 360, `${path}.rotation`),
      };
      const smallest = ['catalog','library'].includes(cleanShape.type) ? 0 : cleanShape.type === 'union' ? Math.min(...cleanShape.solids.map(primitiveMinimum)) : primitiveMinimum(cleanShape);
      if (part.fillet !== undefined) result.fillet = number(part.fillet, 0, Math.min(100,smallest * 0.49), `${path}.fillet`);
      if (part.holes !== undefined) result.holes = array(part.holes, 0, 24, `${path}.holes`, (hole, p) => {
        object(hole, ['axis', 'diameter', 'position', 'depth'], p);
        const clean = { axis: oneOf(hole.axis, ['x', 'y', 'z'], `${p}.axis`), diameter: number(hole.diameter, 1, 500, `${p}.diameter`), position: vector(hole.position, -500, 500, `${p}.position`) };
        // Omission retains the legacy through-hole and its canonical hash.
        if (Object.hasOwn(hole, 'depth')) clean.depth = number(hole.depth, 0.5, 500, `${p}.depth`);
        return clean;
      });
      if (part.pockets !== undefined) {
        if (part.kind !== 'printed') fail(`${path}.pockets`, 'pockets are only allowed on printed parts');
        result.pockets = array(part.pockets, 0, 8, `${path}.pockets`, (pocket, p) => {
          object(pocket, ['size','position'], p);
          return {size:vector(pocket.size, 0.5, 500, `${p}.size`), position:vector(pocket.position, -500, 500, `${p}.position`)};
        });
      }
      if (part.source !== undefined) result.source = string(part.source, `${path}.source`);
      // Optional intent, not evidence. Never insert defaults into legacy designs:
      // their canonical bytes and existing evidence hashes must remain stable.
      if (part.explanation !== undefined) {
        object(part.explanation, ['purpose', 'placementReason', 'selectionReason'], `${path}.explanation`);
        result.explanation = Object.fromEntries(['purpose', 'placementReason', 'selectionReason'].map(key =>
          [key, string(part.explanation[key], `${path}.explanation.${key}`, 1000)]));
      }
      return result;
    }),
    assembly: array(input.assembly, 0, 48, 'assembly', (step, path) => {
      object(step, ['id', 'title', 'partIds', 'requires', 'instructions', 'checks'], path);
      return {
        id: id(step.id, `${path}.id`), title: string(step.title, `${path}.title`, 160),
        partIds: array(step.partIds, 1, 24, `${path}.partIds`, id), requires: array(step.requires, 0, 47, `${path}.requires`, id),
        instructions: array(step.instructions, 1, 12, `${path}.instructions`, (x, p) => string(x, p)),
        checks: array(step.checks, 1, 12, `${path}.checks`, (x, p) => string(x, p)),
      };
    }),
  };
  for (const key of ['requirements', 'questions', 'parts', 'assembly']) unique(spec[key].map((x) => x.id), key);
  if (!spec.parts.length && !spec.questions.length) fail('parts', 'provide at least one part or an essential clarification question');
  if (spec.parts.length && !spec.assembly.length) fail('assembly', 'every design part needs an assembly or inspection step');
  const partIds = new Set(spec.parts.map((x) => x.id));
  const steps = new Map(spec.assembly.map((x) => [x.id, x]));
  const referenced = new Set();
  for (const step of spec.assembly) {
    unique(step.partIds, `assembly.${step.id}.partIds`); unique(step.requires, `assembly.${step.id}.requires`);
    for (const partId of step.partIds) { if (!partIds.has(partId)) fail(`assembly.${step.id}`, `unknown part ${partId}`); referenced.add(partId); }
    for (const prerequisite of step.requires) if (!steps.has(prerequisite)) fail(`assembly.${step.id}`, `unknown prerequisite ${prerequisite}`);
  }
  for (const partId of partIds) if (!referenced.has(partId)) fail('assembly', `part ${partId} has no assembly/inspection step`);
  const visiting = new Set(); const visited = new Set();
  function visit(stepId) {
    if (visiting.has(stepId)) fail('assembly', 'dependency cycle');
    if (visited.has(stepId)) return;
    visiting.add(stepId); for (const dep of steps.get(stepId).requires) visit(dep);
    visiting.delete(stepId); visited.add(stepId);
  }
  for (const stepId of steps.keys()) visit(stepId);
  if(input.verificationRequests!==undefined){
    const requirementIds=new Set(spec.requirements.map(r=>r.id));
    const ref=(value,p)=>{const result=id(value,p);if(!partIds.has(result))fail(p,'unknown part');return result;};
    spec.verificationRequests=array(input.verificationRequests,0,12,'verificationRequests',(r,p)=>{
      object(r,['id','requirementId','type','partIds','maxSizeMm','shaftPartId','holePartId','holeIndex','minimumEngagementMm','diametralClearanceMm','axis','originMm','minDeg','maxDeg','framePartId','shaftInterfaceId','borePartId','boreInterfaceId'],p);
      const common={id:id(r.id,`${p}.id`),requirementId:id(r.requirementId,`${p}.requirementId`),type:r.type};
      if(!requirementIds.has(common.requirementId))fail(p,'unknown requirement');
      if(r.type==='envelope'){
        object(r,['id','requirementId','type','partIds','maxSizeMm'],p);
        return {...common,partIds:array(r.partIds,1,48,`${p}.partIds`,ref),maxSizeMm:vector(r.maxSizeMm,1,1000,`${p}.maxSizeMm`)};
      }
      if(r.type==='shaftHole'){
        object(r,['id','requirementId','type','shaftPartId','holePartId','holeIndex','minimumEngagementMm','diametralClearanceMm'],p);
        const shaftPartId=ref(r.shaftPartId,`${p}.shaftPartId`),holePartId=ref(r.holePartId,`${p}.holePartId`),holeIndex=number(r.holeIndex,0,23,`${p}.holeIndex`);
        if(shaftPartId===holePartId)fail(p,'shaftPartId and holePartId must name distinct parts');
        if(!Number.isInteger(holeIndex))fail(`${p}.holeIndex`,'must be an integer');
        if(!spec.parts.find(x=>x.id===holePartId).holes?.[holeIndex])fail(`${p}.holeIndex`,`${holePartId} has no declared holes[${holeIndex}]. shaftHole requires an explicit holes entry on the target part. Catalog bores are not declared holes; do not invent a holeIndex or modify source CAD. Keep that unsupported interface UNKNOWN and omit this unsupported request.`);
        const gap=array(r.diametralClearanceMm,2,2,`${p}.diametralClearanceMm`,(n,q)=>number(n,0,5,q));if(gap[0]>gap[1])fail(`${p}.diametralClearanceMm`,'clearance interval reversed');
        return {...common,shaftPartId,holePartId,holeIndex,minimumEngagementMm:number(r.minimumEngagementMm,.1,500,`${p}.minimumEngagementMm`),diametralClearanceMm:gap};
      }
      if(r.type==='catalogMate'){
        object(r,['id','requirementId','type','shaftPartId','shaftInterfaceId','borePartId','boreInterfaceId','minimumEngagementMm','diametralClearanceMm'],p);
        const shaftPartId=ref(r.shaftPartId,`${p}.shaftPartId`),borePartId=ref(r.borePartId,`${p}.borePartId`);
        if(shaftPartId===borePartId)fail(p,'catalogMate requires distinct parts');
        if([shaftPartId,borePartId].some(pid=>spec.parts.find(x=>x.id===pid).shape.type!=='catalog'))fail(p,'catalogMate requires two source-catalog parts; use shaftHole for a primitive pin and declared hole');
        const gap=array(r.diametralClearanceMm,2,2,`${p}.diametralClearanceMm`,(n,q)=>number(n,0,5,q));if(gap[0]>gap[1])fail(`${p}.diametralClearanceMm`,'clearance interval reversed');
        return {...common,shaftPartId,shaftInterfaceId:id(r.shaftInterfaceId,`${p}.shaftInterfaceId`),borePartId,boreInterfaceId:id(r.boreInterfaceId,`${p}.boreInterfaceId`),minimumEngagementMm:number(r.minimumEngagementMm,.1,500,`${p}.minimumEngagementMm`),diametralClearanceMm:gap};
      }
      if(r.type==='rotationSweep'){
        object(r,['id','requirementId','type','partIds','axis','originMm','minDeg','maxDeg','framePartId'],p);
        const minDeg=number(r.minDeg,-180,0,`${p}.minDeg`),maxDeg=number(r.maxDeg,0,180,`${p}.maxDeg`);if(minDeg===maxDeg)fail(p,'rotation interval must be nonzero');
        return {...common,partIds:array(r.partIds,1,8,`${p}.partIds`,ref),axis:oneOf(r.axis,['x','y','z'],`${p}.axis`),originMm:vector(r.originMm,-500,500,`${p}.originMm`),minDeg,maxDeg,...r.framePartId!==undefined?{framePartId:ref(r.framePartId,`${p}.framePartId`)}:{}};
      }
      fail(p,'unsupported verification tool');
    });
    unique(spec.verificationRequests.map(r=>r.id),'verificationRequests');
    for(const r of spec.verificationRequests)if(r.partIds)unique(r.partIds,'verificationRequests.partIds');
    if(spec.verificationRequests.filter(r=>r.type==='rotationSweep').length>3)fail('verificationRequests','at most three motion sweeps');
  }
  if (input.physicsInputs !== undefined) {
    object(input.physicsInputs, Object.keys(PHYSICS_RANGES), 'physicsInputs'); spec.physicsInputs = {};
    for (const [key, bounds] of Object.entries(PHYSICS_RANGES)) {
      if (input.physicsInputs[key] === undefined) continue;
      const path = `physicsInputs.${key}`; const item = object(input.physicsInputs[key], ['value', 'basis', 'source'], path);
      const value = number(item.value, bounds[0], bounds[1], `${path}.value`);
      if (key === 'driveMotors' && !Number.isInteger(value)) fail(`${path}.value`, 'expected an integer');
      spec.physicsInputs[key] = { value, basis: oneOf(item.basis, ['ASSUMED', 'USER', 'MANUFACTURER', 'MEASURED'], `${path}.basis`), source: string(item.source, `${path}.source`) };
    }
  }
  if(input.buildItems!==undefined){
    spec.buildItems=array(input.buildItems,0,40,'buildItems',(item,p)=>{
      object(item,['id','name','kind','quantity','unit','specification','source','partIds'],p);
      const result={id:id(item.id,p+'.id'),name:string(item.name,p+'.name',160),kind:oneOf(item.kind,['fastener','connector','consumable','tool'],p+'.kind'),quantity:number(item.quantity,.001,10000,p+'.quantity'),unit:oneOf(item.unit,['piece','mm','g','set'],p+'.unit'),specification:string(item.specification,p+'.specification',500),source:string(item.source,p+'.source'),partIds:array(item.partIds,1,24,p+'.partIds',(v,q)=>{const value=id(v,q);if(!partIds.has(value))fail(q,'unknown part');return value;})};
      if(partIds.has(result.id))fail(p+'.id','build-item ID must differ from geometric part IDs');
      if(['piece','set'].includes(result.unit)&&!Number.isInteger(result.quantity))fail(p+'.quantity','discrete items require integer quantities');
      return result;
    });unique(spec.buildItems.map(x=>x.id),'buildItems');
  }
  if(input.electrical!==undefined)spec.electrical=validateElectrical(input.electrical,spec);
  return spec;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function designHash(spec) { return createHash('sha256').update(canonical(validateDesignSpec(spec))).digest('hex'); }

/** Host-only verifier. cadResult MUST come from the kernel worker, never a submitted model/reviewer response. */
export function verifyDesign(input, cadResult = null) {
  const spec = validateDesignSpec(input); const revisionHash = designHash(spec); const claims = [];
  const add = (id, label, status, critical, method, observed, required, details) => claims.push({ id, label, status, critical, method, observed, required, details });
  add('schema', 'Bounded design data and explicit units', 'PASS', true, 'Strict schema validation', `${spec.parts.length} parts; all linear geometry in mm; rotations in degrees`, 'Finite bounded values; allowlisted primitives; no executable code or unknown keys', 'This checks data structure, not correctness of requirement interpretation.');
  add('assembly-graph', 'Assembly references and dependency graph', spec.parts.length ? 'PASS' : 'UNKNOWN', true, 'Reference resolution and directed-cycle detection', `${spec.assembly.length} steps; all declared parts covered`, 'Every part referenced; valid prerequisites; acyclic graph', 'Does not prove tool access, mechanical fit, wiring or successful physical assembly.');
  add('clarifications', 'Essential clarification questions resolved', spec.questions.length ? 'UNKNOWN' : 'PASS', true, 'Outstanding-question count', spec.questions.map((q) => `${q.id}: ${q.question}`).join('; ') || 'No declared pending questions', 'No unanswered essential questions before release', 'The absence of a question is not proof that the model found every missing input.');
  add('declared-unknowns', 'Declared unknowns resolved', spec.unknowns.length ? 'UNKNOWN' : 'PASS', true, 'Unknown-input inventory', spec.unknowns.join('; ') || 'No declared unknowns', 'Resolve design-dependent unknowns with evidence', 'A model cannot verify an assumption merely by omitting it from this list.');
  const matching = cadResult && cadResult.revisionHash === revisionHash;
  if (!matching) {
    add('cad-solids', 'Current-revision CAD kernel solids', 'UNKNOWN', true, 'Revision-bound CAD worker result', cadResult ? 'Stale or missing revision hash' : 'No kernel result', 'Matching revision; exactly one valid positive-volume solid per declared part', 'A render, filename, model assertion or earlier revision is not CAD evidence.');
  } else {
    const records = Array.isArray(cadResult.parts) ? cadResult.parts : [];
    const expected = new Set(spec.parts.map((p) => p.id)); const ids = records.map((p) => p?.id);
    const exact = records.length === expected.size && new Set(ids).size === ids.length && ids.every((x) => expected.has(x));
    const countsOK = (record) => {
      const part = spec.parts.find(p=>p.id===record?.id);
      return part?.kind==='purchased' && ['catalog','library'].includes(part.shape.type) ? Number.isInteger(record.solidCount) && record.solidCount>=1 : record?.solidCount===1;
    };
    const explicitFailure = Array.isArray(cadResult.errors) && cadResult.errors.length > 0 || records.some((p) => p?.valid === false || typeof p?.volumeMm3 === 'number' && (!Number.isFinite(p.volumeMm3) || p.volumeMm3 <= 0) || typeof p?.solidCount === 'number' && !countsOK(p));
    const valid = exact && records.length > 0 && records.every((p) => p.valid === true && Number.isFinite(p.volumeMm3) && p.volumeMm3 > 0 && countsOK(p));
    add('cad-solids', 'Current-revision CAD kernel solids', explicitFailure ? 'FAIL' : valid ? 'PASS' : 'UNKNOWN', true, 'CAD worker validity, volume, solid count and exact part-ID coverage', `${records.length}/${expected.size} part records; exact coverage ${exact}; valid ${valid}`, 'One printed solid; purchased catalog components may contain multiple positive solids', 'Catalog source geometry is hash-bound but not physical fit certification. Other purchased geometry remains an envelope.');
    for (const part of spec.parts) {
      const matches = records.filter((p) => p?.id === part.id);
      const record = matches.length === 1 ? matches[0] : null;
      const state = record?.valid === false || typeof record?.solidCount === 'number' && !countsOK(record) || typeof record?.volumeMm3 === 'number' && (!Number.isFinite(record.volumeMm3) || record.volumeMm3 <= 0) ? 'FAIL' : record?.valid === true && countsOK(record) && Number.isFinite(record.volumeMm3) && record.volumeMm3 > 0 ? 'PASS' : 'UNKNOWN';
      add(`part-${part.id}`, `${part.name}: solid validity`, state, true, 'Revision-bound kernel part result', record ? `valid=${record.valid}; solids=${record.solidCount}; volume=${record.volumeMm3} mm³` : 'No matching part result', ['catalog','library'].includes(part.shape.type)?'Positive source solids':'One valid positive-volume solid', `${part.kind === 'purchased' ? ['catalog','library'].includes(part.shape.type)?'Hash-bound source geometry; exact variant and interfaces still require review. ':'Purchased component envelope only. ' : ''}Features are not tolerance/fit certification.`);
    }
    for (const check of Array.isArray(cadResult.checks) ? cadResult.checks : []) {
      if (!check || !['PASS','FAIL','UNKNOWN'].includes(check.status)) continue;
      add(`kernel-${check.id}`, String(check.label || check.id), check.status, !String(check.id).startsWith('physical:'), String(check.method || 'CAD kernel check'), check.observed, check.required, String(check.details || 'Scoped kernel result; not physical proof.'));
    }
  }
  const physics = spec.physicsInputs ?? {};
  const value = (key) => physics[key]?.value;
  const has = (keys) => keys.every((key) => physics[key] !== undefined);
  const provenance = (keys) => keys.map((key) => `${key}=${value(key)} [${physics[key]?.basis ?? 'MISSING'}; ${physics[key]?.source ?? 'no source'}]`).join('; ');
  const motorKeys = ['massKg', 'rollingResistance', 'wheelRadiusMm', 'motorTorqueNm', 'driveMotors'];
  if (Object.keys(physics).some((key) => key !== 'thresholdDbfs')) {
    if (has(motorKeys)) {
      const resistingForceN = value('massKg') * 9.80665 * value('rollingResistance');
      const driveForceN = value('motorTorqueNm') * value('driveMotors') / (value('wheelRadiusMm') / 1000);
      add('rolling-force', 'Conditional level-ground rolling-force estimate', driveForceN >= resistingForceN ? 'PASS' : 'FAIL', true, 'F_required=m*g*Crr; F_available=n*tau/r, mm converted to metres', { resistingForceN, driveForceN, ratio: resistingForceN > 0 ? driveForceN / resistingForceN : null }, 'Available nominal force >= nominal rolling resistance', `${provenance(motorKeys)}. No acceleration, slope, traction, gearbox loss, transient or torque-speed validation. This is an analytical comparison, not a working-car claim.`);
    } else add('rolling-force', 'Conditional level-ground rolling-force estimate', 'UNKNOWN', true, 'Analytical input completeness', motorKeys.filter((key) => !physics[key]), 'Mass, rolling coefficient, wheel radius, usable output torque and motor count', 'Do not substitute an invented stall torque for continuous output torque.');
    const electricalKeys = ['motorVoltage', 'batteryVoltage', 'motorStallA', 'driverContinuousA', 'batteryMaxA', 'driveMotors'];
    if (has(electricalKeys)) {
      const voltageOK = value('batteryVoltage') <= value('motorVoltage');
      const driverOK = value('driverContinuousA') >= value('motorStallA');
      const batteryOK = value('batteryMaxA') >= value('motorStallA') * value('driveMotors');
      add('electrical-nominal', 'Nominal voltage/current screening', voltageOK && driverOK && batteryOK ? 'PASS' : 'FAIL', true, 'Nominal battery <= motor voltage; per-channel driver >= stall current; battery >= total stall current', { voltageOK, driverOK, batteryOK, totalStallA: value('motorStallA') * value('driveMotors') }, 'All three conservative nominal inequalities hold', `${provenance(electricalKeys)}. driverContinuousA is per independently driven motor channel. Nominal battery voltage is NOT maximum charge voltage; regulator/driver voltage limits, wiring, fuse, thermal duty and battery protection are unverified.`);
    } else add('electrical-nominal', 'Nominal voltage/current screening', 'UNKNOWN', true, 'Electrical input completeness', electricalKeys.filter((key) => !physics[key]), 'Motor/battery voltage, stall/driver/battery current and motor count', 'No component ratings may be invented to pass this check.');
    add('component-evidence', 'Component ratings and measured interfaces', 'UNKNOWN', true, 'Source verification boundary', Object.keys(physics).map((key) => `${key}: ${physics[key].basis}`).join('; '), 'Observed matching manufacturer data or measurement records', 'A source string or MANUFACTURER/MEASURED label is metadata, not proof that its claim was checked.');
    add('speed-and-dynamics', 'Requested motion, speed and traction', 'UNKNOWN', true, 'No validated dynamic simulation or bench evidence', physics.targetSpeedMS ? `Target ${value('targetSpeedMS')} m/s` : 'Target speed unspecified', 'Torque-speed curve, load, gearing, grip, transient/stop tests', 'The separate loaded operating-point calculation is conditional; neither it nor static force arithmetic proves physical speed, stopping distance or robustness to motor self-noise.');
  }
  if (physics.thresholdDbfs) {
    const threshold = value('thresholdDbfs');
    const run = (changes = {}) => controllerDecision({ level: threshold - 1, threshold, armed: true, emergencyStop: false, ageMs: 0, ...changes }).moving;
    const checks = { below: !run(), above: run({ level: threshold + 1 }), equality: !run({ level: threshold }), disarmed: !run({ level: 0, armed: false }), stop: !run({ level: 0, emergencyStop: true }), stale: !run({ level: 0, ageMs: 251 }), missing: !run({ level: NaN }) };
    add('sound-controller', 'Relative-loudness controller software cases', Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', true, 'Deterministic boundary and negative-control tests', checks, 'Forward while fresh level > threshold; otherwise stop; stop/disarm dominates', 'Relative dBFS only, NOT calibrated dB SPL. No microphone, firmware timing, motor output or actual motion is validated.');
  }
  for (const check of engineeringChecks(physics)) {if(spec.electrical?.control&&check.id==='motion-operating-point'){check.label='Conditional full-rail loaded speed, torque and traction';check.details+=' This arithmetic is at the declared full motor rail, not the exported output-disabled, PWM-limited commissioning mode. See electrical-drive-settings; actual speed remains UNKNOWN.';}claims.push(check);}
  add('requirement-coverage', 'Functional requirement acceptance evidence', 'UNKNOWN', true, 'Requirement-to-test coverage review needed', spec.requirements.map((r) => r.id).join(', '), 'Executable or observed acceptance evidence for every functional requirement', 'Free-text requirements are preserved, not silently converted into PASS by a model reviewer.');
  add('assembly-fit', 'Interference, tolerance and assembly access', 'UNKNOWN', true, 'No validated fit/motion evidence', 'Nominal feature definitions only', 'Clearance, mating tolerances, fasteners, tool access and motion envelope checks', 'A valid solid and acyclic tutorial are not evidence that parts fit together.');
  add('manufacturing', 'Printer/material process readiness', 'UNKNOWN', true, 'No selected validated slicing process', 'Printer is not defaulted to H2C', 'User-selected printer/nozzle/material and checked slice; fit coupon where needed', 'Do not send a print job or certify structural strength from a preview.');
  add('physical', 'Physical function and toy safety', 'UNKNOWN', false, 'No physical test evidence accepted by this verifier', 'Not tested', 'Observed assembled prototype and relevant safety checks', 'No claim of child safety, battery safety, impact resistance or real-world operation.');
  for(const claim of electricalChecks(spec))claims.push(claim);
  if(!spec.electrical&&(spec.physicsInputs?.driveMotors||spec.physicsInputs?.thresholdDbfs))add('electrical-design-missing','Structured electrical connections','UNKNOWN',true,'Electrical contract availability','Legacy powered design has no structured electrical block','Netlist-bound diagram, firmware and instructions','No connections or firmware compatibility may be inferred from prose alone.');
  const overall = claims.some((claim) => claim.critical && claim.status === 'FAIL') ? 'FAILED' : claims.some((claim) => claim.critical && claim.status === 'UNKNOWN') ? 'UNVERIFIED' : 'VERIFIED_WITHIN_SCOPE';
  return { revisionHash, claims, overall, physical: 'UNKNOWN', limitations: [
    'Bounded CAD grammar: boxes/cylinders, printed unions of 2–8 basic primitives, through-holes, fillets and rectangular pockets; hash-bound purchased catalog shapes. No arbitrary model code, sculpting, gears or threads. Union members fuse into one solid; separate parts cannot overlap.',
    'All model prose and source labels remain unverified input; only revision-matched host tool observations can support tool claims.',
    'Analytical PASS applies only to the displayed equations and assumptions, not a physically working or safe toy.',
    'No FEA, thermal simulation, dynamic assembly collision solver, calibrated sound measurement or physical test has been performed.',
    'Tutorial checks and UI completion clicks do not establish physical completion. Printed parts, source catalog assemblies and unsourced purchased envelopes must be distinguished.',
  ] };
}
