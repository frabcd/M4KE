# Resumable structured design generation

Status: proposed specification for Mike's review. The approach is approved; implementation has not started.

Owner: COOP3. Baseline: `9652b1ea077f603adbc20dd848893860145fac9d`, including the maintainer's PR #9 geometry-patch retry correction. Work stays on `codex/resumable-design-generation` in COOP3's isolated checkout. The maintainer retains ownership of PR #9 and deployed service changes. Coordination occurs through the canonical DGX `texting.txt` and PR discussion; deployment requires a separate, coordinated idle window.

## Outcome and boundaries

For an unchanged design request, save complete validated generation units and reuse them after a retry or explicit resume. A truncated or invalid unit must not force another response containing the whole design. Ask essential questions before expensive geometry generation. Assemble all units into the existing design contract and run the existing global validation before CAD, accepted-design publication or automatic pricing.

This changes execution of the designated upstream design skill. It does not move product-design responsibility into host code: the model still selects components, dimensions, topology and placements under that skill. The host never chooses battery chemistry, speed, hardware substitutions or question answers. Existing source identities, physical UNKNOWN results, repair restrictions, requirement checks and price/design-hash binding remain enforced.

The work does not modify current projects, the production catalog, live settings, installed models or the active service. No current run is migrated into the new protocol. Source-only fixtures do not prove model quality, speed, CAD acceptance or physical fit.

## Evidence and present behavior

The latest 122B car run took about 13 minutes 20 seconds. Its first response exhausted 10,000 tokens in 397.1 seconds; the second completed at 10,094 tokens in 386.8 seconds. The result asked about battery chemistry/voltage, budget and target speed. Existing clarification handling correctly discarded premature geometry. No accepted CAD design or price report resulted.

In `server/studio-service.mjs`, `generate()` currently rebuilds a complete design prompt for a format retry. `clarificationFromDraft()` runs after a whole response is parsed. `studio-projects.mjs` persists project progress but does not provide reusable generation sections; a restart changes an interrupted workflow to an error. `studio-model-repair.mjs` already implements bounded patches for a fully validated parent design. These mechanisms will be reused rather than weakened.

## Alternatives considered

1. Increase output limits again: small change, but repeats completed output and delays unanswered questions. Retain the maintainer's bounded recovery for existing legacy flows; it is not the new protocol.
2. Continue raw truncated JSON: may save tokens but makes duplicate fields, unfinished strings, conflicting IDs and hidden state difficult to validate. Rejected for this implementation.
3. Generate complete bounded units, checkpoint them, then assemble and validate: selected. Adds prompt/call overhead and storage, but gives explicit reuse and failure boundaries. Actual end-to-end latency must be measured; smaller calls are not inherently faster.

## Workflow

`readiness -> plan -> unit generation -> global validation -> existing CAD/pricing workflow`

Each arrow requires validated structured output. A saved unit is a private draft, never an accepted design or a manufacturing result.

### 1. Readiness

For a fresh design, send the brief, exact answers and budget, relevant source metadata, and upstream skill instructions to a small schema that cannot contain geometry, circuits or assembly instructions. It returns either `questions` or `ready`, plus bounded requirements, assumptions and unknowns. At most three essential questions are permitted per turn, consistent with the existing clarification contract.

Questions produce the existing `pendingQuestions` UI and stop immediately; there must be zero geometry-generation requests, CAD requests and price calls. Do not force questions for every request. Existing answers are included so the model can assess what remains unresolved. The host checks answer/reference structure, not whether a product decision is good. A model's `ready` response is not engineering verification. If a later stage discovers a necessary question, stop and record it without publishing draft geometry.

### 2. Immutable plan and roster

The model returns a compact plan with stable part IDs, kinds, source identities, global poses and interface/layout intent, plus the IDs of required assembly steps, electrical components/connections, build items and verification requests. It declares which optional sections apply, explicitly representing absent sections. Requirements and user-supplied constraints remain bound to the request.

