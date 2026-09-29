<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {Box, Cable, Expand, Eye, EyeOff, Focus, Move3D} from '@lucide/vue';
import {StudioViewportController} from '../viewport/controller';
import type {AssemblyFrame, CadPart, CatalogComponent, ElectricalConnection, LibrarySource, Projection, Selection, ToyPart, ViewDirection, ViewportStatus} from '../viewport/types';
import {hasWireRoute} from '../viewport/interaction.mjs';

const props = withDefaults(defineProps<{
  parts: ToyPart[];
  cadParts?: CadPart[];
  components?: CatalogComponent[];
  librarySources?: LibrarySource[];
  connections?: ElectricalConnection[];
  selectedIds: string[];
  activeId: string | null;
  hiddenIds: string[];
  highlightedIds?: string[];
  selectedConnection?: string | null;
  locale?: 'zh' | 'en';
  viewMode?: 'model' | 'wiring';
  projection?: Projection;
  assemblyPlayback?: AssemblyFrame | null;
}>(), {components: () => [], librarySources: () => [], connections: () => [], highlightedIds: () => [], selectedConnection: null, locale: 'zh', viewMode: 'model', projection: 'perspective'});
const emit = defineEmits<{
  select: [selection: Selection];
  visibility: [hiddenIds: string[]];
  selectConnection: [id: string | null];
  projection: [value: Projection];
}>();
const host = ref<HTMLDivElement>();
let controller: StudioViewportController | undefined;
const load = ref<ViewportStatus>({
  loaded: 0, total: 0, receivedBytes: 0, parseMs: 0, error: '', native: false,
  projection: 'perspective', direction: 'user', routed: 0, wiresVisible: false, exploded: false, showWires: true,
});
const t = (zh: string, en: string) => props.locale === 'en' ? en : zh;
const activeWire = computed(() => props.connections.find(c => c.id === props.selectedConnection));
const views: {id: ViewDirection; zh: string; en: string; shortcut: string}[] = [
  {id: 'front', zh: '前', en: 'Front', shortcut: 'Numpad 1'},
  {id: 'back', zh: '后', en: 'Back', shortcut: 'Ctrl + Numpad 1'},
  {id: 'right', zh: '右', en: 'Right', shortcut: 'Numpad 3'},
  {id: 'left', zh: '左', en: 'Left', shortcut: 'Ctrl + Numpad 3'},
  {id: 'top', zh: '顶', en: 'Top', shortcut: 'Numpad 7'},
  {id: 'bottom', zh: '底', en: 'Bottom', shortcut: 'Ctrl + Numpad 7'},
];
const viewLabel = computed(() => {
  const view = views.find(v => v.id === load.value.direction);
  return `${view ? t(view.zh, view.en) : t('用户', 'User')} · ${load.value.projection === 'perspective' ? t('透视', 'Perspective') : t('正交', 'Orthographic')}`;
});
const endpoint = (value: {partId: string; terminal: string}) => `${props.parts.find(p => p.id === value.partId)?.name || value.partId} · ${value.terminal}`;
const syncModel = () => controller?.setModel({parts: props.parts, cadParts: props.cadParts, components: props.components, connections: props.connections, librarySources: props.librarySources});
const syncDisplay = () => controller?.setDisplay({selectedIds: props.selectedIds, activeId: props.activeId,
  hiddenIds: props.hiddenIds, highlightedIds: props.highlightedIds, selectedConnection: props.selectedConnection});
const syncLabel = () => controller?.setLabel(t('3D 视口：点击选零件，Shift 多选，中键旋转，Shift 中键平移。聚焦此视口后可使用 Blender 导航快捷键。',
  '3D viewport: click to select, Shift click to multi-select, middle mouse to orbit, Shift middle mouse to pan. Blender navigation shortcuts work while focused.'));
