import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { LibrarySource, AssemblyFrame } from "../viewport/types";
import { api, send, ApiError } from "./api";
import { claimTargets } from "./claims";
import { currentElectrical } from "./electrical.mjs";
import type {
  Capabilities,
  Catalog,
  Claim,
  Conversation,
  Electrical,
  Job,
  Project,
  Proposal,
  Spec,
  Stage,
  ViewState,
} from "./types";
const defaults = (): ViewState => ({
  version: 0,
  selectedPartIds: [],
  activePartId: null,
  hiddenPartIds: [],
  stage: "requirements",
  viewMode: "model",
  projection: "perspective",
  language: "zh",
});
export const useStudio = defineStore("studio", () => {
  // Ephemeral presentation only: never saved as a design/view preference.
  const assemblyStepId = ref("");
  const assemblyPlayback = ref<AssemblyFrame | null>(null);
  const project = ref<Project | null>(null),
    projects = ref<{ id: string; title: string; updatedAt: string }[]>([]),
    job = ref<Job | null>(null),
    catalog = ref<Catalog>({ components: [], materials: [], kits: [] }),
    cap = ref<Capabilities | null>(null),
    capabilitiesLoading = ref(false);
  const librarySources = ref<LibrarySource[]>([]),
    libraryError = ref("");
  const stage = ref<Stage>("workspace"),
    view = ref<ViewState>(defaults()),
    selectedConnection = ref<string | null>(null),
    highlights = ref<string[]>([]);
  const locale = ref<"zh" | "en">("zh"),
    error = ref(""),
    notice = ref(""),
    busy = ref(false),
    viewError = ref(""),
    loading = ref(false),
    conflict = ref(false);
  const proposal = ref<Proposal | null>(null),
    candidateJob = ref<Job | null>(null),
    showCandidate = ref(false),
    conversation = ref<Conversation[]>([]),
    request = ref(""),
    budget = ref(""),
    answers = ref<Record<string, string>>({}),
    dirty = ref(false),
    kitId = ref(""),
    kitParameters = ref<Record<string, number>>({});
  let epoch = 0,
    polling = false,
    viewTimer: ReturnType<typeof setTimeout> | undefined,
    viewSending = false,
    viewAgain = false,
    viewSequence = 0;
  const modelLabel = computed(() => {
    const name = typeof cap.value?.model === 'string' ? cap.value.model : cap.value?.model?.name || '';
    if (cap.value?.provider === 'codex-bridge') return 'AI';
    if (/qwen/i.test(name)) return 'Qwen';
    if (/gpt-oss/i.test(name)) return 'GPT-OSS';
    return 'AI';
  });
  // Shared product copy is provider-neutral. Runtime settings and each reply's
  // model metadata keep the actual source; translation must not rewrite it.
  const t = (zh: string, en: string) => locale.value === "zh" ? zh : en;
  const spec = computed(() => project.value?.spec || job.value?.spec || null);
  const currentJob = computed(() => {
    const j = job.value,
      p = project.value;
    if (!j || dirty.value) return null;
    if (
      p &&
      (p.jobId !== j.id || !p.designHash || p.designHash !== j.designHash)
    )
      return null;
    // Keep hash-matched CAD available, but never present a detached report as current evidence.
    if (j.verification && j.verification.revisionHash !== j.designHash)
      return { ...j, verification: undefined };
    return j;
  });
  const evidenceError = computed(() =>
    currentJob.value &&
    job.value?.verification &&
    job.value.verification.revisionHash !== job.value.designHash
      ? t(
          "验证报告与当前设计哈希不匹配。已隔离报告；仅可查看诊断 CAD，装配确认与切片禁用。",
          "Verification report does not match the current design hash. Report quarantined; diagnostic CAD only. Assembly acknowledgements and slicing are disabled.",
        )
      : "",
  );
  const cadParts = computed(() => {
    const visibleJob = showCandidate.value ? candidateJob.value : currentJob.value;
    return visibleJob?.status === "complete" ? visibleJob.cad?.parts : undefined;
  });
  const working = computed(
    () =>
      busy.value ||
      project.value?.workflow?.status === "running" ||
      ["queued", "running"].includes(currentJob.value?.status || ""),
  );
  const displaySpec = computed(() =>
    showCandidate.value && proposal.value ? proposal.value.spec : spec.value,
  );
  const electrical = computed<Electrical | undefined>(() =>
    showCandidate.value
      ? undefined
      : currentElectrical(
          currentJob.value?.electrical,
          currentJob.value?.designHash || "",
          spec.value?.parts || [],
        ),
  );
  const failed = computed(
    () =>
      currentJob.value?.verification?.overall === "FAILED" ||
      !!currentJob.value?.verification?.claims.some(
        (c) => c.critical && c.status === "FAIL",
      ),
  );
  const questions = computed(() => project.value?.pendingQuestions?.length ? project.value.pendingQuestions : spec.value?.questions || []);
  const hasQuestions = computed(() => questions.value.length > 0);
  const selectedPart = computed(() =>
    displaySpec.value?.parts.find((p) => p.id === view.value.activePartId),
  );
  const workflowHeading = computed(() => {
    const w = project.value?.workflow;
    if (!w) return "";
    if (w.status === "error") return t("本次方案尚未交付，已保存的设计未被替换", "Not delivered; your saved design was not replaced");
    if (w.status === "complete") return t("本轮数字检查已完成", "Digital checks completed");
    if (w.status === "questions") return t("需要你确认几个关键点", "A few decisions need your input");
    const labels: Record<string, [string, string]> = {
      design: ["正在理解要求并设计", "Understanding your brief and designing"],
      calculations: ["正在计算尺寸与性能", "Calculating dimensions and performance"],
      cad: ["正在生成并检查原生 CAD", "Building and checking native CAD"],
      verify: ["正在核对几何与电气", "Checking geometry and electrical constraints"],
      repair: ["正在根据检查结果修复方案", "Repairing issues found by the checks"],
      planning_checks: ["正在安排验证步骤", "Planning verification steps"],
      infrastructure_retry: ["连接恢复中，保留原设计重试", "Retrying the same design after an execution interruption"],
    };
    const pair = labels[w.stage]; return pair ? t(...pair) : t("正在处理当前方案", "Working on this design");
  });
  function fail(e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
    if (e instanceof ApiError && e.status === 409) conflict.value = true;
  }
  async function perform(task: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await task();
    } catch (e) {
      fail(e);
    } finally {
      busy.value = false;
    }
  }
  async function refreshLibrarySources() {
    try {
      const data = await api<{ schema: string; records: LibrarySource[] }>(
        "/api/studio/library/unified",
      );
      if (
        data.schema !== "m4ke-unified-library-1" ||
        !Array.isArray(data.records) ||
        data.records.length > 10000
      )
        throw Error("Unified model library response contract mismatch.");
      if (
        data.records.some(
          (record) =>
            !/^[a-f0-9]{64}$/.test(record.sourceSha256) ||
            typeof record.name !== "string" ||
            (record.sourceBoundsMm !== null &&
              record.sourceBoundsMm !== undefined &&
              (!Array.isArray(record.sourceBoundsMm) ||
                record.sourceBoundsMm.length !== 6 ||
                !record.sourceBoundsMm.every(Number.isFinite))),
        )
      )
        throw Error("Unified source identity or bounds are invalid.");
      librarySources.value = data.records;
      libraryError.value = "";
    } catch (e) {
      librarySources.value = [];
      libraryError.value = (e as Error).message;
    }
  }
  async function refreshProjects() {
    try {
      projects.value = (
        await api<{ projects: typeof projects.value }>("/api/studio/projects")
      ).projects;
    } catch (e) {
      fail(e);
    }
  }
  async function refreshCapabilities() {
    capabilitiesLoading.value = true;
    try {
      cap.value = await api("/api/studio/capabilities", { signal: AbortSignal.timeout(60000) });
    } catch (e) {
      fail(e);
    } finally {
      capabilitiesLoading.value = false;
    }
  }
  function urlProject(id: string) {
    const url = new URL(location.href);
    url.searchParams.set("project", id);
    url.searchParams.delete("job");
    url.searchParams.delete("demo");
    history.replaceState(null, "", url);
    try {
      localStorage.setItem("m4ke-studio-recent-project", id);
    } catch {
      /* Optional hint; never authority. */
    }
  }
  function reconcile() {
    const ids = new Set(spec.value?.parts.map((p) => p.id));
    view.value.selectedPartIds = view.value.selectedPartIds.filter((id) =>
      ids.has(id),
    );
    view.value.hiddenPartIds = view.value.hiddenPartIds.filter((id) =>
      ids.has(id),
    );
    if (!ids.has(view.value.activePartId || ""))
      view.value.activePartId = view.value.selectedPartIds.at(-1) || null;
  }
  watch(showCandidate, (shown) => {
    if (!shown) {
      reconcile();
      queueView();
    }
  });
  async function accept(p: Project, replaceInputs = true) {
    const priorHash = project.value?.designHash;
    project.value = p;
    if (replaceInputs) {
      request.value = p.request;
      budget.value = p.budget;
      answers.value = Object.fromEntries(
        p.answers.map((a) => [a.id, a.answer]),
      );
      dirty.value = false;
    }
    if (priorHash !== p.designHash) {
      assemblyStepId.value = "";
      assemblyPlayback.value = null;
      selectedConnection.value = null;
      highlights.value = [];
      proposal.value = null;
    candidateJob.value = null;
      showCandidate.value = false;
    }
    reconcile();
    if (!p.jobId) job.value = null;
    else if (
      job.value?.id !== p.jobId ||
      ["queued", "running"].includes(job.value?.status || "")
    )
      await loadJob(p.jobId);
  }
  async function loadJob(id: string) {
    const token = epoch,
      j = await api<Job>("/api/studio/jobs/" + encodeURIComponent(id));
    if (token === epoch && (!project.value || project.value.jobId === id))
      job.value = j;
  }
  function reset() {
    assemblyStepId.value = "";
    assemblyPlayback.value = null;
    epoch++;
    clearTimeout(viewTimer);
    viewSequence++;
    viewAgain = false;
    project.value = null;
    job.value = null;
    view.value = defaults();
    proposal.value = null;
    candidateJob.value = null;
    showCandidate.value = false;
    conversation.value = [];
    selectedConnection.value = null;
    highlights.value = [];
    viewError.value = "";
    conflict.value = false;
    request.value = "";
    budget.value = "";
    answers.value = {};
    dirty.value = false;
    kitId.value = "";
    kitParameters.value = {};
  }
  async function openProject(id: string) {
    await perform(async () => {
      reset();
      const token = epoch,
        p = await api<Project>(
          "/api/studio/projects/" + encodeURIComponent(id),
        );
      if (token !== epoch) return;
      await accept(p);
      kitId.value = p.workflow?.kitId || "";
      kitParameters.value = { ...(p.workflow?.parameters || {}) };
      urlProject(p.id);
      stage.value = p.workflow?.status === 'questions' || !p.spec?.parts.length ? 'requirements' : 'refine';
      const initialViewSequence = viewSequence;
      void api<ViewState>(`/api/studio/projects/${id}/view`).then(saved => {
        if (token !== epoch || initialViewSequence !== viewSequence) return;
        view.value = saved;
        locale.value = saved.language;
        reconcile();
        stage.value =
          p.workflow?.status === "questions"
            ? "requirements"
            : p.spec?.parts.length
              ? saved.stage === "requirements"
                ? "refine"
                : saved.stage
              : "requirements";
      }).catch(e => {
        if (token !== epoch) return;
        viewError.value = (e as Error).message;
      });
      void api<{entries: Conversation[]}>(`/api/studio/projects/${id}/conversation`).then(saved => {
        if (token === epoch && Array.isArray(saved.entries)) conversation.value = saved.entries;
      }).catch(() => {
        if (token === epoch) notice.value = t("对话历史暂时无法加载；设计仍然保留。", "Conversation history is unavailable; your design is preserved.");
      });
    });
  }
  async function create(name: string) {
    await perform(async () => {
      reset();
      const p = await send<Project>("/api/studio/projects", {
        name: name.trim(),
        request: "",
        answers: [],
        budget: "",
      });
      await accept(p);
      urlProject(p.id);
      setStage("requirements");
      await refreshProjects();
    });
  }
  function newWorkspace() {
    if (busy.value) {
      notice.value = t(
        "请求处理中，请等当前操作结束后切换工作区。",
        "Wait for the current request before changing workspace.",
      );
      return;
    }
    reset();
    stage.value = "workspace";
    const url = new URL(location.href);
    url.searchParams.delete("project");
    url.searchParams.delete("job");
    history.replaceState(null, "", url);
  }
  async function saveRequirements() {
    if (!project.value)
      throw Error(t("请先创建工作区。", "Create a workspace first."));
    const p = await send<Project>(
      `/api/studio/projects/${project.value.id}`,
      {
        request: request.value,
        budget: budget.value,
        answers: Object.entries(answers.value)
          .filter(([, v]) => v.trim())
          .map(([id, answer]) => ({ id, answer })),
        expectedRevision: project.value.revision,
      },
      "PUT",
    );
    await accept(p);
    return p;
  }
  async function save() {
    await perform(async () => {
      await saveRequirements();
      notice.value = t("需求已保存到 DGX。", "Requirements saved to DGX.");
    });
  }
  async function run(mode: "design" | "verify") {
    await perform(async () => {
      if (!project.value) return;
      let p = project.value;
      if (mode === "verify" && (dirty.value || p.requiresDesignUpdate)) {
        setStage("requirements");
        throw Error(
          t(
            "需求已改变，请先重新生成设计草稿，不能验证旧设计。",
            "Requirements changed. Generate a new draft before verifying the old design.",
          ),
        );
      }
      if (mode === "design") p = await saveRequirements();
      const result = await send<Project>(`/api/studio/projects/${p.id}/run`, {
        mode: mode === "design" ? "deliver" : mode,
        expectedRevision: p.revision,
        ...(mode === "design"
          ? {
              answers: p.answers,
              budget: p.budget,
              ...(kitId.value
                ? { kitId: kitId.value, parameters: kitParameters.value }
                : {}),
            }
          : {}),
      });
      await accept(result);
      setStage(
        mode === "verify"
          ? "verify"
          : result.workflow?.status === "draft" && result.spec?.parts.length
            ? "refine"
            : "requirements",
      );
      notice.value = result.workflow?.status === 'running'
        ? t('已开始处理，需求已保存。', 'Started processing. Your brief is saved.')
        : result.workflow?.message || "";
    });
  }
  async function poll() {
    if (
      polling ||
      !project.value ||
      project.value.workflow?.status !== "running"
    )
      return;
    polling = true;
    const id = project.value.id,
      token = epoch;
    try {
      const p = await api<Project>(`/api/studio/projects/${id}`);
      if (token !== epoch || project.value?.id !== id) return;
      await accept(p, !dirty.value);
      if (p.workflow?.status === "questions") setStage("requirements");
      else if (p.workflow?.status === "draft") setStage("refine");
      else if (["complete", "error"].includes(p.workflow?.status || ""))
        setStage(p.workflow?.mode === "verify" || stage.value === "verify" ? "verify" : p.spec?.parts.length ? "refine" : "requirements");
    } catch (e) {
      if (token === epoch) fail(e);
    } finally {
      polling = false;
    }
  }
  async function saveView() {
    if (!project.value) return;
    if (viewSending) {
      viewAgain = true;
      return;
    }
    viewSending = true;
    const id = project.value.id,
      token = epoch,
      sequence = viewSequence,
      snapshot = JSON.parse(JSON.stringify(view.value));
    // A preview can contain new IDs, but it is not the saved project. Keep
    // those local for asking about the candidate; never persist phantom parts.
    const confirmed = new Set(project.value.spec?.parts.map((p) => p.id) || []);
    snapshot.selectedPartIds = snapshot.selectedPartIds.filter((partId: string) =>
      confirmed.has(partId),
    );
    snapshot.hiddenPartIds = snapshot.hiddenPartIds.filter((partId: string) =>
      confirmed.has(partId),
    );
    if (!snapshot.selectedPartIds.includes(snapshot.activePartId))
      snapshot.activePartId = snapshot.selectedPartIds.at(-1) || null;
    try {
      const result = await send<ViewState>(
        `/api/studio/projects/${id}/view`,
        {
          expectedVersion: snapshot.version,
          selectedPartIds: snapshot.selectedPartIds,
          activePartId: snapshot.activePartId,
          hiddenPartIds: snapshot.hiddenPartIds,
          stage: snapshot.stage,
          viewMode: snapshot.viewMode,
          projection: snapshot.projection,
          language: snapshot.language,
        },
        "PUT",
      );
      if (token === epoch && project.value?.id === id) {
        view.value.version = result.version;
        viewError.value = "";
      }
    } catch (e) {
      if (token === epoch) {
        viewError.value = (e as Error).message;
        if (e instanceof ApiError && e.status === 409) {
          try {
            const latest = await api<ViewState>(
              `/api/studio/projects/${id}/view`,
            );
            if (token === epoch) view.value.version = latest.version;
          } catch {
            /* Preserve explicit conflict; do not retry overwrite. */
          }
          viewAgain = false;
        }
      }
    } finally {
      viewSending = false;
      if (
        token === epoch &&
        (viewAgain || viewSequence !== sequence) &&
        !viewError.value
      ) {
        viewAgain = false;
        queueView();
      } else if (token !== epoch && viewAgain && project.value) {
        viewAgain = false;
        queueView();
      }
    }
  }
  function queueView() {
    viewSequence++;
    clearTimeout(viewTimer);
    viewTimer = setTimeout(() => void saveView(), 350);
  }
  function setStage(next: Stage) {
    if (next !== "workspace" && !project.value && !job.value) return;
    if (
      ["refine", "verify", "export"].includes(next) &&
      !spec.value?.parts.length
    )
      return;
    stage.value = next;
    view.value.stage = next;
    queueView();
  }
  function select({
    ids,
    activeId,
  }: {
    ids: string[];
    activeId: string | null;
  }) {
    view.value.selectedPartIds = [...new Set(ids)];
    view.value.activePartId = activeId;
    selectedConnection.value = null;
    highlights.value = [];
    queueView();
  }
  function visibility(ids: string[]) {
    view.value.hiddenPartIds = [...new Set(ids)];
    queueView();
  }
  function pickPart(id: string, extend = false) {
    const ids = extend
      ? view.value.selectedPartIds.includes(id)
        ? view.value.selectedPartIds.filter((x) => x !== id)
        : [...view.value.selectedPartIds, id]
      : [id];
    select({ ids, activeId: ids.includes(id) ? id : ids.at(-1) || null });
  }
  function pickWire(id: string | null) {
    selectedConnection.value = id;
    const c = electrical.value?.connections.find((w) => w.id === id);
    if (c) {
      view.value.selectedPartIds = [...new Set([c.from.partId, c.to.partId])];
      view.value.activePartId = c.from.partId;
      highlights.value = view.value.selectedPartIds;
      queueView();
    }
  }
  function locate(claim: Claim) {
    const targets = claimTargets(
      claim,
      spec.value?.parts || [],
      electrical.value?.connections || [],
    );
    select({ ids: targets.partIds, activeId: targets.partIds[0] || null });
    selectedConnection.value = targets.connectionIds[0] || null;
    highlights.value = targets.partIds;
    view.value.hiddenPartIds = view.value.hiddenPartIds.filter(
      (id) => !targets.partIds.includes(id),
    );
    view.value.viewMode = "model";
    queueView();
  }
  function language() {
    locale.value = locale.value === "zh" ? "en" : "zh";
    view.value.language = locale.value;
    document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
    try {
      localStorage.setItem("m4ke-studio-language", locale.value);
    } catch {
      /* Optional preference. */
    }
    queueView();
  }
  async function assistant(mode: "ask" | "propose", message: string, brief = false) {
    await perform(async () => {
      if (!project.value || (!brief && (!project.value.designHash || !spec.value?.parts.length)))
        throw Error(
          t("请先生成并保存草稿。", "Generate and save a draft first."),
        );
      if (showCandidate.value && mode !== "ask")
        throw Error(
          t(
            "请先应用或关闭候选预览。",
            "Apply or close the candidate preview first.",
          ),
        );
      if (!brief && (dirty.value || project.value.requiresDesignUpdate))
        throw Error(
          t(
            "需求已改变，请先重新生成设计草稿。",
            "Requirements changed. Generate a new draft first.",
          ),
        );
      if (brief && mode !== "ask") throw Error("Brief conversation is read-only.");
      if (brief && dirty.value) await saveRequirements();
      const p = project.value,
        ids = brief ? [] : [...view.value.selectedPartIds],
        token = epoch;
      const preview = !brief && showCandidate.value ? proposal.value : null;
      const snapshot = {
        revision: p.revision,
        designHash: preview?.designHash || p.designHash || null,
        selectedPartIds: ids,
        ...(preview ? {basis: "candidate" as const, proposalId: preview.id} : {}),
      };
      conversation.value.push({
        id: crypto.randomUUID(),
        role: "user",
        mode,
        message,
        ...snapshot,
      });
      const result = await send<{
        message: string;
        proposal?: Proposal;
        questions?: Conversation["questions"];
        warnings?: string[];
        conversation?: Conversation[];
      }>(`/api/studio/projects/${p.id}/assistant`, {
        mode,
        message,
        expectedRevision: p.revision,
        designHash: p.designHash || null,
        selectedPartIds: ids,
        ...(preview ? {proposalId: preview.id} : {}),
      });
      if (token !== epoch) return;
      conversation.value.push({
        id: crypto.randomUUID(),
        role: "assistant",
        mode,
        message: result.message,
        questions: result.questions,
        ...snapshot,
      });
      if (Array.isArray(result.conversation)) conversation.value = result.conversation;
      if (mode === "propose" && !result.questions?.length) {
        if (
          !result.proposal ||
          result.proposal.baseRevision !== p.revision ||
          result.proposal.baseDesignHash !== p.designHash
        )
          throw Error("Candidate revision identity mismatch.");
        let checked: Job | null = null;
        if (result.proposal.jobId) {
          checked = await api<Job>(`/api/studio/jobs/${result.proposal.jobId}`);
          if (token !== epoch) return;
          if (checked.designHash !== result.proposal.designHash || checked.status !== "complete" || checked.verification?.revisionHash !== checked.designHash)
            throw Error(t("候选检查记录不匹配；当前设计未改变。", "Candidate checks do not match; your design is unchanged."));
        }
        proposal.value = result.proposal;
        candidateJob.value = checked;
        showCandidate.value = true;
      }
      notice.value = (result.warnings || []).join(" · ");
    });
  }
  async function applyProposal(acceptDecisionChanges = false) {
    await perform(async () => {
      if (!proposal.value || !project.value) return;
      const candidate = proposal.value;
      if (
        candidate.baseRevision !== project.value.revision ||
        candidate.baseDesignHash !== project.value.designHash
      )
        throw new ApiError("Candidate is stale. Request a new proposal.", 409);
      const p = await send<Project>(
        `/api/studio/projects/${project.value.id}/proposals/${candidate.id}/apply`,
        {
          expectedRevision: candidate.baseRevision,
          designHash: candidate.baseDesignHash,
          acceptDecisionChanges,
        },
      );
      await accept(p);
      proposal.value = null;
    candidateJob.value = null;
      showCandidate.value = false;
      setStage("refine");
      notice.value = t(
        "候选已应用，已关联这一版的数字检查。可查看依据并继续装配准备。",
        "Candidate applied with its matching digital checks. Review evidence before assembly.",
      );
    });
  }
  function discardProposal() {
    proposal.value = null;
    candidateJob.value = null;
    showCandidate.value = false;
  }
  async function importProject(data: {
    request?: string;
    budget?: string;
    answers?: Record<string, string>;
    spec: Spec;
  }) {
    await perform(async () => {
      const p = await send<Project>("/api/studio/projects", {
        request: data.request || data.spec.description,
        budget: data.budget || "",
        answers: Object.entries(data.answers || {}).map(([id, answer]) => ({
          id,
          answer,
        })),
        spec: data.spec,
        jobId: null,
      });
      reset();
      await accept(p);
      urlProject(p.id);
      setStage("refine");
      notice.value = t(
        "导入为新项目，不导入历史证据。",
        "Imported as a new project without historical evidence.",
      );
      await refreshProjects();
    });
  }
  async function initialize() {
    loading.value = true;
    try {
      const saved = localStorage.getItem("m4ke-studio-language");
      if (saved === "en") locale.value = "en";
    } catch {
      /* Ignore optional preference. */
    }
    document.documentElement.lang = locale.value === "zh" ? "zh-CN" : "en";
    void refreshLibrarySources();
    // Native CAD detection can be slow. It must not block opening the user's
    // saved brief, replies or project while independent metadata is loading.
    void refreshCapabilities();
    void refreshProjects();
    void api<Catalog>("/api/studio/catalog")
      .then((x) => (catalog.value = x))
      .catch(fail);
    const q = new URLSearchParams(location.search),
      id = q.get("project"),
      jobId = q.get("job");
    if (id) await openProject(id);
    else if (jobId)
      await perform(async () => {
        reset();
        await loadJob(jobId);
        stage.value = "refine";
        notice.value = t(
          "只读任务。导入为工作区后才能询问或修改。",
          "Read-only job. Import into a workspace to ask or revise.",
        );
      });
    loading.value = false;
  }
  return {
    assemblyStepId,
    assemblyPlayback,
    project,
    projects,
    job,
    catalog,
    librarySources,
    libraryError,
    refreshLibrarySources,
    cap,
    capabilitiesLoading,
    stage,
    view,
    selectedConnection,
    highlights,
    locale,
    error,
    notice,
    busy,
    viewError,
    loading,
    conflict,
    proposal,
    showCandidate,
    conversation,
    request,
    budget,
    answers,
    dirty,
    kitId,
    kitParameters,
    t,
    modelLabel,
    spec,
    currentJob,
    evidenceError,
    cadParts,
    working,
    displaySpec,
    electrical,
    failed,
    workflowHeading,
    hasQuestions,
    questions,
    selectedPart,
    fail,
    perform,
    refreshProjects,
    refreshCapabilities,
    openProject,
    create,
    newWorkspace,
    save,
    run,
    poll,
    setStage,
    select,
    visibility,
    pickPart,
    pickWire,
    locate,
    language,
    assistant,
    applyProposal,
    discardProposal,
    importProject,
    initialize,
    queueView,
  };
});