The plan must fit within existing global cardinalities: at most 24 parts, 48 assembly steps, 32 electrical components, 96 connections, 40 build items and 12 verification requests. No new host-selected part or topology is introduced. Resolve admitted catalog/library identities against the same source context used for the plan; appearance alone never qualifies a component.

Structural checks enforce unique IDs, valid references and declared section coverage. A plan is still unaccepted model intent. Once validated, its hash becomes a dependency of every generated unit. Automatic unit repair cannot add/delete roster IDs, change source identities or rewrite the requirements. A necessary plan change stops for explicit upstream revision; it is not concealed inside a geometry retry.

### 3. Complete bounded units

Derive unit schemas from the existing design schema and electrical schema so field requirements do not drift. Generate only assigned roster IDs; require exact coverage and reject extras and duplicates. Empty or omitted output does not mark assigned work complete.

Initial deterministic partitioning:

| Unit | Maximum per request | Dependencies |
| --- | --- | --- |
| Part details | 3 parts | readiness and full immutable plan |
| Electrical terminal details | 4 components | plan and all completed part geometry |
| Electrical connections | 12 connections | plan, all parts and all electrical terminal details |
| Electrical control / physics / verification metadata | one bounded metadata object | plan, parts and electrical units |
| Assembly instructions | 4 steps | plan, all parts, electrical units and metadata |
| Build items | 8 items | plan, parts, electrical units and metadata |

Final title, description, units, requirements, assumptions and unknowns originate in the plan/readiness contract; units are always millimetres. Do not ask later calls to reproduce prior completed units. Supply the immutable plan and relevant dependency data as context, preserving exact identities and dimensions rather than a lossy prose summary. Enforce context-size limits and stop explicitly if dependencies cannot fit.

Every unit is a complete JSON value. `done_reason=length`, malformed JSON, unsupported fields, unknown IDs or an incomplete assigned roster are failures. Never recover apparent complete objects from a truncated response, invent closing braces or concatenate raw responses.

Use host structural validation before checkpointing. Extract reusable field/item validators from the existing contract where needed without constructing fake placeholder parts to pass `validateDesignSpec`. Local schema success is labelled `UNIT_VALIDATED`, not global PASS. Source/path/hash checks and full engineering validators remain downstream.

### 4. Durable checkpoints and explicit resume

Store private checkpoints under `data/design-checkpoints/<project-id>/<generation-id>/`. Use generated UUIDs, bounded JSON records, atomic temporary-file rename, per-project workflow admission, safe path checks and no symlink traversal. Checkpoint bytes, unit count and cumulative work are bounded; unfinished raw output belongs only in bounded diagnostic receipts.

A checkpoint records:

- Protocol version and exact canonical identity hash.
- Project/generation IDs and starting input revision, separate from progress-only project revisions.
- Hashes of brief, answers, explicit budget, generation mode and parent design when present.
- Model digest, inference settings, upstream skill hashes, schema/validator protocol version.
- Catalog, native-library, candidate/source-context and frozen research-snapshot hashes.
- Plan hash, assigned IDs, unit key, dependency hashes, validated payload hash and status.
- Attempts, output budget, token/elapsed-time measurements, errors and aggregate remaining limits.

Freeze source/research context at generation start. Resume uses that exact verified snapshot; it must not silently re-search the web and treat changed content as identical. If the required snapshot/model/skill/source evidence is unavailable or changed, report a stale checkpoint. Do not relax identity to make reuse possible.

The existing `run` route gains an optional `resumeGenerationId` for explicit continuation, checked alongside `expectedRevision`. An interrupted workflow remains visibly stopped after a restart. It does not restart automatically. The UI offers Resume for a matching unfinished generation, and Start over separately. A mismatched resume returns a clear conflict without launching inference. Progress-only revisions do not invalidate a checkpoint; changes to request/answers/budget/design do.

