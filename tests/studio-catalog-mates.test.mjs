import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateDesignSpec,verifyDesign,designHash} from '../server/studio-contract.mjs';
import {DESIGN_JSON_SCHEMA} from '../server/studio-schema.mjs';
import {snapshotKernel} from '../server/studio-catalog.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const request=()=>({id:'coupling',requirementId:'fit',type:'catalogMate',shaftPartId:'shaft',shaftInterfaceId:'output',borePartId:'hub',boreInterfaceId:'bore',minimumEngagementMm:3,diametralClearanceMm:[0,.1]});
const design=()=>({schemaVersion:1,title:'Generic coupling fixture',description:'Software fixture, not a physical toy.',units:'mm',requirements:[{id:'fit',text:'Check the source-bound coupling.'}],assumptions:[],unknowns:['Physical fit is unmeasured.'],questions:[],parts:['shaft','hub'].map(id=>({id,name:id,kind:'purchased',material:'source component',color:'#123456',shape:{type:'catalog',catalogId:'fixture'},position:[0,0,0],rotation:[0,0,0]})),assembly:[{id:'inspect',title:'Inspect',partIds:['shaft','hub'],requires:[],instructions:['Inspect actual interface.'],checks:['Measure fit.']}],verificationRequests:[request()]});

test('catalogMate accepts only selected source-part/interface IDs and bounded criteria without mutation',()=>{
  const original=design(),before=structuredClone(original),clean=validateDesignSpec(original);assert.deepEqual(clean.verificationRequests,[request()]);assert.deepEqual(original,before);
  const rule=DESIGN_JSON_SCHEMA.properties.verificationRequests.items.anyOf.find(r=>r.properties.type.enum.includes('catalogMate'));
  assert.deepEqual(rule.required,Object.keys(request()));assert.equal(rule.additionalProperties,false);assert(!rule.properties.axis);assert(!rule.properties.sourceSha256);
  for(const edit of [r=>r.axis=[1,0,0],r=>r.sourceSha256='a'.repeat(64),r=>r.borePartId='shaft',r=>r.borePartId='missing',r=>r.shaftInterfaceId='../escape',r=>r.minimumEngagementMm=0,r=>r.diametralClearanceMm=[.2,0],r=>r.diametralClearanceMm=[-.1,0]]){
    const invalid=design();edit(invalid.verificationRequests[0]);assert.throws(()=>validateDesignSpec(invalid));
  }
  const primitive=design();primitive.parts[0].shape={type:'cylinder',radius:1.5,height:10};assert.throws(()=>validateDesignSpec(primitive),/source-catalog/);
});

test('nominal mating UNKNOWN and uncovered interfaces remain critical and cannot turn noncollision into fit PASS',()=>{
  const spec=validateDesignSpec(design()),cad={revisionHash:designHash(spec),parts:spec.parts.map(p=>({id:p.id,valid:true,solidCount:1,volumeMm3:100})),errors:[],checks:[{id:'request:coupling',label:'Nominal catalog mate',status:'UNKNOWN',observed:{nominalGeometryStatus:'PASS',physicalFit:'UNKNOWN'}},{id:'catalog-mate-uncovered:shaft:output',label:'Uncovered',status:'UNKNOWN'}]};
  const report=verifyDesign(spec,cad);for(const id of ['kernel-request:coupling','kernel-catalog-mate-uncovered:shaft:output'])assert(report.claims.some(c=>c.id===id&&c.status==='UNKNOWN'&&c.critical));assert.equal(report.overall,'UNVERIFIED');
  cad.checks[0].status='FAIL';assert.equal(verifyDesign(spec,cad).overall,'FAILED');
});

test('catalog interface repair errors name the precise field without changing acceptance bounds',()=>{
  const s=design();s.verificationRequests[0].diametralClearanceMm=[-.1,0];
  assert.throws(()=>validateDesignSpec(s),e=>e.message.startsWith('verificationRequests[0].diametralClearanceMm[0]:'));
  s.verificationRequests[0].diametralClearanceMm=[0,.1];s.verificationRequests[0].boreInterfaceId='../bad';
  assert.throws(()=>validateDesignSpec(s),e=>e.message.startsWith('verificationRequests[0].boreInterfaceId:'));
});

async function fixture(){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-mate-snapshot-'));await mkdir(path.join(root,'cad'));await mkdir(path.join(root,'catalog','models'),{recursive:true});
  for(const name of ['worker.py','catalog_geometry.py','catalog_mates.py','requirements.txt'])await writeFile(path.join(root,'cad',name),'test fixture '+name);
  const step=Buffer.from('Snapshot fixture bytes: not actual native geometry.'),sourceHash=hash(step),evidence=Buffer.from(JSON.stringify([{path:'models/part.step',sha256:sourceHash,cylinders:[]}])) ;await writeFile(path.join(root,'catalog','models','part.step'),step);await writeFile(path.join(root,'catalog','interface-surface-inventory.json'),evidence);
  const record={id:'output',type:'shaft-axis',sourceArtifact:'models/part.step',sourceSha256:sourceHash,evidenceArtifact:'interface-surface-inventory.json',evidenceSha256:hash(evidence)};
  const manifest={schemaVersion:1,components:[{id:'fixture',geometry:{step:'models/part.step',sha256:sourceHash,units:'mm'},interfaces:[record]}]};const save=()=>writeFile(path.join(root,'catalog','manifest.json'),JSON.stringify(manifest));await save();
  return {root,record,manifest,evidence,save,close:()=>rm(root,{recursive:true,force:true})};
}
test('selected catalog mating inventory and helper are snapshotted once with immutable SHA-bound bytes',async()=>{
  const f=await fixture();try{const result=await snapshotKernel(f.root,path.join(f.root,'job'),design());assert.equal(result.files.filter(p=>p==='catalog/interface-surface-inventory.json').length,1);assert(result.files.includes('kernel/catalog_mates.py'));assert.equal(result.hashes['catalog/interface-surface-inventory.json'],hash(f.evidence));assert.deepEqual(await readFile(path.join(f.root,'job','catalog','interface-surface-inventory.json')),f.evidence);const saved=JSON.parse(await readFile(path.join(f.root,'job','catalog','manifest.json'),'utf8'));assert.equal(saved.components[0].interfaces[0].sourceArtifact,'models/part.step');assert.equal(saved.components[0].geometry.originalPath,'models/part.step');}finally{await f.close();}
});
test('unselected catalog interfaces do not cause evidence acquisition or a model-supplied path read',async()=>{
  const f=await fixture();try{const noCatalog={parts:[]};const r=await snapshotKernel(f.root,path.join(f.root,'job'),noCatalog);assert(!r.files.includes('catalog/interface-surface-inventory.json'));}finally{await f.close();}
});
test('catalog mate evidence hash, source binding, size and path fail closed',async()=>{
  for(const change of [f=>f.record.evidenceArtifact='../outside.json',f=>f.record.evidenceSha256='0'.repeat(64),f=>f.record.sourceSha256='0'.repeat(64),f=>f.record.sourceArtifact='models/other.step',async f=>writeFile(path.join(f.root,'catalog','interface-surface-inventory.json'),Buffer.alloc(2*1024*1024+1))]){
    const f=await fixture();try{await change(f);await f.save();await assert.rejects(snapshotKernel(f.root,path.join(f.root,'job'),design()),/interface.*(binding|SHA256|size)/i);}finally{await f.close();}
  }
});
