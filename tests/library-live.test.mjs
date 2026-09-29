import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {createHash} from 'node:crypto';
import {createModelLibrary,createLibraryContext} from '../server/studio-model-library.mjs';
import {createIntegrationRuntime,dispatchIntegrationRpc} from '../server/studio-integrations.mjs';
import {createStudioService} from '../server/studio-service.mjs';
import {loadStudioSkills,buildDesignMessages} from '../server/studio-skills.mjs';
const root=process.env.M4KE_TEST_LIBRARY_ROOT;
const sha='42a76f3e355652c32148cf9de1a0b78308f4aef3ca3931279cac92bab1d89558',held='a1afa13b63946c5a93be7e3f3dcf579e3afba94651652b112244fcba53453881';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('actual pinned library is reachable through existing MCP and exact source identity',{skip:!root},async()=>{
 const runtime=createIntegrationRuntime({root});const list=await dispatchIntegrationRpc({jsonrpc:'2.0',id:1,method:'tools/list'},runtime);
 for(const name of ['search_model_library','get_model_source','get_static_collider','search_cached_parts'])assert.ok(list.result.tools.some(t=>t.name===name));
 const search=await runtime.call('search_model_library',{query:'tactile',limit:8});assert.equal(search.summary.sourceFiles,1792);assert.ok(search.records.some(r=>r.sourceSha256===sha));
 const source=await runtime.call('get_model_source',{sourceSha256:sha});assert.equal(source.shape.sourceSha256,sha);assert.equal(source.currentSourceBytesVerified,true);assert.equal(source.physicalFit,'UNKNOWN');
 await assert.rejects(()=>runtime.call('get_model_source',{sourceSha256:sha,path:'/tmp/other'}));
 await assert.rejects(()=>createModelLibrary({root}).resolve(held),/held/);
});
test('actual companion and overview colliders bind to source with engine metre units',{skip:!root},async()=>{
 const lib=createModelLibrary({root}),inventory=await lib.inventory();
 for(const status of ['COMPANION12','OVERVIEW11']){
  const r=inventory.records.find(x=>x.staticCollider===status);assert.ok(r);const c=await lib.collider(r.sourceSha256);assert.equal(c.units,'m');assert.equal(c.dynamicAllowed,false);
  for(const kind of status==='COMPANION12'?['vertices','indices']:['overview']){const a=await lib.colliderAsset(r.sourceSha256,kind);assert.equal(hash(a.bytes),a.sha256);}
 }
});
test('runtime loads library skill and gives local model real source shape identities',{skip:!root},async()=>{
 const skills=await loadStudioSkills(),context=await createLibraryContext(root,'tactile switch');
 assert.ok(context.data.records.length>0);const messages=buildDesignMessages({request:'tactile switch',skills,libraryContext:context});
 assert.ok(messages[0].content.includes(skills.library));assert.equal(JSON.parse(messages[1].content).nativeLibrary.data.records[0].shape.type,'library');
});
test('existing studio HTTP serves full inventory, exact STEP bytes, and collider bytes',{skip:!root},async t=>{
 const handle=createStudioService({root,getSettings:()=>({}),body:async req=>{let raw='';for await(const c of req)raw+=c;return JSON.parse(raw);},json:(res,status,v)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(v));}});
 const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res,new URL(req.url,'http://localhost').pathname)){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();return new Promise(r=>server.close(r));});const base='http://127.0.0.1:'+server.address().port;
 const inventory=await (await fetch(base+'/api/studio/library/unified')).json();assert.equal(inventory.summary.records,1793);
 const source=await fetch(base+'/api/studio/library/source/'+sha);assert.equal(source.status,200);assert.equal(hash(Buffer.from(await source.arrayBuffer())),sha);
 const r=inventory.records.find(x=>x.staticCollider==='COMPANION12'),c=await createModelLibrary({root}).collider(r.sourceSha256);
 const vertices=await fetch(base+c.vertices.url);assert.equal(vertices.status,200);assert.equal(hash(Buffer.from(await vertices.arrayBuffer())),c.vertices.sha256);
 const invalid=await fetch(base+'/api/studio/library/source/'+sha+'/vertices');assert.equal(invalid.status,404);
});
