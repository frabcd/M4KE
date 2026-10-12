<script setup lang="ts">
import {computed, onMounted, onUnmounted, ref} from "vue";
import {Box, Cpu, Check, ArrowRight, Layers, ClipboardCheck, Cable, Package, Clock3} from "@lucide/vue";
import {useStudio} from "../studio/store";
const s=useStudio(), now=ref(Date.now());
let clock:ReturnType<typeof setInterval>|undefined;
onMounted(()=>{clock=setInterval(()=>now.value=Date.now(),1000);});
onUnmounted(()=>clearInterval(clock));
const workflow=computed(()=>s.project?.workflow);
const running=computed(()=>workflow.value?.status==='running');
const staged=computed(()=>Boolean(workflow.value?.generationId));
const stagedPhase=computed(()=>{
  const labels:Record<string,[string,string]>={readiness:['正在确认必要输入','Checking essential inputs'],plan:['正在确定分阶段计划','Planning generation batches'],generating:['正在生成当前批次','Generating the current batch'],retrying:['正在修正当前批次','Correcting the current batch'],validation:['正在检查完整设计','Checking the complete design'],stopped:['生成已停止，已保存进度','Generation stopped; progress saved'],exhausted:['本次生成预算已用尽或无法继续','This generation cannot continue within its budget'],accepted:['完整设计已通过结构检查','Complete design admitted']};
  const state=workflow.value?.generationState||workflow.value?.generation?.stage||'readiness';
  return labels[state]?s.t(...labels[state]):s.t('正在处理当前阶段','Working on the current stage');
});
const elapsed=computed(()=>{
  const start=Date.parse(workflow.value?.startedAt||'');
  if(!Number.isFinite(start))return '';
  const end=workflow.value?.finishedAt?Date.parse(workflow.value.finishedAt):now.value;
  const seconds=Math.max(0,Math.floor((end-start)/1000));
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
});
const phase=computed(()=>{
  const p=workflow.value?.inference?.phase;
  if(p==='truncated')return s.t('设计响应被截断','Design response was truncated');
  if(p==='generating')return s.t('正在构建设计','Building the design');
  if(p==='validating')return s.t('正在检查设计结构','Checking the design contract');
  if(p==='retrying')return s.t('根据错误反馈修正','Correcting from concrete feedback');
  if(p==='recovering')return s.t('推理进程异常，尝试恢复一次','Inference runner failed; one recovery attempt');
  return s.t('正在读取需求与本地资料','Reading your brief and local references');
});
const outputs=[
  {icon:Box,zh:'比例模型',en:'Scaled model',detailZh:'零件、外壳与空间关系',detailEn:'Parts, enclosure and placement'},
  {icon:ClipboardCheck,zh:'验证依据',en:'Evidence',detailZh:'确认设计后运行计算与检查',detailEn:'Checks run after you confirm'},
  {icon:Cable,zh:'接线与装配',en:'Wiring & assembly',detailZh:'与当前版本对应的指导',detailEn:'Instructions bound to this revision'},
  {icon:Package,zh:'制造资料',en:'Build files',detailZh:'状态允许时导出打印件与清单',detailEn:'State-gated printable parts and BOM'},
];
</script>
<template>
  <aside class="brief-preview" data-testid="brief-preview" :aria-label="s.t('设计蓝图','Design blueprint')">
    <header class="blueprint-heading"><span class="blueprint-mark"><Layers :size="19" /></span><div><small>M4KE / BLUEPRINT</small><h2>{{s.project?.name||s.t('你的下一个作品','Your next creation')}}</h2></div><span class="local-badge"><Cpu :size="12"/>{{s.cap?.provider === 'codex-bridge' ? s.t('在线 AI','Online AI') : s.t('本地 AI','Local AI')}}</span></header>
    <section class="blueprint-intent">
      <span class="eyebrow">{{s.t('你的需求 · 实时预览','YOUR BRIEF · LIVE PREVIEW')}}</span>
      <p :class="{'empty-brief':!s.request.trim()}">{{s.request.trim()||s.t('在左侧描述行为、外形或限制。这里会一直保留你的想法。','Describe behavior, form or constraints on the left. Your intent stays visible here.')}}</p>
      <div class="brief-facts"><span v-if="s.budget.trim()">{{s.budget}}</span><span v-if="Object.values(s.answers).some(Boolean)">{{Object.values(s.answers).filter(Boolean).length}} {{s.t('项已回答','answers recorded')}}</span><span>{{s.t('成人监督原型','Adult-supervised prototype')}}</span></div>
    </section>
    <section v-if="staged" class="generation-activity" aria-live="polite" data-testid="staged-progress">
      <strong>{{stagedPhase}}</strong>
      <p v-if="workflow?.generation?.declaredUnits">{{s.t(`${workflow.generation.declaredUnits} 个批次中 ${workflow.generation.validatedUnits} 个已校验；${workflow.generation.reusedUnits} 个已复用`,`${workflow.generation.validatedUnits} of ${workflow.generation.declaredUnits} batches validated; ${workflow.generation.reusedUnits} reused`)}}</p>
      <p>{{s.t('批次校验不是整机验证。完整设计仍需通过全部检查。','Batch validation is not engineering verification. The complete design must still pass all checks.')}}</p>
      <p v-if="workflow?.generationState==='exhausted'" data-testid="generation-exhausted">{{s.t('本次尝试无法在剩余预算内继续。记录已保留；重新开始会创建新的生成。','This attempt cannot continue within its remaining budget. Records are preserved; Start over creates a new generation.')}}</p>
      <div class="generation-actions">
        <button v-if="!running && workflow?.status==='error' && workflow.canResume && !s.dirty && !s.conflict" type="button" :disabled="s.busy" @click="s.resumeGeneration()" data-testid="resume-generation">{{s.t('继续已保存的生成','Resume saved generation')}}</button>
        <button v-if="!running && workflow?.status==='error'" type="button" :disabled="s.busy" @click="s.run('design')" data-testid="start-over-generation">{{s.t('重新开始','Start over')}}</button>
        <button v-if="running && workflow?.canCancel" type="button" :disabled="s.busy || workflow.cancellationPending" @click="s.cancelGeneration()" data-testid="cancel-generation">{{workflow.cancellationPending?s.t('正在停止…','Stopping…'):s.t('停止生成','Cancel generation')}}</button>
      </div>
    </section>
    <div v-else-if="running" class="generation-activity" role="status" data-testid="generation-activity">
      <div class="activity-title"><span class="activity-dot"/><strong>{{phase}}</strong><span class="elapsed"><Clock3 :size="12"/>{{elapsed}}</span></div>
      <div class="activity-meta"><span>{{s.t('AI 正在处理你的设计','AI is working on your design')}}</span><span v-if="workflow?.inference?.outputCharacters">{{workflow.inference.outputCharacters.toLocaleString()}} {{s.t('字符已收到','characters received')}}</span></div>
      <p v-if="workflow?.inference?.retryReason==='output-truncated'" data-testid="truncation-status">{{s.t('上一轮响应触及输出上限，未形成完整设计。','The previous response reached its output limit without a complete design.')}} <template v-if="workflow.inference.phase!=='truncated'">{{s.t('正在用更大的预算重试；仍需通过完整检查。','Retrying with a larger budget; all checks still apply.')}}</template></p>
      <div v-if="workflow?.inference?.attempt" class="activity-meta"><span>{{s.t('生成尝试','Generation attempt')}} {{workflow.inference.attempt}}</span><span v-if="workflow.inference.tokenLimit">{{s.t('输出上限','Output limit')}} {{workflow.inference.tokenLimit.toLocaleString()}} tokens</span></div>
      <p>{{s.t('预览会在完整响应检查后出现。字数与等待时间不是完成百分比。','The preview appears after a complete response passes its contract checks. Time and received text are not completion percentages.')}}</p>
    </div>
    <div v-else-if="workflow?.status==='error'" class="blueprint-error" role="status"><strong>{{s.t('这次尝试没有完成','This attempt did not finish')}}</strong><p v-if="workflow.inference?.phase==='truncated'" data-testid="truncation-failure">{{s.t('设计响应被截断，已停止自动重试。完整设计尚未通过检查。','Design output was truncated. Automatic retries have stopped; no complete design passed its checks.')}}</p><p>{{s.t('需求和当前作品已保留。请重试；详细原因可在处理记录中查看。','Your brief and current design are saved. Retry, or open the processing record for details.')}}</p></div>
    <div v-else-if="s.hasQuestions" class="blueprint-question"><strong>{{s.t('还差几个关键决定','A few decisions remain')}}</strong><p>{{s.t('回答左侧问题，然后继续。可自由补充，不必只选建议答案。','Answer the questions on the left, then continue. Your own answer is welcome.')}}</p></div>
    <section class="blueprint-outputs"><h3>{{s.t('你将得到什么','What you are building toward')}}</h3><div v-for="item in outputs" :key="item.en" class="blueprint-output"><span><component :is="item.icon" :size="18"/></span><div><strong>{{s.t(item.zh,item.en)}}</strong><small>{{s.t(item.detailZh,item.detailEn)}}</small></div><ArrowRight :size="14"/></div></section>
    <footer><Check :size="14"/><span>{{s.t('先预览，再确认。AI 不会替你批准制造。','Preview first. Confirm explicitly. AI never authorizes manufacturing for you.')}}</span></footer>
  </aside>
</template>
<style scoped>
.generation-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.generation-actions button{border:1px solid currentColor;border-radius:8px;background:transparent;color:inherit;padding:8px 12px;min-height:40px;cursor:pointer}
.generation-actions button:disabled{opacity:.55;cursor:default}
.generation-actions button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
@media(prefers-reduced-motion:no-preference) and (hover:hover){.generation-actions button:active:not(:disabled){transform:scale(.97)}}
</style>
