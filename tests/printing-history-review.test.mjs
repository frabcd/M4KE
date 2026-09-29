import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPrintingService} from '../server/studio-printing.mjs';

test('listing one job slice history must not rewrite an unrelated interrupted job record',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'m4ke-history-review-'));
 try{
  const jobId=randomUUID(),otherJobId=randomUUID(),sliceId=randomUUID(),folder=path.join(root,'data','slice-jobs');await mkdir(folder,{recursive:true});
  const file=path.join(folder,sliceId+'.json'),before=JSON.stringify({id:sliceId,jobId:otherJobId,designHash:'other',partId:'other-part',profileId:'other-profile',status:'running',createdAt:'2026-09-27T00:00:00Z'});await writeFile(file,before);
  const ownId=randomUUID(),ownFile=path.join(folder,ownId+'.json'),ownBefore=JSON.stringify({id:ownId,jobId,designHash:'requested',partId:'chassis',profileId:'fixture-profile',status:'queued',createdAt:'2026-09-27T00:01:00Z'});await writeFile(ownFile,ownBefore);
  const handler=createPrintingService({root,python:'not-used',findJob:async id=>{assert.equal(id,jobId);return {id:jobId,designHash:'requested'};},runProcess:async()=>{throw new Error('Read-only history must not start a subprocess');},json:(res,status,data)=>{res.status=status;res.data=data;}}),res={};
  await handler({method:'GET'},res,`/api/studio/jobs/${jobId}/slices`);assert.equal(res.status,200);assert.equal(res.data.slices.length,1);assert.equal(res.data.slices[0].id,ownId);assert.equal(res.data.slices[0].status,'error','Interrupted work must not appear active or complete');assert.equal(await readFile(file,'utf8'),before,'Read-only history listing changed an unrelated project record');assert.equal(await readFile(ownFile,'utf8'),ownBefore,'Read-only history listing persisted its derived interrupted status');
 }finally{await rm(root,{recursive:true,force:true});}
});
