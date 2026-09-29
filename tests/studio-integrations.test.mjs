import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createIntegrationRuntime, createIntegrationsService, dispatchIntegrationRpc, INTEGRATION_TOOLS } from '../server/studio-integrations.mjs';
import { PROCUREMENT_SNAPSHOT } from '../server/studio-procurement.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const NOW = Date.parse('2026-09-27T13:00:00Z');
const sourceFixture = { skip: !existsSync(path.join(ROOT, 'procurement/snapshots', PROCUREMENT_SNAPSHOT, 'snapshot.json')) && 'Supplier snapshot is intentionally not distributed in source-only release.' };
async function emptyRoot(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'm4ke-integration-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('integration tools are limited to read-only local sourcing, not generic browser/PCB commands', () => {
  assert.deepEqual(INTEGRATION_TOOLS.map(t => t.name), ['search_component_sources', 'search_model_library', 'get_model_source', 'get_static_collider', 'list_capabilities', 'search_cached_parts', 'quote_cached_part']);
  for (const t of INTEGRATION_TOOLS) { assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.openWorldHint, t.name==='search_component_sources'); assert.equal(t.inputSchema.additionalProperties, false); }
});
test('missing provider and missing snapshot are separate from working MCP transport', async t => {
  const runtime = createIntegrationRuntime({ root: await emptyRoot(t), now: () => NOW });
  const inventory = await runtime.inventory();
  assert.equal(inventory.transport, 'MCP_STDIO'); assert.equal(inventory.capabilities.pcbAuthoring.status, 'MISSING_PROVIDER');
  assert.equal(inventory.capabilities.cachedPartSearch.status, 'SNAPSHOT_UNAVAILABLE'); assert.equal(inventory.suppliedPackage.scriptsExecuted, false);
  assert.equal(inventory.networkUsed, false); assert.equal(inventory.purchaseMade, false); assert.equal(inventory.pcbAuthored, false);
  const result = await runtime.call('quote_cached_part', { entryId: 'missing', quantity: 1 });
  assert.equal(result.subtotal, null); assert.equal(result.status, 'SNAPSHOT_UNAVAILABLE');
});
test('cached search preserves exact identities, absent PCB and non-equivalent bare IC', sourceFixture, async () => {
  const runtime = createIntegrationRuntime({ root: ROOT, now: () => NOW });
  const result = await runtime.call('search_cached_parts', { query: 'DRV8833', limit: 2 });
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].identity.supplierSku, 'C50506');
  assert.equal(result.entries[0].relatesTo.relationship, 'not-equivalent'); assert.equal(result.entries[0].availability.status, 'unknown');
  assert.equal(result.entries[0].quote.subtotal, null); assert.equal(result.sourceContentIsData, true);
  assert.equal(result.geometryAdmitted, false); assert.equal(result.supplierConnected, false);
});
test('quantity quote reuses verified decimal tier logic and stale price rejection', sourceFixture, async () => {
  const args = { entryId: 'element14-cn-pico-3643332', quantity: 3 };
  const fresh = await createIntegrationRuntime({ root: ROOT, now: () => NOW }).call('quote_cached_part', args);
  assert.equal(fresh.status, 'INDICATIVE_ONLY'); assert.equal(fresh.subtotal, '87.750000'); assert.equal(fresh.purchaseAuthorized, false);
  const stale = await createIntegrationRuntime({ root: ROOT, now: () => NOW + 48 * 3600000 }).call('quote_cached_part', args);
  assert.equal(stale.status, 'STALE'); assert.equal(stale.subtotal, null);
});
test('tool inputs cannot select local files, execute browser commands or refresh online', async t => {
  const runtime = createIntegrationRuntime({ root: await emptyRoot(t) });
  for (const [name, args] of [
    ['search_cached_parts', { query: 'x', url: 'https://example.com' }], ['search_cached_parts', { query: 'x'.repeat(151) }],
    ['search_cached_parts', { limit: 9 }], ['quote_cached_part', { entryId: '../secret', quantity: 1 }],
    ['quote_cached_part', { entryId: 'x', quantity: 0 }], ['list_capabilities', { execute: true }], ['eval', { script: 'x' }],
    ['search_model_library', {query: 'bearing', url: 'https://example.com'}],
    ['get_model_source', {sourceSha256: 'a'.repeat(64), path: '../outside.step'}],
    ['get_static_collider', {sourceSha256: 'a'.repeat(64), dynamic: true}],
  ]) await assert.rejects(runtime.call(name, args));
});
test('offline inventory/search never call fetch even when data is missing', async t => {
  const runtime = createIntegrationRuntime({ root: await emptyRoot(t) }); const original = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Unexpected network'); };
  try { assert.equal((await runtime.inventory()).supplierConnected, false); assert.deepEqual((await runtime.call('search_cached_parts')).entries, []); }
  finally { globalThis.fetch = original; }
});
test('web discovery route is exact GET only and exposes no local paths', async t => {
  const root = await emptyRoot(t), calls = []; const handle = createIntegrationsService({ root, json: (_res, status, body) => calls.push({ status, body }) });
  assert.equal(await handle({ method: 'POST' }, {}, '/api/studio/integrations'), false);
  assert.equal(await handle({ method: 'GET' }, {}, '/api/studio/integrations/call'), false);
  assert.equal(await handle({ method: 'GET' }, {}, '/api/studio/integrations'), true);
  assert.equal(calls[0].status, 200); assert.equal(JSON.stringify(calls[0]).includes(root), false);
});
test('MCP dispatch supports initialization, discovery, call failures and notifications', async t => {
  const runtime = createIntegrationRuntime({ root: await emptyRoot(t) });
  const rpc = (method, params = {}) => dispatchIntegrationRpc({ jsonrpc: '2.0', id: 1, method, params }, runtime);
  assert.equal((await rpc('initialize')).result.serverInfo.name, 'm4ke-offline-sourcing');
  assert.equal((await rpc('tools/list')).result.tools.length, 7);
  const result = await rpc('tools/call', { name: 'search_cached_parts', arguments: {} });
  assert.equal(result.result.isError, false); assert.equal(JSON.parse(result.result.content[0].text).status, 'PINNED_SNAPSHOT_UNAVAILABLE');
  assert.equal((await rpc('tools/call', { name: 'eval', arguments: {} })).result.isError, true);
  assert.equal((await rpc('unknown')).error.code, -32601);
  assert.equal(await dispatchIntegrationRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, runtime), null);
});
test('real stdio subprocess emits only JSON-RPC and rejects oversized requests', () => {
  const script = path.join(ROOT, 'server/studio-integrations.mjs');
  const input = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }].map(JSON.stringify).join('\n') + '\n';
  const child = spawnSync(process.execPath, [script, '--stdio'], { input, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 0); assert.equal(child.stderr, ''); const lines = child.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 2); assert.equal(lines[1].result.tools.length, 7);
  const oversized = spawnSync(process.execPath, [script, '--stdio'], { input: 'x'.repeat(65537), encoding: 'utf8', timeout: 5000 });
  assert.equal(oversized.status, 1); assert.equal(oversized.stdout, ''); assert.ok(oversized.stderr.includes('oversized'));
});
