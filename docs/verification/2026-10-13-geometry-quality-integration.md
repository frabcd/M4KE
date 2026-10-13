# Geometry and generation-quality integration

Combined PR16 e30a403 with upstream PR15 374e828 on an isolated branch. Upstream design skill and source/electrical selection fixes are preserved; no production deployment or model inference was performed for this integration.

Integration regressions reproduced and corrected:
- Proposal construction inherited optional geometry fields as mandatory. Required lists now preserve the parent contract, including legacy proposals and v2 profiles without attachments.
- Host pose guidance contradicted declared attachment placeholders. Attached children now explicitly resolve from design-owned datums; roots retain authored poses.
- Legacy upstream grammar excluded profiles/datums. A constant host system extension clarifies only current execution capabilities, after legacy rules, without promoting user/source text to instructions or changing design ownership.
- The per-part decoder now requires planned datum count/names; host uniqueness and roster validation remain authoritative.
- Host instructions were compacted within the unchanged prompt budget. Source data, upstream skill sections and acceptance checks were not removed. Checkpoint identity includes the host-guidance source file.

Verification:
- Full source suite in a hash-matched clean snapshot: 677 passed, 21 skipped, zero failures/cancellations. Nine supplier-CAD suites deferred for the empty distribution catalog.
- Focused integration suite: 64 passed. Following final checkpoint hashing hardening: 34 context/runner/checkpoint tests passed.
- Native profile/attachment suite: 7 passed, actual CAD solids and geometric measurements.
- Source syntax/import checks: 228 files passed. Type checking and production build passed; existing large-bundle warning remains.
- Independent review: important grammar conflict and datum decoder gap corrected; reviewer independently passed 29 tests. Guidance checkpoint-hash hardening also applied.
- Packaging tests: 13 passed; generated public source archive passed allowlist, hashes and known-risk scan. Static scanning is not a guarantee of universal absence of secrets.

Limitations: no new AI-generated airplane, connected native preview, car acceptance or physical qualification is established. Earlier airplane intake failure remains historical evidence from PR16 before upstream integration. Teammate's later planning-budget changes are outside pinned PR15 374e828 and require separate reconciliation. Do not claim a successful product from these source tests.


## DGX budget patch and unpowered-decoder follow-up

The teammate's released v12 snapshot included an unpublished 5,000-token planning allowance. Reviewed and imported only that change, its accounting test and context reserve into the isolated integration branch. Total limits remain 60,000 reserved output tokens, 64 calls, two planning attempts and 40 minutes. Host instructions were shortened to retain the existing 65,536 context guard; upstream skill text and source records remain unchanged. The planning retry test now expects the actual allowance.

Provenance: the teammate's `server/studio-staged-generation.mjs` SHA-256 was `0ec5e4a26e3eff3f2879e3674075b651f59c2ba7a07a2a9a1a34f729765ae72c`; `server/studio-generation-checkpoints.mjs` was `7f1442a8cf50b55e90d36d58f0667017a9e276ff23c64fc97ef653b317d05d3f`. This is a reviewed source snapshot, not a claim that their pending commit was published.

An actual Qwen 3.5 122B airplane-display run used the unchanged delegated-default brief. Project `b90febee-584e-4b9f-973f-c265e24ea0d3`, generation `ab66d6a7-2fe9-4476-8dd8-72d291a10ed2`: intake succeeded, then both planning attempts returned complete responses but failed because electrical profiles were present with no electrical connection plan. Runtime 136.08 seconds. NOT_ACCEPTED; no native CAD or preview. Forty-nine monitored shared source files were unchanged and all owned workers stopped. A preceding harness-only startup error required explicit empty answers/budget fields; no inference occurred during that startup and the request was unchanged.

A failing decoder regression reproduced this mismatch. The decoder now binds an unpowered plan to null part profiles and printed parts to null electrical profiles. The authoritative host still validates all fields and rejects contradictions; nothing is deleted or rewritten after generation. The model retains all product-design choices. A remaining pre-existing mismatch allows all-null profiles with an empty non-null circuit at decode time; host validation still rejects it. No complete decoder/host equivalence claim is made.

