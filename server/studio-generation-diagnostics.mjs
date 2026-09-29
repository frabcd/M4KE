/** Pre-freeze diagnostics; none of these checks award manufacturing evidence. */
export function geometryIntentIssues(spec) {
 const issues=[];
 // Deliberately narrow: "vented cover" / "vent insert" are physical pieces.
 // A part named exactly for an empty feature is a high-confidence cutter mistake.
 const emptyFeature=/^(?:(?:vent(?:ilation)?\s+)?slot|vent(?:ilation)?|(?:cable\s+)?opening|(?:mounting\s+)?hole|bore|pocket|cutout)(?:[\s_-]*\d+)?$/i;
 for(const p of spec?.parts||[]) {
  if(p.kind!=='printed'||!['box','cylinder','union'].includes(p.shape?.type))continue;
  if(emptyFeature.test(String(p.name||'').trim()))issues.push(`${p.id}: "${p.name}" describes empty space but parts[] creates positive material. Model a subtractive pocket or hole on its parent part, remove the standalone cutter part and update assembly references before freezing. A label or moving this block cannot create an opening.`);
  const holes=p.holes||[];
  for(let j=0;j<holes.length;j++) {
   const h=holes[j],axis=['x','y','z'].indexOf(h.axis);
   if(axis<0||!Array.isArray(h.position)||!Number.isFinite(h.diameter))continue;
   for(let i=0;i<j;i++) {
    const prior=holes[i];
    if(prior.axis!==h.axis||!Array.isArray(prior.position)||!Number.isFinite(prior.diameter))continue;
    const radial=Math.hypot(...h.position.map((v,k)=>k===axis?0:v-prior.position[k]));
    const span=hole=>hole.depth===undefined?[-Infinity,Infinity]:[hole.position[axis]-hole.depth/2,hole.position[axis]+hole.depth/2];
    const [lo,hi]=span(h),[priorLo,priorHi]=span(prior);
    if(radial+h.diameter/2<=prior.diameter/2+1e-8 && lo>=priorLo-1e-8 && hi<=priorHi+1e-8) {
     issues.push(`${p.id}: hole ${j} is contained in previous hole ${i} both radially and axially and cannot remove material. Without depth a hole traverses the whole part regardless of axial position. For a stepped seat declare a larger finite-depth bore centered at its local position and a smaller through bore, retaining an actual shoulder.`);
     break;
    }
   }
  }
 }
 return issues.slice(0,12);
}

/** Keep the worker's actual rejection ahead of progress-only stderr. */
export function nativeBuildFailureMessage(run,failedCad) {
 const errors=v=>Array.isArray(v?.errors)?v.errors.filter(x=>typeof x==='string'&&x.trim()).slice(0,4):[];
 let messages=errors(failedCad);
 if(!messages.length)for(const line of String(run?.stdout||'').slice(-32768).split(/\r?\n/).reverse()) {
  try {messages=errors(JSON.parse(line));if(messages.length)break;}catch{/* Plain logs are not a worker result. */}
 }
 if(messages.length)return messages.join('; ').slice(0,1500);
 const useful=String(run?.stderr||'').split(/\r?\n/).filter(l=>!l.startsWith('M4KE_DIAGNOSTIC ')).join('\n').trim();
 return (useful||String(run?.stdout||'').trim()||`Native worker exited with code ${run?.code??'unknown'} without a structured error.`).slice(-1500);
}
