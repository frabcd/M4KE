<script setup lang="ts">
import { computed } from "vue";
import { SlidersHorizontal, Eye, EyeOff, Box } from "@lucide/vue";
import { useStudio } from "../studio/store";
import { safeExternal } from "../studio/api";
const s = useStudio();
const p = computed(() => s.selectedPart);
const explanation = computed(() =>
  p.value
    ? (("explanation" in p.value ? p.value.explanation : undefined) as
        | {
            purpose?: string;
            placementReason?: string;
            selectionReason?: string;
          }
        | undefined)
    : undefined,
);
const component = computed(() => {
  const shape = p.value?.shape;
  return shape?.type === "catalog"
    ? s.catalog.components.find((c) => c.id === shape.catalogId)
    : undefined;
});
const librarySource = computed(() => {
  const shape = p.value?.shape;
  return shape?.type === "library"
    ? s.librarySources.find(
        (source) => source.sourceSha256 === shape.sourceSha256,
      )
    : undefined;
});
const sources = computed(() => {
  const c = component.value as Record<string, unknown> | undefined;
  if (!c) return [];
  const values = [
    ...(Array.isArray(c.sourceUrls) ? c.sourceUrls : []),
    c.sourceUrl,
    ...(Array.isArray(c.sources)
      ? c.sources.map((x) =>
          typeof x === "string" ? x : (x as { url?: string })?.url,
        )
      : []),
  ];
  return [...new Set(values.map(safeExternal).filter((x): x is string => !!x))];
});
const dimensions = computed(() => {
  const sh = p.value?.shape;
  if (sh?.type === "library") {
    const bounds = librarySource.value?.sourceBoundsMm;
    return bounds?.length === 6
      ? [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]]
          .map((n) => n.toFixed(2))
          .join(" × ") + " mm"
      : s.t("原始源边界尚不可用", "Original source bounds unavailable");
  }
  return sh?.type === "box"
    ? sh.size.join(" × ") + " mm"
    : sh?.type === "cylinder"
      ? `r ${sh.radius} × h ${sh.height} mm`
      : sh?.type === "catalog"
        ? sh.catalogId
        : sh?.type === "union"
          ? sh.solids.length + " " + s.t("融合基本体", "fused primitives")
          : "";
});
function toggle() {
  if (!p.value) return;
  const ids = s.view.selectedPartIds,
    allHidden = ids.every((id) => s.view.hiddenPartIds.includes(id));
  s.visibility(
    allHidden
      ? s.view.hiddenPartIds.filter((id) => !ids.includes(id))
      : [...new Set([...s.view.hiddenPartIds, ...ids])],
  );
}
</script>
<template>
  <section class="inspector" :data-active-id="p?.id || ''">
    <header class="panel-heading">
      <SlidersHorizontal :size="15" />
      <h2>{{ s.t("属性与设计说明", "Properties & intent") }}</h2>
    </header>
    <div class="inspector-content" v-if="p">
      <div class="part-heading">
        <i :style="{ background: p.color }" />
        <div>
          <h3>{{ p.name }}</h3>
          <code>{{ p.id }}</code>
        </div>
      </div>
      <span class="eyebrow">{{
        p.kind === "printed"
          ? s.t("3D 打印件", "3D-PRINTED PART")
          : ["catalog", "library"].includes(p.shape.type)
            ? s.t("源 CAD / 采购件", "SOURCE CAD / PURCHASED")
            : s.t("采购件示意包络", "PURCHASED ENVELOPE")
      }}</span
      ><button class="full-width" @click="toggle">
        <EyeOff v-if="s.view.hiddenPartIds.includes(p.id)" :size="14" /><Eye
          v-else
          :size="14"
        />{{ s.t("切换所选可见性", "Toggle selected visibility") }} ({{
          s.view.selectedPartIds.length
        }})
      </button>
      <div class="explanation">
        <h4>{{ s.t("这是什么？", "What is this?") }}</h4>
        <p>
          {{
            explanation?.purpose ||
            s.t(
              "此版本未记录用途说明。可以选中零件后询问 AI。",
              "This revision has no recorded purpose. Ask AI with this part selected.",
            )
          }}
        </p>
        <h4>{{ s.t("为什么放在这里？", "Why here?") }}</h4>
        <p>
          {{
            explanation?.placementReason ||
            s.t(
              "未记录位置理由，不从坐标推断。",
              "No placement rationale recorded; coordinates are not an explanation.",
            )
          }}
        </p>
        <h4>{{ s.t("为什么使用这个？", "Why this part?") }}</h4>
        <p>
          {{
            explanation?.selectionReason ||
            s.t(
              "未记录选型理由，不代表选型已验证。",
              "No selection rationale recorded; suitability is not verified.",
            )
          }}
        </p>
        <small>{{
          s.t(
            "设计说明不是物理验证证据。",
            "Design rationale is not physical verification evidence.",
          )
        }}</small>
      </div>
      <p v-if="p.shape.type === 'library'" class="hint">
        Source SHA-256: <code>{{ p.shape.sourceSha256 }}</code>
      </p>
      <p v-if="p.shape.type === 'library' && !s.cadParts" class="warning">
        {{
          s.t(
            "源边界包络仅供概念定位；精确源 STEP 需原生 CAD 生成，不缩放、不重设原点。",
            "Source bounds are a concept envelope only. Exact source STEP requires native CAD; no scaling or origin reset.",
          )
        }}
      </p>
      <dl class="property-grid">
        <dt>{{ s.t("材料", "Material") }}</dt>
        <dd>{{ p.material }}</dd>
        <dt>{{ s.t("几何", "Geometry") }}</dt>
        <dd>{{ dimensions }}</dd>
        <dt>{{ s.t("位置", "Position") }}</dt>
        <dd>{{ p.position.join(", ") }} mm</dd>
        <dt>{{ s.t("旋转", "Rotation") }}</dt>
        <dd>{{ p.rotation.join(", ") }}°</dd>
      </dl>
      <p class="hint">
        {{
          s.t(
            "通过底部 AI 提出修改，预览差异后确认。不直接编辑数值。",
            "Request changes through AI below; review the diff before confirming. No direct numeric edits.",
          )
        }}
      </p>
      <p v-if="p.shape.type === 'catalog'" class="warning">
        {{
          s.t(
            "源模型比例固定；实际配合仍需核查。",
            "Source geometry has fixed scale; physical fit remains unverified.",
          )
        }}
      </p>
      <a
        v-for="(url, i) in sources"
        :key="url"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        >{{ s.t("组件来源", "Component source") }} {{ i + 1 }} ↗</a
      >
    </div>
    <div v-else class="empty-small">
      <Box :size="24" />
      <p>
        {{
          s.t(
            "选择模型或大纲中的零件，查看它的角色和设计依据。",
            "Select a part in the model or outliner to inspect its role and rationale.",
          )
        }}
      </p>
    </div>
  </section>
</template>
