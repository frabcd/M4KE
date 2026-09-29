import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUsabilityReader,loadLibraryUsability,USABILITY_RELEASE} from '../server/studio-usability.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const hashJSON=value=>sha(Buffer.from(JSON.stringify(value)));
test('application preview10 joins the reviewed usability11 parent without changing audit/source pins',()=>{
 assert.equal(USABILITY_RELEASE.runtimePreview,'preview-quality-10/manifest.json');
 assert.equal(USABILITY_RELEASE.runtimePreviewSha256,'c20e8cd10e1cc1c3d61c984dedd9a1d1204daa33437f1c78dd8d6f6305345872');
 assert.equal(USABILITY_RELEASE.runtimePreview,USABILITY_RELEASE.preview);assert.equal(USABILITY_RELEASE.runtimePreviewSha256,USABILITY_RELEASE.previewSha256);
 assert.equal(USABILITY_RELEASE.catalogSha256,'c40fa16fbca96ba522c4061099e3da3fa5ca4eb857daa726c049e97df1c9d5e4');
 assert.equal(USABILITY_RELEASE.indexSha256,'461f69b93078a584cbf998453196d10ea00428fba9a246c08ea6ad10a2bc458d');
});
function glb(){let text=JSON.stringify({asset:{version:'2.0'}});while(text.length%4)text+=' ';const b=Buffer.alloc(20+text.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);b.write(text,20);return b;}
async function fixture(){
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-usability-')),base=path.join(root,'database/model-library');for(const d of ['usability-11','preview-quality-10'])await mkdir(path.join(base,d),{recursive:true});
 const source=Buffer.from('Synthetic STEP identity fixture; not native geometry'),sourceHash=sha(source),asset=glb(),assetHash=sha(asset);
 await writeFile(path.join(base,'part.step'),source);await writeFile(path.join(base,'preview-quality-10/part.glb'),asset);
 const index={schema:'m4ke-model-library-candidate-index-2',records:[{sha256:sourceHash,relative_file:'part.step'}]};
 const level={file:'part.glb',sha256:assetHash,bytes:asset.length,triangles:12,source_frame_bounds_mm:[0,0,0,1,2,3],position_index_normal_checks:'PASS'};
 const previewRecord={name:'Fixture',source_sha256:sourceHash,source_file:'part.step',source_record:{sha256:sourceHash,license_file:'fixture-only'},status:'PREVIEW_GEOMETRY_CHECKS_PASS',runtime_qualified:false,physical_fit:'UNKNOWN',native:{bounds_mm:[0,0,0,1,2,3],solids:1},levels:{overview:{...level},detail:{...level}},quality_gates:Object.fromEntries(['all_native_solids_and_faces_retained','all_detail_faces_meshed','detail_bounds_within_0_03_mm','detail_volume_within_1_percent','detail_not_less_dense','each_file_below_32_MiB'].map(k=>[k,true]))};
 const preview={schema:'m4ke-library-preview-assets-1',source_index:'CANDIDATE-INDEX-20260927-10.json',source_index_sha256:hashJSON(index),coordinate_contract:{auto_centered:false,glb_to_source:'source_mm = [gltf_x,-gltf_z,gltf_y] * 1000'},records:[previewRecord]};
 const record={name:'Fixture source',source_sha256:sourceHash,pi_related:false,source:{file_relative_to_library:'part.step',declared_length_units:['millimetre'],imported_unit:'mm',revision_verified:false},scale_status:'PASS',preview_status:'PREVIEW_GEOMETRY_CHECKS_PASS',native_geometry_status:'PASS',static_collider_status:'STATIC_ENGINE_CHECK_PASS',dimensions_source_xyz_mm:[1,2,3],source_bounds_mm:[0,0,0,1,2,3],coordinate_contract:{matrix_layout:'row-major; column-vector multiplication',source_to_gltf_m:[[.001,0,0,0],[0,0,.001,0],[0,-.001,0,0],[0,0,0,1]],gltf_to_source_mm:[[1000,0,0,0],[0,0,-1000,0],[0,1000,0,0],[0,0,0,1]],source_origin_preserved:true,auto_center:false,scale_adjustment_allowed:false},geometry:{solid_count:1,sum_of_solid_volumes_mm3:6},previews:{overview:{sha256:assetHash,units:'m',up:'Y'},detail:{sha256:assetHash,units:'m',up:'Y'}},static_collider:{sha256:assetHash,units:'m',up:'Y'},evidence:{native_issue:null,static_issue:null},readiness:{inspect:{allowed:true},assembly:{allowed:true},dynamic_simulation:{allowed:true},manufacture:{allowed:true}}};
 const catalog={schema:'m4ke-library-ai-usability-1',created_utc:'2026-09-27T09:46:55Z',source_index:'CANDIDATE-INDEX-20260927-10.json',source_index_sha256:hashJSON(index),preview_manifest:'preview-quality-10/manifest.json',preview_manifest_sha256:hashJSON(preview),records:[record]};
 const release={catalog:'usability-11/ai-catalog.json',index:'CANDIDATE-INDEX-20260927-10.json',preview:'preview-quality-10/manifest.json',runtimePreview:'preview-quality-10/manifest.json'};
 async function save(){await writeFile(path.join(base,release.index),JSON.stringify(index));await writeFile(path.join(base,release.preview),JSON.stringify(preview));await writeFile(path.join(base,release.runtimePreview),JSON.stringify(preview));catalog.preview_manifest_sha256=hashJSON(preview);catalog.source_index_sha256=hashJSON(index);await writeFile(path.join(base,release.catalog),JSON.stringify(catalog));Object.assign(release,{catalogSha256:hashJSON(catalog),indexSha256:hashJSON(index),previewSha256:hashJSON(preview),runtimePreviewSha256:hashJSON(preview)});return createUsabilityReader({...release});}
 const reader=await save();return {root,base,record,catalog,preview,previewRecord,index,release,reader,sourceHash,assetHash,save,close:()=>rm(root,{recursive:true,force:true})};
}

