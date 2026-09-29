import {validateDesignSpec} from './studio-contract.mjs';

/** A question is a dialogue turn, not permission to accept premature geometry.
 * Keep the original model response in the run receipt; this projection contains
 * no parts, circuit, calculations, checks or assembly claims from that response.
 */
export function clarificationFromDraft(draft) {
  if (!Array.isArray(draft?.questions) || !draft.questions.length) return null;
  if (draft.questions.length > 3) throw new Error('Ask at most three essential questions in one clarification turn.');
  const {schemaVersion, title, description, units, requirements, assumptions, unknowns, questions} = draft;
  const spec = validateDesignSpec({schemaVersion, title, description, units, requirements, assumptions, unknowns, questions, parts:[], assembly:[]});
  const discardedFields = ['parts', 'assembly', 'electrical', 'physicsInputs', 'verificationRequests', 'buildItems']
    .filter(key => Array.isArray(draft[key]) ? draft[key].length > 0 : draft[key] !== undefined);
  return {spec, discardedFields};
}
