<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Download, Check, RotateCcw, Package } from "@lucide/vue";
import { useStudio } from "../studio/store";
import { artifactUrl, downloadJson } from "../studio/api";
import PrintingPanel from "./PrintingPanel.vue";
import ElectricalPanel from "./ElectricalPanel.vue";
const s = useStudio(),
  tab = ref<"files" | "assembly" | "print">("files"),
  stepId = ref(""),
  completed = ref<string[]>([]),
  checks = ref<Record<string, boolean>>({});
const diagnostic = computed(
  () => s.failed || !s.currentJob?.verification || !!s.evidenceError,
);
const step = computed(
  () =>
    s.spec?.assembly.find((x) => x.id === stepId.value) || s.spec?.assembly[0],
);
const stepReady = computed(
  () =>
    !!step.value &&
    !diagnostic.value &&
    s.currentJob?.status === "complete" &&
    step.value.requires.every((id) => completed.value.includes(id)) &&
    step.value.checks.every((_, i) => checks.value[step.value!.id + ":" + i]),
);
watch(
  () => s.project?.designHash || s.currentJob?.designHash,
  () => {
    completed.value = [];
    checks.value = {};
    stepId.value = "";
  },
);
function pick(id: string) {
  stepId.value = id;
  if (tab.value === "assembly") s.assemblyStepId = id;
  const current = s.spec?.assembly.find((x) => x.id === id);
  if (current) {
    s.select({ ids: current.partIds, activeId: current.partIds[0] || null });
    s.visibility(
      s.view.hiddenPartIds.filter((x) => !current.partIds.includes(x)),
    );
    s.highlights = current.partIds;
    s.view.viewMode = "model";
  }
}
watch(tab, value => { s.assemblyStepId = value === "assembly" ? step.value?.id || "" : ""; });
watch(() => s.assemblyStepId, id => { if (id && id !== stepId.value) pick(id); });
onBeforeUnmount(() => { s.assemblyStepId = ""; s.assemblyPlayback = null; });
function mark() {
  if (!stepReady.value || !step.value) return;
  completed.value = [...new Set([...completed.value, step.value.id])];
  const next = s.spec?.assembly.find(
    (x) =>
      !completed.value.includes(x.id) &&
      x.requires.every((id) => completed.value.includes(id)),
  );
  if (next) pick(next.id);
}
function reopen(id: string) {
  const reset = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of s.spec?.assembly || [])
      if (!reset.has(x.id) && x.requires.some((dep) => reset.has(dep))) {
        reset.add(x.id);
        changed = true;
      }
  }
  completed.value = completed.value.filter((x) => !reset.has(x));
  checks.value = Object.fromEntries(
    Object.entries(checks.value).filter(
      ([k]) => ![...reset].some((id) => k.startsWith(id + ":")),
    ),
  );
}
const extra = computed(() => [
  ["BUILD-GUIDE.html", s.t("离线装配指南", "Offline build guide")],
  ["BOM.csv", s.t("BOM（不是实时价格）", "BOM (not live pricing)")],
  ["verification.json", s.t("验证报告", "Verification report")],
  ...(s.currentJob?.portableRevision
    ? [
        ["PORTABLE-REVISION.json", "Portable revision"],
        ["PURCHASE-BOM.csv", "Grouped purchase candidates"],
        ["PORTABLE-COMPONENT-GROUPS.json", "Component groups"],
        ["PORTABLE-BUILD-GUIDE.md", "Portable guide"],
        ["VERIFICATION-PLAN.json", "Verification plan"],
      ]
    : []),
]);
function downloadSpec() {
  if (s.spec)
    downloadJson("M4KE-design.json", {
      spec: s.spec,
      designHash: s.project?.designHash || s.currentJob?.designHash,
      revision: s.project?.revision,
      physicalValidation: "UNKNOWN",
    });
}
</script>
<template>
  <section class="delivery-panel">
    <header class="section-heading">
      <div>
        <span class="eyebrow"
          >05 / {{ s.t("从屏幕到工作台", "FROM SCREEN TO WORKBENCH") }}</span
        >
        <h2>
          {{
            s.t("把设计和依据一起带走。", "Take the design and its evidence.")
          }}
        </h2>
      </div>
      <Package :size="28" />
    </header>
    <p v-if="s.failed" class="error" role="alert">
      {{
        s.t(
          "仅供诊断——关键检查失败，不应制造、装配或通电。",
          "Diagnostic only — critical checks failed. Do not manufacture, assemble or energize.",
        )
      }}
    </p>
    <p
      v-if="s.evidenceError"
      class="error"
      role="alert"
      data-testid="evidence-mismatch"
    >
      {{ s.evidenceError }}
    </p>
    <p class="boundary">
      {{
        s.t(
          "物理测试尚未完成。导出、勾选检查表或切片成功都不代表实物验证。",
          "Physical testing is not complete. Export, checklist ticks or successful slicing are not physical validation.",
        )
      }}
    </p>
    <div class="tab-strip">
      <button :class="{ active: tab === 'files' }" @click="tab = 'files'">
        {{ s.t("模型与资料", "Models & files") }}</button
      ><button
        data-testid="assembly-tab"
        :class="{ active: tab === 'assembly' }"
        @click="tab = 'assembly'"
      >
        {{ s.t("装配教程", "Assembly tutorial") }}</button
      ><button :class="{ active: tab === 'print' }" @click="tab = 'print'">
        {{ s.t("打印与切片", "Printing & slicing") }}
      </button>
    </div>
    <div v-if="tab === 'files'">
      <div class="download-cards">
        <article class="card">
          <h3>{{ s.t("完整构建包", "Complete build package") }}</h3>
          <p>
            STL / STEP · BOM ·
            {{
              s.t(
                "线路、固件、验证和装配说明",
                "wiring, firmware, checks and assembly guide",
              )
            }}
          </p>
          <a
            v-if="s.currentJob?.status === 'complete'"
            class="primary"
            :href="`/api/studio/jobs/${s.currentJob.id}/package`"
            download
            ><Download :size="15" />{{
              diagnostic
                ? s.t("下载诊断资料包", "Download diagnostic package")
                : s.t("下载资料包", "Download package")
            }}</a
          >
          <p v-else>
            {{
              s.t(
                "尚无匹配当前版本的成功 CAD 产物。",
                "No successful CAD artifacts matching this revision yet.",
              )
            }}
          </p>
        </article>
        <article class="card">
          <h3>{{ s.t("设计源文件", "Design specification") }}</h3>
          <p>
            {{
              s.t(
                "需求、零件、未知项和几何参数，不附带制造放行。",
                "Requirements, parts, unknowns and geometry; no manufacturing release.",
              )
            }}
          </p>
          <button @click="downloadSpec"><Download :size="15" />JSON</button>
        </article>
      </div>
      <div class="artifact-links" v-if="s.currentJob?.status === 'complete'">
        <a
          v-if="
            s.currentJob.cad?.assemblyStepUrl?.startsWith(
              '/api/studio/jobs/' + s.currentJob.id + '/files/',
            )
          "
          :href="s.currentJob.cad.assemblyStepUrl"
          download
          >{{
            diagnostic
              ? s.t("诊断 / 非制造：", "Diagnostic / not for manufacture: ")
              : ""
          }}Assembly STEP ↧</a
        ><a
          v-for="[path, label] in extra"
          :key="path"
          :href="artifactUrl(s.currentJob.id, path)"
          download
          >{{ diagnostic ? s.t("诊断：", "Diagnostic: ") : "" }}{{ label }} ↧</a
        >
      </div>
      <div class="table-scroll" v-if="s.cadParts?.length">
        <table>
          <thead>
            <tr>
              <th>{{ s.t("零件", "Part") }}</th>
              <th>{{ s.t("用途边界", "Use boundary") }}</th>
              <th>{{ s.t("下载", "Download") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in s.cadParts" :key="p.id">
              <td>{{ p.name || p.id }}</td>
              <td>
                {{
                  p.kind === "purchased"
                    ? s.t(
                        "采购件参考，不能打印替代",
                        "Purchased reference, not a printable replacement",
                      )
                    : s.t(
                        "打印几何，须复核",
                        "Printed geometry, review required",
                      )
                }}
              </td>
              <td>
                <a
                  v-if="
                    p.stlUrl?.startsWith(
                      '/api/studio/jobs/' + s.currentJob!.id + '/files/',
                    )
                  "
                  :href="p.stlUrl"
                  download
                  >{{
                    diagnostic ? s.t("诊断 STL", "Diagnostic STL") : "STL"
                  }}
                  ↧</a
                >
                <a
                  v-if="
                    p.stepUrl?.startsWith(
                      '/api/studio/jobs/' + s.currentJob!.id + '/files/',
                    )
                  "
                  :href="p.stepUrl"
                  download
                  >{{
                    diagnostic ? s.t("诊断 STEP", "Diagnostic STEP") : "STEP"
                  }}
                  ↧</a
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary>
          {{ s.t("接线与固件资料", "Wiring & firmware files") }}
        </summary>
        <ElectricalPanel />
      </details>
    </div>
    <div v-if="tab === 'assembly'" class="assembly-workflow">
      <nav :aria-label="s.t('装配步骤', 'Assembly steps')">
        <button
          v-for="(item, i) in s.spec?.assembly"
          :key="item.id"
          :class="{ active: step?.id === item.id }"
          @click="pick(item.id)"
        >
          <span>{{
            completed.includes(item.id) ? "✓" : String(i + 1).padStart(2, "0")
          }}</span
          >{{ item.title }}
        </button>
      </nav>
      <article v-if="step" class="assembly-step">
        <span class="eyebrow"
          >{{ completed.length }} / {{ s.spec?.assembly.length }}
          {{
            s.t("已复核（不是实物证据）", "reviewed (not physical evidence)")
          }}</span
        >
        <h3>{{ step.title }}</h3>
        <p>
          {{ s.t("相关零件：", "Related parts: ")
          }}{{
            step.partIds
              .map((id) => s.spec?.parts.find((p) => p.id === id)?.name || id)
              .join("、")
          }}
        </p>
        <p v-if="step.requires.length">
          {{ s.t("先完成：", "Prerequisites: ")
          }}{{
            step.requires
              .map(
                (id) => s.spec?.assembly.find((x) => x.id === id)?.title || id,
              )
              .join("、")
          }}
        </p>
        <ol>
          <li v-for="line in step.instructions" :key="line">{{ line }}</li>
        </ol>
        <label class="check-label" v-for="(check, i) in step.checks" :key="i"
          ><input
            type="checkbox"
            v-model="checks[step.id + ':' + i]"
            :disabled="
              diagnostic ||
              s.currentJob?.status !== 'complete' ||
              !step.requires.every((id) => completed.includes(id))
            "
          />{{ check }}</label
        >
        <div class="toolbar">
          <button
            class="primary"
            data-testid="assembly-mark"
            :disabled="!stepReady"
            @click="mark"
          >
            <Check :size="15" />{{
              s.t("确认本步骤已检查", "Mark step reviewed")
            }}</button
          ><button v-if="completed.includes(step.id)" @click="reopen(step.id)">
            <RotateCcw :size="14" />{{
              s.t("重开本步及依赖步骤", "Reopen step and dependents")
            }}
          </button>
        </div>
        <small>{{
          s.t(
            "检查表只记录本次浏览器会话的阅读复核；修改设计或刷新后重置。",
            "Checklist records this browser session only; reset on design change or reload.",
          )
        }}</small>
      </article>
    </div>
    <PrintingPanel v-if="tab === 'print'" />
  </section>
</template>