Verification after the decoder fix:
- Full clean, hash-matched source suite: 679 passed, 21 skipped, zero failures/cancellations. Supplier-CAD suites still require unavailable assets.
- Focused stages/runner/context/geometry: 58 passed on Windows and DGX Linux.
- Independent follow-up review: 29 stages/geometry tests passed, no introduced important regression found; residual mismatch documented above.
- Earlier source run in the shared-dependency worktree failed due to missing OpenSSL and browser startup timeout; the clean snapshot with required runtime tools passed. Shared dependencies were not modified.
- Second isolated 122B test of the decoder fix launched under the original cutoff; actual-model result remains pending until its receipt is recorded. Native CAD, visual quality and physical behavior are not established by source tests.


The second run, project `b6156e29-c798-4e1f-aca7-fd399aafd004`, stopped after 126.01 seconds with `geometryVersion:2 required`. Both planning replies ended normally, not by truncation. No native CAD/preview was produced; shared files remained unchanged. A second RED/GREEN regression now expresses the version dependency in decoder alternatives: profiles, datums and placement require V2, while legacy basic/source shapes remain supported. Host version checks remain authoritative.

After this correction: full clean source suite 680 passed / 21 skipped; focused 59 passed on Windows and Linux. Independent review passed 16 stage tests plus 14 additional legacy/V2 source and powered variants. A third real-model run was launched under the same original cutoff; its receipt is pending. The earlier unchanged native-kernel tests are not a generated-airplane result.


## Final result of this isolated testing round

Third run: project `21fada23-8ff2-45f6-b5cc-1ebb4c9492e3`, generation `4fbe5ef6-0d6e-4676-b814-1d5a3c6b799e`, 137.05 seconds. Planning and two part units passed their schema checks. Metadata then returned questions about aircraft type, length and style despite the original request delegating those defaults. The whole design is NOT_ACCEPTED. No native build or connected preview occurred.

Inspection of the saved, unaccepted units found five cylinders, all with position and rotation `[0,0,0]`. The narrative claimed lofted/extruded airplane features, while executable shape identities remained cylinders; there were no V2 datums or placement graph. This is not a recognizable airplane acceptance result. Passing unit schemas proves neither semantic design quality nor valid assembly.

All three runs used the same request and model digest. Workers stopped at each terminal result; 49 monitored shared files remained unchanged, and the owned test port closed. The shared coordination file contains the exact failure evidence and asks the upstream owner to correct shape/pose selection and delegated-choice handling. No hand-authored benchmark geometry, relaxed checks, shared deployment or teammate-source edits were used.

Scope conclusion: the new decoder constraints resolve the observed electrical/version contract holes; the original quality goal remains unmet. Physical fit/strength/printing and native/visual acceptance remain NOT_TESTED. A subsequent upstream change needs a new version-pinned test; these receipts must not be presented as a pass.

## Empty metadata orchestration follow-up

The third run requested inference for a closed metadata schema with no properties. Its only valid payload was `{}`, but the model spent 36,269.77 ms returning unnecessary preference questions. Read-only replay of the saved plan and units confirmed that the normal metadata validator accepts `{}`. This replay does not modify or accept the original failed generation.

The runner now validates and checkpoints that sole payload locally, retaining dependency hashes, cancellation handling, repair invalidation and final admission. It reserves no inference budget for this deterministic stage. Metadata with any requested fields still calls the model; required clarification remains supported. No geometry or product-design choices are supplied by this shortcut.

Regression evidence: before the fix, the new empty-stage test returned `questions` instead of `accepted`; after the fix, all 16 runner tests passed. A nonempty metadata regression verifies that essential questions still stop generation. Full clean source suite: 682 passed, 21 skipped, zero failures/cancellations. Independent static review found no important issue. Windows sandbox atomic-rename restrictions required running checkpoint tests with normal filesystem access.

PR15 remained at 374e828 with no new response at the follow-up check. No additional DGX inference, shared source edits or deployment occurred for this patch. The five overlapping cylinders and missing recognizable airplane remain an upstream design failure; this patch only removes an unnecessary orchestration call. Native/visual acceptance and physical qualification remain unproven.

## Planning field guidance and controlled test

