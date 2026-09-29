import {readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safeName=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,80}\.svg$/;
const diagnostic=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,1200):'';
const unavailableReason=manifest=>Array.isArray(manifest?.unavailable)?manifest.unavailable.slice(0,3).map(entry=>diagnostic(entry?.reason)).filter(Boolean).join('; ').slice(0,1200):'';
export function safeProjectionSvg(bytes){
  const text=bytes.toString('utf8');
  if(bytes.length>8*1024*1024||!/<svg\b/i.test(text)||!/<path\b/i.test(text)||/<\s*(?:script|foreignObject|image|use|a|style|iframe|animate|set)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|<!ENTITY|<!DOCTYPE|javascript:|url\(/i.test(text))throw new Error('Unsafe or unsupported projection SVG.');
  return 'data:image/svg+xml;base64,'+bytes.toString('base64');
}

/** Illustration failure never changes CAD evidence or substitutes a concept picture. */
export async function generateIllustrations({dir,spec,cad,python,runProcess}){
  const manifestName='illustrations/manifest.json';
  try{
    const script=path.join(dir,'kernel','illustrate.py');
    const run=await runProcess(python,[script,'--input',path.join(dir,'design.json'),'--cad',path.join(dir,'cad','result.json'),'--output',path.join(dir,'illustrations'),'--budget-seconds','90'],{cwd:dir,timeout:100000,maxBytes:524288});
    if(run.code!==0)throw new Error('Illustration renderer exited unsuccessfully: '+(diagnostic(run.stderr||run.stdout)||'No bounded renderer diagnostic.'));
    const stat=await lstat(path.join(dir,manifestName));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2000000)throw new Error('Invalid or oversized illustration manifest.');
    const manifest=JSON.parse(await readFile(path.join(dir,manifestName),'utf8'));
    if(manifest.schemaVersion!==1||!['AVAILABLE','PARTIAL','UNAVAILABLE'].includes(manifest.status)||!Array.isArray(manifest.illustrations)||manifest.illustrations.length>spec.assembly.length)throw new Error('Invalid illustration manifest.');
    // An early renderer refusal emits no lineage fields and no images. Surface
    // its diagnostic as a refusal, never as accepted evidence. Partial/mismatched
    // lineage (including an empty image set) still fails the strict check below.
    if(manifest.status==='UNAVAILABLE'&&!manifest.illustrations.length&&['designSha256','cadResultSha256','scriptSha256'].every(key=>manifest[key]===undefined))throw new Error('Illustration renderer refused before lineage validation: '+(unavailableReason(manifest)||'No bounded renderer diagnostic.'));
    if(manifest.designSha256!==sha(await readFile(path.join(dir,'design.json')))||manifest.cadResultSha256!==sha(await readFile(path.join(dir,'cad','result.json')))||manifest.scriptSha256!==sha(await readFile(script)))throw new Error('Illustration source lineage mismatch.');
    const images={},files=[manifestName],seen=new Set();
    for(const entry of manifest.illustrations){
      const step=spec.assembly.find(s=>s.id===entry.stepId);
      if(!step||seen.has(step.id)||!safeName.test(entry.svg)||entry.svg!==step.id+'.svg'||JSON.stringify(entry.partIds)!==JSON.stringify(step.partIds)||entry.physicalFit!=='UNKNOWN')throw new Error('Illustration identity mismatch.');
      seen.add(step.id);
      for(const id of step.partIds)if(entry.sourceStepSha256?.[id]!==cad.parts.find(p=>p.id===id)?.sha256?.step)throw new Error('Illustration STEP lineage mismatch.');
      const name='illustrations/'+entry.svg,st=await lstat(path.join(dir,name));
      if(!st.isFile()||st.isSymbolicLink()||st.size>8*1024*1024)throw new Error('Invalid illustration file.');
      const bytes=await readFile(path.join(dir,name));if(sha(bytes)!==entry.sha256||bytes.length!==entry.bytes)throw new Error('Illustration content hash mismatch.');
      images[step.id]=safeProjectionSvg(bytes);files.push(name);
    }
    return {status:seen.size===spec.assembly.length?'AVAILABLE':seen.size?'PARTIAL':'UNAVAILABLE',files,images,manifest,...seen.size<spec.assembly.length?{reason:unavailableReason(manifest)||'No verified projection was returned for every assembly step.'}:{}};
  }catch(error){
    const note={status:'UNAVAILABLE',reason:error.message,physicalFit:'UNKNOWN',note:'No image substitute. CAD checks remain independent.'};
    await writeFile(path.join(dir,'ILLUSTRATIONS-UNAVAILABLE.json'),JSON.stringify(note,null,2));
    return {...note,files:['ILLUSTRATIONS-UNAVAILABLE.json'],images:{}};
  }
}
