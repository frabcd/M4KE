<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useStudio } from "../studio/store";
import { api, safeExternal } from "../studio/api";
import {
  validUsability,
  validSourceAudit,
  type Usability,
} from "../studio/source-audit";
import SourcePreview, {
  type SourcePreview as Preview,
} from "./SourcePreview.vue";
import ProcurementPanel from "./ProcurementPanel.vue";
import WebResearchPanel from './WebResearchPanel.vue';
const s = useStudio(),
  tab = ref<"runtime" | "unified" | "sources" | "procurement" | "research">("runtime"),
  query = ref(""),
  page = ref(0),
  error = ref(""),
  busy = ref(false),
  preview = ref<Preview | null>(null),
  previews = ref<Preview[]>([]),
  audit = ref<Usability | null>(null),
  auditResult = ref("");
type SourceRecord = {
  id: string;
  name: string;
  sku: string | null;
  sourceUrl: string | null;
  productUrl: string | null;
  revision: string;
  sha256: string | null;
  eligibility?: string;
  qualificationNotes?: { finding: string; sourceUrl: string | null }[];
  nativeCheck: { status: string; sizeMm: number[] | null };
  buildQualified: false;
  physicalValidation: "UNKNOWN";
};
type Library = {
  available: boolean;
  status: string;
  reason?: string;
  records: SourceRecord[];
  summary: {
    candidateCount: number;
    uniqueSourceFiles: number;
    nativeReportedValid: number;
    nativeReviewRequired: number;
    nativePending: number;
  };
  limitations: string[];
};
const library = ref<Library | null>(null),
  filtered = computed(() =>
    (library.value?.records || []).filter((r) =>
      (r.name + " " + r.id + " " + r.sku)
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    ),
  ),
  pageRecords = computed(() =>
    filtered.value.slice(page.value * 24, (page.value + 1) * 24),
  );
