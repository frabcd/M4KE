import {createHash} from 'node:crypto';
import {loadLibraryUsability,USABILITY_RELEASE} from './studio-usability.mjs';

const SHA=/^[a-f0-9]{64}$/,MAX_BYTES=12*1024,MAX_RESULTS=8;
const deny=()=>({catalogAdmission:false,assembly:false,dynamicSimulation:false,manufacture:false,appPhysics:false});
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,names)=>object(x)&&Object.keys(x).length===names.length&&Object.keys(x).every(k=>names.includes(k));
const text=(x,n)=>typeof x==='string'&&x.length<=n&&!/[\u0000-\u001f\u007f]/.test(x);
const canonical=x=>JSON.stringify(x,(_key,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const tokens=query=>[...new Set(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,39}/gu)||[])].slice(0,40);

/** Deterministic bounded query, not a model/tool instruction. Original request is separately persisted. */
export function candidateSearchQuery(request,answers=[]){
 const input=[request,...answers.map(a=>a.answer)].filter(x=>typeof x==='string').join(' ');
 return tokens(input).join(' ').slice(0,150);
}

export function validateCandidateContext(context){
 if(!keys(context,['sha256','snapshot'])||!SHA.test(context.sha256))throw new Error('Invalid candidate-context envelope.');
 const s=context.snapshot;
 if(!keys(s,['schemaVersion','purpose','status','query','auditSha256','previewManifestSha256','metadataOnly','currentBytesVerified','permissions','records'])||s.schemaVersion!==1||s.purpose!=='OFFLINE_CANDIDATE_PLANNING_REFERENCES'||!['REFERENCES_AVAILABLE','NO_MATCHES','AUDIT_UNAVAILABLE'].includes(s.status)||!text(s.query,150)||s.metadataOnly!==true||s.currentBytesVerified!==false||!keys(s.permissions,Object.keys(deny()))||Object.values(s.permissions).some(v=>v!==false)||!Array.isArray(s.records)||s.records.length>MAX_RESULTS)throw new Error('Invalid bounded candidate-context snapshot.');
 if(s.status==='AUDIT_UNAVAILABLE'?(s.auditSha256!==null||s.previewManifestSha256!==null||s.records.length!==0):(s.auditSha256!==USABILITY_RELEASE.catalogSha256||s.previewManifestSha256!==USABILITY_RELEASE.runtimePreviewSha256))throw new Error('Candidate-context parent lineage differs from reviewed release.');
 if((s.status==='REFERENCES_AVAILABLE')!==(s.records.length>0))throw new Error('Candidate-context status/count mismatch.');
 const identities=new Set();
 for(const r of s.records){
  if(!keys(r,['sourceSha256','name','dimensionsSourceMm','previewAssetSha256','nativeGeometryStatus','staticColliderStatus','disposition','engineeringRecommendation','blockers','physicalValidation'])||!SHA.test(r.sourceSha256)||identities.has(r.sourceSha256)||!text(r.name,120)||!Array.isArray(r.dimensionsSourceMm)||r.dimensionsSourceMm.length!==3||r.dimensionsSourceMm.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<=0||n>=1e6)||!keys(r.previewAssetSha256,['overview','detail'])||!SHA.test(r.previewAssetSha256.overview)||!SHA.test(r.previewAssetSha256.detail)||!['PASS','REVIEW_REQUIRED','NOT_AUDITED'].includes(r.nativeGeometryStatus)||!['STATIC_ENGINE_CHECK_PASS','REVIEW_REQUIRED','NOT_AUDITED'].includes(r.staticColliderStatus)||!['CANDIDATE_REFERENCE_ONLY','INSPECTION_ONLY_HELD'].includes(r.disposition)||r.engineeringRecommendation!==false||!Array.isArray(r.blockers)||r.blockers.length>3||r.blockers.some(x=>!text(x,160))||r.physicalValidation!=='UNKNOWN')throw new Error('Invalid candidate reference or promotion attempt.');
  if((r.nativeGeometryStatus!=='PASS'||r.staticColliderStatus!=='STATIC_ENGINE_CHECK_PASS')&&r.disposition!=='INSPECTION_ONLY_HELD')throw new Error('Held candidate cannot be an engineering recommendation.');
  identities.add(r.sourceSha256);
 }
 if(Buffer.byteLength(canonical(context))>MAX_BYTES||hash(s)!==context.sha256)throw new Error('Candidate-context snapshot hash/byte limit mismatch.');
 return structuredClone(context);
}

/** Trusted loader injection is for tests; HTTP/model data cannot choose a path or release. */
export function createCandidateSearch(loadAudit=loadLibraryUsability){
 return async function search(root,query){
  if(!text(query,150))throw new Error('Candidate search needs at most 150 plain-text characters.');
  let audit;try{audit=await loadAudit(root);}catch{audit=null;}
  const available=audit?.available===true&&audit.auditSha256===USABILITY_RELEASE.catalogSha256&&audit.runtimePreview===USABILITY_RELEASE.runtimePreview&&audit.previewPinValid===true&&Array.isArray(audit.records)&&audit.records.length<=2000;
  const snapshot={schemaVersion:1,purpose:'OFFLINE_CANDIDATE_PLANNING_REFERENCES',status:'AUDIT_UNAVAILABLE',query,auditSha256:available?audit.auditSha256:null,previewManifestSha256:available?USABILITY_RELEASE.runtimePreviewSha256:null,metadataOnly:true,currentBytesVerified:false,permissions:deny(),records:[]};
  if(available){
   const terms=tokens(query);
   const eligible=audit.records.filter(r=>r.metadataStatus==='PEER_AUDIT_REPORTED'&&r.scaleStatus==='PASS'&&r.peerReportedEligibility?.inspect===true&&r.previewJoin==='MATCHED_BOTH_LEVELS'&&SHA.test(r.sourceSha256)&&SHA.test(r.assetHashes?.overview)&&SHA.test(r.assetHashes?.detail));
   // Names are untrusted searchable data. No code, paths, URLs, pricing or model commands are forwarded.
   const scored=eligible.map(record=>({record,score:terms.reduce((n,term)=>n+(String(record.name).toLowerCase().includes(term)?term.length:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.record.sourceSha256.localeCompare(b.record.sourceSha256));
   const seen=new Set();
   for(const {record:r}of scored){if(seen.has(r.sourceSha256))continue;seen.add(r.sourceSha256);
    snapshot.records.push({sourceSha256:r.sourceSha256,name:r.name.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,120),dimensionsSourceMm:r.dimensionsSourceMm,previewAssetSha256:{overview:r.assetHashes.overview,detail:r.assetHashes.detail},nativeGeometryStatus:r.nativeGeometryStatus,staticColliderStatus:r.staticColliderStatus,disposition:r.peerReportedEligibility.staticFixedCollider===true&&r.nativeGeometryStatus==='PASS'&&r.staticColliderStatus==='STATIC_ENGINE_CHECK_PASS'?'CANDIDATE_REFERENCE_ONLY':'INSPECTION_ONLY_HELD',engineeringRecommendation:false,blockers:(r.blockers||[]).slice(0,3).map(x=>String(x).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160)),physicalValidation:'UNKNOWN'});
    if(snapshot.records.length===MAX_RESULTS)break;
   }
   snapshot.status=snapshot.records.length?'REFERENCES_AVAILABLE':'NO_MATCHES';
  }
  return validateCandidateContext({snapshot,sha256:hash(snapshot)});
 };
}
export const searchCandidateContext=createCandidateSearch();
