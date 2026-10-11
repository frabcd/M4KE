import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as prices from '../server/studio-live-prices.mjs';
import {createIntegrationRuntime,createIntegrationsService} from '../server/studio-integrations.mjs';
import http from 'node:http';

const page = (sku='DFR0034', price='40.00') => `<h1>Sound sensor</h1><div class="goodsMes" data-price="${price}" data-stock="有货"><div class="content2">DFROBOT</div><div class="content2">${sku}</div></div><font id="ECS_SHOPPRICE">￥${price}</font>`;
test('automatic design prices cover purchased instances and build items with explicit quantity gaps',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-auto-price-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const spec={parts:[{id:'case',name:'Case',kind:'printed'},{id:'rtc',name:'Clock',kind:'purchased',shape:{type:'catalog',catalogId:'rtc'}}],buildItems:[{id:'screws',name:'M3 screws',kind:'fastener',quantity:4,unit:'piece'},{id:'wire',name:'Wire',kind:'consumable',quantity:150,unit:'mm'}]};
  const before=JSON.stringify(spec),queries=[];
  const service=prices.createLivePrices({root,enabled:true,get:async url=>{if(url.includes('search.php')){queries.push(new URL(url).searchParams.get('keywords'));return '<a href="goods-85.html">result</a>';}return page('DFR0641','49');}});
  const result=await service.searchDesign(spec,{components:[{id:'rtc',mpn:'DFR0641'}]});
  assert.deepEqual(queries,['DFR0641','M3 screws']);assert.equal(result.lines.length,3);
  assert.equal(result.lines[0].partId,'rtc');assert.equal(result.lines[0].offers[0].amount,'49');assert.equal(result.lines[1].quantity,4);
  assert.equal(result.lines[2].status,'PURCHASE_UNIT_REQUIRED');assert.equal(result.total,null);assert.equal(JSON.stringify(spec),before);
});
test('automatic lookup covers over twenty instances offline without network or lost rows',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-many-prices-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=prices.createLivePrices({root,enabled:false,get:()=>{throw Error('No network allowed');}});
  const result=await service.searchDesign({parts:Array.from({length:25},(_,i)=>({id:'part-'+i,name:'Clock module '+i,kind:'purchased'}))});
  assert.equal(result.lines.length,25);assert.equal(result.networkUsed,false);assert(result.lines.every(l=>l.status==='OFFLINE_CACHE_MISS'&&l.quantity===1));
});
test('supplier amounts come from the product price field, never basket totals or snippets',()=>{
  const r=prices.extractPrices('<span>Cart total: 999.99</span>'+page(),'https://www.dfrobot.com.cn/goods-85.html');
  assert.equal(r[0].amount,'40.00');assert.equal(r[0].currency,'CNY');assert.equal(r[0].sku,'DFR0034');
  assert.equal(r[0].packQuantity,null);assert.equal(r[0].tax,'UNKNOWN');
});
test('JSON-LD separates offers, currencies, variants and unknown purchase units',()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Clock motor',sku:'CLOCK-A',offers:[{'@type':'Offer',price:'12.50',priceCurrency:'CNY'},{'@type':'Offer',price:'2.00',priceCurrency:'USD'}]})+'</script>';
  const r=prices.extractPrices(html,'https://item.szlcsc.com/123.html');
  assert.equal(r.length,2);assert.equal(r[0].amount,'12.50');assert.equal(r[1].currency,'USD');assert.equal(r[0].packQuantity,null);
  assert.deepEqual(prices.extractPrices('<p>From ￥1.00</p>','https://item.szlcsc.com/123.html'),[]);
});
test('supplier requests reject credentials, arbitrary hosts, redirects and private IPv4 answers',()=>{
  for(const u of ['https://127.0.0.1/a','https://dfrobot.com.cn.evil.test/goods-85.html','https://www.dfrobot.com.cn/account','http://www.dfrobot.com.cn/goods-85.html'])assert.equal(prices.supplierUrl(u),null);
  for(const ip of ['127.0.0.1','10.2.3.4','172.16.0.2','192.168.0.1','169.254.169.254','0.0.0.0','100.64.0.1','224.1.1.1'])assert.equal(prices.publicIpv4(ip),false);
  assert.equal(prices.publicIpv4('8.8.8.8'),true);
});
test('general BOM search returns clock prices, preserves unmatched hardware and caches offline',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-live-price-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let requests=0;
  const get=async url=>{requests++;return url.includes('search.php')?'<a href="goods-85.html">clock</a>':page('RTC-1','12.50');};
  const service=prices.createLivePrices({root,enabled:true,get});
  const result=await service.search({items:[{id:'clock',query:'RTC-1',mpn:'RTC-1',quantity:2},{id:'case',query:'Clock case',mpn:'CASE-2',quantity:1}]});
  assert.equal(result.lines[0].offers[0].amount,'12.50');
  assert.equal(result.lines[0].offers[0].match,'IDENTIFIER_MATCH_REVIEW_VARIANT');
  assert.equal(result.lines[1].offers[0].match,'DIFFERENT_IDENTIFIER');
  assert.equal(result.total,null);assert.equal(result.lines[0].offers[0].lineTotal,null);
  const offline=prices.createLivePrices({root,enabled:false,get:()=>{throw Error('Network forbidden');}});
  const cached=await offline.search({items:[{id:'clock',query:'RTC-1',mpn:'RTC-1',quantity:5}]});
  assert.equal(cached.lines[0].offers[0].amount,'12.50');assert.equal(cached.lines[0].quantity,5);assert.equal(cached.networkUsed,false);
  assert.equal(requests,4);
});
test('blocked supplier and missing price produce explicit gaps rather than invented zero totals',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-price-fail-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const service=prices.createLivePrices({root,enabled:true,get:async()=>{throw Error('HTTP 403');}});
  const r=await service.search({items:[{id:'motor',query:'clock motor',quantity:1}]});
  assert.equal(r.lines[0].status,'NO_PRICE_FOUND');assert.equal(r.lines[0].offers.length,0);assert.equal(r.total,null);assert(r.lines[0].issues.length);
  await assert.rejects(service.search({items:[{id:'x',query:'http://localhost/secret',quantity:1}]}));
  await assert.rejects(service.search({items:[{id:'x',query:'motor',quantity:0}]}));
});
test('ambiguous ranges and mismatched visible prices are not extracted as an exact quote',()=>{
  const aggregate='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'ten pack',offers:{'@type':'AggregateOffer',lowPrice:'1',highPrice:'80',priceCurrency:'CNY'}})+'</script>';
  assert.deepEqual(prices.extractPrices(aggregate,'https://item.szlcsc.com/123.html'),[]);
  assert.deepEqual(prices.extractPrices(page().replace('data-price="40.00"','data-price="99.00"'),'https://www.dfrobot.com.cn/goods-85.html'),[]);
  const pack=prices.extractPrices(page().replace('Sound sensor','M3 screws ten pack'),'https://www.dfrobot.com.cn/goods-85.html')[0];
  assert.equal(pack.packQuantity,null);assert.equal(pack.purchaseUnit,null);
});
test('HTTP and MCP accept arbitrary BOMs offline, reject extra commands and preserve unknown totals',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-price-api-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const previous=process.env.M4KE_ALLOW_WEB;process.env.M4KE_ALLOW_WEB='0';t.after(()=>{if(previous===undefined)delete process.env.M4KE_ALLOW_WEB;else process.env.M4KE_ALLOW_WEB=previous;});
  const args={items:[{id:'clock',query:'Quartz clock movement',quantity:1}]};
  const runtime=createIntegrationRuntime({root});
  const r=await runtime.call('search_bom_prices',args);assert.equal(r.lines[0].status,'OFFLINE_CACHE_MISS');assert.equal(r.total,null);
  await assert.rejects(runtime.call('search_bom_prices',{...args,url:'https://example.com'}));
  const received=[];const handler=createIntegrationsService({root,json:(_res,code,value)=>received.push({code,value}),body:async()=>args});
  assert.equal(await handler({method:'POST'},{},'/api/studio/prices/search'),true);
  assert.equal(received[0].code,200);assert.equal(received[0].value.lines[0].query,'Quartz clock movement');
  assert.equal(await handler({method:'GET'},{},'/api/studio/prices/search/extra'),false);
});
test('operator proxy refuses untrusted endpoints and handles denial without following redirects',async t=>{
  for(const u of ['http://example.com:8080','http://127.0.0.1:8080/path','https://127.0.0.1:8080'])assert.throws(()=>prices.priceProxy(u));
  const server=http.createServer();server.on('connect',(_req,socket)=>socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  await assert.rejects(prices.fetchSupplier('https://www.dfrobot.com.cn/goods-85.html',{proxyUrl:`http://127.0.0.1:${server.address().port}`,timeoutMs:1000}),/refused/);
});
test('changed cache evidence is discarded; stale offline observations retain their timestamp',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-price-cache-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const time=Date.parse('2026-10-10T10:00:00Z'),args={items:[{id:'rtc',query:'DS3231',quantity:1}]};
  await prices.createLivePrices({root,enabled:true,now:()=>time,get:async u=>u.includes('search.php')?'<a href="goods-85.html">rtc</a>':page()}).search(args);
  const stale=await prices.createLivePrices({root,enabled:false,now:()=>time+7200000}).search(args);
  assert.equal(stale.lines[0].stale,true);assert.equal(stale.lines[0].retrievedAt,'2026-10-10T10:00:00.000Z');
  const folder=path.join(root,'data/price-search');for(const file of await readdir(folder))await writeFile(path.join(folder,file),'{"sha256":"changed","payload":{"offers":[]}}');
  const result=await prices.createLivePrices({root,enabled:false}).search(args);assert.equal(result.lines[0].status,'OFFLINE_CACHE_MISS');
});
test('conflicting offer variants keep their own identifiers instead of inheriting the parent SKU',()=>{
  const html='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Parent',sku:'PARENT',mpn:'MPN-A',model:'A',offers:{'@type':'Offer',sku:'VARIANT-2',price:'25.00',priceCurrency:'CNY'}})+'</script>';
  const offer=prices.extractPrices(html,'https://item.szlcsc.com/123.html')[0];
  assert.equal(offer.sku,'VARIANT-2');assert.equal(offer.mpn,null);assert.equal(offer.variant,null);assert.equal(offer.name,'');
  const nested=html.replace('"sku":"VARIANT-2"','"itemOffered":{"sku":"VARIANT-B","model":"B","name":"Variant B"}');
  const other=prices.extractPrices(nested,'https://item.szlcsc.com/123.html')[0];
  assert.equal(other.sku,'VARIANT-B');assert.equal(other.variant,'B');assert.equal(other.mpn,null);assert.equal(other.name,'Variant B');
});
test('a stalled CONNECT proxy times out without permanently locking the search service',async t=>{
  const sockets=[];const server=http.createServer();server.on('connect',(_req,socket)=>{sockets.push(socket);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{for(const socket of sockets)socket.destroy();server.close();});
  const result=await Promise.race([
    prices.fetchSupplier('https://www.dfrobot.com.cn/goods-85.html',{proxyUrl:`http://127.0.0.1:${server.address().port}`,timeoutMs:40}).then(()=> 'resolved',()=> 'rejected'),
    new Promise(resolve=>setTimeout(()=>resolve('still pending'),250)),
  ]);
  assert.equal(result,'rejected');
});

test('a stalled TLS handshake releases the search lock for subsequent requests',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'m4ke-price-tls-'));
  const sockets=[];const server=http.createServer();
  server.on('connect',(_req,socket)=>{sockets.push(socket);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.on('data',()=>{});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{for(const socket of sockets)socket.destroy();server.close();await rm(root,{recursive:true,force:true});});
  const args={items:[{id:'rtc',query:'RTC module',quantity:1}]};
  const service=prices.createLivePrices({root,enabled:true,get:url=>prices.fetchSupplier(url,{proxyUrl:`http://127.0.0.1:${server.address().port}`,timeoutMs:40})});
  const result=await Promise.race([service.search(args),new Promise(resolve=>setTimeout(()=>resolve(null),1000))]);
  assert(result,'stalled TLS must settle the search');assert.equal(result.lines[0].status,'NO_PRICE_FOUND');
  assert.equal((await prices.createLivePrices({root,enabled:false}).search(args)).lines.length,1);
});
