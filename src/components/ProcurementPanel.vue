<script setup lang="ts">
import BomPriceSearch from './BomPriceSearch.vue';
import { onMounted, ref } from "vue";
import { useStudio } from "../studio/store";
import { api, safeExternal } from "../studio/api";
const s = useStudio(),
  busy = ref(false),
  error = ref("");
type Entry = {
  id: string;
  identity: {
    manufacturer: string;
    mpn: string;
    supplierSku: string | null;
    variant: string;
    manufacturerRevision: string | null;
  };
  supplierId: string;
  market: string;
  price: {
    status: string;
    freshness: string;
    currency: string | null;
    unit: string | null;
    tiers: { minimumQuantity: number; unitPrice: string }[];
    advertisedAmount: string | null;
    observedAt: string | null;
    tax: string;
    shipping: string;
  };
  availability: {
    status: string;
    quantity: number | null;
    unit: string | null;
  };
  minimumOrderQuantity: number | null;
  orderMultiple: number | null;
  quote: {
    status: string;
    subtotal: string | null;
    purchaseAuthorized: false;
    engineeringQualified: false;
    reasons: string[];
  };
  specs: {
    name: string;
    value: string;
    unit: string;
    conditions: string;
    basis: string;
    evidenceId: string;
  }[];
  relatesTo: { note: string; relationship: string };
  notes: string[];
  sources: {
    id: string;
    url: string;
    capturedAt: string;
    sourceUpdatedAt: string | null;
    sha256: string;
  }[];
};
type Snapshot = {
  echoF1CnV2Reference?: {
    buildId: string;
    scope: string;
    sourceRevision: string;
    sourceUrl: string;
    budgetAllocationCny: number;
    totalCarCny: null;
    purchaseAuthorized: false;
    completePricedBom: false;
    observedLineCount: number;
    missingObservationCount: number;
    lines: {
      id: string;
      name: string | { appearanceEnabled: string; appearanceDisabled: string };
      specification: string | { appearanceEnabled: string; appearanceDisabled: string };
      quantity: number;
      unit: string;
      installedQuantity: number | null;
      packSize: number | null;
      budgetUnitCny: number;
      gate: string;
      status: string;
      qualifiedForPurchase: false;
      observation: { amountCny: string; url: string; reviewedAt: string; freshness: string } | null;
      dimensionConflict: { designMm: number[]; listingMm: number[]; sources: string[]; required: string } | null;
    }[];
  };
  soundCarReference?: {
    scope: string;
    pricedLineCount: number;
    missingLineCount: number;
    totalCarCny: null;
    partialSubtotals: { tax: string; amount: string }[];
    lines: { catalogId: string; mpn: string; installedQuantity: number; orderQuantity: number; unit: string; status: string; subtotal: string | null }[];
  };
  schemaVersion: number;
  available: boolean;
  status: string;
  snapshotSha256: string;
  snapshotCreatedAt: string;
  checkedAt: string;
  evidenceIntegrity: string;
  semanticClaimsVerified: boolean;
  ttlHours: number;
  entries: Entry[];
  networkUsed: boolean;
  liveSupplierConnected: boolean;
  completeBom: boolean;
  defaultMaterial: null;
  purchaseMade: boolean;
  engineeringQualified: boolean;
  limitations: string[];
};
const snapshot = ref<Snapshot | null>(null);
async function refresh() {
  busy.value = true;
  error.value = "";
  snapshot.value = null;
  try {
    const d = await api<Snapshot>("/api/studio/procurement");
    if (
      d.schemaVersion !== 1 ||
      !d.available ||
      !/^[a-f0-9]{64}$/.test(d.snapshotSha256) ||
      d.status !== "VERIFIED_OFFLINE_SNAPSHOT" ||
      d.evidenceIntegrity !== "PASS" ||
      d.semanticClaimsVerified !== false ||
      d.networkUsed !== false ||
      d.liveSupplierConnected !== false ||
      d.completeBom !== false ||
      d.defaultMaterial !== null ||
      d.purchaseMade !== false ||
      d.engineeringQualified !== false ||
      !Array.isArray(d.entries) ||
      d.entries.length < 1 || d.entries.length > 100 ||
      !Array.isArray(d.limitations)
    )
      throw Error(
        "Offline supplier evidence contract mismatch; no price substitution.",
      );
    if (
      d.entries.some(
        (e) =>
          !e.identity ||
          !e.price ||
          !e.quote ||
          e.quote.purchaseAuthorized !== false ||
          e.quote.engineeringQualified !== false ||
          !Array.isArray(e.sources) ||
          !e.sources.length ||
          e.sources.some(
            (x) => !safeExternal(x.url) || !/^[a-f0-9]{64}$/.test(x.sha256),
          ) ||
          !Array.isArray(e.specs) ||
          !Array.isArray(e.notes),
      )
    )
      throw Error(
        "Supplier entries lack provenance or qualification boundary.",
      );
    if (d.soundCarReference && (
      d.soundCarReference.scope !== "REFERENCE_KIT_NOT_ACTIVE_PROJECT_BOM" ||
      d.soundCarReference.totalCarCny !== null ||
      !Array.isArray(d.soundCarReference.lines) || d.soundCarReference.lines.length !== 7 ||
      !Array.isArray(d.soundCarReference.partialSubtotals)
    )) throw Error("Reference car pricing contract mismatch.");
    const cn = d.echoF1CnV2Reference;
    if (cn && (
      cn.buildId !== "echo-f1-cn-v2" || cn.scope !== "AUTHORED_BASELINE_NOT_ACTIVE_PROJECT_BOM" ||
      !/^[a-f0-9]{40}$/.test(cn.sourceRevision) || !safeExternal(cn.sourceUrl) ||
      cn.budgetAllocationCny !== 566 || cn.totalCarCny !== null ||
      cn.purchaseAuthorized !== false || cn.completePricedBom !== false ||
      !Array.isArray(cn.lines) || cn.lines.length !== 17 ||
      cn.lines.some(line => line.qualifiedForPurchase !== false ||
        (line.observation && !safeExternal(line.observation.url)) ||
        (line.dimensionConflict && line.dimensionConflict.sources.some(url => !safeExternal(url)))) ||
      cn.observedLineCount !== cn.lines.filter(line => line.observation).length ||
      cn.missingObservationCount !== 17 - cn.observedLineCount
    )) throw Error("CN v2 baseline pricing contract mismatch.");
    snapshot.value = d;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => void refresh());
</script>
<template>
  <section class="procurement-panel">
    <BomPriceSearch />
    <h3>
      {{
        s.t(
          "中国采购参考 · 离线快照",
          "China sourcing references · offline snapshot",
        )
      }}
    </h3>
    <p class="boundary">
      {{
        s.t(
          "不是完整购物清单或实时价格。不自动采用材料、不采购。完整性 PASS 只证明保留字节匹配，不认证实物适配。",
          "Not a complete shopping list or live pricing. No material adoption or purchases. Integrity PASS means retained bytes match, not physical suitability.",
        )
      }}
    </p>
    <button @click="refresh" :disabled="busy">
      {{ s.t("重新检查本地证据", "Recheck local evidence") }}
    </button>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <template v-if="snapshot"
      ><p>
        {{ snapshot.snapshotCreatedAt }} · {{ s.t("报价有效期", "Quote TTL") }}
        {{ snapshot.ttlHours }}h · {{ snapshot.checkedAt }}
      </p>
      <code>{{ snapshot.snapshotSha256 }}</code>
      <article v-if="snapshot.echoF1CnV2Reference" class="card" data-testid="echo-cn-price-coverage">
        <h3>ECHO F1 CN v2 · CNY</h3>
        <p>{{ s.t("已确认的设计基线，不代表当前打开项目的实时清单。", "Confirmed authored baseline; not the active project's live BOM.") }}</p>
        <a :href="safeExternal(snapshot.echoF1CnV2Reference.sourceUrl)" target="_blank" rel="noopener noreferrer">
          {{ s.t("设计清单来源", "Authored BOM source") }} · {{ snapshot.echoF1CnV2Reference.sourceRevision.slice(0, 7) }} ↗
        </a>
        <p><strong>{{ s.t("设计预算分配（不是供应商报价）", "Design budget allocation (not a supplier quote)") }}: CNY {{ snapshot.echoF1CnV2Reference.budgetAllocationCny }}</strong></p>
        <p>{{ s.t("有日期的挂牌价格记录", "Dated listing observations") }}: {{ snapshot.echoF1CnV2Reference.observedLineCount }}/17 ·
          {{ s.t("缺少价格记录", "Missing price observations") }}: {{ snapshot.echoF1CnV2Reference.missingObservationCount }}</p>
        <p><strong>{{ s.t("整车采购总价：未知", "Whole-car purchase total: UNKNOWN") }}</strong></p>
        <p>{{ s.t("全部条目待采购确认；库存、税费、运费、准确版本及适配均未确认。", "All lines await purchasing confirmation: stock, tax, shipping, exact revisions and fit are unconfirmed.") }}</p>
        <details v-for="line in snapshot.echoF1CnV2Reference.lines" :key="line.id" class="cn-bom-line" :open="Boolean(line.dimensionConflict)">
          <summary>{{ typeof line.name === 'string' ? line.name : line.name.appearanceDisabled }} ·
            {{ line.observation ? `CNY ${line.observation.amountCny} / piece` : s.t("价格未知", "Price unknown") }}</summary>
          <p>{{ s.t("采购数量", "Purchase units") }}: {{ line.quantity }} {{ line.unit }} ·
            {{ s.t("安装数量", "Installed") }}: {{ line.installedQuantity ?? "UNKNOWN" }}
            <span v-if="line.packSize"> · {{ line.packSize }} / pack</span></p>
          <p>{{ s.t("每采购单位的预算（不是报价）", "Budget per purchase unit (not a quote)") }}: CNY {{ line.budgetUnitCny }}</p>
          <p>{{ line.status }} · {{ line.gate }}</p>
          <p v-if="typeof line.specification === 'string'">{{ line.specification }}</p>
          <template v-else>
            <p>{{ s.t("默认外观", "Default appearance") }}: {{ line.specification.appearanceDisabled }}</p>
            <p>{{ s.t("可选外观", "Optional appearance") }}: {{ line.specification.appearanceEnabled }}</p>
          </template>
          <p v-if="line.observation">
            {{ s.t("仅挂牌记录；非实时价格", "Listing observation only; not a live price") }} · {{ line.observation.reviewedAt }} ·
            {{ s.t("来源时效", "Source freshness") }}: {{ line.observation.freshness }} ·
            <a :href="safeExternal(line.observation.url)" target="_blank" rel="noopener noreferrer">{{ s.t("供应商来源", "Supplier source") }} ↗</a>
          </p>
          <div v-if="line.dimensionConflict" data-testid="sensor-dimension-conflict">
            <strong>DIMENSIONS_TO_CONFIRM</strong>
            <p>{{ s.t("设计 / 英文 Wiki", "Design / English wiki") }}: {{ line.dimensionConflict.designMm.join(' × ') }} mm ·
              {{ s.t("中国商品页", "China listing") }}: {{ line.dimensionConflict.listingMm.join(' × ') }} mm</p>
            <p>{{ s.t("必须确认准确硬件版本、完整轮廓及接线；保持现有 CAD，由设计负责人解决差异。", "Confirm the exact hardware revision, full envelope and wiring. Preserve existing CAD; the design owner must resolve the discrepancy.") }}</p>
            <a v-for="(url, i) in line.dimensionConflict.sources" :key="url" :href="safeExternal(url)" target="_blank" rel="noopener noreferrer">{{ i === 0 ? 'English wiki' : 'China listing' }} ↗ </a>
          </div>
        </details>
      </article>
      <article v-if="snapshot.soundCarReference" class="card" data-testid="car-price-coverage">
        <h3>{{ s.t("历史声控车参考清单 · 人民币", "Historical sound-car reference · CNY") }}</h3>
        <p>{{ s.t("这是参考套件，不是当前项目的完整清单。", "Reference kit, not the active project's complete BOM.") }}</p>
        <p>{{ s.t("可计算参考价格", "Usable indicative prices") }}: {{ snapshot.soundCarReference.pricedLineCount }}/7 ·
          {{ s.t("缺失或不可报价", "Missing or unquotable") }}: {{ snapshot.soundCarReference.missingLineCount }}</p>
        <p><strong>{{ s.t("整车总价：未知", "Whole-car total: UNKNOWN") }}</strong></p>
        <p v-for="subtotal in snapshot.soundCarReference.partialSubtotals" :key="subtotal.tax">
          {{ s.t("仅已报价部分（不含运费）", "Priced portion only (shipping excluded)") }}:
          CNY {{ subtotal.amount }} · {{ s.t("税", "Tax") }}: {{ subtotal.tax }}
        </p>
        <ul>
          <li v-for="line in snapshot.soundCarReference.lines" :key="line.catalogId">
            {{ line.mpn }} · {{ s.t("安装数量", "Installed") }} {{ line.installedQuantity }} ·
            {{ s.t("订购单位", "Order units") }} {{ line.orderQuantity }} {{ line.unit }} ·
            {{ line.status }} · CNY {{ line.subtotal ?? "UNKNOWN" }}
          </li>
        </ul>
      </article>
      <div class="source-grid">
        <article v-for="e in snapshot.entries" :key="e.id" class="card">
          <h3>{{ e.identity.manufacturer }} · {{ e.identity.mpn }}</h3>
          <p>
            {{ e.identity.variant }} · SKU
            {{ e.identity.supplierSku || "UNKNOWN" }}
          </p>
          <p>
            {{ e.supplierId }} · {{ e.market }} · {{ e.price.status }} /
            {{ e.price.freshness }}
          </p>
          <ul>
            <li v-for="tier in e.price.tiers" :key="tier.minimumQuantity">
              {{ tier.minimumQuantity }}+ {{ e.price.unit }}:
              {{ e.price.currency }} {{ tier.unitPrice }} / {{ e.price.unit }}
            </li>
          </ul>
          <p v-if="e.price.advertisedAmount">
            {{ s.t("仅广告报价", "Advertised only") }}: {{ e.price.currency }}
            {{ e.price.advertisedAmount }}
          </p>
          <p>
            {{ s.t("一单位参考", "One-unit reference") }}:
            {{ e.quote.status }} · {{ e.quote.subtotal ?? "UNKNOWN" }}
          </p>
          <p>
            {{ s.t("库存", "Stock") }}: {{ e.availability.status }}
            {{ e.availability.quantity ?? "UNKNOWN" }} · MOQ
            {{ e.minimumOrderQuantity ?? "UNKNOWN" }}
          </p>
          <p>{{ e.relatesTo.note }}</p>
          <details>
            <summary>
              {{
                s.t("规格、条件和来源", "Specifications, conditions & sources")
              }}
            </summary>
            <ul>
              <li v-for="spec in e.specs" :key="spec.name">
                {{ spec.name }}: {{ spec.value }} {{ spec.unit }} ·
                {{ spec.conditions }} · {{ spec.basis }}
              </li>
              <li v-for="note in e.notes" :key="note">{{ note }}</li>
            </ul>
            <div v-for="source in e.sources" :key="source.id">
              <a
                :href="safeExternal(source.url)"
                target="_blank"
                rel="noopener noreferrer"
                >{{
                  s.t(
                    "官方来源（点击后联网）",
                    "Official source (online when clicked)",
                  )
                }}
                ↗</a
              ><small>{{ source.capturedAt }} · {{ source.sha256 }}</small>
            </div>
          </details>
        </article>
      </div>
      <ul>
        <li v-for="line in snapshot.limitations" :key="line">{{ line }}</li>
      </ul></template
    >
  </section>
</template>
