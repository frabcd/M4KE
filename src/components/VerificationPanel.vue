<script setup lang="ts">
import { computed, ref } from "vue";
import { MapPin, FileCheck, ArrowRight } from "@lucide/vue";
import { useStudio } from "../studio/store";
import { claimTargets } from "../studio/claims";
import { readable } from "../studio/api";
const s = useStudio(),
  full = ref(false),
  report = computed(() => s.currentJob?.verification);
const claims = computed(() =>
  full.value
    ? report.value?.claims || []
    : (report.value?.claims || []).filter((c) => c.status === "FAIL").slice(0,3),
);
</script>
<template>
  <section class="verification-panel">
    <header class="section-heading">
      <div>
        <span class="eyebrow">{{
          s.t("当前版本的证据", "REVISION-BOUND EVIDENCE")
        }}</span>
        <h2>{{ s.t("先验证，再制造。", "Evidence before manufacturing.") }}</h2>
      </div>
      <FileCheck :size="28" />
    </header>
    <p class="boundary">
      {{
        s.t(
          "数字检查与实物验收分开。实际配合、材料和运行表现需要按装配指南确认。",
          "Digital checks and physical acceptance are separate. Confirm actual fit, materials and behavior with the build guide.",
        )
      }}
    </p>
    <div v-if="s.project?.workflow" class="workflow-progress" role="status">
      <strong>{{ s.workflowHeading }}</strong>
      <p>{{ s.project.workflow.message }}</p>
      <details v-if="s.project.workflow.attempts?.length">
        <summary>
          {{ s.t("已保留的尝试", "Preserved attempts") }} ·
          {{ s.project.workflow.attempts.length }}
        </summary>
        <article
          v-for="attempt in s.project.workflow.attempts"
          :key="attempt.number"
        >
          <strong
            >#{{ attempt.number }} ·
            {{ attempt.overall || attempt.status }}</strong
          ><a :href="'?job=' + attempt.jobId" target="_blank" rel="noopener"
            >{{ s.t("检查任务", "Inspect job") }} ↗</a
          >
          <ul>
            <li v-for="failure in attempt.criticalFailures" :key="failure">
              {{ failure }}
            </li>
          </ul>
          <code>{{ attempt.designHash }}</code>
        </article>
      </details>
    </div>
    <p
      v-if="s.evidenceError"
      class="error"
      role="alert"
      data-testid="evidence-mismatch"
    >
      {{ s.evidenceError }}
    </p>
    <div v-if="s.currentJob?.error" class="error" role="alert">
      {{ s.currentJob.error }}
    </div>
    <div class="verification-summary" v-if="report">
      <strong :class="{ 'danger-text': s.failed }">{{ s.failed ? s.t('这一版仍有待解决的问题','Design issues remain') : s.t('本轮检查完成 · 待确认项见下方','Digital checks complete · physical confirmation needed') }}</strong
      ><span
        >{{ report.claims.filter((c) => c.status === "PASS").length }} PASS ·
        {{ report.claims.filter((c) => c.status === "FAIL").length }} FAIL ·
        {{ report.claims.filter((c) => c.status === "UNKNOWN").length }}
        {{ s.t('项待确认（完整依据可展开）','items need confirmation (expand full evidence)') }}</span
      >
    </div>
    <p v-else class="empty-small">
      {{
        s.t(
          "尚无当前版本的验证结果。微调草稿不会自动运行验证。",
          "No evidence for this revision yet. Refining a draft does not automatically run verification.",
        )
      }}
    </p>
    <div class="toolbar">
      <button
        class="primary"
        data-testid="verification-run"
        :disabled="
          s.working ||
          !s.project ||
          !s.spec?.parts.length ||
          s.hasQuestions ||
          s.dirty ||
          s.project.requiresDesignUpdate
        "
        @click="s.run('verify')"
      >
        {{ s.t("确认设计，运行验证", "Confirm design & verify") }}</button
      ><button v-if="report" @click="full = !full">
        {{
          full ? s.t("只看问题", "Issues only") : s.t("完整报告", "Full report")
        }}</button
      ><button
        v-if="s.currentJob?.status === 'complete'"
        @click="s.setStage('export')"
      >
        {{ s.t("导出与装配", "Export & assembly") }}<ArrowRight :size="14" />
      </button>
    </div>
    <p v-if="s.failed" class="error" role="alert">
      {{
        s.t(
          "关键检查未通过。仅可查看诊断资料，不应制造或通电。",
          "Critical checks failed. Diagnostic review only; do not manufacture or energize.",
        )
      }}
    </p>
    <div class="claim-list">
      <article
        v-for="claim in claims"
        :key="claim.id"
        class="claim-card"
        :data-claim-id="claim.id"
      >
        <header>
          <span class="status" :class="claim.status.toLowerCase()">{{
            claim.status
          }}</span>
          <h3>{{ claim.label }}</h3>
          <small v-if="claim.critical">{{ s.t("关键", "CRITICAL") }}</small>
        </header>
        <p>{{ readable(claim.details) }}</p>
        <button
          v-if="
            claimTargets(claim, s.spec?.parts || [], s.electrical?.connections)
              .partIds.length
          "
          @click="s.locate(claim)"
        >
          <MapPin :size="13" />{{ s.t("在模型中定位", "Locate in model") }}
        </button>
        <details>
          <summary>{{ s.t("方法与依据", "Method & evidence") }}</summary>
          <dl>
            <dt>{{ s.t("方法", "Method") }}</dt>
            <dd>{{ claim.method }}</dd>
            <dt>{{ s.t("实际", "Observed") }}</dt>
            <dd>
              <pre>{{ readable(claim.observed) }}</pre>
            </dd>
            <dt>{{ s.t("要求", "Required") }}</dt>
            <dd>
              <pre>{{ readable(claim.required) }}</pre>
            </dd>
          </dl>
        </details>
      </article>
    </div>
    <details v-if="s.currentJob?.review">
      <summary>
        {{ s.t("AI 建议（非证据）", "AI advisory (not evidence)") }}
      </summary>
      <p>{{ s.currentJob.review.summary }}</p>
      <ul>
        <li v-for="x in s.currentJob.review.concerns" :key="x">{{ x }}</li>
        <li v-for="x in s.currentJob.review.suggestedTests" :key="x">
          {{ x }}
        </li>
      </ul>
    </details>
    <ul>
      <li v-for="line in report?.limitations" :key="line">{{ line }}</li>
    </ul>
  </section>
</template>
