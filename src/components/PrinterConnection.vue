<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStudio } from "../studio/store";
import { api } from "../studio/api";
const props = defineProps<{ model: string }>(),
  s = useStudio();
type Certificate = {
  fingerprint: string;
  serialMatches: boolean;
  dateValid: boolean;
};
type Receipt = {
  status: string;
  model: string;
  ip: string;
  serial: string;
  physicalValidation: string;
  readOnly: boolean;
  printSent: boolean;
  uploadSent: boolean;
  connectionClosed: boolean;
  authenticated: boolean;
  subscribed: boolean;
  certificate: Certificate;
  checkedAt: string;
  reportRetained?: boolean;
  report?: { state?: string; mc_percent?: number };
};
const ip = ref(""),
  serial = ref(""),
  code = ref(""),
  trusted = ref(false),
  certificate = ref<Certificate | null>(null),
  receipt = ref<Receipt | null>(null),
  busy = ref(false),
  error = ref("");
let epoch = 0,
  controller: AbortController | undefined;
watch(
  () => props.model,
  () => {
    epoch++;
    controller?.abort();
    certificate.value = null;
    receipt.value = null;
    trusted.value = false;
    code.value = "";
    error.value = "";
    busy.value = false;
  },
);
onBeforeUnmount(() => {
  epoch++;
  controller?.abort();
  code.value = "";
});
function changed() {
  certificate.value = null;
  receipt.value = null;
  trusted.value = false;
  code.value = "";
  error.value = "";
}
const supported = computed(() =>
  ["bambu-h2c", "bambu-a1", "bambu-a1-mini", "bambu-p1s", "bambu-x1c"].includes(
    props.model,
  ),
);
const canInspect = computed(
  () =>
    supported.value && ip.value.trim() && serial.value.trim() && !busy.value,
);
const canCheck = computed(
  () =>
    canInspect.value &&
    certificate.value?.serialMatches &&
    certificate.value.dateValid &&
    trusted.value &&
    code.value,
);
async function perform(mode: "inspect" | "check") {
  const token = ++epoch;
  controller = new AbortController();
  busy.value = true;
  error.value = "";
  receipt.value = null;
  const data = {
    model: props.model,
    ip: ip.value.trim(),
    serial: serial.value.trim(),
    ...(mode === "check"
      ? {
          fingerprint: certificate.value?.fingerprint,
          trustConfirmed: trusted.value,
          accessCode: code.value,
        }
      : {}),
  };
  code.value = "";
  if (mode === "inspect") {
    certificate.value = null;
    trusted.value = false;
  }
  try {
    const result = await api<Receipt>("/api/studio/printer/" + mode, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal,
    });
    if (
      result.model !== data.model ||
      result.ip !== data.ip ||
      result.serial !== data.serial ||
      result.physicalValidation !== "UNKNOWN" ||
      result.readOnly !== true ||
      result.printSent !== false ||
      result.uploadSent !== false ||
      result.connectionClosed !== true ||
      !/^[a-f0-9]{64}$/.test(result.certificate?.fingerprint)
    )
      throw Error("Printer response violates target/read-only boundary.");
    if (
      mode === "inspect" &&
      (result.status !== "CERTIFICATE_OBSERVED_NOT_TRUSTED" ||
        result.authenticated !== false ||
        result.subscribed !== false)
    )
      throw Error("Invalid unauthenticated certificate observation.");
    if (
      mode === "check" &&
      (!["READ_ONLY_REPORT_RECEIVED", "SUBSCRIBED_NO_REPORT"].includes(
        result.status,
      ) ||
        !result.authenticated ||
        !result.subscribed ||
        !result.certificate.serialMatches ||
        !result.certificate.dateValid ||
        result.certificate.fingerprint !== data.fingerprint)
    )
      throw Error(
        "Printer authentication or pinned certificate was not confirmed.",
      );
    if (token === epoch) {
      certificate.value = result.certificate;
      receipt.value = result;
    }
  } catch (e) {
    if (token === epoch) error.value = (e as Error).message;
  } finally {
    if ("accessCode" in data) data.accessCode = "";
    if (token === epoch) busy.value = false;
  }
}
</script>
<template>
  <details class="printer-connection">
    <summary>
      {{
        s.t(
          "实际打印机：只读 LAN 检查",
          "Physical printer: read-only LAN check",
        )
      }}
    </summary>
    <p>
      {{
        s.t(
          "从 DGX 所在局域网访问选定打印机。不上传、不加热、不移动、不打印。切片预设不能证明实物兼容性。",
          "Reach the selected printer from the DGX LAN. No upload, heat, movement or printing. A slicer preset does not establish physical compatibility.",
        )
      }}
    </p>
    <p v-if="!supported" class="warning">
      {{
        s.t(
          "先选择受支持的 Bambu 机型；H2C 不自动选择。",
          "Choose a supported Bambu model first; H2C is not selected automatically.",
        )
      }}
    </p>
    <div class="fields-row">
      <label
        >{{ s.t("打印机内网 IPv4", "Printer private IPv4")
        }}<input
          v-model="ip"
          :disabled="busy"
          maxlength="15"
          autocomplete="off"
          @input="changed" /></label
      ><label
        >{{ s.t("实物序列号", "Physical serial")
        }}<input
          v-model="serial"
          :disabled="busy"
          maxlength="40"
          autocomplete="off"
          @input="changed"
      /></label>
    </div>
    <button :disabled="!canInspect" @click="perform('inspect')">
      {{
        s.t("检查证书 · 不发送访问码", "Inspect certificate · no access code")
      }}
    </button>
    <div v-if="certificate" class="card">
      <h4>
        {{
          s.t(
            "证书已观察，尚未自动信任",
            "Certificate observed, not automatically trusted",
          )
        }}
      </h4>
      <code>{{ certificate.fingerprint }}</code>
      <p>
        {{ s.t("序列号匹配", "Serial matches") }}:
        {{ certificate.serialMatches }} · {{ s.t("日期有效", "Dates valid") }}:
        {{ certificate.dateValid }}
      </p>
      <p class="warning">
        {{
          s.t(
            "首次使用信任不是制造商 CA 认证。请在可信 LAN 核对实物地址、序列号和证书。",
            "Trust-on-first-use is not manufacturer CA verification. Independently check the physical address, serial and certificate on a trusted LAN.",
          )
        }}
      </p>
      <label class="check-label"
        ><input
          type="checkbox"
          v-model="trusted"
          :disabled="
            busy || !certificate.serialMatches || !certificate.dateValid
          "
        />{{
          s.t(
            "我已核对实物并信任此证书",
            "I checked the physical device and trust this certificate",
          )
        }}</label
      ><label
        >{{
          s.t(
            "LAN 访问码（不是账号密码）",
            "LAN access code (not account password)",
          )
        }}<input
          type="password"
          v-model="code"
          :disabled="busy"
          maxlength="32"
          autocomplete="new-password" /></label
      ><button :disabled="!canCheck" @click="perform('check')">
        {{ s.t("读取一次状态 · 不打印", "Read status once · no print") }}
      </button>
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="receipt" role="status">
      {{ receipt.status }} · {{ receipt.report?.state || "UNKNOWN" }} ·
      {{ receipt.checkedAt }}.
      {{
        s.t(
          "连接已关闭，非实时监控。报告可能过时。",
          "Connection closed, not live monitoring. The report may be stale.",
        )
      }}
    </p>
    <small>{{
      s.t(
        "访问码只用于本次请求，不写浏览器存储、不送给模型，提交后立即清空。",
        "The access code is only used for this request, never stored or sent to the model, and cleared immediately on submission.",
      )
    }}</small>
  </details>
</template>
