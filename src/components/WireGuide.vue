<script setup lang="ts">
import {computed, ref} from 'vue';
import {useStudio} from '../studio/store';
const s=useStudio(), filter=ref('all');
const kinds=['all','power','ground','signal','motor'];
const label=(kind:string)=>({all:s.t('全部线路','All wires'),power:s.t('电源线','Power'),ground:s.t('地线 / 回流','Ground / return'),signal:s.t('控制 / 信号线','Signal'),motor:s.t('电机输出线','Motor output')}[kind]||kind);
const connections=computed(()=>(s.electrical?.connections||[]).filter(c=>filter.value==='all'||c.kind===filter.value));
const name=(id:string)=>s.spec?.parts.find(p=>p.id===id)?.name||id;
const role=(partId:string,terminal:string)=>s.electrical?.components.find(c=>c.partId===partId)?.terminals.find(t=>t.id===terminal)?.role;
const color=(value:string)=>/^#[a-f\d]{6}$/i.test(value)?value:'#7e91a8';
</script>
<template>
  <section class="wire-guide" data-testid="wire-guide">
    <header><h3>{{s.t('一根一根，看清怎么接','One wire at a time')}}</h3><span>{{s.electrical?.connections.length||0}} {{s.t('条设计连接','design connections')}}</span></header>
    <div class="wire-filters" role="group" :aria-label="s.t('按线路用途筛选','Filter wire purpose')"><button v-for="kind in kinds" :key="kind" :aria-pressed="filter===kind" @click="filter=kind">{{label(kind)}}</button></div>
    <div class="wire-cards">
      <article v-for="c in connections" :key="c.id" class="wire-card" :class="{active:s.selectedConnection===c.id}" :style="{'--wire-color':color(c.color)}">
        <header><strong>{{label(c.kind)}}</strong><code>{{c.id}}</code></header>
        <div class="wire-endpoints"><div><span>{{name(c.from.partId)}}</span><b>{{c.from.terminal}}</b><small>{{role(c.from.partId,c.from.terminal)}}</small></div><div class="wire-path" aria-hidden="true"><i/><em/><i/></div><div><span>{{name(c.to.partId)}}</span><b>{{c.to.terminal}}</b><small>{{role(c.to.partId,c.to.terminal)}}</small></div></div>
        <footer><span><i class="wire-swatch"/>{{c.color}} · {{c.wireAwg ? c.wireAwg+' AWG' : s.t('线径待定','Gauge unspecified')}}</span><button @click="s.pickWire(c.id);s.view.viewMode='model'">{{s.t('在 3D 中定位','Locate in 3D')}} ↗</button></footer>
      </article>
    </div>
    <p class="boundary">{{s.t('颜色与 AWG 是当前设计建议，不是已采购线材。电压、电流、绝缘、接插件和长度需依据两端数据手册与实物核对；GPIO 名称不是排针序号。','Colours and AWG are design proposals, not purchased wire. Confirm voltage, current, insulation, connectors and length against both endpoint datasheets and hardware. GPIO labels are not header pin numbers.')}}</p>
  </section>
</template>
<style scoped>
.wire-guide>header,.wire-card header,.wire-card footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.wire-guide>header span,.wire-card code{color:#8c9ab0;font-size:11px}.wire-filters{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 16px}.wire-filters button{border-radius:20px;padding:7px 13px}.wire-filters button[aria-pressed=true]{background:#284367;color:#d4e6ff;border-color:#668bbd}.wire-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px}.wire-card{padding:15px;border:1px solid #ffffff14;border-radius:14px;background:linear-gradient(140deg,#1a2434,#101923)}.wire-card.active{border-color:#8ebcff}.wire-card header strong{font-size:12px}.wire-card code{overflow-wrap:anywhere}.wire-endpoints{display:grid;grid-template-columns:minmax(0,1fr) 54px minmax(0,1fr);align-items:center;gap:8px;margin:18px 0}.wire-endpoints>div:last-child{text-align:right}.wire-endpoints span,.wire-endpoints b,.wire-endpoints small{display:block;overflow-wrap:anywhere}.wire-endpoints span{font-size:11px;color:#a7b6cb}.wire-endpoints b{font:600 19px/1.8 ui-monospace,monospace;color:#edf5ff}.wire-endpoints small{font-size:10px;color:#8da3bd}.wire-path{display:flex;align-items:center}.wire-path em{height:3px;flex:1;background:var(--wire-color);box-shadow:0 0 8px color-mix(in srgb,var(--wire-color) 30%,transparent)}.wire-path i{width:7px;height:7px;border:2px solid var(--wire-color);border-radius:50%}.wire-card footer{border-top:1px solid #ffffff0d;padding-top:10px;font-size:10px;color:#94a5bb}.wire-card footer button{font-size:10px;padding:5px 9px}.wire-swatch{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--wire-color);margin-right:5px}
</style>
