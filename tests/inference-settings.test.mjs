import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,cp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('..',import.meta.url));
function request(url,data){
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method:data===undefined?'GET':'POST',agent:false,timeout:15000,headers:{'content-type':'application/json'}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(Buffer.concat(chunks).toString())});}catch(e){reject(e);}});
    });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Test request timed out')));req.end(data===undefined?undefined:JSON.stringify(data));
  });
}

test('isolated native vLLM API preserves provider and blocks changes throughout legacy and studio inference',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-provider-api-'));
  let child,release,entered;
  const upstream=http.createServer(async(req,res)=>{
    res.setHeader('Connection','close');
    if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'test-local'}]}));
    assert.equal(req.url,'/v1/chat/completions');
    let text='';for await(const chunk of req)text+=chunk;
    const input=JSON.parse(text);assert.equal(input.model,'test-local');
    assert.equal(input.response_format.type,'json_schema' in input.response_format?'json_schema':'json_object');
    await new Promise(resolve=>{release=resolve;entered();});
    res.end('data: '+JSON.stringify({model:'test-local',choices:[{delta:{content:JSON.stringify({message:'Transport fixture only.'})},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  try{
    // Copy source directories only. Never write settings in the real checkout.
    for(const name of ['server','shared','engineering','printing','procurement'])await cp(path.join(repo,name),path.join(root,name),{recursive:true,filter:source=>!source.includes('snapshots')&&!source.includes('__pycache__')});
    await cp(path.join(repo,'package.json'),path.join(root,'package.json'));
    // fflate is the only runtime external dependency used by the server.
    await cp(path.join(repo,'node_modules/fflate'),path.join(root,'node_modules/fflate'),{recursive:true});
    await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
    const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
    const endpoint=`http://127.0.0.1:${upstream.address().port}`,settings={endpoint,model:'test-local',provider:'vllm'};
    child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:String(port),OLLAMA_URL:endpoint,QWEN_MODEL:'test-local',M4KE_INFERENCE_PROVIDER:'vllm'},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Isolated server exited: '+errors);}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Startup timeout: '+errors)),10000).unref())]);
    const base=`http://127.0.0.1:${port}`;
    assert.equal((await request(base+'/api/health')).data.provider,'vllm');
    assert.equal((await request(base+'/api/models')).data.models[0].name,'test-local');
    // Reserve the configuration before even reading a slow request body, not
    // only once inference begins. Otherwise an upload/save race can mix protocols.
    const upload=http.request(base+'/api/chat',{method:'POST',agent:false,headers:{'content-type':'application/json'}},res=>res.resume());
    upload.on('error',()=>{});upload.write('{"message":');
    await new Promise(r=>setTimeout(r,100));
    assert.equal((await request(base+'/api/settings',settings)).status,409);
    upload.end('""}');await once(upload,'close');
    for(const mode of ['legacy','studio']){
      const ready=new Promise(r=>entered=r);
      let pending;
      if(mode==='legacy')pending=request(base+'/api/chat',{message:'Read only'});
      else{
        const project=(await request(base+'/api/studio/projects',{request:'Synthetic provider test'})).data;
        pending=request(base+'/api/studio/projects/'+project.id+'/assistant',{mode:'ask',message:'Explain only',expectedRevision:project.revision,designHash:null,selectedPartIds:[]});
      }
      await ready;
      const denied=await request(base+'/api/settings',{...settings,provider:'ollama'});
      assert.equal(denied.status,409);assert.equal((await request(base+'/api/settings')).data.provider,'vllm');
      release();assert.equal((await pending).status,200);
    }
    const saved=await request(base+'/api/settings',settings);assert.equal(saved.status,200);
    assert.deepEqual(JSON.parse(await readFile(path.join(root,'data/settings.json'),'utf8')),settings);
    assert.equal((await request(base+'/api/settings',{...settings,provider:'cloud'})).status,400);
  }finally{
    release?.();if(child&&child.exitCode===null){child.kill();await once(child,'exit');}
    upstream.closeAllConnections();await new Promise(r=>upstream.close(r));
    assert.equal(path.dirname(root),path.resolve(tmpdir()));assert.match(path.basename(root),/^m4ke-provider-api-/);
    await rm(root,{recursive:true,force:true});
  }
});
