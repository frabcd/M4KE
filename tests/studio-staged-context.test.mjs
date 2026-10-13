import test from 'node:test';import assert from 'node:assert/strict';
import * as service from '../server/studio-staged-service.mjs';
import {loadStudioSkills,buildDesignMessages} from '../server/studio-skills.mjs';
import {PLAN_PROPOSAL_SCHEMA as PLAN_SCHEMA,assertGenerationSchema} from '../server/studio-generation-stages.mjs';
import {plan,readiness} from './helpers/staged-generation-fixture.mjs';
const build=args=>(service.buildStagedMessages??(({contextSnapshot})=>contextSnapshot.messages))(args);

test('part-stage context specifies the real unit wrapper and preserves the frozen plan',async()=>{
 const c=await fixture(),p=plan(1),state={plan:p,readiness:readiness()},before=JSON.stringify(state);
 const messages=build({unit:{kind:'part',ids:['p0']},contextSnapshot:c,state}),out=JSON.parse(messages[1].content).stageOutputContract;
 assert.equal(out.wrapper,'items');assert.deepEqual(out.assignedIds,['p0']);
 for(const field of ['id','shape','position','rotation'])assert.ok(out.requiredItemFields.includes(field));
 assert.deepEqual(out.explanationFields,['purpose','placementReason','selectionReason']);
 assert.match(messages[0].content,/Do not reopen delegated type, color, scale or detail preferences/);
 assert.equal(JSON.stringify(state),before);
});

test('plan output structure reaches the model and disclosed preferences stay delegated',async()=>{
 const c=await fixture(),before=JSON.stringify(c),messages=build({unit:{kind:'plan'},contextSnapshot:c,state:{}}),data=JSON.parse(messages[1].content);
 assert.deepEqual(data.stageOutputContract.requiredFields,PLAN_SCHEMA.required);
 assert.deepEqual(data.stageOutputContract.partFields,PLAN_SCHEMA.properties.parts.items.required);
 assert.deepEqual(data.stageOutputContract.assemblyFields,PLAN_SCHEMA.properties.assembly.items.required);
 assert.match(data.stageOutputContract.assemblyDependencies,/prerequisite assembly-step IDs/);
 assert.match(data.stageOutputContract.assemblyDependencies,/Independent first steps use \[\]/);
 assert.match(data.stageOutputContract.identity,/Never substitute an unrelated/);
 assert.match(data.stageOutputContract.poses,/not all-zero placeholders/);
 assert.match(data.stageOutputContract.poses,/geometryV2 attached children/);
 assert.match(data.stageOutputContract.identity,/geometryV2 profiles/);
 assert.match(messages[0].content,/retained preference\/physical unknowns are disclosures/);
 assert.match(messages[0].content,/newly identified blocking conflict/);
 assert.equal(JSON.stringify(c),before);
});