const syncProjection = () => {
  if (controller && controller.getStatus().projection !== props.projection) controller.toggleProjection();
};
const run = (action: (value: StudioViewportController) => void) => {
  if (!controller) return;
  action(controller);
  controller.focus();
};
onMounted(() => {
  if (!host.value) return;
  try {
    controller = new StudioViewportController(host.value, {
      select: selection => emit('select', selection), visibility: ids => emit('visibility', ids),
      selectConnection: id => emit('selectConnection', id), status: status => {
        const changed = status.projection !== load.value.projection;
        load.value = status;
        if (changed && status.projection !== props.projection) emit('projection', status.projection);
      },
    });
    syncLabel();
    syncProjection();
    syncDisplay();
    syncModel();
    controller.setAssemblyFrame(props.assemblyPlayback || null);
  } catch (error) {
    load.value.error = `${t('WebGL 视口不可用；模型下载仍可使用。', 'WebGL viewport unavailable; model downloads remain available.')} ${error instanceof Error ? error.message : String(error)}`;
  }
});
watch(() => [props.parts, props.cadParts, props.components, props.connections, props.librarySources], syncModel, {deep: true});
watch(() => [props.selectedIds, props.activeId, props.hiddenIds, props.highlightedIds, props.selectedConnection], syncDisplay, {deep: true});
watch(() => props.locale, syncLabel);
watch(() => props.projection, syncProjection);
watch(() => props.assemblyPlayback, value => controller?.setAssemblyFrame(value || null), {deep: true});
watch(() => props.viewMode, value => {if (value === 'wiring') controller?.setWires(true);});
onBeforeUnmount(() => {controller?.dispose(); controller = undefined;});
</script>

