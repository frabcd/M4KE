import {mkdir,readFile,writeFile,rename,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {validateDesignSpec,designHash} from './studio-contract.mjs';
import {validateUserRefinement} from './studio-repair.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function fields(input,creating=false){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Project must be an object.');
  const allowed=['name','request','answers','budget','spec','jobId',...(creating?['revision']:['expectedRevision'])];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw fail('Unsupported project field.');
  const out={};
  if(input.name!==undefined){if(typeof input.name!=='string'||!input.name.trim()||input.name.length>160||/[\u0000-\u001f]/.test(input.name))throw fail('Name must be nonempty text up to 160 characters.');out.name=input.name.trim();}
  if(input.request!==undefined){if(typeof input.request!=='string'||input.request.length>12000)throw fail('Request exceeds 12000 characters.');out.request=input.request;}
  if(input.budget!==undefined){if(typeof input.budget!=='string'||input.budget.length>500)throw fail('Budget must be text with explicit currency, up to 500 characters.');out.budget=input.budget;}
  if(input.answers!==undefined){if(!Array.isArray(input.answers)||input.answers.length>30||input.answers.some(a=>!a||Object.keys(a).some(k=>!['id','answer'].includes(k))||typeof a.id!=='string'||!a.id||a.id.length>80||typeof a.answer!=='string'||a.answer.length>2000)||new Set(input.answers.map(a=>a.id)).size!==input.answers.length)throw fail('Invalid project answers.');out.answers=structuredClone(input.answers);}
  if(input.spec!==undefined)out.spec=input.spec===null?null:validateDesignSpec(input.spec);
  if(input.jobId!==undefined){if(input.jobId!==null&&(typeof input.jobId!=='string'||!UUID.test(input.jobId)))throw fail('Invalid job ID.');out.jobId=input.jobId;}
  return out;
}

