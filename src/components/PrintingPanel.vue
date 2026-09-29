<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useStudio } from "../studio/store";
import { api, send } from "../studio/api";
import PrinterConnection from "./PrinterConnection.vue";
const s = useStudio();
type Profile = {
  id: string;
  label: string;
  printer: string;
  nozzle: string;
  material: string;
  sliceVerified: boolean;
};
type Capability = {
  available: boolean;
  slicingAvailable: boolean;
  status: string;
  version?: string;
  reason?: string;
  profiles: Profile[];
  networkDisabled: boolean;
};
type Slice = {
  id: string;
  jobId: string;
  designHash?: string;
  partId: string;
  profileId: string;
  status: string;
  createdAt?: string;
  error?: string;
  progress?: string;
  result?: {
    status: string;
    partId?: string;
    profileId?: string;
    networkDisabled: boolean;
    reviewRequired: boolean;
    physicalValidation: string;
    printerConnected: boolean;
    printSent: boolean;
    files: { name: string; sha256: string; bytes: number; url: string }[];
  };
};
const printer = ref(""),
  nozzle = ref(""),
  material = ref(""),
  partId = ref(""),
  profileId = ref(""),
  cap = ref<Capability | null>(null),
  slice = ref<Slice | null>(null),
  history = ref<Slice[]>([]),
  busy = ref(false),
  error = ref(""),
  historyWarning = ref("");
let token = 0,
  timer: ReturnType<typeof setInterval> | undefined,
  loadingSlice = false;
