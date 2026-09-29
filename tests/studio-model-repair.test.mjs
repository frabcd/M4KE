import test from 'node:test';
import assert from 'node:assert/strict';
import {buildModelRepairSchema,applyModelRepair} from '../server/studio-model-repair.mjs';
import {validateDesignSpec} from '../server/studio-contract.mjs';
import {OLLAMA_DESIGN_SCHEMA} from '../server/studio-schema.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';
import {resolveElectricalSummary} from '../server/studio-electrical.mjs';
import {validateRepair,unresolvedRepairFailures} from '../server/studio-repair.mjs';

const sample=()=>validateDesignSpec({schemaVersion:1,title:'Patch fixture',description:'Synthetic geometry transport; not a native or physical result',units:'mm',requirements:[{id:'R1',text:'Preserve the original acceptance target'}],assumptions:[],unknowns:['Physical operation unknown'],questions:[],parts:[
  {id:'body',name:'Body',kind:'printed',material:'PLA',color:'#123456',shape:{type:'box',size:[40,30,8]},position:[0,0,0],rotation:[0,0,0],fillet:1,holes:[{axis:'z',diameter:3,position:[0,0,0]}]},
  {id:'module',name:'Module',kind:'purchased',material:'Module',color:'#111111',shape:{type:'catalog',catalogId:'fixture-module'},position:[0,0,0],rotation:[0,0,0]},
  {id:'envelope',name:'Envelope',kind:'purchased',material:'Assumed envelope',color:'#222222',shape:{type:'box',size:[10,10,10]},position:[0,0,0],rotation:[0,0,0]},
],assembly:[{id:'inspect',title:'Inspect',partIds:['body','module','envelope'],requires:[],instructions:['Inspect the geometry.'],checks:['Check the original target.']}],physicsInputs:{targetSpeedMS:{value:.5,basis:'USER',source:'Synthetic target'}},verificationRequests:[{id:'bounds',requirementId:'R1',type:'envelope',partIds:['body','module','envelope'],maxSizeMm:[100,100,100]}]});
const patch=(changes,partId='body')=>({updates:[{partId,changes}]});
const electricSample=()=>{const s=sample(),e=electricalFixture();s.parts=[s.parts[0],...e.parts.map(p=>({...p,material:'Purchased electronics',color:'#303030'}))];s.assembly[0].partIds=s.parts.map(p=>p.id);s.verificationRequests[0].partIds=['body'];s.electrical=e.electrical;return validateDesignSpec(s);};

