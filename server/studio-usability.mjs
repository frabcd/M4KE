import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadPreviewLibrary,readPreviewAsset} from './studio-previews.mjs';

// A reviewed, immutable metadata release; never select a newer folder implicitly.
export const USABILITY_RELEASE=Object.freeze({
 catalog:'usability-11/ai-catalog.json',catalogSha256:'c40fa16fbca96ba522c4061099e3da3fa5ca4eb857daa726c049e97df1c9d5e4',
 index:'CANDIDATE-INDEX-20260927-10.json',indexSha256:'461f69b93078a584cbf998453196d10ea00428fba9a246c08ea6ad10a2bc458d',
 preview:'preview-quality-10/manifest.json',previewSha256:'c20e8cd10e1cc1c3d61c984dedd9a1d1204daa33437f1c78dd8d6f6305345872',
 runtimePreview:'preview-quality-10/manifest.json',runtimePreviewSha256:'c20e8cd10e1cc1c3d61c984dedd9a1d1204daa33437f1c78dd8d6f6305345872',
});
const SHA=/^[a-f0-9]{64}$/,MAX_BYTES=8*1024*1024,MAX_RECORDS=2000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const text=(value,max=350)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):null;
const object=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const safePath=value=>typeof value==='string'&&value.length<=500&&!value.includes('\\')&&!value.includes(':')&&!value.startsWith('/')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..');
const bounded=value=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e6;
const sourceToGltf=[[.001,0,0,0],[0,0,.001,0],[0,-.001,0,0],[0,0,0,1]];
const gltfToSource=[[1000,0,0,0],[0,0,-1000,0],[0,1000,0,0],[0,0,0,1]];
const permissions=inspect=>({inspect,assembly:false,dynamicSimulation:false,manufacture:false,appPhysics:false});
const limitations=[
 'Peer-reported source-library audit, not application physics, component fit, measured mass, or manufacturing certification.',
 'Summary joins recorded full source and both GLB hashes. Current source/asset bytes are checked only by an explicit per-source verification request.',
 'Static compatibility means a fixed overview trimesh and one ray in peer Rapier 0.21.0 tests, not moving-body, contact, friction, joint or full-surface validation.',
 'The application selects pinned preview10 assets; source units/origins/transforms, runtime component catalog and CAD grammar are unchanged. No candidate is admitted to a build.',
 'The same CAD hash does not establish an interchangeable SKU, hardware revision or electrical rating. Pi/Pico choice still requires an explicit design decision.',
];

async function readBounded(root,relative){
 if(!safePath(relative))throw fail('Unsafe audit metadata path.');
 let directory=root;const parent=await lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink())throw fail('Invalid audit root.');
 const segments=relative.split('/');for(const segment of segments.slice(0,-1)){directory=path.join(directory,segment);const state=await lstat(directory);if(!state.isDirectory()||state.isSymbolicLink())throw fail('Linked audit directories are not accepted.');}
 const target=path.join(directory,segments.at(-1)),state=await lstat(target);if(!state.isFile()||state.isSymbolicLink()||state.size>MAX_BYTES)throw fail('Audit metadata must be a bounded regular file.');
 const handle=await open(target,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw fail('Audit metadata exceeds its limit.');const buffer=Buffer.alloc(stat.size+1);let size=0;while(size<buffer.length){const read=await handle.read(buffer,size,buffer.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}if(size!==stat.size)throw fail('Audit file changed during reading.');return buffer.subarray(0,size);}finally{await handle.close();}
}
const empty=reason=>({available:false,status:'AUDIT_UNAVAILABLE',reason,records:[],permissions:permissions(false),limitations});

