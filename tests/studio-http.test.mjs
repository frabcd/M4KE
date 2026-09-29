import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {sendArtifact} from '../server/studio-http.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const large = Buffer.alloc(65536, 'native CAD canonical bytes\n');
async function send(encoding, bytes = large, headers = {'Content-Type':'model/stl'}, method = 'GET') {
  const response = {};
  await sendArtifact({method, headers:encoding === undefined ? {} : {'accept-encoding':encoding}}, {
    writeHead(status, result) { response.status = status; response.headers = result; },
    end(body) { response.body = body; },
  }, bytes, headers);
  return response;
}

test('gzip transport round trips exact canonical bytes and hash without mutating headers or input', async () => {
  const before = Buffer.from(large), hash = sha(large);
  const headers = {'Content-Type':'model/stl','Content-Length':large.length,'Content-Disposition':'attachment; filename="chassis.stl"','Cache-Control':'no-store','X-Artifact-SHA256':hash};
  const original = {...headers};
  const result = await send('br, gzip', large, headers);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.equal(result.headers['Content-Length'], result.body.length);
  assert.equal(result.headers.Vary, 'Accept-Encoding');
  assert.equal(result.headers['Content-Disposition'], original['Content-Disposition']);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['X-Artifact-SHA256'], hash);
  assert.deepEqual(gunzipSync(result.body), before);
  assert.equal(sha(gunzipSync(result.body)), hash);
  assert.deepEqual(large, before);
  assert.deepEqual(headers, original);
});

test('explicit q=0 refuses gzip even when wildcard or a conflicting duplicate allows it', async () => {
  for (const encoding of ['gzip;q=0','br, gzip;q=0.000','gzip;q=0, *;q=1','*;q=1, gzip;q=0','gzip, gzip;q=0','gzip;q=invalid']) {
    const result = await send(encoding);
    assert.equal(result.headers['Content-Encoding'], undefined, encoding);
    assert.strictEqual(result.body, large, encoding);
  }
});

test('quality, wildcard, casing and positive gzip negotiation are supported', async () => {
  for (const encoding of ['gzip;q=0.1','GZip ; q=1.000','*;q=0.5','gzip;q=1, *;q=0']) {
    const result = await send(encoding);
    assert.equal(result.headers['Content-Encoding'], 'gzip', encoding);
    assert.deepEqual(gunzipSync(result.body), large);
  }
});

test('no accepted encoding and short artifacts preserve the original body and legacy headers', async () => {
  const headers = {'Content-Type':'model/stl','content-length':large.length,'X-Legacy':'preserved'};
  for (const encoding of [undefined,'','br','x-gzip','gzipx','*;q=0']) {
    const result = await send(encoding, large, headers);
    assert.strictEqual(result.body, large);
    assert.equal(result.headers['Content-Encoding'], undefined);
    assert.equal(result.headers['content-length'], large.length);
    assert.equal(result.headers['X-Legacy'], 'preserved');
  }
  for (const length of [0, 12, 65535]) {
    const bytes = Buffer.alloc(length, 65), result = await send('gzip', bytes);
    assert.strictEqual(result.body, bytes);
    assert.equal(result.headers['Content-Encoding'], undefined);
  }
});

test('compression is restricted to STL, JSON, JavaScript and CSS MIME types', async () => {
  for (const type of ['model/stl','application/json; charset=utf-8','application/javascript','text/javascript','text/css']) {
    const result = await send('gzip', large, {'content-type':type});
    assert.equal(result.headers['Content-Encoding'], 'gzip', type);
  }
  for (const type of ['application/zip','application/octet-stream','image/png','text/html','model/step']) {
    const result = await send('gzip', large, {'Content-Type':type});
    assert.strictEqual(result.body, large, type);
    assert.equal(result.headers['Content-Encoding'], undefined);
  }
});

test('Vary is merged case-insensitively and wildcard is preserved', async () => {
  for (const [vary, expected] of [['Origin','Origin, Accept-Encoding'],['Origin, accept-encoding','Origin, accept-encoding'],['*','*']]) {
    const result = await send('gzip', large, {'Content-Type':'model/stl',vary});
    assert.equal(result.headers.Vary, expected);
    assert.equal(result.headers.vary, undefined);
  }
});

test('existing content encoding and range responses are not transformed', async () => {
  for (const extra of [{'Content-Encoding':'br'},{'Content-Range':'bytes 0-65535/80000'}]) {
    const result = await send('gzip', large, {'Content-Type':'model/stl',...extra});
    assert.strictEqual(result.body, large);
    for (const [key, value] of Object.entries(extra)) assert.equal(result.headers[key], value);
  }
});

test('compressed response replaces mixed-case length and incompatible transfer encoding; HEAD has no body', async () => {
  const result = await send('gzip', large, {'Content-Type':'model/stl','content-length':large.length,'Transfer-Encoding':'chunked'}, 'HEAD');
  assert.equal(result.headers['Content-Encoding'], 'gzip');
  assert.ok(result.headers['Content-Length'] < large.length);
  assert.equal(result.headers['content-length'], undefined);
  assert.equal(result.headers['Transfer-Encoding'], undefined);
  assert.equal(result.body, undefined);
});
