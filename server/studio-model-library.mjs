/** Unified local source discovery, immutable native snapshots and static companions.
 * Geometry availability is deliberately separate from engineering qualification. */
import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const LIBRARY_RELEASE=Object.freeze({
 index:['CANDIDATE-INDEX-20260927-10.json','461f69b93078a584cbf998453196d10ea00428fba9a246c08ea6ad10a2bc458d'],
 audit:['usability-11/ai-catalog.json','c40fa16fbca96ba522c4061099e3da3fa5ca4eb857daa726c049e97df1c9d5e4'],
 preview:['preview-quality-10/manifest.json','c20e8cd10e1cc1c3d61c984dedd9a1d1204daa33437f1c78dd8d6f6305345872'],
 collision:['collision-review-12/manifest.json','9300b040aee6cba2ea178cd265db0207ce0b8c00a4fe87282e1d1a5aa1b1389c'],
});
const SHA=/^[a-f0-9]{64}$/;
const hash=b=>createHash('sha256').update(b).digest('hex');
const error=message=>Object.assign(new Error(message),{status:409});
const clean=(s,max=200)=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const isPi=r=>r.pi_related_name===true||/raspberry|\bpico\b|picowbell|\bpi\b/i.test(r.name||'');
const isObject=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>JSON.stringify(x,(_key,v)=>isObject(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sourcePath=r=>r.relative_file;

export async function readLibraryFile(root,relative,limit=8*1024*1024){
 if(typeof relative!=='string'||relative.length>800||relative.includes('\\')||relative.includes(':')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw error('Unsafe library path');
 let folder=path.join(root,'database');
 for(const component of ['model-library',...relative.split('/').slice(0,-1)]){
  const state=await lstat(folder);if(!state.isDirectory()||state.isSymbolicLink())throw error('Library directory must be regular');folder=path.join(folder,component);
 }
 const parent=await lstat(folder);if(!parent.isDirectory()||parent.isSymbolicLink())throw error('Linked library directory is forbidden');
 const target=path.join(folder,relative.split('/').at(-1)),st=await lstat(target);
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>limit)throw error('Library file type or size is invalid');
 const handle=await open(target,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
 try{
  const before=await handle.stat();if(!before.isFile()||before.size!==st.size)throw error('Library file changed');
  const bytes=Buffer.alloc(before.size+1);let count=0;
  while(count<bytes.length){const result=await handle.read(bytes,count,bytes.length-count,count);if(!result.bytesRead)break;count+=result.bytesRead;}
  if(count!==before.size)throw error('Library file changed during read');return bytes.subarray(0,count);
 }finally{await handle.close();}
}

/** Release overrides are trusted fixture configuration, never model/HTTP input. */
export function createModelLibrary({root,release=LIBRARY_RELEASE}={}){
 async function state(){
  const documents=await Promise.all(Object.entries(release).map(async([key,[file,digest]])=>{
   const bytes=await readLibraryFile(root,file);if(hash(bytes)!==digest)throw error('Pinned library '+key+' changed');return [key,JSON.parse(bytes)];
  }));
  const s=Object.fromEntries(documents);
  for(const key of ['index','audit','preview','collision'])if(!Array.isArray(s[key]?.records)||s[key].records.length>2000)throw error('Invalid '+key+' records');
  if(s.index.schema!=='m4ke-model-library-candidate-index-2'||s.audit.schema!=='m4ke-library-ai-usability-1'||s.preview.schema!=='m4ke-library-preview-assets-1'||s.collision.schema!=='m4ke-static-collision-companions-1')throw error('Unsupported library schema');
  if(s.audit.source_index_sha256!==release.index[1]||s.audit.preview_manifest_sha256!==release.preview[1]||s.collision.upstream_ai_catalog_sha256!==release.audit[1]||s.collision.upstream_preview_manifest_sha256!==release.preview[1])throw error('Library parent binding mismatch');
  return s;
 }
 function row(r,s){
  const h=r.sha256,a=s.audit.records.find(x=>x.source_sha256===h),p=s.preview.records.find(x=>x.source_sha256===h),c=s.collision.records.find(x=>x.source_sha256===h);
  const n=r.native_check,b=n?.source_bounds_mm,dim=n?.size_mm;
  const bounds=Array.isArray(b)&&b.length===6&&b.every(Number.isFinite)?b:null;
  const native=SHA.test(h||'')&&n?.sha256===h&&n?.native_valid===true&&n?.status==='NATIVE_IMPORT_VALID'&&bounds&&dim?.length===3&&dim.every(x=>Number.isFinite(x)&&x>0&&x<=100000)&&typeof sourcePath(r)==='string';
  const held=a?.native_geometry_status==='REVIEW_REQUIRED'||(r.source_review?.length||0)>0;
  return {sourceSha256:SHA.test(h||'')?h:null,name:clean(r.name)||'Unnamed source',category:clean(r.category||''),sourceAvailable:SHA.test(h||'')&&typeof sourcePath(r)==='string',
   nativeImportCandidate:Boolean(native&&!held),nativeImportRequiresFreshCheck:true,piRequiresExplicitUserSelection:isPi(r),
   dimensionsMm:dim||null,sourceBoundsMm:bounds,sourceFrame:'original STEP origin; imported millimetres; no recentering or scaling',
   previewAvailable:p?.status==='PREVIEW_GEOMETRY_CHECKS_PASS',
   staticCollider:c?.status==='STATIC_COMPANION_CHECKS_PASS'?'COMPANION12':a?.static_collider_status==='STATIC_ENGINE_CHECK_PASS'&&a?.native_geometry_status==='PASS'?'OVERVIEW11':'UNAVAILABLE',
   sourceReview:(r.source_review||[]).map(x=>clean(x.finding,180)).slice(0,3),
   physicalFit:'UNKNOWN',dynamicSimulation:false,manufacturingQualified:false};
 }
 async function inventory(){const s=await state(),records=s.index.records.map(r=>row(r,s));return {schema:'m4ke-unified-library-1',release:Object.fromEntries(Object.entries(release).map(([k,v])=>[k,v[1]])),summary:{records:records.length,sourceFiles:records.filter(r=>r.sourceAvailable).length,nativeImportCandidates:records.filter(r=>r.nativeImportCandidate).length,previews:records.filter(r=>r.previewAvailable).length,staticCompatibility:records.filter(r=>r.staticCollider!=='UNAVAILABLE').length},records,limitations:['Native imports rehash and revalidate exact source solids per job.','No automatic hardware substitution, physical fit, dynamic-body or manufacturing approval.']};}
 async function search(query='',limit=8){
  if(typeof query!=='string'||query.length>500||/[\u0000-\u001f]/.test(query)||!Number.isInteger(limit)||limit<1||limit>20)throw error('Invalid library query');
  const words=(query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{1,63}/gu)||[]).filter(w=>!['design','make','build','with','that','this','from','have','the','and','for','model','please'].includes(w));
  const aliases={'轴承':['bearing'],'电机':['motor'],'车轮':['wheel'],'电池':['battery'],'麦克风':['microphone'],'声音':['microphone'],'小车':['motor','wheel','battery'],'car':['motor','wheel','battery'],'齿轮':['gear'],'椅子':['chair'],'外壳':['enclosure']};
  for(const [word,extra] of Object.entries(aliases))if(query.toLowerCase().includes(word))words.push(...extra);
  const data=await inventory();const scored=data.records.map(r=>({r,score:words.reduce((n,w)=>n+((r.name+' '+r.category).toLowerCase().includes(w)?w.length:0),0)})).filter(x=>!words.length||x.score>0).sort((a,b)=>b.score-a.score||String(a.r.sourceSha256).localeCompare(String(b.r.sourceSha256)));
  return {schema:data.schema,summary:data.summary,query,totalMatches:scored.length,records:scored.slice(0,limit).map(x=>x.r)};
 }
 async function resolve(h,{explicitPiRequested=false}={}){
  if(!SHA.test(h))throw error('Use a full lowercase source SHA256');
  const s=await state(),matches=s.index.records.filter(r=>r.sha256===h);if(matches.length!==1)throw error('Source identity missing or ambiguous');
  const r=matches[0],meta=row(r,s);if(!meta.nativeImportCandidate)throw error('Source is held or lacks native import evidence');
  if(isPi(r)&&!explicitPiRequested)throw error('Pi/Pico source requires an explicit user selection route; no automatic fallback');
  const bytes=await readLibraryFile(root,sourcePath(r),16*1024*1024);if(hash(bytes)!==h)throw error('Current source STEP hash mismatch');
  return {record:r,metadata:meta,bytes};
 }
 async function snapshot(spec,save,{explicitPiRequested=false}={}){
  const hashes=[...new Set(spec.parts.filter(p=>p.shape.type==='library').map(p=>p.shape.sourceSha256))];
  if(hashes.length>24)throw error('Too many selected library sources');if(!hashes.length)return null;
  const entries=[];
  for(const h of hashes){
   const {record:r,metadata,bytes}=await resolve(h,{explicitPiRequested});const file='library/models/'+h+'.step';await save(file,bytes);
   let license=null;
   const candidates=[r.license_file,sourcePath(r).split('/').slice(0,-1).concat(r.license_file||'').join('/'),sourcePath(r).split('/').slice(0,-2).concat(r.license_file||'').join('/')];
   for(const rel of [...new Set(candidates)].filter(Boolean)){try{const raw=await readLibraryFile(root,rel,262144),name='library/notices/'+hash(raw)+'.txt';await save(name,raw);license={file:name.slice(8),sha256:hash(raw)};break;}catch{}}
   if(!license)throw error('Source license notice missing; import refused');
   const notices=[];
   if(r.attribution_file){const raw=await readLibraryFile(root,r.attribution_file,1048576),name='library/notices/'+h+'-authors.json';await save(name,raw);notices.push({file:name.slice(8),sha256:hash(raw)});}
   entries.push({sourceSha256:h,name:metadata.name,file:'models/'+h+'.step',sourceUrl:r.source_url,repositoryCommit:r.repository_commit,units:'mm',sourceBoundsMm:metadata.sourceBoundsMm,solidCount:r.native_check.solids,faceCount:r.native_check.faces,frame:'source-origin',license,notices,physicalFit:'UNKNOWN',massKg:null,interfaces:null});
  }
  const manifest={schema:'m4ke-job-library-snapshot-1',parentIndexSha256:release.index[1],parentAuditSha256:release.audit[1],entries};
  await save('library/manifest.json',Buffer.from(JSON.stringify(manifest,null,2)));return manifest;
 }
 async function collider(h){
  if(!SHA.test(h))throw error('Full source SHA256 required');const s=await state(),a=s.audit.records.find(r=>r.source_sha256===h),c=s.collision.records.find(r=>r.source_sha256===h);
  if(a?.native_geometry_status!=='PASS')throw error('Native source geometry held');
  await sourceAsset(h); // Collider evidence must still bind to the current STEP bytes.
  if(c?.status==='STATIC_COMPANION_CHECKS_PASS'){
   const files={};for(const k of ['vertices','indices']){const bytes=await readLibraryFile(root,'collision-review-12/'+c[k].file,32*1024*1024);if(hash(bytes)!==c[k].sha256||bytes.length!==c[k].bytes)throw error('Collider companion integrity mismatch');files[k]={...c[k],file:'collision-review-12/'+c[k].file,url:'/api/studio/library/collider/'+h+'/'+k};}
   return {sourceSha256:h,type:'fixed-trimesh-companion',units:'m',up:'Y',sourceOriginPreserved:true,...files,vertexCount:c.vertex_count,triangleCount:c.triangle_count,physicalFit:'UNKNOWN',dynamicAllowed:false,manufacturingAllowed:false};
  }
  if(a?.static_collider_status==='STATIC_ENGINE_CHECK_PASS'){
   const p=s.preview.records.find(r=>r.source_sha256===h),v=p?.levels?.overview;if(!v)throw error('Overview missing');const bytes=await readLibraryFile(root,'preview-quality-10/'+v.file,32*1024*1024);if(hash(bytes)!==v.sha256)throw error('Overview integrity mismatch');
   return {sourceSha256:h,type:'fixed-trimesh-from-gltf',file:'preview-quality-10/'+v.file,url:'/api/studio/library/collider/'+h+'/overview',sha256:v.sha256,units:'m',up:'Y',applySceneNodeTransforms:true,physicalFit:'UNKNOWN',dynamicAllowed:false,manufacturingAllowed:false};
  }throw error('No verified static collider');
 }
 async function sourceAsset(h){
  if(!SHA.test(h))throw error('Full source SHA256 required');const s=await state(),matches=s.index.records.filter(r=>r.sha256===h);
  if(matches.length!==1)throw error('Missing or ambiguous source');const r=matches[0],bytes=await readLibraryFile(root,sourcePath(r),16*1024*1024);
  if(hash(bytes)!==h)throw error('Source byte integrity failed');return {bytes,metadata:row(r,s)};
 }
 async function colliderAsset(h,kind){
  if(!['vertices','indices','overview'].includes(kind))throw error('Unknown collider asset');const c=await collider(h),entry=kind==='overview'&&c.type==='fixed-trimesh-from-gltf'?c:c[kind];
  if(!entry?.file)throw error('Collider asset not available');const bytes=await readLibraryFile(root,entry.file,32*1024*1024);if(hash(bytes)!==entry.sha256)throw error('Collider bytes changed');return {bytes,sha256:entry.sha256};
 }
 async function describe(h){const {bytes,metadata}=await sourceAsset(h);return {...metadata,currentSourceBytesVerified:true,sourceBytes:bytes.length,sourceDownloadUrl:'/api/studio/library/source/'+h,shape:metadata.nativeImportCandidate?{type:'library',sourceSha256:h}:null};}
 return {inventory,search,resolve,snapshot,collider,sourceAsset,colliderAsset,describe};
}

export async function createLibraryContext(root,request){
 const result=await createModelLibrary({root}).search(String(request).replace(/[\u0000-\u001f]/g,' ').slice(0,500),8);
 const data={schema:'m4ke-native-library-context-1',indexSha256:LIBRARY_RELEASE.index[1],records:result.records.filter(r=>r.nativeImportCandidate&&!r.piRequiresExplicitUserSelection).map(r=>({sourceSha256:r.sourceSha256,name:r.name,dimensionsMm:r.dimensionsMm,sourceBoundsMm:r.sourceBoundsMm,shape:{type:'library',sourceSha256:r.sourceSha256},frame:'original source origin; mm',physicalFit:'UNKNOWN'}))};
 return {sha256:hash(canonical(data)),data};
}
export function validateLibraryContext(value){
 if(!isObject(value)||!SHA.test(value.sha256)||!isObject(value.data)||value.data.schema!=='m4ke-native-library-context-1'||value.data.indexSha256!==LIBRARY_RELEASE.index[1]||!Array.isArray(value.data.records)||value.data.records.length>8||Buffer.byteLength(canonical(value))>16000||hash(canonical(value.data))!==value.sha256)throw error('Invalid native library context');
 for(const r of value.data.records)if(!SHA.test(r.sourceSha256)||r.shape?.type!=='library'||r.shape.sourceSha256!==r.sourceSha256||r.physicalFit!=='UNKNOWN'||typeof r.name!=='string'||r.name.length>200||!Array.isArray(r.sourceBoundsMm)||r.sourceBoundsMm.length!==6||r.sourceBoundsMm.some(x=>!Number.isFinite(x)))throw error('Invalid native library identity or dimensions');
 return structuredClone(value);
}
