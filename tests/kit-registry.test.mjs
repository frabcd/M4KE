import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {compileKit,getKitOptions} from '../engineering/kit.mjs';
import {compilePortableKit} from '../engineering/portable-kit.mjs';
import {compileDesignKit,getDesignKitOptions,PORTABLE_KIT_ID} from '../engineering/kit-registry.mjs';
import {designHash,validateDesignSpec,verifyDesign} from '../server/studio-contract.mjs';
import {DESIGN_JSON_SCHEMA,OLLAMA_DESIGN_SCHEMA} from '../server/studio-schema.mjs';
const catalog=JSON.parse(readFileSync(new URL('../catalog/manifest.json',import.meta.url),'utf8'));

test('registry leaves existing 20-part kit, option metadata and parameter behavior unchanged',()=>{
  assert.deepEqual(getDesignKitOptions(catalog)[0],getKitOptions(catalog)[0]);
  for(const parameters of [{},{lengthMm:190,widthMm:110,targetSpeedMS:.3,thresholdDbfs:-30}]){
    const direct=compileKit('sound-car-v1',parameters,catalog),wrapped=compileDesignKit('sound-car-v1',parameters,catalog);
    assert.deepEqual(wrapped,{spec:direct});assert.equal(wrapped.spec.parts.length,20);assert.equal(designHash(wrapped.spec),designHash(direct));
  }
  assert.equal(designHash(compileDesignKit('sound-car-v1',{},catalog).spec),'d74830bbf88a57d7a1a705b600cdeef92b474ba717887145de7563f5b3d2f0d5');
});
test('portable route binds the frozen 48-part revision without adding metadata to its spec',()=>{
  const result=compileDesignKit(PORTABLE_KIT_ID,{},catalog),direct=compilePortableKit(compileKit('sound-car-v1',{},catalog),catalog);
  assert.deepEqual(result,{spec:direct.spec,portableRevision:direct.revision});assert.deepEqual(validateDesignSpec(result.spec),result.spec);
  assert.equal(result.spec.parts.length,48);assert.equal(result.spec.parts.filter(part=>part.kind==='printed').length,22);
  assert.equal(designHash(result.spec),'33c02e1f23365e2945a8d03e9580a304f12b0c720a4823d497ff8fd04224d9fa');
  // Import-only directory migration changes module bytes; the frozen design hash above is unchanged.
  assert.equal(createHash('sha256').update(readFileSync(new URL('../engineering/portable-kit.mjs',import.meta.url))).digest('hex'),'bf81a54633762edfdea90b574aab495b757a2a3028d1848a025fc913b2fa3218');
  assert.equal(result.portableRevision.designHash,designHash(result.spec));assert.equal(result.portableRevision.physicalStatus,'UNKNOWN');assert.equal(result.portableRevision.nativeStatus,'NOT_RUN');
  assert.equal(verifyDesign(result.spec).overall,'UNVERIFIED');assert.equal(verifyDesign(result.spec).physical,'UNKNOWN');
});
test('portable geometry is fixed at reviewed 180x100 and never silently normalized',()=>{
  for(const parameters of [{lengthMm:190},{widthMm:110},{lengthMm:'180'},{lengthMm:null},{widthMm:undefined},{lengthMm:NaN}])assert.throws(()=>compileDesignKit(PORTABLE_KIT_ID,parameters,catalog),/silently resized/);
  assert.throws(()=>compileDesignKit(PORTABLE_KIT_ID,{powerVoltage:6},catalog),/Unsupported kit parameter/);
  assert.throws(()=>compileDesignKit(PORTABLE_KIT_ID,[],catalog),/must be an object/);
  assert.equal(compileDesignKit(PORTABLE_KIT_ID,{lengthMm:180,widthMm:100},catalog).spec.parts.length,48);
});
test('portable speed and relative loudness remain explicit choices, not geometry or price changes',()=>{
  const original=compileDesignKit(PORTABLE_KIT_ID,{},catalog),changed=compileDesignKit(PORTABLE_KIT_ID,{targetSpeedMS:.3,thresholdDbfs:-35},catalog);
  assert.deepEqual(changed.spec.parts,original.spec.parts);assert.equal(changed.spec.physicsInputs.targetSpeedMS.value,.3);assert.equal(changed.spec.physicsInputs.targetSpeedMS.basis,'USER');assert.equal(changed.spec.physicsInputs.thresholdDbfs.value,-35);assert.notEqual(designHash(original.spec),designHash(changed.spec));
  const option=getDesignKitOptions(catalog).find(option=>option.id===PORTABLE_KIT_ID);assert.equal(option.parameters.lengthMm.minimum,180);assert.equal(option.parameters.lengthMm.maximum,180);assert.equal(option.parameters.widthMm.minimum,100);assert.equal(option.parameters.widthMm.maximum,100);assert.equal(option.priceStatus,'UNKNOWN');assert.equal(option.physicalValidation,'UNKNOWN');assert.equal(option.manufacturingRelease,false);
});
test('kit dispatch cannot promote missing sources or expand the general Qwen generation grammar',()=>{
  for(const id of ['',undefined,null,'general','unknown-kit','__proto__'])assert.throws(()=>compileDesignKit(id,{},catalog),/Unknown kit ID/);
  const options=getDesignKitOptions({components:[]});assert(options.every(option=>option.availability==='unavailable'&&option.missingComponents.length>0));assert.throws(()=>compileDesignKit(PORTABLE_KIT_ID,{}, {components:[]}),/unavailable/);
  assert.equal(DESIGN_JSON_SCHEMA.properties.parts.maxItems,24);assert.equal(OLLAMA_DESIGN_SCHEMA.properties.parts.maxItems,24);
});
test('registry returns independent options and does not mutate source catalog or caller parameters',()=>{
  const before=JSON.stringify(catalog),parameters={lengthMm:180,widthMm:100,targetSpeedMS:.3},snapshot=structuredClone(parameters);compileDesignKit(PORTABLE_KIT_ID,parameters,catalog);assert.deepEqual(parameters,snapshot);assert.equal(JSON.stringify(catalog),before);
  const options=getDesignKitOptions(catalog);options[1].parameters.lengthMm.default=190;options[1].missingComponents.push('invented');const again=getDesignKitOptions(catalog);assert.equal(again[1].parameters.lengthMm.default,180);assert(!again[1].missingComponents.includes('invented'));
});
