import test from 'node:test';
import assert from 'node:assert/strict';
import {generationCatalogIssues} from '../server/studio-catalog.mjs';
const wheel=id=>({id,geometry:{step:`models/${id}.step`,sha256:'a'.repeat(64)},interfaces:[{type:'d-shaft-bore',dimensions:{nominalOuterDiameterMm:60}}]});
const spec=(value,basis='ASSUMED')=>({parts:[{shape:{type:'catalog',catalogId:'wheel'}}],physicsInputs:{wheelRadiusMm:{value,basis,source:'synthetic'}}});
test('source wheel radius cannot be inflated under any evidence label',()=>{for(const basis of ['ASSUMED','USER','MEASURED','MANUFACTURER'])assert.match(generationCatalogIssues(spec(40,basis),{components:[wheel('wheel')]}).join(' '),/source nominal radius 30/);});
test('matching nominal radius leaves original evidence untouched and missing radius unresolved',()=>{const s=spec(30),before=structuredClone(s);assert.deepEqual(generationCatalogIssues(s,{components:[wheel('wheel')]}),[]);assert.deepEqual(s,before);delete s.physicsInputs.wheelRadiusMm;assert.deepEqual(generationCatalogIssues(s,{components:[wheel('wheel')]}),[]);});
test('incompatible source wheels cannot be averaged into scalar physics',()=>{const other=wheel('other');other.interfaces[0].dimensions.nominalOuterDiameterMm=80;const s=spec(35);s.parts.push({shape:{type:'catalog',catalogId:'other'}});assert.match(generationCatalogIssues(s,{components:[wheel('wheel'),other]}).join(' '),/cannot average/);});
