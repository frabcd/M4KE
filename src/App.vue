<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import {
  Box,
  FolderOpen,
  Plus,
  Settings,
  Library,
  ChevronRight,
  ArrowRight,
  Check,
  Globe,
  PanelRight,
  Upload,
  Wifi,
  AlertTriangle,
  X,
  Save,
} from "@lucide/vue";
import { useStudio } from "./studio/store";
import type { Stage, Spec } from "./studio/types";
import { downloadJson } from "./studio/api";
import StudioViewport from "./components/StudioViewport.vue";
import AssemblyTutorial from "./components/AssemblyTutorial.vue";
import Outliner from "./components/Outliner.vue";
import Inspector from "./components/Inspector.vue";
import AssistantComposer from "./components/AssistantComposer.vue";
import BriefPreview from "./components/BriefPreview.vue";
import VerificationPanel from "./components/VerificationPanel.vue";
import ElectricalPanel from "./components/ElectricalPanel.vue";
import StudioDialog from "./components/StudioDialog.vue";
const DeliveryPanel = defineAsyncComponent(
  () => import("./components/DeliveryPanel.vue"),
);
const LibraryPanel = defineAsyncComponent(
  () => import("./components/LibraryPanel.vue"),
);
const RuntimePanel = defineAsyncComponent(
  () => import("./components/RuntimePanel.vue"),
);
const s = useStudio(),
  workspaceName = ref(""),
  sheet = ref<"projects" | "library" | "runtime" | null>(null),
  rightVisible = ref(true),
  confirmVerify = ref(false),
  acceptTargetChanges = ref(false),
  fileInput = ref<HTMLInputElement>();