const printers = computed(
  () =>
    s.cap?.printers || [
      { id: "bambu-h2c", label: "Bambu Lab H2C" },
      { id: "bambu-a1", label: "Bambu Lab A1" },
      { id: "bambu-a1-mini", label: "Bambu Lab A1 mini" },
      { id: "bambu-p1s", label: "Bambu Lab P1S" },
      { id: "bambu-x1c", label: "Bambu Lab X1 Carbon" },
      { id: "other", label: "Other printer" },
    ],
);
const printed = computed(
  () => s.spec?.parts.filter((p) => p.kind === "printed") || [],
);
const profiles = computed(() =>
  (cap.value?.profiles || []).filter(
    (p) =>
      p.printer === printer.value &&
      String(p.nozzle) === nozzle.value &&
      p.material === material.value &&
      p.sliceVerified,
  ),
);
const running = computed(
  () => busy.value || ["queued", "running"].includes(slice.value?.status || ""),
);
const ready = computed(
  () =>
    !s.working &&
    !running.value &&
    s.currentJob?.status === "complete" &&
    s.currentJob.verification?.revisionHash === s.currentJob.designHash &&
    !s.failed &&
    cap.value?.available &&
    cap.value.slicingAvailable &&
    cap.value.networkDisabled &&
    printed.value.some((p) => p.id === partId.value) &&
    profiles.value.some((p) => p.id === profileId.value),
);
const result = computed(() => {
  const r = slice.value?.result;
  return slice.value?.status === "complete" &&
    r?.status === "SLICED_REVIEW_REQUIRED" &&
    r.reviewRequired &&
    r.networkDisabled &&
    r.physicalValidation === "UNKNOWN" &&
    r.printerConnected === false &&
    r.printSent === false
    ? r
    : null;
});
const files = computed(
  () =>
    result.value?.files.filter(
      (f) =>
        /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/.test(f.name) &&
        f.url ===
          `/api/studio/slices/${slice.value!.id}/files/${encodeURIComponent(f.name)}` &&
        /^[a-f0-9]{64}$/.test(f.sha256) &&
        Number.isSafeInteger(f.bytes) &&
        f.bytes > 0,
    ) || [],
);
async function refresh() {
  try {
    cap.value = await api("/api/studio/slicer");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function loadHistory() {
  const j = s.currentJob;
  if (!j) return;
  const epoch = token;
  try {
    const r = await api<{
      jobId: string;
      designHash: string;
      slices: Slice[];
      truncated: boolean;
      unreadableRecords: number;
    }>(`/api/studio/jobs/${j.id}/slices`);
    if (
      r.jobId !== j.id ||
      r.designHash !== j.designHash ||
      r.slices.some((x) => x.jobId !== j.id || x.designHash !== j.designHash)
    )
      throw Error("Slice history revision mismatch.");
    if (epoch === token) {
      history.value = r.slices;
      historyWarning.value =
        r.truncated || r.unreadableRecords
          ? s.t(
              "历史存在截断或不可读条目。",
              "History includes truncation or unreadable records.",
            )
          : "";
    }
  } catch (e) {
    if (epoch === token) error.value = (e as Error).message;
  }
}
async function readSlice(id: string, expected?: Slice) {
  const epoch = token;
  const r = await api<Slice>(`/api/studio/slices/${id}`);
  if (
    r.id !== id ||
    r.jobId !== s.currentJob?.id ||
    (r.designHash && r.designHash !== s.currentJob?.designHash) ||
    (expected &&
      (r.partId !== expected.partId || r.profileId !== expected.profileId))
  )
    throw Error("Slice identity mismatch; result withheld.");
  if (epoch === token) slice.value = r;
}
async function start() {
  if (!ready.value || !s.currentJob) return;
  busy.value = true;
  error.value = "";
  const epoch = ++token;
  try {
    const r = await send<Slice>(`/api/studio/jobs/${s.currentJob.id}/slice`, {
      partId: partId.value,
      profileId: profileId.value,
    });
    if (
      r.jobId !== s.currentJob.id ||
      r.partId !== partId.value ||
      r.profileId !== profileId.value ||
      !r.id
    )
      throw Error("Slice request identity mismatch.");
    if (epoch === token) slice.value = r;
    await loadHistory();
  } catch (e) {
    if (epoch === token) error.value = (e as Error).message;
  } finally {
    if (epoch === token) busy.value = false;
  }
}
async function inspect(item: Slice) {
  error.value = "";
  try {
    await readSlice(item.id, item);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(
  () => s.currentJob?.id + ":" + s.currentJob?.designHash,
  () => {
    token++;
    slice.value = null;
    history.value = [];
    partId.value = "";
    profileId.value = "";
    error.value = "";
    busy.value = false;
    void loadHistory();
  },
);
watch([printer, nozzle, material], () => {
  token++;
  profileId.value = "";
  slice.value = null;
  busy.value = false;
  error.value = "";
});
onMounted(() => {
  void refresh();
  void loadHistory();
  timer = setInterval(async () => {
    if (
      loadingSlice ||
      !slice.value ||
      !["queued", "running"].includes(slice.value.status)
    )
      return;
    loadingSlice = true;
    try {
      await readSlice(slice.value.id, slice.value);
      if (slice.value?.status === "complete" || slice.value?.status === "error")
        await loadHistory();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loadingSlice = false;
    }
  }, 1700);
});
onBeforeUnmount(() => {
  token++;
  clearInterval(timer);
});
</script>
<template>
  <section class="printing-panel">
    <h3>
      {{ s.t("制造配置与 DGX 切片", "Manufacturing setup & DGX slicing") }}
    </h3>
    <p>
      {{
        s.t(
          "不默认选择打印机。H2C 是选项之一，只有打印件可以切片。",
          "No printer is selected by default. H2C is one option. Slice printed parts only.",
        )
      }}
    </p>
    <div class="fields-row">
      <label
        >{{ s.t("打印机", "Printer")
        }}<select v-model="printer" :disabled="running">
          <option value="">{{ s.t("选择打印机…", "Choose printer…") }}</option>
          <option v-for="p in printers" :key="p.id" :value="p.id">
            {{ p.label }}
          </option>
        </select></label
      ><label
        >{{ s.t("喷嘴", "Nozzle")
        }}<select v-model="nozzle" :disabled="running">
          <option value="">—</option>
          <option v-for="n in ['0.2', '0.4', '0.6', '0.8']" :key="n">
            {{ n }}
          </option>
        </select></label
      ><label
        >{{ s.t("打印材料", "Print material")
        }}<select v-model="material" :disabled="running">
          <option value="">—</option>
          <option
            v-for="m in ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'Other']"
            :key="m"
          >
            {{ m }}
          </option>
        </select></label
      >
    </div>
    <p class="hint">
      {{
        s.t(
          "也可将下载的 STL/STEP 在 Bambu Studio 打开，核对实际机型、朝向、支撑和温度后切片。采购源 CAD 不是可打印替代件。",
          "You can open downloaded STL/STEP in Bambu Studio and check the actual printer, orientation, supports and temperatures. Purchased source CAD is not a printable replacement.",
        )
      }}
    </p>
    <div class="toolbar">
      <span>{{
        cap?.slicingAvailable
          ? "Local slicer " + (cap.version || "")
          : cap?.reason || s.t("切片器不可用", "Slicer unavailable")
      }}</span
      ><button @click="refresh" :disabled="running">
        {{ s.t("刷新切片器", "Refresh slicer") }}
      </button>
    </div>
    <div class="fields-row">
      <label
        >{{ s.t("打印件", "Printed part")
        }}<select v-model="partId" :disabled="running">
          <option value="">{{ s.t("选择打印件…", "Choose part…") }}</option>
          <option v-for="p in printed" :key="p.id" :value="p.id">
            {{ p.name }}
          </option>
        </select></label
      ><label
        >{{ s.t("已验证的精确配置", "Verified exact profile")
        }}<select v-model="profileId" :disabled="running || !profiles.length">
          <option value="">{{ s.t("选择配置…", "Choose profile…") }}</option>
          <option v-for="p in profiles" :key="p.id" :value="p.id">
            {{ p.label }}
          </option>
        </select></label
      >
    </div>
    <p v-if="!profiles.length" class="warning">
      {{
        s.t(
          "没有匹配的已验证配置；不会用其他机型替代。",
          "No matching verified profile; another printer is not substituted.",
        )
      }}
    </p>
    <p v-if="s.failed" class="error">
      {{
        s.t(
          "关键检查失败，禁止切片。",
          "Critical checks failed; slicing is blocked.",
        )
      }}
    </p>
    <button class="primary" :disabled="!ready" @click="start">
      {{ s.t("在 DGX 上切片", "Slice on DGX") }}
    </button>
    <p v-if="slice" role="status">
      {{ slice.status }} · {{ slice.progress || slice.error || "" }}
    </p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div v-if="result" class="card">
      <strong>{{
        s.t("已切片 · 必须复核", "SLICED · REVIEW REQUIRED")
      }}</strong>
      <p>
        {{
          s.t(
            "尚未发送打印。请检查完整 3MF 路径；物理验证仍为 UNKNOWN。",
            "No print sent. Inspect the complete 3MF toolpath; physical validation remains UNKNOWN.",
          )
        }}
      </p>
      <a v-for="file in files" :key="file.name" :href="file.url" download
        >{{ file.name }} · {{ Math.ceil(file.bytes / 1024) }} KiB ↧</a
      >
    </div>
    <p v-else-if="slice?.status === 'complete'" class="error">
      {{
        s.t(
          "结果未满足离线与复核边界，不提供下载。",
          "Result lacks offline/review boundaries; downloads withheld.",
        )
      }}
    </p>
    <details>
      <summary>
        {{ s.t("当前版本的切片历史", "Slice history for this revision") }} ·
        {{ history.length }}
      </summary>
      <p>{{ historyWarning }}</p>
      <button
        v-for="item in history"
        :key="item.id"
        class="history-row"
        @click="inspect(item)"
      >
        {{ item.partId }} · {{ item.profileId }} · {{ item.status }} ·
        {{ item.createdAt }}
      </button>
    </details>
    <PrinterConnection :model="printer" />
  </section>
</template>
