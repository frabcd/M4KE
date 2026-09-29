# Source-review validation

Current Vue migration results are recorded separately in [Vue validation](../vue-validation.md). The dated records below are historical and do not certify newer source or current runtime health.

## September 28, 15:14 China — separate evidence boundaries

**Fresh Qwen car acceptance remains NOT PASSED; all physical results remain UNKNOWN.** Seven fresh car runs on September 28 have no passing end-to-end result. Regression counts, a rendered model, and a source archive are different evidence categories.

| Observed checkpoint | Evidence and result | Scope / limitation |
|---|---|---|
| Deployed UI candidate, 14:37 | `test-results/ui-candidate-deployment.json`; deployment archive SHA-256 `ec862f14560d48b827e52396474868eb94b52e06c0974601486a7d8bcb18797e` | New Apple-inspired UI and exact-STL loading on the earlier tested backend. It does **not** contain the later architecture planner or native catalogMate implementation. This is not a current-network availability claim. |
| Actual deployed browser, finished 14:41:46 | `test-results/apple-shell-live-20260928/report.json`: 5/5 PASS; 21/21 parts, 17 STL requests; first native part 5,386 ms, all parts 65,523 ms; zero browser errors or mutations | Historical Qwen diagnostic job `ccd4a1a2-a9e3-4e3d-9641-008c84c8cba3`. FAILED / firmware BLOCKED / physical UNKNOWN stayed visible. No package redownload. This is not fresh-car acceptance, and one cold-load measurement is not a latency guarantee. The earlier 90-second timeout remains a separate failure record. |
| Local complete Node regression, 15:02 | `test-results/resumed-full-node-final2.log`: 412 tests, 410 PASS, 2 SKIP, 0 FAIL | Local implementation tests. The explicit skips are not passes; this is not a clean-install receipt or a model-performance result. |
| Native source-catalog mating | `test-results/catalog-mate-native/handoff.json`: 13/13 new native tests and 41/41 existing native worker regressions | Source-bound nominal shaft/bore geometry, axes and engagement. Matched nominal geometry still leaves tolerance, D-flat orientation, retention and physical fit UNKNOWN; there is no collision exemption or teammate-library mutation. |
| Source-review-12, created 15:04 | `test-results/source12-package-report.json`: 199 files, 724,160 bytes, allowlist/hash/known-risk scan PASS | Immutable local review package only. **Not clean-installed and not deployed.** Neither source11's clean-install evidence nor later working-tree changes belong to these bytes. |
| Fresh Qwen run 7, finished 15:04:22 | `test-results/qwen-acceptance-3euaxatq-evidence.tar.gz`, project `bb6ef36f-e3d5-48a0-a351-051e84528fa6`, design run `70e05213-40b7-4dc1-9786-ee2f0b35c840` | Initial voltage contradiction was followed by two bounded architecture replies that omitted required numeric inputs. The known failure could not be cleared by UNKNOWN; architecture FAILED, project ERROR, `designHash: null`, no accepted CAD design. Isolated service and owned children stopped; production unchanged. |

Source12 SHA-256: `f4a6e8f5050bf188cfce5024f4792c6a7019d8417cdf782ae7e5e0e788aa9805`. The package remains unchanged by this documentation update. Run 7 used isolated runtime archive `4e0e107b938d53736c9ebf29d93f243fe2b081fc12c62c7220ca5b8460c6b6fe`; do not assign its model result to a different source package or current working tree. Source11's historical clean-install receipt remains available separately at `docs/submission/artifacts/M4KE-source-review-11.clean-validation.json`.

The actual UI runner is `tests/studio-shell-live-e2e.mjs` and requires an explicitly selected `STUDIO_REAL_JOB`. It checks read-only rendering, structured issue targets, language persistence, same-netlist 2D/3D behavior, failed-export warnings and mutation absence. Fixture runners (`tests/studio-shell-e2e.mjs` and `tests/studio-composer-e2e.mjs`) test the interface contract, not a physical object. No new inference, deployment, installation or physical test was performed to write this checkpoint.

At the historical checkpoint above, the runtime loaded six hashed skills: design, architecture replanning, verification-tool planning, advisory review, bounded repair and the Dyson-inspired method. Deterministic tools—not model prose—produce check results. The supplier MCP provides cached search/quantity quotes/capability information, **not PCB authoring, live-stock assurance, purchasing or automatic printing**.

## Package procedure and historical validation records

