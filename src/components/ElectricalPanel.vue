<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useStudio } from "../studio/store";
import { artifactUrl, readable } from "../studio/api";
import { electricalArtifactUrl, hasWireRoute } from "../studio/electrical.mjs";
import WireGuide from './WireGuide.vue';
const s = useStudio(),
  imageError = ref(false);
const labels: Record<string, string> = {
  netlist: "Netlist JSON",
  diagram: "Wiring diagram SVG",
  table: "Pin-to-pin table CSV",
  guide: "Electrical commissioning guide",
  firmwareConfig: "Firmware configuration",
};
const names = {
  netlist: "electrical/netlist.json",
  diagram: "electrical/wiring.svg",
  table: "electrical/connections.csv",
  guide: "electrical/README.md",
  firmwareConfig: "firmware/config.py",
};
const files = computed(() =>
  s.currentJob?.status === "complete"
    ? Object.entries(names).filter(([key]) =>
        electricalArtifactUrl(s.currentJob?.id, s.electrical, key),
      )
    : [],
);
const diagram = computed(() =>
  s.currentJob?.status === "complete"
    ? electricalArtifactUrl(s.currentJob.id, s.electrical, "diagram")
    : undefined,
);
watch(
  () => s.currentJob?.id,
  () => (imageError.value = false),
);
const partName = (id: string) =>
  s.spec?.parts.find((p) => p.id === id)?.name || id;
</script>
<template>
  <section
    class="electrical-panel"
    :data-electrical-hash="s.electrical?.designHash || ''"
  >
    <header class="section-heading">
      <div>
        <span class="eyebrow">{{
          s.t("同一设计版本的电路", "DESIGN-BOUND CIRCUIT")
        }}</span>
        <h2>{{ s.t("电气连接与固件", "Wiring & firmware") }}</h2>
      </div>
      <span class="status unknown">{{
        s.electrical?.status || "UNKNOWN"
      }}</span>
    </header>
    <p class="boundary">
      {{
        s.t(
          "装配时保持断电。3D 线路是建议路径，不是已测量的线束。",
          "Keep power disconnected during assembly. 3D wire routes are proposals, not measured harnesses.",
        )
      }}
    </p>
    <template v-if="s.electrical"
      ><p v-if="s.electrical.status === 'NOT_APPLICABLE'">
        {{
          s.t(
            "当前设计未声明电气连接。",
            "No electrical connections are declared for this design.",
          )
        }}
      </p>
      <WireGuide />
      <img
        v-if="diagram && !imageError"
        class="wiring-diagram"
        :src="diagram"
        :alt="
          s.t(
            '当前精确设计版本的引脚接线图',
            'Pin-to-pin wiring diagram for this exact design revision',
          )
        "
        @error="imageError = true"
      />
      <p v-if="!diagram">
        {{
          s.t(
            "当前任务尚无可用接线图产物。",
            "The wiring diagram artifact is not available for this job.",
          )
        }}
      </p>
      <p v-if="imageError" role="alert" class="error">
        {{
          s.t(
            "接线图加载失败，没有替代示意图。",
            "Wiring diagram failed to load; no substitute is shown.",
          )
        }}
      </p>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ s.t("线路", "Wire") }}</th>
              <th>{{ s.t("起点", "From") }}</th>
              <th>{{ s.t("终点", "To") }}</th>
              <th>{{ s.t("规格 / 状态", "Spec / status") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in s.electrical.connections"
              :key="c.id"
              :class="{ selected: s.selectedConnection === c.id }"
            >
              <td>
                <button
                  :aria-label="s.t('选择连接 ', 'Select connection ') + c.id"
                  :aria-pressed="s.selectedConnection === c.id"
                  @click="
                    s.pickWire(c.id);
                    s.view.viewMode = 'model';
                  "
                >
                  <i
                    :style="{
                      background: /^#[a-f0-9]{6}$/i.test(c.color)
                        ? c.color
                        : '#596b7c',
                    }"
                    class="color-dot"
                  />{{ c.id }}
                </button>
              </td>
              <td>{{ partName(c.from.partId) }} / {{ c.from.terminal }}</td>
              <td>{{ partName(c.to.partId) }} / {{ c.to.terminal }}</td>
              <td>
                {{ c.wireAwg || "UNKNOWN" }} AWG · {{ c.routingStatus
                }}<small v-if="!hasWireRoute(c)">{{
                  s.t(
                    "缺少端子坐标，不虚构 3D 路线。",
                    "Missing terminal coordinates; no invented 3D route.",
                  )
                }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="artifact-links">
        <a
          v-for="[key, path] in files"
          :key="key"
          :href="artifactUrl(s.currentJob!.id, path)"
          download
          >{{ labels[key] }} ↧</a
        >
      </div>
      <h3>
        {{ s.t("固件状态", "Firmware status") }} ·
        {{ s.electrical.firmware.status }}
      </h3>
      <p>{{ s.electrical.firmware.reason }}</p>
      <p v-if="s.electrical.firmware.status === 'GENERATED_OUTPUT_DISABLED'">
        {{
          s.t(
            "输出默认禁用，硬件映射与实物调试未核查前不得启用。",
            "Outputs start disabled. Confirm hardware mapping and perform unpowered commissioning before enabling motion.",
          )
        }}
      </p>
      <p class="warning">
        {{
          s.t(
            "未经过实物调试，生成固件不意味着电机输出可安全启用。",
            "Generated firmware is not physical commissioning or permission to energize motors.",
          )
        }}
      </p>
      <details v-if="s.electrical.firmware.pins">
        <summary>{{ s.t("引脚映射", "Pin mapping") }}</summary>
        <pre>{{ readable(s.electrical.firmware.pins) }}</pre>
      </details>
      <details v-for="c in s.electrical.components" :key="c.partId">
        <summary>{{ c.name }} · {{ c.profileId }}</summary>
        <p>{{ c.identityStatus }}</p>
        <ul>
          <li v-for="terminal in c.terminals" :key="terminal.id">
            {{ terminal.id }} — {{ terminal.role }}
          </li>
        </ul>
      </details>
      <details v-for="c in s.electrical.claims" :key="c.id">
        <summary>{{ c.status }} · {{ c.name }}</summary>
        <p>{{ c.method }}</p>
        <pre>{{ readable(c.actual) }}</pre>
        <p>{{ readable(c.notes) }}</p>
      </details></template
    >
    <p v-else>
      {{
        s.t(
          "当前草稿还没有与哈希匹配的电气证据。确认设计并运行验证后查看；不显示旧版线路。",
          "No hash-matched electrical evidence for this draft. Confirm and verify first; stale wiring is not shown.",
        )
      }}
    </p>
  </section>
</template>
