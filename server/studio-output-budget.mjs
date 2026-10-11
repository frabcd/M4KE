// One larger response after a measured token-limit completion. Leave context
// headroom for the prompt and retain a finite output/time ceiling.
export function truncationRecovery(config, promptEvalCount) {
  const promptTokens=Number.isInteger(promptEvalCount)&&promptEvalCount>=0?promptEvalCount:null;
  const contextAvailable=promptTokens===null?config.num_ctx-1024:config.num_ctx-promptTokens-1024;
  const num_predict=Math.min(config.num_predict*2,20000,contextAvailable);
  if(num_predict<=config.num_predict)return null;
  return {...config,num_predict,timeoutMs:Math.min(config.timeoutMs*2,1200000)};
}
