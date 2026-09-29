import test from 'node:test';
import assert from 'node:assert/strict';
import {safeProjectionSvg,generateIllustrations} from '../server/studio-illustrations.mjs';
import {tutorialHTML,runProcess} from '../server/studio-service.mjs';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {compileDesignKit,PORTABLE_KIT_ID} from '../engineering/kit-registry.mjs';

test('native projections are restricted images, not executable inline SVG',()=>{
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1"/></svg>');
  const image=safeProjectionSvg(svg);assert.match(image,/^data:image\/svg\+xml;base64,/);
  for(const xml of ['<svg><script>1</script><path/></svg>','<svg onload="alert(1)"><path/></svg>','<svg><image href="http://example.com"/><path/></svg>','<!DOCTYPE svg><svg><path/></svg>','<svg><foreignObject/><path/></svg>'])assert.throws(()=>safeProjectionSvg(Buffer.from(xml)));
  const spec={title:'Fixture',description:'Not physical evidence',requirements:[],assumptions:[],unknowns:[],assembly:[{id:'a',title:'Inspect',partIds:['p'],requires:[],instructions:['Inspect source model'],checks:['Physical check pending']}]};
  const verification={claims:[],limitations:[],overall:'UNVERIFIED'};
  assert(tutorialHTML(spec,verification,'hash',{a:image}).includes('src="'+image+'"'));
  assert(!tutorialHTML(spec,verification,'hash',{a:'https://external.invalid/model.svg'}).includes('<img'));
  assert(!tutorialHTML(spec,verification,'hash',{a:'" onerror="alert(1)'}).includes('<img'));
});

test('process runner captures output and bounds time and diagnostics',async()=>{
  const ok=await runProcess(process.execPath,['-e','process.stdout.write("checked")'],{timeout:4000});assert.equal(ok.stdout,'checked');assert.equal(ok.code,0);
  await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:100}),e=>e.status===504);
  await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("x".repeat(4096))'],{maxBytes:100,timeout:4000}),e=>e.status===502);
});

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceTest=(name,run)=>test(name,async t=>{
 const catalog=JSON.parse(await readFile(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
 assert.equal(catalog.schemaVersion,1);assert(Array.isArray(catalog.components));
 assert(catalog.components.every(c=>c&&typeof c==='object'&&!Array.isArray(c)&&typeof c.id==='string'));
 const required=['raspberry-pi-pico-r3','pololu-drv8833-2130','pololu-lp6v-1098','pololu-bracket-1086','pololu-wheel-1420','pololu-caster-950','adafruit-max4466-1063'];
 const missing=required.filter(id=>!catalog.components.some(c=>c.id===id));
 if(missing.length){t.skip('Source-only release lacks setup-imported catalog components: '+missing.join(', '));return;}
 // Present but invalid source metadata still reaches the strict compiler; it
 // must fail, not become an empty-catalog skip. The two pure tests run always.
 await run();
});
async function illustratedFixture(manifestOverride,runOverride){
 const dir=await mkdtemp(path.join(tmpdir(),'m4ke-illustration-'));
 try{
  const catalog=JSON.parse(await readFile(new URL('../catalog/manifest.json',import.meta.url),'utf8'));
  const {spec}=compileDesignKit(PORTABLE_KIT_ID,{lengthMm:180,widthMm:100,targetSpeedMS:.5,thresholdDbfs:-25},catalog);
  const cad={parts:spec.parts.map(p=>({id:p.id,sha256:{step:digest('synthetic STEP '+p.id)}}))};
  for(const folder of ['kernel','cad','illustrations'])await mkdir(path.join(dir,folder));
  const design=Buffer.from(JSON.stringify(spec)),result=Buffer.from(JSON.stringify(cad)),script=Buffer.from('Synthetic script fixture, not native execution');
  await writeFile(path.join(dir,'design.json'),design);await writeFile(path.join(dir,'cad/result.json'),result);await writeFile(path.join(dir,'kernel/illustrate.py'),script);
  const illustrations=[];
  for(const step of spec.assembly){const name=step.id+'.svg',bytes=Buffer.from('<svg><path d="M0 0L1 1"/></svg>');await writeFile(path.join(dir,'illustrations',name),bytes);illustrations.push({stepId:step.id,svg:name,sha256:digest(bytes),bytes:bytes.length,partIds:step.partIds,sourceStepSha256:Object.fromEntries(step.partIds.map(id=>[id,cad.parts.find(p=>p.id===id).sha256.step])),physicalFit:'UNKNOWN'});}
  const base={schemaVersion:1,status:'AVAILABLE',designSha256:digest(design),cadResultSha256:digest(result),scriptSha256:digest(script),illustrations,unavailable:[]};
  await writeFile(path.join(dir,'illustrations/manifest.json'),JSON.stringify(manifestOverride?manifestOverride(base):base));
  const answer=await generateIllustrations({dir,spec,cad,python:'not-executed-fixture',runProcess:async()=>runOverride||{code:0,stdout:'',stderr:''}});
  assert.deepEqual(await readFile(path.join(dir,'cad/result.json')),result);assert.deepEqual(await readFile(path.join(dir,'design.json')),design);
  return answer;
 }finally{await rm(dir,{recursive:true,force:true});}
}

sourceTest('actual portable48 part references admit nine hash-bound synthetic projections without modifying source evidence',async()=>{
 const result=await illustratedFixture();assert.equal(result.status,'AVAILABLE');assert.equal(Object.keys(result.images).length,9);assert.equal(result.files.length,10);assert.equal(result.reason,undefined);
});

sourceTest('early renderer refusal reports its actual bounded reason rather than a misleading missing-lineage error',async()=>{
 const result=await illustratedFixture(()=>({schemaVersion:1,status:'UNAVAILABLE',illustrations:[],unavailable:[{stepId:null,reason:'IllustrationError: Expected a millimetre design with 1..48 frozen parts\n'+ 'x'.repeat(5000)}]}));
 assert.equal(result.status,'UNAVAILABLE');assert.match(result.reason,/renderer refused before lineage validation.*1\.\.48/);assert(result.reason.length<1300);assert(!result.reason.includes('\n'));assert.deepEqual(result.images,{});assert.deepEqual(result.files,['ILLUSTRATIONS-UNAVAILABLE.json']);
});

sourceTest('a renderer error reason cannot bypass mismatched lineage or promote unverified SVGs',async()=>{
 for(const illustrations of [false,true]){const result=await illustratedFixture(base=>({...base,status:'UNAVAILABLE',designSha256:'0'.repeat(64),illustrations:illustrations?base.illustrations:[],unavailable:[{reason:'Claimed renderer failure'}]}));assert.equal(result.status,'UNAVAILABLE');assert.match(result.reason,/source lineage mismatch/);assert.deepEqual(result.images,{});}
});

sourceTest('valid-lineage incomplete results preserve renderer time-limit diagnostics without creating an image substitute',async()=>{
 const result=await illustratedFixture(base=>({...base,status:'UNAVAILABLE',illustrations:[],unavailable:[{stepId:'inspect',reason:'Native projection exceeded per-step or remaining total budget'}]}));assert.equal(result.status,'UNAVAILABLE');assert.match(result.reason,/exceeded per-step/);assert.deepEqual(result.images,{});
});

sourceTest('renderer process failure exposes bounded stderr instead of hiding it behind a manifest error',async()=>{
 const result=await illustratedFixture(null,{code:2,stdout:'',stderr:'IllustrationError: controlled native refusal'});assert.equal(result.status,'UNAVAILABLE');assert.match(result.reason,/controlled native refusal/);assert.deepEqual(result.images,{});
});
