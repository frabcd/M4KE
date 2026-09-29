import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createProjectStore} from '../server/studio-projects.mjs';
import {snapshotKernel} from '../server/studio-catalog.mjs';
import {designHash} from '../server/studio-contract.mjs';

const sample = () => ({schemaVersion:1,title:'Audit fixture',description:'A test, not physical evidence',units:'mm',requirements:[{id:'motion',text:'Move at the preserved speed target'}],assumptions:[],unknowns:['Physical validation pending'],questions:[],parts:[{id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[40,30,5]},position:[0,0,0],rotation:[0,0,0]}],assembly:[{id:'inspect',title:'Inspect',partIds:['body'],requires:[],instructions:['Measure'],checks:['Dimensions checked']}],physicsInputs:{targetSpeedMS:{value:.5,basis:'USER',source:'Operator target'},motorStallA:{value:.36,basis:'MANUFACTURER',source:'Fixture source rating'},batteryMaxA:{value:.1,basis:'ASSUMED',source:'Pending battery selection'}}});
const uuid=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temporary(){const root=await mkdtemp(path.join(tmpdir(),'m4ke-review-'));return {root,close:()=>rm(root,{recursive:true,force:true})};}
async function settled(store,id){for(let i=0;i<200;i++){const p=await store.get(id);if(!store.isRunning())return p;await new Promise(r=>setTimeout(r,5));}throw new Error('Fixture did not settle');}

test('rejected job reassociation cannot overwrite a saved specification or revision',async()=>{
  const f=await temporary(),s=sample(),store=createProjectStore({root:f.root,execute:async()=>{},findJob:async()=>({designHash:designHash(s)})});
  try{const p=await store.create({request:'fixture',spec:s,jobId:uuid(9)});const edited=structuredClone(s);edited.parts[0].shape.size[0]=60;
    await assert.rejects(store.update(p.id,{expectedRevision:p.revision,spec:edited,jobId:uuid(9)}),/does not match/);
    const retained=await store.get(p.id);assert.equal(retained.revision,p.revision);assert.equal(retained.designHash,p.designHash);assert.deepEqual(retained.spec,p.spec);assert.equal(retained.jobId,uuid(9));
  }finally{await f.close();}
});

test('failed workflows preserve the last checkpoint and cannot retain running admission',async()=>{
  const f=await temporary();const store=createProjectStore({root:f.root,execute:async(p,input,save)=>{await save({workflow:{stage:'repair',attempts:[{number:1,jobId:uuid(7),criticalFailures:['electrical-nominal']}]}});throw new Error('Deliberate repair rejection');}});
  try{const p=await store.create({request:'fixture',spec:sample()});await store.start(p.id,{expectedRevision:p.revision});const end=await settled(store,p.id);assert.equal(end.workflow.status,'error');assert.equal(end.workflow.stage,'error');assert.equal(end.workflow.attempts[0].jobId,uuid(7));assert.match(end.workflow.message,/repair rejection/);assert.equal(store.isRunning(),false);assert.equal(end.designHash,p.designHash);
  }finally{await f.close();}
});

test('job catalog snapshot freezes only selected STEP geometry and exact interface coordinates',async()=>{
  const f=await temporary();try{
    await mkdir(path.join(f.root,'cad'));await mkdir(path.join(f.root,'catalog','models'),{recursive:true});
    for(const name of ['worker.py','catalog_geometry.py','requirements.txt'])await writeFile(path.join(f.root,'cad',name),'Fixture source '+name);
    const bytes=Buffer.from('Fixture STEP bytes; only snapshot lineage, not CAD validity is tested.');await writeFile(path.join(f.root,'catalog','models','selected.step'),bytes);
    const selected={id:'selected-part',sku:'exact-variant-17',geometry:{step:'models/selected.step',sha256:sha(bytes),units:'mm',frame:{method:'bbox-center',rotationDeg:[90,0,0]},sourceToLocal:{rotationDegXYZ:[90,0,0],rotationOrderApplied:'Z,Y,X',translationMm:[1.25,-2.5,3.75],scale:1}},interfaces:[{id:'mount',coordinateFrame:'catalog-local',dimensions:{centresMmXYZ:[[1,2,3],[4,5,6]]},reconciliation:'pending'}]};
    await writeFile(path.join(f.root,'catalog','manifest.json'),JSON.stringify({schemaVersion:1,components:[selected,{id:'unselected-no-model'}],materials:[],kits:[]}));
    const dir=path.join(f.root,'job'),result=await snapshotKernel(f.root,dir,{parts:[{shape:{type:'catalog',catalogId:'selected-part'}}]});
    const frozen=JSON.parse(await readFile(path.join(dir,'catalog','manifest.json'),'utf8'));assert.equal(frozen.components.length,1);assert.equal(frozen.components[0].sku,'exact-variant-17');assert.deepEqual(frozen.components[0].geometry.sourceToLocal,selected.geometry.sourceToLocal);assert.deepEqual(frozen.components[0].interfaces,selected.interfaces);assert.equal(result.hashes['catalog/manifest.json'],sha(await readFile(path.join(dir,'catalog','manifest.json'))));
    await writeFile(path.join(f.root,'catalog','models','selected.step'),'Later source mutation');assert.deepEqual(await readFile(path.join(dir,'catalog','models',sha(bytes)+'.step')),bytes);
  }finally{await f.close();}
});

test('automatic repair cannot erase or change any existing acceptance-driving physics input',async()=>{
  const {validateRepair}=await import('../server/studio-repair.mjs');
  for(const key of ['targetSpeedMS','motorStallA','batteryMaxA']){const original=sample(),missing=structuredClone(original),changed=structuredClone(original);delete missing.physicsInputs[key];changed.physicsInputs[key].value*=2;assert.throws(()=>validateRepair(original,missing),undefined,`Removing ${key} must fail`);assert.throws(()=>validateRepair(original,changed),undefined,`Changing ${key} must fail`);}
  const next=sample();next.parts[0].position[0]=8;assert.doesNotThrow(()=>validateRepair(sample(),next));
});

