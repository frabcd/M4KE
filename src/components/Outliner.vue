<script setup lang="ts">
import { computed, ref } from "vue";
import { Box, ChevronDown, Eye, EyeOff, Search, Cable } from "@lucide/vue";
import { useStudio } from "../studio/store";
const s = useStudio(),
  query = ref("");
const groups = computed(() => [
  {
    key: "printed",
    title: s.t("打印件", "Printed"),
    parts: (s.displaySpec?.parts || []).filter((p) => p.kind === "printed"),
  },
  {
    key: "purchased",
    title: s.t("采购件", "Purchased"),
    parts: (s.displaySpec?.parts || []).filter((p) => p.kind === "purchased"),
  },
]);
const matches = (name: string, id: string) =>
  (name + " " + id).toLowerCase().includes(query.value.toLowerCase());
function toggle(id: string) {
  s.visibility(
    s.view.hiddenPartIds.includes(id)
      ? s.view.hiddenPartIds.filter((x) => x !== id)
      : [...s.view.hiddenPartIds, id],
  );
}
</script>
<template>
  <section class="outliner" aria-labelledby="outliner-title">
    <header class="panel-heading">
      <Box :size="15" />
      <h2 id="outliner-title">{{ s.t("大纲", "Outliner") }}</h2>
      <span>{{ s.displaySpec?.parts.length || 0 }}</span>
    </header>
    <label class="search-field"
      ><Search :size="14" /><input
        v-model="query"
        :aria-label="s.t('搜索零件', 'Search parts')"
        :placeholder="s.t('搜索名称或 ID…', 'Search name or ID…')"
    /></label>
    <div class="outliner-tree">
      <details v-for="group in groups" :key="group.key" open>
        <summary>
          <ChevronDown :size="13" />{{ group.title
          }}<small>{{ group.parts.length }}</small>
        </summary>
        <div
          v-for="part in group.parts.filter((p) => matches(p.name, p.id))"
          :key="part.id"
          class="tree-row"
          :data-part-id="part.id"
          :class="{
            selected: s.view.selectedPartIds.includes(part.id),
            muted: s.view.hiddenPartIds.includes(part.id),
          }"
        >
          <button
            class="tree-select"
            :aria-pressed="s.view.selectedPartIds.includes(part.id)"
            @click="
              s.pickPart(
                part.id,
                $event.shiftKey || $event.ctrlKey || $event.metaKey,
              )
            "
          >
            <i :style="{ background: part.color }" /><span>{{
              part.name
            }}</span></button
          ><button
            class="icon-button"
            :data-visibility-id="part.id"
            :aria-label="
              (s.view.hiddenPartIds.includes(part.id)
                ? s.t('显示 ', 'Show ')
                : s.t('隐藏 ', 'Hide ')) + part.name
            "
            :aria-pressed="!s.view.hiddenPartIds.includes(part.id)"
            @click="toggle(part.id)"
          >
            <EyeOff
              v-if="s.view.hiddenPartIds.includes(part.id)"
              :size="14"
            /><Eye v-else :size="14" />
          </button>
        </div>
      </details>
      <details v-if="s.electrical?.connections.length" open>
        <summary>
          <Cable :size="14" />{{ s.t("电气连接", "Electrical connections")
          }}<small>{{ s.electrical.connections.length }}</small>
        </summary>
        <button
          v-for="wire in s.electrical.connections.filter((w) =>
            matches(w.id, w.id),
          )"
          :key="wire.id"
          class="wire-row"
          :class="{ selected: s.selectedConnection === wire.id }"
          @click="
            s.pickWire(wire.id);
            s.view.viewMode = 'model';
          "
        >
          <i
            :style="{
              background: /^#[a-f0-9]{6}$/i.test(wire.color)
                ? wire.color
                : '#596b7c',
            }"
          />{{ wire.id }}
        </button>
      </details>
    </div>
    <footer>
      {{
        s.t(
          "Shift / Ctrl 点击多选 · 眼睛只影响视图",
          "Shift / Ctrl-click to select multiple · Eyes affect view only",
        )
      }}
    </footer>
  </section>
</template>