For the staged path, add a project-scoped cancel action carrying `expectedRevision` and the workflow ID. It aborts only that admitted workflow's inference request through an owned AbortController, then records a stopped/error workflow with a cancellation reason and retained resumable checkpoints. It never stops the application service or unloads a shared model. A stale or different workflow ID cannot cancel another run. UI polling continues until cancellation is acknowledged; it must not release resource ownership solely because a cancel request was sent. Legacy workflows do not silently acquire unsupported cancellation behavior.

This version intentionally does not reuse checkpoints across edited briefs or answered clarification turns, because those inputs may alter every design decision. It does reuse unaffected units within the same bound request when a later unit or final validation fails. Historical whole-response car output is not a valid new-protocol checkpoint and will not be imported as one.

### 5. Retry and invalidation

For an invalid/truncated unit, retain prior validated units unchanged and retry only that assigned unit with concrete diagnostics. Permit one retry per unit; there is no silent whole-design fallback. If it still fails, stop with a resumable error and preserve evidence.

If a fully received unit exceeds its practical budget, do not skip fields. If an initial multi-item unit truncates, its single retry may split the same assigned IDs into individual complete-item requests, within the unchanged aggregate limits; a single-item truncation stops. Each split item has its own durable key and coverage is checked against the original assignment. This is partitioning, not continuation of raw JSON.

Splitting consumes the original unit's retry allowance: split children receive one request each and no further split/retry in that round. All children consume the same persisted generation-wide request/token/time budget. Successful children can be reused on explicit resume, but exhausted retry counters cannot reset. A separate final-validation repair round also draws from these aggregate limits.

Unit hashes determine downstream validity. Part repairs retain unaffected part units but invalidate dependent electrical/metadata/assembly/build units. For this first version, conservative whole-stage invalidation is required where dependency precision cannot be proven. Performance takes second place to avoiding stale constraints or wiring. A plan, model, skill, schema or bound-input change invalidates the entire generation.

Final validation must use structured issue attribution. Known part/section issues can trigger one bounded repair round affecting only assigned units and their dependency closure. If an issue cannot be safely attributed, stop with the complete candidate and diagnostics; do not guess which fields are disposable or regenerate everything. Existing post-CAD model patches remain governed by `applyModelRepair` and `validateRepair`; this feature does not enlarge their permission to change hardware or acceptance criteria.

### 6. Global admission and publication

Assemble by roster order, not response arrival order. Reject missing/duplicate items, unknown references, assembly dependency cycles and mismatched source identities. Apply the existing request constraints, design contract, initial-draft checks, electrical rules, explanations, architecture binding and repair/refinement invariants. A locally valid unit cannot bypass any global gate.

Only the globally admitted specification gets a design hash and enters the existing CAD workflow. Persisted partial units never populate `project.spec` as an accepted design. No price report is published for checkpoint-only work; automatic pricing continues to bind to the admitted/current design hash through existing project-store logic. CAD/preview evidence and physical testing retain their existing separate meanings.

## Resource limits and progress

Initial readiness output limit: 1,500 tokens; plan: 4,000; ordinary unit: 3,000. These are execution limits, not permission to omit fields. Freeze them in generation identity. Keep context at or below the supported existing 65,536-token ceiling, reserve prompt/output headroom and reject unbounded context expansion.

Across retries and explicit resumes, retain one cumulative ceiling of 64 model requests, 60,000 requested output tokens and 40 minutes of active wall time per generation. Each request is capped at 180 seconds for readiness, 300 for planning and 240 for ordinary units, further limited by remaining total time. An in-flight request uses an abortable deadline. Persist budget reservation before dispatch so a process crash cannot reset the allowance. Unknown token usage consumes the reserved budget. Exhausted generations require an explicit new attempt and remain unsuccessful.

The totals are initial operational bounds, not a guaranteed completion time. The UI shows stage, validated units versus declared units, reused units, attempt and cumulative elapsed time. It must not label this a percentage of engineering completion. Retain EN/ZH error and retry labels. Failed/cancelled generation never reports complete.

