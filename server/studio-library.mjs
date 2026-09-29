import {readdir,lstat,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const SCHEMA='m4ke-model-library-candidate-index-2';
const NAME=/^CANDIDATE-INDEX-(\d{8})-(\d{1,8})\.json$/;
const MAX_BYTES=8*1024*1024;
const text=(value,max=200)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):null;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)?value.toLowerCase():null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function sourceUrl(value){if(typeof value!=='string'||value.length>2000)return null;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
const limitations=[
  'Read-only supplier-intake candidate index; not the runtime component catalog.',
  'Native import results are reported by the intake process. This endpoint does not re-open CAD files or verify their current bytes.',
  'Recorded hash agreement links index fields only; it is not a fresh file hash check.',
  'Source variant, licence, dimensions, coordinate frames and mating interfaces need qualification before runtime use.',
  'No candidate is automatically imported, selected, print-qualified or physically verified.',
];
function unavailable(status,reason){return {available:false,status,reason,records:[],summary:{candidateCount:0,uniqueSourceFiles:0,nativeReportedValid:0,nativeReviewRequired:0,nativePending:0},limitations};}

/** No path parameters, downloads, migrations or writes into the teammate-owned database. */
export async function loadSourceLibrary(root){
  const database=path.join(root,'database'),folder=path.join(database,'model-library');
  try{
    for(const parent of [database,folder]){const stat=await lstat(parent);if(!stat.isDirectory()||stat.isSymbolicLink())return unavailable('INVALID_INDEX','Source library directory is not a regular local directory.');}
    const candidates=(await readdir(folder)).map(name=>({name,match:NAME.exec(name)})).filter(entry=>entry.match).sort((a,b)=>Number(b.match[1])-Number(a.match[1])||Number(b.match[2])-Number(a.match[2])||b.name.localeCompare(a.name));
    if(!candidates.length)return unavailable('NOT_IMPORTED','No compatible source candidate index is available on this DGX.');
    const name=candidates[0].name,target=path.join(folder,name),stat=await lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES)return unavailable('INVALID_INDEX','The latest source index is not a regular file or exceeds the 8 MiB limit.');
    const handle=await open(target,constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
    let bytes;try{const current=await handle.stat();if(!current.isFile()||current.size>MAX_BYTES)return unavailable('INVALID_INDEX','Source index exceeds the 8 MiB limit.');const buffer=Buffer.alloc(MAX_BYTES+1);let length=0;while(length<buffer.length){const read=await handle.read(buffer,length,buffer.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}if(length>MAX_BYTES)return unavailable('INVALID_INDEX','Source index exceeds the 8 MiB limit.');bytes=buffer.subarray(0,length);}finally{await handle.close();}
    const index=JSON.parse(bytes.toString('utf8'));
    if(index?.schema!==SCHEMA||!Array.isArray(index.records)||index.records.length>2000||index.records.some(record=>!record||typeof record!=='object'||Array.isArray(record)))return unavailable('INVALID_INDEX','Latest source index schema or record bounds are invalid. No older index is silently substituted.');
    const records=index.records.map((record,i)=>{
      const hash=sha(record.sha256),check=record.native_check&&typeof record.native_check==='object'&&!Array.isArray(record.native_check)?record.native_check:null;
      const checkHash=sha(check?.sha256),matches=!!hash&&checkHash===hash;
      const pending=!check||typeof check.status!=='string'||check.status.startsWith('PENDING');
      const status=check?.native_valid===true&&check.status==='NATIVE_IMPORT_VALID'&&matches?'NATIVE_IMPORT_REPORTED_VALID':pending?'PENDING':'REVIEW_REQUIRED';
      const size=check?.size_mm;
      const qualificationNotes=(Array.isArray(record.source_review)?record.source_review:[]).slice(0,8).filter(note=>note&&typeof note==='object'&&!Array.isArray(note)&&typeof note.finding==='string').map(note=>({finding:text(note.finding,1500),sourceUrl:sourceUrl(note.source),eligibility:text(note.catalog_eligibility,160)}));
      return {id:`candidate-${hash?.slice(0,16)||'unhashed'}-${i}`,name:text(record.name)||'Unnamed source candidate',sku:text(record.sku,100),sourceUrl:sourceUrl(record.source_url),productUrl:sourceUrl(record.product_url),revision:text(record.hardware_revision,100)||'UNVERIFIED',repositoryCommit:text(record.repository_commit,80),sha256:hash,bytes:count(record.bytes),piRelatedName:record.pi_related_name===true,eligibility:text(record.eligibility,160)||'source_candidate_pending_qualification',qualificationNotes,nativeCheck:{status,reportedValid:check?.native_valid===true?true:check?.native_valid===false?false:null,recordedShaMatches:matches,solidCount:count(check?.solids),sizeMm:Array.isArray(size)&&size.length===3&&size.every(value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000)?size:null},buildQualified:false,physicalValidation:'UNKNOWN'};
    });
    return {available:true,status:'SOURCE_CANDIDATES_ONLY',indexFile:name,indexSha256:createHash('sha256').update(bytes).digest('hex'),createdAt:text(index.created_utc,80),summary:{candidateCount:records.length,uniqueSourceFiles:new Set(records.map(r=>r.sha256).filter(Boolean)).size,nativeReportedValid:records.filter(r=>r.nativeCheck.status==='NATIVE_IMPORT_REPORTED_VALID').length,nativeReviewRequired:records.filter(r=>r.nativeCheck.status==='REVIEW_REQUIRED').length,nativePending:records.filter(r=>r.nativeCheck.status==='PENDING').length},records,limitations};
  }catch(e){if(e.code==='ENOENT')return unavailable('NOT_IMPORTED','No compatible source candidate index is available on this DGX.');return unavailable('INVALID_INDEX','Source index could not be read or parsed. The runtime catalog is unchanged.');}
}
