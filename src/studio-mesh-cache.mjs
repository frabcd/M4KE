// Exact source bytes only. No disk storage, decimation, LOD or substitute geometry.
export function createMeshByteCache({maxBytes=64*1024*1024,fetcher=(...args)=>fetch(...args),cryptoProvider=globalThis.crypto}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new Error('Mesh cache must be bounded to at most 64 MiB.');
  const entries=new Map(),pending=new Map();let size=0;
  const aborted=()=>new DOMException('Mesh loading aborted.','AbortError');
  // Observers cannot invalidate bytes or cancel other consumers of a shared fetch.
  const notify=(observer,progress)=>{try{observer?.({...progress});}catch{/* UI progress is advisory, not part of integrity verification. */}};
  const emit=(entry,progress)=>{entry.progress=progress;for(const consumer of entry.consumers)notify(consumer.progress,progress);};
  async function read(entry,url,hash){
    const response=await fetcher(url,{signal:entry.controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    let bytes;
    if(response.body?.getReader){
      const reader=response.body.getReader(),chunks=[];let received=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;
        if(received>64*1024*1024)throw new Error('STL exceeds the 64 MiB artifact limit.');
        chunks.push(value);emit(entry,{receivedBytes:received,verified:false,cacheHit:false});
      }}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
      const joined=new Uint8Array(received);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}bytes=joined.buffer;
    }else{bytes=await response.arrayBuffer();if(bytes.byteLength>64*1024*1024)throw new Error('STL exceeds the 64 MiB artifact limit.');emit(entry,{receivedBytes:bytes.byteLength,verified:false,cacheHit:false});}
    if(entry.controller.signal.aborted)throw aborted();
    if(hash){
      if(!cryptoProvider?.subtle)throw new Error('SHA-256 verification is unavailable in this browser.');
      const actual=Array.from(new Uint8Array(await cryptoProvider.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(actual!==hash)throw new Error('STL hash mismatch; source bytes rejected. No preview substitution.');
      if(entry.controller.signal.aborted)throw aborted();
      if(bytes.byteLength<=maxBytes){
        if(entries.has(hash)){size-=entries.get(hash).byteLength;entries.delete(hash);}
        while(size+bytes.byteLength>maxBytes&&entries.size){const oldest=entries.keys().next().value;size-=entries.get(oldest).byteLength;entries.delete(oldest);}
        entries.set(hash,bytes);size+=bytes.byteLength;
      }
    }
    emit(entry,{receivedBytes:bytes.byteLength,verified:!!hash,cacheHit:false});return bytes;
  }
  function subscribe(entry,signal,onProgress){
    return new Promise((resolve,reject)=>{
      const consumer={progress:onProgress};let finished=false;
      const finish=()=>{if(finished)return false;finished=true;entry.consumers.delete(consumer);signal?.removeEventListener('abort',cancel);return true;};
      const cancel=()=>{if(!finish())return;reject(aborted());if(!entry.settled&&!entry.consumers.size){if(entry.key&&pending.get(entry.key)===entry)pending.delete(entry.key);entry.controller.abort();}};
      entry.consumers.add(consumer);signal?.addEventListener('abort',cancel,{once:true});if(entry.progress)notify(onProgress,entry.progress);
      if(signal?.aborted){cancel();return;}
      entry.promise.then(bytes=>{if(finish())resolve(bytes.slice(0));},error=>{if(finish())reject(error);});
    });
  }
  async function load(url,expectedHash,signal,onProgress){
    if(signal?.aborted)throw aborted();
    if(expectedHash!==undefined&&expectedHash!==null&&!/^[a-f0-9]{64}$/i.test(expectedHash))throw new Error('Invalid expected STL hash; no substitute geometry.');
    const hash=expectedHash?.toLowerCase();
    if(hash&&entries.has(hash)){const bytes=entries.get(hash);entries.delete(hash);entries.set(hash,bytes);notify(onProgress,{receivedBytes:bytes.byteLength,verified:true,cacheHit:true});return bytes.slice(0);}
    let entry=hash?pending.get(hash):null;
    if(!entry){entry={key:hash,controller:new AbortController(),consumers:new Set(),progress:null,settled:false,promise:null};
      if(hash)pending.set(hash,entry);const current=entry;
      current.promise=read(current,url,hash).finally(()=>{current.settled=true;if(hash&&pending.get(hash)===current)pending.delete(hash);});
      // Consumers can all abort before the shared fetch settles. Keep its failure handled.
      current.promise.catch(()=>{});
    }
    return subscribe(entry,signal,onProgress);
  }
  return {load,clear(){entries.clear();size=0;},stats:()=>({entries:entries.size,bytes:size,maxBytes,inFlight:pending.size})};
}

/** Bounded concurrent work: completed parts are delivered immediately, not after a batch.
 * @param {any[]} items
 * @param {(item:any)=>Promise<any>} load
 * @param {{concurrency?:number,signal?:AbortSignal,onLoad?:(item:any,result:any)=>void|Promise<void>,onError?:(item:any,error:any)=>void}} [options]
 */
export async function loadMeshQueue(items,load,{concurrency=4,signal,onLoad=(_item,_result)=>{},onError=(_item,_error)=>{}}={}){
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>8)throw new Error('Mesh concurrency must be 1–8.');
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(!signal?.aborted){const index=cursor++;if(index>=items.length)return;const item=items[index];
      try{const result=await load(item);if(!signal?.aborted)await onLoad(item,result);}catch(error){if(!signal?.aborted)onError(item,error);}
    }
  }));
}
export const meshByteCache=createMeshByteCache();
