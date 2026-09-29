import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createPrintingService} from '../server/studio-printing.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile='h2c-04-pla-standard';

async function fixture(options={}){
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-printing-'));
  const jobId=randomUUID(),dir=path.join(root,'data','studio-jobs',jobId),calls=[];
  await mkdir(path.join(dir,'cad','parts'),{recursive:true});
  const stl=Buffer.from('unit-test printed STL placeholder; real native slice smoke is separate');
  const cad={ok:true,revisionHash:'current-design',parts:[{id:'chassis',kind:'printed',valid:true,solidCount:1,stl:'parts/chassis.stl',sha256:{stl:hash(stl)}}],checks:[{id:'chassis:mesh',status:'PASS'}]};
  const job={id:jobId,status:'complete',designHash:'current-design',spec:{parts:[{id:'chassis',kind:'printed'}]},cad,verification:{revisionHash:'current-design',claims:[{id:'physical',critical:false,status:'UNKNOWN'}]}};
  const files={'design.json':Buffer.from(JSON.stringify(job.spec)),'cad/result.json':Buffer.from(JSON.stringify(cad)),'cad/parts/chassis.stl':stl};
  for(const [name,bytes]of Object.entries(files))await writeFile(path.join(dir,name),bytes);
  const deps={root,python:'test-python-no-execution',findJob:async id=>{if(id!==jobId)throw Object.assign(new Error('not found'),{status:404});return job;},
    checkedRead:async(_,name)=>{const bytes=await readFile(path.join(dir,name));if(hash(bytes)!==hash(files[name]))throw Object.assign(new Error('Stored artifact changed'),{status:409});return bytes;},
    body:async req=>req.payload,json:(res,status,data)=>{res.status=status;res.data=structuredClone(data);},
    runProcess:async(exe,args)=>{
      calls.push({exe,args});
      if(args[1]==='status')return {code:0,stdout:JSON.stringify({available:true,slicingAvailable:options.available!==false,status:'OFFLINE_NATIVE_SLICE_VERIFIED_REVIEW_REQUIRED',version:'BambuStudio-02.08.02.61:',networkDisabled:true,networkIsolation:'seccomp-unix-only-no-new-privileges',profiles:[{id:profile,label:'H2C / PLA',printer:'bambu-h2c',nozzle:'0.4',material:'PLA',profileVerified:true,sliceVerified:true}],defaultPrinter:null}),stderr:''};
      assert.equal(args[1],'slice');
      assert.deepEqual(args.slice(2).filter((_,i)=>i%2===0),['--input','--profile','--output']);
      if(options.gate)await options.gate;
      const output=args[args.indexOf('--output')+1],input=args[args.indexOf('--input')+1];
      await mkdir(output,{recursive:false});
      const bytes=Buffer.from('unit-test 3MF placeholder, not a manufactured artifact');
      const result={schemaVersion:1,status:'SLICED_REVIEW_REQUIRED',profileId:profile,partId:'chassis',inputSha256:hash(await readFile(input)),cadResultSha256:hash(files['cad/result.json']),
        cliExitCode:0,networkDisabled:true,networkIsolation:'seccomp-unix-only-no-new-privileges',printerConnected:false,printSent:false,physicalValidation:'UNKNOWN',reviewRequired:true,
        selection:{machine:'Bambu Lab H2C 0.4 nozzle',process:'0.20mm Standard @BBL H2C',filament:'Generic PLA @BBL H2C 0.4 nozzle',bed:'Textured PEI Plate'},
        files:[{name:'REVIEW-REQUIRED.3mf',sha256:hash(bytes),bytes:bytes.length}],gcode:[{member:'Metadata/plate_1.gcode',sha256:'fixture-only'}]};
      options.mutateResult?.(result);
      await writeFile(path.join(output,'REVIEW-REQUIRED.3mf'),options.tamperOutput?Buffer.from('tampered'):bytes);
      await writeFile(path.join(output,'slice-evidence.json'),JSON.stringify(result));
      return {code:options.exitCode??0,stdout:options.nonJson?'invalid native output':JSON.stringify(result),stderr:''};
    }};
  await mkdir(path.join(root,'printing','dgx','jobs'),{recursive:true});
  let handler=createPrintingService(deps);
  const call=async(method,pathname,payload)=>{const req={method,headers:{'content-type':'application/json'},payload},res={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};const handled=await handler(req,res,pathname);return {...res,handled};};
  const start=(payload={partId:'chassis',profileId:profile})=>call('POST',`/api/studio/jobs/${jobId}/slice`,payload);
  const settled=async id=>{await new Promise(resolve=>setTimeout(resolve,20));for(let i=0;i<100;i++){const r=(await call('GET',`/api/studio/slices/${id}`)).data;if(['complete','error'].includes(r.status)){await new Promise(resolve=>setTimeout(resolve,10));return r;}await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Mock slice did not settle');};
  return {root,dir,job,calls,files,call,start,settled,restart:()=>{handler=createPrintingService(deps);},close:()=>rm(root,{recursive:true,force:true})};
}

test('real-shaped status preserves explicit profile choices and no printer default',async()=>{const f=await fixture();try{const r=await f.call('GET','/api/studio/slicer');assert.equal(r.status,200);assert.equal(r.data.defaultPrinter,null);assert.equal(r.data.profiles[0].printer,'bambu-h2c');assert.equal(r.data.profiles[0].nozzle,'0.4');assert.equal(r.data.printSent,false);assert.equal(r.data.printerConnected,false);}finally{await f.close();}});

test('valid printed part receives hash-bound 3MF and receipt, never printer actions',async()=>{const f=await fixture();try{const started=await f.start();assert.equal(started.status,202);const r=await f.settled(started.data.id);assert.equal(r.status,'complete');assert.equal(r.result.reviewRequired,true);assert.equal(r.result.physicalValidation,'UNKNOWN');assert.deepEqual(r.result.files.map(x=>x.name),['REVIEW-REQUIRED.3mf','slice-evidence.json']);const download=await f.call('GET',r.result.files[0].url);assert.equal(hash(download.bytes),r.result.files[0].sha256);assert.equal(f.calls.filter(x=>x.args[1]==='slice').length,1);assert(!f.calls.some(x=>x.args.some(a=>/upload|send-print|connect-printer/.test(a))));}finally{await f.close();}});

test('missing or arbitrary profile and untrusted request options are rejected',async()=>{const f=await fixture();try{for(const payload of [{partId:'chassis'},{partId:'chassis',profileId:'../../profile.json'},{partId:'chassis',profileId:profile,printerHost:'172.16.1.1'}])await assert.rejects(f.start(payload),e=>[400,409].includes(e.status));assert.equal(f.calls.filter(x=>x.args[1]==='slice').length,0);}finally{await f.close();}});

test('critical FAIL, stale revision, bad mesh, and purchased part never reach adapter',async()=>{
  for(const change of [j=>j.verification.claims.push({critical:true,status:'FAIL'}),j=>j.cad.revisionHash='old',j=>j.verification.revisionHash='old',j=>j.cad.checks[0].status='FAIL',j=>j.spec.parts[0].kind='purchased',j=>j.cad.parts[0].kind='purchased']){
    const f=await fixture();try{change(f.job);await assert.rejects(f.start(),e=>e.status===409);assert.equal(f.calls.filter(x=>x.args[1]==='slice').length,0);}finally{await f.close();}
  }
});

test('changed STL hash is refused before the slice subprocess',async()=>{const f=await fixture();try{await writeFile(path.join(f.dir,'cad','parts','chassis.stl'),'changed');await assert.rejects(f.start(),/changed/);assert.equal(f.calls.filter(x=>x.args[1]==='slice').length,0);}finally{await f.close();}});

test('tampered native output is not promoted complete',async()=>{const f=await fixture({tamperOutput:true});try{const {data}=await f.start();const r=await f.settled(data.id);assert.equal(r.status,'error');assert.match(r.error,/hash mismatch/);await assert.rejects(f.call('GET',`/api/studio/slices/${data.id}/files/REVIEW-REQUIRED.3mf`),e=>e.status===409);}finally{await f.close();}});

test('download rechecks content after previously successful slice',async()=>{const f=await fixture();try{const {data}=await f.start();await f.settled(data.id);await writeFile(path.join(f.root,'printing','dgx','jobs',data.id,'REVIEW-REQUIRED.3mf'),'changed after completion');await assert.rejects(f.call('GET',`/api/studio/slices/${data.id}/files/REVIEW-REQUIRED.3mf`),/changed/);}finally{await f.close();}});

test('adapter malformed output or failed exit cannot become successful artifact',async()=>{for(const options of [{nonJson:true},{exitCode:1}]){const f=await fixture(options);try{const {data}=await f.start();assert.equal((await f.settled(data.id)).status,'error');}finally{await f.close();}}});

test('restart converts orphan running state to error without resuming printer operations',async()=>{const f=await fixture();try{const id=randomUUID(),folder=path.join(f.root,'data','slice-jobs');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,status:'running'}));f.restart();const r=await f.call('GET',`/api/studio/slices/${id}`);assert.equal(r.data.status,'error');assert.match(r.data.error,/restarted/);assert.equal(f.calls.length,0);}finally{await f.close();}});

