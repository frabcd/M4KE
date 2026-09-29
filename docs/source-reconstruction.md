# Fresh source reconstruction — candidate-only setup

This is separate from `scripts/restore-submission-catalog.py`, whose exact historical
SHA checks are unchanged. Review03/04/05 ZIPs, old catalogs and frozen jobs remain
immutable. A current HTML response is never relabeled as historical bytes.

## Command and output contract

After installing the source and isolated CAD dependencies, use a **new** directory:

```sh
python3 scripts/catalog_reconstruct.py --accept-source-downloads \
  --output /new/private/catalog-candidate \
  --reference-root catalog --code-root . --python .venv-cad/bin/python
```

The command downloads all 25 fixed manufacturer URLs anew. It has no cache fallback,
activation flag, model call, supplier login, purchase or printer operation. Existing
output directories and reference-catalog descendants are refused. It runs at most
two requests concurrently, spaces each host's starts by one second, attempts each
primary URL at most twice, bounds HTTPS redirects/bytes/time, and records each attempt.
Four fixed Adafruit commit/file pairs may then use one official GitHub Contents API
raw-media request with that exact commit and filename. The returned raw file must
still match its historical SHA; JSON envelopes are not decoded or passed off as raw
files. Both failed primary attempts and the actual fallback URL/headers/time remain
recorded. There is no floating branch, alternate file or private-cache recovery.
Downloaded files are data only. No browser JavaScript or downloaded program executes.

Output includes:

- `historical/`: byte-exact reference metadata, not the newly observed truth.
- `acquisition-plan.json`: the reviewed URL/role/expected-hash plan.
- `sources/` and content-addressed `observations/`: private downloaded bytes.
- `source-index.json`: actual new hashes, times, URLs and separate historical hashes.
- `observations.json` and `claim-reviews.json`: identity, extraction and claim checks.
- `manifest.json`: a standalone, versioned **candidate**, not an activated app catalog.
- `native-imports.json`: actual native STEP import results when exact assets pass.
- `reconstruction-report.json`: gate outcomes and `activation: NOT_REQUESTED`.

The candidate directory is intentionally not selected by the app. A process exit of
zero means `CANDIDATE_GATES_PASS_REVIEW_REQUIRED`, not manufacturing approval or a
newly deployed catalog. No command currently promotes this candidate automatically.

## Independent acceptance gates

1. **Fresh acquisition:** all 25 fixed sources are fetched in this run. No historical
   cache is read to recover a missing byte. Transport errors remain errors.
2. **Exact assets and attribution:** all 17 non-HTML files retain their exact hashes,
   including CAD, drawings, datasheets, commit-pinned Eagle designs, license and README.
   An asset's changed bytes require a different reviewed asset revision.
3. **Manufacturer identity/context:** all eight HTML sources must match the reviewed
   exact product/variant and their relevant technical structure. This includes Pico
   R3's exact download link, Adafruit #1063's technical-height context, and #950's
   supplied-hardware context. Related products, metadata tags and scripts cannot
   stand in for the product's technical section.
4. **Seventeen technical claims:** each old HTML-dependent claim is independently
   compared with an extracted new value and unit, retaining source SHA, extractor
   version/code SHA, technical-section SHA, conditions and the old claim SHA.
   Changed, absent or ambiguous evidence becomes `REVIEW_REQUIRED`.
5. **Native geometry:** the eight selected STEP hashes and existing native helper
   checks pass with unchanged units, frames, transforms and bounds. No scale repair
   is performed. An import is not a physical-fit test.
6. **Attribution preservation:** the pinned license and README are retained. Existing
   unknown manufacturer rights stay unknown. This gate does **not** grant or infer
   redistribution permission for CAD, pages or datasheets.

The 17 structured claims are the three DRV8833 supply/current ratings, six ratings
for each of motor #992 and #1098, bracket #1086's supplied fasteners and wheel #1420's
3 mm D-shaft compatibility. Motor evidence uses the product-specific summary tables,
not the family comparison table. No-load speed remains distinct from loaded speed;
stall values remain theoretical and potentially damaging. Driver current claims
retain room-temperature, airflow, duty-cycle, cooling and peak-duration limitations.
Bracket count per bracket is explicitly derived from four supplied screws per pair.

Current manufacturer sources include [DRV8833 #2130](https://www.pololu.com/product/2130),
[motor #1098](https://www.pololu.com/product/1098),
[bracket #1086](https://www.pololu.com/product/1086) and
[wheel #1420](https://www.pololu.com/product/1420). A link does not replace the captured
raw-byte and claim evidence. Price, stock and availability are explicitly invalidated;
this reconstruction does not turn old supplier observations into a current quote.

## Review before any future activation

Review the candidate report, all 17 claim records, eight identities and native import
coverage. Confirm attribution boundaries. Then run the source-kit, physics and frozen
lineage regression against a **separate fresh installation** using the candidate.
Any eventual explicit activation must refuse nonempty foreign catalogs and existing
job data, bind new jobs to the new manifest hash, and leave old snapshots unchanged.
The present tool deliberately does not implement that activation step.

Tests are synthetic and network-free:

```sh
python3 -B tests/catalog_reconstruct_test.py
```

Passing those tests is not proof of current downloads. Fresh DGX run receipts are
retained separately under `test-results/`; they are not bundled with MIT source,
and vendor raw assets must not be published without separate rights review.
