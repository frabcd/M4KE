# Resumable design generation (opt-in)

Set `M4KE_STAGED_GENERATION=1` only in an isolated, coordinated installation.
The default remains the existing workflow. This feature changes execution of the
design skill's output; it does not select hardware or supply missing user decisions.
It does not establish model quality, physical fit, printability, or faster execution.

## Supported path

Fresh projects using a local provider with an exact installed model name and digest
can generate readiness questions, a fixed plan, and bounded complete JSON batches.
Questions stop before geometry. Kits, accepted-design refinement, verification,
native CAD repair and the Codex bridge retain their existing paths.
Cached sourcing and library context are frozen; no new model-driven research call
runs outside the generation budget. Verification requests come from the metadata
stage; the host's global validation and native checks still apply.

Every complete batch is checked before saving. Only the assembled design admitted
by the existing global validators can proceed to native CAD and automatic pricing.
Partial outputs and questions never publish a new design hash or price report.
Pricing remains source-linked candidates, not a complete checkout quote.

## Resume, start over, cancel

The UI shows validated and reused batch counts, not engineering completion percent.
Resume appears only when the server confirms eligibility and inputs are unchanged.
Start over creates a separate generation with new budgets; old evidence remains.
Cancel aborts only the owned generation request and holds admission until it exits.
It does not stop the model server. Native CAD steps are not cancellable here.

`POST /api/studio/projects/:id/run` accepts `resumeGenerationId` and requires the
current `expectedRevision` for resume. Reuse is bound to the brief, answers, budget,
mode, installed model/digest, skill/schema/validator hashes, source and frozen
context. Progress-only revision changes do not invalidate otherwise identical
input. Stale inputs return a conflict. Restart never resumes automatically.
`POST /api/studio/projects/:id/cancel` requires `workflowId` and `expectedRevision`.

## Fixed limits

Across retries and resumes: 64 requests, 60,000 requested output tokens and 40
minutes active request allowance. Readiness: 1,500 tokens / 180 seconds. Plan:
4,000 / 300 seconds. Each unit: 3,000 / 240 seconds. Each unit has one retry;
truncated multi-item units may split as that retry, with one call per child.
There is at most one final targeted repair round. Its dependent batches are
invalidated; unrelated validated batches survive. Unclassified errors stop.
Requests and requested tokens are never refunded. An unsettled request after a
crash retains its full timeout charge. UTF-8 prompt bytes plus requested output
and headroom must fit the conservative 65,536 context limit.

Private data lives in `data/design-checkpoints/<project>/<generation>/` with
validated UUID paths, symlink rejection and atomic writes. The state including
units and the context each have a 4 MiB limit; each unit has a 256 KiB limit.
The single manifest cap is stricter than the total protocol ceiling and can stop
unusually verbose generations early. Keep a single application writer per root.
Checkpoints, raw model receipts and test artifacts are never in the source ZIP.

## Verification and rollout

Deterministic test replies exercise recovery and admission; they are not evidence
that Qwen will produce an acceptable car or that staging is faster. Compare only
runs with identical supplied inputs and model identity. Real acceptance needs a
coordinated idle slot, answered essential questions, actual native CAD, and an
inspected connected preview. Physical fit and strength remain NOT_TESTED.

Before rollout, check the shared coordination file, verify the exact source/model
and preserve existing data/catalog/settings fingerprints. Keep the flag off until
separate model and artifact acceptance. Roll back by disabling the flag and
restarting only the owned idle application under the normal deployment process;
preserve checkpoint evidence. Never restart a teammate's active workflow.

## Isolated receipt collector

Checkpoint protocol 2 stores final-repair diagnostics, failed payloads and
dependency invalidation in one atomic update. Older experimental checkpoints
require an explicit new generation. Staged decoder schemas use the existing
Ollama compatibility projection; strict host validation remains authoritative.
Every staged inference dispatch has its own durable allowance; the legacy
transport's automatic runner replay is disabled only for staged calls.

After the operator grants the resource slot, start an isolated application with
an empty project directory and the opt-in flag. The collector does not start the
application or change its settings. Its data root is the isolated app root (the
directory containing `data/`), accessible on the machine running the collector.
Supply a JSON file containing the upstream/user's exact `request`, `answers`
array and `budget` string. No answers are supplied automatically.

For a production-source benchmark, restore the separate approved catalog into the
isolated app and pass `--expected-catalog-sha256=<manifest SHA256>` from the intended
source snapshot. A source-only ZIP has an empty catalog and does not represent a
production hardware inventory. The collector rejects a mismatched manifest before
creating a project or running inference, and records the matching hash/count in
`source-preflight.json`. Changing the source snapshot prevents speed comparisons
with previous trials even when the user brief is identical.

