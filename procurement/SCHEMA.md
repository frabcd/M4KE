# Offline SupplierSnapshot v1

The executable schema is `snapshot.mjs::validateSnapshot`. Only the listed keys
are accepted; every key is required, with explicit nulls for missing facts.
The real four-entry example is `incoming/primary-cn-20260927/snapshot.json`.

```
Snapshot {schemaVersion:1, snapshotId, createdAt, evidence:Evidence[], entries:Entry[]}
Evidence {id, url, capturedAt, sourceUpdatedAt:null|UTC,
  method:direct-http|operator-export|web-extract,
  access:public|operator-authenticated,
  file:evidence/<sha256>.(html|pdf|txt|json), sha256, contentType, extraction}
Entry {id, kind:component|material, supplierId, market:countryCode,
  identity:{manufacturer,mpn,supplierSku:null|string,variant,
    package:null|string,manufacturerRevision:null|string},
  evidenceIds:string[],
  price:{status:observed-tiers|advertised-only|unavailable|login-required|not-found,
    currency:null|CNY|USD|EUR|GBP|JPY|HKD, unit:null|piece|pack|spool|kg,
    tiers:[{minimumQuantity:integer,unitPrice:positiveDecimalString}],
    advertisedAmount:null|positiveDecimalString,
    tax:included|excluded|unknown,shipping:included|excluded|unknown,evidenceId:null|string},
  availability:{status:in-stock|out-of-stock|backorder|unknown,
    quantity:null|nonnegativeInteger,unit:null|piece|pack|spool|kg,evidenceId:null|string},
  minimumOrderQuantity:null|positiveInteger,orderMultiple:null|positiveInteger,
  specs:[{name,value:string,unit,conditions,basis:supplier-listing|manufacturer-datasheet,evidenceId}],
  relatesTo:{catalogId:null|string,
    relationship:unqualified-candidate|same-model-revision-unverified|not-equivalent|material-option,note},
  notes:string[]}
```

Price is per ONE specified order unit. A 100-piece pack must use `pack`, not a
silently divided `piece` price. Minimum tier quantity applies to that same unit.
Unknown MOQ/multiple is not inferred from a tier. Monetary strings allow at most
six decimals and nine integer digits; no binary floating point totals or FX.

`verifyBundle(snapshot, folder)` verifies bytes, limits and relative paths but
reports `semanticClaimsVerified:false`. It never fetches URLs. Evidence source
metadata and extraction claims are assertions for review, not signed supplier
certificates. Source publication dates, revisions and measurement conditions must
not be invented. A source missing on the public web is not proof it is unavailable
to all customers; use a note describing what was actually checked.

`importSnapshot(bundleName)` admits only a direct named `incoming` child, writes a
fresh staging directory and atomically moves to a canonical-manifest-hash path.
`readImportedSnapshot(sha)` revalidates manifest and raw files every time.
`quoteImportedSnapshot(sha, exactRequest)` is the integration entrypoint. It can
return only `INDICATIVE_ONLY`, `STALE` or `UNQUOTABLE`, never an order, confirmed
availability, physically qualified replacement or complete landed BOM total.
The raw `quoteLine` is pure calculation for already-verified inputs.

The offline folder may contain third-party copyrighted raw pages. Do not serve
them as active HTML or add them to a public release without a separate licensing
and privacy review. Raw account/session exports must be redacted before admission.