const serviceOffline = computed(() => /Failed to fetch|NetworkError|not JSON.*DGX connection|Load failed/i.test(s.error));
let timer: ReturnType<typeof setInterval> | undefined;
watch(() => s.proposal?.id, () => { acceptTargetChanges.value = false; });
const narrow = matchMedia("(max-width:800px)");
const adaptPanels = () => {
  rightVisible.value = !narrow.matches;
};
onMounted(() => {
  adaptPanels();
  narrow.addEventListener("change", adaptPanels);
  void s.initialize();
  timer = setInterval(() => void s.poll(), 1600);
});
onUnmounted(() => {
  clearInterval(timer);
  narrow.removeEventListener("change", adaptPanels);
});
watch(
  () => s.locale,
  (value) => (document.documentElement.lang = value === "zh" ? "zh-CN" : "en"),
);
const stages = computed(
  () =>
    [
      { id: "workspace", zh: "工作区", en: "Workspace" },
      { id: "requirements", zh: "要求描述", en: "Requirements" },
      { id: "refine", zh: "微调细节", en: "Refine" },
      { id: "verify", zh: "可行性验证", en: "Verify" },
      { id: "export", zh: "导出和装配", en: "Export & assemble" },
    ] as const,
);
const hasModel = computed(() => !!s.displaySpec?.parts.length);
const canSubmit = computed(
  () =>
    s.request.trim() &&
    !s.working &&
    (!s.hasQuestions ||
      s.questions.every((q) => s.answers[q.id]?.trim())),
);
const phaseName = computed(() => {
  const p = stages.value.find((x) => x.id === s.stage)!;
  return s.t(p.zh, p.en);
});
function go(stage: Stage) {
  if (stage === "workspace") {
    sheet.value = "projects";
    return;
  }
  s.setStage(stage);
}
function budgetQuestion(q: { id: string; question: string }) {
  return /budget|currency|预算|币种/i.test(q.id + " " + q.question);
}
async function importFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    if (file.size > 262144)
      throw Error(
        s.t("导入文件不得超过 256 KiB。", "Import must be under 256 KiB."),
      );
    const value = JSON.parse(await file.text());
    await s.importProject({
      spec: value.spec || value,
      request: value.request,
      budget: value.budget,
      answers: value.answers,
    });
    if (!s.error) sheet.value = null;
  } catch (e) {
    s.fail(e);
  } finally {
    (event.target as HTMLInputElement).value = "";
  }
}
async function importLegacy() {
  try {
    const raw = localStorage.getItem("m4ke-studio-draft-v1");
    if (!raw)
      throw Error(s.t("没有历史浏览器草稿。", "No historical browser draft."));
    await s.importProject(JSON.parse(raw));
    if (!s.error) sheet.value = null;
  } catch (e) {
    s.fail(e);
  }
}
function newWorkspace() {
  s.newWorkspace();
  sheet.value = null;
}
async function create() {
  if (!workspaceName.value.trim()) return;
  await s.create(workspaceName.value);
  if (!s.error) workspaceName.value = "";
}
</script>
<template>
  <div class="studio-app" :class="{ 'right-hidden': !rightVisible }">
    <header class="app-header">
      <a class="brand" href="/" aria-label="M4KE Studio"
        ><Box :size="23" /><strong>M4KE</strong><span>STUDIO</span></a
      ><span class="header-divider" /><button
        class="project-button"
        @click="sheet = 'projects'"
      >
        <FolderOpen :size="15" /><span>{{
          s.project?.name ||
          s.spec?.title ||
          s.t("本地工作区", "Local workspace")
        }}</span
        ><ChevronRight :size="13" />
      </button>
      <div class="header-spacer" />
      <span class="runtime-dot" :class="{ ready: s.cap?.configured }" /><span
        class="desktop-only"
        >{{
          s.cap?.configured
            ? (s.cap?.provider === 'codex-bridge' ? s.t('AI · 在线演示', 'AI · online demo') : s.modelLabel + " · DGX")
            : (s.capabilitiesLoading ? s.t("正在检测运行环境…", "Checking runtime…") : s.cap ? s.t("模型未配置", "Model unconfigured") : s.t("运行状态暂不可用", "Runtime status unavailable"))
        }}</span
      ><button
        class="icon-button"
        :aria-label="s.t('模型与材料库', 'Model & material library')"
        @click="sheet = 'library'"
      >
        <Library :size="17" /></button
      ><button
        class="icon-button"
        :aria-label="s.t('运行环境与设置', 'Runtime & settings')"
        @click="sheet = 'runtime'"
      >
        <Settings :size="17" /></button
      ><button
        class="language-button"
        :aria-label="s.t('切换为英文', 'Switch to Chinese')"
        @click="s.language"
      >
        <Globe :size="14" />{{ s.locale === "zh" ? "EN" : "中文" }}
      </button>
    </header>
    <nav
      class="phase-navigation"
      :aria-label="s.t('设计流程', 'Design workflow')"
    >
      <button
        v-for="(phase, index) in stages"
        :key="phase.id"
        :data-stage="phase.id"
        :class="{ active: s.stage === phase.id }"
        :aria-current="s.stage === phase.id ? 'step' : undefined"
        :disabled="
          phase.id !== 'workspace' &&
          ((!s.project && !s.job) || (index > 1 && !hasModel))
        "
        @click="go(phase.id)"
      >
        <span>{{ String(index + 1).padStart(2, "0") }}</span
        >{{ s.t(phase.zh, phase.en) }}</button
      ><span class="phase-tail">{{
        s.project ? "R" + s.project.revision : s.t("离线优先", "LOCAL FIRST")
      }}</span>
    </nav>
    <div v-if="s.error" class="global-alert error" role="alert">
      <AlertTriangle :size="16" /><span>{{ serviceOffline ? s.t("暂时无法连接 DGX。输入内容会保留；连接恢复后再继续。", "DGX is temporarily unreachable. Your input stays here; continue after reconnecting.") : s.error }}</span
      ><details v-if="serviceOffline" class="connection-details"><summary>{{ s.t("连接详情", "Connection details") }}</summary><p>{{ s.error }}</p></details><button
        v-if="s.conflict && s.project"
        @click="s.openProject(s.project.id)"
      >
        {{ s.t("重新加载 DGX 项目", "Reload DGX project") }}</button
      ><button
        class="icon-button"
        :aria-label="s.t('关闭错误提示', 'Dismiss error')"
        @click="s.error = ''"
      >
        <X :size="15" />
      </button>
    </div>
    <div v-if="s.viewError" class="global-alert warning" role="alert">
      {{ s.t("视图状态未保存：", "View state not saved: ") }}{{ s.viewError }}
    </div>
    <main v-if="s.stage === 'workspace'" class="workspace-home">
      <div class="home-copy">
        <span class="eyebrow">IDEAS INTO OBJECTS.</span>
        <h1>
          {{
            s.t(
              "把你的想法，变成下一件作品。",
              "From an idea, to a design you understand.",
            )
          }}
        </h1>
        <p>
          {{
            s.t(
              "描述一个小玩具。让AI 设计、解释并检查；每个零件都可追溯，每次修改都由你确认。",
              "Describe a small toy. AI designs, explains and checks it. Inspect every part and confirm every change.",
            )
          }}
        </p>
        <div class="home-path">
          <span>CONCEPT</span><i /><span>REASON</span><i /><span>VERIFY</span
          ><i /><span>MAKE</span>
        </div>
      </div>
      <section class="create-workspace">
        <span class="eyebrow">01 / {{ s.t("新工作区", "NEW WORKSPACE") }}</span>
        <h2>{{ s.t("给创意一个空间", "A space for your idea") }}</h2>
        <p>
          {{
            s.t(
              "一个工作区对应一个设计项目，文件和模型在 DGX 上。",
              "One workspace, one design project. Files and CAD stay on your DGX.",
            )
          }}
        </p>
        <form @submit.prevent="create">
          <label for="workspace-name">{{
            s.t("工作区名称", "Workspace name")
          }}</label
          ><input
            id="workspace-name"
            data-testid="workspace-name"
            v-model="workspaceName"
            maxlength="160"
            :placeholder="
              s.t('例如：声音控制的小车', 'e.g. Sound-controlled car')
            "
            required
          /><button
            class="primary full-width"
            data-testid="workspace-create"
            :disabled="!workspaceName.trim() || s.busy"
          >
            <Plus :size="16" />{{ s.t("创建工作区", "Create workspace") }}
          </button>
        </form>
        <button class="plain full-width" @click="sheet = 'projects'">
          {{ s.t("打开现有工作区", "Open existing workspace")
          }}<ArrowRight :size="14" />
        </button>
      </section>
      <section class="recent-workspaces" v-if="s.projects.length">
        <header>
          <h2>{{ s.t("最近的项目", "Recent projects") }}</h2>
          <small>{{ s.t("DGX 权威记录", "DGX authoritative records") }}</small>
        </header>
        <button
          v-for="project in s.projects.slice(0, 5)"
          :key="project.id"
          @click="s.openProject(project.id)"
        >
          <FolderOpen :size="18" /><span
            ><strong>{{ project.title }}</strong
            ><small>{{
              new Date(project.updatedAt).toLocaleString()
            }}</small></span
          ><ArrowRight :size="16" />
        </button>
      </section>
    </main>
    <main v-else-if="s.stage === 'requirements'" class="requirements-stage">
      <section class="brief-editor">
        <span class="eyebrow">02 / {{ s.t("要求描述", "THE BRIEF") }}</span>
        <h1>
          {{
            s.hasQuestions
              ? s.t("先确定关键选择。", "A few decisions first.")
              : s.t("你希望它做什么？", "What should it do?")
          }}
        </h1>
        <p>
          {{
            s.t(
              "行为、用途和限制比工程术语更重要。AI 只追问必要信息，其余提出明确假设。",
              "Describe behavior, purpose and constraints. AI asks only essential questions and states the remaining assumptions.",
            )
          }}
        </p>
        <label for="toy-request">{{
          s.t("描述你的要求", "Describe your requirements")
        }}</label
        ><textarea
          id="toy-request"
          data-testid="requirements-input"
          v-model="s.request"
          maxlength="12000"
          rows="6"
          :disabled="s.working"
          @input="s.dirty = true"
          :placeholder="
            s.t(
              '一个在声音超过相对阈值时前进、安静时停止的小车…',
              'A small car that moves while sound is above a relative threshold and stops when quiet…',
            )
          "
        />
        <div class="brief-examples" v-if="!s.working && !s.hasQuestions">
          <span>{{s.t('试试一个方向','Start with a direction')}}</span>
          <button type="button" v-for="example in [{zh:'声音控制玩具',en:'Sound-controlled toy',briefZh:'一个在声音超过指定阈值时前进、安静时停止的小车。',briefEn:'A small car that moves above a sound threshold and stops when quiet.'},{zh:'桌面机械玩具',en:'Desk mechanism',briefZh:'一个可以用手转动的桌面齿轮玩具，能看清传动过程。',briefEn:'A hand-operated desk gear toy with visible transmission.'},{zh:'打印外壳',en:'Printed enclosure',briefZh:'一个用于小型电子玩具的可拆卸3D打印外壳。',briefEn:'A removable 3D-printed enclosure for a small electronic toy.'}]" :key="example.en" @click="s.request = s.request.trim() ? s.request + '\n' + s.t(example.briefZh,example.briefEn) : s.t(example.briefZh,example.briefEn);s.dirty=true">{{s.t(example.zh,example.en)}}</button>
        </div>
        <div class="brief-meta">
          <label
            >{{ s.t("预算与币种（可选）", "Budget & currency (optional)")
            }}<input
              v-model="s.budget"
              maxlength="500"
              :disabled="s.working"
              @input="s.dirty = true"
              placeholder="e.g. 300 CNY"
          /></label>
          <div>
            <span class="hint">{{
              s.t(
                "不默认币种、不自动购买",
                "No default currency · No automatic purchases",
              )
            }}</span
            ><button :disabled="s.working || !s.dirty" @click="s.save">
              <Save :size="14" />{{ s.t("保存需求", "Save brief") }}
            </button>
          </div>
        </div>
        <fieldset
          v-for="q in s.questions"
          :key="q.id"
          class="question-card"
          :disabled="s.working"
        >
          <legend>{{ q.question }}</legend>
          <div v-if="q.options && !budgetQuestion(q)" class="question-options">
            <button
              v-for="option in q.options"
              type="button"
              :key="option"
              :aria-pressed="s.answers[q.id] === option"
              @click="
                s.answers[q.id] = option;
                s.dirty = true;
              "
            >
              {{ option }}
            </button>
          </div>
          <input
            v-model="s.answers[q.id]"
            :aria-label="q.question"
            maxlength="2000"
            @input="s.dirty = true"
            :placeholder="
              budgetQuestion(q)
                ? s.t(
                    '金额与币种，例如 300 CNY',
                    'Amount and currency, e.g. 300 CNY',
                  )
                : s.t(
                    '你的答案，也可以自定义…',
                    'Your answer, or write your own…',
                  )
            "
          />
        </fieldset>
        <div v-if="s.kitId" class="warning">
          {{ s.t("显式选择的源套件：", "Explicit source kit: ") }}{{ s.kitId
          }}<button @click="s.kitId = ''">
            {{ s.t("改为 AI 通用设计", "Use general AI design") }}
          </button>
        </div>
        <button
          class="primary large"
          data-testid="generate-draft"
          :disabled="!canSubmit"
          @click="s.run('design')"
        >
          {{
            s.working
              ? s.t("正在设计与检查…", "Designing & checking…")
              : s.hasQuestions
                ? s.t("提交答案，继续设计", "Submit answers & design")
                : s.t("开始创作", "Create my design")
          }}<ArrowRight :size="17" />
        </button>
        <p class="hint">
          {{
            s.t(
              "先生成、检查并尝试修复，再展示可审阅的版本。不会自动打印；实物校准与测试单独确认。",
              "Design, check and attempt repair before presenting a reviewable version. No automatic printing; physical calibration and testing remain separate.",
            )
          }}
        </p>
        <div v-if="s.project?.workflow" class="workflow-progress" role="status">
          <strong>{{ s.workflowHeading }}</strong>
          <p>{{ s.t("完成检查前保留当前版本。你可以在下方查看真实处理记录。", "Your current version stays in place until checks complete. View the actual processing record below.") }}</p>
          <details><summary>{{ s.t("处理详情", "Processing details") }}</summary><p>{{ s.project.workflow.message }}</p></details>
        </div>
      </section>
      <div class="brief-companion"><BriefPreview /><AssistantComposer brief /></div>
    </main>
    <main v-else class="model-workspace" :class="{ 'is-refining': s.stage === 'refine' && !s.proposal && !s.dirty && !s.project?.requiresDesignUpdate, 'is-assembly': s.stage === 'export' && !!s.assemblyStepId }">
      <section class="central-workspace">
        <div class="central-scroll">
        <div class="workspace-toolbar">
          <div>
            <button
              :class="{ active: s.view.viewMode === 'model' }"
              @click="
                s.view.viewMode = 'model';
                s.queueView();
              "
            >
              <Box :size="14" />{{ s.t("3D 视图", "3D view") }}</button
            ><button
              :class="{ active: s.view.viewMode === 'wiring' }"
              @click="
                s.view.viewMode = 'wiring';
                s.queueView();
              "
            >
              {{ s.t("电路与连线", "Wiring") }}
            </button>
          </div>
          <span class="model-state" :class="{ candidate: s.showCandidate }">{{
            s.showCandidate
              ? s.t("候选预览 · 未应用", "CANDIDATE · NOT APPLIED")
              : s.cadParts
                ? s.t("产物绑定 · mm", "ARTIFACT-BACKED · mm")
                : s.t("概念草稿 · 未验证", "CONCEPT · UNVERIFIED")
          }}</span
          ><button
            class="icon-button"
            :aria-label="s.t('切换大纲与属性', 'Toggle outliner & properties')"
            :aria-pressed="rightVisible"
            @click="rightVisible = !rightVisible"
          >
            <PanelRight :size="16" />
          </button>
          <button
            class="primary workspace-confirm"
            v-if="s.stage === 'refine'"
            data-testid="confirm-design"
            :disabled="
              s.working ||
              !!s.proposal ||
              s.hasQuestions ||
              !s.project ||
              s.dirty ||
              s.project.requiresDesignUpdate
            "
            @click="confirmVerify = true"
          >
            {{ s.t("确认设计，进入验证", "Confirm design & verify")
            }}<ArrowRight :size="15" />
          </button>
        </div>
        <div class="viewport-area" v-show="s.view.viewMode === 'model'">
          <StudioViewport
            v-if="hasModel"
            :parts="s.displaySpec!.parts"
            :cad-parts="s.cadParts"
            :components="s.catalog.components"
            :library-sources="s.librarySources"
            :connections="s.electrical?.connections"
            :selected-ids="s.view.selectedPartIds"
            :active-id="s.view.activePartId"
            :hidden-ids="s.view.hiddenPartIds"
            :selected-connection="s.selectedConnection"
            :highlighted-ids="s.highlights"
            :locale="s.locale"
            :projection="s.view.projection"
            :assembly-playback="s.assemblyPlayback"
            @projection="
              s.view.projection = $event;
              s.queueView();
            "
            :view-mode="s.view.viewMode"
            @select="s.select"
            @visibility="s.visibility"
            @select-connection="s.pickWire"
          ><template #tutorial><AssemblyTutorial v-if="s.stage === 'export' && s.assemblyStepId && !s.showCandidate" /></template></StudioViewport>
          <div v-else class="empty-small">
            {{
              s.t(
                "该版本没有可显示的零件。",
                "This revision has no displayable parts.",
              )
            }}
          </div>
        </div>
        <ElectricalPanel v-if="s.view.viewMode === 'wiring'" />
        <p v-if="s.dirty || s.project?.requiresDesignUpdate" class="warning">
          {{
            s.t(
              "需求已变更，当前几何不是新需求的设计。请先重新生成草稿。",
              "Requirements changed; this geometry does not represent the new brief. Regenerate the draft first.",
            )
          }}
          <button @click="s.setStage('requirements')">
            {{ s.t("重新生成草稿", "Regenerate draft") }}
          </button>
        </p>
        <div
          v-if="s.proposal"
          class="proposal-panel"
          data-testid="proposal-panel"
        >
          <header>
            <div>
              <span class="eyebrow">{{
                s.t("候选，不是已保存版本", "CANDIDATE, NOT SAVED")
              }}</span>
              <h3>{{ s.t("先比较，再应用", "Review before applying") }}</h3>
            </div>
            <button
              data-testid="proposal-preview"
              :aria-pressed="s.showCandidate"
              @click="s.showCandidate = !s.showCandidate"
            >
              {{
                s.showCandidate
                  ? s.t("查看当前版本", "Show current")
                  : s.t("查看候选", "Show candidate")
              }}
            </button>
          </header>
          <p>{{ s.proposal.message }}</p>
          <div v-if="s.proposal.decisionChanges?.length" class="warning">
            <strong>{{ s.t("这次修改改变了设计要求或用料说明，请单独确认", "This edit changes design targets or build specifications. Review separately.") }}</strong>
            <details v-for="change in s.proposal.decisionChanges" :key="change.field"><summary>{{ change.field }}</summary><p>{{ s.t("原要求", "Before") }}</p><pre>{{ JSON.stringify(change.before, null, 2) }}</pre><p>{{ s.t("新要求", "After") }}</p><pre>{{ JSON.stringify(change.after, null, 2) }}</pre></details>
            <label class="check-label"><input v-model="acceptTargetChanges" type="checkbox" data-testid="accept-target-changes" />{{ s.t("我已核对并同意这些要求变化；检查只对新要求有效", "I reviewed and accept these target changes; checks apply to the new targets.") }}</label>
          </div>
          <ul>
            <li v-for="(change, i) in s.proposal.changes" :key="i">
              <strong
                >{{ change.partId || s.t("整体设计", "Whole design") }} ·
                {{ change.type }}</strong
              ><span>{{ change.fields.join(", ") }}</span>
              <p>{{ change.reason }}</p>
            </li>
          </ul>
          <div class="toolbar">
            <button
              class="primary"
              data-testid="proposal-apply"
              :disabled="s.working || (!!s.proposal.decisionChanges?.length && !acceptTargetChanges)"
              @click="s.applyProposal(acceptTargetChanges)"
            >
              <Check :size="15" />{{
                s.t("确认应用候选", "Confirm candidate")
              }}</button
            ><button
              data-testid="proposal-cancel"
              :disabled="s.working"
              @click="s.discardProposal"
            >
              {{ s.t("放弃候选", "Discard candidate") }}
            </button>
          </div>
          <small>{{
            s.t(
              "已检查的候选携带自己的数字检查记录；确认后才替换当前版本，实物验证仍需完成。",
              "Checked candidates carry their own digital checks. Confirm to replace the current version; physical validation remains outstanding.",
            )
          }}</small>
        </div>
        <VerificationPanel v-if="s.stage === 'verify'" /><DeliveryPanel
          v-if="s.stage === 'export'"
        />
        </div>
        <AssistantComposer />
      </section>
      <aside class="right-panels" v-show="rightVisible">
        <button
          class="mobile-right-close icon-button"
          :aria-label="s.t('关闭大纲与属性', 'Close outliner and properties')"
          @click="rightVisible = false"
        >
          <X :size="16" /></button
        ><Outliner /><Inspector />
      </aside>
    </main>
    <footer class="status-bar">
      <span
        ><Wifi :size="12" />{{
          s.cap?.provider === 'codex-bridge' ? s.t('在线 AI · DGX 原生 CAD', 'Online AI · DGX native CAD') : s.t('本地推理 · 无云端回退', 'Local inference · No cloud fallback')
        }}</span
      ><span>{{ s.notice || phaseName }}</span
      ><code v-if="s.project?.designHash">{{
        s.project.designHash.slice(0, 12)
      }}</code>
    </footer>
    <StudioDialog
      :open="!!sheet"
      :title="
        sheet === 'projects'
          ? s.t('工作区', 'Workspaces')
          : sheet === 'library'
            ? s.t('模型、材料与来源', 'Models, materials & sources')
            : s.t('本地运行环境', 'Local runtime')
      "
      @close="sheet = null"
      ><template v-if="sheet === 'projects'"
        ><div class="toolbar">
          <button class="primary" :disabled="s.busy" @click="newWorkspace">
            <Plus :size="15" />{{ s.t("新工作区", "New workspace") }}</button
          ><button @click="s.refreshProjects">
            {{ s.t("刷新", "Refresh") }}</button
          ><button @click="fileInput?.click()">
            <Upload :size="15" />{{
              s.t("导入设计 JSON", "Import design JSON")
            }}</button
          ><button @click="importLegacy">
            {{
              s.t("显式导入旧浏览器草稿", "Import historical browser draft")
            }}</button
          ><input
            ref="fileInput"
            type="file"
            accept="application/json,.json"
            hidden
            @change="importFile"
          />
        </div>
        <p>
          {{
            s.t(
              "导入会建立新项目，不继承历史验证或制造许可。",
              "Import creates a new project without inheriting old evidence or manufacturing permission.",
            )
          }}
        </p>
        <button
          class="project-list-item"
          :disabled="s.busy"
          v-for="p in s.projects"
          :key="p.id"
          @click="
            s.openProject(p.id);
            sheet = null;
          "
        >
          <FolderOpen :size="18" /><span
            ><strong>{{ p.title }}</strong
            ><small>{{ new Date(p.updatedAt).toLocaleString() }}</small></span
          ><ChevronRight :size="15" /></button
        ><button
          v-if="s.job && !s.project && s.spec"
          class="primary"
          @click="
            s.importProject({ spec: s.spec });
            sheet = null;
          "
        >
          {{
            s.t(
              "将当前只读任务导入工作区",
              "Import read-only job into workspace",
            )
          }}
        </button></template
      ><LibraryPanel v-if="sheet === 'library'" /><RuntimePanel
        v-if="sheet === 'runtime'"
    /></StudioDialog>
    <StudioDialog
      :open="confirmVerify"
      :title="s.t('确认当前设计', 'Confirm this design')"
      @close="confirmVerify = false"
      ><p>
        {{
          s.t(
            "将对当前已保存版本运行计算、原生 CAD 与验证。失败时 AI 可在受限范围内修复；每次尝试保留，不会自动打印或通电。",
            "Run calculations, native CAD and verification on the saved revision. AI may attempt bounded repairs; each attempt is retained. No printing or energizing occurs.",
          )
        }}
      </p>
      <p>
        <strong>{{ s.spec?.title }} · R{{ s.project?.revision }}</strong>
      </p>
      <div class="toolbar">
        <button
          class="primary"
          data-testid="verification-run"
          @click="
            confirmVerify = false;
            s.run('verify');
          "
        >
          {{ s.t("确认并运行", "Confirm & run") }}</button
        ><button @click="confirmVerify = false">
          {{ s.t("继续微调", "Keep refining") }}
        </button>
      </div></StudioDialog
    >
  </div>
</template>
