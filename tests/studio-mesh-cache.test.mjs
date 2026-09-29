import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createMeshByteCache,loadMeshQueue} from '../src/studio-mesh-cache.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(maxBytes=64*1024*1024){let content='mesh-one',calls=0;return {cache:createMeshByteCache({maxBytes,cryptoProvider:webcrypto,fetcher:async()=>{calls++;return new Response(content);}}),set:value=>content=value,calls:()=>calls};}
test('hash-verified source bytes survive view remounts without a second fetch',async()=>{const f=fixture(),first=await f.cache.load('/one.stl',hash('mesh-one'));new Uint8Array(first)[0]=0;const second=await f.cache.load('/other-job/same.stl',hash('mesh-one'));assert.equal(new TextDecoder().decode(second),'mesh-one');assert.equal(f.calls(),1);assert.equal(f.cache.stats().entries,1);});
test('changed revision hash requires a fresh fetch even for the same URL',async()=>{const f=fixture();await f.cache.load('/part.stl',hash('mesh-one'));f.set('mesh-two');assert.equal(new TextDecoder().decode(await f.cache.load('/part.stl',hash('mesh-two'))),'mesh-two');assert.equal(f.calls(),2);});
test('mismatched bytes fail closed and never populate or poison the cache',async()=>{const f=fixture();await assert.rejects(f.cache.load('/bad.stl',hash('different')),/hash mismatch/);assert.equal(f.cache.stats().entries,0);f.set('different');await f.cache.load('/bad.stl',hash('different'));assert.equal(f.calls(),2);});
test('legacy un-hashed artifacts are always fetched and never cached',async()=>{const f=fixture();await f.cache.load('/legacy.stl');await f.cache.load('/legacy.stl');assert.equal(f.calls(),2);assert.equal(f.cache.stats().bytes,0);});
test('LRU respects its byte bound and does not cache a single oversized value',async()=>{const f=fixture(16);await f.cache.load('/one',hash('mesh-one'));f.set('mesh-two');await f.cache.load('/two',hash('mesh-two'));await f.cache.load('/one',hash('mesh-one'));f.set('third---');await f.cache.load('/third',hash('third---'));assert.equal(f.cache.stats().bytes,16);const before=f.calls();f.set('mesh-two');await f.cache.load('/two',hash('mesh-two'));assert.equal(f.calls(),before+1);f.set('this exceeds the tiny cache');await f.cache.load('/oversized',hash('this exceeds the tiny cache'));assert(f.cache.stats().bytes<=16);assert.throws(()=>createMeshByteCache({maxBytes:64*1024*1024+1}),/64 MiB/);});
test('aborted loads and missing crypto cannot be promoted to verified cached data',async()=>{const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.cache.load('/part',hash('mesh-one'),controller.signal),e=>e.name==='AbortError');assert.equal(f.calls(),0);const cache=createMeshByteCache({cryptoProvider:{},fetcher:async()=>new Response('x')});await assert.rejects(cache.load('/part',hash('x')),/verification is unavailable/);assert.equal(cache.stats().entries,0);});