## Compatibility and ownership

- Start with an explicit staged-generation capability flag, default off until fixture and isolated-model evaluation. Once accepted, it becomes the normal fresh-design path; supported clients keep the existing final design contract.
- Deterministic kits and verification-only workflows retain existing behavior.
- Existing saved designs, previews, authored car geometry, firmware, procurement observations and historical run receipts are not migrated or rewritten.
- Existing full refinement and native-CAD repair protocols remain intact initially; the resumable guarantee applies to the new fresh-design pipeline. Broader refinement checkpoint reuse is separate work and will not be claimed here.
- The maintainer's latest PR #9 retry fixes remain in the baseline. COOP3 owns new generation/checkpoint modules and the narrowly required service/project/UI integration. Re-read coordination and inspect diffs before integration.
- No automatic production restart, model replacement, concurrent inference or hardware test is part of implementing this spec.

## Expected touched paths

New focused server modules: `studio-generation-stages.mjs` (protocol/partitioning), `studio-generation-checkpoints.mjs` (bounded identity/persistence), `studio-staged-generation.mjs` (orchestration). Names are proposed and may be adjusted without changing behavior.

Existing integration points: `studio-service.mjs`, `studio-projects.mjs`, `studio-schema.mjs`, reusable validators in `studio-contract.mjs`, EN/ZH generation progress in `BriefPreview.vue`, relevant studio types/actions, packaging allowlist and generated submission manifest. Design skill text changes, if needed for staged messages, must preserve the designated skill's authority and source boundaries.

## Verification and acceptance

Required regression cases:

1. Essential questions return before any geometry, CAD or pricing call; ready requests proceed without manufactured questions.
2. Truncation in a later unit causes no earlier validated unit to be requested again. Unchanged payload hashes survive retries and explicit process-restart resume.
3. Malformed output, incomplete/surplus IDs, duplicate fields/IDs, unsafe keys, corrupt files and symlink/path attacks cannot become checkpoints or accepted specs.
4. Wrong project/generation, edited brief/answer/budget, changed parent/model/schema/skill/source context and missing snapshot reject resume before inference.
5. Progress-only revisions allow resume; stale `expectedRevision` does not. Concurrent starts/resumes use the existing admission boundary.
6. Changed part content invalidates all declared downstream dependents. Untouched independent part units remain reusable. Removed/added roster items cannot slip through repair.
7. A locally valid collection that violates global references, assembly coverage, required control roles, source identity or request constraints fails before CAD/pricing.
8. Retry/split/repair limits, per-request cancellation, crash-after-budget-reservation and cumulative resume budgets remain bounded.
9. Existing immutable repair rules, whole-design validators, legacy workflows, automatic pricing binding and EN/ZH UI regressions still pass.

Record source tests, packaging checks, typecheck/build and browser checks separately from model results. Use fixtures for negative controls; do not claim those demonstrate 122B speed.

After software verification and a coordinated GPU slot, compare the original frozen car brief and at least one non-car case against recorded baseline evidence. Record questions, total prompt/output tokens, calls, reused units, elapsed time, global acceptance, native CAD and preview outcomes. For a clarified brief, both sides must use the same answers for a fair speed comparison. Existing 13m20s evidence is diagnostic, not a controlled before/after benchmark.

Acceptance requires demonstrated reuse without reduced correctness and no premature CAD/pricing. A latency improvement must be separately measured; if extra calls make the overall run slower, report that result and revise the batching strategy rather than claiming success. No 100% accuracy, universal model compatibility or physical-fit guarantee is implied.

## Review and next step

Self-review completed for scope, immutable IDs, conservative invalidation, finite retry/split/resume budgets, compatibility and evidence claims. This document is a design proposal, not implemented functionality. Mike's review of this written spec precedes the detailed implementation plan and code changes.