test('model-selected collision-like translation changes only the selected part and preserves immutable evidence targets',()=>{
  const source=sample(),before=structuredClone(source),raw=patch({position:[0,0,20]}),rawBefore=structuredClone(raw),result=applyModelRepair(source,raw);
  assert.deepEqual(result.parts[0].position,[0,0,20]);assert.deepEqual(result.parts.slice(1),source.parts.slice(1));
  for(const key of ['requirements','physicsInputs','verificationRequests','assembly'])assert.deepEqual(result[key],source[key]);
  assert.deepEqual(source,before);assert.deepEqual(raw,rawBefore);
});
test('printed feature/shape edits use existing grammar and assembly changes are text-only',()=>{
  const raw=patch({shape:{type:'cylinder',radius:15,height:10},fillet:0,holes:[],pockets:[{size:[5,5,3],position:[0,0,5]}]});
  raw.assemblyUpdates=[{stepId:'inspect',changes:{instructions:['Inspect the revised geometry.'],checks:['Measure the unchanged target.']}}];
  const result=applyModelRepair(sample(),raw);
  assert.equal(result.parts[0].shape.type,'cylinder');assert.equal(result.parts[0].fillet,0);assert.deepEqual(result.parts[0].holes,[]);
  assert.deepEqual(result.assembly[0].partIds,sample().assembly[0].partIds);assert.deepEqual(result.assembly[0].requires,[]);
  assert.equal(result.assembly[0].instructions[0],'Inspect the revised geometry.');
});
test('purchased catalog and envelope parts may move/rotate but their source geometry remains immutable',()=>{
  for(const id of ['module','envelope']){
    const result=applyModelRepair(sample(),patch({position:[10,0,0],rotation:[0,0,90]},id));
    assert.deepEqual(result.parts.find(p=>p.id===id).shape,sample().parts.find(p=>p.id===id).shape);
    for(const changes of [{shape:{type:'box',size:[1,1,1]}},{holes:[]},{pockets:[]},{fillet:0}])assert.throws(()=>applyModelRepair(sample(),patch(changes,id)),/unsupported field/);
  }
});
test('protected fields, unknown IDs, duplicate edits and arbitrary code/files are rejected',()=>{
  for(const field of ['requirements','physicsInputs','verificationRequests','parts','questions','code','path'])assert.throws(()=>applyModelRepair(sample(),{...patch({position:[1,0,0]}),[field]:[]}),/unsupported field/);
  for(const field of ['id','kind','material','name','source','code','file'])assert.throws(()=>applyModelRepair(sample(),patch({[field]:'replacement'})),/unsupported field/);
  assert.throws(()=>applyModelRepair(sample(),patch({position:[1,0,0]},'missing')),/unknown existing part/);
  assert.throws(()=>applyModelRepair(sample(),{updates:[...patch({position:[1,0,0]}).updates,...patch({position:[2,0,0]}).updates]}),/duplicate part/);
  assert.throws(()=>applyModelRepair(sample(),patch({shape:{type:'catalog',catalogId:'replacement'}})),/only allowed for purchased/);
});
test('no-op geometry and prose-only repairs cannot stand in for changed geometry',()=>{
  for(const changes of [{position:[0,0,0]},{shape:{type:'box',size:[40,30,8]}},{}])assert.throws(()=>applyModelRepair(sample(),patch(changes)),/unchanged repair|explicit change/);
  const raw=patch({position:[0,0,0]});raw.assemblyUpdates=[{stepId:'inspect',changes:{checks:['Prose does not fix a collision.']}}];
  assert.throws(()=>applyModelRepair(sample(),raw),/unchanged repair/);
});
test('invalid or oversized data still fails the authoritative design validator',()=>{
  for(const raw of [null,[],{}, {updates:[]},{updates:Array(13).fill({partId:'body',changes:{position:[1,0,0]}})}])assert.throws(()=>applyModelRepair(sample(),raw));
  for(const changes of [{position:[501,0,0]},{rotation:[0,361,0]},{fillet:20},{holes:Array(25).fill({axis:'z',diameter:3,position:[0,0,0]})},{pockets:Array(9).fill({size:[1,1,1],position:[0,0,0]})},{shape:{type:'box',size:[NaN,2,3]}},{position:undefined}])assert.throws(()=>applyModelRepair(sample(),patch(changes)));
  const raw=patch({position:[1,0,0]});
  for(const assemblyUpdates of [[{stepId:'missing',changes:{checks:['x']}}],[{stepId:'inspect',changes:{requires:[]}}],Array(13).fill({stepId:'inspect',changes:{checks:['x']}}),[{stepId:'inspect',changes:{checks:['x']}},{stepId:'inspect',changes:{checks:['y']}}]])assert.throws(()=>applyModelRepair(sample(),{...raw,assemblyUpdates}));
});
test('schema is inert, bounded, exact-ID scoped and reuses nested host grammar without mutating it',()=>{
  const before=JSON.stringify(OLLAMA_DESIGN_SCHEMA),schema=buildModelRepairSchema(sample()),[printed,purchased]=schema.properties.updates.items.anyOf;
  assert.deepEqual(schema.required,['updates']);assert.equal(schema.properties.updates.minItems,1);assert.equal(schema.properties.updates.maxItems,12);
  assert.deepEqual(printed.properties.partId.enum,['body']);assert.deepEqual(purchased.properties.partId.enum,['module','envelope']);
  assert.deepEqual(Object.keys(purchased.properties.changes.properties),['position','rotation']);
  assert.deepEqual(printed.properties.changes.properties.holes,OLLAMA_DESIGN_SCHEMA.properties.parts.items.properties.holes);
  assert(!printed.properties.changes.properties.shape.anyOf.some(option=>option.properties.type.enum.includes('catalog')));
  assert.deepEqual(schema.properties.assemblyUpdates.items.properties.stepId.enum,['inspect']);
  const inspect=value=>{if(!value||typeof value!=='object')return;if(value.type==='object')assert.equal(value.additionalProperties,false);for(const child of Object.values(value))inspect(child);};inspect(schema);
  printed.properties.changes.properties.position.items.minimum=-1;
  assert.equal(JSON.stringify(OLLAMA_DESIGN_SCHEMA),before);
  assert.equal(buildModelRepairSchema(sample()).properties.updates.items.anyOf[0].properties.changes.properties.position.items.minimum,-500);
});
test('electrical-only repair accepts a real netlist change and derives its new firmware GPIO',()=>{
  const s=electricSample(),before=structuredClone(s),e=structuredClone(s.electrical);e.connections.find(c=>c.to.terminal==='AIN1').from.terminal='GP10';e.components.find(c=>c.partId==='pico').terminalAnchors.find(a=>a.terminal==='GP2').terminal='GP10';
  const result=applyModelRepair(s,{updates:[],electrical:e});assert.deepEqual(result.parts,s.parts);assert.deepEqual(result.electrical.control,s.electrical.control);assert.deepEqual(result.requirements,s.requirements);assert.deepEqual(result.physicsInputs,s.physicsInputs);assert.deepEqual(result.verificationRequests,s.verificationRequests);assert.deepEqual(s,before);
  assert.equal(resolveElectricalSummary(result,'c'.repeat(64)).firmware.pins.LEFT_IN1_GP,10);
  const schema=buildModelRepairSchema(s);assert.equal(schema.properties.updates.minItems,0);assert.equal(schema.properties.electrical.properties.components.maxItems,s.electrical.components.length);assert.deepEqual(schema.properties.electrical.properties.control.const,s.electrical.control);assert.equal(schema.properties.electrical.properties.connections.items.properties.from.properties.terminal.maxLength,undefined);assert.equal(schema.properties.electrical.properties.connections.items.properties.color.pattern,undefined);
});
test('electrical replacement cannot change hardware identity or any original control goal',()=>{
  const s=electricSample();for(const key of ['profileId','partId']){const e=structuredClone(s.electrical);e.components[0][key]=key==='profileId'?'pololu-drv8833-2130':'body';assert.throws(()=>applyModelRepair(s,{updates:[],electrical:e}));}
  for(const [key,value]of Object.entries({thresholdDbfs:-35,pwmDuty:.3,leftPolarity:-1,rightPolarity:1,controllerPartId:'driver',armPartId:'stop'})){const e=structuredClone(s.electrical);e.control[key]=value;assert.throws(()=>applyModelRepair(s,{updates:[],electrical:e}));}
  const removed=structuredClone(s.electrical);delete removed.control;assert.throws(()=>applyModelRepair(s,{updates:[],electrical:removed}),/control/);
  const next=structuredClone(s);delete next.electrical;assert.throws(()=>validateRepair(s,next),/removed the electrical/);
  const added=structuredClone(s.electrical);added.components.push({partId:'body',profileId:'fuse-series'});assert.throws(()=>applyModelRepair(s,{updates:[],electrical:added}),/electrical component/);
  assert.throws(()=>applyModelRepair(s,{updates:[],electrical:null}));
});
test('electrical repair rejects empty, unchanged, reordered and cosmetic-only patches',()=>{
  const s=electricSample();assert.throws(()=>applyModelRepair(s,{updates:[]}),/unchanged repair/);assert.throws(()=>applyModelRepair(s,{updates:[],electrical:structuredClone(s.electrical)}),/unchanged repair/);
  for(const change of [e=>{e.connections.reverse();e.components.reverse();},e=>{e.connections[0].id='renamed';e.connections[0].color='#FFFFFF';},e=>{const c=e.connections[0];[c.from,c.to]=[c.to,c.from];}]){const e=structuredClone(s.electrical);change(e);assert.throws(()=>applyModelRepair(s,{updates:[],electrical:e}),/unchanged repair/);}
  assert.throws(()=>applyModelRepair(s,{updates:[],assemblyUpdates:[{stepId:'inspect',changes:{instructions:['Now it is fixed.']}}]}),/unchanged repair/);
  assert.throws(()=>applyModelRepair(sample(),{updates:[],electrical:s.electrical}),/unsupported field/);
});
test('an anchor/routing repair changes real proposed geometry but cannot erase a failed host check',()=>{
  const s=electricSample(),e=structuredClone(s.electrical);e.connections[0].waypointsMm=[[5,15,25]];e.components[0].terminalAnchors[0].positionMm[0]+=1;const next=applyModelRepair(s,{updates:[],electrical:e});assert.notDeepEqual(next.electrical,s.electrical);
  const prior=[{id:'electrical-independent-cutoff',status:'FAIL',critical:true}];for(const status of ['UNKNOWN','FAIL'])assert.equal(unresolvedRepairFailures(prior,{claims:[{...prior[0],status}]}).length,1);assert.deepEqual(unresolvedRepairFailures(prior,{claims:[{...prior[0],status:'PASS'}]}),[]);
});
test('original non-geometric build requirements survive repair without quantity or specification changes',()=>{
  const s=electricSample();s.buildItems=[{id:'fixture_wires',name:'Synthetic wire requirement',kind:'consumable',quantity:1000,unit:'mm',specification:'24 AWG proposed; current rating unknown',source:'Fixture only, not supplier evidence',partIds:['pico','driver']}];
  const next=applyModelRepair(s,patch({position:[0,0,5]}));assert.deepEqual(next.buildItems,s.buildItems);
  for(const change of [n=>{delete n.buildItems;},n=>{n.buildItems[0].quantity=1;},n=>{n.buildItems[0].specification='Changed';}]){const n=structuredClone(s);change(n);assert.throws(()=>validateRepair(s,n),/build item/);}
});