The records below retain their original dates and scopes; they do not certify source12 or later iterations.

Each source ZIP carries `SUBMISSION-MANIFEST.json`: exact membership, byte counts
and SHA-256 values. It is created from an allowlist, with stable ZIP timestamps and
permissions. Repackaging unchanged input must produce the same ZIP hash.

```sh
python3 scripts/package-submission.py --output /new/path/M4KE-source-review.zip
python3 scripts/check-submission.py /new/path/M4KE-source-review.zip
python3 tests/submission_package_test.py
```

The package command refuses an existing output path. The current packager includes the reviewed root README byte-for-byte and excludes
private deployment scripts. Known operational endpoints are screened separately;
older archives retain their own recorded projections. Runtime catalog starts empty; reference metadata is
explicitly separate from installed source geometry. Models, caches, native vendor
assets, team database, personal documents, credentials, projects and history are
excluded by membership, not merely hidden behind a broad `.gitignore`.

The source archive's checker is independent of its manifest: path allowlisting,
regular-file checks, size limits and known-risk text screening run before hash
verification. A modified artifact, extra secret file, traversal or symlink cannot
be accepted merely by adding a manifest entry. This is not universal DLP or a legal
review.

## Clean-host receipts

Run the exact commands in `DEPLOYMENT.md`. New receipts are deliberately not included
in the distributable source (they may contain local diagnostics):

- `.setup/clean-install.json`: npm/Python install steps, build and native/server smoke.
- `catalog/submission-restore.json`: exact source reacquisition and native imports.
- `catalog/offline-replay.json`: local source replay and catalog helper tests.
- `printing/dgx/evidence/capability.json`: actual current slicer CLI/profile state.

The staged `.gitignore` adds private setup/cache/source-asset exclusions without
editing the working project's file. This is an explicitly recorded projection,
not an assertion that the whole worktree was copied byte-identically. Before future
publishing, review tracked catalog changes too: `.gitignore` does not hide changes
to an already tracked manifest.

An absent or failed receipt is not success. The clean install uses a new directory,
fresh node_modules and a project virtual environment, not production caches copied
into the submitted source. If dependency caches are reused as download acceleration,
record that distinction. If only `--verify-only` or `--frontend-only` ran, report that
explicitly rather than claiming a full fresh native installation.

## Remaining independently verified stages

Full model generation requires a reviewed locally installed model; source-car CAD
requires exact private source restoration; printer profiles require separate pinned
slicer installation. Neither model quality nor a physical car is verified by package
hashes, unit tests or the generic native CAD smoke. Keep original failures and report
the exact stage blocked by unavailable upstream source/dependency versions.

## Later local implementation checkpoint

Read-only printer connection has synthetic and real loopback TLS tests, not physical
printer compatibility evidence. `tests/printer-tls.test.mjs` requires `openssl`
(or `OPENSSL_EXE`); ephemeral test keys are created under a temporary directory and
removed afterward. No fixture contacts a physical printer.

Procurement tests retain pure synthetic checks in a source-only checkout. Actual
supplier-source tests explicitly skip if the separately retained raw evidence bundle
is absent; a present-but-corrupt bundle fails. No copyrighted supplier HTML/PDF is
silently bundled as MIT. Source-kit tests are deferred until exact catalog restoration.

Portable candidate source/helpers and isolated native receipts are separate from live
workflow integration. Do not infer package availability or physical readiness merely
from the presence of helper source files. Review the release's actual validation receipt.

## Historical review-04 source checkpoint

The portable registry/package/service/UI source is frozen for this snapshot, including
explicit-default lineage binding and a zero-automatic-repair boundary for the 48-object
candidate. Its actual DGX workflow run was still pending when source was frozen.
The release's separate clean-validation receipt must state whether the exact archive
was installed into a new directory with fresh node_modules and a fresh virtual
environment, which cached downloads were used, and which browser/source tests skipped.
No current deployment result may be inferred from old review-03 receipts.

`SOURCE-DRIFT-REVIEW.md` distinguishes current downloads from exact historical cache
replay. Eight HTML byte changes cannot be erased by changing old pins. Source-only
tests intentionally skip seven private-procurement cases when the entire raw fixture
is absent; corruption of an existing fixture is a failure. Optional candidate database,
model inference, slicer reinstall and physical hardware testing are separate stages.

## review-05 scope and independent production evidence

