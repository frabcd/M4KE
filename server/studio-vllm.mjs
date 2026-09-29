import {validateEndpoint, validateModel} from './studio-inference-config.mjs';

/** Explicit local vLLM transport. No bridge daemon, cloud fallback or secret. */
export async function vllmFetch(endpoint, pathname, options = {}, timeout = 3000, signal, onProgress) {
  endpoint = validateEndpoint(endpoint);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const started = performance.now();
  if (pathname === '/api/tags') {
    const response = await fetch(endpoint + '/v1/models', {signal:combined, redirect:'error'});
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Local vLLM model discovery returned HTTP ${response.status}.`); }
    let text = '', bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 1048576) throw new Error('Local model inventory exceeds its limit.'); text += decoder.decode(chunk, {stream:true}); }
    const data = JSON.parse(text + decoder.decode());
    if (!Array.isArray(data.data) || data.data.length > 1000) throw new Error('Endpoint is not a compatible local vLLM service.');
    return {models:data.data.map(model => ({name:validateModel(model.id),size:0,digest:'',details:{family:'vLLM'},maxModelLength:model.max_model_len??null})).filter(model=>model.name)};
  }
  if (pathname !== '/api/chat' || typeof options.body !== 'string') throw new Error('Unsupported local vLLM operation.');
  const input = JSON.parse(options.body), model = validateModel(input.model);
  if (!model || !Array.isArray(input.messages)) throw new Error('A local model and messages are required.');
  const payload = {model,messages:input.messages,temperature:input.options?.temperature??0.2,max_tokens:input.options?.num_predict??2000,
    stream:true,stream_options:{include_usage:true},chat_template_kwargs:{enable_thinking:input.think===true},include_reasoning:false};
  if (input.format === 'json') payload.response_format = {type:'json_object'};
  else if (input.format && typeof input.format === 'object' && !Array.isArray(input.format)) payload.response_format = {type:'json_schema',json_schema:{name:'m4ke_response',strict:true,schema:input.format}};
  else if (input.format !== undefined) throw new Error('Unsupported structured response format.');
  // num_ctx is an Ollama allocation option. vLLM uses its server startup limit;
  // do not silently truncate messages, rewrite the schema or pretend to set it.
  let firstContentMs = null, lastProgress = -1000, content = '', usage = null, finish = null, terminal = false, bytes = 0;
  async function progress(phase, force = false) {
    const elapsedMs = Math.round(performance.now()-started);
    if (typeof onProgress === 'function' && (force || elapsedMs-lastProgress >= 1000)) {
      lastProgress = elapsedMs;
      await onProgress({phase,elapsedMs,firstContentMs,outputCharacters:content.length,provider:'vllm'});
    }
  }
  await progress('waiting',true);
  const response = await fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:combined,redirect:'error'});
  if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Local vLLM returned HTTP ${response.status}; no model or format fallback was attempted.`),{upstreamStatus:response.status,infrastructureRetries:0}); }
  function event(block) {
    const data = block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n').trim();
    if (!data) return;
    if (terminal) throw new Error('Local vLLM sent data after completion.');
    if (data === '[DONE]') { terminal = true; return; }
    const item = JSON.parse(data);
    if (item.error) throw new Error('Local vLLM reported an inference error; no complete reply accepted.');
    if (item.model && item.model !== model) throw new Error('Local vLLM returned a different model identity.');
    if (Array.isArray(item.choices) && item.choices.length > 1) throw new Error('Expected exactly one local completion.');
    const choice = item.choices?.[0];
    if (choice?.delta?.tool_calls?.length) throw new Error('Unexpected executable tool call in a data-only response.');
    const fragment = choice?.delta?.content;
    if (typeof fragment === 'string' && fragment) {
      if (finish) throw new Error('Local vLLM sent content after its finish reason.');
      firstContentMs ??= Math.round(performance.now()-started);content += fragment;
      if (content.length > 120000) throw new Error('Local model output exceeded its limit.');
    }
    if (choice?.finish_reason) { if (finish) throw new Error('Duplicate local completion reason.'); finish=choice.finish_reason; }
    if (item.usage) usage=item.usage;
    // Reasoning fields are intentionally neither returned nor logged.
  }
  const reader=response.body.getReader(), decoder=new TextDecoder();let pending='';
  try {
    for (;;) {
      const {done,value}=await reader.read();if(done)break;
      bytes += value.byteLength;if(bytes>8388608)throw new Error('Local inference stream exceeded its limit.');
      pending += decoder.decode(value,{stream:true});pending=pending.replace(/\r\n/g,'\n');
      let end;while((end=pending.indexOf('\n\n'))>=0){event(pending.slice(0,end));pending=pending.slice(end+2);}
      await progress(content.length?'generating':'waiting');
    }
    pending += decoder.decode();if(pending.trim())event(pending);
    if(!terminal || !['stop','length'].includes(finish))throw new Error('Local inference ended without a valid completion record.');
    if(!content.trim())throw new Error('Local model returned no visible answer.');
    const count = key => Number.isSafeInteger(usage?.[key]) && usage[key]>=0 ? usage[key] : null;
    const elapsedMs=Math.round(performance.now()-started);
    await progress('response_received',true);
    return {done:true,done_reason:finish,model,message:{role:'assistant',content},eval_count:count('completion_tokens'),prompt_eval_count:count('prompt_tokens'),total_duration:elapsedMs*1000000,
      inferenceMetrics:{provider:'vllm',firstContentMs,elapsedMs,outputCharacters:content.length,infrastructureRetries:0,contextLimitSource:'vLLM server configuration'}};
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
}
