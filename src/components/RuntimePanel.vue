<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStudio } from "../studio/store";
import { api, send, readable } from "../studio/api";
const s = useStudio(),
  provider = ref<"ollama" | "vllm" | "codex-bridge">("ollama"),
  endpoint = ref(""),
  model = ref(""),
  models = ref<{ name: string; size?:number; parameterSize?:string; family?:string; quantization?:string; digest?:string }[]>([]),
  busy = ref(false),
  error = ref(""),
  notice = ref(""),
  saved = ref<{ endpoint: string; model: string; provider: "ollama" | "vllm" | "codex-bridge" }>(),
  inventory = ref<unknown>();
const connectionChanged = computed(() => !!saved.value &&
  (endpoint.value !== saved.value.endpoint || provider.value !== saved.value.provider));
const hasChanges = computed(() => !!saved.value && (connectionChanged.value || model.value !== saved.value.model));
function changeProvider() {
  models.value = [];
  // A provider switch must not pair the Codex protocol with the old vLLM URL.
  if (provider.value === 'codex-bridge') {
    endpoint.value = 'http://127.0.0.1:4181';
    model.value = 'codex-gpt-6-sol';
  } else if (saved.value?.provider === provider.value) {
    endpoint.value = saved.value.endpoint;
    model.value = saved.value.model;
  } else {
    endpoint.value = '';
    model.value = '';
  }
}
async function load() {
  try {
    const settings = await api<{ endpoint: string; model: string; provider?: "ollama" | "vllm" | "codex-bridge" }>(
      "/api/settings",
    );
    endpoint.value = settings.endpoint;
    model.value = settings.model;
    provider.value = settings.provider || "ollama";
    saved.value = { ...settings, provider: provider.value };
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function save() {
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await send<{ endpoint: string; model: string; provider: "ollama" | "vllm" | "codex-bridge" }>("/api/settings", {
      endpoint: endpoint.value,
      model: model.value,
      provider: provider.value,
    });
    if (connectionChanged.value) models.value = [];
    saved.value = result;
    endpoint.value = result.endpoint;
    model.value = result.model;
    provider.value = result.provider;
    notice.value = s.t(
      "已保存本地推理配置，不触发模型请求。",
      "Local inference settings saved; no inference triggered.",
    );
    await s.refreshCapabilities();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function discover() {
  if (!saved.value || connectionChanged.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result = await api<{ models: typeof models.value }>("/api/models");
    models.value = result.models;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(() => {
  void load().then(discover);
  void api("/api/studio/integrations")
    .then((x) => (inventory.value = x))
    .catch((e) => (error.value = e.message));
});
</script>
<template>
  <section>
    <div class="runtime-current" aria-live="polite">
      <small>{{ s.t("当前保存的连接", "Saved connection") }}</small>
      <strong>{{ saved?.model || s.t("尚未配置模型", "No model configured") }}</strong>
      <span>{{ saved?.provider === 'codex-bridge' ? 'Codex · '+s.t('需要本机在线','requires this PC online') : (saved?.provider === 'vllm' ? 'vLLM' : 'Ollama')+' · '+s.t('仅 DGX 本地','DGX-local only') }}</span>
      <span v-if="hasChanges" class="runtime-unsaved">{{ s.t("修改尚未保存，当前模型没有切换", "Unsaved changes — the active model has not changed") }}</span>
    </div>
    <p v-if="provider!=='codex-bridge'" class="runtime-description">
      {{
        s.t(
          "只使用 DGX 本地模型；不会配置或调用云端模型回退。浏览器只连接同源后端。",
          "Only the DGX-local model is used. No cloud-model fallback. The browser calls the same-origin backend only.",
        )
      }}
    </p>
    <div v-if="models.length && !connectionChanged" class="model-choices" :aria-label="s.t('DGX 已安装模型','Installed DGX models')">
      <button v-for="item in models" :key="item.name" type="button" class="model-choice" :aria-pressed="model===item.name" :disabled="busy || s.working" @click="model=item.name;notice=s.t('已选择，点击保存后生效。不下载或删除模型。','Selected. Save to apply. No model is downloaded or deleted.')">
        <strong>{{item.name}}</strong><small>{{[item.parameterSize,item.family,item.quantization,item.size?`${(item.size/1e9).toFixed(1)} GB`:null].filter(Boolean).join(' · ')}}</small>
        <small v-if="item.digest">SHA {{item.digest.slice(0,12)}}</small>
      </button>
    </div>
    <form @submit.prevent="save" class="form-stack">
      <label>{{ s.t("DGX 推理服务", "DGX inference service") }}
        <select v-model="provider" :aria-label="s.t('DGX 推理服务', 'DGX inference service')" :disabled="busy || s.working" @change="changeProvider">
          <option value="ollama">Ollama</option>
          <option value="codex-bridge">Codex · {{ s.t("已登录账号在线演示（需显式启动桥接）", "signed-in online demo (explicit bridge required)") }}</option>
          <option value="vllm">vLLM · {{ s.t("本地 OpenAI 兼容协议", "local OpenAI-compatible protocol") }}</option>
        </select>
      </label>
      <p v-if="provider==='codex-bridge'" class="runtime-description">{{ s.t("仅当前演示：通过 SSH 连接本机已登录 Codex。需求和相关设计数据将发送给 Codex 在线服务；DGX 保留 CAD 与项目。不是离线模式，失败不回退 Qwen。", "Explicit demo only: SSH bridge to the signed-in Codex on this PC. Prompts and relevant design data are sent to the online Codex service; CAD and projects remain on DGX. Not offline. No Qwen fallback.") }}</p>
      <p v-if="provider==='vllm'" class="runtime-description">{{ s.t("连接已经启动的本地 vLLM，不调用 OpenAI 云端，也不自动启动容器或下载模型。请使用服务的精确模型 ID；模型速度不代表设计已通过。", "Connect an already-running local vLLM service, not OpenAI's cloud. No container starts or model downloads. Use the exact served model ID; speed is not design validation.") }}</p>
      <label
        >{{ s.t("本地服务地址", "Local service endpoint") }}<input
          v-model="endpoint"
          :aria-label="s.t('本地服务地址', 'Local service endpoint')"
          :disabled="busy || s.working"
          :placeholder="provider==='ollama'?'http://127.0.0.1:11434':'http://127.0.0.1:8000'"
          autocomplete="off" /></label
      ><label
        >{{ s.t("精确模型名", "Exact model name")
        }}<input
          v-model="model"
          :aria-label="s.t('精确模型名', 'Exact model name')"
          :disabled="busy || s.working"
          list="local-models"
          placeholder="Enter installed model tag" /><datalist id="local-models">
          <option v-for="m in models" :key="m.name" :value="m.name" /></datalist
      ></label>
      <div class="toolbar">
        <button class="primary" :disabled="busy || s.working">
          {{ s.t("保存配置", "Save settings") }}</button
        ><button type="button" :disabled="busy || connectionChanged || !saved" @click="discover">
          {{ s.t("查询已保存地址的模型", "List models at saved endpoint") }}
        </button>
      </div>
      <p v-if="connectionChanged" class="boundary">{{ s.t("服务类型或地址已修改。先保存连接，再查询该服务的模型；不会混入旧服务的列表。", "Save the new service connection before listing its models. The old service's inventory is not reused.") }}</p>
    </form>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <dl>
      <dt>CAD</dt>
      <dd>
        {{
          s.cap?.cad?.available
            ? s.t("原生 CAD 可用", "Native CAD available")
            : s.cap?.cad?.reason || "UNKNOWN"
        }}
      </dd>
      <dt>{{ s.t("模型", "Model") }}</dt>
      <dd>
        {{
          typeof s.cap?.model === "string"
            ? s.cap.model
            : s.cap?.model?.name || "Not configured"
        }}
      </dd>
    </dl>
    <details>
      <summary>
        {{
          s.t("团队技能与本地 MCP 能力", "Team skills & local MCP capabilities")
        }}
      </summary>
      <p>
        {{
          s.t(
            "供应商适配器仅支持本地缓存搜索与报价，不表示实时价格或 PCB 编辑器可用。",
            "The supplier adapter exposes offline cached search and quotes, not live pricing or PCB authoring.",
          )
        }}
      </p>
      <pre>{{ readable(inventory) }}</pre>
    </details>
    <details>
      <summary>{{ s.t("已加载技能", "Loaded skills") }}</summary>
      <pre>{{ readable(s.cap?.skills) }}</pre>
    </details>
  </section>
</template>
<style scoped>
.runtime-current { display: grid; gap: 6px; padding: 16px 18px; margin-bottom: 16px; border: 1px solid #ffffff1a; border-radius: 14px; background: #ffffff06; }
.runtime-current small, .runtime-current span { font-size: 12px; color: var(--muted, #b0bac9); }
.runtime-current strong { font-size: 16px; overflow-wrap: anywhere; }
.runtime-current .runtime-unsaved { color: #f0c58f; }
.runtime-description { color: var(--muted, #b0bac9); font-size: 13px; line-height: 1.65; margin: 10px 0 16px; }
</style>
