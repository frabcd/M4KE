# Source reacquisition drift review — 2026-09-27

**Read-only audit and proposed interface, not a changed installer or accepted new
catalog.** No model downloads, geometry transforms, source catalog writes,
service restarts, purchases or publication were performed. review-03 remains
unchanged. Raw supplier files stay on the private DGX, not in the MIT source ZIP.

## What was actually checked

The historical clean-03 receipt proves an **exact private-cache replay** of 25
sources and eight native STEP imports. It does not prove fresh online setup.
The old online attempt stopped at the first changed page, Adafruit #1063; it
did not establish that the other 24 live resources still matched.

This audit fetched all 25 reviewed URLs on the DGX, with at most two concurrent
requests, a one-second per-host interval, bounded retries/time/bytes, and only
allowlisted HTTPS redirects. Initial run: **15 exact / 8 byte-different HTML /
2 transport errors**. One separate bounded retry recovered the Adafruit `.brd`;
the commit-pinned README still timed out. Final observed coverage:

| Source class | Count | Result |
|---|---:|---|
| CAD ZIP/STEP/DXF and PDF drawings/datasheets | 13 | 13 exact historical SHA256 matches |
| Commit-pinned Adafruit design/license/text | 4 | 3 exact; README transport timeout, not proven drift |
| Product/resource HTML pages | 8 | All eight have different raw SHA256 |

Current archives/direct files were also read without modifying or importing CAD:
**8/8 component STEP payload hashes match the historical geometry manifest**.
This is byte identity, not a newly executed native import, unit-scale audit,
mechanical-fit test or physical validation. Revision-labelled filenames and
stable download IDs are not a guarantee that servers can never replace files;
retain their exact content hashes as the gate.

## Exactly which HTML sources drifted

Full historical/current hashes, timestamps and URLs are in `report.json` below.
The following prefixes identify this observation only, not permanent new pins.

| Source | Current SHA256 prefix | Visible-text comparison |
|---|---|---|
| `adafruit-1063-product.html` | `a46382d77986bc1d` | Only observed visible delta is a rotating footer quotation/author |
| `pico-resources.html` | `79404f92a30ecd465` | Equal after the described text extraction |
| `pololu-1086-product.html` | `666913a2e57d514e` | Equal |
| `pololu-1098-product.html` | `ce48a70d34c3a951` | Equal |
| `pololu-1420-product.html` | `abde64ac1bc68cde` | Equal |
| `pololu-2130-product.html` | `ddcd50b6c91586ba` | Equal |
| `pololu-950-product.html` | `5221dbeaefd79f54` | Equal |
| `pololu-992-product.html` | `b1fbe376d227402a` | Equal |

Raw markup changes include anonymous security/session fields, image URLs and
`data-available-stock` changes on Pololu #2130 and #950. Token values are not
reproduced here. The comparison drops script/style text and normalizes whitespace;
it is **not a full semantic equivalence proof**. In particular, do not preserve
stock, price or availability as current simply because visible text is equal.

Historical Adafruit HTML SHA is
`6dee62e9e7aee6b4e80de83bd50d76104eadd089cb2d926f612a4fa45b722e6f`.
The earlier quarantined 94,153-byte response still hashes to
`6bccaa1355911daaf447860a709b870decd14f6ab35c77e4b7e15070398cddfd`;
the current 94,041-byte response is a third distinct observation. Neither is
the historical file, and neither was accepted into the catalog.

## Why “ignore all HTML” is not a valid repair

The current manifest contains **17 explicit structured claim records** whose
`sourceArtifact` is HTML: three DRV8833 carrier voltage/current ratings, six
ratings each for #992 and #1098, #1086 supplied-fastener specification, and
#1420 D-shaft compatibility. Additional product-height/supplied-hardware context
appears in component notes and kit/hardware documentation. HTML is therefore
not uniformly optional decoration. CAD dimensions alone cannot prove motor
speed/current/torque, compatible shaft fit or supplied fastener identity.

The existing restorer requires the same raw hashes for all 25 sources and fails
at the first mismatch. This is correct for **historical replay**, but predictably
fails as a generic **current online reconstruction** policy when pages contain
request-varying fields. Its narrow `historicalBytes + 1024` online size cap can
also stop on page growth before recording a full changed response; preserve the
failure rather than silently accepting partial bytes.

## Proposed source-compatible patch/interface — NOT implemented here

Keep the existing strict replay behavior and old references unchanged. Add a
separate, explicit reconstruction operation rather than weakening its SHA checks:

