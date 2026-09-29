import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { canonicalJson, sha256, validateSnapshot, verifyBundle, quoteLine } from '../procurement/snapshot.mjs';
import { importSnapshot, readImportedSnapshot, quoteImportedSnapshot } from '../procurement/import.mjs';

const NOW = Date.parse('2026-09-27T09:00:00Z');
const captured = '2026-09-27T08:48:00Z';
const bytes = Buffer.from('Supplier fixture, not a real price.');
const digest = sha256(bytes);
function fixture() {
  return { schemaVersion: 1, snapshotId: 'test', createdAt: captured,
    evidence: [{ id: 'source', url: 'https://www.example.com/product', capturedAt: captured, sourceUpdatedAt: null, method: 'direct-http', access: 'public', file: `evidence/${digest}.txt`, sha256: digest, contentType: 'text/plain', extraction: 'Test fixture only.' }],
    entries: [{ id: 'part', kind: 'component', supplierId: 'test-supplier', market: 'CN', identity: { manufacturer: 'Test manufacturer', mpn: 'MPN-1', supplierSku: 'SKU-1', variant: 'No headers', package: 'Each', manufacturerRevision: null }, evidenceIds: ['source'],
      price: { status: 'observed-tiers', currency: 'CNY', unit: 'piece', tiers: [{ minimumQuantity: 1, unitPrice: '0.10' }, { minimumQuantity: 10, unitPrice: '0.08' }], advertisedAmount: null, tax: 'included', shipping: 'unknown', evidenceId: 'source' },
      availability: { status: 'unknown', quantity: null, unit: null, evidenceId: 'source' }, minimumOrderQuantity: 1, orderMultiple: 1, specs: [],
      relatesTo: { catalogId: null, relationship: 'unqualified-candidate', note: 'No physical qualification.' }, notes: [] }] };
}
const request = (snapshot, extra = {}) => { const e = snapshot.entries[0]; return { entryId: e.id, manufacturer: e.identity.manufacturer, mpn: e.identity.mpn, supplierSku: e.identity.supplierSku, variant: e.identity.variant, quantity: 3, unit: 'piece', currency: 'CNY', ...extra }; };
async function tempBundle(t, snapshot = fixture()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-procurement-')); t.after(() => rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'incoming', 'fixture'); await mkdir(path.join(bundle, 'evidence'), { recursive: true });
  await writeFile(path.join(bundle, 'snapshot.json'), JSON.stringify(snapshot)); await writeFile(path.join(bundle, snapshot.evidence[0].file), bytes);
  return { root, bundle, snapshot };
}

