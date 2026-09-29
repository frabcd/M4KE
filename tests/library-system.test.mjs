import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {createModelLibrary,readLibraryFile,validateLibraryContext} from '../server/studio-model-library.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,{pi=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-library13-'));t.after(()=>rm(root,{recursive:true,force:true}));const base=path.join(root,'database/model-library');await mkdir(path.join(base,'intake/models'),{recursive:true});
 const bytes=Buffer.from('ISO-10303-21;\nSYNTHETIC BYTE FIXTURE ONLY\nEND-ISO-10303-21;'),sha=hash(bytes);await writeFile(path.join(base,'intake/models/source.step'),bytes);await writeFile(path.join(base,'intake/LICENSE.txt'),'Synthetic fixture licence');
 const index={schema:'m4ke-model-library-candidate-index-2',records:[{name:pi?'Raspberry Pi Pico':'Unpreviewed bearing',sha256:sha,relative_file:'intake/models/source.step',license_file:'LICENSE.txt',native_check:{sha256:sha,native_valid:true,status:'NATIVE_IMPORT_VALID',size_mm:[10,20,30],source_bounds_mm:[4,5,6,14,25,36],solids:1,faces:6}}]};
 const preview={schema:'m4ke-library-preview-assets-1',records:[]};
 const indexBytes=Buffer.from(JSON.stringify(index)),previewBytes=Buffer.from(JSON.stringify(preview));
 const audit={schema:'m4ke-library-ai-usability-1',source_index_sha256:hash(indexBytes),preview_manifest_sha256:hash(previewBytes),records:[]};const auditBytes=Buffer.from(JSON.stringify(audit));
 const collision={schema:'m4ke-static-collision-companions-1',upstream_ai_catalog_sha256:hash(auditBytes),upstream_preview_manifest_sha256:hash(previewBytes),records:[]};
 const docs={index:indexBytes,preview:previewBytes,audit:auditBytes,collision:Buffer.from(JSON.stringify(collision))},release={};
 for(const [k,b]of Object.entries(docs)){await writeFile(path.join(base,k+'.json'),b);release[k]=[k+'.json',hash(b)];}
 return {root,base,sha,api:createModelLibrary({root,release}),release};
}
test('whole-source search includes valid sources without existing GLB previews',async t=>{const f=await fixture(t);const r=await f.api.search('bearing');assert.equal(r.records.length,1);assert.equal(r.records[0].previewAvailable,false);assert.equal(r.records[0].nativeImportCandidate,true);assert.equal(r.records[0].dynamicSimulation,false);});
test('immutable snapshot retains off-centre bounds and original bytes and licence',async t=>{const f=await fixture(t),saved=new Map();const m=await f.api.snapshot({parts:[{shape:{type:'library',sourceSha256:f.sha}}]},async(k,v)=>saved.set(k,v));assert.equal(hash(saved.get('library/models/'+f.sha+'.step')),f.sha);assert.deepEqual(m.entries[0].sourceBoundsMm,[4,5,6,14,25,36]);assert.equal(m.entries[0].frame,'source-origin');assert(saved.has('library/'+m.entries[0].license.file));});
test('changed source bytes fail before snapshot or download',async t=>{const f=await fixture(t);await writeFile(path.join(f.base,'intake/models/source.step'),'corrupt');await assert.rejects(()=>f.api.resolve(f.sha),/hash mismatch/);await assert.rejects(()=>f.api.sourceAsset(f.sha),/integrity/);});
test('changed release metadata cannot widen model permissions',async t=>{const f=await fixture(t);await writeFile(path.join(f.base,'audit.json'),'{}');await assert.rejects(()=>f.api.inventory(),/Pinned library audit changed/);});
test('Pi metadata is searchable but native import is not a default',async t=>{const f=await fixture(t,{pi:true});assert.equal((await f.api.search('Pico')).records[0].piRequiresExplicitUserSelection,true);await assert.rejects(()=>f.api.resolve(f.sha),/explicit user/);});
test('no path traversal or linked directories',async t=>{const f=await fixture(t);await assert.rejects(()=>readLibraryFile(f.root,'../index.json'),/Unsafe/);await symlink(os.tmpdir(),path.join(f.base,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>readLibraryFile(f.root,'linked/anything'),/Linked/);});
test('unknown source and collider fail closed',async t=>{const f=await fixture(t);await assert.rejects(()=>f.api.resolve('0'.repeat(64)),/missing/);await assert.rejects(()=>f.api.collider(f.sha),/held/);await assert.rejects(()=>f.api.resolve('../source.step'),/SHA256/);});
test('source downloads are inspected bytes, not print or physics approval',async t=>{const f=await fixture(t);const d=await f.api.describe(f.sha);assert.equal(d.currentSourceBytesVerified,true);assert.equal(d.manufacturingQualified,false);assert.equal(d.physicalFit,'UNKNOWN');});
test('tampered or arbitrary model-supplied context is rejected',()=>{assert.throws(()=>validateLibraryContext({sha256:'a'.repeat(64),data:{schema:'m4ke-native-library-context-1',records:[]}}));});