/** DGX-authoritative documents; browser storage never serves as verification. */
export function createProjectStore({root,execute,findJob,assistant,prepareCandidate}){
  const folder=path.join(root,'data','studio-projects');
  const active=new Set(),locks=new Map();let workflowAdmission=false;
  const file=id=>{if(!UUID.test(id))throw fail('Invalid project ID.');return path.join(folder,id+'.json');};
  async function locked(id,work){const previous=locks.get(id)||Promise.resolve();let release;const current=new Promise(r=>release=r);locks.set(id,current);await previous;try{return await work();}finally{release();if(locks.get(id)===current)locks.delete(id);}}
  async function read(id){const name=file(id);let bytes;try{const st=await lstat(name);if(st.isSymbolicLink()||!st.isFile()||st.size>4*1024*1024)throw fail('Invalid project file.',409);bytes=await readFile(name,'utf8');}catch(e){if(e.code==='ENOENT')throw fail('Project not found.',404);throw e;}const p=JSON.parse(bytes);if(p.id!==id)throw fail('Project identity mismatch.',409);return p;}
  async function write(p){await mkdir(folder,{recursive:true});p.updatedAt=new Date().toISOString();const target=file(p.id),tmp=target+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(p,null,2));await rename(tmp,target);return structuredClone(p);}
  async function archiveWorkflow(p){if(!p.workflow)return;const dir=path.join(folder,p.id+'-runs');await mkdir(dir,{recursive:true});await writeFile(path.join(dir,p.workflow.id+'.json'),JSON.stringify({projectId:p.id,spec:p.spec,workflow:p.workflow,designHash:p.designHash},null,2));}
  async function attachJob(p,id){if(!id)return;if(!findJob)throw fail('Job association is unavailable.',503);const j=await findJob(id);if(!p.spec||j.designHash!==designHash(p.spec))throw fail('Job does not match the project design.',409);p.jobId=id;}
  async function get(id){return locked(id,async()=>{const p=await read(id);if(p.workflow?.status==='running'&&!active.has(id)){p.workflow.status='error';p.workflow.stage='error';p.workflow.message='Server restarted during this workflow. Saved attempts remain available; explicitly rerun to continue.';p.workflow.finishedAt=new Date().toISOString();p.revision++;await write(p);}return structuredClone(p);});}
  async function create(input){const clean=fields(input,true),now=new Date().toISOString();const p={id:randomUUID(),request:'',answers:[],budget:'',...clean,revision:1,createdAt:now,updatedAt:now};if(p.spec)p.designHash=designHash(p.spec);await attachJob(p,clean.jobId);return write(p);}
  async function update(id,input){const clean=fields(input);if(!Number.isInteger(input.expectedRevision))throw fail('expectedRevision is required.',409);return locked(id,async()=>{const p=await read(id);if(active.has(id)||p.workflow?.status==='running')throw fail('Workflow is running; wait before editing.',409);if(input.expectedRevision!==p.revision)throw fail('Project changed on the DGX. Reload before saving; your draft was not overwritten.',409);const briefChanged=['request','answers','budget'].some(k=>Object.hasOwn(clean,k)&&JSON.stringify(clean[k])!==JSON.stringify(p[k]));const changed=briefChanged||(Object.hasOwn(clean,'spec')&&JSON.stringify(clean.spec)!==JSON.stringify(p.spec));if(Object.hasOwn(clean,'spec'))p.requiresDesignUpdate=false;else if(briefChanged&&p.spec)p.requiresDesignUpdate=true;if(changed){await archiveWorkflow(p);for(const k of briefChanged&&!Object.hasOwn(clean,'spec')?['workflow']:['jobId','metrics','model','designHash','verification','workflow','designSource','pendingQuestions'])delete p[k];}Object.assign(p,clean);if(p.spec)p.designHash=designHash(p.spec);await attachJob(p,clean.jobId);p.revision++;return write(p);});}
  async function list(){await mkdir(folder,{recursive:true});const names=(await readdir(folder)).filter(n=>UUID.test(n.slice(0,-5))&&n.endsWith('.json'));const all=await Promise.all(names.slice(0,1000).map(n=>get(n.slice(0,-5)).catch(()=>null)));return all.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(p=>({id:p.id,name:p.name||'',title:p.name||p.spec?.title||p.request.slice(0,100)||'Untitled toy',revision:p.revision,updatedAt:p.updatedAt,jobId:p.jobId,workflow:p.workflow?{status:p.workflow.status,stage:p.workflow.stage}:undefined}));}
  async function start(id,input={}){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['answers','budget','kitId','parameters','expectedRevision','mode'].includes(k)))throw fail('Unsupported workflow input.');
    if(input.expectedRevision!==undefined&&!Number.isInteger(input.expectedRevision))throw fail('Invalid expectedRevision.');
    const mode=input.mode??'auto';
    if(!['auto','design','verify','deliver'].includes(mode))throw fail('Invalid workflow mode.');
    if(mode==='verify'&&['answers','budget','kitId','parameters'].some(k=>Object.hasOwn(input,k)))throw fail('Verify uses the saved design; save decisions separately before verification.');
    const clean=fields(Object.fromEntries(Object.entries(input).filter(([k])=>['answers','budget'].includes(k))));
    if(input.kitId!==undefined&&(typeof input.kitId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(input.kitId)))throw fail('Invalid kit ID.');
    if(input.parameters!==undefined&&(!input.parameters||typeof input.parameters!=='object'||Array.isArray(input.parameters)||JSON.stringify(input.parameters).length>4000))throw fail('Invalid kit parameters.');
    if(workflowAdmission)throw fail('Another DGX workflow is running. Wait for completion.',429);
    workflowAdmission=true;
    let p;
    try{p=await locked(id,async()=>{const current=await read(id);if(active.has(id))throw fail('Workflow already running.',409);if(input.expectedRevision!==undefined&&current.revision!==input.expectedRevision)throw fail('Project changed before the run started. Reload from DGX.',409);if(mode==='verify'&&current.requiresDesignUpdate)throw fail('The brief changed after this concept. Generate a new draft before verification.',409);if(mode==='verify'&&(!current.spec?.parts.length||current.spec.questions.length))throw fail('Verification requires a saved design without unanswered questions.',409);if(mode==='verify'&&designHash(current.spec)!==current.designHash)throw fail('Saved design identity is inconsistent.',409);await archiveWorkflow(current);Object.assign(current,clean);if(mode!=='verify'&&!current.request.trim()&&!input.kitId)throw fail('Describe the toy first.');const sourceJobId=current.jobId||null;for(const k of mode==='deliver'?[]:mode==='verify'?['jobId','verification']:['jobId','metrics','model','verification','designSource'])delete current[k];current.workflow={id:randomUUID(),mode,...mode==='verify'&&sourceJobId?{sourceJobId}:{},status:'running',stage:mode==='verify'||input.kitId?'calculations':'design',message:mode==='verify'?'Verifying the saved design without initial regeneration.':input.kitId?'Compiling the selected local source kit.':'The configured AI is reviewing the request and essential answers.',attempts:[],startedAt:new Date().toISOString(),repairLimit:1,...input.kitId?{kitId:input.kitId,parameters:input.parameters||{}}:{}};current.revision++;active.add(id);return write(current);});}
    catch(e){active.delete(id);workflowAdmission=false;throw e;}
    const workflowId=p.workflow.id;
    const checkpoint=patch=>locked(id,async()=>{const latest=await read(id);if(latest.workflow?.id!==workflowId)throw fail('Workflow revision changed.',409);const {workflow,...rest}=patch;Object.assign(latest,rest);if(workflow)Object.assign(latest.workflow,workflow);latest.revision++;return write(latest);});
    void (async()=>{try{await execute(structuredClone(p),input,checkpoint);}catch(e){await checkpoint({workflow:{status:'error',stage:'error',message:String(e.message).slice(0,2000),finishedAt:new Date().toISOString()}});}finally{active.delete(id);workflowAdmission=false;}})().catch(e=>console.error('Project workflow persistence failure:',e.message));
    return p;
  }

  async function readSidecar(id, suffix, fallback) {
    file(id);
    const target=path.join(folder,`${id}-${suffix}.json`);
    try {
      const stat=await lstat(target);
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size>4*1024*1024)throw fail('Invalid project sidecar.',409);
      return JSON.parse(await readFile(target,'utf8'));
    } catch(error) { if(error.code==='ENOENT')return fallback;throw error; }
  }
  async function writeSidecar(id,suffix,value) {
    const target=path.join(folder,`${id}-${suffix}.json`),temp=target+'.'+randomUUID()+'.tmp';
    await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,target);return structuredClone(value);
  }
  const viewDefaults=()=>({version:0,selectedPartIds:[],activePartId:null,hiddenPartIds:[],stage:'requirements',viewMode:'model',projection:'perspective',language:'zh'});
  async function getView(id){return locked(id,async()=>{const project=await read(id),view=await readSidecar(id,'view',viewDefaults());const ids=new Set(project.spec?.parts.map(p=>p.id)||[]);view.selectedPartIds=view.selectedPartIds.filter(id=>ids.has(id));view.hiddenPartIds=view.hiddenPartIds.filter(id=>ids.has(id));if(!view.selectedPartIds.includes(view.activePartId))view.activePartId=null;return view;});}
  async function putView(id,input){
    const allowed=['expectedVersion','selectedPartIds','activePartId','hiddenPartIds','stage','viewMode','projection','language'];
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw fail('Unsupported view field.');
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0)throw fail('expectedVersion is required.',409);
    return locked(id,async()=>{
      const project=await read(id),current=await readSidecar(id,'view',viewDefaults());
      if(current.version!==input.expectedVersion)throw fail('View changed. Reload before saving display preferences.',409);
      const partIds=new Set(project.spec?.parts.map(p=>p.id)||[]),next={...current};
      for(const key of ['selectedPartIds','hiddenPartIds'])if(Object.hasOwn(input,key)){
        if(!Array.isArray(input[key])||input[key].length>48||new Set(input[key]).size!==input[key].length||input[key].some(id=>typeof id!=='string'||!partIds.has(id)))throw fail('View contains unknown or duplicate part IDs.');
        next[key]=[...input[key]];
      }
      if(Object.hasOwn(input,'activePartId'))next.activePartId=input.activePartId;
      if(next.activePartId!==null&&!next.selectedPartIds.includes(next.activePartId))throw fail('Active part must be selected.');
      for(const [key,values] of Object.entries({stage:['workspace','requirements','refine','verify','export'],viewMode:['model','wiring'],projection:['perspective','orthographic'],language:['zh','en']}))if(Object.hasOwn(input,key)){
        if(!values.includes(input[key]))throw fail(`Invalid view ${key}.`);next[key]=input[key];
      }
      next.version++;next.updatedAt=new Date().toISOString();return writeSidecar(id,'view',next);
    });
  }
  async function conversationEntries(id){
    const entries=await readSidecar(id,'conversation',[]);
    if(!Array.isArray(entries)||entries.length>80||entries.some(e=>!e||!UUID.test(e.id)||!['user','assistant'].includes(e.role)||!['ask','propose'].includes(e.mode)||typeof e.message!=='string'||e.message.length>12000||!Array.isArray(e.selectedPartIds)))throw fail('Invalid conversation record.',409);
    return entries;
  }
  async function getConversation(id){return locked(id,async()=>{await read(id);return {entries:await conversationEntries(id),retainedTurns:40};});}
  function frozenContext(project,input,allowBrief=false){
    if(project.requiresDesignUpdate&&(!allowBrief||input.selectedPartIds?.length))throw fail('The brief changed after this concept. Generate a new draft before asking or refining it.',409);
    if(allowBrief&&(!project.spec?.parts.length||project.spec.questions.length||project.requiresDesignUpdate)){
      if(input.expectedRevision!==project.revision||(input.designHash??null)!==(project.designHash??null))throw fail('Project changed. Reload before asking about the brief.',409);
      if(!Array.isArray(input.selectedPartIds??[])||(input.selectedPartIds??[]).length)throw fail('Brief questions cannot carry unconfirmed part selections.');
      return {projectId:project.id,revision:project.revision,designHash:project.designHash??null,basis:'brief',selectedPartIds:[],parts:[],connections:[]};
    }
    if(project.requiresDesignUpdate)throw fail('The brief changed after this concept. Generate a new draft before asking or refining it.',409);
    if(!Number.isInteger(input.expectedRevision)||input.expectedRevision!==project.revision||typeof input.designHash!=='string'||input.designHash!==project.designHash)throw fail('Project changed. Reload before asking or applying a design change.',409);
    if(!project.spec?.parts.length||project.spec.questions.length)throw fail('A complete saved concept is required.',409);
    if(designHash(project.spec)!==project.designHash)throw fail('Saved design identity is inconsistent.',409);
    const selected=input.selectedPartIds??[];
    if(!Array.isArray(selected)||selected.length>48||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'||!project.spec.parts.some(p=>p.id===id)))throw fail('Selection contains unknown or duplicate part IDs.');
    const connections=(project.spec.electrical?.connections||[]).filter(c=>selected.includes(c.from.partId)||selected.includes(c.to.partId));
    return structuredClone({projectId:project.id,revision:project.revision,designHash:project.designHash,selectedPartIds:selected,parts:project.spec.parts.filter(p=>selected.includes(p.id)),connections});
  }
  async function assist(id,input,signal){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['mode','message','expectedRevision','designHash','selectedPartIds','proposalId'].includes(k)))throw fail('Unsupported assistant field.');
    if(!['ask','propose'].includes(input.mode)||typeof input.message!=='string'||!input.message.trim()||input.message.length>4000)throw fail('Assistant needs a mode and a message of 1–4000 characters.');
    if(input.proposalId!==undefined&&(input.mode!=='ask'||typeof input.proposalId!=='string'||!UUID.test(input.proposalId)))throw fail('A proposal preview supports read-only questions with a valid proposal ID.');
    if(typeof assistant!=='function')throw fail('Project assistant is unavailable.',503);
    const snapshot=await locked(id,async()=>{
      const project=await read(id);
      if(active.has(id)||project.workflow?.status==='running')throw fail('Wait for the current workflow before using the assistant.',409);
      let context,proposal=null;
      if(input.proposalId){
        frozenContext(project,{...input,selectedPartIds:[]});
        proposal=await readSidecar(id,'proposal-'+input.proposalId,null);
        if(!proposal)throw fail('Proposal not found.',404);
        if(proposal.id!==input.proposalId||proposal.context?.projectId!==id||proposal.baseRevision!==project.revision||proposal.baseDesignHash!==project.designHash)throw fail('Proposal is stale or belongs to another project.',409);
        const spec=validateUserRefinement(project.spec,proposal.spec);
        if(designHash(spec)!==proposal.designHash)throw fail('Proposal identity changed on disk.',409);
        context={...frozenContext({...project,spec,designHash:proposal.designHash},{...input,designHash:proposal.designHash}),basis:'candidate',proposalId:proposal.id,baseDesignHash:project.designHash};
      }else context=frozenContext(project,input,input.mode==='ask');
      return {project:structuredClone(project),context,proposal,history:(await conversationEntries(id)).slice(-8).map(({role,message,revision,designHash})=>({role,message:message.slice(0,1200),revision,designHash}))};
    });
    const result=await assistant({...snapshot,mode:input.mode,message:input.message.trim(),signal});
    if(typeof result?.message!=='string'||!result.message.trim()||result.message.length>12000)throw fail('Assistant returned an invalid explanation.',502);
    async function recorded(reply){
      const conversation=await locked(id,async()=>{
        if(input.proposalId)frozenContext(await read(id),{...input,selectedPartIds:[]});
        const entries=await conversationEntries(id),base={mode:input.mode,revision:snapshot.context.revision,designHash:snapshot.context.designHash,selectedPartIds:snapshot.context.selectedPartIds,at:new Date().toISOString(),...(snapshot.proposal?{basis:'candidate',proposalId:snapshot.proposal.id,baseDesignHash:snapshot.project.designHash}:{})};
        entries.push({...base,id:randomUUID(),role:'user',message:input.message.trim()},{...base,id:randomUUID(),role:'assistant',message:reply.message,...reply.questions?{questions:reply.questions}:{},model:reply.model||null});
        return writeSidecar(id,'conversation',entries.slice(-80));
      });
      return {...reply,conversation};
    }
    if(input.mode==='ask')return recorded({message:result.message,context:snapshot.context,model:result.model,warnings:result.warnings||[]});
    const generated=validateDesignSpec(result.spec);
    if(generated.questions.length){
      if(generated.parts.length)throw fail('Clarification must not contain an applied candidate.',502);
      return recorded({message:result.message,questions:generated.questions,context:snapshot.context,model:result.model,warnings:['Clarification only; no design changes or CAD execution.']});
    }
    let spec=validateUserRefinement(snapshot.project.spec,generated),prepared=null;
    if(prepareCandidate){
      prepared=await prepareCandidate({project:snapshot.project,spec,metrics:result.metrics,model:result.model,message:input.message,signal});
      spec=validateUserRefinement(snapshot.project.spec,prepared.spec);
    }
    const hash=designHash(spec);
    if(hash===snapshot.project.designHash)throw fail('The candidate did not change the design.',422);
    const changes=designChanges(snapshot.project.spec,spec);
    const decisionChanges=['requirements','verificationRequests','buildItems'].filter(key=>JSON.stringify(snapshot.project.spec[key])!==JSON.stringify(spec[key])).map(key=>({field:key,before:snapshot.project.spec[key]||[],after:spec[key]||[]}));
    const proposal={decisionChanges,requestedChange:input.message.trim(),id:randomUUID(),baseRevision:snapshot.project.revision,baseDesignHash:snapshot.project.designHash,spec,designHash:hash,changes,message:result.message,createdAt:new Date().toISOString(),model:prepared?.model||result.model,metrics:prepared?.metrics||result.metrics||null,context:snapshot.context,...prepared?{jobId:prepared.jobId,nativeChecksPassed:true}:{}};
    await locked(id,async()=>{
      const current=await read(id);frozenContext(current,input);
      if(active.has(id))throw fail('Workflow started before the proposal completed.',409);
      await writeSidecar(id,'proposal-'+proposal.id,proposal);
    });
    return recorded({message:result.message,context:snapshot.context,proposal,model:result.model,warnings:result.warnings||[]});
  }
  async function applyProposal(id,proposalId,input){
    if(!UUID.test(proposalId))throw fail('Invalid proposal ID.');
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['expectedRevision','designHash','acceptDecisionChanges'].includes(k)))throw fail('Unsupported proposal application field.');
    return locked(id,async()=>{
      const current=await read(id);frozenContext(current,input);
      if(active.has(id)||current.workflow?.status==='running')throw fail('Wait for the current workflow before applying a proposal.',409);
      const proposal=await readSidecar(id,'proposal-'+proposalId,null);
      if(!proposal)throw fail('Proposal not found.',404);
      if(proposal.id!==proposalId||proposal.baseRevision!==current.revision||proposal.baseDesignHash!==current.designHash||proposal.context?.projectId!==id)throw fail('Proposal is stale or belongs to another project. Generate a new candidate.',409);
      const changedTargets=['requirements','verificationRequests','buildItems'].some(key=>JSON.stringify(current.spec[key])!==JSON.stringify(proposal.spec[key]));
      if(changedTargets&&input.acceptDecisionChanges!==true)throw fail('This candidate changes design targets. Review and explicitly accept the target changes before applying.',409);
      const spec=validateUserRefinement(current.spec,proposal.spec);
      if(designHash(spec)!==proposal.designHash)throw fail('Proposal identity changed on disk.',409);
      let checkedJob=null;
      if(proposal.jobId){
        checkedJob=await findJob(proposal.jobId);
        if(checkedJob?.designHash!==proposal.designHash||checkedJob.status!=='complete'||checkedJob.verification?.revisionHash!==proposal.designHash||!Array.isArray(checkedJob.verification?.claims)||checkedJob.verification.claims.some(c=>c.critical&&c.status==='FAIL'))throw fail('Candidate native checks are no longer valid. Current design was not replaced.',409);
      }
      await archiveWorkflow(current);
      const parent={revision:current.revision,designHash:current.designHash,jobId:current.jobId||null,request:current.request};
      if(changedTargets){
        const revisedRequest=current.request+'\nUser-confirmed refinement (supersedes the earlier target where explicitly changed): '+proposal.requestedChange;
        if(typeof proposal.requestedChange!=='string'||revisedRequest.length>12000)throw fail('Update the brief explicitly before applying this target change.',422);
        current.request=revisedRequest;
      }
      for(const key of ['jobId','verification','workflow','metrics','model','designSource'])delete current[key];
      Object.assign(current,{spec,designHash:proposal.designHash,model:proposal.model,metrics:proposal.metrics,appliedProposal:{id:proposal.id,parent,at:new Date().toISOString()},revision:current.revision+1});
      current.workflow={id:randomUUID(),mode:'design',status:'draft',stage:'refine',attempts:[],message:'Candidate accepted as a new concept. Existing verification belongs to the prior design; verify this revision explicitly.'};
      if(checkedJob){current.jobId=checkedJob.id;current.verification=checkedJob.verification;current.workflow.message='Checked candidate accepted. Native and deterministic checks belong to this revision; physical commissioning remains outstanding.';}
      return write(current);
    });
  }
  return {create,get,update,list,start,getView,putView,getConversation,assist,applyProposal,isRunning:()=>workflowAdmission};
}


