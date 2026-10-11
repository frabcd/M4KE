import test from 'node:test';
import assert from 'node:assert/strict';
import {truncationRecovery} from '../server/studio-output-budget.mjs';
const config={think:false,num_predict:10000,num_ctx:65536,timeoutMs:600000};
test('measured 20124-token prompt permits one doubled response/time budget',()=>{
  assert.deepEqual(truncationRecovery(config,20124),{...config,num_predict:20000,timeoutMs:1200000});
  assert.equal(config.num_predict,10000);
});
test('recovery reserves prompt context and never retries with the same or smaller budget',()=>{
  assert.equal(truncationRecovery(config,50000).num_predict,14512);
  assert.equal(truncationRecovery(config,55000),null);
  assert.equal(truncationRecovery({...config,num_predict:20000},20124),null);
});
test('missing/invalid metrics use finite limits; geometry patches also remain bounded',()=>{
  for(const value of [undefined,null,-1,NaN,Infinity])assert.equal(truncationRecovery(config,value).num_predict,20000);
  assert.equal(truncationRecovery({...config,num_predict:4500},20124).num_predict,9000);
});
