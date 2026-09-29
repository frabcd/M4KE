import {readFile,lstat,mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createModelLibrary} from './studio-model-library.mjs';

/** Read setup-imported records only; never downloads or follows supplier links. */
export async function loadCatalog(root){
  const target=path.join(root,'catalog','manifest.json');
  try{const stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw new Error('Invalid local catalog manifest.');const bytes=await readFile(target);const c=JSON.parse(bytes);if(c.schemaVersion!==1||!Array.isArray(c.components)||c.components.length>500||new Set(c.components.map(p=>p.id)).size!==c.components.length)throw new Error('Invalid local catalog schema.');return {...c,manifestSha256:createHash('sha256').update(bytes).digest('hex'),runtimeNetworkRequired:false};}
  catch(e){if(e.code==='ENOENT')return {schemaVersion:1,components:[],materials:[],kits:[],runtimeNetworkRequired:false,limitations:['Local component catalog has not been imported.']};throw e;}
}
export function catalogContext(c){return {catalogRevision:c.catalogRevision,manifestSha256:c.manifestSha256,offline:true,components:c.components.slice(0,40).map(p=>({id:p.id,name:p.name,sku:p.sku,geometry:p.geometry?{type:'catalog',catalogId:p.id,boundsMm:p.geometry.boundsMm,frame:p.geometry.frame}:null,interfaces:p.interfaces,ratings:p.ratings,massG:p.massG,sourceUrls:p.sourceUrls,limitations:p.limitations})),materials:c.materials,kits:c.kits,limitations:['Catalog data is setup-sourced provenance, not physical verification. Only geometry with a recorded STEP hash can be imported. Source drawing interfaces must be reconciled with the fixed centered model frame. Never invent a part ID, price, CAD shape, fit, stock, or license.']};}