The model-visible planning summary listed required field names without the actual identity object forms or optional geometryVersion/placement/datumIds. The decoder knew those shapes, but the failed generation put profileLoft/profileExtrusion in the provenance field while freezing cylinder identities. Added schema-derived identity forms, explicit optional fields and provenance/version semantics to the host planning adapter. This supplies execution grammar, not product-specific geometry or dimensions.

A RED context regression reproduced missing optional-field guidance; GREEN verifies all five authored shape forms, both source identity forms, provenance semantics and source snapshot immutability. Repeated host wording was compacted within the unchanged context guard; upstream skill sections and source facts remain covered. Full suite: 683 passed, 21 skipped; source checks: 228 passed. Independent context suite: 16 passed, no important findings.

User approved one fresh isolated test with a 40-minute hard cutoff. Run `coop3-identity-contract-20261013`, project `b7bd24f8-acd1-493a-a210-1a16883c64b5`, generation `1badb6d9-08b7-4057-87bb-97627be0c266`, exact Qwen 122B: 35.29 seconds total, 34.44 seconds inference. NOT_ACCEPTED at intake questions about aircraft type, scale and detail despite delegated defaults. Planning was never reached, so this does not establish whether the new planning contract improves geometry. No CAD or preview. All owned workers stopped and all 49 monitored shared files were unchanged.

To isolate the hypothesis, the final patch confines compact wording to planning. Read-only comparison using the prior frozen context and plan confirms intake, both part units, metadata and assembly messages are byte-identical to 1073436. Full suite remains 683 passed / 21 skipped. The failed receipt is preserved unchanged. No additional model call is authorized by those local checks; a further controlled run requires the separate requested approval. The airplane remains unresolved.


## Bounded planning-semantics follow-up

The user approved further isolated fix/retest cycles only until the unchanged 2026-10-13 10:34:09 UTC deadline. Product design and acceptance checks are unchanged.

- `coop3-identity-scoped-20261013`: NOT_ACCEPTED after 143.13 seconds. Both complete planning replies reused modeled part IDs as extra build-item IDs. No CAD; 49 monitored shared files unchanged, owned workers stopped.
- The host planning summary now explicitly defines `buildItemIds` as additional supplies, never modeled part IDs, and allows null when there are none. It also states that assembly text does not move geometry: planned poses must be final, except declared V2 attachment children. These are execution semantics, not aircraft-specific designs.
- `coop3-planning-semantics-20261013`, project `ebb5a83c-f77b-4005-8c5d-2484122cb8e3`: schema/admission ACCEPTED after one bounded disconnected-union repair; actual native job `7d19ca3b-0591-454a-a216-f6ea9c77ebcb` completed with failed verification. All five parts remain at the origin. Native overlap checks report 10 overlapping pairs, including 17,671.46 mm3 between the fuselage and nose. Each local solid and STEP round trip passed, but the assembly did not. The initial generation receipt predates the native job and therefore retains nativeCad/preview NOT_TESTED; native-job.json and the subsequent preview receipt are separate evidence.
- Actual native STL bytes were copied and hash-verified, then loaded with the production StudioViewportController locally: 5/5 meshes loaded, zero page errors, zero explode. Visual inspection shows a vertical stack of cylinders through crossed rectangular bars, not an acceptable airplane. Design hash `8b465f279083ffbfa326446525d1de21d913476f9f8e406afc26be1533c57ec5`. No geometry edits or decorative substitute render. Evidence remains in local output/planning-semantics-20261013 and the matching DGX test directory.
- `coop3-assembly-semantics-20261013`: NOT_ACCEPTED, 181.26 seconds inference. The clearer pose wording still resulted in zero positions. Metadata then attempted a shaftHole request against nonexistent fuselage holes[0]; the host correctly rejected both attempts. No native build for this run. All owned workers stopped; shared files unchanged.

Local verification of the planning-only wording delta: RED context checks reproduced missing semantics; GREEN 16 context tests, full clean source 683 passed / 21 skipped, source checks 228 passed. Independent review passed 16 context tests and confirmed all seven non-planning message types byte-identical to e11e484. No important findings. This demonstrates preserved code behavior, not successful generative design.

