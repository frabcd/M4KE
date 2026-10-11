# Resumable Design Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits Mike's selection; do not delegate merely because this header lists an option.

**Goal:** Resume unchanged design generation from validated units and ask essential questions before geometry, without accepting incomplete or inconsistent CAD intent.

**Architecture:** A private staged runner performs readiness, immutable planning, bounded unit generation and global admission. A checkpoint store binds units and cumulative allowances to exact inputs and dependencies; the existing project store controls admission, explicit resume and cancellation. The existing final design/CAD/pricing contracts remain authoritative.

**Tech Stack:** Node.js ESM, built-in node:test and filesystem/crypto APIs, Vue 3/TypeScript, existing Ollama transport and Python source packaging. No new runtime dependency, cloud provider or model installation.

**Spec:** [Approved specification](../specs/2026-10-11-resumable-design-generation-design.md).

## Global Constraints

- Baseline `9652b1ea077f603adbc20dd848893860145fac9d`; branch `codex/resumable-design-generation`; preserve PR #9 fixes and pricing. The existing isolated checkout is `.references/M4KE-dgx-pricing-rollout` in the user's Hackthon workspace.
- Node version floor stays `>=22.12.0`. Windows development and Linux DGX execution must work. Use the repository's locked dependencies; never install into the teammate's release.
- Read canonical DGX `texting.txt` before shared-file integration or deployment. Maintainer owns PR #9/runtime changes; COOP3 owns this isolated follow-up. Stop and reconcile overlapping edits, never overwrite them.
- No active-service mutation, production-data migration, catalog rewrite, model substitution, automatic answers, concurrent shared inference, purchases or printing during implementation.
- Readiness: 1,500 tokens / 180 seconds; plan: 4,000 / 300 seconds; ordinary unit: 3,000 / 240 seconds. Maximum context 65,536 tokens; reserve 1,024 tokens beyond prompt and output.
- Per generation, including resumes: at most 64 model requests, 60,000 requested output tokens, 40 minutes active wall time. Persist reservation before dispatch; unknown usage retains the reservation.
- One retry per unit; a truncated multi-item unit may spend that retry on single-item children. Children have no further retries. One final-validation repair round, still bounded by aggregate limits.
- Batch limits: 3 parts, 4 electrical components, 12 connections, 4 assembly steps, 8 build items. Global limits remain 24/32/96/48/40 respectively and 12 verification requests.
- New path defaults off behind `M4KE_STAGED_GENERATION=1`; no silent whole-response fallback on failure. Deterministic kits, verification-only flows and existing full refinements/native repairs stay on their existing paths initially.
- Save source/model receipts privately; unit validation is not global PASS. Physical fit remains untested. Speed claims require real comparative measurements.

## Review Focus

1. Duplicate JSON keys, escaped duplicate keys, large nesting and non-finite numeric values must be rejected before a successful checkpoint (Task 1).
2. A crash after reserving work but before saving its response must not reset budgets or cause an orphaned response to be accepted on resume (Tasks 3–4).
3. A cancel request racing with completion or a new workflow must not cancel/publish the wrong revision or release admission too early (Task 7).
4. A repaired source/part with unchanged IDs must invalidate dependent terminals, wiring and instructions despite stable roster IDs (Tasks 2, 5–6).
5. A backend or browser restart must preserve honest stopped state; stale pages must not enable Resume for a new brief or treat saved unit counts as an engineering-completion percentage (Tasks 7–8).

## File and interface map

New server modules:

| File | Responsibility |
| --- | --- |
| `server/studio-generation-json.mjs` | Bounded strict JSON decode, including duplicate-key rejection |
| `server/studio-generation-stages.mjs` | Readiness/plan/unit schemas, stable roster partitions, assembly and dependency graph |
| `server/studio-generation-checkpoints.mjs` | Private identity-bound atomic records and cumulative allowance ledger |
| `server/studio-staged-generation.mjs` | Ordered inference, local retries, resume and progress |
| `server/studio-generation-admission.mjs` | Existing global predicates applied once; structured issue attribution |

