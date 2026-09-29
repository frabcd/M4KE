import {compileKit,getKitOptions} from './kit.mjs';
import {compilePortableKit} from './portable-kit.mjs';

export const PORTABLE_KIT_ID='sound-car-portable-reg5-candidate-v1';

/** Explicit routes only. The existing rolling-base kit remains byte-for-byte unchanged. */
export function getDesignKitOptions(catalog){
  const existing=getKitOptions(catalog),base=existing.find(option=>option.id==='sound-car-v1');
  const parameters=structuredClone(base.parameters);
  parameters.lengthMm={...parameters.lengthMm,minimum:180,maximum:180,default:180};
  parameters.widthMm={...parameters.widthMm,minimum:100,maximum:100,default:100};
  return [...existing,{
    id:PORTABLE_KIT_ID,
    name:'Portable sound car · regulated-5V candidate',
    description:'Separate 180 × 100 mm source-kit revision with proposed battery retention, controls and protected wiring. New purchased parts are source-derived envelopes, not manufacturer STEP. Prices, physical fit and powered operation remain UNKNOWN; not released for fabrication or power. Failed checks stop this route without automatic 48-part Qwen repair.',
    availability:base.availability,
    missingComponents:[...base.missingComponents],
    parameters,
    priceStatus:'UNKNOWN',
    repairLimit:0,
    physicalValidation:'UNKNOWN',
    manufacturingRelease:false,
  }];
}

/** A general Qwen design is never expanded through this deterministic kit registry. */
export function compileDesignKit(id,parameters={},catalog){
  if(id==='sound-car-v1')return {spec:compileKit(id,parameters,catalog)};
  if(id!==PORTABLE_KIT_ID)throw new Error('Unknown kit ID. Generic designs are not automatically converted to cars.');
  if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))throw new Error('Kit parameters must be an object.');
  for(const [key,required]of [['lengthMm',180],['widthMm',100]]){
    if(Object.hasOwn(parameters,key)&&parameters[key]!==required)throw new Error(`Portable candidate requires ${key}=${required}; reviewed geometry cannot be silently resized.`);
  }
  const base=compileKit('sound-car-v1',parameters,catalog);
  const {spec,revision}=compilePortableKit(base,catalog);
  return {spec,portableRevision:revision};
}