Review-04 remains immutable. Its cached clean installation passed, but the subsequent
48-object portable workflow revealed a real illustration acceptance defect: the
projection loader still admitted at most 24 objects. Review-05 aligns only that total
bound to 48, keeps the per-step 24-reference bound, preserves hash checks and reports
the renderer's bounded actual refusal reason. The default setup now runs
`tests/illustrate_test.py`; the one source-dependent case explicitly skips only when
required catalog components are absent and must run again after restoration.

The separate actual DGX rerun receipt at
`test-results/portable-package-20260927-r2/report.json` records
`SOFTWARE_PACKAGE_PASS_PHYSICAL_UNKNOWN`: 48 geometry objects, 22 printed parts,
18 purchase-candidate rows, nine available SVG views, advisory model review and
commissioning-default disabled motor output. Its package has 46,314,453 bytes and
SHA-256 `cd122df61d6e8981b6c17f37d930d617130b5b2e34100232fec6ddb8cd02e308`;
142 artifact hashes passed readback. This private generated package is not included
in the MIT source archive. The receipt is a production workflow result, not evidence
that clean-source setup performed model inference, slicing or any physical test.

Independent browser review of that r2 guide confirmed all nine SVGs loaded, but found
horizontal overflow at a 390-pixel mobile viewport (reported scroll width 873 pixels).
That is a real presentation failure despite valid package hashes. Retain r2; a later
guide CSS fix and newly generated package require their own browser acceptance.

That same r2 job has a separate software-only slicing receipt at
`test-results/portable-slices-20260927/report.json`: all 22 printed parts returned
`PASS_REVIEW_REQUIRED` under the explicitly selected `h2c-04-pla-standard` profile.
This is a test selection, not an application default. Auto-orientation and supports
still need human inspection; no printer was contacted. These slice records belong
to r2 and must not be relabeled as evidence for a later job.

The subsequent r3 package is independently retained at
`test-results/portable-package-20260927-r3/report.json`: 46,314,584 bytes,
SHA-256 `a893139557eb4d79d4fb0b12d5f65c7de16e56152a4d671002a3fc84be2cd3d2`,
142 verified artifact hashes, the same 48-object / 22-printed candidate, and nine
available SVGs. Its job is `38cebecc-a570-42c1-9f9d-2b09dc306c53`.
Actual generated HTML browser evidence is
`test-results/production-portable-r3-browser-20260927-183209/guide-report.json`
(SHA-256 `94395c000829e451ff6fa0f67b33bfeacc76064fafc09158e15c10ddb1248337`).
All nine images loaded; document/viewport widths matched at both 390 and 1280 pixels;
console errors and external network requests were empty. This is the actual frozen
production guide, not only a derived CSS fixture. It supersedes r2 presentation
acceptance without rewriting the earlier failure or claiming physical fit.

Use the new archive's separate clean-validation receipt for its exact fresh-install
test counts, dependency hashes and skips. Do not infer those results from the working
tree tests or from the production rerun. Manufacturer geometry, unit/frame decisions,
the teammate's model database and its independent scale audit are not changed by
this illustration fix or source packaging.

## September 28 implementation checks and final-release gate

The new electrical UI has a separate mocked browser receipt: 15 scenarios passed
with no page errors or mutation requests. It covers actual canvas wire picking,
the backend-resolved summary, matching SVG/table/file links, missing anchors,
legacy projects, stale revisions, exploded views and mobile layout. These are UI
checks, not real Qwen inference, native car CAD or circuit/physical proof.

The retained same-input native replay completed in 136.5 seconds versus 365.9
seconds before optimization. Its 51 check observations were exactly equivalent;
assembly interference and sampled rotation still failed. A fast, faithfully
retained failure is not a passed benchmark. Do not substitute this historical
input for the new end-to-end Qwen acceptance run.

Before the September 28 13:20 software handoff, freeze one source ZIP and record:

1. ZIP SHA-256, membership/credential screen, deterministic repack result.
2. Fresh isolated dependency installation, frontend build, unit/API tests and
   native CAD smoke; exact source restoration and all deferred source suites.
3. A fresh ordinary Qwen request, separate verification-tool selection, actual
   host checks, retained failures and bounded repair—not a deterministic kit.
4. Exact revision agreement across native CAD, electrical netlist, SVG/CSV,
   firmware, BOM, assembly guide and every downloadable artifact.
5. Actual browser loading of the final DGX job and diagram, with no stale-result
   substitution. All physical checks remain UNKNOWN until humans supply results.

