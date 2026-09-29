import {lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const SHA=/^[a-f0-9]{64}$/,MAX=32*1024*1024,FOLDER='preview-quality-10';
let activeAssetReads=0;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const text=value=>typeof value==='string'?value.replace(/[\u0000-\u001f]/g,' ').slice(0,300):'';
const bounds=value=>Array.isArray(value)&&value.length===6&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<1e6)&&value.slice(3).every((n,i)=>n>value[i]);
const safeRelative=value=>typeof value==='string'&&value.length<500&&!value.includes('\\')&&!value.includes(':')&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
async function readLocal(root,relative,limit){
  if(!safeRelative(relative))throw fail('Invalid preview source path.');
  let parent=root;const rootStat=await lstat(parent);if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw fail('Preview root is not a regular directory.');
  const segments=relative.split('/');for(const segment of segments.slice(0,-1)){parent=path.join(parent,segment);const s=await lstat(parent);if(!s.isDirectory()||s.isSymbolicLink())throw fail('Preview directory links are not allowed.');}
  const target=path.join(parent,segments.at(-1)),stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw fail('Preview input is not a bounded regular file.');
  const handle=await open(target,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
  try{const current=await handle.stat();if(!current.isFile()||current.size>limit)throw fail('Preview input exceeds the file limit.');const buffer=Buffer.alloc(current.size+1);let size=0;while(size<buffer.length){const r=await handle.read(buffer,size,buffer.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}if(size!==current.size)throw fail('Preview file changed during reading.');return buffer.subarray(0,size);}finally{await handle.close();}
}
function assetMeta(level){return level&&safeRelative(level.file)&&SHA.test(level.sha256)&&Number.isSafeInteger(level.bytes)&&level.bytes>20&&level.bytes<=MAX&&Number.isSafeInteger(level.triangles)&&level.triangles>0&&level.triangles<8e6&&bounds(level.source_frame_bounds_mm)&&level.position_index_normal_checks==='PASS';}
async function manifest(root){
  const base=path.join(root,'database'),relative=`model-library/${FOLDER}/manifest.json`;
  const bytes=await readLocal(base,relative,8*1024*1024),data=JSON.parse(bytes);
  if(data.schema!=='m4ke-library-preview-assets-1'||!Array.isArray(data.records)||data.records.length>2000||data.coordinate_contract?.auto_centered!==false||data.coordinate_contract?.glb_to_source!=='source_mm = [gltf_x,-gltf_z,gltf_y] * 1000'||!/^CANDIDATE-INDEX-\d{8}-\d{1,8}\.json$/.test(data.source_index)||!SHA.test(data.source_index_sha256))throw fail('Preview manifest contract is unsupported.');
  const sourceIndex=await readLocal(base,'model-library/'+data.source_index,8*1024*1024);if(digest(sourceIndex)!==data.source_index_sha256)throw fail('Preview source index changed.');
  const index=JSON.parse(sourceIndex);if(index.schema!=='m4ke-model-library-candidate-index-2'||!Array.isArray(index.records)||index.records.length>2000)throw fail('Preview source index is invalid.');
  const candidates=new Set(index.records.map(record=>record.sha256+'|'+record.relative_file));
  const entries=data.records.filter(record=>record.status==='PREVIEW_GEOMETRY_CHECKS_PASS'&&SHA.test(record.source_sha256)&&safeRelative(record.source_file)&&candidates.has(record.source_sha256+'|'+record.source_file)&&record.source_record?.sha256===record.source_sha256&&record.runtime_qualified===false&&record.physical_fit==='UNKNOWN'&&bounds(record.native?.bounds_mm)&&Number.isSafeInteger(record.native.solids)&&record.native.solids>0&&record.native.solids<=100000&&['all_native_solids_and_faces_retained','all_detail_faces_meshed','detail_bounds_within_0_03_mm','detail_volume_within_1_percent','detail_not_less_dense','each_file_below_32_MiB'].every(key=>record.quality_gates?.[key]===true)&&assetMeta(record.levels?.overview)&&assetMeta(record.levels?.detail));
  if(new Set(entries.map(record=>record.source_sha256)).size!==entries.length)throw fail('Duplicate preview identities.');
  return {base,data,entries,sha256:digest(bytes)};
}
export async function loadPreviewLibrary(root){
  try{const {entries,data,sha256}=await manifest(root);return {available:true,status:'SOURCE_PREVIEWS_ONLY',manifestFile:FOLDER+'/manifest.json',manifestSha256:sha256,createdAt:text(data.created_utc),reviewOrUnavailable:data.records.length-entries.length,records:entries.map(record=>({sourceSha256:record.source_sha256,name:text(record.name),sourceBoundsMm:record.native.bounds_mm,nativeSolids:record.native.solids,licenseFile:text(record.source_record?.license_file),eligibility:text(record.source_record?.eligibility),qualificationNotes:(Array.isArray(record.source_record?.source_review)?record.source_record.source_review:[]).slice(0,8).map(note=>text(note?.finding)).filter(Boolean),physicalValidation:'UNKNOWN',buildQualified:false,levels:Object.fromEntries(['overview','detail'].map(level=>[level,{sha256:record.levels[level].sha256,bytes:record.levels[level].bytes,triangles:record.levels[level].triangles,boundsMm:record.levels[level].source_frame_bounds_mm,url:`/api/studio/library/previews/${record.source_sha256}/${level}.glb`}]))}))};}
  catch(e){return {available:false,status:'PREVIEW_UNAVAILABLE',reason:e.code==='ENOENT'?'No compatible preview manifest is installed.':'Preview contract or source-index verification failed.',records:[]};}
}
function checkEmbeddedGlb(bytes){
  if(bytes.length<20||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw fail('Invalid binary glTF preview.');
  const length=bytes.readUInt32LE(12);if(length>bytes.length-20)throw fail('Invalid glTF JSON size.');
  const json=JSON.parse(bytes.subarray(20,20+length).toString('utf8'));
  const pending=[json];while(pending.length){const item=pending.pop();if(item&&typeof item==='object')for(const [key,value]of Object.entries(item)){if(key==='uri')throw fail('External or embedded URI resources are not allowed in offline previews.');if(value&&typeof value==='object')pending.push(value);}}
}
export async function readPreviewAsset(root,sourceSha,level){
  if(activeAssetReads>=2)throw fail('Two source previews are already loading. Retry after they finish.',429);
  activeAssetReads++;try{
  if(!SHA.test(sourceSha)||!['overview','detail'].includes(level))throw fail('Invalid preview identity.',400);
  const {base,entries}=await manifest(root),record=entries.find(record=>record.source_sha256===sourceSha);if(!record)throw fail('No reviewed preview exists for that exact source.',404);
  const source=await readLocal(base,'model-library/'+record.source_file,128*1024*1024);if(digest(source)!==record.source_sha256)throw fail('Source STEP changed; preview withheld.');
  const metadata=record.levels[level],bytes=await readLocal(base,`model-library/${FOLDER}/`+metadata.file,MAX);
  if(bytes.length!==metadata.bytes||digest(bytes)!==metadata.sha256)throw fail('Preview bytes changed; preview withheld.');checkEmbeddedGlb(bytes);
  return {bytes,sha256:metadata.sha256,sourceSha256:record.source_sha256};
  }finally{activeAssetReads--;}
}