Modify narrow integration points in `studio-contract.mjs`, `studio-electrical.mjs`, `studio-service.mjs`, `studio-projects.mjs`, `src/studio/store.ts`, `src/studio/types.ts`, `src/components/BriefPreview.vue` and source packaging. Keep existing skill text authoritative; stage wrappers constrain response format rather than replace design instructions. No broad refactor of the existing service.

Use JSDoc contracts, not a new TypeScript server build. Public module data types:

- `GenerationIdentity`: protocol version, project ID, input fingerprint, input revision (audit only), mode, parent design hash or null, exact model digest/settings, skill/schema/validator hashes, source/snapshot hashes. Identity hash excludes progress-only revision, timestamps and remaining allowances. Input fingerprint includes canonical request, answers sorted by question ID, explicit budget and parent design.
- `UnitDescriptor`: `{key, kind, ids, dependsOn, tokenLimit, timeoutMs, parentKey?}`. Stable keys are host-generated from kind and plan-order index, never model-provided paths.
- `UnitRecord`: descriptor, plan hash, dependency-hash map, validated payload/hash, status and attempt accounting. `UNIT_VALIDATED` is the only reusable success status.
- `GenerationIssue`: `{code, message, unitKeys, attribution:'exact'|'unknown'}`. Unknown attribution stops automatic repair.
- `GenerationResult`: `{status:'questions'|'accepted', spec, generationId, metrics}`. Only an accepted result can enter existing CAD/price publication; the existing questions projection handles clarification.

Shared tests use `tests/helpers/staged-generation-fixture.mjs`: a synthetic inert model, temporary root and deterministic clock; no live network/model calls. Add fixtures only as their owning task needs them.

### Task 1: Strict output parsing and reusable structural validation

**Files:** Create `server/studio-generation-json.mjs`, `tests/studio-generation-json.test.mjs`; modify `server/studio-contract.mjs`, `server/studio-electrical.mjs`; add `tests/studio-generation-validation.test.mjs`.

**Interfaces:** `parseGenerationJson(text,{maxBytes=262144,maxDepth=64}) -> JSONValue`; export existing authoritative item validation through `validateGenerationItem(kind,value,{knownPartIds,knownStepIds}) -> cleanItem`. Kinds: part, electricalComponent, connection, assembly, buildItem, metadata. These validators check fields/ranges and known references without certifying overall engineering validity.

- [ ] Write failing parser tests: `{"id":1,"id":2}` and `{"id":1,"\u0069d":2}` throw `DUPLICATE_KEY`; `1e999`, unsafe prototype keys, incomplete strings, trailing tokens, depth 65 and byte 262145 reject. Valid multilingual text/escaped quotes, empty arrays and finite exponents round-trip without rewriting content.
- [ ] Run `node --test tests/studio-generation-json.test.mjs`; verify the failures exercise absent strict parsing, not environment setup.
- [ ] Implement a bounded JSON token scanner to enforce structure and per-object decoded-key uniqueness, then decode using JSON.parse. No eval, ad-hoc brace completion or partial extraction.
- [ ] Extract only the needed existing item validators, keeping legacy normalized output and errors equivalent. Write tests that identical items get identical normalization through standalone and full validators; invalid shapes/ranges/source identity still reject. Never synthesize placeholder geometry to validate a part.
- [ ] Run `node --test tests/studio-generation-json.test.mjs tests/studio-generation-validation.test.mjs tests/studio-contract.test.mjs tests/studio-electrical.test.mjs`; require zero failed tests.
- [ ] Commit only parser/validator code and tests: `feat: add strict staged output validation`.

### Task 2: Stage contracts, plan binding and deterministic partitions

**Files:** Create `server/studio-generation-stages.mjs`, `tests/studio-generation-stages.test.mjs`, initial shared fixture helper. Reuse schemas from `studio-schema.mjs` and `studio-electrical.mjs`.

**Interfaces:** `validateReadiness(raw) -> readiness`; `validateGenerationPlan(raw,{readiness,sources}) -> plan`; `partitionGeneration(plan) -> UnitDescriptor[]`; `schemaForGenerationUnit(plan,unit) -> schema`; `validateGenerationUnit(plan,unit,raw,completed) -> payload`; `assembleGeneration(plan,records) -> rawSpec`; `dependentUnitKeys(units,changedKeys) -> Set<string>`.