test('concurrent admission is bounded to one native slice',async()=>{let release;const gate=new Promise(r=>release=r),f=await fixture({gate});try{const first=await f.start();await assert.rejects(f.start(),e=>e.status===429);release();assert.equal((await f.settled(first.data.id)).status,'complete');}finally{release();await f.close();}});

test('immediate concurrent polling cannot turn active persistence into a restart or Windows rename failure',async()=>{
  let release;const gate=new Promise(r=>release=r),f=await fixture({gate});
  try{
    const {data}=await f.start();
    const replies=await Promise.all(Array.from({length:20},()=>f.call('GET',`/api/studio/slices/${data.id}`)));
    assert(replies.every(r=>['queued','running'].includes(r.data.status)));
    assert(replies.every(r=>!r.data.error));
    await assert.rejects(f.start(),e=>e.status===429);
    release();assert.equal((await f.settled(data.id)).status,'complete');
  }finally{release();await f.close();}
});

test('CAD receipt lineage mismatch is refused despite matching STL',async()=>{const f=await fixture({mutateResult:r=>{r.cadResultSha256='0'.repeat(64);}});try{const {data}=await f.start();const r=await f.settled(data.id);assert.equal(r.status,'error');assert.match(r.error,/lineage|receipt|CAD/i);}finally{await f.close();}});

