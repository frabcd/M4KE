import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGenerationJson as parse} from '../server/studio-generation-json.mjs';

test('strict JSON rejects duplicate decoded keys at every depth', () => {
  for (const text of ['{"id":1,"id":2}', '{"id":1,"\\u0069d":2}', '{"a":[{"x":1,"x":2}]}']) {
    assert.throws(() => parse(text), {code:'DUPLICATE_KEY'});
  }
});
test('strict JSON rejects malformed, dangerous and unbounded input', () => {
  for (const text of ['1e999','{"constructor":1}','{"__proto__":{}}','{"prototype":1}','"unfinished','{} {}','[1,]','01','[NaN]']) assert.throws(() => parse(text));
  assert.throws(() => parse('['.repeat(65)+'0'+']'.repeat(65)), {code:'JSON_DEPTH'});
  assert.throws(() => parse(' '.repeat(262144)+'0'), {code:'JSON_SIZE'});
});
test('strict JSON preserves valid values and escaped multilingual strings', () => {
  const value = {text:'毫米 "quoted" \\ slash', array:[], number:1e-9, truth:true, nil:null};
  assert.deepEqual(parse(JSON.stringify(value)), value);
  assert.deepEqual(parse('['.repeat(64)+'0'+']'.repeat(64)), JSON.parse('['.repeat(64)+'0'+']'.repeat(64)));
});
