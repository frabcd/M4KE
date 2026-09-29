<script setup lang="ts">
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
const snapshot = ref<Snapshot | null>(null),
  PIN = "10274e8058359c921c6880058ea51f8856e4be409b551abf11d78d1de95a64b4";
async function refresh() {
  busy.value = true;
  error.value = "";
  snapshot.value = null;
  try {
    const d = await api<Snapshot>("/api/studio/procurement");
    if (
      d.schemaVersion !== 1 ||
      !d.available ||
      d.snapshotSha256 !== PIN ||
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
      d.entries.length !== 4 ||
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
