/** Explicitly coordinated isolated-app benchmark. Never configures or loads models. */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {boundedJson} from './benchmark-local-contracts.mjs';
import {validateEndpoint} from '../server/studio-inference-config.mjs';
import {createGenerationCheckpointStore,hashGenerationValue} from '../server/studio-generation-checkpoints.mjs';

export function benchmarkReceipt({project,checkpoint,job,elapsedMs}) {
  const identity=checkpoint?.identity?.identity;
  const admitted=checkpoint?.status==='accepted'&&Boolean(project.designHash)&&Boolean(project.spec?.parts?.length)&&!project.spec.questions?.length;
  const matchingJob=admitted&&Boolean(project.jobId)&&job?.id===project.jobId&&job?.designHash===project.designHash;
  return {schemaVersion:1,scope:'Observed software artifacts only; physical fit/strength and connected preview require separate tests.',
    projectId:project.id,status:project.workflow?.status,inputHash:hashGenerationValue({request:project.request,answers:[...(project.answers||[])].sort((a,b)=>a.id.localeCompare(b.id)),budget:project.budget}),
    protocol:checkpoint?.protocol??null,model:identity?.model??null,sourceHash:identity?.sourceHash??null,schemaHash:identity?.schemaHash??null,skillHash:identity?.skillHash??null,contextHash:identity?.contextHash??null,
    generationId:project.workflow?.generationId??null,mode:project.workflow?.mode??null,elapsedMs,calls:checkpoint?.reservations??[],callsScope:'INITIAL_STAGED_GENERATION_ONLY',reusedUnits:project.workflow?.generation?.reusedUnits??0,
    workflowAttempts:project.workflow?.attempts??[],nativeVerification:matchingJob&&job.verification?.revisionHash===project.designHash?job.verification:null,
    questions:project.pendingQuestions||project.spec?.questions||[],admission:admitted?'ACCEPTED':'NOT_ACCEPTED',designHash:admitted?project.designHash:null,
    nativeCad:matchingJob&&job.status==='complete'&&job.cad?.parts?.length?'ARTIFACTS_REPORTED':'NOT_TESTED',
    preview:'NOT_TESTED',physical:'NOT_TESTED',pricing:admitted&&project.priceSearch?.designHash===project.designHash?'CURRENT_HASH_REPORT':'NOT_TESTED'};
}
export function compareBenchmarks(before,after) {
  if(!before||!after||before.admission!=='ACCEPTED'||after.admission!=='ACCEPTED')throw Error('Only accepted results can be compared.');
  if(!['design','auto'].includes(before.mode)||before.mode!==after.mode)throw Error('Comparison requires identical recorded workflow mode.');
  for(const key of ['inputHash','sourceHash','contextHash'])if(!before[key]||before[key]!==after[key])throw Error('Comparison requires identical '+key);
  if(!before.model?.digest||before.model.digest!==after.model?.digest)throw Error('Comparison requires identical model digest.');
  if(![before.elapsedMs,after.elapsedMs].every(n=>Number.isFinite(n)&&n>0))throw Error('Missing elapsed measurements.');
  return {ratio:after.elapsedMs/before.elapsedMs,meaning:'After/before elapsed time. Above 1 means slower; not a quality or physical acceptance result.'};
}

