import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadPreviewLibrary} from '../server/studio-previews.mjs';

test('preview admission rejects malformed native-solid inventory before it becomes a React child',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-preview-review-'));
 try{
  const directory=path.join(root,'database/model-library/preview-quality-10');await mkdir(directory,{recursive:true});const sourceSha='a'.repeat(64),sourceFile='fixture.step',sourceIndex='CANDIDATE-INDEX-20260927-01.json';
  const index=Buffer.from(JSON.stringify({schema:'m4ke-model-library-candidate-index-2',records:[{sha256:sourceSha,relative_file:sourceFile}]}));await writeFile(path.join(directory,'..',sourceIndex),index);
  const level={file:'fixture.glb',sha256:'b'.repeat(64),bytes:128,triangles:12,source_frame_bounds_mm:[0,0,0,1,2,3],position_index_normal_checks:'PASS'};
  const record={source_sha256:sourceSha,source_file:sourceFile,source_record:{sha256:sourceSha},status:'PREVIEW_GEOMETRY_CHECKS_PASS',runtime_qualified:false,physical_fit:'UNKNOWN',native:{bounds_mm:[0,0,0,1,2,3],solids:1},levels:{overview:level,detail:level},quality_gates:Object.fromEntries(['all_native_solids_and_faces_retained','all_detail_faces_meshed','detail_bounds_within_0_03_mm','detail_volume_within_1_percent','detail_not_less_dense','each_file_below_32_MiB'].map(key=>[key,true]))};
  const manifest={schema:'m4ke-library-preview-assets-1',source_index:sourceIndex,source_index_sha256:createHash('sha256').update(index).digest('hex'),coordinate_contract:{auto_centered:false,glb_to_source:'source_mm = [gltf_x,-gltf_z,gltf_y] * 1000'},records:[record]};
  const save=()=>writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest));await save();assert.equal((await loadPreviewLibrary(root)).records.length,1);
  for(const invalid of [{unexpected:'object'},'1',null,-1,0,1.5]){record.native.solids=invalid;await save();assert.equal((await loadPreviewLibrary(root)).records.length,0,'Malformed native inventory must not reach the render boundary: '+JSON.stringify(invalid));}
 }finally{await rm(root,{recursive:true,force:true});}
});