watch([query, tab], () => (page.value = 0));
const unified = computed(() =>
  s.librarySources.filter((r) =>
    (r.name + " " + r.sourceSha256)
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const selectedKit = computed(() =>
  s.catalog.kits.find((k) => k.id === s.kitId),
);
function chooseKit() {
  const kit = s.catalog.kits.find((k) => k.id === s.kitId);
  s.kitParameters = kit
    ? Object.fromEntries(
        Object.entries(kit.parameters).map(([key, value]) => [
          key,
          value.default,
        ]),
      )
    : {};
}
async function refresh() {
  busy.value = true;
  error.value = "";
  try {
    const result = await api<Library>("/api/studio/library");
    if (
      !Array.isArray(result.records) ||
      result.records.length > 2000 ||
      !result.summary
    )
      throw Error("Invalid source library response.");
    library.value = result;
    const previewData = await api<{ available: boolean; records: Preview[] }>(
      "/api/studio/library/previews",
    );
    previews.value =
      previewData.available && Array.isArray(previewData.records)
        ? previewData.records
        : [];
    const auditData = await api<unknown>("/api/studio/library/usability");
    if (!validUsability(auditData))
      throw Error("Source audit response contract mismatch.");
    audit.value = auditData;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const sourcePreview = (record: SourceRecord) =>
  previews.value.find((p) => p.sourceSha256 === record.sha256);
const selectedAudit = computed(() =>
  audit.value?.records.find(
    (r) => r.sourceSha256 === preview.value?.sourceSha256,
  ),
);
async function verifySource() {
  if (!preview.value || !audit.value?.auditSha256) return;
  busy.value = true;
  error.value = "";
  auditResult.value = "";
  const selected = preview.value;
  try {
    const d = await api<{
        available: boolean;
        status: string;
        auditSha256: string;
        record: unknown;
        verification: {
          sourceSha256: string;
          assetHashes: { overview: string; detail: string };
          checkedAt: string;
        };
      }>(`/api/studio/library/usability/${selected.sourceSha256}`),
      r = d.record,
      v = d.verification;
    if (
      d.available !== true ||
      d.status !== "EXACT_PREVIEW_BYTES_VERIFIED" ||
      d.auditSha256 !== audit.value.auditSha256 ||
      !validSourceAudit(r) ||
      r.sourceSha256 !== selected.sourceSha256 ||
      !r.currentBytesVerified ||
      v?.sourceSha256 !== selected.sourceSha256 ||
      !(["overview", "detail"] as const).every(
        (level) =>
          r.assetHashes?.[level] === selected.levels[level].sha256 &&
          v.assetHashes?.[level] === selected.levels[level].sha256,
      ) ||
      !Number.isFinite(Date.parse(v.checkedAt))
    )
      throw Error("Source byte receipt identity or permission mismatch.");
    auditResult.value =
      s.t(
        "STEP 和两个预览的当前字节已重新核验；不代表 CAD/物理测试重跑。",
        "STEP and both preview bytes rehashed; CAD/physics tests were not rerun.",
      ) +
      " " +
      v.checkedAt;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => void refresh());
</script>
<template>
  <section class="library-panel">
    <div class="tab-strip">
      <button :class="{ active: tab === 'runtime' }" @click="tab = 'runtime'">
        {{ s.t("运行模型库", "Runtime catalog") }}</button
      ><button :class="{ active: tab === 'unified' }" @click="tab = 'unified'">
        {{ s.t("统一模型索引", "Unified model index") }}</button
      ><button :class="{ active: tab === 'sources' }" @click="tab = 'sources'">
        {{ s.t("源模型与尺度", "Source models & scale") }}</button
      ><button
        :class="{ active: tab === 'procurement' }"
        @click="tab = 'procurement'"
      >
        {{ s.t("材料与价格", "Materials & prices") }}
      </button>
      <button :class="{active:tab==='research'}" @click="tab='research'">{{s.t('联网找资料','Find online sources')}}</button>
    </div>
    <WebResearchPanel v-if="tab==='research'"/>
    <template v-if="tab === 'runtime'"
      ><p class="boundary">
        {{
          s.t(
            "运行库与候选源模型库分开。来源正确不等于装配、动态仿真或制造已放行。",
            "The runtime catalog is separate from candidate sources. Provenance does not imply assembly, dynamic simulation or manufacturing approval.",
          )
        }}
      </p>
      <label
        >{{ s.t("设计路线", "Design route")
        }}<select v-model="s.kitId" @change="chooseKit" :disabled="s.working">
          <option value="">
            {{ s.t("AI 通用设计（默认）", "General AI design (default)") }}
          </option>
          <option
            v-for="kit in s.catalog.kits"
            :key="kit.id"
            :value="kit.id"
            :disabled="kit.availability !== 'AVAILABLE'"
          >
            {{ kit.name }} · {{ kit.availability }}
          </option>
        </select></label
      >
      <div v-if="selectedKit" class="fields-row">
        <label v-for="(parameter, key) in selectedKit.parameters" :key="key"
          >{{ parameter.label
          }}<input
            type="number"
            v-model.number="s.kitParameters[key]"
            :aria-label="parameter.label"
            :min="parameter.minimum"
            :max="parameter.maximum"
            :disabled="s.working"
          />{{ parameter.unit }}</label
        >
      </div>
      <p v-if="s.kitId" class="warning">
        {{
          s.t(
            "明确选择预置源套件，而不是从空白要求生成。此选择不会自动运行。",
            "Explicit source-kit route, not fresh model generation. Selecting it does not start work.",
          )
        }}
      </p>
      <div class="catalog-grid">
        <article class="card" v-for="c in s.catalog.components" :key="c.id">
          <h3>{{ c.name }}</h3>
          <code>{{ c.id }}</code>
          <p>{{ c.description }}</p>
          <p>{{ c.manufacturer }} {{ c.mpn }}</p>
          <p>{{ c.geometry?.boundsMm?.join(" × ") || "UNKNOWN" }} mm</p>
          <span class="status unknown">{{
            c.fitStatus || "Physical fit UNKNOWN"
          }}</span
          ><a
            v-if="safeExternal(c.sourceUrl || c.geometry?.sourceUrl)"
            :href="safeExternal(c.sourceUrl || c.geometry?.sourceUrl)"
            target="_blank"
            rel="noopener noreferrer"
            >{{
              s.t("来源（点击后联网）", "Source (online when clicked)")
            }}
            ↗</a
          >
        </article>
      </div>
      <h3>{{ s.t("本地材料", "Local materials") }}</h3>
      <ul>
        <li v-for="m in s.catalog.materials" :key="m.id">
          {{ m.name }} · {{ m.id }}
        </li>
      </ul></template
    >
    <section v-if="tab === 'unified'">
      <div class="toolbar">
        <input
          v-model="query"
          :aria-label="s.t('搜索统一模型', 'Search unified models')"
          :placeholder="s.t('名称或源 SHA-256…', 'Name or source SHA-256…')"
        /><button @click="s.refreshLibrarySources">
          {{ s.t("刷新统一索引", "Refresh unified index") }}
        </button>
      </div>
      <p class="boundary">
        {{
          s.t(
            "原生导入候选与物理就绪不同。AI 可以在运行技能允许范围内选择精确源；比例、原始原点和来源哈希不得伪造。",
            "Native import candidacy is not physical readiness. AI may select exact sources within runtime skill limits; scale, original origin and provenance hashes are preserved.",
          )
        }}
      </p>
      <p v-if="s.libraryError" class="error" role="alert">
        {{ s.libraryError }}
      </p>
      <p>{{ unified.length }} {{ s.t("源模型", "source models") }}</p>
      <div class="source-grid">
        <article
          class="card"
          v-for="source in unified.slice(page * 24, (page + 1) * 24)"
          :key="source.sourceSha256"
        >
          <h3>{{ source.name }}</h3>
          <code>{{ source.sourceSha256 }}</code>
          <p>
            {{
              source.nativeImportCandidate === true
                ? s.t("原生导入候选", "Native import candidate")
                : s.t("尚无原生导入许可", "No native import permission")
            }}
          </p>
          <p>
            {{ s.t("原始坐标边界 / mm", "Original-frame bounds / mm") }}:
            {{ source.sourceBoundsMm?.join(", ") || "UNKNOWN" }}
          </p>
          <span class="status unknown">Physical fit UNKNOWN</span>
        </article>
      </div>
      <div class="toolbar">
        <button :disabled="page === 0" @click="page--">
          {{ s.t("上一页", "Previous") }}</button
        ><span
          >{{ page + 1 }} /
          {{ Math.max(1, Math.ceil(unified.length / 24)) }}</span
        ><button :disabled="(page + 1) * 24 >= unified.length" @click="page++">
          {{ s.t("下一页", "Next") }}
        </button>
      </div>
    </section>
    <template v-if="tab === 'sources'"
      ><div class="toolbar">
        <input
          v-model="query"
          :aria-label="s.t('搜索源模型', 'Search source models')"
          :placeholder="s.t('名称、SKU 或 ID…', 'Name, SKU or ID…')"
        /><button @click="refresh" :disabled="busy">
          {{ s.t("重新读取本地记录", "Refresh local records") }}
        </button>
      </div>
      <p>
        {{ library?.summary.candidateCount || 0 }}
        {{ s.t("候选记录", "candidate records") }} ·
        {{ library?.status || "UNKNOWN" }}
      </p>
      <p class="warning">
        {{
          s.t(
            "候选库只供检视。比例、原生几何和静态碰撞器的队友审计不是本应用动态物理测试。",
            "Candidate library is for inspection. Peer scale, native geometry and static-collider audits are not this app’s dynamic physics tests.",
          )
        }}
      </p>
      <div class="source-grid">
        <article class="card" v-for="r in pageRecords" :key="r.id">
          <h3>{{ r.name }}</h3>
          <code>{{ r.sku || r.id }}</code>
          <p>
            {{ r.nativeCheck.status }} ·
            {{ r.nativeCheck.sizeMm?.join(" × ") || "UNKNOWN" }} mm
          </p>
          <p>
            {{ r.eligibility || "Qualification pending" }} · {{ r.revision }}
          </p>
          <p class="hint">
            Physical validation: UNKNOWN · Build qualified: false
          </p>
          <button
            v-if="sourcePreview(r)"
            @click="
              preview = sourcePreview(r)!;
              auditResult = '';
            "
          >
            {{ s.t("检视真实源几何", "Inspect source geometry") }}</button
          ><a
            v-if="safeExternal(r.productUrl || r.sourceUrl)"
            :href="safeExternal(r.productUrl || r.sourceUrl)"
            target="_blank"
            rel="noopener noreferrer"
            >{{ s.t("来源", "Source") }} ↗</a
          >
          <details v-if="r.qualificationNotes?.length">
            <summary>{{ s.t("资格限制", "Qualification limits") }}</summary>
            <p v-for="n in r.qualificationNotes" :key="n.finding">
              {{ n.finding }}
            </p>
          </details>
        </article>
      </div>
      <div class="toolbar">
        <button :disabled="page === 0" @click="page--">
          {{ s.t("上一页", "Previous") }}</button
        ><span
          >{{ page + 1 }} /
          {{ Math.max(1, Math.ceil(filtered.length / 24)) }}</span
        ><button :disabled="(page + 1) * 24 >= filtered.length" @click="page++">
          {{ s.t("下一页", "Next") }}
        </button>
      </div>
      <div v-if="preview" class="preview-inspection">
        <button @click="preview = null">
          {{ s.t("关闭源预览", "Close source preview") }}</button
        ><SourcePreview :preview="preview" />
        <div class="card">
          <h4>{{ s.t("队友尺度与质量审计", "Peer scale & quality audit") }}</h4>
          <p v-if="selectedAudit">
            {{ selectedAudit.scaleStatus }} ·
            {{ selectedAudit.nativeGeometryStatus }} ·
            {{ selectedAudit.staticColliderStatus }}
          </p>
          <p>
            {{
              s.t(
                "装配、动态模拟、制造和应用物理权限仍禁止。",
                "Assembly, dynamic simulation, manufacture and app physics remain blocked.",
              )
            }}
          </p>
          <ul>
            <li v-for="b in selectedAudit?.blockers" :key="b">{{ b }}</li>
          </ul>
          <button
            :disabled="
              busy || selectedAudit?.previewJoin !== 'MATCHED_BOTH_LEVELS'
            "
            @click="verifySource"
          >
            {{
              s.t(
                "核验源文件与两个预览哈希",
                "Verify source and both preview hashes",
              )
            }}
          </button>
          <p role="status">{{ auditResult }}</p>
        </div>
      </div>
      <ul>
        <li v-for="line in library?.limitations" :key="line">{{ line }}</li>
      </ul></template
    ><ProcurementPanel v-if="tab === 'procurement'" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