test('procurement strict schema accepts exact dated supplier observation', () => assert.equal(validateSnapshot(fixture(), { now: NOW }).schemaVersion, 1));
test('procurement rejects unknown fields, stale schema, missing identity and getters', () => {
  for (const mutate of [s => { s.apiKey = 'not-a-key'; }, s => { s.schemaVersion = 2; }, s => { delete s.entries[0].identity.mpn; }, s => { Object.defineProperty(s.entries[0].identity, 'mpn', { get() { throw Error('getter executed'); }, enumerable: true }); }]) {
    const s = fixture(); mutate(s); assert.throws(() => validateSnapshot(s, { now: NOW }), /snapshot:/i);
  }
});
test('procurement forbids URL credentials, local IPs, secret query and non-HTTPS', () => {
  for (const url of ['https://user:secret@example.com/p', 'https://127.0.0.1/a', 'https://device.local/a', 'https://example.com/p?token=x', 'file:///C:/secret', 'http://example.com/a']) {
    const s = fixture(); s.evidence[0].url = url; assert.throws(() => validateSnapshot(s, { now: NOW }));
  }
});
test('procurement refuses invented price fields, negative prices, unsorted tiers and stocks', () => {
  for (const mutate of [s => { s.entries[0].price.tiers[0].unitPrice = -1; }, s => { s.entries[0].price.tiers[0].unitPrice = '-1'; }, s => { s.entries[0].price.tiers.reverse(); }, s => { s.entries[0].availability.quantity = 0; }, s => { s.entries[0].price.status = 'unavailable'; }, s => { s.entries[0].price.tiers[0].unitPrice = 'NaN'; }]) {
    const s = fixture(); mutate(s); assert.throws(() => validateSnapshot(s, { now: NOW }));
  }
});
test('procurement rejects future timestamps and mismatched evidence references', () => {
  const future = fixture(); future.evidence[0].capturedAt = '2099-01-01T00:00:00Z'; assert.throws(() => validateSnapshot(future, { now: NOW }), /future/);
  const missing = fixture(); missing.entries[0].price.evidenceId = 'unrelated'; assert.throws(() => validateSnapshot(missing, { now: NOW }), /reference/);
  const impossible = fixture(); impossible.evidence[0].capturedAt = '2026-02-30T08:00:00Z'; assert.throws(() => validateSnapshot(impossible, { now: NOW }), /calendar/);
});
test('procurement strict hash-addressed evidence paths reject traversal and wrong SHA names', () => {
  for (const file of ['../secret.txt', 'evidence/../../secret.txt', '/etc/passwd', `evidence/${'a'.repeat(64)}.txt`, `evidence/${digest}.js`]) {
    const s = fixture(); s.evidence[0].file = file; assert.throws(() => validateSnapshot(s, { now: NOW }), /filename/);
  }
});
test('procurement integrity is not source truth or an engineering approval', async t => {
  const { snapshot, bundle } = await tempBundle(t); const result = await verifyBundle(snapshot, bundle, { now: NOW });
  assert.equal(result.semanticClaimsVerified, false); assert.equal(result.networkUsed, false); assert.equal(result.totalBytes, bytes.length);
});
test('procurement rejects tampered raw evidence', async t => {
  const { snapshot, bundle } = await tempBundle(t); await writeFile(path.join(bundle, snapshot.evidence[0].file), 'changed');
  await assert.rejects(verifyBundle(snapshot, bundle, { now: NOW }), /hash mismatch/);
});
test('procurement symlinked evidence directory is rejected', async t => {
  const { snapshot, bundle, root } = await tempBundle(t); const dir = path.join(bundle, 'evidence');
  await rm(dir, { recursive: true }); const outside = path.join(root, 'outside'); await mkdir(outside); await writeFile(path.join(outside, `${digest}.txt`), bytes);
  await symlink(outside, dir, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyBundle(snapshot, bundle, { now: NOW }), /real directory/);
});
test('procurement exact decimal arithmetic and tiers; no definitive landed total', () => {
  const s = fixture(); const a = quoteLine(s, request(s), { now: NOW });
  assert.equal(a.subtotal, '0.300000'); assert.equal(a.status, 'INDICATIVE_ONLY'); assert.equal(a.purchaseAuthorized, false); assert.equal(a.engineeringQualified, false);
  assert.ok(a.reasons.includes('LANDED_COST_INCOMPLETE')); assert.ok(a.reasons.includes('AVAILABILITY_NOT_CONFIRMED'));
  assert.equal(quoteLine(s, request(s, { quantity: 10 }), { now: NOW }).subtotal, '0.800000');
});
test('procurement never substitutes identity, variants, currency or units', () => {
  const s = fixture(); for (const extra of [{ mpn: 'OTHER' }, { manufacturer: 'Other' }, { supplierSku: 'OTHER' }, { variant: 'With headers' }, { currency: 'USD' }, { unit: 'pack' }]) assert.throws(() => quoteLine(s, request(s, extra), { now: NOW }), /mismatch/);
});
test('procurement quantity, MOQ and order multiple enforced without rounding', () => {
  const s = fixture(); s.entries[0].minimumOrderQuantity = 5; s.entries[0].orderMultiple = 5;
  assert.deepEqual(quoteLine(s, request(s), { now: NOW }).reasons, ['BELOW_MOQ']);
  assert.deepEqual(quoteLine(s, request(s, { quantity: 7 }), { now: NOW }).reasons, ['ORDER_MULTIPLE_MISMATCH']);
  assert.throws(() => quoteLine(s, request(s, { quantity: 1.5 }), { now: NOW }));
});
test('procurement expired observation is stale, never zero price or fresh quote', () => {
  const s = fixture(); const q = quoteLine(s, request(s), { now: NOW + 25 * 3600000 }); assert.equal(q.status, 'STALE'); assert.equal(q.subtotal, null);
  assert.throws(() => quoteLine(s, request(s), { now: NOW, maxAgeHours: 999999 }));
});
test('procurement retrieved search extraction is not freshly observed pricing', () => {
  const s = fixture(); s.evidence[0].method = 'web-extract'; const q = quoteLine(s, request(s), { now: NOW }); assert.equal(q.status, 'UNQUOTABLE'); assert.ok(q.reasons.includes('EXTRACTION_FRESHNESS_UNVERIFIED'));
});
test('procurement advertised/no-price entries never infer a quantity price', () => {
  for (const status of ['advertised-only', 'unavailable', 'login-required', 'not-found']) {
    const s = fixture(); Object.assign(s.entries[0].price, { status, tiers: [], advertisedAmount: status === 'advertised-only' ? '7.27' : null });
    assert.equal(quoteLine(s, request(s), { now: NOW }).subtotal, null);
  }
});
test('procurement import is idempotent, content addressed and does not contact network/printers', async t => {
  const { root } = await tempBundle(t); const oldFetch = globalThis.fetch; globalThis.fetch = () => { throw Error('Network is forbidden in offline import'); }; t.after(() => { globalThis.fetch = oldFetch; });
  const first = await importSnapshot('fixture', { root, now: NOW }); const second = await importSnapshot('fixture', { root, now: NOW });
  assert.equal(first.imported, true); assert.equal(second.imported, false); assert.equal(first.snapshotId, second.snapshotId); assert.equal(first.networkUsed, false); assert.equal(first.purchaseMade, false); assert.equal(first.printerContacted, false);
  const read = await readImportedSnapshot(first.snapshotId, { root, now: NOW }); assert.equal(sha256(canonicalJson(read.snapshot)), first.snapshotId);
  const q = await quoteImportedSnapshot(first.snapshotId, request(read.snapshot), { root, now: NOW }); assert.equal(q.subtotal, '0.300000'); assert.equal(q.snapshotSha256, first.snapshotId);
});
test('procurement imported manifest/evidence are rechecked after storage', async t => {
  const { root } = await tempBundle(t); const receipt = await importSnapshot('fixture', { root, now: NOW }); const manifest = path.join(root, receipt.directory, 'snapshot.json');
  const s = JSON.parse(await readFile(manifest)); s.entries[0].price.tiers[0].unitPrice = '99'; await writeFile(manifest, JSON.stringify(s));
  await assert.rejects(readImportedSnapshot(receipt.snapshotId, { root, now: NOW }), /manifest hash/);
  await assert.rejects(importSnapshot('fixture', { root, now: NOW }), /manifest hash/);
});
test('procurement importer refuses arbitrary input/output paths', async t => {
  const { root } = await tempBundle(t); for (const name of ['../fixture', 'C:\\secret', '/tmp/fixture', '.hidden', 'fixture/sub']) await assert.rejects(importSnapshot(name, { root, now: NOW }), /bundle name/);
  await assert.rejects(readImportedSnapshot('../other', { root, now: NOW }), /SHA256/);
});
test('procurement recorded primary bundle verifies all three exact raw sources', { skip: !existsSync(fileURLToPath(new URL('../procurement/incoming/primary-cn-20260927/snapshot.json', import.meta.url))) && 'Private raw supplier fixture not included in source release; synthetic contract tests still run.' }, async () => {
  const bundle = fileURLToPath(new URL('../procurement/incoming/primary-cn-20260927/', import.meta.url)); const s = JSON.parse(await readFile(path.join(bundle, 'snapshot.json')));
  const v = await verifyBundle(s, bundle, { now: NOW }); assert.equal(v.files.length, 3); assert.equal(v.totalBytes, 2582820); assert.equal(s.entries.length, 4);
  const q = quoteLine(s, request(s, { quantity: 1 }), { now: NOW }); assert.equal(q.currency, 'CNY'); assert.equal(q.unitPrice, '29.25'); assert.equal(q.tax, 'excluded');
  const driver = s.entries.find(e => e.id === 'lcsc-c50506-drv8833pwpr'); assert.equal(driver.price.status, 'advertised-only'); assert.equal(driver.availability.status, 'unknown'); assert.equal(driver.relatesTo.relationship, 'not-equivalent');
  const material = s.entries.find(e => e.kind === 'material'); assert.equal(material.identity.supplierSku, null); assert.equal(material.price.status, 'not-found'); assert.ok(material.specs.find(x => x.name === 'Tensile strength Z').conditions.includes('100% infill'));
});