/** Initial-draft feedback only: match selected SKU data before physics becomes immutable. */
export function generationCatalogIssues(spec,catalog){
  const issues=[],physics=spec?.physicsInputs||{},components=catalog?.components||[];
  const catalogIds=[...new Set((spec?.parts||[]).filter(p=>p?.shape?.type==='catalog').map(p=>p.shape.catalogId))];
  // Metadata-only/source-drawing records are not native CAD. This preflight reads
  // the admitted local catalog only; snapshotKernel still verifies files/hashes.
  for(const id of catalogIds){
    const geometry=components.find(c=>c.id===id)?.geometry,step=geometry?.step;
    const usablePath=typeof step==='string'&&step.trim()===step&&!step.includes('\\')&&!step.includes(':')&&!step.split('/').some(s=>s==='..'||s==='')&&['models','sources'].includes(step.split('/')[0])&&/\.(step|stp)$/i.test(step);
    if(!usablePath||typeof geometry?.sha256!=='string'||!/^[0-9a-f]{64}$/.test(geometry.sha256))issues.push(`Selected catalog geometry ${id} has no admitted source STEP path and SHA-256. A drawing, metadata entry or candidate reference is not importable CAD. Use an explicitly ASSUMED purchased envelope with unresolved fit, or import the exact source through the reviewed catalog setup before choosing type catalog; do not invent a catalog ID or geometry hash.`);
  }
  // The scalar motion model must use the actual selected wheel's nominal radius.
  // Evidence labels cannot change source geometry; this does not prove loaded tyre radius.
  const wheels=catalogIds.flatMap(id=>(components.find(c=>c.id===id)?.interfaces||[])
    .filter(i=>['d-shaft-bore','cylindrical-bore'].includes(i.type)&&Number.isFinite(i.dimensions?.nominalOuterDiameterMm)&&i.dimensions.nominalOuterDiameterMm>0)
    .map(i=>({id,radius:i.dimensions.nominalOuterDiameterMm/2})));
  if(physics.wheelRadiusMm&&wheels.length){
    const radii=[...new Set(wheels.map(w=>w.radius))];
    if(radii.length>1)issues.push('Selected wheels have different source radii; the scalar wheelRadiusMm model cannot average incompatible driven wheels. Resolve the drive-wheel selection explicitly.');
    else if(!Number.isFinite(physics.wheelRadiusMm.value)||Math.abs(physics.wheelRadiusMm.value-radii[0])>Math.max(1e-6,radii[0]*.001))issues.push(`physicsInputs.wheelRadiusMm=${physics.wheelRadiusMm.value} contradicts selected ${wheels.map(w=>w.id).join(', ')} source nominal radius ${radii[0]} mm. Use the selected source geometry, not a larger assumed radius to satisfy speed.`);
  }
  const mapping={motorNoLoadRpm:['noLoadRpm','rpm',1],motorStallTorqueNm:['theoreticalStallTorqueKgfCm','kgf*cm',.0980665],motorStallA:['theoreticalStallCurrentA','A',1],motorVoltage:['voltageV','V',1]};
  const selected=catalogIds
    .map(id=>components.find(c=>c.id===id)).filter(c=>c?.ratings&&(c.ratings.noLoadRpm||c.ratings.theoreticalStallTorqueKgfCm||c.ratings.theoreticalStallCurrentA));
  const usable=physics.motorTorqueNm?.value,declaredStall=physics.motorStallTorqueNm?.value;
  if(Number.isFinite(usable)&&Number.isFinite(declaredStall)&&usable>=declaredStall)issues.push('physicsInputs.motorTorqueNm must be below motorStallTorqueNm regardless of evidence basis; stall torque is not usable operating torque. Supply a justified operating point.');
  if(selected.length>1){
    if(Object.keys(mapping).some(key=>physics[key])||physics.motorTorqueNm)issues.push(`Selected motor SKUs ${selected.map(c=>c.id).join(', ')} cannot share the scalar motor physics mapping. Mixed motor ratings are unsupported; select a consistent SKU or leave unsupported inputs unresolved, never average or borrow ratings.`);
    return issues;
  }
  if(!selected.length)return issues;
  const motor=selected[0];
  for(const [key,[ratingKey,unit,factor]] of Object.entries(mapping)){
    const input=physics[key],rating=motor.ratings[ratingKey];
    if(!input)continue;
    if(!rating||rating.basis!=='MANUFACTURER_PUBLISHED'||rating.unit!==unit||!Number.isFinite(rating.value)){
      if(input.basis==='MANUFACTURER')issues.push(`physicsInputs.${key} claims MANUFACTURER for selected ${motor.id}, but this catalog has no supported published ${ratingKey} (${unit}) mapping. Do not fabricate a missing rating.`);continue;
    }
    // A provenance label cannot override a known exact-SKU rating. Matching an
    // assumed value only clears this contradiction; it does not qualify evidence.
    const expected=rating.value*factor,tolerance=Math.max(1e-6,Math.abs(expected)*.001);
    if(!Number.isFinite(input.value)||Math.abs(input.value-expected)>tolerance)issues.push(`physicsInputs.${key}=${input.value} contradicts selected ${motor.id} (SKU ${motor.sku||motor.id}): ${ratingKey}=${rating.value} ${unit} implies ${expected}. Use this selected SKU's published rating, not another motor's data.`);
  }
  const stall=motor.ratings.theoreticalStallTorqueKgfCm;
  if(Number.isFinite(usable)&&stall?.basis==='MANUFACTURER_PUBLISHED'&&stall.unit==='kgf*cm'&&Number.isFinite(stall.value)&&usable>=stall.value*.0980665)issues.push(`physicsInputs.motorTorqueNm=${usable} is at or above selected ${motor.id} published stall torque ${stall.value*.0980665} Nm. It cannot be a usable operating torque regardless of basis; derive a below-stall operating point.`);
  return issues;
}