No new archive is clean-install validated merely because review-06 passed.
Review-07 had no completed independent clean-install receipt at its cutoff.
Keep those archives and statuses unchanged when preparing the next review.

### Isolated cached clean-source procedure

Run the trusted archive checker first. Use a brand-new directory, fresh
node_modules and a fresh .venv-cad; never copy installed production dependencies
or replace an existing review directory. The review-06 method reused only exact
privately prepared npm downloads, verified native wheel files and separately
retained manufacturer source bytes. This is a fresh dependency installation from
caches, **not fresh network acquisition** and not a source ZIP that contains CAD.

```sh
# From the reviewed source checkout; choose a new, non-existing directory.
python3 scripts/check-submission.py "$ARCHIVE"
mkdir "$CLEAN_DIR"
python3 -m zipfile -e "$ARCHIVE" "$CLEAN_DIR"
cd "$CLEAN_DIR"
python3 scripts/setup-submission.py --offline --wheelhouse "$WHEELHOUSE" --npm-cache "$NPM_CACHE" --smoke
.venv-cad/bin/python -m pip check
python3 scripts/restore-submission-catalog.py --offline --source-cache "$SOURCE_CACHE"
.venv-cad/bin/python scripts/catalog_verify_offline.py
node --test tests/*.test.mjs
.venv-cad/bin/python tests/cad_worker_test.py --kernel
.venv-cad/bin/python cad/catalog_geometry_test.py
.venv-cad/bin/python -B tests/illustrate_test.py
python3 tests/catalog_reconstruct_test.py
python3 tests/submission_package_test.py
python3 scripts/package-submission.py --output "$REPACK_OUTSIDE_CLEAN_DIR"
```

The operator supplies existing private cache directories and exact reviewed
archive identity; the source documentation contains no private endpoints.
Record all test counts/skips, cache/wheel digests, source restoration receipts,
archive/repack equality and isolated-server shutdown. Setup intentionally leaves
model settings blank and never pulls a model or contacts a printer. Model and
physical acceptance are separate gates. Browser acceptance needs a separately
installed compatible browser; skipped browser tests are not successes.

### September 28 real-model feedback after source08

Source08 has a separate completed cached clean-install receipt and is immutable.
The first new electrical-car run did not reach CAD: one response was truncated,
the next reused ARM/STOP identities and exceeded the PWM bound. No car success
was claimed. Runtime feedback now aggregates initial electrical errors, permits
one additional format attempt only after a truncated first or second attempt, and compares claimed
manufacturer motor ratings with the exact selected catalog SKU before freezing
physics inputs. Usable torque must remain below known stall torque. These changes
require a new source freeze and another real-model run; source08 validation does
not automatically cover them. No model-generated design was manually repaired.

The native timeout policy is 240 seconds initially, then at most one unchanged-input
600-second infrastructure retry. Exact ordered intersections may reuse immutable
results for identical geometry/rotation and exactly matching relative translation.
A rotation sweep may stop after a proven collision; its requested/evaluated angles
and partial coverage are retained. Incomplete sampling can never produce PASS.

To run the real-model benchmark, against your existing reviewed loopback service:
`M4KE_BENCH_BASE=http://127.0.0.1:4173 node scripts/benchmark-general-toys.mjs car NEW_OUTPUT_DIR`.
This creates a new project and consumes local inference; it does not purchase,
print, substitute a source kit or count fixture tests as model acceptance.

### Final diagnostic-output and context corrections

A complete native result whose checks FAIL is different from an aborted/partial
build. Only exact input lineage, complete unique part identities, valid part
records, explicit failed checks and every artifact hash allow diagnostic export.
Its verification remains FAILED; assembly and slicing remain blocked. Partial,
missing, duplicated or tampered results remain errors.

Full design/format generation now requests 65,536 context tokens on the same
local model (observed model maximum 262,144), with10,000 output tokens. The
32,768-context retry previously truncated before that output cap. Electrical
output precedes long assembly prose; prompt and generated token counts are
recorded. This is a capacity setting, not a quality or performance claim.

After a prior unaccepted draft itself declares powered motion, its format-retry
decoder schema requires electrical (and control for relative-loudness designs),
rather than leaving the missing field optional. Used terminal anchors remain
host-checked. No component, coordinate, wire or model response is inserted by the
application. Each attempt retains its own schema hash; host guards are unchanged.