test('summary reports exact metadata joins but grants no use; explicit byte read remains inspection-only',async()=>{
 const f=await fixture();try{const before=await readFile(path.join(f.base,'part.step')),data=await f.reader.load(f.root);assert.equal(data.available,true);assert.equal(data.summary.matchedPinnedPreviews,1);const r=data.records[0];assert.equal(r.previewJoin,'MATCHED_BOTH_LEVELS');assert.equal(r.currentBytesVerified,false);assert.equal(r.peerReportedEligibility.staticFixedCollider,true);assert(Object.values(r.permissions).every(v=>v===false));assert(!JSON.stringify(data).includes('part.step'));assert(!JSON.stringify(data).includes('file_relative_to_library'));
 const checked=await f.reader.verify(f.root,f.sourceHash);assert.equal(checked.status,'EXACT_PREVIEW_BYTES_VERIFIED');assert.equal(checked.record.currentBytesVerified,true);assert.equal(checked.record.permissions.inspect,true);for(const key of ['assembly','dynamicSimulation','manufacture','appPhysics'])assert.equal(checked.record.permissions[key],false);assert.deepEqual(checked.verification.assetHashes,{overview:f.assetHash,detail:f.assetHash});assert.deepEqual(await readFile(path.join(f.base,'part.step')),before);
 }finally{await f.close();}
});

test('negative native-volume hold overrides old preview PASS and forged readiness booleans',async()=>{
 const f=await fixture();try{f.record.native_geometry_status='REVIEW_REQUIRED';f.record.static_collider_status='REVIEW_REQUIRED';f.record.static_collider=null;f.record.geometry.sum_of_solid_volumes_mm3=null;f.record.evidence.native_issue='AssertionError: Nonpositive solid volume';const reader=await f.save(),r=(await reader.verify(f.root,f.sourceHash)).record;assert.equal(r.peerReportedEligibility.inspect,true);assert.equal(r.peerReportedEligibility.staticFixedCollider,false);assert.equal(r.nativeGeometryStatus,'REVIEW_REQUIRED');assert.match(r.nativeIssue,/Nonpositive/);assert.equal(r.permissions.inspect,true);assert.equal(r.permissions.appPhysics,false);}finally{await f.close();}
});

test('every exact source plus both GLB hashes is required, not name or candidate ordinal',async()=>{
 const f=await fixture();try{f.record.candidate_id='matching-label-is-not-identity';f.record.previews.detail.sha256='1'.repeat(64);const reader=await f.save(),r=(await reader.load(f.root)).records[0];assert.equal(r.previewJoin,'ASSET_OR_METADATA_MISMATCH');await assert.rejects(reader.verify(f.root,f.sourceHash),/both assets/);assert(Object.values(r.permissions).every(v=>v===false));}finally{await f.close();}
});