- [ ] Write failing tests for zero geometry fields in readiness, maximum three questions, ready with no fabricated question, exact roster coverage and reference/cardinality rejection. Plan fixtures declare optional sections explicitly and preserve exact requirement IDs/text, kinds, sources and poses.
- [ ] Add partition assertions: seven parts yield `[3,3,1]`, five electrical components `[4,1]`, thirteen connections `[12,1]`; 25 parts reject. Reordered response items assemble in plan order; missing/extra/duplicate IDs and source or pose changes reject.
- [ ] Run `node --test tests/studio-generation-stages.test.mjs` and observe the missing contract failures.
- [ ] Implement derived schemas and explicit field maps from the approved spec. Keep plan metadata immutable; never overwrite original facts or requirements. A late essential missing fact returns clarification or requires an explicit new input revision rather than changing the plan silently.
- [ ] Test conservative dependency closure: a part payload change invalidates all electrical, metadata, assembly and build units, preserving unrelated part units. A plan hash change invalidates all units. For no-electrical plans, omit those units and connect later dependencies directly to parts.
- [ ] Run stage and validator tests; commit `feat: define bounded generation units and dependency rules`.

### Task 3: Checkpoint identity and bounded atomic storage

**Files:** Create `server/studio-generation-checkpoints.mjs`, `tests/studio-generation-checkpoints.test.mjs`.

**Interfaces:** `generationIdentity(input) -> {identity,hash}`; `createGenerationCheckpointStore({root,now}) -> store`; methods `create({projectId,identity,contextSnapshot})`, `load({projectId,generationId,identity})`, `savePlan(generationId,plan)`, `saveUnit(generationId,record)`, `invalidate(generationId,keys,reason)`, `finish(generationId,status)` return durable cloned state. All methods also require the bound project ID or a handle returned by create/load; no cross-project lookup by generation ID alone.

- [ ] Write failing temp-directory tests for create/read/reload; wrong project/UUID; altered input/model/skill/schema/catalog/research hashes; corrupt payload hashes; symlinked ancestors/files; oversized records and unexpected status/keys.
- [ ] Set concrete storage bounds: 4 MiB per generation manifest/context snapshot, 256 KiB per unit, 128 unit records, 32 MiB total per generation. Reject before writing; keep these limits in protocol identity. No background deletion of old evidence.
- [ ] Run `node --test tests/studio-generation-checkpoints.test.mjs` to confirm failures.
- [ ] Implement stable canonical JSON hashing, confined paths under `data/design-checkpoints`, regular-file/symlink checks and atomic UUID-temporary-file rename. Persist schema-versioned complete state; verify every reusable payload and dependency hash on load. Serialize writes for an admitted generation; enforce single-writer application deployment as in the current app.
- [ ] Test interrupted temporary writes cannot replace a valid checkpoint; canonical answer ordering keeps equivalent identity; changed actual answers invalidate it; progress-only revisions do not. Changed current source evidence rejects reuse rather than silently refreshing the frozen snapshot.
- [ ] Run the suite on Windows and later Linux; commit `feat: persist identity-bound generation checkpoints`.

### Task 4: Persisted request and time allowances

**Files:** Extend checkpoint store; create `tests/studio-generation-budget.test.mjs`.

**Interfaces:** `store.reserve({unitKey,attempt,tokenLimit,timeoutMs}) -> {reservationId,timeoutMs}`; `store.settle(reservationId,{elapsedMs,evalCount,promptEvalCount,outcome})`; `store.remaining() -> {requests,requestedOutputTokens,activeMs}`. `now` is injectable; active request timing uses a monotonic clock.