```text
restore-submission-catalog.py --mode historical-exact
  --offline --source-cache <private-cache>

restore-submission-catalog.py --mode reconstruction-candidate
  --accept-source-downloads --output <fresh-candidate-directory>
```

These are **proposed flags**, not commands that currently exist.

1. Ship a reviewed acquisition-plan document classifying each URL as
   `exact-asset`, `revision-license/attribution`, or `mutable-observation`, plus
   its dependent component/claim pointers. Preserve the old 25-source index and
   manifest verbatim as historical records.
2. Download exact assets to the fresh directory and require their old hashes,
   archive-member hashes and unchanged native-import/frame checks. Any asset
   drift is a new asset revision requiring separate review, never an automatic
   replacement. A timeout remains a transport error. Do not silently omit an
   attribution/license dependency; allow an explicitly supplied exact-hash cache
   and record that the result is not wholly fresh-online.
3. Save each current HTML response under a new content-addressed observation
   path with its actual hash/time/URL, alongside—not under—the historical hash.
   Keep `historicalReplay:false`. Never normalize HTML and then label the result
   as the original captured bytes.
4. Add versioned, bounded **claim extractors** for the exact manufacturer SKU and
   relevant technical section. Evidence must bind the new raw hash, extractor
   hash/version, product/variant identity, value/unit/conditions and claim path.
   Compare motor ratings, driver thermal qualifiers, fasteners and compatibility
   individually. Mere number matching, full-page text equality or unchanged CAD
   is insufficient. Unmatched/changed claims become `REVIEW_REQUIRED`/`CHANGED`;
   price/stock remain independent dated observations with their own expiry.
5. Emit a **new candidate manifest/revision** and a report; do not activate it.
   Refer to verified current observations for re-established claims. Preserve
   historical hashes in explicit lineage fields, not as present-file claims.
   Until required technical claims and native tests pass an explicit acceptance
   gate, leave the affected kit unavailable for engineering-qualified generation.
   A geometry-only reconstruction may be useful but is not full kit completion.
6. Promotion should be a separate explicit action targeting a fresh install or
   revision selection, refusing nonempty/foreign catalogs and existing job data.
   New jobs bind the new catalog hash; frozen jobs keep their old kernel/catalog
   bytes. Re-run kit/physics/lineage/source tests; no geometry scale/frame changes
   are part of this proposal. Do not package supplier raw files publicly merely
   because local acquisition succeeded.

Suggested candidate receipt fields:

```json
{
  "schemaVersion": 2,
  "mode": "reconstruction-candidate",
  "historicalManifestSha256": "50660774b3d0d45143fd09257647b698b165bf6946d7d56bc83fd952cc8e52f3",
  "historicalReplay": false,
  "exactAssetChecks": [],
  "currentObservations": [],
  "claimReviews": [],
  "attributionComplete": false,
  "candidateManifestSha256": null,
  "activation": "NOT_REQUESTED",
  "physicalValidation": "UNKNOWN"
}
```

This offers a viable fresh-online architecture, **not proof that the new path is
already implemented or fully reproducible**. README transport failure and the
claim-review implementation remain explicit work items.

## Evidence locations and integrity

All paths below are repository-relative; no deployment endpoint/account is
required in this review document.

- `test-results/source-acquisition-audit-20260927T093757Z/report.json` — full
  initial 25-source observations; SHA256
  `d755486c904f2525325ebd707b36ebe6d663f513a732cb782838153cb523d6f6`.
- Same directory `retry-01/report.json` — separate supplemental retry; SHA256
  `9b53c9ce4a87e8ef028aacaa6c91fce12e615619d277ebb09bac0fc63fbbeaf3`.
- Same directory `derived-step-hashes.json` — eight selected payload hashes;
  SHA256 `dc6f6fd9608041afc1fbc2a06b09dad94471ee81cc0d0d137ad9e54c2d000b10`.
- Same directory `markup-drift-summary.json` and `summary.json` — attribute kinds,
  coverage and limitations; small reports copied locally. An initial `EXACT` row
  can retain an `error` string from an earlier timeout; final status/observed hash
  describe that row's outcome, and the original report was not rewritten.
- Same directory `downloads/`, `retry-01/` raw files and `diffs/` remain private
  on the DGX. They are not included in the source release by this review.
- `docs/submission/artifacts/M4KE-source-review-03.clean-validation.json` —
  historical clean-cache validation; not overwritten or recharacterized.

The production catalog manifest and source-index hashes were unchanged at the
audit boundary. No current observation has been promoted to a supplier claim,
catalog revision, purchasing decision or physical PASS.