<template>
  <section class="studio-viewport" aria-label="3D workspace"
    :data-native-loaded="load.loaded" :data-native-total="load.total" :data-native-bytes="load.receivedBytes"
    :data-native-parse-ms="load.parseMs.toFixed(1)" :data-wire-count="load.routed" :data-wires-visible="load.wiresVisible"
    :data-selected-wire="selectedConnection || ''" :data-projection="load.projection" :data-view="load.direction"
    :data-selected-ids="selectedIds.join(',')" :data-hidden-ids="hiddenIds.join(',')"
    :data-assembly-step="assemblyPlayback?.stepId || ''" :data-assembly-progress="assemblyPlayback?.progress">
    <div ref="host" class="viewport-canvas" />
    <div class="viewport-toolbar" role="toolbar" :aria-label="t('视口工具', 'Viewport tools')">
      <button type="button" :title="t('适配可见零件 · Home', 'Fit visible parts · Home')" :aria-label="t('适配可见零件', 'Fit visible parts')" @click="run(c => c.fit())"><Expand :size="15" /><span>{{t('适配', 'Fit')}}</span></button>
      <button type="button" :disabled="!selectedIds.length" :title="t('聚焦选中 · 小键盘小数点', 'Frame selected · Numpad Decimal')" :aria-label="t('聚焦选中', 'Frame selected')" @click="run(c => c.fit(true))"><Focus :size="15" /></button>
      <span class="toolbar-divider" />
      <button type="button" :disabled="!!assemblyPlayback" :aria-pressed="load.exploded" :aria-label="t('爆炸视图', 'Exploded view')" @click="run(c => c.setExploded(!load.exploded))"><Move3D :size="15" /><span>{{t('爆炸', 'Explode')}}</span></button>
      <button v-if="connections.length" type="button" :disabled="!load.routed" :aria-pressed="load.showWires" :aria-label="t('显示建议电气接线', 'Show proposed electrical wires')" @click="run(c => c.setWires(!load.showWires))"><Cable :size="15" /><span>{{t('接线', 'Wires')}}</span></button>
      <span class="toolbar-divider" />
      <button type="button" :disabled="!selectedIds.length" :title="t('隐藏选中 · H', 'Hide selected · H')" :aria-label="t('隐藏选中', 'Hide selected')" @click="run(c => c.visibility('selected'))"><EyeOff :size="15" /></button>
      <button type="button" :disabled="!selectedIds.length" :title="t('隐藏未选中 · Shift+H', 'Hide unselected · Shift+H')" :aria-label="t('隐藏未选中', 'Hide unselected')" @click="run(c => c.visibility('others'))">{{t('隔离', 'Isolate')}}</button>
      <button type="button" :disabled="!hiddenIds.length" :title="t('显示全部 · Alt+H', 'Show all · Alt+H')" :aria-label="t('显示全部零件', 'Show all parts')" @click="run(c => c.visibility('all'))"><Eye :size="15" /></button>
    </div>
    <div class="viewport-orientation" role="toolbar" :aria-label="t('标准视图', 'Standard views')">
      <button v-for="view in views" :key="view.id" type="button" :aria-label="t(view.zh + '视图', view.en + ' view')" :title="view.shortcut" :aria-pressed="load.direction === view.id" @click="run(c => c.setView(view.id))">{{t(view.zh, view.en)}}</button>
      <button type="button" class="projection-button" :aria-label="t('切换透视与正交', 'Toggle perspective and orthographic')" :title="'Numpad 5'" @click="run(c => c.toggleProjection())">{{load.projection === 'perspective' ? t('透视', 'Persp') : t('正交', 'Ortho')}}</button>
    </div>
    <div class="viewport-direction">{{viewLabel}}<small>Z ↑ · mm</small></div>
    <div v-if="!parts.length" class="viewport-empty">
      <Box :size="42" :stroke-width="1" />
      <h2>{{t('从一个想法开始', 'Start with an idea')}}</h2>
      <p>{{t('完成要求描述后，在这里选择和微调每个零件。', 'Describe your toy, then inspect and refine every part here.')}}</p>
    </div>
    <div v-if="load.error" class="viewport-error" role="alert">{{t('几何不可用：', 'Geometry unavailable: ')}}{{load.error}}</div>
    <div v-else-if="cadParts && load.loaded < load.total" class="viewport-loading" role="status">
      {{t('加载原始 CAD', 'Loading exact CAD')}} · {{load.loaded}}/{{load.total}} · {{(load.receivedBytes / 1048576).toFixed(1)}} MiB
      <small>{{t('逐件校验后显示；不会替换为近似模型。', 'Parts appear after integrity checks; no substitute geometry.')}}</small>
    </div>
    <div v-if="connections.length && (viewMode === 'wiring' || activeWire)" class="viewport-wire-info" role="status">
      <span>{{load.exploded ? t('爆炸视图隐藏接线；请回到装配视图。', 'Wires are hidden in exploded view; return to assembled view.') : load.routed + '/' + connections.length + t(' 条建议接线 · 端子位置为模型假设', ' proposed wires · terminal locations are model assumptions')}}</span>
      <strong v-if="activeWire">{{activeWire.id}}: {{endpoint(activeWire.from)}} → {{endpoint(activeWire.to)}}</strong>
      <span v-if="activeWire">{{({power:t('电源线','Power'),ground:t('地线 / 回流','Ground / return'),signal:t('控制 / 信号线','Signal'),motor:t('电机输出线','Motor output')} as Record<string,string>)[activeWire.kind] || activeWire.kind}} · {{activeWire.wireAwg || t('线径待定','Gauge unspecified')}} {{activeWire.wireAwg ? 'AWG' : ''}} · {{activeWire.color}}</span>
      <span v-if="activeWire && !hasWireRoute(activeWire)">{{t('缺少端子坐标，仅显示连接表，不虚构 3D 路线。', 'Missing terminal coordinates; use the connection table. No invented 3D route.')}}</span>
      <span v-else-if="!load.wiresVisible && !load.exploded">{{t('接线需完整几何，且两端零件可见。', 'Wires require complete geometry and both endpoints visible.')}}</span>
    </div>
    <div class="viewport-footer">
      <div class="viewport-geometry-label" :class="{concept: !cadParts}">
        <i />{{cadParts ? t('原始 CAD 网格', 'Exported CAD mesh') : t('概念预览 · 非打印就绪', 'Concept preview · not print-ready')}}
        <small>{{cadParts ? t('与制造包使用相同 STL', 'Same STL files as the build package') : t('基础形体 / 半透明来源包络；精确结构需 CAD', 'Primitives / translucent source envelopes; exact structure requires CAD')}}</small>
      </div>
      <details class="viewport-help"><summary>{{t('快捷键', 'Shortcuts')}}</summary><p id="viewport-instructions">{{t('中键旋转 · Shift 中键平移 · 滚轮缩放 · 点击选中 · Shift 点击多选', 'MMB orbit · Shift MMB pan · Wheel zoom · Click select · Shift click multi-select')}}</p><p>1 / 3 / 7 {{t('小键盘视图 · Ctrl 反向 · 5 投影 · 小数点聚焦', 'numpad views · Ctrl opposite · 5 projection · Decimal frame')}}</p><p>Home {{t('适配', 'fit')}} · H {{t('隐藏', 'hide')}} · Shift H {{t('隔离', 'isolate')}} · Alt H {{t('显示全部', 'show all')}}</p><small>{{t('仅视口获得焦点时生效；不支持 G/R/S 编辑。', 'Only while the viewport is focused. No G/R/S editing.')}}</small></details>
    </div>
    <slot name="tutorial" />
  </section>
</template>

