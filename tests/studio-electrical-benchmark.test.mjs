import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildElectricalArtifacts} from '../server/studio-electrical.mjs';
import {electricalFixture} from './studio-electrical-fixture.mjs';

// SYNTHETIC HTTP reporting test, not an actual Qwen/native/physical acceptance.
const script=fileURLToPath(new URL('../scripts/benchmark-general-toys.mjs',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');

test('benchmark adds truthful commissioning/portable boundaries without relabeling its existing software gate',async()=>{
  // The private deployment copy is deliberately absent from source-only releases.
  let deployed=null;try{deployed=await readFile(new URL('../deploy/benchmark-general-toys.mjs',import.meta.url),'utf8');}catch(error){if(error.code!=='ENOENT')throw error;const release=JSON.parse(await readFile(new URL('../SUBMISSION-MANIFEST.json',import.meta.url),'utf8'));assert.ok(release.files['scripts/benchmark-general-toys.mjs'],'Source release must contain the actual benchmark');}
  if(deployed!==null)assert.equal(await readFile(script,'utf8'),deployed,'Deploy harness must match the source harness');
  const root=await mkdtemp(path.join(tmpdir(),'m4ke-synthetic-benchmark-')),spec=electricalFixture(),hash='a'.repeat(64);
  spec.physicsInputs={targetSpeedMS:{value:.5},thresholdDbfs:{value:-25}};spec.verificationRequests=[{id:'synthetic-tool-request'}];
  const {summary,files}=await buildElectricalArtifacts(spec,hash);
  const pass=id=>({id,status:'PASS',critical:true,label:'Synthetic '+id,details:'Synthetic reporting fixture only; no engineering evidence.'});
  const motion={...pass('motion-operating-point'),label:'Conditional full-rail synthetic arithmetic',details:'Not the exported commissioning operating point.'};
  const job={id:'synthetic-job',status:'complete',designHash:hash,spec,electrical:summary,artifactHashes:Object.fromEntries(Object.entries(files).map(([name,body])=>[name,sha(body)])),illustrations:{status:'AVAILABLE'},provenance:{origin:'local-qwen',modelGenerationVerified:true,verificationPlanning:{status:'SELECTED'}},verification:{physical:'UNKNOWN',claims:[...summary.claims,motion,...['kernel-assembly:overlaps','sound-controller','traction-margin','electrical-nominal'].map(pass)]}};
  // The model name is a mocked transport field only; no model is contacted.
  const project={id:'synthetic-project',revision:1,jobId:job.id,designHash:hash,spec,model:'qwen3.8:27b',metrics:{runId:'synthetic-no-inference'},workflow:{status:'complete',stage:'complete'}};
  const requests=[];
  const server=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});res.setHeader('connection','close');
    const prefix='/api/studio/jobs/synthetic-job/files/';
    if(req.url.startsWith(prefix)){const value=files[req.url.slice(prefix.length)];res.writeHead(value===undefined?404:200);res.end(value??'Missing synthetic artifact');return;}
    const value=req.url==='/api/health'?{cloudFallback:false,provider:'ollama'}:req.url==='/api/studio/jobs/synthetic-job'?job:project;
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const out=path.join(root,'report');
    const result=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[script,'car',out],{env:{...process.env,M4KE_BENCH_BASE:`http://127.0.0.1:${server.address().port}`},windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
      const timer=setTimeout(()=>{child.kill();reject(Error('Synthetic benchmark process timed out'));},15000);
      child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
    });
    assert.equal(result.code,0,result.stdout+result.stderr);const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8')),scope=report.carOperatingScope;
    assert.equal(report.softwareAcceptancePassed,true,'Existing artifact/arithmetic software gate remains distinct from operating readiness');assert.ok(Object.values(report.softwareAcceptance).every(Boolean));
    assert.match(scope.softwareAcceptanceScope,/not a configured, untethered or physically working car/);assert.equal(scope.requestedSpeedMS,.5);assert.equal(scope.fullRailCalculation.status,'PASS');assert.equal(scope.fullRailCalculation.scopeExplicit,true);assert.equal(scope.fullRailCalculation.exportedPwmOperatingPointVerified,false);
    assert.deepEqual(scope.commissioning,{motorOutputEnabled:false,profile:'commissioning',pwmDuty:.2,maximumContinuousMs:2000});assert.equal(scope.finalOperatingReadiness,'UNKNOWN');assert.equal(scope.driveSettingsStatus,'UNKNOWN');assert.equal(scope.logicPowerPathStatus,'UNKNOWN');assert.equal(scope.logicPowerScope,'USB_BENCH_ONLY_OR_UNSPECIFIED');assert.equal(scope.modeledOnboardLogicPath,false);assert.equal(scope.untetheredReadiness,'UNKNOWN');assert.equal(scope.physical,'UNKNOWN');assert.ok(Object.values(scope.boundaryObservations).every(Boolean));
    assert.ok(requests.length);assert.ok(requests.every(r=>r.url.startsWith('/api/')));assert.ok(!requests.some(r=>r.url.includes('/api/chat')));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(tmpdir()));assert.match(path.basename(resolved),/^m4ke-synthetic-benchmark-/);await rm(resolved,{recursive:true,force:true});}
});