- [ ] Write failing assertions for readiness 1500/180000, plan 4000/300000 and unit 3000/240000; request 65, requested-token 60001 and active-time 2400001 ms reject. Timeout passed to inference is at most remaining active time.
- [ ] Reserve counts and requested output tokens permanently before dispatch. Reserve timeout against remaining active time; settlement replaces the time reservation with measured elapsed time. A crashed/unsettled request retains its full timeout charge and cannot later settle twice. Requested output tokens are not refunded when actual output is shorter.
- [ ] Test reload does not replenish counters, duplicate settlement rejects, cancellation consumes its request, and zero/negative/NaN values reject. Persist unit retry/split/repair counters in the same atomic state transition.
- [ ] Run `node --test tests/studio-generation-budget.test.mjs tests/studio-generation-checkpoints.test.mjs`; commit `feat: bound generation work across retries and resumes`.

### Task 5: Early questions, unit execution and resume

**Files:** Create `server/studio-staged-generation.mjs`, `tests/studio-staged-generation.test.mjs`; extend fixture helper.

**Interfaces:** `runStagedGeneration({identity,contextSnapshot,store,infer,buildMessages,admit,signal,onProgress,resumeGenerationId}) -> Promise<GenerationResult>`. `infer({unit,schema,messages,config,signal,onProgress}) -> {content,doneReason,metrics}` adapts the existing transport. `admit(rawSpec,context) -> {spec,issues}` is supplied by Task 6. Progress includes generationId/stage/unitKey, declared/validated/reused counts, attempt, cumulative elapsed time and remaining allowance.

- [ ] Write a failing fake-model test returning questions; assert calls equal `['readiness']`, and no plan, geometry, CAD or pricing calls occur. Add ready and late-question cases.
- [ ] Write a sequence test: readiness, plan, part batch A succeeds, batch B truncates, split children succeed. Assert A was requested once, its payload hash is unchanged, and the original truncated B content is never accepted. A single-item truncation stops; invalid complete units get only their one targeted retry.
- [ ] Run `node --test tests/studio-staged-generation.test.mjs` and verify intended failures.
- [ ] Implement the runner using Tasks 1–4. Persist reusable units before advancing. Stage messages retain the upstream skill and exact relevant dependency values. Abort stops dispatch immediately. Do not reuse whole-response historical receipts or silently route to legacy generation.
- [ ] Bound prompt bytes conservatively against the 65536 context ceiling using UTF-8 bytes as a conservative token upper bound plus output and 1024 headroom; stop explicitly if it cannot fit. Where the transport supplies authoritative prompt usage, retain it as evidence, not permission to admit an already oversized prompt. Do not truncate source facts to fit.
- [ ] Test restart and explicit resume after a transport failure: saved A reused, unfinished B retried only if its counters allow. Preserve exhausted checkpoints as evidence, but set canResume false when no permitted retry or aggregate allowance remains; only an explicit new generation can start fresh counters. A final-validation repair uses one repair round and invalidates dependencies before executing them again.
- [ ] Test queued cancellation before dispatch, failure after reservation, frozen research reuse with zero new search calls, and all partial/failure results leaving published spec empty. Commit `feat: run and resume staged design generation`.

### Task 6: Global admission without weaker validation

**Files:** Create `server/studio-generation-admission.mjs`, `tests/studio-generation-admission.test.mjs`; narrow extraction from `server/studio-service.mjs`; minimal typed-error additions to authoritative validators as needed.

**Interfaces:** `admitGeneratedDesign(rawSpec,{request,catalog,plan,requirePartExplanations,previousSpec,preserveDecisions}) -> {spec:null|ValidatedSpec,issues:GenerationIssue[]}`. Existing legacy generation calls the same predicates with no stage plan. Original throw/error text remains available; attach stable codes/part IDs only when origin is known.

- [ ] Write failing negative fixtures: locally valid units with missing assembly coverage, cycles, missing electrical roles, invalid library identity, changed requirements or explanation omissions fail before CAD/pricing.
- [ ] Implement shared admission from the existing request constraints, initial draft inspection, explanation rules, architecture bindings, design validation and repair/refinement invariants. Do not reorder away an existing safety check. Pure clarification remains its separate projection.
- [ ] Add exact-attribution test routing a known part error to its unit and dependency closure. Unclassified string errors produce `attribution:'unknown'` and stop; do not infer affected parts by brittle substring matching. Revalidate entire candidate after the one repair round.
- [ ] Run `node --test tests/studio-generation-admission.test.mjs tests/studio-service.test.mjs tests/studio-model-repair.test.mjs tests/studio-repair-execution.test.mjs tests/studio-clarification.test.mjs tests/studio-electrical.test.mjs`. Require zero failures and unchanged legacy fixture outputs/hashes. Commit `refactor: share global admission with staged generation`.

