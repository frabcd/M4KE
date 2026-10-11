import test from 'node:test';
import assert from 'node:assert/strict';
import {validateGenerationItem,validateDesignSpec} from '../server/studio-contract.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';
const fixture=()=>{
  const source=electricalFixture();
  source.parts=source.parts.map(p=>({...p,color:'#abcdef',material:'Synthetic fixture'}));
  return {...source,schemaVersion:1,title:'Fixture',description:'Synthetic structural test only',units:'mm',requirements:[{id:'R1',text:'Structural test'}],assumptions:[],unknowns:[],questions:[],assembly:[{id:'inspect',title:'Inspect',partIds:source.parts.map(p=>p.id),requires:[],instructions:['Inspect all parts'],checks:['Measure']} ]};
};

test('standalone item validation is identical to authoritative full validation', () => {
  const raw=fixture(), spec=validateDesignSpec(raw);
  const context={parts:spec.parts,requirements:spec.requirements,knownPartIds:new Set(spec.parts.map(p=>p.id)),knownStepIds:new Set(spec.assembly.map(s=>s.id)),knownComponentIds:new Set(spec.electrical.components.map(c=>c.partId))};
  for(const [kind,items,expected] of [['part',raw.parts,spec.parts],['assembly',raw.assembly,spec.assembly],['electricalComponent',raw.electrical.components,spec.electrical.components],['connection',raw.electrical.connections,spec.electrical.connections]]) {
    assert.deepEqual(items.map(x=>validateGenerationItem(kind,x,context)),expected);
  }
  assert.deepEqual(validateGenerationItem('metadata',{control:raw.electrical.control},context),{control:spec.electrical.control});
  const item={id:'screw',name:'Screw',kind:'fastener',quantity:4,unit:'piece',specification:'M3',source:'fixture',partIds:[spec.parts[0].id]};
  assert.deepEqual(validateGenerationItem('buildItem',item,context),validateDesignSpec({...raw,buildItems:[item]}).buildItems[0]);
});
test('standalone validators reject invalid shape, references and source mutations', () => {
  const part=electricalFixture().parts[0];
  assert.throws(()=>validateGenerationItem('part',{...part,shape:{type:'box',size:[NaN,1,2]}}));
  assert.throws(()=>validateGenerationItem('part',{...part,kind:'purchased',shape:{type:'catalog',catalogId:'test'},holes:[]}));
  assert.throws(()=>validateGenerationItem('buildItem',{id:'screw',name:'Screw',kind:'fastener',quantity:1.5,unit:'piece',specification:'M3',source:'fixture',partIds:['absent']},{knownPartIds:new Set()}));
  assert.throws(()=>validateGenerationItem('assembly',fixture().assembly[0],{knownPartIds:new Set(),knownStepIds:new Set()}));
});
