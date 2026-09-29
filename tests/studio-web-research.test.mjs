import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWebResearch,researchUrl,researchQuery,modelResearch} from '../server/studio-web-research.mjs';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-research-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('search accepts component queries but never arbitrary fetch URLs, credentials or lookalike source hosts',()=>{
  for(const q of ['http://127.0.0.1/secret','hello\nworld','user@example.com',''])assert.throws(()=>researchQuery(q));
  for(const url of ['file:///tmp/x','http://espressif.com','https://espressif.com.evil.test/','https://127.0.0.1','https://espressif.com:123'])assert.equal(researchUrl(url),null);
  const credentials=new URL('https://espressif.com');credentials.username='fixture';credentials.password='fixture';assert.equal(researchUrl(credentials.href),null);
  assert.equal(researchQuery(' ESP32  DevKitC '),'ESP32 DevKitC');assert(researchUrl('https://docs.espressif.com/hardware'));
  assert.throws(()=>createWebResearch({endpoint:'https://example.com'}),/loopback/);
});
test('offline cache miss never uses a network or invents a result',async t=>{
  const research=createWebResearch({root:await fixture(t),enabled:false,fetcher:()=>{throw Error('Network forbidden');}});
  const r=await research.search({query:'ESP32'});assert.equal(r.status,'OFFLINE_CACHE_MISS');assert.deepEqual(r.results,[]);assert.equal(r.networkUsed,false);
});
test('online search filters links, caches integrity-bound leads and keeps stale results explicit',async t=>{
  const root=await fixture(t);let calls=0,now=Date.now();
  const research=createWebResearch({root,enabled:true,engines:'360search,bing',now:()=>now,fetcher:async url=>{calls++;assert.equal(new URL(url).hostname,'127.0.0.1');assert.equal(url.searchParams.get('engines'),'360search,bing');assert.equal(url.searchParams.has('categories'),false);return new Response(JSON.stringify({results:[{url:'https://www.espressif.com/en',title:'ESP32',content:'<b>Datasheet</b>'},{url:'https://127.0.0.1/secret',title:'bad'}]}));}});
  const r=await research.search({query:'ESP32'});assert.equal(r.results.length,1);assert.equal(r.geometryAdmitted,false);assert.equal(r.priceVerified,false);assert.equal(r.projectUploaded,false);
  assert.equal((await research.search({query:'ESP32'})).cacheHit,true);assert.equal(calls,1);
  now+=90000000;
  const offline=createWebResearch({root,enabled:false,now:()=>now});assert.equal((await offline.search({query:'ESP32'})).stale,true);
  const files=await readdir(path.join(root,'data/web-research'));await writeFile(path.join(root,'data/web-research',files[0]),'{"payload":{},"sha256":"forged"}');
  assert.equal((await offline.search({query:'ESP32'})).status,'OFFLINE_CACHE_MISS');
});
test('model chooses only exact catalog IDs; external searches receive component identity, not project description',async()=>{
  const sent=[],request='Private project geometry must stay on DGX';
  const research={status:()=>({enabled:true}),search:async data=>{sent.push(data);return {networkUsed:true,results:[]};}};
  const common={research,catalog:{components:[{id:'esp',name:'ESP32 DevKitC',manufacturer:'Espressif',mpn:'ESP32'}]},request,settings:{endpoint:'http://127.0.0.1:11434',model:'fixture'}};
  const result=await modelResearch({...common,infer:async()=>({message:{content:JSON.stringify({lookups:[{componentId:'esp',kind:'cad'}]})}})});
  assert.equal(result.status,'MODEL_SELECTED_SEARCHES');assert.equal(sent[0].query,'Espressif ESP32');assert(!JSON.stringify(sent).includes(request));
  assert.equal((await modelResearch({...common,infer:async()=>({message:{content:JSON.stringify({lookups:[{componentId:'arbitrary-exfiltration',kind:'cad'}]})}})})).status,'SEARCH_UNAVAILABLE');
});
