<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount, useId } from "vue";
import { X } from "@lucide/vue";
const props = defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
let trigger: HTMLElement | null = null;
watch(
  () => props.open,
  async (value) => {
    await nextTick();
    if (value) {
      trigger = document.activeElement as HTMLElement;
      dialog.value?.showModal();
    } else {
      dialog.value?.close();
      trigger?.focus();
    }
  },
  { immediate: true },
);
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab" || !dialog.value) return;
  const items = [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.getClientRects().length > 0);
  const first = items[0],
    last = items.at(-1),
    active = document.activeElement;
  if (!first || !last) {
    event.preventDefault();
    dialog.value.focus();
    return;
  }
  if (
    event.shiftKey &&
    (active === first ||
      active === dialog.value ||
      !dialog.value.contains(active))
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (active === last ||
      active === dialog.value ||
      !dialog.value.contains(active))
  ) {
    event.preventDefault();
    first.focus();
  }
}
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <dialog
    ref="dialog"
    class="studio-dialog"
    @keydown="trapTab"
    :aria-labelledby="titleId"
    @cancel.prevent="emit('close')"
    @click="
      (e) => {
        if (e.target === dialog) emit('close');
      }
    "
  >
    <header>
      <h2 :id="titleId">{{ title }}</h2>
      <button
        class="icon-button"
        aria-label="Close / 关闭"
        @click="emit('close')"
      >
        <X :size="19" />
      </button>
    </header>
    <div class="dialog-content"><slot /></div>
  </dialog>
</template>
