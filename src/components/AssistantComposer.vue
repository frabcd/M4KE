<script setup lang="ts">
import { ref, computed, nextTick, watch, onUnmounted } from "vue";
import { ArrowUp, ChevronDown, MessageSquare, X, Sparkles } from "@lucide/vue";
import { useStudio } from "../studio/store";
import type { Conversation } from "../studio/types";
const props = defineProps<{brief?: boolean}>();
const s = useStudio(),
  message = ref(""),
  mode = ref<"ask" | "propose">("ask"),
  expanded = ref(true),
  history = ref<HTMLElement>();
type EditReply = {request: string; revision: number; designHash: string | null; selectedPartIds: string[]};
const pendingEdit = ref<EditReply | null>(null);
const latestEditReply = computed(() => [...s.conversation].reverse().find(entry => entry.role === "assistant" && entry.mode === "propose"));
function currentContext(reply: EditReply) {
  return reply.revision === s.project?.revision && reply.designHash === s.project?.designHash &&
    JSON.stringify([...reply.selectedPartIds].sort()) === JSON.stringify([...s.view.selectedPartIds].sort());
}
function questionRequest(entry: Conversation) {
  const index = s.conversation.findIndex(item => item.id === entry.id);
  const request = s.conversation[index - 1];
  return request?.role === "user" && request.mode === entry.mode && request.revision === entry.revision && request.designHash === entry.designHash ? request : null;
}
function canAnswer(entry: Conversation) {
  if (entry.revision !== s.project?.revision || entry.designHash !== (s.project?.designHash || null)) return false;
  return entry.mode !== "propose" || (!s.showCandidate && entry.id === latestEditReply.value?.id && !!questionRequest(entry));
}
const pending = ref<{mode: "ask" | "propose"; started: number; revision: number; names: string[]} | null>(null);
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
function clearPending() { if (timer) clearInterval(timer); timer = undefined; pending.value = null; }
onUnmounted(clearPending);
const followLatest = ref(true), unread = ref(false);
function trackScroll() {
  const el = history.value;
  if (!el) return;
  followLatest.value = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  if (followLatest.value) unread.value = false;
}
async function latest() {
  followLatest.value = true;
  unread.value = false;
  await nextTick();
  history.value?.scrollTo({ top: history.value.scrollHeight, behavior: "instant" });
}
watch(() => [s.conversation.length, s.working, s.error, expanded.value], async () => {
  if (followLatest.value) await latest();
  else unread.value = true;
});
watch(() => s.project?.id, () => { message.value = ""; pendingEdit.value = null; clearPending(); followLatest.value = true; unread.value = false; });
watch(() => [s.project?.revision, s.project?.designHash, ...s.view.selectedPartIds], () => {
  if (pendingEdit.value && !currentContext(pendingEdit.value)) pendingEdit.value = null;
}, {flush: "sync"});
watch(() => s.showCandidate, (shown) => { if (shown) mode.value = "ask"; });
function answer(entry: Conversation, question: string, option: string) {
  if (!canAnswer(entry) || s.working) return;
  if (entry.mode === "propose") {
    const request = questionRequest(entry);
    if (!request) return;
    mode.value = "propose";
    s.select({ids: [...entry.selectedPartIds], activeId: entry.selectedPartIds.at(-1) || null});
    pendingEdit.value = {request: request.message, revision: entry.revision, designHash: entry.designHash, selectedPartIds: [...entry.selectedPartIds]};
  }
  message.value = `${question}: ${option}`;
  document.getElementById("studio-composer")?.focus();
}
function removeContext(id: string) {
  const ids = s.view.selectedPartIds.filter((x) => x !== id);
  s.select({
    ids,
    activeId:
      s.view.activePartId === id ? ids.at(-1) || null : s.view.activePartId,
  });
}
const selected = computed(
  () =>
    props.brief ? [] : s.displaySpec?.parts.filter((p) => s.view.selectedPartIds.includes(p.id)) || [],
);
async function submit() {
  if (!message.value.trim() || s.working || (s.showCandidate && mode.value !== "ask")) return;
  const text = message.value.trim();
  const projectId = s.project?.id, sentMode = mode.value;
  expanded.value = true;
  followLatest.value = true;
  const request = mode.value === "propose" && pendingEdit.value && currentContext(pendingEdit.value)
    ? `${pendingEdit.value.request}\nClarification answer:\n${text}` : text;
  if (request.length > 4000) { s.error = s.t("补充后消息过长，请缩短回答。", "Please shorten the clarification reply."); return; }
  pending.value = {mode: sentMode, started: Date.now(), revision: s.project?.revision || 0, names: selected.value.map(p => p.name)};
  elapsed.value = 0;
  timer = setInterval(() => { if (pending.value) elapsed.value = Math.floor((Date.now() - pending.value.started) / 1000); }, 1000);
  // Clear the sent text immediately, but allow drafting the next message while
  // the frozen request runs. A reply must never erase this new draft.
  message.value = "";
  try { await s.assistant(sentMode, request, props.brief); }
  finally { clearPending(); }
  if (s.project?.id !== projectId) return;
  if (!s.error && sentMode === "propose") {
    const reply = s.conversation.at(-1);
    const continuation = reply?.questions?.length ? {request, revision: reply.revision, designHash: reply.designHash, selectedPartIds: [...reply.selectedPartIds]} : null;
    pendingEdit.value = continuation && currentContext(continuation) ? continuation : null;
  }
  if (s.error && !message.value.trim()) message.value = text;
  if (followLatest.value) await latest();
}
</script>
<template>
  <section class="assistant-composer" :class="{'brief-conversation': brief}" :aria-label="s.t('AI 设计助手', 'AI design assistant')">
    <header>
      <button
        class="plain"
        @click="expanded = !expanded"
        :aria-expanded="expanded"
      >
        <Sparkles :size="15" /><strong>AI</strong
        ><span>{{ brief ? s.t("先聊清楚，再开始设计", "Talk it through before designing") : s.t("设计助手", "Design assistant") }}</span
        ><ChevronDown :size="14" /></button
      ><span class="hint">{{
        s.t(
          "询问不修改 · 候选需确认",
          "Ask is read-only · Changes require confirmation",
        )
      }}</span>
    </header>
    <div v-if="expanded" ref="history" class="conversation" aria-live="polite" @scroll="trackScroll">
      <p v-if="!s.conversation.length" class="assistant-welcome">
        {{
          s.t(
            brief ? "不知道该补充什么？直接问 AI。它会根据已保存的需求回答，不会偷偷开始生成。最近 40 轮成功对话保存在 DGX。" : "和 AI 一起细化设计：询问原因，或描述想改的地方。它需要的信息会出现在这里，改动由你确认。",
            brief ? "Not sure what to add? Ask AI about your saved brief. This will not start generation. The last 40 completed turns stay on the DGX." : "Refine with AI. Ask why, or describe a change. Questions and replies appear here; you confirm every edit.",
          )
        }}
      </p>
      <article
        v-for="entry in s.conversation"
        :key="entry.id"
        :class="entry.role"
      >
        <small
          :title="entry.role === 'assistant' ? entry.model || undefined : undefined"
          >{{ entry.role === "user" ? s.t("你", "You") : 'AI' }} · R{{
            entry.revision
          }}
          ·
          {{
            entry.mode === "ask"
              ? s.t("询问", "Ask")
              : s.t("候选修改", "Propose")
          }}<span v-if="entry.basis === 'candidate'"> · {{ s.t('候选讨论 · 未应用', 'Candidate discussion · not applied') }}</span><span v-if="entry.selectedPartIds.length">
            · {{ entry.selectedPartIds.join(", ") }}</span
          ></small
        >
        <p>{{ entry.message }}</p>
        <div v-for="question in entry.questions || []" :key="question.id" class="assistant-question">
          <strong>{{ question.question }}</strong>
          <div class="assistant-choices">
            <button v-for="option in question.options || []" :key="option" type="button" :disabled="s.working || !canAnswer(entry)" @click="answer(entry, question.question, option)">{{ option }}</button>
          </div>
        </div>
        <p v-if="entry.questions?.length" class="clarification-boundary">{{ canAnswer(entry) ? s.t("待确认建议，尚未验证兼容性。选择答案会恢复这次修改的零件上下文；发送后才继续。", "Unverified options. Choosing an answer restores this edit's part context; send it to continue.") : s.t("历史追问：版本已改变或这次修改已结束。请提出新的修改，不会重复应用旧答案。", "Historical question: its version changed or the edit ended. Start a new edit; old answers cannot be reapplied.") }}</p>
      </article>
      <div v-if="pending" class="assistant-pending" role="status" data-testid="ai-pending">
        <div class="assistant-pending-title"><Sparkles :size="14" /><strong>{{ pending.mode === 'ask' ? s.t('AI 正在回复', 'AI is replying') : s.t('AI 正在修改并检查', 'AI is editing and checking') }}</strong><span aria-hidden="true">{{ elapsed }}s</span></div>
        <p>{{ pending.mode === 'ask' ? s.t('只读问答，不更改模型。', 'Read-only conversation; the model stays unchanged.') : s.t('正在准备候选并检查几何；发现问题会先尝试修复。通过后再由你确认，当前设计不变。', 'Preparing and checking the candidate, with a bounded repair if needed. You confirm after checks; your current design stays unchanged.') }}</p>
        <small>R{{ pending.revision }} · {{ pending.names.length ? pending.names.join(' · ') : s.t('当前项目', 'Current project') }}</small>
      </div>
      <p v-if="s.error" class="assistant-request-error" role="status">{{ s.t("请求未完成：", "Request did not complete: ") }}{{ s.error }}</p>
    </div>
    <button v-if="expanded && unread" type="button" class="latest-reply" @click="latest"><ChevronDown :size="13" />{{ s.t("查看最新消息", "Latest message") }}</button>
    <p v-if="s.showCandidate" class="clarification-boundary" data-testid="candidate-discussion">{{ s.t('正在讨论候选预览：可以问为什么这样改；尚未应用。数字检查见候选记录，实物性能尚待测试。', 'Discussing the preview: ask why it changed. Not applied. Digital checks belong to this candidate; physical performance remains untested.') }}</p>
    <div v-if="pendingEdit && mode === 'propose'" class="edit-continuation" data-testid="edit-continuation">
      <div><strong>{{ s.t('继续补充这次修改', 'Continue this edit') }}</strong><p :title="pendingEdit.request">{{ pendingEdit.request }}</p></div>
      <button type="button" :disabled="s.working" @click="pendingEdit = null">{{ s.t('开始新修改', 'Start a new edit') }}</button>
    </div>
    <div v-if="selected.length" class="context-chips">
      <span class="hint">{{ s.t("选中上下文", "Selection context") }}</span
      ><button
        v-for="part in selected"
        :key="part.id"
        :data-context-id="part.id"
        @click="removeContext(part.id)"
      >
        {{ part.name }}<X :size="11" />
      </button>
    </div>
    <form @submit.prevent="submit">
      <select
        v-if="!brief"
        data-testid="ai-mode"
        v-model="mode"
        :aria-label="s.t('AI 操作模式', 'AI action mode')"
        :disabled="s.working"
      >
        <option value="ask">{{ s.t("询问", "Ask") }}</option>
        <option value="propose" :disabled="s.showCandidate">
          {{ s.t("微调", "Propose edit") }}
        </option></select
      ><textarea
        id="studio-composer"
        data-testid="ai-input"
        v-model="message"
        rows="1"
        maxlength="4000"
        :disabled="
          (!brief && (s.dirty || s.project?.requiresDesignUpdate)) ||
          !s.project ||
          (!brief && !s.spec?.parts.length)
        "
        :placeholder="
          pending ? s.t('可以先写下一条；当前请求完成后再发送…', 'Draft your next message while this request finishes…') : brief ? s.t('例如：这个需求还缺什么？60 分贝需要怎样校准？', 'What is missing? How should 60 dB be calibrated?') : mode === 'ask'
            ? s.t(
                '为什么这样设计？选中零件后问得更具体…',
                'Why this design? Select parts to ask specifically…',
              )
            : s.t(
                '描述你想调整的细节，先生成候选，不立即覆盖…',
                'Describe a change. Preview a candidate before applying…',
              )
        "
        :aria-label="
          s.t('询问 AI 或提出修改', 'Ask AI or propose a change')
        "
        @keydown.ctrl.enter.prevent="submit"
        @keydown.meta.enter.prevent="submit"
      /><button
        class="primary icon-button"
        data-testid="ai-send"
        type="submit"
        :disabled="
          !message.trim() ||
          s.working ||
          (s.showCandidate && mode !== 'ask') ||
          (!brief && (s.dirty || s.project?.requiresDesignUpdate)) ||
          !s.project ||
          (!brief && !s.spec?.parts.length)
        "
        :aria-label="s.t('发送给 AI', 'Send to AI')"
      >
        <ArrowUp :size="18" />
      </button>
    </form>
    <p v-if="pending" class="hint">
      {{
        s.t(
          "选中上下文已冻结 · 可继续写草稿，不会重复发送",
          "Selection context is frozen · Drafting is available; duplicate sending is disabled",
        )
      }}
    </p>
  </section>
</template>