A separate, unpublished experiment enables thinking only for planning, retaining temperature, all request data, schemas, 5,000-token planning allowance, timeouts and admission. Its checkpoint identity records the per-stage thinking policy. Archive SHA-256 `3a1d730ba1d68f5715f9884fadc69f2a2d04ef90d3a53ea7149a4d00c73b992c`; directory `coop3-planning-think-experiment-20261013`. It is not a production default or part of the PR runtime change. Its result must be appended before drawing a conclusion. Physical qualification remains NOT_TESTED throughout.


### Final reasoning experiment and decoder control

The isolated planning-only thinking experiment finished: project `03553ee6-16b2-4cae-9d60-f6f2500c94f1`, 253.99 seconds observed generation time, native job `3388ff0e-3a60-4b38-a096-1e25d321f484`. Schema admission ACCEPTED and native execution completed, but native verification FAILED. The model selected V2 lofts/extrusions yet kept all eight poses at zero with no attachment frames. All 28 part pairs overlap. Design hash `c77692218709e89f144169c3cf1140dc007ccd1fe1e1b985b2ffd6cef846337b`. The production viewport loaded all eight exact hash-verified STL meshes with zero page errors and zero explode; visual inspection rejects the result as an airplane. Thinking alone did not establish acceptable design quality and remains unpublished experimental code.

A separate bounded non-design coordinate probe requested exactly position [12,-34,56] and rotation [90,0,-25]. Both constrained and unconstrained outputs returned those exact arrays, normal stop, 30 tokens each. This rules out a basic inability to emit signed/nonzero coordinate values; it does not certify the full planning decoder or identify a unique cause of the design failure. Evidence: tests/coop3-coordinate-probe-20261013 on DGX and local output/coordinate-probe-20261013.

All experiment workers stopped, and the 49 monitored shared files were unchanged. No production deployment, source replacement, model update, benchmark geometry patch or relaxed check occurred. Remaining work belongs to generic design/layout integration: coherent frames and dimensions must be chosen before poses become immutable, and failed layout must not be reported as successful merely because schema admission and CAD execution completed. A reviewed layout-stage or plan-revision change needs its own implementation and actual model acceptance test; repeated prompt changes have not solved it. The original deadline remains unchanged; no further unattended work is authorized by this report.


## Correction: the isolated harness bypassed native repair

A subsequent source audit found that the private supervisor invoked benchmark-staged-generation without `--mode`, which defaults to `design`, and separately POSTed `/api/studio/build`. Design mode deliberately returns before the application's native verification and bounded repair loop. The separate build does not invoke that loop. The earlier failed meshes and measurements remain genuine, but they characterize initial generated geometry, not failure of the full automatic repair workflow. The architectural recommendation above is therefore premature; test the existing path before proposing a new layout stage.

The existing auto workflow already builds, collects deterministic failures, requests at most one model-authored geometry patch against the same requirements, and rebuilds. Its patch grammar permits poses while protecting purchased geometry, source identities and requirements. We have not yet shown whether Qwen 122B can successfully use that path for this airplane.

The benchmark receipt now records the actual workflow mode, retained native attempts and revision-bound native verification. Initial staged inference calls are explicitly labelled as such, not total workflow inference. Timing comparison rejects different or missing modes. CAD artifact availability remains separate from verification, preview and physical qualification. A new private supervisor explicitly selects `--mode=auto`, reads the application's own jobs and preserves every native attempt; it contains no separate build call. The old supervisor and all original receipts remain unchanged. Auto and design use different application paths; the next run is not a like-for-like timing comparison with the earlier runs.

Validation: three new regressions failed before the change, then the focused benchmark, patch and repair-execution suites passed 28 tests. Independent review found missing binding of the verification report's own revisionHash; a regression reproduced it and the report is now withheld when that hash is missing or stale. The full source suite result is recorded below. These are local orchestration/transport tests with synthetic inference and worker outputs, not native geometry or generated-airplane acceptance.

The old DGX cutoff expired at 2026-10-13 10:34:09 UTC. No new model run or shared service change was made for this correction. A new explicit test window and a free, coordinated isolated slot are required for the actual-model test. Generated-airplane quality and physical qualification remain unproven.

Final local source verification after the review fix: 686 passed, 21 skipped, 707 total, zero failures/cancellations. Log: .setup/auto-benchmark-final.log (private evidence).
