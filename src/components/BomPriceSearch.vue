<script setup lang="ts">
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {useStudio} from '../studio/store';
import {api,send,safeExternal} from '../studio/api';
const s=useStudio(),text=ref(''),busy=ref(false),error=ref(''),enabled=ref(false),progress=ref('');
type Item={id:string;query:string;quantity:number;mpn?:string};
type Offer={name:string;sku:string|null;amount:string;currency:string;url:string;match:string;availability:string;extraction:string};
type Line=Item&{unit?:string;status:string;retrievedAt?:string;cacheHit?:boolean;stale?:boolean;offers:Offer[];issues:string[]};
const lines=ref<Line[]>([]);
const manual=ref(false);
const automatic=computed(()=>{const p=s.project;return !p?.requiresDesignUpdate&&p?.priceSearch?.designHash===p?.designHash?p?.priceSearch:null;});
const displayedLines=computed(()=>manual.value?lines.value:automatic.value?.lines||[]);
let epoch=0;
onBeforeUnmount(()=>{epoch++;});
api<{enabled:boolean}>('/api/studio/prices/search').then(r=>enabled.value=r.enabled).catch(()=>{});
// Invalidate displayed evidence when its input/project revision changes.
watch(text,()=>{epoch++;lines.value=[];});
watch(()=>[s.project?.id,s.project?.designHash],()=>{epoch++;lines.value=[];text.value='';manual.value=false;error.value='';},{flush:'post'});
function loadBom(){
  manual.value=true;
  const rows=(s.spec?.parts||[]).filter(p=>p.kind==='purchased').map(p=>{
    const c=p.shape.type==='catalog'?s.catalog.components.find(c=>c.id===(p.shape as {catalogId:string}).catalogId):null;
    return `${c?.mpn||p.name} | 1${c?.mpn?' | '+c.mpn:''}`;
  });
  text.value=rows.join('\n');
  if(!rows.length)error.value=s.t('当前设计没有采购件。也可手动输入任何物料清单。','No purchased parts in this design. You can enter any parts list below.');
}
async function search(){
  error.value='';lines.value=[];manual.value=true;
  const rows=text.value.split('\n').map(t=>t.trim()).filter(Boolean);
  if(!rows.length||rows.length>100){error.value=s.t('请输入 1–100 行。','Enter 1–100 lines.');return;}
  const items:Item[]=[];
  for(const [i,row] of rows.entries()){
    const fields=row.split('|').map(x=>x.trim()),[query,count='1',mpn]=fields;
    if(fields.length>3||!/^\d+$/.test(count)||Number(count)<1||Number(count)>1000000||query.length<2||query.length>120){error.value=s.t('格式：元件名称或型号 | 数量 | 精确型号（可选）','Format: component name or MPN | quantity | exact MPN (optional)');return;}
    items.push({id:'line-'+(i+1),query,quantity:Number(count),...(mpn?{mpn}:{})});
  }
  busy.value=true;const generation=++epoch;
  try{
    for(const [i,item] of items.entries()){
      if(generation!==epoch)break;
      progress.value=`${i+1} / ${items.length}`;
      try{const r=await send<{lines:Line[]}>('/api/studio/prices/search',{items:[item],refresh:true});if(generation===epoch)lines.value.push(...r.lines);}
      catch(e){if(generation===epoch)lines.value.push({...item,status:'SEARCH_FAILED',offers:[],issues:[(e as Error).message]});}
    }
  }finally{busy.value=false;progress.value='';}
}
</script>
<template>
  <section class="bom-price-search">
    <h2>{{s.t('搜索物料价格','Find prices for your parts')}}</h2>
    <p v-if="automatic&&!manual" class="automatic-price-status">{{s.t('当前设计已自动查询价格','Prices searched automatically for this design')}} · {{automatic.status}}</p>
    <p v-for="issue in (!manual?automatic?.issues:[])" :key="issue" role="alert">{{issue}}</p>
    <p>{{s.t('适用于时钟、小车或其他设计。每行：名称/型号 | 数量 | 精确型号（可选）。仅发送元件搜索词。','Works with clocks, cars or other designs. One line: name/MPN | quantity | exact MPN (optional). Only component search terms are sent.')}}</p>
    <p v-if="!enabled">{{s.t('目前仅查缓存。运行服务需启用联网价格搜索。','Cache-only mode. Online price search must be enabled on the server.')}}</p>
    <button :disabled="busy" @click="loadBom">{{s.t('载入当前设计采购件','Load purchased parts from current design')}}</button>
    <textarea v-model="text" @input="manual=true" :disabled="busy" rows="5" :aria-label="s.t('物料清单价格搜索','BOM price search')" placeholder="DS3231 | 1&#10;OLED display | 1"></textarea>
    <button class="primary" :disabled="busy||!text.trim()" @click="search">{{busy?s.t('搜索中','Searching'):s.t('搜索人民币价格','Search RMB prices')}} {{progress}}</button>
    <button v-if="busy" @click="epoch++">{{s.t('停止后续查询','Stop remaining searches')}}</button>
    <p v-if="error" role="alert">{{error}}</p>
    <article v-for="line in displayedLines" :key="line.id">
      <h3>{{line.query}} × {{line.quantity}} {{line.unit||''}}</h3>
      <small>{{line.retrievedAt||line.status}} {{line.cacheHit?s.t('缓存','Cached'):''}} {{line.stale?s.t('已过期','STALE'):''}}</small>
      <p v-if="!line.offers.length">{{s.t('未取得价格；此项仍未知。','No price obtained; this item remains unknown.')}}</p>
      <div v-for="(offer,i) in line.offers" :key="i" class="offer">
        <a :href="safeExternal(offer.url)" target="_blank" rel="noopener noreferrer">{{offer.name||offer.sku||s.t('供应商商品','Supplier product')}}</a>
        <strong>{{offer.currency}} {{offer.amount}}</strong><span>{{offer.sku}}</span>
        <p>{{s.t('供应商库存原文（未核实）：','Supplier availability text (unverified): ')}}{{offer.availability}}</p>
        <p>{{offer.match==='DIFFERENT_IDENTIFIER'?s.t('型号不匹配，不计入物料价格。','Different identifier; excluded from BOM pricing.'):s.t('候选价格：请核对型号、版本和包装数量。','Candidate price: check identity, variant and pack contents.')}}</p>
      </div>
      <p v-for="issue in line.issues" :key="issue">{{issue}}</p>
    </article>
    <p>{{s.t('展示供应商页面观察价，不是结算报价。包装单位、税费、运费和缺失项未确认前不计算总价。打印耗材需切片用量。','These are supplier-page observations, not checkout quotes. Total remains unknown until purchase units, taxes, shipping and missing items are resolved. Printed materials need sliced consumption.')}}</p>
  </section>
</template>
<style scoped>
.bom-price-search{border-bottom:1px solid #8998ab44;padding-bottom:24px;margin-bottom:28px}.bom-price-search textarea{display:block;width:100%;box-sizing:border-box;margin:12px 0;padding:12px;font:inherit}.bom-price-search button{margin:4px 8px 4px 0}.bom-price-search article{padding:14px;margin:12px 0;border:1px solid #8998ab44;border-radius:10px}.offer{margin-top:12px}.offer a{display:block}.offer strong{display:inline-block;font-size:20px;margin:6px 12px 0 0}.offer p{font-size:13px}.bom-price-search small{opacity:.75}
</style>