test('automatic repair cannot exchange a source catalog variant for a primitive or another SKU',async()=>{
  const {validateRepair}=await import('../server/studio-repair.mjs');const original=sample();original.parts[0].kind='purchased';original.parts[0].shape={type:'catalog',catalogId:'exact-motor'};
  const envelope=structuredClone(original);envelope.parts[0].shape={type:'box',size:[40,30,5]};assert.throws(()=>validateRepair(original,envelope));
  const variant=structuredClone(original);variant.parts[0].shape.catalogId='similar-motor';assert.throws(()=>validateRepair(original,variant));
});

test('failed deterministic checks cannot be repaired merely by disappearing or becoming UNKNOWN',async()=>{
  const {unresolvedRepairFailures}=await import('../server/studio-repair.mjs');const failed=[{id:'electrical-nominal',status:'FAIL',critical:true,label:'Electrical check'}];
  for(const claims of [[],[{id:'electrical-nominal',status:'UNKNOWN',critical:true}]])assert.equal(unresolvedRepairFailures(failed,{claims}).length,1);
  assert.deepEqual(unresolvedRepairFailures(failed,{claims:[{id:'electrical-nominal',status:'PASS',critical:true}]}),[]);
});

test('browser switching projects restores each saved kit route without reusing the prior project route',{timeout:60000},async t=>{
  const executablePath='C:/Program Files/Google/Chrome/Application/chrome.exe';try{await access(executablePath);}catch{t.skip('Chrome is not installed; fixture browser test requires local Chrome.');return;}
  const {createServer}=await import('vite'),{chromium}=await import('playwright'),root=fileURLToPath(new URL('../',import.meta.url));
  const vite=await createServer({root,configFile:path.join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,strictPort:false},logLevel:'error'});await vite.listen();
  let browser;try{
    browser=await chromium.launch({executablePath,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('m4ke-studio-language','en'));
    const general={id:uuid(1),request:'A spinning top',answers:[],budget:'',revision:1,spec:sample(),updatedAt:new Date().toISOString()};
    const kit={...structuredClone(general),id:uuid(2),request:'A sound car',workflow:{id:uuid(3),status:'complete',stage:'complete',message:'Fixture only',attempts:[],repairLimit:1,kitId:'sound-car-v1',parameters:{lengthMm:190}}};
    const projects=new Map([[general.id,general],[kit.id,kit]]);let mutations=0;const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/studio/**',async route=>{const request=route.request(),p=new URL(request.url()).pathname;let data;
      if(request.method()==='PUT'&&p.endsWith('/view'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...request.postDataJSON(),version:1})});
      if(request.method()!=='GET'){mutations++;return route.fulfill({status:500,contentType:'application/json',body:'{"error":"Fixture rejects all writes"}'});}
      if(p==='/api/studio/capabilities')data={model:'fixture-model',cad:{available:false},cloudFallback:false};
      else if(p==='/api/studio/catalog')data={schemaVersion:1,components:[],materials:[],kits:[{id:'sound-car-v1',name:'Sound car fixture',description:'Read-only test',availability:'candidate',missingComponents:[],parameters:{lengthMm:{label:'Chassis length',unit:'mm',minimum:150,maximum:200,default:180}}}]};
      else if(p==='/api/studio/projects')data={projects:[...projects.values()].map(p=>({id:p.id,title:p.request,updatedAt:p.updatedAt}))};
      else if(p.endsWith('/view'))data={version:0,selectedPartIds:[],activePartId:null,hiddenPartIds:[],stage:'refine',viewMode:'model',projection:'perspective',language:'en'};
      else data=projects.get(p.split('/').at(-1))||{error:'Unknown fixture route'};
      return route.fulfill({status:data.error?404:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    const base=`http://127.0.0.1:${vite.httpServer.address().port}`;await page.goto(base+'/?project='+kit.id);
    const intent=async()=>{if(await page.locator('dialog[open]').count())await page.getByRole('button',{name:'Close / 关闭',exact:true}).click();await page.getByRole('button',{name:'Model & material library',exact:true}).click();await page.getByRole('button',{name:'Runtime catalog',exact:true}).click();};
    const switchProject=async id=>{await page.getByRole('button',{name:'Close / 关闭',exact:true}).click();await page.locator('.project-button').click();await page.locator('.project-list-item').filter({hasText:projects.get(id).request}).click();};
    await page.locator('.workspace-toolbar').waitFor();await intent();assert.equal(await page.getByRole('combobox',{name:/^Design route/}).inputValue(),'sound-car-v1');assert.equal(await page.getByRole('spinbutton',{name:/^Chassis length/}).inputValue(),'190');
    await switchProject(general.id);await page.waitForFunction(id=>new URL(location.href).searchParams.get('project')===id,general.id);await intent();assert.equal(await page.getByRole('combobox',{name:/^Design route/}).inputValue(),'');assert.equal(await page.getByRole('spinbutton',{name:/^Chassis length/}).count(),0);
    await switchProject(kit.id);await page.waitForFunction(id=>new URL(location.href).searchParams.get('project')===id,kit.id);await intent();assert.equal(await page.getByRole('combobox',{name:/^Design route/}).inputValue(),'sound-car-v1');assert.equal(await page.getByRole('spinbutton',{name:/^Chassis length/}).inputValue(),'190');assert.equal(mutations,0);assert.deepEqual(errors,[]);
  }finally{await browser?.close();await vite.close();}
});
