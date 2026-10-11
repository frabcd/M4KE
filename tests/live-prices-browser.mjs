/** Real Vue + HTTP + supplier parser/cache. Synthetic supplier HTML; no network in regression. */
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import vue from '@vitejs/plugin-vue';
import {chromium} from 'playwright';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLivePrices} from '../server/studio-live-prices.mjs';
import {createIntegrationsService} from '../server/studio-integrations.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const isolated=await mkdtemp(path.join(os.tmpdir(),'m4ke-live-price-browser-'));
let vite,browser;
try{
  const service=createLivePrices({root:isolated,enabled:true,get:async url=>url.includes('search.php')?'<a href="goods-85.html">clock</a>':'<h1>Clock module</h1><div class="content2">DFR0641</div><font id="ECS_SHOPPRICE">￥49.00</font>'});
  await service.search({items:[{id:'clock',query:'DS3231',quantity:1}]});
  process.env.M4KE_ALLOW_WEB='0';
  const handler=createIntegrationsService({root:isolated,json:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},body:async(req,max)=>{let text='';for await(const c of req){text+=c;if(Buffer.byteLength(text)>max)throw Error('too large');}return JSON.parse(text);}});
  const autoReport=await service.searchDesign({parts:[{id:'rtc',name:'DS3231',kind:'purchased'}]});
  const html=`<div id="app"></div><script type="module">
    import {createApp} from 'vue';import {createPinia} from 'pinia';import Panel from '/src/components/BomPriceSearch.vue';import {useStudio} from '/src/studio/store.ts';
    const app=createApp(Panel),p=createPinia();app.use(p);const s=useStudio(p);s.locale=new URL(location.href).searchParams.get('lang')||'en';
    s.project={id:'clock-project',designHash:'clock-hash',priceSearch:${JSON.stringify({...autoReport,designHash:'clock-hash'})},spec:{parts:[{id:'rtc',name:'DS3231',kind:'purchased',shape:{type:'box'}},{id:'case',name:'printed case',kind:'printed',shape:{type:'box'}}]}};window.testStudio=s;app.mount('#app');</script>`;
  vite=await createServer({root,configFile:false,plugins:[vue(),{name:'prices-test',configureServer(server){server.middlewares.use((req,res,next)=>{const p=new URL(req.url,'http://localhost').pathname;if(p==='/test'){server.transformIndexHtml(req.url,html).then(s=>{res.setHeader('content-type','text/html');res.end(s);}).catch(next);return;}handler(req,res,p).then(ok=>{if(!ok)next();}).catch(next);});}}],server:{host:'127.0.0.1',port:0},optimizeDeps:{entries:[]}});
  await vite.listen();const base=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({headless:true,...(process.platform==='win32'?{executablePath:process.env.M4KE_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'}:{})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  for(const lang of ['en','zh']){
    await page.goto(base+'/test?lang='+lang);
    await page.locator('.automatic-price-status').waitFor();
    assert.equal(await page.locator('.offer strong').innerText(),'CNY 49.00');
    await page.evaluate(()=>{window.testStudio.project.designHash='changed-revision';});
    await page.waitForFunction(()=>document.querySelectorAll('.offer').length===0);
    await page.getByRole('button',{name:lang==='en'?'Load purchased parts from current design':'载入当前设计采购件'}).click();
    assert.equal(await page.locator('textarea').inputValue(),'DS3231 | 1');
    await page.getByRole('button',{name:lang==='en'?'Search RMB prices':'搜索人民币价格'}).click();
    await page.locator('.offer strong').waitFor();assert.equal(await page.locator('.offer strong').innerText(),'CNY 49.00');
    assert.match(await page.locator('body').innerText(),lang==='en'?/Cached/:/缓存/);
    assert.equal(await page.locator('.offer a').getAttribute('href'),'https://www.dfrobot.com.cn/goods-85.html');
    await page.locator('textarea').fill('Unknown clock case | 1');assert.equal(await page.locator('.offer').count(),0);
    await page.getByRole('button',{name:lang==='en'?'Search RMB prices':'搜索人民币价格'}).click();
    await page.locator('article').waitFor();assert.match(await page.locator('article').innerText(),lang==='en'?/remains unknown/:/仍未知/);
    await page.locator('textarea').fill('motor | 0');await page.getByRole('button',{name:lang==='en'?'Search RMB prices':'搜索人民币价格'}).click();await page.getByRole('alert').waitFor();
    await page.evaluate(()=>{window.testStudio.project.designHash='clock-hash';});
    await page.locator('.automatic-price-status').waitFor();await page.locator('.offer strong').waitFor();
    assert.equal(await page.locator('textarea').inputValue(),'');
    assert.equal(await page.getByRole('alert').count(),0);
  }
  assert.deepEqual(errors,[]);console.log('PASS: automatic persisted revision prices without clicking search, stale revision suppression; real Vue/HTTP EN+ZH, current BOM load, price display, source link, stale-input clearing, missing and invalid quantities.');
}finally{await browser?.close();await vite?.close();await rm(isolated,{recursive:true,force:true});}
