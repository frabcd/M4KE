import path from 'node:path';
import { readImportedSnapshot } from '../procurement/import.mjs';
import { quoteLine } from '../procurement/snapshot.mjs';

export const PROCUREMENT_SNAPSHOT = '10274e8058359c921c6880058ea51f8856e4be409b551abf11d78d1de95a64b4';
const TTL_HOURS = 24;

/** Read-only, one explicitly reviewed snapshot. No user-selected file or supplier URL. */
export function createProcurementService({ root, json, now = () => Date.now() }) {
  let activeReads = 0;
  return async function handle(req, res, pathname) {
    if (pathname !== '/api/studio/procurement' || req.method !== 'GET') return false;
    if (activeReads >= 2) {
      json(res, 429, { available: false, status: 'OFFLINE_READ_BUSY', entries: [], networkUsed: false, purchaseMade: false, error: 'Two offline procurement checks are already running. Retry after they finish.' });
      return true;
    }
    activeReads++;
    try {
    let payload, status;
    try {
      const checkedAt = now();
      const { snapshot, verification } = await readImportedSnapshot(PROCUREMENT_SNAPSHOT, { root: path.join(root, 'procurement'), now: checkedAt });
      const entries = snapshot.entries.map(e => {
        const priceSource = snapshot.evidence.find(s => s.id === e.price.evidenceId);
        const observedAt = priceSource?.capturedAt ?? null;
        const hasPrice = ['observed-tiers', 'advertised-only'].includes(e.price.status);
        const freshness = !hasPrice || !priceSource || priceSource.method === 'web-extract' ? 'UNKNOWN' : checkedAt - Date.parse(priceSource.capturedAt) > TTL_HOURS * 3600000 ? 'STALE' : 'WITHIN_LOCAL_TTL';
        const quote = e.identity.supplierSku && e.price.unit && e.price.currency ? quoteLine(snapshot, {
          entryId: e.id, manufacturer: e.identity.manufacturer, mpn: e.identity.mpn, supplierSku: e.identity.supplierSku, variant: e.identity.variant,
          quantity: 1, unit: e.price.unit, currency: e.price.currency,
        }, { now: checkedAt, maxAgeHours: TTL_HOURS }) : {
          entryId: e.id, status: 'UNQUOTABLE', currency: e.price.currency, quantity: 1, unit: e.price.unit,
          unitPrice: null, subtotal: null, tax: e.price.tax, shipping: e.price.shipping, availability: e.availability.status,
          engineeringQualified: false, purchaseAuthorized: false, reasons: ['UNPRICED_OR_UNSELECTED_SKU'],
        };
        return {
          id: e.id, kind: e.kind, supplierId: e.supplierId, market: e.market, identity: e.identity,
          price: { status: e.price.status, currency: e.price.currency, unit: e.price.unit, tiers: e.price.tiers, advertisedAmount: e.price.advertisedAmount, tax: e.price.tax, shipping: e.price.shipping, observedAt, freshness },
          availability: { status: e.availability.status, quantity: e.availability.quantity, unit: e.availability.unit },
          minimumOrderQuantity: e.minimumOrderQuantity, orderMultiple: e.orderMultiple,
          quote, specs: e.specs, relatesTo: e.relatesTo, notes: e.notes,
          sources: snapshot.evidence.filter(s => e.evidenceIds.includes(s.id)).map(s => ({ id: s.id, url: s.url, capturedAt: s.capturedAt, sourceUpdatedAt: s.sourceUpdatedAt, sha256: s.sha256, method: s.method, extraction: s.extraction })),
        };
      });
      status = 200;
      payload = {
        schemaVersion: 1, available: true, status: 'VERIFIED_OFFLINE_SNAPSHOT', snapshotSha256: verification.snapshotSha256,
        snapshotCreatedAt: snapshot.createdAt, checkedAt: new Date(checkedAt).toISOString(), evidenceIntegrity: 'PASS', semanticClaimsVerified: false,
        verifiedEvidenceBytes: verification.totalBytes, ttlHours: TTL_HOURS, entries,
        networkUsed: false, liveSupplierConnected: false, mcpUsed: false, completeBom: false, defaultMaterial: null, purchaseMade: false, engineeringQualified: false,
        limitations: [
          'Dated observations, not live prices, stock promises, landed cost or a complete car BOM. One-unit amounts use the supplier order unit.',
          'Pico revision is unverified; Pico H and the bare DRV8833PWPR IC are not automatic substitutes for the current source kit.',
          'PLA Basic is a family-level TDS reference with no selected color/spool SKU or acquired CNY price. Typical specimen strength is not an as-printed design allowable.',
          'Hash checks prove local byte identity, not supplier correctness or physical compatibility. No component/material adoption or purchase is performed.',
        ],
      };
    } catch {
      status = 503;
      payload = { schemaVersion: 1, available: false, status: 'PINNED_SNAPSHOT_UNAVAILABLE', snapshotSha256: PROCUREMENT_SNAPSHOT, evidenceIntegrity: 'NOT_VERIFIED', entries: [], networkUsed: false, purchaseMade: false, engineeringQualified: false, defaultMaterial: null,
        error: 'The pinned offline supplier snapshot is missing or failed integrity validation. No price is substituted and no online fallback was attempted.' };
    }
    // A disconnected response must not cause a second JSON write in the error path.
    json(res, status, payload); return true;
    } finally { activeReads--; }
  };
}
