<script setup lang="ts">
import {onMounted,ref} from 'vue';
import {Search,ExternalLink,Globe,Database} from '@lucide/vue';
import {useStudio} from '../studio/store';
import {api,send,safeExternal} from '../studio/api';
const s=useStudio(),query=ref(''),kind=ref('cad'),enabled=ref(false),busy=ref(false),error=ref('');
type Result={status:string;query:string;kind:string;cacheHit:boolean;stale:boolean;searchedAt?:string;results:{title:string;url:string;snippet:string;sourceHost:string}[]};
const result=ref<Result|null>(null);
onMounted(async()=>{try{enabled.value=(await api<{enabled:boolean}>('/api/studio/research')).enabled;}catch(e){error.value=(e as Error).message;}});
async function search(){busy.value=true;error.value='';try{result.value=await send<Result>('/api/studio/research',{query:query.value,kind:kind.value});}catch(e){error.value=(e as Error).message;}finally{busy.value=false;}}
</script>
<template>
  <section class="web-research">
    <header class="section-heading"><div><span class="eyebrow">{{s.t('元件资料与模型来源','COMPONENT SOURCES')}}</span><h2>{{s.t('先找到真实来源，再采用。','Find the source before adopting it.')}}</h2></div><Globe :size="24"/></header>
    <p>{{enabled?s.t('DGX 按需联网；只发送元件名称 / 型号，结果缓存到本地。','DGX searches on demand; only component names / MPNs leave the server. Results are cached locally.'):s.t('离线模式：查询已有缓存，不会自动联网。','Offline mode: searches cached results without network fallback.')}}</p>
    <form class="research-form" @submit.prevent="search"><input v-model="query" maxlength="120" required :placeholder="s.t('元件名称或型号，例如 ESP32 DevKitC','Component name or MPN, e.g. ESP32 DevKitC')" :aria-label="s.t('元件搜索词','Component search query')"/><select v-model="kind" :aria-label="s.t('资料类型','Source type')"><option value="cad">3D / STEP / CAD</option><option value="datasheet">{{s.t('数据手册与尺寸','Datasheet & dimensions')}}</option><option value="price">{{s.t('供应商与价格线索','Supplier & price leads')}}</option></select><button class="primary" :disabled="busy||!query.trim()"><Search :size="15"/>{{busy?s.t('搜索中…','Searching…'):s.t('搜索来源','Search sources')}}</button></form>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <div v-if="result"><p class="research-receipt"><Database :size="14"/>{{result.cacheHit?s.t('本地缓存','Local cache'):s.t('本次搜索','Current search')}} · {{result.searchedAt||result.status}} <strong v-if="result.stale">{{s.t('已过期，需复查','Stale; recheck')}}</strong></p><p v-if="!result.results.length">{{s.t('没有可用来源；不会生成假的价格或替代 CAD。','No usable sources. No invented prices or substitute CAD.')}}</p><article v-for="row in result.results" :key="row.url" class="source-lead"><small>{{row.sourceHost}}</small><h3><a :href="safeExternal(row.url)" target="_blank" rel="noopener noreferrer">{{row.title}} <ExternalLink :size="13"/></a></h3><p>{{row.snippet}}</p></article></div>
    <p class="boundary">{{s.t('搜索结果仅为线索，不会自动加入设计。采用前检查型号、许可、单位、尺度和关键接口；不购买、不上传项目，不把搜索摘要当成实测数据。','Results are leads, not automatically adopted parts. Check exact identity, license, units, scale and interfaces before importing. No purchases or project uploads; snippets are not measurements.')}}</p>
  </section>
</template>
<style scoped>
.research-form{display:flex;flex-wrap:wrap;gap:9px;margin:24px 0}.research-form input{flex:1;min-width:220px}.research-form select{max-width:230px}.research-receipt{display:flex;align-items:center;gap:8px;font-size:12px;color:#9eb1cb}.source-lead{padding:18px 20px;margin:12px 0;border:1px solid #ffffff14;background:#142033;border-radius:14px}.source-lead small{color:#8caedc}.source-lead h3{margin:8px 0}.source-lead a{color:#d0e2ff}.source-lead p{color:#adbacd;line-height:1.7;font-size:13px}
</style>
