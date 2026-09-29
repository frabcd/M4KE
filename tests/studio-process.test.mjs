import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runProcess} from '../server/studio-process.mjs';

const event={schemaVersion:1,sequence:4,phase:'assembly-intersection',operation:'motor:wheel',status:'RUNNING',elapsedMs:12,verificationEvidence:false};
const say=`process.stderr.write(${JSON.stringify('M4KE_DIAGNOSTIC '+JSON.stringify(event)+'\n')});`;
// The full suite starts many Node processes in parallel on Windows. Startup
// latency is not the timeout/cancellation behavior these fixtures are testing.
const startupBudget=15000;
test('process success retains exact stdout, stderr and a scoped last diagnostic',async()=>{
  const r=await runProcess(process.execPath,['-e',say+"process.stdout.write('result');"],{timeout:startupBudget});
  assert.equal(r.code,0);assert.equal(r.stdout,'result');assert.match(r.stderr,/M4KE_DIAGNOSTIC/);assert.equal(r.lastDiagnostic.operation,'motor:wheel');assert.equal(r.lastDiagnostic.verificationEvidence,false);
});
test('timeout preserves output and running native operation after termination',async()=>{
  const timeout=8000;
  await assert.rejects(runProcess(process.execPath,['-e',say+"process.stdout.write('partial');setInterval(()=>{},1000);"],{timeout}),e=>{
    assert.equal(e.code,'PROCESS_TIMEOUT');assert.equal(e.status,504);assert.equal(e.stdout,'partial');assert.equal(e.lastDiagnostic.status,'RUNNING');assert.equal(e.lastDiagnostic.verificationEvidence,false);assert.match(e.stderr,/motor:wheel/);assert.ok(e.elapsedMs>=timeout-50);return true;
  });
});
test('output cap retains bounded prefix and distinguishes limit from geometry failure',async()=>{
  await assert.rejects(runProcess(process.execPath,['-e',"process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)"],{timeout:startupBudget,maxBytes:512}),e=>{
    assert.equal(e.code,'PROCESS_OUTPUT_LIMIT');assert.equal(Buffer.byteLength(e.stdout)+Buffer.byteLength(e.stderr),512);return true;
  });
});
test('nonzero exit remains caller-interpretable instead of a timeout',async()=>{
  const r=await runProcess(process.execPath,['-e',"process.stderr.write('geometry failed');process.exitCode=2"],{timeout:startupBudget});assert.equal(r.code,2);assert.equal(r.stderr,'geometry failed');
});
test('cancellation retains diagnostics and uses a distinct infrastructure code',async()=>{
  const folder=await mkdtemp(path.join(tmpdir(),'m4ke-process-ready-')),ready=path.join(folder,'ready.txt'),controller=new AbortController();let settled=false;
  const child=`const fs=require('node:fs');process.stderr.write(${JSON.stringify('M4KE_DIAGNOSTIC '+JSON.stringify(event)+'\n')},()=>{process.stdout.write('ready-output',()=>fs.writeFileSync(${JSON.stringify(ready)},'READY'));});setInterval(()=>{},1000);`;
  // Install a rejection handler immediately: an infrastructure error while
  // waiting for readiness must not become an unhandled promise rejection.
  const outcome=runProcess(process.execPath,['-e',child],{signal:controller.signal,timeout:startupBudget}).then(result=>({result}),error=>({error})).finally(()=>{settled=true;});
  try{
    const deadline=Date.now()+startupBudget-1000;let readySeen=false;
    while(Date.now()<deadline&&!settled){try{readySeen=await readFile(ready,'utf8')==='READY';}catch(error){if(error.code!=='ENOENT')throw error;}if(readySeen)break;await new Promise(resolve=>setTimeout(resolve,25));}
    assert.equal(readySeen,true,'Child must flush its diagnostic before cancellation');controller.abort();
    const {error}=await outcome;assert.ok(error);assert.equal(error.code,'PROCESS_ABORTED');assert.equal(error.status,499);assert.equal(error.lastDiagnostic?.operation,'motor:wheel');assert.equal(error.lastDiagnostic?.verificationEvidence,false);assert.equal(error.stdout,'ready-output');assert.match(error.stderr,/M4KE_DIAGNOSTIC/);
  }finally{controller.abort();await outcome;const absolute=path.resolve(folder);assert.equal(path.dirname(absolute),path.resolve(tmpdir()));assert.match(path.basename(absolute),/^m4ke-process-ready-/);await rm(absolute,{recursive:true,force:true});}
});
test('invalid and forged diagnostic statuses are not accepted as verifier evidence',async()=>{
  const r=await runProcess(process.execPath,['-e',`process.stderr.write(${JSON.stringify('M4KE_DIAGNOSTIC '+JSON.stringify({...event,status:'PASS',verificationEvidence:true})+'\n')})`],{timeout:startupBudget});assert.equal(r.lastDiagnostic,null);
});
test('spawn failure is explicit and cannot appear as native geometry failure',async()=>{
  await assert.rejects(runProcess('m4ke-nonexistent-test-program',[],{timeout:startupBudget}),e=>e.code==='ENOENT'&&e.status===503&&e.stdout==='');
});
