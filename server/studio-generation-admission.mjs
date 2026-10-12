import {validateDesignSpec,designHash,PHYSICS_RANGES} from './studio-contract.mjs';
import {engineeringChecks} from '../engineering/physics.mjs';
import {geometryIntentDiagnostics} from './studio-generation-diagnostics.mjs';
import {electricalDraftIssues} from './studio-electrical.mjs';
import {generationCatalogIssues} from './studio-catalog.mjs';
import {requestConstraintIssues} from './studio-request-constraints.mjs';
import {validateRepair,validateUserRefinement} from './studio-repair.mjs';
import {partitionGeneration} from './studio-generation-stages.mjs';
import {isDeepStrictEqual as equal} from 'node:util';
export function inspectInitialDraft(draft,catalog) {
  const issues=[];let candidate=null;let geometryDiagnostics=[];
  if(Array.isArray(draft?.parts)&&draft.parts.length>24)issues.push('General Qwen designs are limited to 24 parts; larger source kits require their explicit route.');
  try{candidate=validateDesignSpec(draft);}catch(error){issues.push(error.message);}
  if(candidate){geometryDiagnostics=geometryIntentDiagnostics(candidate);issues.push(...geometryDiagnostics.map(d=>d.message));}
  try{issues.push(...electricalDraftIssues(draft));}catch{/* Structural validation above owns malformed data. */}
  if(Array.isArray(draft?.parts)&&draft.parts.length<=48&&draft.parts.every(p=>p&&typeof p==='object')) {
    try{issues.push(...generationCatalogIssues(candidate||draft,catalog));}catch{/* Malformed fields remain rejected, never silently accepted. */}
  }
  if(draft?.parts?.length&&(draft.physicsInputs?.driveMotors||draft.physicsInputs?.thresholdDbfs)&&!draft.electrical)
    issues.push('Powered toys require the structured electrical block: component profiles, pin-to-pin connections, proposed terminalAnchors and supported control configuration. Prose wiring is not a complete design.');
  if(draft?.parts?.length&&draft.physicsInputs?.thresholdDbfs&&draft.electrical&&!draft.electrical.control)
    issues.push('Relative-loudness motion requires electrical.control bound to the wiring.');
  // Screen only finite, in-range declared numbers. Missing/invalid inputs stay
  // UNKNOWN in this diagnostic pass, not manufactured zero/default values.
  const inputs={};
  for(const [key,[min,max]] of Object.entries(PHYSICS_RANGES)){
    const input=draft?.physicsInputs?.[key];
    if(input&&Number.isFinite(input.value)&&input.value>=min&&input.value<=max&&['ASSUMED','USER','MANUFACTURER','MEASURED'].includes(input.basis)&&typeof input.source==='string'&&(key!=='driveMotors'||Number.isInteger(input.value)))inputs[key]=input;
  }
  if(draft?.parts?.length&&!draft.questions?.length)for(const check of engineeringChecks(inputs))if(check.status==='FAIL')
    issues.push(`${check.id}: declared-input screening FAIL; observed ${JSON.stringify(check.observed)}; required ${check.required}. Correct the unaccepted architecture, preserve user targets and source facts; this is not physical evidence.`.slice(0,1000));
  return {candidate,issues:[...new Set(issues)].slice(0,12),geometryDiagnostics};
}

export function architectureBindingIssues(spec,plan){
  if(!plan)return [];
  const stable=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const issues=[];
  if(stable(spec.physicsInputs||{})!==stable(plan.physicsInputs))issues.push('Full design changed the model-selected architecture physicsInputs. Preserve the accepted conditional plan exactly; do not lower targets, change ratings or drop failed inputs.');
  const actual=[...new Set(spec.parts.filter(p=>p.shape.type==='catalog').map(p=>p.shape.catalogId))].sort(),expected=[...plan.selectedCatalogIds].sort();
  if(stable(actual)!==stable(expected))issues.push('Full design catalog selections differ from the accepted model architecture. Use its exact selected native identities; no undeclared replacement or silent source omission.');
  return issues;
}
/** Apply exactly the same global gates to staged and legacy whole responses. */
export function admitGeneratedDesign(raw,{request,catalog,plan=null,requirePartExplanations=false,previousSpec=null,preserveDecisions=false,repairErrors=[],architecturePlan=null}) {
  try {
    const requestIssues=requestConstraintIssues(request,raw);if(requestIssues.length)throw new Error(requestIssues.join('; '));
    const inspected=inspectInitialDraft(raw,catalog);
    if(inspected.issues.length){
      // Retain a structured validator path only when it really caused failure.
      if(!inspected.candidate)validateDesignSpec(raw);
      const units=plan?partitionGeneration(plan):[];
      return {spec:null,issues:inspected.issues.map(message=>{
        const diagnostic=inspected.geometryDiagnostics.find(d=>d.message===message);
        const owner=diagnostic&&units.find(u=>u.kind==='part'&&u.ids.includes(diagnostic.partId));
        return {code:diagnostic?.code||'GLOBAL_ADMISSION',message,unitKeys:owner?[owner.key]:[],attribution:owner?'exact':'unknown'};
      })};
    }
    const candidate=inspected.candidate;
    if(requirePartExplanations&&candidate.parts.some(p=>!p.explanation))throw new Error('Every new part needs explanation:{purpose,placementReason,selectionReason}; this is design intent, not evidence.');
    if(preserveDecisions&&candidate.parts.some(p=>JSON.stringify(p)!==JSON.stringify(previousSpec.parts.find(old=>old.id===p.id))&&!p.explanation))throw new Error('Every changed or added candidate part needs an explanation of purpose, placement and selection. Do not invent evidence.');
    const bindingIssues=architectureBindingIssues(candidate,architecturePlan);if(bindingIssues.length)throw new Error(bindingIssues.join('; '));
    if(candidate.questions.length&&candidate.parts.length)throw new Error('Essential questions require clarification-only JSON: parts:[] and assembly:[]. Do not construct a design from unanswered decisions.');
    if(plan)for(const k of ['requirements','assumptions','unknowns','title','description','units'])if(!equal(candidate[k],plan[k]))throw new Error('Immutable plan metadata changed: '+k);
    if(previousSpec&&repairErrors.length&&!candidate.questions.length){validateRepair(previousSpec,candidate);if(designHash(candidate)===designHash(previousSpec))throw new Error('Repair returned the identical failed design. Change the geometry responsible for the reported failure, keeping requirements, input assumptions and verification targets unchanged. Repeating the failed draft is not a repair.');}
    if(preserveDecisions&&previousSpec&&!candidate.questions.length)validateUserRefinement(previousSpec,candidate);
    return {spec:candidate,issues:[]};
  }catch(error){
    const match=/^parts\[(\d+)\](?:\.|$)/.exec(error.validationPath||'');
    const partId=match&&raw.parts?.[Number(match[1])]?.id;
    const owner=plan&&partId&&partitionGeneration(plan).find(u=>u.kind==='part'&&u.ids.includes(partId));
    return {spec:null,issues:[{code:error.code||'GLOBAL_ADMISSION',message:error.message,unitKeys:owner?[owner.key]:[],attribution:owner?'exact':'unknown'}]};
  }
}