<style scoped>
.studio-viewport {position:relative;min-width:0;min-height:360px;height:100%;overflow:hidden;background:#101827;color:#d8dee7;font:12px/1.45 system-ui,sans-serif;isolation:isolate}
.viewport-canvas {position:absolute;inset:0}.viewport-canvas :deep(canvas){display:block;width:100%;height:100%;outline:none;touch-action:none}.viewport-canvas :deep(canvas:focus-visible){outline:2px solid #82b5ff;outline-offset:-3px}
.viewport-toolbar,.viewport-orientation {position:absolute;z-index:2;display:flex;align-items:center;gap:3px;background:#0d1421eb;border:1px solid #8aa5cc30;border-radius:12px;padding:5px;box-shadow:0 10px 30px #0004,inset 0 1px #ffffff08;backdrop-filter:blur(16px)}
.viewport-toolbar {top:15px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 24px);flex-wrap:wrap}.viewport-orientation {top:70px;right:14px;flex-wrap:wrap;max-width:260px}
.studio-viewport button {display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:5px 7px;min-height:32px;min-width:32px;appearance:none;border:0;border-radius:7px;background:transparent;color:#d8dee7;font:inherit;cursor:pointer;transition:background 120ms ease}
.studio-viewport button:hover:not(:disabled){background:#3b4350}.studio-viewport button[aria-pressed=true]{background:#29466f;color:#e8f4ff}.studio-viewport button:focus-visible{outline:2px solid #89b9ff;outline-offset:1px}.studio-viewport button:disabled{opacity:.35;cursor:default}.toolbar-divider{width:1px;height:18px;background:#48505d;margin:0 2px}.projection-button{border-left:1px solid #48505d!important;border-radius:0!important}
.viewport-direction {position:absolute;top:75px;left:18px;color:#c9cfd9;pointer-events:none}.viewport-direction small{display:block;color:#8993a3;font:11px/1.7 ui-monospace,monospace}
.viewport-empty {position:absolute;inset:25% 15% 20%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:#a7b1c1;pointer-events:none}.viewport-empty h2{font-size:21px;font-weight:500;margin:17px 0 7px}.viewport-empty p{max-width:330px;line-height:1.8;color:#8893a6}
.viewport-error,.viewport-loading,.viewport-wire-info{position:absolute;left:12px;right:12px;z-index:2;border-radius:6px;padding:11px 14px;background:#202733ee;border:1px solid #4b5f7a;color:#d2e3fc;overflow-wrap:anywhere;pointer-events:none}
.viewport-error{top:109px;background:#412d28f2;border-color:#9d614c;color:#ffc9ae;max-height:35%;overflow:auto;pointer-events:auto}.viewport-loading{top:109px}.viewport-loading small{display:block;margin-top:4px;color:#a5b7d0}.viewport-wire-info{bottom:82px;font-size:11px}.viewport-wire-info strong,.viewport-wire-info span{display:block;margin:2px 0}
.viewport-footer{position:absolute;bottom:0;left:0;right:0;display:flex;align-items:flex-end;justify-content:space-between;gap:10px;padding:13px 15px;background:linear-gradient(transparent,#0c1422eb);pointer-events:none}.viewport-geometry-label{display:block;font-size:11px;color:#bedbd1}.viewport-geometry-label.concept{color:#dcc18f}.viewport-geometry-label i{display:inline-block;width:6px;height:6px;border-radius:50%;background:currentColor;margin-right:6px}.viewport-geometry-label small{display:block;margin-top:3px;color:#8f9bad;font-size:10px;max-width:420px}.viewport-help{pointer-events:auto;color:#a6b3c8;white-space:nowrap;font-size:11px;flex-shrink:0}.viewport-help[open]{position:absolute;right:12px;bottom:10px;padding:10px 14px;background:#20242bf5;border:1px solid #485363;border-radius:6px;max-width:calc(100% - 24px);white-space:normal}.viewport-help summary{cursor:pointer}.viewport-help p{margin:7px 0}.viewport-help small{color:#8591a4}
@media(max-width:650px){.viewport-toolbar{gap:1px}.viewport-toolbar button{padding:4px 5px}.viewport-toolbar button span{display:none}.viewport-orientation{top:55px;right:8px;max-width:190px;gap:0}.viewport-orientation button{font-size:10px;min-width:23px;padding:3px 4px}.viewport-direction{top:61px;left:12px;font-size:10px}.viewport-geometry-label small{max-width:250px}.viewport-help summary{font-size:10px}}
@media(prefers-reduced-motion:reduce){.studio-viewport button{transition:none}}
@media(prefers-reduced-transparency:reduce){.viewport-toolbar,.viewport-orientation{backdrop-filter:none;background:#111b2c}}
@media(prefers-contrast:more){.viewport-toolbar,.viewport-orientation{border-color:#a3bad9}.viewport-direction{color:#e1ebfa}}
</style>