### Task 7: Project API integration, explicit resume and cancellation

**Files:** Modify `server/studio-projects.mjs`, `server/studio-service.mjs`; create `tests/studio-staged-projects.test.mjs`; extend `tests/studio-projects.test.mjs` and `tests/studio-service.test.mjs`.

**Interfaces:** `/api/studio/projects/:id/run` accepts optional `resumeGenerationId` only on the supported staged fresh-design path. Require `expectedRevision` for resume. Add `POST /api/studio/projects/:id/cancel` with `{expectedRevision,workflowId}`. Project store exposes `cancel(id,input)` and passes an owned `signal` as the fourth argument to `execute(project,input,checkpoint,signal)`; existing executors can ignore it. Workflow gains generationId, generationState, canResume and canCancel, never raw checkpoint contents.

- [ ] Write failing tests for existing revision/admission locks, explicit resume with unchanged bound input, stale revision/changed answers rejection before inference, and zero automatic resume after process restart.
- [ ] Wire opt-in `M4KE_STAGED_GENERATION=1` only for fresh project generation without accepted parent parts. Preserve default legacy and existing kit/verify/refinement/CAD-repair routing. Require exact model/digest; no fallback model.
- [ ] Connect the shared inference mutex and staged signal to `localFetch`. Cancel aborts only the matching admitted workflow; admission remains held until runner exit/final persistence. Cancel after completion is an idempotent no-op only for that same workflow; stale or different workflow IDs reject. Server restart never inherits a live abort controller.
- [ ] Test cancel/completion and cancel/new-workflow races, late result rejection after cancellation, duplicate resume admission, stopped-state persistence and cancelled run resumption only with remaining allowances.
- [ ] Verify no `project.spec`, designHash, native CAD or price callback for partial stages/questions. Accepted output uses existing `priceDesign` and final-hash checks. Run new tests and project/service/pricing suites; commit `feat: expose safe staged resume and cancellation`.

### Task 8: Honest EN/ZH progress and actions

**Files:** Modify `src/studio/types.ts`, `src/studio/store.ts`, `src/components/BriefPreview.vue`; extend `tests/studio-shell-e2e.mjs` using the existing Vue browser fixture.

**Interfaces:** Store actions `resumeGeneration()` and `cancelGeneration()` use server-provided generation/workflow IDs and the currently loaded expectedRevision; `startWorkflow` retains an explicit start-over path. No client-side checkpoint acceptance or resume eligibility calculation.

- [ ] Add failing browser cases for readiness, validated/reused unit counts, stopped resumable run, exhausted budget, cancellation pending and stale-page 409. Assert missing/stale eligibility hides Resume and default legacy views have no unsupported Cancel.
- [ ] Implement labels in EN/ZH: stage and counts, not engineering percentage. Keep last accepted design separate from private draft progress. Resume and Start over are distinct actions; cancellation never unloads a model. Button disablement prevents double-submit while server admission is authoritative.
- [ ] Test browser reload reads authoritative state, cancelled generation never flashes complete, prior design remains intact and errors explain stale inputs without inviting unsafe automatic reuse.
- [ ] Run `npm run typecheck`, `npm run build`, `node tests/studio-shell-e2e.mjs`; commit `feat: show staged generation progress and resume controls`.

### Task 9: Packaging, regression and independent review

**Files:** Modify `scripts/check-submission.py`, `SUBMISSION-MANIFEST.json`, `.env.example`; add `docs/resumable-generation.md`; extend `tests/submission_package_test.py` and package source allowlist tests as required.

