import {readFile,writeFile,mkdir,rename,lstat,opendir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=b=>createHash('sha256').update(b).digest('hex');
const ARTIFACTS=new Set(['REVIEW-REQUIRED.3mf','slice-evidence.json']);

/** Slice reviewed printed geometry on DGX; deliberately has no printer/send API. */
export function createPrintingService({root,python,runProcess,findJob,checkedRead,body,json}){
  const base=path.join(root,'printing','dgx'),records=path.join(root,'data','slice-jobs');
  const active=new Set(),live=new Map();let busy=false,cache=null;
  async function capability(){
    if(cache&&Date.now()-cache.at<15000)return cache.data;
    let data;
    try{const run=await runProcess(python,[path.join(base,'adapter.py'),'status'],{cwd:root,timeout:30000});const p=JSON.parse(run.stdout);if(run.code!==0)throw new Error(p.error||'Slicer status failed.');data={available:p.available===true,slicingAvailable:p.slicingAvailable===true,status:p.status,version:p.version||p.versionHeader,reason:p.error,networkDisabled:p.networkDisabled===true,networkIsolation:p.networkIsolation,profiles:(p.profiles||[]).filter(x=>x.profileVerified).map(x=>({id:x.id,label:x.label,printer:x.printer,nozzle:x.nozzle,material:x.material,sliceVerified:x.sliceVerified===true})),defaultPrinter:null,printerConnected:false,printSent:false,evidenceSnapshot:true};}
    catch(e){data={available:false,slicingAvailable:false,status:'UNAVAILABLE',reason:e.message,profiles:[],defaultPrinter:null,printerConnected:false,printSent:false};}
    cache={at:Date.now(),data};return data;
  }
  async function save(record){await mkdir(records,{recursive:true});const target=path.join(records,record.id+'.json'),tmp=target+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(record,null,2));for(let attempt=0;;attempt++){try{await rename(tmp,target);break;}catch(e){if(!['EPERM','EBUSY'].includes(e.code)||attempt>=5)throw e;await new Promise(r=>setTimeout(r,20*(attempt+1)));}}live.set(record.id,structuredClone(record));}
  async function load(id,persistOrphan=true){if(!UUID.test(id))throw fail('Invalid slice ID.');if(live.has(id))return structuredClone(live.get(id));let r;try{const file=path.join(records,id+'.json'),s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2097152)throw fail('Invalid slice record.',409);r=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('Slice not found.',404);throw e;}if(r.id!==id)throw fail('Slice identity mismatch.',409);if(['running','queued'].includes(r.status)&&!active.has(id)){r.status='error';r.error='Server restarted during slicing; unfinished output is not a completed artifact.';if(persistOrphan)await save(r);}return r;}
  async function artifact(id,name){if(!UUID.test(id)||!ARTIFACTS.has(name))throw fail('Invalid slice artifact.');const folder=path.join(base,'jobs',id),parent=await lstat(folder),file=path.join(folder,name);if(!parent.isDirectory()||parent.isSymbolicLink())throw fail('Invalid slice directory.',409);const state=await lstat(file);if(!state.isFile()||state.isSymbolicLink()||state.size>128*1024*1024)throw fail('Invalid slice artifact file.',409);return readFile(file);}
  function expose(record){const r=structuredClone(record);if(r.result?.files)r.result.files=r.result.files.map(f=>({...f,url:`/api/studio/slices/${r.id}/files/${f.name}`}));return r;}
  async function history(jobId){
    if(!UUID.test(jobId))throw fail('Invalid job ID.');
    const job=await findJob(jobId),items=[];let scanned=0,unreadable=0;
    try{
      const stat=await lstat(records);if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('Invalid slice history directory.',409);
      for await(const entry of await opendir(records)){
        if(++scanned>5000)throw fail('Slice history exceeds the bounded scan limit. Existing slices remain available by ID.',409);
        const id=entry.name.endsWith('.json')?entry.name.slice(0,-5):'';if(!UUID.test(id))continue;
        let r;try{r=await load(id,false);}catch{unreadable++;continue;}
        if(r.jobId!==jobId||r.designHash!==job.designHash)continue;
        if(!['queued','running','complete','error'].includes(r.status)||typeof r.partId!=='string'||typeof r.profileId!=='string'||!Number.isFinite(Date.parse(r.createdAt))){unreadable++;continue;}
        items.push({id:r.id,jobId:r.jobId,designHash:r.designHash,partId:r.partId,profileId:r.profileId,status:r.status,createdAt:r.createdAt,completedAt:r.completedAt||null,printerConnected:false,printSent:false});
      }
    }catch(e){if(e.code!=='ENOENT')throw e;}
    items.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
    return {jobId,designHash:job.designHash,slices:items.slice(0,50),total:items.length,truncated:items.length>50,unreadableRecords:unreadable,printerConnected:false,printSent:false};
  }
  async function execute(record,part){
    try{
      record.status='running';record.progress='Slicing the selected printed part on DGX with external networking disabled.';await save(record);
      const output=path.join(base,'jobs',record.id),input=path.join(root,'data','studio-jobs',record.jobId,'cad',part.stl);
      const run=await runProcess(python,[path.join(base,'adapter.py'),'slice','--input',input,'--profile',record.profileId,'--output',output],{cwd:root,timeout:360000,maxBytes:2097152});
      let result;try{result=JSON.parse(run.stdout);}catch{throw fail('Slicer returned invalid structured output. No completion claimed.',502);}
      if(run.code!==0||result.status!=='SLICED_REVIEW_REQUIRED')throw fail(result.error||'Native slicing failed. Existing CAD remains unchanged.',422);
      if(result.partId!==record.partId||result.inputSha256!==record.inputSha256||result.profileId!==record.profileId||result.cadResultSha256!==record.cadResultSha256||result.networkDisabled!==true||result.printSent!==false||result.printerConnected!==false||result.reviewRequired!==true||result.physicalValidation!=='UNKNOWN')throw fail('Slice lineage or isolation mismatch.',409);
      if(!Array.isArray(result.files)||result.files.length!==1||result.files[0].name!=='REVIEW-REQUIRED.3mf')throw fail('Unexpected slice output inventory.',409);
      for(const f of result.files){const bytes=await artifact(record.id,f.name);if(bytes.length!==f.bytes||hash(bytes)!==f.sha256)throw fail('Slice output hash mismatch.',409);}
      const receipt=await artifact(record.id,'slice-evidence.json');if(JSON.stringify(JSON.parse(receipt))!==JSON.stringify(result))throw fail('Slice receipt differs from the returned result.',409);
      result.files.push({name:'slice-evidence.json',sha256:hash(receipt),bytes:receipt.length});
      record.result=result;record.status='complete';record.progress='Slice complete; inspect the 3MF preview before any printing. No printer was contacted.';record.completedAt=new Date().toISOString();await save(record);
    }catch(e){record.status='error';record.error=e.message;record.progress='Slice failed or remains unverified; no successful manufacturing claim.';await save(record);}
    finally{active.delete(record.id);busy=false;}
  }
  return async function handle(req,res,pathname){
    if(pathname==='/api/studio/slicer'&&req.method==='GET'){json(res,200,await capability());return true;}
    const list=pathname.match(/^\/api\/studio\/jobs\/([^/]+)\/slices$/);
    if(list&&req.method==='GET'){json(res,200,await history(list[1]));return true;}
    const start=pathname.match(/^\/api\/studio\/jobs\/([^/]+)\/slice$/);
    if(start&&req.method==='POST'){
      if(!req.headers['content-type']?.startsWith('application/json'))throw fail('Use application/json.',415);
      const data=await body(req,4096);if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['partId','profileId'].includes(k))||typeof data.partId!=='string'||typeof data.profileId!=='string')throw fail('Select one printed part and an exact profile.');
      if(busy)throw fail('A DGX slice is already running.',429);busy=true;let record,scheduled=false;
      try{
        const cap=await capability();if(!cap.available||!cap.slicingAvailable||!cap.networkDisabled)throw fail(cap.reason||'DGX slicing is unavailable.',503);
        if(!cap.profiles.some(p=>p.id===data.profileId&&p.sliceVerified))throw fail('Choose an explicitly verified slicer profile; there is no default.',409);
        const job=await findJob(start[1]);if(job.status!=='complete'||job.verification?.claims?.some(c=>c.critical&&c.status==='FAIL'))throw fail('Resolve critical CAD/verification failures before slicing.',409);
        if(job.cad?.revisionHash!==job.designHash||job.verification?.revisionHash!==job.designHash)throw fail('CAD/verification does not match the job revision.',409);
        await checkedRead(job,'design.json');const cadResultSha256=hash(await checkedRead(job,'cad/result.json'));
        const specPart=job.spec.parts.find(p=>p.id===data.partId),part=job.cad.parts.find(p=>p.id===data.partId);
        const mesh=job.cad.checks?.find(c=>c.id===data.partId+':mesh');
        if(specPart?.kind!=='printed'||part?.kind!=='printed'||!part.valid||part.solidCount!==1||mesh?.status!=='PASS')throw fail('Only a valid, closed, current-revision printed part can be sliced. Purchased parts are excluded.',409);
        const bytes=await checkedRead(job,'cad/'+part.stl);if(hash(bytes)!==part.sha256.stl)throw fail('Printed STL changed after verification.',409);
        record={id:randomUUID(),jobId:job.id,designHash:job.designHash,partId:part.id,profileId:data.profileId,inputSha256:part.sha256.stl,cadResultSha256,status:'queued',createdAt:new Date().toISOString(),printerConnected:false,printSent:false};
        active.add(record.id);await save(record);scheduled=true;void execute(record,part).catch(e=>{record.status='error';record.error='Slice persistence failed: '+e.message;live.set(record.id,structuredClone(record));});json(res,202,expose(record));return true;
      }catch(e){if(!scheduled){if(record)active.delete(record.id);busy=false;}throw e;}
    }
    const match=pathname.match(/^\/api\/studio\/slices\/([^/]+)(?:\/files\/([^/]+))?$/);
    if(match&&req.method==='GET'){
      const record=await load(match[1]);if(!match[2]){json(res,200,expose(record));return true;}
      if(record.status!=='complete')throw fail('No verified slice artifact is available.',409);
      const expected=record.result.files.find(f=>f.name===match[2]);if(!expected)throw fail('Slice artifact not found.',404);const bytes=await artifact(record.id,expected.name);if(hash(bytes)!==expected.sha256)throw fail('Slice artifact changed; download withheld.',409);
      res.writeHead(200,{'Content-Type':expected.name.endsWith('.3mf')?'model/3mf':'application/json','Content-Disposition':`attachment; filename="${expected.name}"`,'Cache-Control':'no-store'});res.end(bytes);return true;
    }
    return false;
  };
}
