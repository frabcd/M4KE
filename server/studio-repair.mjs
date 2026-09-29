import {validateDesignSpec} from './studio-contract.mjs';

const fail=message=>Object.assign(new Error(message),{status:422});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

/** Repair may fix geometry and wiring, never change the question being tested. */
export function validateRepair(originalInput,nextInput){
  const original=validateDesignSpec(originalInput),next=validateDesignSpec(nextInput);
  for(const r of original.requirements)if(!next.requirements.some(n=>n.id===r.id&&n.text===r.text))throw fail('Repair changed or removed an original requirement. Proposal retained, not accepted.');
  for(const r of original.verificationRequests||[])if(!next.verificationRequests?.some(n=>same(n,r)))throw fail(`Repair removed or weakened verification request ${r.id}. Change the design, not the test.`);
  for(const [key,value] of Object.entries(original.physicsInputs||{}))if(!same(next.physicsInputs?.[key],value))throw fail(`Repair changed or removed ${key}. Changing the test inputs, assumptions or source ratings requires an explicit new decision, not automatic repair.`);
  for(const item of original.buildItems||[])if(!next.buildItems?.some(candidate=>same(candidate,item)))throw fail(`Repair changed or removed build item ${item.id}. Preserve the procurement/build requirements.`);
  if(original.electrical){
    if(!next.electrical)throw fail('Repair removed the electrical design instead of fixing it.');
    if(original.electrical.components.length!==next.electrical.components.length)throw fail('Repair added or removed an electrical component. New hardware requires an explicit selection.');
    for(const component of original.electrical.components){const candidate=next.electrical.components.find(c=>c.partId===component.partId);if(!candidate||candidate.profileId!==component.profileId)throw fail(`Repair changed the electrical identity of ${component.partId}.`);}
    if(!same(original.electrical.control,next.electrical.control))throw fail('Repair changed or removed the electrical control profile, roles, polarity, threshold or PWM goal. Explicit new decisions are required.');
  }else if(next.electrical)throw fail('Repair introduced new electrical hardware outside the original design. Use an explicit new design decision.');
  {
    for(const part of original.parts){
      const candidate=next.parts.find(p=>p.id===part.id);
      if(!candidate)throw fail(`Repair removed original component ${part.id} instead of fixing it.`);
      if(candidate.kind!==part.kind)throw fail(`Repair changed the manufacturing identity of ${part.id}.`);
      if(['catalog','library'].includes(part.shape.type)&&!same(part.shape,candidate.shape))throw fail(`Repair replaced source catalog geometry for ${part.id}. A different part needs an explicit new selection.`);
      if(part.kind==='purchased'&&(!same(part.shape,candidate.shape)||part.source!==candidate.source))throw fail(`Repair changed the purchased manufacturing identity of ${part.id}. Source geometry and supplier identity cannot be replaced.`);
    }
  }
  return next;
}

/** A user-requested candidate may propose revised targets, never silently apply
 * them. Stable requirement/check IDs preserve the comparison; apply requires a
 * separate acknowledgment of the machine-derived decision changes. Automatic
 * repair still uses validateRepair against the candidate's frozen targets. */
export function validateUserRefinement(originalInput,nextInput){
  const original=validateDesignSpec(originalInput),next=validateDesignSpec(nextInput);
  for(const r of original.requirements)if(!next.requirements.some(n=>n.id===r.id))throw fail('A refinement cannot drop an existing requirement. Keep its ID and show the proposed target change.');
  for(const r of original.verificationRequests||[]){
    const n=next.verificationRequests?.find(n=>n.id===r.id);
    if(!n||n.type!==r.type||n.requirementId!==r.requirementId)throw fail('A refinement cannot remove, replace or detach an existing verification check.');
  }
  // A requested printed-geometry edit may update its consumable description
  // (e.g. plate dimensions), but cannot quietly substitute a SKU, source,
  // quantity or purchased component. This appears in the confirmation diff.
  const buildItems=(original.buildItems||[]).map(item=>{
    const candidate=next.buildItems?.find(n=>n.id===item.id);
    const changedPrinted=item.kind==='consumable'&&item.partIds.some(id=>{
      const before=original.parts.find(p=>p.id===id),after=next.parts.find(p=>p.id===id);
      return before?.kind==='printed'&&after?.kind==='printed'&&(!same(before.shape,after.shape)||before.material!==after.material);
    });
    return changedPrinted&&candidate&&same({...candidate,specification:item.specification},item)?candidate:item;
  });
  return validateRepair({...original,requirements:next.requirements,verificationRequests:next.verificationRequests||[],...(original.buildItems?{buildItems}:{})},next);
}

/** A prior deterministic FAIL cannot disappear or become UNKNOWN and count as fixed. */
export function unresolvedRepairFailures(previousFailures,nextReport){
  return previousFailures.filter(c=>c.critical&&c.status==='FAIL').filter(c=>!nextReport?.claims?.some(n=>n.id===c.id&&n.critical&&n.status==='PASS'));
}
