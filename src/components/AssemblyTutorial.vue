<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {Play, Pause, RotateCcw, ChevronLeft, ChevronRight} from '@lucide/vue';
import {useStudio} from '../studio/store';
import {assemblyFrame} from '../viewport/assembly-playback.mjs';
const s = useStudio(), progress = ref(1), playing = ref(false), error = ref('');
const player = ref<HTMLElement>();
function showViewport() { player.value?.closest('.central-scroll')?.scrollTo({top:0,behavior:'auto'}); }
const reduced = ref(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
const steps = computed(() => s.spec?.assembly || []);
const index = computed(() => steps.value.findIndex(step => step.id === s.assemblyStepId));
const step = computed(() => steps.value[index.value]);
let animation = 0, started = 0;
function pause() { cancelAnimationFrame(animation); animation = 0; playing.value = false; }
function sync() {
  try {
    s.assemblyPlayback = s.spec && step.value ? assemblyFrame(steps.value, s.spec.parts, step.value.id, progress.value) : null;
    error.value = '';
  } catch (e) { error.value = (e as Error).message; s.assemblyPlayback = null; pause(); }
}
function tick(now: number) {
  progress.value = Math.min(1, (now - started) / 2400);
  if (progress.value < 1) animation = requestAnimationFrame(tick); else pause();
}
function play() {
  if (error.value || !step.value) return;
  showViewport();
  if (reduced.value) { progress.value = 1; return; }
  if (progress.value >= 1) progress.value = 0;
  started = performance.now() - progress.value * 2400;
  playing.value = true; animation = requestAnimationFrame(tick);
}
function replay() { pause(); progress.value = reduced.value ? 1 : 0; play(); }
function seek(event: Event) { pause(); progress.value = Number((event.target as HTMLInputElement).value) / 100; }
function change(offset: number) { const next = steps.value[index.value + offset]; if (next) s.assemblyStepId = next.id; }
function visibility() { if (document.hidden) pause(); }
function motion(event: MediaQueryListEvent) { reduced.value = event.matches; if (event.matches) { pause(); progress.value = 1; } }
watch(() => [s.assemblyStepId, s.project?.designHash, s.showCandidate], () => { pause(); progress.value = 1; sync(); }, {immediate:true});
watch(progress, sync, {flush:'sync'});
onMounted(() => { document.addEventListener('visibilitychange', visibility); preference.addEventListener('change', motion); void nextTick(showViewport); });
onBeforeUnmount(() => { pause(); s.assemblyPlayback = null; document.removeEventListener('visibilitychange', visibility); preference.removeEventListener('change', motion); });
</script>
<template>
  <div ref="player" class="assembly-player" data-testid="assembly-player" :data-playing="playing">
    <div class="assembly-player-heading"><span>{{s.t('3D 装配讲解', '3D ASSEMBLY WALKTHROUGH')}} · {{index + 1}}/{{steps.length}}</span><strong>{{step?.title}}</strong></div>
    <div class="assembly-player-controls">
      <button :disabled="index <= 0" :aria-label="s.t('上一步装配', 'Previous assembly step')" @click="change(-1)"><ChevronLeft :size="18" /></button>
      <button :disabled="!!error || reduced" :aria-label="playing ? s.t('暂停装配动画', 'Pause assembly animation') : s.t('播放装配动画', 'Play assembly animation')" @click="playing ? pause() : play()"><Pause v-if="playing" :size="18" /><Play v-else :size="18" /></button>
      <button :disabled="!!error || reduced" :aria-label="s.t('重播本步骤', 'Replay this step')" @click="replay"><RotateCcw :size="16" /></button>
      <input type="range" min="0" max="100" :value="Math.round(progress * 100)" :disabled="!!error || reduced" :aria-label="s.t('装配动画位置', 'Assembly animation position')" @input="seek" />
      <button :disabled="index >= steps.length - 1" :aria-label="s.t('下一步装配', 'Next assembly step')" @click="change(1)"><ChevronRight :size="18" /></button>
    </div>
    <small v-if="error" role="alert">{{error}}</small>
    <small v-else>{{reduced ? s.t('减少动态已开启；用上/下一步查看。', 'Reduced motion enabled; use previous/next.') : s.t('示意移入动画，不是已验证的插入路径；播放不会勾选检查表。', 'Illustrative movement, not a verified insertion path. Playback never ticks checks.')}}</small>
  </div>
</template>
<style scoped>
.assembly-player{position:absolute;z-index:3;bottom:66px;left:50%;transform:translateX(-50%);width:min(490px,calc(100% - 28px));padding:12px 16px;border:1px solid #8aa5cc40;border-radius:16px;background:#0d1525f5;box-shadow:0 14px 40px #0005;backdrop-filter:blur(16px)}
.assembly-player-heading{display:flex;gap:8px;flex-direction:column}.assembly-player-heading span{color:#95b8e8;font-size:10px;letter-spacing:.07em}.assembly-player-heading strong{color:#eff5ff;font-size:14px;font-weight:550}.assembly-player-controls{display:flex;align-items:center;gap:8px;margin:8px 0}.assembly-player-controls input{flex:1;min-width:40px;accent-color:#91baff;cursor:pointer}.assembly-player small{display:block;color:#a4b0c3;font-size:10px;line-height:1.5}
@media(prefers-reduced-transparency:reduce){.assembly-player{backdrop-filter:none;background:#0d1525}}
</style>