/** Trusted release injection is for isolated fixtures, never a request parameter. */
export function createUsabilityReader(release=USABILITY_RELEASE){
 let activeReads=0,activeChecks=0;
 async function state(root){
  if(activeReads>=2)throw fail('Two audit metadata reads are in progress. Retry shortly.',429);
  activeReads++;
  try{
   const database=path.join(root,'database'),base='model-library/';
   const [catalogBytes,indexBytes,previewBytes]=await Promise.all([release.catalog,release.index,release.preview].map(name=>readBounded(database,base+name)));
   if(sha(catalogBytes)!==release.catalogSha256||sha(indexBytes)!==release.indexSha256||sha(previewBytes)!==release.previewSha256)throw fail('Pinned audit or parent metadata changed; no newer audit substituted.');
   const catalog=JSON.parse(catalogBytes),index=JSON.parse(indexBytes),preview=JSON.parse(previewBytes);
   if(catalog.schema!=='m4ke-library-ai-usability-1'||catalog.source_index!==release.index||catalog.source_index_sha256!==release.indexSha256||catalog.preview_manifest!==release.preview||catalog.preview_manifest_sha256!==release.previewSha256||index.schema!=='m4ke-model-library-candidate-index-2'||preview.schema!=='m4ke-library-preview-assets-1')throw fail('Audit parent/schema binding is invalid.');
   for(const document of [catalog,index,preview])if(!Array.isArray(document.records)||document.records.length>MAX_RECORDS||document.records.some(r=>!object(r)))throw fail('Audit record bounds/schema are invalid.');
   if(catalog.records.some(r=>!SHA.test(r.source_sha256))||new Set(catalog.records.map(r=>r.source_sha256)).size!==catalog.records.length)throw fail('Audit source identities are missing or duplicate.');
   const sources=new Set(index.records.filter(r=>SHA.test(r.sha256)&&safePath(r.relative_file)).map(r=>r.sha256+'|'+r.relative_file));
   const peerPreviews=new Map();for(const p of preview.records){if(!SHA.test(p.source_sha256)||peerPreviews.has(p.source_sha256))throw fail('Parent preview identities are invalid or duplicate.');peerPreviews.set(p.source_sha256,p);}
   const runtime=await loadPreviewLibrary(root),runtimeOK=runtime.available===true&&runtime.manifestFile===release.runtimePreview&&runtime.manifestSha256===release.runtimePreviewSha256;
   const installed=new Map(runtimeOK?runtime.records.map(r=>[r.sourceSha256,r]):[]);
   const records=catalog.records.map(record=>{
    const frame=record.coordinate_contract,source=record.source,p=peerPreviews.get(record.source_sha256),assets=record.previews;
    const coordinateOK=object(frame)&&frame.matrix_layout==='row-major; column-vector multiplication'&&JSON.stringify(frame.source_to_gltf_m)===JSON.stringify(sourceToGltf)&&JSON.stringify(frame.gltf_to_source_mm)===JSON.stringify(gltfToSource)&&frame.source_origin_preserved===true&&frame.auto_center===false&&frame.scale_adjustment_allowed===false;
    const dims=record.dimensions_source_xyz_mm,bounds=record.source_bounds_mm;
    const dimensionsOK=Array.isArray(dims)&&dims.length===3&&dims.every(n=>bounded(n)&&n>0)&&Array.isArray(bounds)&&bounds.length===6&&bounds.every(bounded)&&bounds.slice(3).every((n,i)=>n>bounds[i]&&Math.abs(n-bounds[i]-dims[i])<=.03);
    const sourceBound=object(source)&&safePath(source.file_relative_to_library)&&sources.has(record.source_sha256+'|'+source.file_relative_to_library)&&p?.source_file===source.file_relative_to_library;
    const statusesOK=['PASS','REVIEW_REQUIRED','NOT_AUDITED'].includes(record.scale_status)&&['PREVIEW_GEOMETRY_CHECKS_PASS','REVIEW_REQUIRED','FAILED','NOT_AUDITED'].includes(record.preview_status)&&['PASS','REVIEW_REQUIRED','NOT_AUDITED'].includes(record.native_geometry_status)&&['STATIC_ENGINE_CHECK_PASS','REVIEW_REQUIRED','NOT_AUDITED'].includes(record.static_collider_status);
    const valid=sourceBound&&coordinateOK&&dimensionsOK&&statusesOK&&typeof record.pi_related==='boolean';
    const levelsOK=valid&&['overview','detail'].every(level=>object(assets?.[level])&&SHA.test(assets[level].sha256)&&assets[level].sha256===p?.levels?.[level]?.sha256&&assets[level].units==='m'&&assets[level].up==='Y');
    const current=installed.get(record.source_sha256),matched=levelsOK&&!!current&&['overview','detail'].every(level=>assets[level].sha256===current.levels[level].sha256);
    const unitsOK=valid&&source.imported_unit==='mm'&&Array.isArray(source.declared_length_units)&&source.declared_length_units.length>0&&source.declared_length_units.length<=8&&source.declared_length_units.every(u=>typeof u==='string'&&u.length<=40);
    const inspect=valid&&unitsOK&&record.scale_status==='PASS'&&record.preview_status==='PREVIEW_GEOMETRY_CHECKS_PASS'&&p?.status==='PREVIEW_GEOMETRY_CHECKS_PASS';
    const native=valid&&record.native_geometry_status==='PASS'&&Number.isSafeInteger(record.geometry?.solid_count)&&record.geometry.solid_count>0&&record.geometry.solid_count<=100000&&typeof record.geometry.sum_of_solid_volumes_mm3==='number'&&Number.isFinite(record.geometry.sum_of_solid_volumes_mm3)&&record.geometry.sum_of_solid_volumes_mm3>0;
    const collider=record.static_collider,staticEligible=inspect&&native&&record.static_collider_status==='STATIC_ENGINE_CHECK_PASS'&&object(collider)&&collider.sha256===assets?.overview?.sha256&&collider.units==='m'&&collider.up==='Y';
    const blockers=[...!valid?['Unsupported, incomplete or conflicting audit metadata.']:[],...!inspect?['Peer unit/preview inspection checks are incomplete or held.']:[],...!native?['Peer native geometry is not accepted for static use.']:[],...!staticEligible?['Peer fixed-collider compatibility is unavailable or held.']:[],...!matched?['Both exact assets are not joined to the pinned application preview10.']:[],...['assembly','dynamic_simulation','manufacture'].flatMap(purpose=>(Array.isArray(record.readiness?.[purpose]?.blockers)?record.readiness[purpose].blockers:[]).slice(0,3).map(item=>text(item)).filter(Boolean))];
    return {sourceSha256:record.source_sha256,name:text(record.name)||'Unnamed audited source',metadataStatus:valid?'PEER_AUDIT_REPORTED':'INVALID_RECORD',
     scaleStatus:valid?record.scale_status:'NOT_AUDITED',nativeGeometryStatus:valid?record.native_geometry_status:'NOT_AUDITED',staticColliderStatus:valid?record.static_collider_status:'NOT_AUDITED',
     dimensionsSourceMm:valid?dims:null,declaredSourceUnits:unitsOK?source.declared_length_units:null,piRelated:record.pi_related!==false,
     previewJoin:matched?'MATCHED_BOTH_LEVELS':current?'ASSET_OR_METADATA_MISMATCH':'NOT_IN_PINNED_PREVIEW',
     assetHashes:matched?Object.fromEntries(['overview','detail'].map(level=>[level,assets[level].sha256])):null,
     peerReportedEligibility:{inspect,staticFixedCollider:staticEligible},currentBytesVerified:false,
     nativeIssue:text(record.evidence?.native_issue),staticIssue:text(record.evidence?.static_issue),blockers:[...new Set(blockers)].slice(0,16),
     permissions:permissions(false),buildQualified:false,physicalValidation:'UNKNOWN'};
   });
   return {available:true,status:'PEER_AUDIT_ONLY',auditSha256:release.catalogSha256,createdAt:text(catalog.created_utc,80),runtimePreview:release.runtimePreview,previewPinValid:runtimeOK,
    summary:{records:records.length,reportedScalePass:records.filter(r=>r.scaleStatus==='PASS').length,reportedNativePass:records.filter(r=>r.nativeGeometryStatus==='PASS').length,reportedStaticEligible:records.filter(r=>r.peerReportedEligibility.staticFixedCollider).length,matchedPinnedPreviews:records.filter(r=>r.previewJoin==='MATCHED_BOTH_LEVELS').length},records,permissions:permissions(false),limitations};
  }finally{activeReads--;}
 }
 async function load(root){try{return await state(root);}catch(e){if(e.status===429)throw e;return empty(e.code==='ENOENT'?'Reviewed usability11 audit is not installed.':text(e.message)||'Audit metadata could not be verified.');}}
 async function verify(root,sourceSha){
  if(typeof sourceSha!=='string'||!SHA.test(sourceSha))throw fail('Use the full lowercase source SHA256.',400);
  if(activeChecks>=1)throw fail('An exact source audit check is running. Retry shortly.',429);
  activeChecks++;
  try{
   const audit=await load(root);if(!audit.available)throw fail('Source audit unavailable; no use is authorized.');
   const record=audit.records.find(r=>r.sourceSha256===sourceSha);if(!record)throw fail('Exact source has no reviewed usability record.',404);
   if(record.previewJoin!=='MATCHED_BOTH_LEVELS')throw fail('Source and both assets do not join the pinned preview release.');
   // Reuse the preview reader's bounded regular-file, full-source/asset hashes,
   // embedded-only GLB and concurrency guards. No transform or mesh changes.
   for(const level of ['overview','detail']){const asset=await readPreviewAsset(root,sourceSha,level);if(asset.sourceSha256!==sourceSha||asset.sha256!==record.assetHashes[level])throw fail('Current source/asset bytes do not match the audited identity.');}
   return {available:true,status:'EXACT_PREVIEW_BYTES_VERIFIED',auditSha256:audit.auditSha256,record:{...record,currentBytesVerified:true,permissions:permissions(record.peerReportedEligibility.inspect)},verification:{sourceSha256:sourceSha,assetHashes:record.assetHashes,checkedAt:new Date().toISOString(),scope:'Rehashed source STEP and both pinned preview GLBs only. Peer native/physics tests were not rerun.'},limitations};
  }finally{activeChecks--;}
 }
 return {load,verify};
}
const reader=createUsabilityReader();
export const loadLibraryUsability=reader.load;
export const verifyLibraryUsabilitySource=reader.verify;
