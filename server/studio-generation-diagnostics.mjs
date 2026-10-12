// Exact primitive AABBs in the union's local frame, using the same Rx*Ry*Rz
// convention as native CAD and Three.js. Bounds separation proves disconnection;
// bounds overlap does NOT prove contact, a valid solid, or manufacturing fitness.
function primitiveBounds(s) {
 const [x,y,z]=s.rotation.map(v=>v*Math.PI/180),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
 const rows=[[cy*cz,-cy*sz,sy],[cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy],[sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy]];
 const half=rows.map(row=>s.type==='box'?row.reduce((n,v,i)=>n+Math.abs(v)*s.size[i]/2,0):Math.hypot(row[0],row[1])*s.radius+Math.abs(row[2])*s.height/2);
 return {min:half.map((h,i)=>s.position[i]-h),max:half.map((h,i)=>s.position[i]+h)};
}
function unionSeparation(solids) {
 const bounds=solids.map(primitiveBounds),gap=(a,b)=>Math.max(...a.min.map((v,i)=>Math.max(v-b.max[i],b.min[i]-a.max[i])));
 const seen=new Set([0]),queue=[0];
 while(queue.length){const i=queue.pop();for(let j=0;j<bounds.length;j++)if(!seen.has(j)&&gap(bounds[i],bounds[j])<=1e-7){seen.add(j);queue.push(j);}}
 if(seen.size===bounds.length)return null;
 const outside=bounds.map((_,i)=>i).filter(i=>!seen.has(i));
 const lowerBound=Math.min(...outside.flatMap(j=>[...seen].map(i=>gap(bounds[i],bounds[j]))));
 return {outside,lowerBound};
}
/** Pre-freeze diagnostics; none of these checks award manufacturing evidence. */
export function geometryIntentDiagnostics(spec) {
 const issues=[];
 const add=(partId,message)=>issues.push({code:'GEOMETRY_INTENT',partId,message});
 // Deliberately narrow: "vented cover" / "vent insert" are physical pieces.
 // A part named exactly for an empty feature is a high-confidence cutter mistake.
 const emptyFeature=/^(?:(?:vent(?:ilation)?\s+)?slot|vent(?:ilation)?|(?:cable\s+)?opening|(?:mounting\s+)?hole|bore|pocket|cutout)(?:[\s_-]*\d+)?$/i;
 for(const p of spec?.parts||[]) {
  if(p.kind!=='printed'||!['box','cylinder','union'].includes(p.shape?.type))continue;
  if(p.shape.type==='union') {
   const separated=unionSeparation(p.shape.solids);
   if(separated)issues.push({code:'DISCONNECTED_UNION',partId:p.id,message:`${p.id}: union members ${separated.outside.join(', ')} are disconnected from member 0's group. Their transformed bounds are separated by at least ${Number(separated.lowerBound.toPrecision(8))} mm. A union cannot fuse across empty space. Cylinders are centered on local Z; height follows that axis, not X. Apply XYZ-degree member rotations before member translations; then apply the part transform. Correct the intended member geometry/placement, not the camera or labels. Overlapping bounds alone would still need native solid verification.`});
  }
  if(emptyFeature.test(String(p.name||'').trim()))add(p.id,`${p.id}: "${p.name}" describes empty space but parts[] creates positive material. Model a subtractive pocket or hole on its parent part, remove the standalone cutter part and update assembly references before freezing. A label or moving this block cannot create an opening.`);
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
     add(p.id,`${p.id}: hole ${j} is contained in previous hole ${i} both radially and axially and cannot remove material. Without depth a hole traverses the whole part regardless of axial position. For a stepped seat declare a larger finite-depth bore centered at its local position and a smaller through bore, retaining an actual shoulder.`);
     break;
    }
   }
  }
 }
 return issues.slice(0,12);
}
export function geometryIntentIssues(spec){return geometryIntentDiagnostics(spec).map(d=>d.message);}

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