/** Machine-derived candidate differences; model prose cannot hide changed parts. */
export function designChanges(before,after){
  const changes=[];
  const old=new Map(before.parts.map(p=>[p.id,p])),next=new Map(after.parts.map(p=>[p.id,p]));
  for(const id of new Set([...old.keys(),...next.keys()])){
    const left=old.get(id),right=next.get(id);
    if(JSON.stringify(left)===JSON.stringify(right))continue;
    const fields=[...new Set([...Object.keys(left||{}),...Object.keys(right||{})])].filter(k=>JSON.stringify(left?.[k])!==JSON.stringify(right?.[k]));
    changes.push({partId:id,type:!left?'added':!right?'removed':'modified',fields,reason:right?.explanation?.placementReason||'Requested candidate change; review the changed fields before acceptance.'});
  }
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(key==='parts'||JSON.stringify(before[key])===JSON.stringify(after[key]))continue;
    if(key==='electrical'){
      const ids=new Set([...(before.electrical?.components||[]),...(after.electrical?.components||[])].map(c=>c.partId));
      for(const id of ids)changes.push({partId:id,type:'electrical',fields:['electrical'],reason:'Electrical design changed; review connected terminals, anchors and wire routing.'});
    }else changes.push({partId:null,type:key==='assembly'?'assembly':'design',fields:[key],reason:'Candidate changed this design section; review before applying.'});
  }
  return changes;
}
