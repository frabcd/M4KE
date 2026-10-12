import test from 'node:test';import assert from 'node:assert/strict';
import * as service from '../server/studio-staged-service.mjs';
import {loadStudioSkills,buildDesignMessages} from '../server/studio-skills.mjs';
const build=args=>(service.buildStagedMessages??(({contextSnapshot})=>contextSnapshot.messages))(args);
async function fixture(){const skills=await loadStudioSkills();const data={request:'Build the requested object; no Raspberry Pi.',answers:{budget:'300 CNY'},localCatalog:{components:Array.from({length:24},(_,i)=>({id:'c'+i,name:'Component '+i,geometry:{type:'catalog',catalogId:'c'+i},sourceFacts:'A'.repeat(1000)}))},electricalProfiles:{profiles:Array.from({length:12},(_,i)=>({id:'profile'+i,terminals:[{id:'VCC',description:'B'.repeat(800)}]}))},nativeLibrary:null,candidateReferences:{text:'C'.repeat(6000)},sourcingContext:{entries:[]}};return {stageSkills:skills,messages:[{role:'system',content:buildDesignMessages({request:data.request,skills})[0].content},{role:'user',content:JSON.stringify(data)}]};}
test('real-size catalog no longer blocks intake or plan before dispatch',async()=>{const c=await fixture();assert.ok(Buffer.byteLength(JSON.stringify(c.messages))>65536);for(const kind of ['readiness','plan']){const m=build({unit:{kind},contextSnapshot:c,state:{}});assert.ok(Buffer.byteLength(JSON.stringify(m))+4000+1024<65536,kind+' must fit with reserved output');assert.match(JSON.stringify(m),/300 CNY/);assert.match(JSON.stringify(m),/no Raspberry Pi/);}});
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
