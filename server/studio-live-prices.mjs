/** Public supplier discovery. Observations are candidates, never selected parts or checkout quotes. */
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import {lookup} from 'node:dns';
import {isIP} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {researchQuery} from './studio-web-research.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const TTL=3600000, MAX_BYTES=2*1024*1024;
let active=false;
const decode=s=>String(s??'').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g,x=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '})[x]);
const clean=(s,n=180)=>decode(typeof s==='string'?s:'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const amount=s=>/^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(String(s))&&Number(s)>0?String(s):null;
function attr(tag,name){const m=tag.match(new RegExp('(?:\\s|^)'+name+'\\s*=\\s*(["\'])(.*?)\\1','i'));return m?decode(m[2]):null;}

export function supplierUrl(value){
  try{
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
    if(u.hostname==='www.dfrobot.com.cn'&&/^\/goods-\d+\.html$/.test(u.pathname)&&!u.search)return u.href;
    if(u.hostname==='item.szlcsc.com'&&/^\/\d+\.html$/.test(u.pathname)&&!u.search)return u.href;
  }catch{}
  return null;
}
export function publicIpv4(address){
  if(isIP(address)!==4)return false;
  const [a,b,c]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
/** Pin the socket lookup to a public IPv4 answer. No redirects, cookies or private endpoints. */
export function priceProxy(value=''){
  if(!value)return null;
  const u=new URL(value);
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Price proxy must be an operator-configured loopback HTTP proxy.');
  return u;
}
export function fetchSupplier(value,{timeoutMs=10000,proxyUrl=process.env.M4KE_PRICE_PROXY_URL||''}={}){
  const u=new URL(value),search=u.origin==='https://www.dfrobot.com.cn'&&u.pathname==='/search.php'&&[...u.searchParams.keys()].every(k=>k==='keywords')&&u.searchParams.has('keywords');
  if(!supplierUrl(value)&&!search)throw Error('Unsupported supplier URL');
  if(u.username||u.password||u.port||u.hash)throw Error('Unsupported supplier URL');
  const proxy=priceProxy(proxyUrl);
  return new Promise((resolve,reject)=>{
    let agent,connection,proxySocket,secureSocket,aborted=false;
    if(proxy){
      // The explicitly configured local proxy owns DNS/routing. TLS still authenticates
      // the fixed allowlisted supplier; proxy configuration never comes from a request.
      agent=new https.Agent();
      agent.createConnection=(_options,cb)=>{
        let called=false;
        const connected=(err,socket)=>{if(called||aborted){if(socket)socket.destroy();return;}called=true;cb(err,socket);};
        connection=http.request({host:proxy.hostname,port:proxy.port,method:'CONNECT',path:u.hostname+':443',headers:{Host:u.hostname+':443'}});
        connection.once('connect',(res,socket,head)=>{
          proxySocket=socket;
          if(aborted){socket.destroy();return;}
          if(res.statusCode!==200){socket.destroy();connected(Error('Price proxy refused connection'));return;}
          if(head.length)socket.unshift(head);
          secureSocket=tls.connect({socket,servername:u.hostname,rejectUnauthorized:true});
          secureSocket.once('error',connected);secureSocket.once('secureConnect',()=>connected(null,secureSocket));
        });
        connection.once('error',connected);connection.end();
      };
    }
    const req=https.get(u,{...(agent?{agent}:{}),headers:{'User-Agent':'M4KE-price-research/1.0','Accept':'text/html','Accept-Encoding':'identity'},lookup:(host,options,cb)=>{
      lookup(host,{family:4,all:true},(err,addresses)=>{
        if(err)return cb(err);
        if(!addresses.length||addresses.some(a=>!publicIpv4(a.address)))return cb(Error('Non-public supplier address'));
        const a=addresses[0];if(options.all)cb(null,[a]);else cb(null,a.address,4);
      });
    }},res=>{
      if(res.statusCode!==200){res.resume();req.destroy(Error('Supplier HTTP '+res.statusCode));return;}
      if(!/text\/html|application\/xhtml\+xml/i.test(res.headers['content-type']||'')){res.resume();req.destroy(Error('Unsupported supplier content type'));return;}
      let size=0;const chunks=[];
      res.on('data',c=>{size+=c.length;if(size>MAX_BYTES)req.destroy(Error('Supplier page too large'));else chunks.push(c);});
      res.on('error',reject);res.on('end',()=>{
        const charset=/charset\s*=\s*["']?([\w-]+)/i.exec(res.headers['content-type']||'')?.[1]||'utf-8';
        try{resolve(new TextDecoder(charset).decode(Buffer.concat(chunks)));}catch{reject(Error('Unsupported page encoding'));}
      });
    });
    const cleanup=()=>{connection?.destroy();secureSocket?.destroy();proxySocket?.destroy();agent?.destroy();};
    const timer=setTimeout(()=>{
      // An Agent awaiting CONNECT/TLS has not assigned a socket to req yet.
      // Destroying req alone does not reject or close that pending connection.
      aborted=true;const error=Error('Supplier request timed out');reject(error);req.destroy(error);cleanup();
    },timeoutMs);
    req.on('error',reject);req.on('close',()=>{clearTimeout(timer);cleanup();});
  });
}

export function extractPrices(html,url){
  if(typeof html!=='string'||Buffer.byteLength(html)>MAX_BYTES||!supplierUrl(url))return [];
  const out=[], add=(data)=>{if(amount(data.amount)&&/^[A-Z]{3}$/.test(data.currency||''))out.push({name:'',sku:null,mpn:null,variant:null,packQuantity:null,purchaseUnit:null,tax:'UNKNOWN',shipping:'UNKNOWN',availability:'UNKNOWN',...data,amount:amount(data.amount)});};
  // Structured offers belong to their enclosing product; never combine prices across products.
  const visit=(node,depth=0)=>{
    if(!node||typeof node!=='object'||depth>12)return;
    if(Array.isArray(node)){for(const n of node.slice(0,100))visit(n,depth+1);return;}
    if([node['@type']].flat().includes('Product')){
      for(const offer of [node.offers].flat().filter(Boolean).slice(0,10)){
        if(offer['@type']!=='Offer')continue; // AggregateOffer lowPrice is not this variant's price.
        // A variant is one identity scope. Never borrow another product's MPN/model.
        const identity=offer.itemOffered!==undefined
          ? (offer.itemOffered&&typeof offer.itemOffered==='object'?offer.itemOffered:{})
          : ['sku','mpn','model'].some(k=>offer[k]!==undefined)?offer:node;
        add({name:clean(identity.name),sku:clean(identity.sku)||null,mpn:clean(identity.mpn)||null,variant:clean(identity.model)||null,amount:offer.price,currency:offer.priceCurrency,availability:clean(offer.availability)||'UNKNOWN',extraction:'PRODUCT_JSON_LD'});
      }
    }
    if(node['@graph'])visit(node['@graph'],depth+1);
  };
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(attr(m[1],'type')?.toLowerCase()==='application/ld+json')try{visit(JSON.parse(m[2]));}catch{}
  }
  if(new URL(url).hostname==='www.dfrobot.com.cn'){
    const priceTags=[...html.matchAll(/<[^>]+\bid\s*=\s*["']ECS_SHOPPRICE["'][^>]*>([\s\S]*?)<\//gi)];
    const price=priceTags.length===1?clean(priceTags[0][1]).match(/^[￥¥]\s*(\d+(?:\.\d+)?)\s*$/)?.[1]:null;
    const meta=[...html.matchAll(/<div\b[^>]*>/gi)].find(m=>attr(m[0],'class')?.split(' ').includes('goodsMes'))?.[0];
    const skus=[...html.matchAll(/<div\b[^>]*class=["']content2["'][^>]*>([\s\S]*?)<\/div>/gi)].map(m=>clean(m[1])).filter(s=>/^[A-Z]{2,6}-?\d{1,6}(?:[-A-Z0-9]*)?$/.test(s));
    if(price&&(!meta||!attr(meta,'data-price')||Number(price)===Number(attr(meta,'data-price')))){
      add({name:clean(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]),sku:skus.length===1?skus[0]:null,amount:price,currency:'CNY',availability:attr(meta||'','data-stock')||'UNKNOWN',extraction:'DFROBOT_DISPLAYED_PRODUCT_PRICE'});
    }
  }
  return out.slice(0,12);
}

export const PRICE_ITEMS_SCHEMA={type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',maxLength:80},query:{type:'string',minLength:2,maxLength:120},quantity:{type:'integer',minimum:1,maximum:1000000},mpn:{type:'string',maxLength:80}},required:['id','query','quantity']}};
function validate(args){
  if(!args||Object.keys(args).some(k=>!['items','refresh'].includes(k))||!Array.isArray(args.items)||args.items.length<1||args.items.length>20||args.refresh!==undefined&&typeof args.refresh!=='boolean')throw Error('Provide 1–20 BOM items and optional refresh.');
  const ids=new Set();
  return args.items.map(i=>{
    if(!i||Object.keys(i).some(k=>!['id','query','quantity','mpn'].includes(k))||typeof i.id!=='string'||!/^[-\w]{1,80}$/.test(i.id)||ids.has(i.id)||!Number.isSafeInteger(i.quantity)||i.quantity<1||i.quantity>1000000||i.mpn!==undefined&&(typeof i.mpn!=='string'||i.mpn.length>80||!/^[\p{L}\p{N} ._+()/,-]*$/u.test(i.mpn)))throw Error('Invalid BOM identity or quantity.');
    ids.add(i.id);return {...i,query:researchQuery(i.query)};
  });
}
export function createLivePrices({root,enabled=process.env.M4KE_ALLOW_WEB==='1'&&process.env.M4KE_OFFLINE_ONLY!=='1',get=fetchSupplier,research=null,now=()=>Date.now()}={}){
  const status=()=>({enabled,providers:['DFRobot China public search',...(research?['configured source search gateway']:[])],currency:'CNY',purchaseMade:false,engineeringQualified:false});
  async function search(args){
    const items=validate(args);if(active)throw Error('A price search is already running.');active=true;
    const lines=[],started=Date.now();let networkUsed=false;
    try{
      for(const item of items){
        const file=path.join(root,'data','price-search',digest(item.query)+'.json');let saved=null;
        try{if((await stat(file)).size<256000){const r=JSON.parse(await readFile(file,'utf8'));if(r.sha256===digest(JSON.stringify(r.payload))&&Array.isArray(r.payload.offers)&&r.payload.query===item.query&&Date.parse(r.payload.retrievedAt)<=now())saved=r.payload;}}catch{}
        let result=saved&&!args.refresh&&now()-Date.parse(saved.retrievedAt)<TTL?saved:null;
        if(!enabled)result=saved||{query:item.query,status:'OFFLINE_CACHE_MISS',offers:[],issues:['Online price search is disabled.'],retrievedAt:null};
        if(!result){
          if(Date.now()-started>=60000){lines.push({...item,status:'NOT_SEARCHED_TIME_LIMIT',offers:[],issues:['Retry this item in a smaller batch.']});continue;}
          const urls=new Set(),issues=[];networkUsed=true;
          try{
            const u=new URL('https://www.dfrobot.com.cn/search.php');u.searchParams.set('keywords',item.query);
            const html=await get(u.href);
            for(const m of html.matchAll(/href\s*=\s*["'](?:https:\/\/www\.dfrobot\.com\.cn\/)?(goods-\d+\.html)["']/gi))urls.add('https://www.dfrobot.com.cn/'+m[1]);
          }catch{issues.push('DFRobot public search unavailable; no account or verification bypass attempted.');}
          if(research&&urls.size===0&&Date.now()-started<45000){
            try{const r=await research.search({query:item.query,kind:'price',refresh:args.refresh||false});for(const x of r.results||[]){const u=supplierUrl(x.url);if(u)urls.add(u);}if(!urls.size)issues.push(r.status||'No supported supplier result.');}catch{issues.push('Configured search gateway unavailable.');}
          }
          const offers=[];
          for(const url of [...urls].slice(0,3)){
            if(Date.now()-started>=60000){issues.push('Search time limit reached.');break;}
            try{const html=await get(url);const found=extractPrices(html,url).filter(o=>o.currency==='CNY');offers.push(...found.map(o=>({...o,url,sourceSha256:digest(html)})));if(!found.length)issues.push('No supported RMB price on '+url);}
            catch{issues.push('Supplier page unavailable: '+url);}
          }
          result={query:item.query,status:offers.length?'PRICE_CANDIDATES':'NO_PRICE_FOUND',offers,issues,retrievedAt:new Date(now()).toISOString()};
          try{await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify({payload:result,sha256:digest(JSON.stringify(result))}));await rename(tmp,file);}
          catch{result.issues.push('Price cache could not be saved; observations are available for this response only.');}
        }
        const normalize=s=>String(s||'').trim().toUpperCase();
        lines.push({...item,...result,cacheHit:result===saved,stale:!!result.retrievedAt&&now()-Date.parse(result.retrievedAt)>=TTL,offers:result.offers.map(o=>({...o,match:!item.mpn?'REVIEW_IDENTITY':![o.mpn,o.sku].some(Boolean)?'REVIEW_IDENTITY':[o.mpn,o.sku].some(s=>s&&normalize(s)===normalize(item.mpn))?'IDENTIFIER_MATCH_REVIEW_VARIANT':'DIFFERENT_IDENTIFIER',lineTotal:null}))});
      }
      return {...status(),lines,networkUsed,total:null,completeQuote:false,sourceContentIsData:true,observedLines:lines.filter(l=>l.offers.length).length,limitations:['Displayed prices are unselected supplier observations. Check variants, pack contents, tax, shipping and stock before using them as a BOM quote.','Search covers supported public suppliers, not every seller. Missing prices and printed-material consumption are not zero.']};
    }finally{active=false;}
  }
  async function searchDesign(spec,catalog={}){
    const rows=[];
    for(const part of spec.parts||[]){
      if(part.kind!=='purchased')continue;
      const component=part.shape?.type==='catalog'?catalog.components?.find(c=>c.id===part.shape.catalogId):null;
      const mpn=component?.mpn||component?.sku;
      rows.push({id:'part-'+rows.length,partId:part.id,query:mpn||part.name,quantity:1,unit:'piece',...(mpn?{mpn}:{})});
    }
    for(const item of spec.buildItems||[])rows.push({id:'build-'+rows.length,buildItemId:item.id,query:item.name,quantity:item.quantity,unit:item.unit});
    const lines=[],started=Date.now();let networkUsed=false;
    for(const row of rows){
      const gap=(code,message)=>lines.push({...row,status:code,offers:[],issues:[message]});
      if(!['piece','set'].includes(row.unit)||!Number.isSafeInteger(row.quantity)||row.quantity<1){gap('PURCHASE_UNIT_REQUIRED','Design consumption is not a supplier pack quantity. Confirm the purchase unit.');continue;}
      if(Date.now()-started>=60000){gap('NOT_SEARCHED_TIME_LIMIT','Automatic search time limit reached; retry this row in Procurement.');continue;}
      try{
        const {id,query,quantity,mpn}=row;
        const result=await search({items:[{id,query,quantity,...mpn?{mpn}:{}}]});
        networkUsed||=result.networkUsed;lines.push({...result.lines[0],...row});
      }catch{gap('SEARCH_UNAVAILABLE','Price lookup unavailable for this item; retry in Procurement.');}
    }
    return {...status(),automatic:true,lines,networkUsed,total:null,completeQuote:false,sourceContentIsData:true,
      observedLines:lines.filter(l=>l.offers.length).length,finishedAt:new Date(now()).toISOString(),
      status:!lines.length?'NO_PURCHASED_ITEMS':lines.every(l=>l.offers.length)?'PRICE_CANDIDATES':'PRICE_GAPS'};
  }
  return {status,search,searchDesign};
}