- [ ] Add failing packaging tests for required new server modules and exclusion of private `data/design-checkpoints` and real test receipts. Add the disabled-by-default flag to the blank example only; never write a real credential or host address.
- [ ] Update source allowlists; run `python scripts/package-submission.py --output .setup/resumable-generation-review-<unique-run-id>.zip` with a fresh path, then `python scripts/check-submission.py .setup/resumable-generation-review-<unique-run-id>.zip`. Preserve the generated manifest for those exact archived bytes; never copy projected catalog/data files over source or live assets. Document supported fresh-design/resume/cancel behavior, budget limits and unanswered physical requirements. Keep this plan/spec outside the runtime ZIP unless its allowlist explicitly admits them.
- [ ] Run `npm run check:source`, `python -m unittest discover -s tests -p submission_package_test.py`, `node --test tests/live-prices.test.mjs tests/studio-refinement.test.mjs` and all new stage test files. Run `node tests/live-prices-browser.mjs`, `node tests/studio-electrical-e2e.mjs` and `node tests/studio-shell-e2e.mjs` against isolated fixtures. Require zero failures; report actual pass/skip/fail counts. Supplier-CAD suites without assets remain deferred.
- [ ] Repeat platform-sensitive checkpoint/cancel tests in an isolated Linux directory; do not link production data. Inspect current branch diff for secrets, unrelated changes and teammate overlap. Obtain whole-branch review under the execution method selected by Mike; resolve actionable findings with reproducing tests.
- [ ] Commit `docs: package and document resumable generation`; provide a reviewable PR under existing user authorization only after verification. Attach every created PR. Do not merge/deploy merely because the feature flag is off.

### Task 10: Coordinated acceptance and rollout handoff

**Files:** Add `scripts/benchmark-staged-generation.mjs`, `tests/staged-benchmark.test.mjs`; evidence goes in ignored local output, not source history.

**Interfaces:** Benchmark command requires explicit endpoint, exact model, isolated data destination, supplied brief/answers, output directory and a bounded request timeout. It records protocol/source/model/input hashes, per-call prompt/output counts, elapsed time, questions, reuse, admission, native CAD and preview status separately. It never assumes a default device or launches automatically during tests.

- [ ] Write fixture tests that mismatched before/after input hashes reject speed comparison, clarification is not CAD success and missing price/native/preview evidence stays unverified.
- [ ] Implement the receipt collector against existing project APIs, including terminal questions/error handling and explicit status polling. It must not load/change models, acquire a shared slot by silence or answer questions.
- [ ] Before any real run, read coordination, get actual resource handoff, verify owner/model and bounded run conditions. Test the original frozen car and one user/upstream-supplied non-car brief in isolation. Use identical explicit answers for any controlled before/after comparison. Do not make up decisions to complete the car.
- [ ] Record actual reuse and token/time results. If extra calls make the run slower, report that honestly and keep the capability opt-in while tuning a separately reviewed batch policy. Software checks alone cannot establish performance acceptance.
- [ ] Hand off exact commits, results, unresolved questions, deployment flag and rollback instructions to the maintainer. Only activate after a separate coordinated idle rollout with existing data/catalog/settings fingerprints preserved. Production remains unchanged if model or artifact acceptance is incomplete.

## Execution order and self-review

Tasks 1–4 establish the private protocol and store; 5–6 establish execution/admission; 7–8 expose it; 9 verifies distribution; 10 collects separately authorized hardware evidence. Work sequentially because all tasks share contracts and integration points. Commit each reviewed unit; never commit a knowingly failing test as finished work.

Self-review: every approved-spec section maps to Tasks 1–10. The five Review Focus cases have explicit owning tests. Method names, UnitDescriptor/GenerationResult fields and resource limits are consistent across tasks. No task claims physical acceptance or authorizes production deployment merely through completion of code. Planning refinements (storage limits, disabled flag name and cancellation API) make implementation explicit without changing the approved outcome.

Status: plan prepared for Mike's review; none of the implementation checkboxes is complete. Recommended execution: Native, sequentially in this chat, followed by a whole-branch review, because the state, validation and cancellation contracts are tightly coupled. Preserve teammate ownership and re-read coordination before integration.