/** Freeze input CAD dependencies before execution; edits elsewhere cannot mutate a job. */
export async function snapshotKernel(root,dir,spec,metadataIds=[],libraryOptions={}){
  const files=[];const hashes={};
  async function save(name,bytes){await mkdir(path.dirname(path.join(dir,name)),{recursive:true});await writeFile(path.join(dir,name),bytes);files.push(name);hashes[name]=createHash('sha256').update(bytes).digest('hex');}
  for(const name of ['worker.py','catalog_geometry.py','catalog_mates.py','requirements.txt']){try{await save('kernel/'+name,await readFile(path.join(root,'cad',name)));}catch(e){if(name==='catalog_mates.py'&&e.code==='ENOENT'&&!spec.verificationRequests?.some(r=>r.type==='catalogMate'))continue;if(name!=='catalog_geometry.py'||spec.parts.some(p=>p.shape.type==='catalog'))throw e;}}
  try{await save('kernel/illustrate.py',await readFile(path.join(root,'cad','illustrate.py')));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(spec.parts.some(p=>p.shape.type==='library')){
    await save('kernel/library_geometry.py',await readFile(path.join(root,'cad/library_geometry.py')));
    await createModelLibrary({root}).snapshot(spec,save,libraryOptions);
  }
  const catalog=await loadCatalog(root),ids=[...new Set(spec.parts.filter(p=>p.shape.type==='catalog').map(p=>p.shape.catalogId))],components=[];
  if(ids.length){
    const sourceRoot=await realpath(path.join(root,'catalog'));
    for(const id of ids){const original=catalog.components.find(c=>c.id===id);if(!original?.geometry?.step)throw new Error(`Catalog component ${id} has no source STEP.`);const c=structuredClone(original),rel=c.geometry.step;
      if(typeof rel!=='string'||rel.includes('\\')||rel.includes(':')||rel.split('/').some(s=>s==='..')||!['models','sources'].includes(rel.split('/')[0])||!/^.*\.(step|stp)$/i.test(rel))throw new Error('Unsafe catalog STEP path.');
      const target=await realpath(path.join(sourceRoot,rel));if(!target.startsWith(sourceRoot+path.sep))throw new Error('Catalog STEP escapes source root.');const st=await lstat(target);if(!st.isFile()||st.size>80*1024*1024)throw new Error('Invalid catalog STEP size.');const bytes=await readFile(target),hash=createHash('sha256').update(bytes).digest('hex');if(hash!==c.geometry.sha256)throw new Error('Catalog source STEP hash mismatch.');
      const name='catalog/models/'+hash+'.step';if(!files.includes(name))await save(name,bytes);c.geometry.step='models/'+hash+'.step';c.geometry.originalPath=rel;delete c.geometry.stl;delete c.geometry.stlSha256;components.push(c);
      // Only the admitted selected source interfaces can request this fixed,
      // bounded evidence file. No model path or teammate database is followed.
      for(const i of c.interfaces||[]){
        if(!['shaft-axis','d-shaft-bore','cylindrical-bore'].includes(i?.type))continue;
        if(i.evidenceArtifact!=='interface-surface-inventory.json'||typeof i.evidenceSha256!=='string'||!/^[0-9a-f]{64}$/.test(i.evidenceSha256)||i.sourceSha256!==hash||i.sourceArtifact!==rel)throw new Error('Catalog interface source/evidence binding is invalid.');
        const evidenceName='catalog/interface-surface-inventory.json';
        if(files.includes(evidenceName)){if(hashes[evidenceName]!==i.evidenceSha256)throw new Error('Catalog interface evidence SHA256 conflict.');continue;}
        const evidencePath=path.join(sourceRoot,i.evidenceArtifact),st=await lstat(evidencePath);
        if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>2*1024*1024)throw new Error('Invalid catalog interface evidence size/type.');
        const evidence=await readFile(evidencePath),digest=createHash('sha256').update(evidence).digest('hex');
        if(digest!==i.evidenceSha256)throw new Error('Catalog interface evidence SHA256 mismatch.');
        await save(evidenceName,evidence);
      }
    }
  }
  for(const id of metadataIds){if(!components.some(c=>c.id===id)){const source=catalog.components.find(c=>c.id===id);if(!source)throw new Error('Missing requested catalog metadata: '+id);components.push({...structuredClone(source),geometry:null,metadataOnly:true});}}
  const snapshot={schemaVersion:1,catalogRevision:catalog.catalogRevision||'empty',parentManifestSha256:catalog.manifestSha256||null,components,materials:catalog.materials||[],kits:catalog.kits||[],runtimeNetworkRequired:false,limitations:['Only selected native geometry is included. Source documents are identified by URL/hash; original supplier archive stays on the DGX. Redistribution licences require separate review before public release.']};
  await save('catalog/manifest.json',Buffer.from(JSON.stringify(snapshot,null,2)));
  return {files,hashes,parentCatalogHash:catalog.manifestSha256||null,snapshotCatalogHash:hashes['catalog/manifest.json']};
}
