import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createProcurementService, PROCUREMENT_SNAPSHOT } from '../server/studio-procurement.mjs';
import { importSnapshot } from '../procurement/import.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NOW = Date.parse('2026-09-27T09:00:00Z');
const request = { method: 'GET' };
const route = '/api/studio/procurement';
const sourceFixture = { skip: !existsSync(path.join(ROOT, 'procurement/incoming/primary-cn-20260927/snapshot.json')) && 'Private raw supplier fixture absent; release excludes copyrighted supplier pages. Pure API boundary tests still run.' };
function harness(root = ROOT, now = NOW) {
  const calls = [];
  return { calls, handle: createProcurementService({ root, now: () => now, json: (_res, status, value) => calls.push({ status, value }) }) };
}
async function isolated(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-procurement-api-')); t.after(() => rm(root, { recursive: true, force: true }));
  await cp(path.join(ROOT, 'procurement/incoming/primary-cn-20260927'), path.join(root, 'procurement/incoming/primary-cn-20260927'), { recursive: true });
  await importSnapshot('primary-cn-20260927', { root: path.join(root, 'procurement'), now: NOW }); return root;
}

test('procurement API exposes four hash-verified references, not complete BOM or adoption', sourceFixture, async t => {
  const h = harness(await isolated(t)); assert.equal(await h.handle(request, {}, route), true); const { status, value } = h.calls[0];
  assert.equal(status, 200); assert.equal(value.snapshotSha256, PROCUREMENT_SNAPSHOT); assert.equal(value.entries.length, 4); assert.equal(value.verifiedEvidenceBytes, 2582820);
  assert.equal(value.evidenceIntegrity, 'PASS'); assert.equal(value.semanticClaimsVerified, false); assert.equal(value.completeBom, false); assert.equal(value.defaultMaterial, null); assert.equal(value.purchaseMade, false); assert.equal(value.liveSupplierConnected, false); assert.equal(value.networkUsed, false);
  assert.equal(value.entries[0].quote.subtotal, '29.250000'); assert.equal(value.entries[0].price.currency, 'CNY'); assert.equal(value.entries[0].price.tax, 'excluded');
  for (const e of value.entries) { assert.equal(e.quote.purchaseAuthorized, false); assert.equal(e.quote.engineeringQualified, false); }
});
test('procurement API has only exact GET route, no import/order/material mutations', async () => {
  const h = harness();
  for (const [method, url] of [['POST', route], ['DELETE', route], ['PUT', route], ['GET', `${route}/order`], ['GET', `${route}/../../secret`], ['GET', `${route}/import`]]) assert.equal(await h.handle({ method }, {}, url), false);
  assert.equal(h.calls.length, 0);
});
test('procurement API preserves bare-IC and header variants and material conditions', sourceFixture, async t => {
  const h = harness(await isolated(t)); await h.handle(request, {}, route); const entries = h.calls[0].value.entries;
  const picoH = entries.find(e => e.identity.supplierSku === '3996081'); assert.equal(picoH.relatesTo.relationship, 'not-equivalent'); assert.equal(picoH.quote.subtotal, '36.580000');
  const driver = entries.find(e => e.identity.supplierSku === 'C50506'); assert.equal(driver.relatesTo.catalogId, 'pololu-drv8833-2130'); assert.equal(driver.relatesTo.relationship, 'not-equivalent'); assert.equal(driver.price.advertisedAmount, '7.27'); assert.equal(driver.quote.subtotal, null); assert.equal(driver.availability.status, 'unknown');
  const material = entries.find(e => e.kind === 'material'); assert.equal(material.identity.supplierSku, null); assert.equal(material.quote.subtotal, null); assert.equal(material.price.freshness, 'UNKNOWN');
  assert.ok(material.specs.find(s => s.name === 'Tensile strength Z').conditions.includes('annealed/dried 55 C for 8 h'));
});
test('procurement API ages captured prices without online refresh or silent fallback', sourceFixture, async t => {
  const h = harness(await isolated(t), NOW + 48 * 3600000); const previous = globalThis.fetch; globalThis.fetch = () => { throw Error('No supplier/model requests'); };
  try { await h.handle(request, {}, route); } finally { globalThis.fetch = previous; }
  assert.equal(h.calls[0].status, 200);
  const pico = h.calls[0].value.entries[0]; assert.equal(pico.price.freshness, 'STALE'); assert.equal(pico.quote.status, 'STALE'); assert.equal(pico.quote.subtotal, null);
  assert.equal(pico.price.tiers[0].unitPrice, '29.25', 'historical observation retained but not a fresh quote');
});
test('procurement API never exposes raw HTML or local evidence paths', sourceFixture, async t => {
  const h = harness(await isolated(t)); await h.handle(request, {}, route); const text = JSON.stringify(h.calls[0].value);
  for (const secret of ['<html', '<script', ROOT, 'evidence/', 'import-receipt.json', 'window.__APOLLO_STATE__ = {']) assert.equal(text.includes(secret), false);
  assert.ok(h.calls[0].value.entries[0].sources[0].url.startsWith('https://www.element14.cn/'));
});
test('procurement API is unavailable, not zero-cost, when pinned snapshot is absent', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-procurement-missing-')); t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root); await h.handle(request, {}, route); assert.equal(h.calls[0].status, 503); assert.equal(h.calls[0].value.available, false); assert.deepEqual(h.calls[0].value.entries, []); assert.equal(JSON.stringify(h.calls[0]).includes(root), false);
});
test('procurement API rehashes evidence every call and rejects mutation after success', sourceFixture, async t => {
  const root = await isolated(t), h = harness(root); await h.handle(request, {}, route); assert.equal(h.calls[0].status, 200);
  const folder = path.join(root, 'procurement/snapshots', PROCUREMENT_SNAPSHOT); const snapshot = JSON.parse(await readFile(path.join(folder, 'snapshot.json')));
  await writeFile(path.join(folder, snapshot.evidence[0].file), 'tampered raw supplier bytes'); await h.handle(request, {}, route);
  assert.equal(h.calls[1].status, 503); assert.equal(h.calls[1].value.evidenceIntegrity, 'NOT_VERIFIED'); assert.deepEqual(h.calls[1].value.entries, []);
});
test('procurement API rejects a price-edited manifest under the old pinned directory', sourceFixture, async t => {
  const root = await isolated(t), h = harness(root); const file = path.join(root, 'procurement/snapshots', PROCUREMENT_SNAPSHOT, 'snapshot.json');
  const s = JSON.parse(await readFile(file)); s.entries[0].price.tiers[0].unitPrice = '0.01'; await writeFile(file, JSON.stringify(s));
  await h.handle(request, {}, route); assert.equal(h.calls[0].status, 503); assert.deepEqual(h.calls[0].value.entries, []);
});
test('procurement API response failure does not produce a second response', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-procurement-disconnect-')); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0; const handle = createProcurementService({ root, now: () => NOW, json: () => { calls++; throw Error('disconnected'); } });
  await assert.rejects(handle(request, {}, route), /disconnected/); assert.equal(calls, 1);
});
test('procurement API bounds read concurrency at two and releases on failure', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-procurement-bounded-')); t.after(() => rm(root, { recursive: true, force: true }));
  const h = harness(root); const first = h.handle(request, {}, route), second = h.handle(request, {}, route);
  await h.handle(request, {}, route); assert.equal(h.calls[0].status, 429); assert.deepEqual(h.calls[0].value.entries, []);
  await Promise.all([first, second]); assert.deepEqual(h.calls.slice(1).map(c => c.status), [503, 503]);
  await h.handle(request, {}, route); assert.equal(h.calls.at(-1).status, 503, 'failed reads release slots');
});