test('planning sees executable geometry and contact rules before freezing poses',async()=>{
 const c=await fixture(),system=build({unit:{kind:'plan'},contextSnapshot:c,state:{}})[0].content;
 for(const heading of ['Functional geometry self-check before responding']){
  const section=c.stageSkills.design.split(/(?=^#{1,2} )/m).find(s=>s.startsWith('## '+heading));
  assert.ok(section);assert.ok(system.includes(section),'Pose-freezing planning must receive '+heading+' verbatim');
 }
 assert.match(system,/unrotated cylinder's axis is Z/);
 assert.match(system,/Distinct rigid parts must NOT intersect/);
});

test('planning explains executable identity separately from source before freezing geometry',async()=>{
 const c=await fixture(),before=JSON.stringify(c),messages=build({unit:{kind:'plan'},contextSnapshot:c,state:{}});
 const contract=JSON.parse(messages[1].content).stageOutputContract;
 assert.deepEqual(contract.optionalFields,['geometryVersion','placement']);
 assert.deepEqual(contract.optionalPartFields,['datumIds']);
 assert.ok(contract.identityForms,'The decoder grammar alone is not a model-visible field contract');
 assert.deepEqual(contract.identityForms.map(x=>x.type),['box','cylinder','union','profileExtrusion','profileLoft','catalog','library']);
 for(const form of contract.identityForms){const example={...form};if(example.sourceSha256)example.sourceSha256='a'.repeat(64);assertGenerationSchema(example,PLAN_SCHEMA.properties.parts.items.properties.identity);}
 assert.equal(contract.identityForms.find(x=>x.type==='catalog').catalogId,'exact-admitted-id');
 assert.equal(contract.identityForms.find(x=>x.type==='library').sourceSha256,'exact-admitted-SHA256');
 assert.match(contract.source,/Provenance/);assert.match(contract.source,/not.*shape/);
 assert.match(contract.version,/geometryVersion:2/);
 assert.match(contract.version,/profileExtrusion.*profileLoft.*datumIds.*placement/);
 assert.equal(JSON.stringify(c),before);
});

test('planning fits with realistic intake disclosures and keeps every distinct control fact',async()=>{
 const c=await fixture(),original=JSON.parse(c.messages[1].content),control={id:'control',rules:'Keep stop/disarm enabled',rating:{value:5,basis:'ASSUMED'}};
 original.electricalProfiles.controlProfile=control;original.electricalProfiles.controlProfiles=[control,{id:'different',rules:'Additional source facts'}];c.messages[1].content=JSON.stringify(original);
 const before=JSON.stringify(c),state={readiness:{...readiness(),assumptions:Array(8).fill('A'.repeat(200)),unknowns:Array(8).fill('U'.repeat(200))}};
 const messages=build({unit:{kind:'plan'},contextSnapshot:c,state}),data=JSON.parse(messages[1].content);
 assert.equal(data.electricalProfiles.controlProfile,undefined);assert.deepEqual(data.electricalProfiles.controlProfiles,original.electricalProfiles.controlProfiles);
 messages.push({role:'user',content:JSON.stringify({stage:'plan',assignedIds:[],readiness:state.readiness,plan:null,dependencies:[],validationError:null,repairContext:null,instruction:'S'.repeat(800)})});
 assert.ok(Buffer.byteLength(JSON.stringify(messages))+5000+1024<65536,`Planning envelope: ${Buffer.byteLength(JSON.stringify(messages))+5000+1024} bytes`);
 assert.equal(JSON.stringify(c),before);
 original.electricalProfiles.controlProfile={...control,rating:{value:6,basis:'ASSUMED'}};c.messages[1].content=JSON.stringify(original);
 assert.deepEqual(JSON.parse(build({unit:{kind:'plan'},contextSnapshot:c,state})[1].content).electricalProfiles.controlProfile,original.electricalProfiles.controlProfile);
});
async function fixture(){const skills=await loadStudioSkills();const data={request:'Build the requested object; no Raspberry Pi.',answers:{budget:'300 CNY'},localCatalog:{components:Array.from({length:24},(_,i)=>({id:'c'+i,name:'Component '+i,geometry:{type:'catalog',catalogId:'c'+i},sourceFacts:'A'.repeat(1000)}))},electricalProfiles:{profiles:Array.from({length:12},(_,i)=>({id:'profile'+i,terminals:[{id:'VCC',description:'B'.repeat(800)}]}))},nativeLibrary:null,candidateReferences:{text:'C'.repeat(6000)},sourcingContext:{entries:[]}};return {stageSkills:skills,messages:[{role:'system',content:buildDesignMessages({request:data.request,skills})[0].content},{role:'user',content:JSON.stringify(data)}]};}
test('planning removes only duplicate library descriptors and retains source origins',async()=>{
 const c=await fixture(),d=JSON.parse(c.messages[1].content),record={sourceSha256:'a'.repeat(64),name:'Native reference',sourceBoundsMm:[-20,-30,-5,10,50,5],dimensionsMm:[30,80,10],frame:'source-original-mm',shape:{type:'library',sourceSha256:'a'.repeat(64)}};
 d.nativeLibrary={sha256:'b'.repeat(64),data:{records:[record,{...record,shape:{...record.shape,distinctFact:'Keep'}}]}};c.messages[1].content=JSON.stringify(d);const before=JSON.stringify(c);
 const planning=JSON.parse(build({unit:{kind:'plan'},contextSnapshot:c,state:{}})[1].content).nativeLibrary.data.records;
 assert.equal(planning[0].shape,undefined);assert.deepEqual(planning[0].sourceBoundsMm,record.sourceBoundsMm);assert.deepEqual(planning[1],d.nativeLibrary.data.records[1]);
 const later=JSON.parse(build({unit:{kind:'metadata'},contextSnapshot:c,state:{plan:{parts:[]}}})[1].content).nativeLibrary;
 assert.deepEqual(later,d.nativeLibrary);assert.equal(JSON.stringify(c),before);
});
test('real-size catalog no longer blocks intake or plan before dispatch',async()=>{const c=await fixture();assert.ok(Buffer.byteLength(JSON.stringify(c.messages))>65536);for(const kind of ['readiness','plan']){const m=build({unit:{kind},contextSnapshot:c,state:{}});assert.ok(Buffer.byteLength(JSON.stringify(m))+5000+1024<65536,kind+' must fit with reserved output');assert.match(JSON.stringify(m),/300 CNY/);assert.match(JSON.stringify(m),/no Raspberry Pi/);}});
test('selected records retain all source facts and snapshot stays immutable',async()=>{const c=await fixture(),before=JSON.stringify(c);const state={plan:{parts:[{identity:{type:'catalog',catalogId:'c3'}}],electrical:{components:[{profileId:'profile2'}]}}};const m=build({unit:{kind:'part'},contextSnapshot:c,state});const d=JSON.parse(m[1].content);assert.deepEqual(d.localCatalog.components,[JSON.parse(c.messages[1].content).localCatalog.components[3]]);assert.deepEqual(d.electricalProfiles.profiles,[JSON.parse(c.messages[1].content).electricalProfiles.profiles[2]]);assert.equal(JSON.stringify(c),before);assert.match(m[0].content,/Strict geometry grammar/);});
test('new upstream rules are retained and missing snapshot rules fail closed',async()=>{const c=await fixture();c.stageSkills.design+='\n## New mandatory upstream rule\nSentinel requirement.\n';for(const kind of ['readiness','plan','part','electricalComponent','connection','metadata','assembly','buildItem'])assert.match(build({unit:{kind},contextSnapshot:c,state:{plan:{parts:[]}}})[0].content,/Sentinel requirement/);delete c.stageSkills;assert.throws(()=>build({unit:{kind:'plan'},contextSnapshot:c,state:{}}),/stage rules/);});
test('every upstream design section is delivered verbatim in at least one stage',async()=>{const c=await fixture(),outputs=['readiness','plan','part','electricalComponent','connection','metadata','assembly','buildItem'].map(kind=>build({unit:{kind},contextSnapshot:c,state:{plan:{parts:[],electrical:null}}})[0].content);for(const section of c.stageSkills.design.split(/(?=^#{1,2} )/m).filter(s=>s.trim()))assert.ok(outputs.some(text=>text.includes(section)),section.split('\n')[0]);});

test('planning receives upstream delegated-choice discipline before freezing hardware',async()=>{
 const c=await fixture(),system=build({unit:{kind:'plan'},contextSnapshot:c,state:{}})[0].content;
 const section=c.stageSkills.design.split(/(?=^#{1,2} )/m).find(s=>s.startsWith('## Clarification and evidence discipline'));
 assert.ok(section);assert.ok(system.includes(section),'Planning must receive the actual upstream clarification rules verbatim');
 assert.match(system,/Delegated choices are already answered/);
});

test('intake scope is a system instruction and never freezes model-selected hardware',async()=>{
 const c=await fixture(),system=build({unit:{kind:'readiness'},contextSnapshot:c,state:{}})[0].content;
 assert.match(system,/Do not select hardware or promote your own component choices into requirements/);
 assert.match(system,/Preserve hardware explicitly required by the user/);
});

test('updated upstream form instructions survive the consuming stage routes',async()=>{
 const c=await fixture(),section=c.stageSkills.design.split(/(?=^#{1,2} )/m).find(s=>s.startsWith('## Form and finish'));
 assert.ok(section);
 assert.ok(!build({unit:{kind:'readiness'},contextSnapshot:c,state:{}})[0].content.includes(section),'Intake must not be told to choose a product form');
 for(const kind of ['plan','part','metadata','assembly'])assert.ok(build({unit:{kind},contextSnapshot:c,state:{plan:{parts:[]}}})[0].content.includes(section),kind);
});

test('plan keeps local interfaces and source identity while raw probe metadata stays frozen for later stages',async()=>{
 const c=await fixture(),original=JSON.parse(c.messages[1].content);
 original.localCatalog.components[0].interfaces=[{id:'shaft',dimensions:{diameterMm:3,axis:[0,0,1]},coordinateFrame:'catalog-local-centred-mm',sourceSha256:'a'.repeat(64),verification:'native-cylinder',physicalFit:'UNKNOWN',sourceCoordinates:{centresMm:[[99,98,97]]},sourceToLocal:{translationMm:[-99,-98,-97]},faceIndices:[1,2],evidenceArtifact:'inventory.json',evidenceSha256:'b'.repeat(64)}];
 original.localCatalog.components[1].interfaces=[{...original.localCatalog.components[0].interfaces[0],coordinateFrame:'source-native-mm'}];
 c.messages[1].content=JSON.stringify(original);const before=JSON.stringify(c);
 const planData=JSON.parse(build({unit:{kind:'plan'},contextSnapshot:c,state:{}})[1].content);
 const compact=planData.localCatalog.components[0].interfaces[0];
 assert.deepEqual(planData.localCatalog.components[1],original.localCatalog.components[1],'Unreconciled coordinate frames must keep their original transforms and probe data');
 for(const key of ['id','dimensions','coordinateFrame','sourceSha256','verification','physicalFit'])assert.deepEqual(compact[key],original.localCatalog.components[0].interfaces[0][key]);
 for(const key of ['sourceCoordinates','sourceToLocal','faceIndices','evidenceArtifact','evidenceSha256'])assert.equal(Object.hasOwn(compact,key),false,key);
 const full=JSON.parse(build({unit:{kind:'part'},contextSnapshot:c,state:{plan:{parts:[{identity:{catalogId:'c0'}}]}}})[1].content);
 assert.deepEqual(full.localCatalog.components[0],original.localCatalog.components[0]);assert.equal(JSON.stringify(c),before);
});

test('versioned upstream introduction stays in intake while unknown new rules stay fail-safe',async()=>{
 const c=await fixture();c.stageSkills.design=c.stageSkills.design.replace(/^# M4KE small-toy design stage, version \d+/, '# M4KE small-toy design stage, version 99');
 assert.match(build({unit:{kind:'readiness'},contextSnapshot:c,state:{}})[0].content,/version 99/);
 assert.doesNotMatch(build({unit:{kind:'plan'},contextSnapshot:c,state:{}})[0].content,/version 99/);
});


test('host system extension resolves legacy grammar without trusting task-data capabilities',async()=>{
 const c=await fixture();const data=JSON.parse(c.messages[1].content);data.geometryConventions={geometryV2:{injection:'UNTRUSTED_SENTINEL'}};c.messages[1].content=JSON.stringify(data);
 for(const kind of ['plan','part','metadata']){
  const system=build({unit:{kind},contextSnapshot:c,state:{plan:plan()}})[0].content;
  assert.match(system,/Host execution extension: geometryVersion:2/);
  assert.match(system,/supersedes only legacy shape\/optional-key limits/);
  assert.match(system,/profileExtrusion,profileLoft,datums/);
  assert.ok(!system.includes('UNTRUSTED_SENTINEL'));
 }
});