Set `M4KE_BENCH_COORDINATED=1` only after actual coordination, then invoke:

```text
node scripts/benchmark-staged-generation.mjs --endpoint=<isolated-app-url> --model=<exact-installed-tag> --data-root=<isolated-app-root> --brief=<input.json> --output=<new-output-directory> --timeout-ms=2400000
```

The directory must be new; receipts contain private input fingerprints and model
usage and belong outside source control. The collector checks model configuration,
staged capability, empty project storage and endpoint/root agreement. It creates
only its own project. On failure it attempts to cancel only its owned cancellable
workflow. `stopConfirmed:false` requires operator follow-up; do not assume a
timed-out HTTP request stopped the server. A receipt's `ARTIFACTS_REPORTED` means
the API reported CAD files, not that their geometry was inspected. Connected
preview and physical acceptance remain `NOT_TESTED` until separate examination.

## Integration and verification

Built on merged PR #10 (main `7bee938`), preserving the maintainer's compact
recovery and cancelled/stale assistant persistence fixes. Windows source
regressions: 619 passed, 21 skipped; typecheck and production build passed.
Package tests: 13 passed. EN/ZH workflow, pricing and electrical browser fixtures
passed. Thirty-three Linux checkpoint/runner/cancellation tests passed in a fresh
temporary directory; no deployed data or inference was used. Nine supplier-CAD
suites still require separately restored assets.

Independent whole-branch review findings were reproduced and corrected in one
pass; 78 targeted tests passed afterward. The two initially minor recovery/status
findings were treated as important and fixed. No minor findings remain deferred.
These results do not establish actual-model quality, speed, CAD/preview acceptance,
physical fit, or completeness of supplier prices.

Implementation rulings: checkpoints use a stricter single 4 MiB atomic state plus
4 MiB context instead of the outer 32 MiB limit, so unusually verbose generations
can stop earlier. The staged route freezes cached sourcing and includes verification
planning in metadata; it performs no extra unbudgeted model research. Live supplier
pricing follows admission through the existing connection. If the benchmark loses
its start response, workflow ownership is unknown: report the observed status,
leave stop unconfirmed, and request operator follow-up instead of cancelling an
unidentified workflow. Actual performance acceptance remains pending.

Stage prompts route verbatim sections of the loaded upstream design skill instead of resending the entire monolithic design prompt. Intake receives capability identities; planning receives admitted source inventory; later units receive exact selected source records. All original data and stage rules remain in the hash-bound checkpoint, and changed routing invalidates resume identity. New upstream headings are retained by default. The conservative context guard still stops oversized stages explicitly; this is not a guarantee that every large request fits. Held candidate references and deterministic kit options are outside fresh staged generation.

Actual122B follow-up: context fix allowed two real readiness calls (3613/3618 prompt tokens;1105/1075 output tokens). Both stopped normally but violated status/questions consistency and were rejected. Readiness decoder now uses two discriminated alternatives: ready with zero questions, or questions with1–3 questions. The existing host invariant is retained; no status rewriting, discarded questions or forced pass. A decoder-projection regression reproduces the old mismatch and verifies both valid alternatives and both rejected contradictions.

Actual 122B follow-up after the readiness correction: readiness passed, then two planning calls failed host validation with `output: unsupported key status`. The run finished in 112.2 seconds with three model calls and no accepted design. Inspection found that the later-stage decoder allowed the full readiness schema, including `ready`, although the runner accepts only its assigned payload or a late clarification. Later stages now permit only their stage schema or `questions` with 1–3 questions. Regression coverage exercises both host and Ollama-projected contracts across plan, part, metadata and assembly. This latest correction is source-tested, not yet verified by another real-model run. CAD, connected preview, physical fit and pricing remain NOT_TESTED. PR11 remains draft.

Current generation-quality correction: planning emits only choices and bounded
newAssumptions/newUnknowns. The host copies exact durable intake text into the
stored plan. Source identities in the decoder come from the frozen admitted
catalog/library inventory; electrical profile IDs cannot stand in for native CAD.
Parts keep exact planned identity, pose and source in their assigned decoder.
Progress reports measured inference time, while durable budget accounting keeps
conservative reservations. Planning receives the geometry coordinate convention;
full feature rules reach later geometry stages. Every distinct source/control fact
remains in the frozen context.

For same-design native/electrical/assembly observation use `--mode=auto`; the default
`--mode=design` stops at design generation. Neither a generated plan nor a reported
CAD artifact establishes visual quality or physical operation. Latest isolated
Linux source regression:655 passed,20 skipped,0 failures. Actual full-catalog car
trial v3 stopped after300.8s with rejected fabricated catalog identities, before
CAD. A bounded retest is pending; this is not a five-minute success benchmark.
