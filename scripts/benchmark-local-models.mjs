/** Reproducible, serial local-model screening. Never changes app settings or designs. */
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const at=arg.indexOf('=');return [arg.slice(0,at),arg.slice(at+1)];}));
const root=path.resolve(args['--root']||process.cwd());
const out=path.resolve(args['--output']||path.join(root,'test-results',`model-screen-${Date.now()}`));
const models=(args['--models']||'qwen3.8:27b,qwen3.6:latest,qwen3.5:122b-a10b').split(',');
const endpoint='http://127.0.0.1:11434';
if(process.env.M4KE_BENCH_COORDINATED!=='1')throw Error('Coordinate the shared GPU, then set M4KE_BENCH_COORDINATED=1.');
if(models.some(m=>/cloud/i.test(m)||!m))throw Error('Only exact installed local tags are permitted.');
const {OLLAMA_DESIGN_SCHEMA}=await import(pathToFileURL(path.join(root,'server/studio-schema.mjs')));
const {validateDesignSpec}=await import(pathToFileURL(path.join(root,'server/studio-contract.mjs')));
const designSkill=await readFile(path.join(root,'skills/prompt-to-cad/runtime-design.md'),'utf8');
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const string={type:'string'},number={type:'number'};
const tasks=[
  {id:'car-requirement-retention',prompt:'声音超过60分贝的时候前进，小于的时候停止。使用ESP32，PLA 3D打印完整外壳，F1的形状，预算600 CNY。请整理不可丢失的要求，并回答能否用未校准麦克风的相对dBFS直接宣称达到60 dB SPL。仅整理，不假装生成或验证汽车。',schema:object({controller:string,threshold: number,thresholdUnit:string,material:string,style:string,budget:number,currency:string,calibrationRequired:{type:'boolean'},message:string}),check:r=>r.controller.toUpperCase().includes('ESP32')&&r.threshold===60&&r.thresholdUnit.toUpperCase().includes('SPL')&&r.material.toUpperCase()==='PLA'&&/F1|formula/i.test(r.style)&&r.budget===600&&r.currency==='CNY'&&r.calibrationRequired===true},
  {id:'electrical-repair-reasoning',prompt:'检查这个候选：ESP32-DevKitC V4 WROOM32E 的 IO34 接到 DRV8833 的电机控制输入；电机额定6V；2S锂电池直接供电，标称7.4V满电8.4V；MAX4466供电3.3V、模拟信号接IO35。请指出电机电源问题、IO34问题；提出可输出的GPIO替代与不超过电机额定的最大供电电压。不要修改用户的6V额定要求，不要声称实物通过。',schema:object({motorPowerValid:{type:'boolean'},io34OutputValid:{type:'boolean'},replacementGPIO:number,maxMotorVoltage:number,physicalTestStatus:string,message:string}),check:r=>r.motorPowerValid===false&&r.io34OutputValid===false&&[4,16,17,18,19,21,22,23,25,26,27,32,33].includes(r.replacementGPIO)&&r.maxMotorVoltage<=6&&/UNKNOWN|NOT_TESTED|未测试|未验证/i.test(r.physicalTestStatus)},
  {id:'fresh-parametric-toy-tray',prompt:'设计一个 PLA 打印玩具零件收纳盒。外尺寸100×60×18 mm，底板2 mm，四周壁厚2 mm，三个大小相等的并排储物格，隔板2 mm。仅一件打印零件，顶部敞开。不要提问，其余选择明确假设。不能有零厚度或断开的实体。输出完整M4KE设计JSON（包括装配检查），不要填入测试PASS。',schema:OLLAMA_DESIGN_SCHEMA,system:designSkill,check:r=>{const s=validateDesignSpec(r.spec||r);return s.parts.length===1&&!s.questions.length&&s.parts[0].kind==='printed'&&s.parts[0].material==='PLA';},spec:true},
];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
await mkdir(out,{recursive:true});
const tags=await fetch(endpoint+'/api/tags').then(r=>r.json());
const report={schemaVersion:1,startedAt:new Date().toISOString(),status:'RUNNING',scope:'Local-model screening, not a car or physical acceptance test. Native tray geometry is retained for separate kernel checks.',models:models.map(name=>({name,digest:tags.models.find(m=>m.name===name)?.digest||null})),options:{temperature:0.2,seed:928,num_ctx:32768,num_predict:4096,think:false},rows:[]};
await writeFile(path.join(out,'cases.json'),JSON.stringify(tasks.map(({check,...t})=>({...t,schemaHash:hash(t.schema),promptHash:hash(t.prompt)})),null,2));
const persist=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await persist();
for(const model of models){
  if(!tags.models.some(m=>m.name===model)){report.rows.push({model,status:'NOT_INSTALLED'});await persist();continue;}
  for(const task of tasks){
    // Production tasks get priority; do not queue behind a user's active generation.
    const projects=await fetch('http://127.0.0.1:4173/api/studio/projects').then(r=>r.json());
    if(projects.projects?.some(p=>p.workflow?.status==='running')){report.status='YIELDED_TO_PRODUCTION';await persist();process.exit(3);}
    const row={model,task:task.id,startedAt:new Date().toISOString(),status:'RUNNING',schemaHash:hash(task.schema),promptHash:hash(task.prompt)};
    report.rows.push(row);await persist();let content='',firstContentMs=null,terminal=null,chunks=0;const started=performance.now();
    try{
      const response=await fetch(endpoint+'/api/chat',{method:'POST',signal:AbortSignal.timeout(180000),headers:{'Content-Type':'application/json'},body:JSON.stringify({model,stream:true,think:false,keep_alive:'3m',messages:[{role:'system',content:task.system||'Use the supplied facts. Reply concisely in Chinese with JSON, preserving all requested constraints. Evidence is not generated by writing PASS.'},{role:'user',content:task.prompt}],format:task.schema,options:report.options})});
      if(!response.ok)throw Error(`Ollama HTTP ${response.status}`);
      let pending='';const decoder=new TextDecoder();
      const consume=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.error)throw Error(item.error);const part=item.message?.content||'';if(part){firstContentMs??=Math.round(performance.now()-started);content+=part;chunks++;}if(item.done){const {message,...metrics}=item;terminal=metrics;}};
      for await(const chunk of response.body){pending+=decoder.decode(chunk,{stream:true});let at;while((at=pending.indexOf('\n'))>=0){consume(pending.slice(0,at));pending=pending.slice(at+1);}}
      consume(pending+decoder.decode());
      if(!terminal)throw Error('Missing completion record');
      row.metrics=terminal;row.tokensPerSecond=terminal.eval_duration?Math.round(terminal.eval_count/(terminal.eval_duration/1e9)*100)/100:null;
      if(terminal.done_reason==='length')throw Error('Token limit: incomplete output');
      const result=JSON.parse(content);row.semanticCheck=Boolean(task.check(result));row.status=row.semanticCheck?'SCREEN_PASS':'SCREEN_FAIL';
      if(task.spec)await writeFile(path.join(out,`${report.rows.length}-design.json`),JSON.stringify(validateDesignSpec(result.spec||result),null,2));
    }catch(e){row.status='ERROR';row.error=e.message;}
    row.elapsedMs=Math.round(performance.now()-started);row.firstContentMs=firstContentMs;row.contentCharacters=content.length;row.chunks=chunks;
    await writeFile(path.join(out,`${report.rows.length}-response.txt`),content);await persist();console.log(JSON.stringify(row));
  }
}
report.status='COMPLETE';report.finishedAt=new Date().toISOString();await persist();
