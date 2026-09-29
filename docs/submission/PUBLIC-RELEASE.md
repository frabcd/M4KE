# M4KE public source release — 2026-09-29

The project owner approved publishing `frabcd/M4KE` publicly under the existing
MIT licence for original M4KE code. This is a software prototype source release,
not a claim of physical-car acceptance or third-party asset redistribution rights.

## Release scope

- The owner-supplied Chinese README is the project homepage. Its historical
  regression count is labelled as a snapshot rather than a test of this release.
- Qwen and the optional online adapter use the same Vue entry, components,
  design workflow, viewport, conversation controls and edit-confirmation process.
- Shared product copy uses **AI** without internal assistant/session links.
  Runtime settings and per-response model metadata retain the actual provider.
  An online run is not labelled offline or Qwen-generated.
- A fresh installation defaults to the local Ollama protocol, with endpoint and
  model left unconfigured until explicitly selected. The README also documents
  local vLLM / Qwen. No cloud fallback or online bridge starts automatically.
- Source includes the latest project-loading and bounded inference-timeout fixes.
- Original skills and reviewed component/interface metadata are included.
  Model weights, supplier CAD bytes, the teammate database, private configuration,
  SSH/tunnel scripts, user projects and raw execution records are not included.

## Verification for this release

Working-checkout checks: 553 Node tests passed, 6 skipped, 0 failed; typed
Vue/Vite build passed; 11 packaging/privacy/integrity tests passed. Browser
workflow, electrical and viewport suites passed, including a paired Qwen/online
provider check of identical panel geometry, navigation and conversation controls,
no internal tool links, and accurate model identity in runtime settings.
The reduced-motion test now waits for the asynchronous media-query/render update
before asserting the same disabled-control and stopped-animation requirements.

Browser fixture tests check software interaction and provider parity, not real
model success or physical feasibility. Historical evidence stays historical.
Independent source-only installation (Windows, Node 22.19.0):

| Check | Result |
| --- | --- |
| Fresh locked dependency installation | PASS (`npm ci --offline`, 65 packages) |
| Source-only regressions | 483 passed, 20 skipped, 0 failed; 9 supplier-CAD suites deferred |
| TypeScript / Vue / production build | PASS |
| Archive privacy, boundaries and integrity | 11 passed |
| Browser workflow / electrical / WebGL | 48 checks passed (18 + 16 + 14) |
| Provider parity | Same workspace layout and controls; accurate runtime source retained |
| Isolated production-server startup | PASS; local Ollama protocol, blank endpoint/model, no cloud fallback |
| Native DGX installation / real inference / physical test in this release pass | NOT RUN; this pass makes no new claim for them |

The isolated server was stopped after its startup check. No production project,
model configuration, teammate database or printer was modified. The generic
privacy scan plus a constant-folded audit found no retained operational identifiers
in the approved source snapshot; this is bounded checking, not a universal secret
or licence guarantee.

The old private repository and release artifacts stay private. The public
repository starts with a reviewed source snapshot rather than exposing operational
identifiers from old history. The generic scanner no longer embeds those values.

## Reproduce the checks

```bash
npm ci --no-audit --no-fund
npm run check:source
python3 -B tests/submission_package_test.py
npx playwright install chromium
npm run test:e2e
python3 scripts/package-submission.py --public --output m4ke-public-source.zip
python3 scripts/check-submission.py m4ke-public-source.zip
```

The source test runner reports supplier-CAD suites as deferred when those
separately licensed assets have not been restored. Deferred is not passed.
The packaging command never uploads or changes repository visibility; public
approval is explicit and the source allowlist and hashes remain enforced.

## Known limits

The recorded local Qwen example modifies an existing F1-style design. A separate
fresh whole-car test failed CAD and electrical checks. Neither this source release
nor browser regression results establish physical printing, assembly, calibrated
60 dB SPL operation, motion or child safety. See the README and historical
validation records for the distinction.