test('source or either current mesh tampering withholds verification without rewriting or accepting old metadata',async()=>{
 for(const file of ['part.step','preview-quality-10/part.glb']){const f=await fixture();try{await writeFile(path.join(f.base,file),'changed bytes');const listed=await f.reader.load(f.root);assert.equal(listed.records[0].currentBytesVerified,false);await assert.rejects(f.reader.verify(f.root,f.sourceHash),/changed/);}finally{await f.close();}}
});

test('missing audit and corrupt or changed parent metadata fail closed without older fallback',async()=>{
 const f=await fixture();try{assert.equal((await loadLibraryUsability(f.root)).available,false);for(const name of [f.release.catalog,f.release.index,f.release.preview]){const file=path.join(f.base,name),before=await readFile(file);await writeFile(file,'{}');const result=await f.reader.load(f.root);assert.equal(result.available,false);assert.deepEqual(result.records,[]);assert(Object.values(result.permissions).every(v=>v===false));await writeFile(file,before);}}finally{await f.close();}
});

test('duplicate identities, missing coordinate metadata and native PASS with negative volume never permit static use',async()=>{
 const f=await fixture();try{f.catalog.records.push(structuredClone(f.record));let reader=await f.save();assert.equal((await reader.load(f.root)).available,false);f.catalog.records.pop();delete f.record.coordinate_contract;reader=await f.save();let r=(await reader.load(f.root)).records[0];assert.equal(r.metadataStatus,'INVALID_RECORD');assert.equal(r.peerReportedEligibility.inspect,false);assert.equal(r.peerReportedEligibility.staticFixedCollider,false);}finally{await f.close();}
 const g=await fixture();try{g.record.geometry.sum_of_solid_volumes_mm3=-1;const r=(await(await g.save()).load(g.root)).records[0];assert.equal(r.peerReportedEligibility.staticFixedCollider,false);}finally{await g.close();}
});

test('unsupported matrices and collider units cannot transpose, scale or promote geometry',async()=>{
 for(const mutate of [r=>r.coordinate_contract.gltf_to_source_mm[0][0]=1,r=>r.coordinate_contract.auto_center=true,r=>r.coordinate_contract.scale_adjustment_allowed=true,r=>r.static_collider.units='mm',r=>r.static_collider.sha256='f'.repeat(64)]){const f=await fixture();try{mutate(f.record);const r=(await(await f.save()).load(f.root)).records[0];assert.equal(r.peerReportedEligibility.staticFixedCollider,false);assert.equal(r.permissions.appPhysics,false);}finally{await f.close();}}
});

test('invalid hashes, oversize metadata and concurrent exact checks are bounded',async()=>{
 const f=await fixture();try{await assert.rejects(f.reader.verify(f.root,'../secret'),e=>e.status===400);const first=f.reader.verify(f.root,f.sourceHash);await assert.rejects(f.reader.verify(f.root,f.sourceHash),e=>e.status===429);await first;await f.reader.verify(f.root,f.sourceHash);await writeFile(path.join(f.base,f.release.catalog),Buffer.alloc(8*1024*1024+1));assert.equal((await f.reader.load(f.root)).available,false);}finally{await f.close();}
});

test('symlinked audit inputs are rejected',{skip:process.platform==='win32'?'Symlink privilege unavailable on this fixture host':false},async()=>{
 const f=await fixture();try{const target=path.join(f.base,f.release.catalog),copy=target+'.copy';await writeFile(copy,await readFile(target));await rm(target);await symlink(copy,target);assert.equal((await f.reader.load(f.root)).available,false);}finally{await f.close();}
});

test('service exposes GET-only fail-closed audit routes without inference or CAD activity',async()=>{
 const {createStudioService}=await import('../server/studio-service.mjs'),{default:http}=await import('node:http');
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-usability-route-'));let forbidden=0;
 const mustNotRun=()=>{forbidden++;throw new Error('Not part of read-only audit');};
 const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
 const handle=createStudioService({root,getSettings:mustNotRun,getModels:mustNotRun,localFetch:mustNotRun,body:mustNotRun,runProcess:mustNotRun,json});
 const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(error){json(res,error.status||500,{error:error.message});}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port+'/api/studio/library/usability';
 try{const response=await fetch(base),data=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(data.available,false);assert.deepEqual(data.records,[]);assert(Object.values(data.permissions).every(v=>v===false));assert.equal((await fetch(base+'/short')).status,400);assert.equal((await fetch(base+'/'+'a'.repeat(64))).status,409);for(const method of ['POST','PUT','DELETE'])assert.equal((await fetch(base,{method})).status,404);assert.equal(forbidden,0);}finally{await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
