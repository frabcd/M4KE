/** Offline supplier observations, not orders, engineering approvals or live quotes. */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export const LIMITS = Object.freeze({ jsonBytes: 2 * 1024 * 1024, evidenceBytes: 4 * 1024 * 1024, bundleBytes: 32 * 1024 * 1024 });
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/;
const UNITS = ['piece', 'pack', 'spool', 'kg'];
const fail = message => { throw new Error(`Supplier snapshot: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
function keys(value, fields, label) {
  need(value && Object.getPrototypeOf(value) === Object.prototype, `${label} must be a plain object`);
  need(Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k)), `${label} fields differ from schema`);
  need(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, 'value')), `${label} accessors forbidden`);
}
const str = (s, label, max = 500) => need(typeof s === 'string' && s.length > 0 && s.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s), `${label} invalid string`);
const id = (s, label) => need(typeof s === 'string' && ID.test(s), `${label} invalid id`);
const choice = (s, choices, label) => need(choices.includes(s), `${label} invalid choice`);
const integer = (n, label, minimum = 1) => need(Number.isSafeInteger(n) && n >= minimum && n <= 1000000000, `${label} invalid integer`);
const nullableString = (s, label) => { if (s !== null) str(s, label); };
function timestamp(s, label, now) {
  need(typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(s) && Number.isFinite(Date.parse(s)), `${label} invalid UTC timestamp`);
  need(new Date(s).toISOString().slice(0, 19) === s.slice(0, 19), `${label} impossible calendar date`);
  need(Date.parse(s) <= now + 300000, `${label} is in the future`);
}
function publicSource(s) {
  str(s, 'source URL', 2048);
  let u; try { u = new URL(s); } catch { fail('source URL invalid'); }
  need(u.protocol === 'https:' && !u.username && !u.password && !u.hash && !u.search && (!u.port || u.port === '443'), 'source URL requires public HTTPS without credentials/query/fragment');
  need(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(u.hostname) && !/^\d+(?:\.\d+){3}$/.test(u.hostname) && !/\.(?:local|localhost|internal|test|invalid)$/i.test(u.hostname), 'source hostname is not public DNS');
}
const priceValue = (s, label) => need(typeof s === 'string' && DECIMAL.test(s) && Number(s) > 0, `${label} requires positive decimal string`);

export function validateSnapshot(snapshot, { now = Date.now() } = {}) {
  need(Number.isFinite(now), 'validation clock invalid');
  keys(snapshot, ['schemaVersion', 'snapshotId', 'createdAt', 'evidence', 'entries'], 'snapshot');
  need(snapshot.schemaVersion === 1, 'schemaVersion must be 1'); id(snapshot.snapshotId, 'snapshotId'); timestamp(snapshot.createdAt, 'createdAt', now);
  need(Array.isArray(snapshot.evidence) && snapshot.evidence.length > 0 && snapshot.evidence.length <= 30, 'evidence count invalid');
  need(Array.isArray(snapshot.entries) && snapshot.entries.length > 0 && snapshot.entries.length <= 100, 'entry count invalid');
  const evidenceIds = new Set();
  for (const e of snapshot.evidence) {
    keys(e, ['id', 'url', 'capturedAt', 'sourceUpdatedAt', 'method', 'access', 'file', 'sha256', 'contentType', 'extraction'], 'evidence');
    id(e.id, 'evidence.id'); need(!evidenceIds.has(e.id), 'duplicate evidence id'); evidenceIds.add(e.id);
    publicSource(e.url); timestamp(e.capturedAt, 'capturedAt', now);
    if (e.sourceUpdatedAt !== null) timestamp(e.sourceUpdatedAt, 'sourceUpdatedAt', now);
    need(Date.parse(e.capturedAt) <= Date.parse(snapshot.createdAt) + 300000, 'evidence captured after snapshot');
    choice(e.method, ['direct-http', 'operator-export', 'web-extract'], 'evidence.method');
    choice(e.access, ['public', 'operator-authenticated'], 'evidence.access');
    need(HASH.test(e.sha256), 'evidence SHA256 invalid');
    need(new RegExp(`^evidence/${e.sha256}\\.(html|pdf|txt|json)$`).test(e.file), 'evidence filename must be relative and hash-addressed');
    choice(e.contentType, ['text/html', 'application/pdf', 'text/plain', 'application/json'], 'contentType');
    str(e.extraction, 'extraction description', 2000);
  }
  const entryIds = new Set();
  for (const e of snapshot.entries) {
    keys(e, ['id', 'kind', 'supplierId', 'market', 'identity', 'evidenceIds', 'price', 'availability', 'minimumOrderQuantity', 'orderMultiple', 'specs', 'relatesTo', 'notes'], 'entry');
    id(e.id, 'entry.id'); need(!entryIds.has(e.id), 'duplicate entry id'); entryIds.add(e.id);
    choice(e.kind, ['component', 'material'], 'kind'); id(e.supplierId, 'supplierId'); need(/^[A-Z]{2}$/.test(e.market), 'market must be country code');
    keys(e.identity, ['manufacturer', 'mpn', 'supplierSku', 'variant', 'package', 'manufacturerRevision'], 'identity');
    for (const k of ['manufacturer', 'mpn', 'variant']) str(e.identity[k], `identity.${k}`);
    for (const k of ['supplierSku', 'package', 'manufacturerRevision']) nullableString(e.identity[k], `identity.${k}`);
    need(Array.isArray(e.evidenceIds) && e.evidenceIds.length > 0 && e.evidenceIds.length <= 30 && new Set(e.evidenceIds).size === e.evidenceIds.length && e.evidenceIds.every(x => evidenceIds.has(x)), 'entry evidence references invalid');
    const ref = (r, nullable = false) => need((nullable && r === null) || e.evidenceIds.includes(r), 'entry source reference invalid');
    for (const k of ['minimumOrderQuantity', 'orderMultiple']) if (e[k] !== null) integer(e[k], k);
    const p = e.price;
    keys(p, ['status', 'currency', 'unit', 'tiers', 'advertisedAmount', 'tax', 'shipping', 'evidenceId'], 'price');
    choice(p.status, ['observed-tiers', 'advertised-only', 'unavailable', 'login-required', 'not-found'], 'price.status');
    choice(p.currency, [null, 'CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD'], 'price.currency'); choice(p.unit, [null, ...UNITS], 'price.unit');
    choice(p.tax, ['included', 'excluded', 'unknown'], 'price.tax'); choice(p.shipping, ['included', 'excluded', 'unknown'], 'price.shipping');
    need(Array.isArray(p.tiers) && p.tiers.length <= 30, 'price tiers invalid'); ref(p.evidenceId, true);
    if (p.status === 'observed-tiers') {
      need(e.identity.supplierSku !== null && p.currency && p.unit && p.evidenceId && p.tiers.length > 0 && p.advertisedAmount === null, 'tier pricing needs SKU, currency, unit, source and tiers');
    } else if (p.status === 'advertised-only') {
      need(p.currency && p.evidenceId && !p.tiers.length, 'advertised pricing needs currency/source but no assumed tiers'); priceValue(p.advertisedAmount, 'advertisedAmount');
    } else need(!p.tiers.length && p.advertisedAmount === null, 'missing price cannot contain amounts');
    let last = 0;
    for (const t of p.tiers) {
      keys(t, ['minimumQuantity', 'unitPrice'], 'tier'); integer(t.minimumQuantity, 'tier quantity'); priceValue(t.unitPrice, 'tier price');
      need(t.minimumQuantity > last, 'tiers must be strictly ascending'); last = t.minimumQuantity;
    }
    const a = e.availability;
    keys(a, ['status', 'quantity', 'unit', 'evidenceId'], 'availability');
    choice(a.status, ['in-stock', 'out-of-stock', 'backorder', 'unknown'], 'availability.status'); choice(a.unit, [null, ...UNITS], 'availability.unit'); ref(a.evidenceId, true);
    if (a.quantity !== null) { integer(a.quantity, 'stock quantity', 0); need(a.unit && a.evidenceId, 'stock quantity needs unit/source'); }
    if (a.status === 'unknown') need(a.quantity === null, 'unknown stock must not carry definitive quantity');
    if (a.status === 'in-stock') need(a.evidenceId && (a.quantity === null || a.quantity > 0), 'in-stock needs source and nonzero quantity');
    if (a.status === 'out-of-stock') need(a.evidenceId && (a.quantity === null || a.quantity === 0), 'out-of-stock cannot have positive quantity');
    need(Array.isArray(e.specs) && e.specs.length <= 50, 'specs count invalid');
    for (const s of e.specs) {
      keys(s, ['name', 'value', 'unit', 'conditions', 'basis', 'evidenceId'], 'spec');
      for (const k of ['name', 'value', 'unit', 'conditions']) str(s[k], `spec.${k}`, 2000);
      choice(s.basis, ['supplier-listing', 'manufacturer-datasheet'], 'spec.basis'); ref(s.evidenceId);
    }
    keys(e.relatesTo, ['catalogId', 'relationship', 'note'], 'relatesTo'); if (e.relatesTo.catalogId !== null) id(e.relatesTo.catalogId, 'catalogId');
    choice(e.relatesTo.relationship, ['unqualified-candidate', 'same-model-revision-unverified', 'not-equivalent', 'material-option'], 'relationship'); str(e.relatesTo.note, 'relationship note', 2000);
    need(Array.isArray(e.notes) && e.notes.length <= 30, 'notes invalid'); for (const n of e.notes) str(n, 'note', 2000);
  }
  need(Buffer.byteLength(JSON.stringify(snapshot)) <= LIMITS.jsonBytes, 'snapshot too large');
  return snapshot;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** No URL is fetched. Raw evidence stays bytes, never evaluated or rendered. */
export async function verifyBundle(snapshot, bundleRoot, options = {}) {
  validateSnapshot(snapshot, options);
  const root = await realpath(bundleRoot); const files = []; let total = 0;
  const directory = path.join(root, 'evidence');
  need((await lstat(directory)).isDirectory() && !(await lstat(directory)).isSymbolicLink(), 'evidence directory must be a real directory');
  for (const e of snapshot.evidence) {
    const file = path.join(root, ...e.file.split('/')); const stat = await lstat(file);
    need(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= LIMITS.evidenceBytes, 'evidence file invalid or oversized');
    need(await realpath(file) === file, 'evidence path resolves through link');
    const bytes = await readFile(file); total += bytes.length;
    need(bytes.length <= LIMITS.evidenceBytes && total <= LIMITS.bundleBytes && sha256(bytes) === e.sha256, 'evidence size/hash mismatch');
    files.push({ file: e.file, sha256: e.sha256, bytes: bytes.length });
  }
  return { schemaVersion: 1, snapshotSha256: sha256(canonicalJson(snapshot)), files, totalBytes: total, networkUsed: false, semanticClaimsVerified: false };
}

const micros = s => { const [a, b = ''] = s.split('.'); return BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0')); };
const decimal = n => `${n / 1000000n}.${(n % 1000000n).toString().padStart(6, '0')}`;
/** Caller must first verifyBundle/readImportedSnapshot. Quotes are dated observations only. */
export function quoteLine(snapshot, request, { now = Date.now(), maxAgeHours = 24 } = {}) {
  validateSnapshot(snapshot, { now });
  keys(request, ['entryId', 'manufacturer', 'mpn', 'supplierSku', 'variant', 'quantity', 'unit', 'currency'], 'quote request');
  integer(request.quantity, 'requested quantity'); need(Number.isFinite(maxAgeHours) && maxAgeHours > 0 && maxAgeHours <= 720, 'maxAgeHours out of bounds');
  const e = snapshot.entries.find(x => x.id === request.entryId); need(e, 'entry not found');
  choice(request.unit, UNITS, 'requested unit'); choice(request.currency, ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD'], 'requested currency');
  for (const k of ['manufacturer', 'mpn', 'supplierSku', 'variant']) need(e.identity[k] === request[k], `exact identity mismatch: ${k}`);
  const reasons = []; const result = { entryId: e.id, status: 'UNQUOTABLE', currency: request.currency, quantity: request.quantity, unit: request.unit, unitPrice: null, subtotal: null, tax: e.price.tax, shipping: e.price.shipping, availability: e.availability.status, engineeringQualified: false, purchaseAuthorized: false, reasons };
  if (!e.identity.supplierSku || e.price.status !== 'observed-tiers') { reasons.push('NO_VERIFIED_QUANTITY_PRICE'); return result; }
  need(e.price.unit === request.unit && e.price.currency === request.currency, 'currency/unit mismatch; no conversions permitted');
  const evidence = snapshot.evidence.find(x => x.id === e.price.evidenceId);
  const availabilityEvidence = snapshot.evidence.find(x => x.id === e.availability.evidenceId);
  const availabilityExpired = availabilityEvidence && (availabilityEvidence.method === 'web-extract' || now - Date.parse(availabilityEvidence.capturedAt) > maxAgeHours * 3600000);
  if (availabilityExpired) { result.availability = 'unknown'; reasons.push('AVAILABILITY_OBSERVATION_EXPIRED'); }
  if (evidence.method === 'web-extract') { reasons.push('EXTRACTION_FRESHNESS_UNVERIFIED'); return result; }
  if (now - Date.parse(evidence.capturedAt) > maxAgeHours * 3600000) { result.status = 'STALE'; reasons.push('OBSERVATION_EXPIRED'); return result; }
  if (e.minimumOrderQuantity !== null && request.quantity < e.minimumOrderQuantity) { reasons.push('BELOW_MOQ'); return result; }
  if (e.orderMultiple !== null && request.quantity % e.orderMultiple !== 0) { reasons.push('ORDER_MULTIPLE_MISMATCH'); return result; }
  const tier = e.price.tiers.filter(t => t.minimumQuantity <= request.quantity).at(-1);
  if (!tier) { reasons.push('NO_APPLICABLE_TIER'); return result; }
  result.status = 'INDICATIVE_ONLY'; result.unitPrice = tier.unitPrice; result.subtotal = decimal(micros(tier.unitPrice) * BigInt(request.quantity));
  reasons.push('NOT_A_LIVE_QUOTE', 'ENGINEERING_QUALIFICATION_REQUIRED', 'NO_PURCHASE_ACTION');
  if (e.minimumOrderQuantity === null || e.orderMultiple === null) reasons.push('ORDER_RULES_INCOMPLETE');
  if (result.availability !== 'in-stock') reasons.push('AVAILABILITY_NOT_CONFIRMED');
  if (!availabilityExpired && e.availability.quantity !== null && e.availability.quantity < request.quantity) reasons.push('OBSERVED_STOCK_INSUFFICIENT');
  if (e.price.tax === 'unknown' || e.price.shipping !== 'included') reasons.push('LANDED_COST_INCOMPLETE');
  return result;
}