test('concurrent equal-hash parts share one fetch and receive independent exact byte buffers',async()=>{
  let calls=0,release;const gate=new Promise(r=>{release=r;});const cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async()=>{calls++;await gate;return new Response('same exact geometry');}});
  const a=cache.load('/left.stl',hash('same exact geometry')),b=cache.load('/right.stl',hash('same exact geometry'));assert.equal(calls,1);assert.equal(cache.stats().inFlight,1);release();
  const [one,two]=await Promise.all([a,b]);assert.notEqual(one,two);assert.deepEqual(new Uint8Array(one),new Uint8Array(two));new Uint8Array(one)[0]=0;assert.equal(new TextDecoder().decode(two),'same exact geometry');assert.equal(cache.stats().inFlight,0);
});
test('one subscriber abort never cancels another instance using the same exact geometry',async()=>{
  let release,underlyingSignal;const gate=new Promise(r=>{release=r;}),cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async(_url,{signal})=>{underlyingSignal=signal;await gate;return new Response('shared');}}),first=new AbortController(),second=new AbortController();
  const a=cache.load('/one',hash('shared'),first.signal),b=cache.load('/two',hash('shared'),second.signal);first.abort();await assert.rejects(a,e=>e.name==='AbortError');assert.equal(underlyingSignal.aborted,false);release();assert.equal(new TextDecoder().decode(await b),'shared');assert.equal(cache.stats().entries,1);
});
test('aborting every subscriber cancels the owned request and a later load is fresh',async()=>{
  let calls=0,cancelled=0;const cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async(_url,{signal})=>{calls++;if(calls===1)return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{cancelled++;reject(new DOMException('Aborted','AbortError'));},{once:true}));return new Response('fresh');}}),controller=new AbortController();
  const pending=cache.load('/one',hash('fresh'),controller.signal);controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(cancelled,1);assert.equal(cache.stats().inFlight,0);assert.equal(new TextDecoder().decode(await cache.load('/again',hash('fresh'))),'fresh');assert.equal(calls,2);
});
test('stream progress counts source bytes without claiming hash verification before completion',async()=>{
  const progress=[],cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('mesh'));c.enqueue(new TextEncoder().encode('-bytes'));c.close();}}))});
  const bytes=await cache.load('/stream',hash('mesh-bytes'),undefined,p=>progress.push(p));assert.equal(bytes.byteLength,10);assert.deepEqual(progress.filter(p=>!p.verified).map(p=>p.receivedBytes),[4,10]);assert.equal(progress.at(-1).verified,true);
});
test('shared mismatched bytes reject all consumers without cache insertion',async()=>{
  let calls=0;const cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async()=>{calls++;return new Response('corrupt');}});
  const replies=await Promise.allSettled([cache.load('/a',hash('valid')),cache.load('/b',hash('valid'))]);assert.equal(calls,1);assert(replies.every(r=>r.status==='rejected'&&/hash mismatch/.test(r.reason.message)));assert.equal(cache.stats().entries,0);assert.equal(cache.stats().inFlight,0);
});
test('oversized streamed artifacts fail before concatenation and cannot inflate the bounded cache',async()=>{
  let cancelled=false;const reader={read:async()=>({done:false,value:{byteLength:64*1024*1024+1}}),cancel:async()=>{cancelled=true;},releaseLock(){}};
  const cache=createMeshByteCache({cryptoProvider:webcrypto,fetcher:async()=>({ok:true,body:{getReader:()=>reader}})});await assert.rejects(cache.load('/large',hash('x')),/64 MiB/);assert.equal(cancelled,true);assert.equal(cache.stats().bytes,0);
});
test('bounded mesh queue shows completed parts before slower parts finish and never exceeds concurrency',async()=>{
  let release,active=0,maximum=0;const slow=new Promise(r=>{release=r;}),shown=[];
  const run=loadMeshQueue([0,1,2,3],async item=>{active++;maximum=Math.max(maximum,active);if(item===0)await slow;active--;return item;},{concurrency:2,onLoad:(_item,value)=>{shown.push(value);}});
  await new Promise(r=>setImmediate(r));assert.deepEqual(shown,[1,2,3]);assert.equal(maximum,2);release();await run;assert.deepEqual(shown,[1,2,3,0]);
});
test('aborted mesh queue does not schedule pending items or render stale results',async()=>{
  const controller=new AbortController();let release;const gate=new Promise(r=>{release=r;}),started=[],shown=[];
  const run=loadMeshQueue([0,1,2],async item=>{started.push(item);await gate;return item;},{concurrency:1,signal:controller.signal,onLoad:(_item,value)=>shown.push(value)});controller.abort();release();await run;assert.deepEqual(started,[0]);assert.deepEqual(shown,[]);
});
test('a throwing progress observer cannot fail shared verified bytes or cached reads',async()=>{
  const f=fixture(),bad=()=>{throw new Error('Broken UI observer');};
  const [a,b]=await Promise.all([f.cache.load('/a',hash('mesh-one'),undefined,bad),f.cache.load('/b',hash('mesh-one'))]);
  assert.deepEqual(new Uint8Array(a),new Uint8Array(b));assert.equal(f.calls(),1);
  assert.equal(new TextDecoder().decode(await f.cache.load('/cached',hash('mesh-one'),undefined,bad)),'mesh-one');assert.equal(f.calls(),1);
});