test('adapter cannot claim printer contact, physical verification or waived review',async()=>{for(const mutation of [r=>{r.printerConnected=true;},r=>{r.reviewRequired=false;},r=>{r.physicalValidation='PASS';}]){const f=await fixture({mutateResult:mutation});try{const {data}=await f.start();assert.equal((await f.settled(data.id)).status,'error');}finally{await f.close();}}});

test('slice history survives service restart without running an adapter or selecting a profile',async()=>{
  const f=await fixture();try{
    assert.deepEqual((await f.call('GET',`/api/studio/jobs/${f.job.id}/slices`)).data.slices,[]);
    assert.equal(f.calls.length,0);const started=await f.start();await f.settled(started.data.id);f.restart();
    const before=f.calls.length,history=(await f.call('GET',`/api/studio/jobs/${f.job.id}/slices`)).data;
    assert.equal(history.slices[0].id,started.data.id);assert.equal(history.slices[0].status,'complete');assert.equal(history.total,1);
    assert.equal(history.printSent,false);assert.equal(f.calls.length,before);assert.equal(history.slices[0].result,undefined);
    const receipt=(await f.call('GET',`/api/studio/slices/${started.data.id}`)).data;assert.equal(receipt.result.files.length,2);
  }finally{await f.close();}
});

test('history excludes another job or revision and reports malformed records',async()=>{
  const f=await fixture();try{
    const folder=path.join(f.root,'data','slice-jobs');await mkdir(folder,{recursive:true});
    for(const edit of [{},{jobId:randomUUID()},{designHash:'old-design'}]){const id=randomUUID();await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,jobId:f.job.id,designHash:f.job.designHash,partId:'chassis',profileId:profile,status:'error',createdAt:new Date().toISOString(),...edit}));}
    await writeFile(path.join(folder,randomUUID()+'.json'),'invalid json');
    const h=(await f.call('GET',`/api/studio/jobs/${f.job.id}/slices`)).data;
    assert.equal(h.total,1);assert.equal(h.unreadableRecords,1);assert.equal(f.calls.length,0);
    await assert.rejects(f.call('GET','/api/studio/jobs/not-an-id/slices'),e=>e.status===400);
  }finally{await f.close();}
});

test('history converts orphaned slice into an error, never a successful result or resumed operation',async()=>{
  const f=await fixture();try{
    const folder=path.join(f.root,'data','slice-jobs'),id=randomUUID();await mkdir(folder,{recursive:true});await writeFile(path.join(folder,id+'.json'),JSON.stringify({id,jobId:f.job.id,designHash:f.job.designHash,partId:'chassis',profileId:profile,status:'running',createdAt:new Date().toISOString()}));
    const h=(await f.call('GET',`/api/studio/jobs/${f.job.id}/slices`)).data;assert.equal(h.slices[0].status,'error');assert.equal(f.calls.length,0);
  }finally{await f.close();}
});
