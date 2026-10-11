/** Complete, bounded JSON only. Detect duplicate *decoded* object keys before
 * JSON.parse can silently discard evidence. This never repairs model output. */
export function parseGenerationJson(text, {maxBytes=262144,maxDepth=64}={}) {
  const fail=(code)=>{throw Object.assign(new Error(code),{code});};
  if(typeof text!=='string'||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(maxDepth)||maxDepth<1) fail('JSON_INPUT');
  if(Buffer.byteLength(text,'utf8')>maxBytes) fail('JSON_SIZE');
  let i=0;
  const ws=()=>{while(/[\x20\t\n\r]/.test(text[i]??'!')) i++;};
  function string() {
    const start=i++;
    while(i<text.length){
      const c=text[i++];
      if(c==='"'){try{return JSON.parse(text.slice(start,i));}catch{fail('JSON_SYNTAX');}}
      if(c==='\\') i++;
    }
    fail('JSON_SYNTAX');
  }
  function value(depth) {
    ws(); const c=text[i];
    if(c==='{'||c==='['){
      if(depth>=maxDepth) fail('JSON_DEPTH');
      const end=c==='{'?'}':']',keys=new Set();i++;ws();
      if(text[i]===end){i++;return;}
      while(i<text.length){
        if(c==='{'){
          if(text[i]!=='"') fail('JSON_SYNTAX');
          const key=string();
          if(keys.has(key)) fail('DUPLICATE_KEY');
          if(['__proto__','prototype','constructor'].includes(key)) fail('UNSAFE_KEY');
          keys.add(key);ws();if(text[i++]!==':') fail('JSON_SYNTAX');
        }
        value(depth+1);ws();
        if(text[i]===end){i++;return;}
        if(text[i++]!==',') fail('JSON_SYNTAX');ws();
      }
      fail('JSON_SYNTAX');
    }
    if(c==='"'){string();return;}
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if(!match) fail('JSON_SYNTAX');
    if(!['true','false','null'].includes(match[0])&&!Number.isFinite(Number(match[0]))) fail('JSON_NUMBER');
    i+=match[0].length;
  }
  value(0);ws();if(i!==text.length) fail('JSON_SYNTAX');
  return JSON.parse(text);
}