export async function runBenchmark({endpoint,model,dataRoot,brief,out,timeoutMs,coordinated,expectedCatalogSha256,mode='design',fetchJson=boundedJson}) {
  if(coordinated!==true)throw Error('Explicit coordination with the resource owner is required.');
  if(!endpoint||!model||!dataRoot||!out||!brief||typeof brief.request!=='string'||!brief.request.trim()||!Array.isArray(brief.answers)||typeof brief.budget!=='string'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>2400000)throw Error('Supply explicit endpoint, exact model, isolated app root, brief/answers/budget, new output directory and bounded timeoutMs.');
  if(!['design','auto'].includes(mode))throw Error('Benchmark mode must be design or auto.');
  endpoint=validateEndpoint(endpoint);if(!endpoint)throw Error('A valid local app endpoint is required.');
  const root=path.resolve(dataRoot),output=path.resolve(out);
  const api=(route,body)=>fetchJson(endpoint+route,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  const settings=await api('/api/settings');if(settings.model!==model||settings.provider==='codex-bridge')throw Error('Configured local model differs; benchmark never changes settings.');
  const capabilities=await api('/api/studio/capabilities');if(capabilities.workflow?.stagedGeneration!==true)throw Error('Staged generation is not enabled; no project or inference started.');
  let catalogSnapshot=null;
  if(expectedCatalogSha256!==undefined){
    if(typeof expectedCatalogSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedCatalogSha256))throw Error('Supply a valid expected catalog SHA256.');
    const catalog=await api('/api/studio/catalog');
    if(catalog.manifestSha256!==expectedCatalogSha256||!Array.isArray(catalog.components))throw Error('Isolated catalog does not match the expected source snapshot. No project or inference started.');
    catalogSnapshot={manifestSha256:catalog.manifestSha256,componentCount:catalog.components.length,expectedSha256:expectedCatalogSha256};
  }
  const disk=await readdir(path.join(root,'data/studio-projects')).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  const remote=await api('/api/studio/projects');if(disk.length||!Array.isArray(remote.projects)||remote.projects.length)throw Error('Use an empty isolated app root and endpoint; existing projects are never used.');
  // A fresh evidence directory prevents accidental overwrite of a previous run.
  await mkdir(output,{recursive:false});
  if(catalogSnapshot)await writeFile(path.join(output,'source-preflight.json'),JSON.stringify(catalogSnapshot,null,2));
  let project,receipt,job=null,checkpoint=null;const start=performance.now();
  const persist=async()=>{receipt=benchmarkReceipt({project,checkpoint,job,elapsedMs:performance.now()-start});await writeFile(path.join(output,'receipt.json'),JSON.stringify(receipt,null,2));};
  try {
    project=await api('/api/studio/projects',{name:'Coordinated staged benchmark',request:brief.request,answers:brief.answers,budget:brief.budget});
    // Prove the operator-supplied filesystem root belongs to this endpoint before inference.
    if(!/^[a-f0-9-]{36}$/i.test(project.id))throw Error('Invalid created project identity.');
    const local=JSON.parse(await readFile(path.join(root,'data/studio-projects',project.id+'.json'),'utf8'));
    if(local.id!==project.id||local.request!==brief.request)throw Error('App endpoint does not match isolated data root. No inference started.');
    project=await api(`/api/studio/projects/${project.id}/run`,{mode,expectedRevision:project.revision});
    if(!project.workflow?.generationId)throw Error('Staged generation is not enabled. Stop this isolated run and enable the flag before retrying.');
    while(project.workflow?.status==='running') {
      await persist();
      if(performance.now()-start>=timeoutMs)throw Error('Benchmark observation deadline reached; partial results are not accepted.');
      await new Promise(resolve=>setTimeout(resolve,1000));
      project=await api(`/api/studio/projects/${project.id}`);
    }
    const saved=await createGenerationCheckpointStore({root}).inspect({projectId:project.id,generationId:project.workflow.generationId});
    checkpoint=saved.state;
    if(checkpoint.identity.identity.model.name!==model)throw Error('Checkpoint model does not match requested model.');
    if(project.jobId)job=await api(`/api/studio/jobs/${project.jobId}`);
    await persist();return receipt;
  } catch(error) {
    // Stop only the workflow this collector created, using a fresh revision.
    let stopConfirmed=false;
    if(project?.id) {
      const ownedWorkflowId=project.workflow?.id;
      try {
        const latest=await api(`/api/studio/projects/${project.id}`);project=latest;
        if(ownedWorkflowId&&latest.workflow?.id===ownedWorkflowId&&latest.workflow.status==='running'&&latest.workflow.canCancel)
          project=await api(`/api/studio/projects/${project.id}/cancel`,{expectedRevision:latest.revision,workflowId:ownedWorkflowId});
        stopConfirmed=Boolean(ownedWorkflowId&&project.workflow?.id===ownedWorkflowId&&['draft','questions','error','complete'].includes(project.workflow.status));
      } catch { /* No positive terminal observation: stopping remains unconfirmed. */ }
      await persist();
    }
    await writeFile(path.join(output,'error.json'),JSON.stringify({message:error.message,ownedProjectId:project?.id??null,stopConfirmed},null,2));
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');if(at<1)throw Error('Use --name=value arguments.');return [arg.slice(0,at),arg.slice(at+1)];}));
  if(!args['--brief'])throw Error('Explicit --brief JSON file with request, answers and budget is required.');
  const receipt=await runBenchmark({endpoint:args['--endpoint'],model:args['--model'],dataRoot:args['--data-root'],out:args['--output'],timeoutMs:Number(args['--timeout-ms']),mode:args['--mode']||'design',expectedCatalogSha256:args['--expected-catalog-sha256'],coordinated:process.env.M4KE_BENCH_COORDINATED==='1',brief:JSON.parse(await readFile(args['--brief'],'utf8'))});
  console.log(JSON.stringify(receipt,null,2));
}
