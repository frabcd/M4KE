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


## Corrected automatic workflow test — 2026-10-13 11:04 UTC

The user explicitly approved one fresh isolated 122B airplane test for at most 40 minutes after the teammate released their slot. Maintainer release was recorded at 11:00:23 UTC; read-only checks confirmed ports 4182/4183 closed and no running production projects. The fresh run started at 11:04:43 UTC, with fixed cutoff 11:44:43 UTC. It used PR16 e7e2f35387f1ca5d3272024c54fb600e3e7a510e, archive SHA256 1eb6db4d7e0b10fff6640928357bda6c9c880111f9ca955bdd0fcf4efc682fe1, the unchanged original display-only brief/input hash and exact Qwen122B digest. New teammate fixes were read but not silently substituted into this frozen snapshot.

Actual project c3214cce-befd-43ae-8e85-c97001d538ee confirmed workflow mode `auto`. It stopped after 301.49 seconds with NOT_ACCEPTED: both assembly-0 responses failed `immutable assembly references`, despite normal output stops (1,575 and 1,346 output tokens). The generation checkpoint is exhausted. There is no CAD job or native workflow attempt; automatic native repair, preview and physical qualification remain NOT_TESTED. Distinct wing poses appeared in the initial plan, but unaccepted source positions are not assembly success. The current diagnostic does not identify which specific step/reference changed; no unique cause beyond reference-fidelity failure is asserted.

The supervisor stopped at terminal result, five minutes into the allowed window. Both owned worker PIDs are gone, port4182 closed, and all49 monitored shared files are unchanged. Evidence is preserved in DGX tests/coop3-auto-airplane-20261013-1105 and local output/auto-airplane-20261013-1105 with file hashes. The teammate received the failure and slot release through texting.txt. No second run, shared deployment, handcrafted geometry or relaxed check followed. Next: diagnose assembly reference preservation (including the teammate's latest related diagnostics) before another approved actual-model run; this test still cannot establish whether native repair fixes the airplane.


## Assembly-reference decoder correction and upstream integration

Read Maintainer's published PR15 head 5c41472d9e9fc6941b941694dbb5241d93fa1c3f and shared coordination updates before editing. Their terminal vocabulary, immutable connection decoder and combined planning-roster diagnostics are integrated in this isolated branch. Merge resolution retains PR16's optional V2 fields, profile/attachment grammar, compact context and corrected benchmark receipts. No teammate branch or shared runtime was edited.

The assembly detail decoder still used the unrestricted generic assembly schema even though host validation required exact planned partIds/requires. A new RED regression confirmed changed step IDs/references were decoder-valid and host-invalid. The decoder now provides one alternative per assigned step with fixed ID and singleton enums containing the exact planned reference arrays. Instructions, labels and checks remain model-authored; no geometry is manufactured or moved. Host uniqueness, roster, immutable-reference and final admission checks remain intact. Regression coverage includes empty prerequisites, array order, additions/removals, references to another known part, split-unit boundaries, reordered records, editable prose and duplicate rejection. The exact changed field from the failed live response was not retained, so this establishes and closes a decoder/host mismatch; it does not prove a unique cause or future model success.

Local validation after integration: 37 focused stage/context tests pass; full clean source suite 691 passed, 21 skipped, 712 total; 228 syntax/import/boundary checks pass. Supplier-CAD suites requiring missing assets remain deferred. Reviewed source package validates its allowlist, hashes and known-risk scan (359 files, SHA256 1eb6f7820e889ce217ff61282afa83cc6b5411e577bf5b820e4f2d84f68e4ddd); this is not a guarantee that all secrets or bugs are absent. No new DGX inference was launched. Original airplane acceptance and physical qualification remain unproven.

Independent read-only review reran all37 stage/context tests and found no important issue; it confirmed upstream constraints and unchanged host gates. Typecheck and production build passed. Vite retained its existing large DrivingSandbox chunk warning; no native or model success is inferred.

## Actual automatic airplane test after assembly fix — 2026-10-13 11:29 UTC

The user approved one new isolated run for up to 40 minutes once the teammate released their slot. Shared coordination still reported the maintainer released; launch checks found the isolated slots free and shared projects idle. Source ae6d907f6ca8d43417a43756d618bc9e56d5f148 includes upstream PR15 5c41472. The 369-file source archive was individually hash-verified, SHA256 272b4f9e5e452ee6c39e8796d3f67c9cdf3a9e30a0d04b6b73c62f62024b6bf2. Run started 11:29:34 UTC with fixed cutoff 12:09:34 UTC. Original display-only brief, input hash and exact Qwen3.5:122b-a10b digest were preserved. Workflow mode was explicitly auto.

Project d994c718-f399-4370-9454-993a03de0705, workflow 79469f8c-0bd3-454a-9eae-d2d34bd047b8, generation 2254e2d6-7565-4225-9260-34af8c181911: initial schema admission ACCEPTED; native build, actual model-authored geometry repair and native rebuild executed. Total workflow receipt elapsed 358.67 seconds. Unlike earlier design-mode tests, this exercises the existing automatic repair loop. The assembly-reference fix passed this run; future model success is not guaranteed.

- Initial job 1a14f3a1-ef47-41e5-b998-8892a4687f00: verification FAILED, 15 overlapping part pairs; design hash 33d00e7ec5f5b22523c10fe944e54367b0c08ce970ab38213c50eb0d75e24be4.
- Final job 5a52b824-e156-4f70-8b4c-bac0cfc63e5b: verification FAILED after the bounded repair, with 2 remaining pairs. Fuselage/canopy intersection is 1305.2282741663055 mm3; vertical/horizontal tail intersection is 86.21649244769037 mm3. Declared assembly rule prohibits intersections greater than 1e-5 mm3. Final design hash 9d29244cd69c8387db84b739ef56d29ccbc888714d159a7f7d9b79e6a5928dc9.
- Diagnostic correction: all six individual solids are valid, positive-volume, single solids. The additional cad-solids failure is an aggregate flag caused by cad.errors containing assembly:overlaps, not an independent solid-count failure. The global verifier currently treats any CAD error as explicitFailure; its label is misleading here. This does not remove either measured assembly failure.
- Actual final native STL bytes were hash-verified and loaded locally through production StudioViewportController: 6/6 loaded, zero page errors, zero explode. Visual inspection FAILED: elongated parts remain upright and separated rather than forming a coherent airplane. The saved rotations of the fuselage, wings and horizontal tail include 1.5707963267948966, while the explicit contract and native transforms use degrees. These values are consistent with a radians/degrees confusion, but intent is unproven; no automatic reinterpretation or geometry edits were made.

Final status is NOT BUILD-READY. The workflow retained both failed attempts and stopped; no pass was manufactured from schema admission, artifacts or a working renderer. Physical qualification remains NOT_TESTED. Evidence: DGX tests/coop3-assembly-airplane-20261013-1130 and matching local output directory, including native-job.json, both native-attempt receipts, final-job CAD/provenance/verification, preview-inspection.json and native-preview.png. The inspection skill's source/hash, measured geometry and zero-explode requirements were applied; this local rendering is diagnostic evidence, not a separate manufacturing release.

Supervisor stopped at terminal result at 11:35:36 UTC. Owned app and collector stopped, port4182 closed, all 49 monitored shared files unchanged. Production, teammate source and Ollama were preserved. No second inference run followed this single-run approval. Next work: upstream design owner should inspect the saved degree-based poses and unresolved intersections; execution owner should separate aggregate assembly errors from the individual-solid diagnostic. Preserve native gates and retained failed evidence.

## Repair context correction and comparison preparation

Saved-output tracing located zero poses in the initial plan, which the detail decoder correctly freezes under the current protocol. Assembly prose subsequently proposes different transforms but cannot execute them. The model repair is allowed to change geometry and poses; its raw JSON contains 1.5707963267948966 while its prose says 90 degrees. The repair call used only runtime-repair.md, which lacked explicit degree units and the full profile/frame conventions supplied to initial design. This identifies a concrete context omission, not proof that a prompt correction alone will produce a coherent airplane. Rotation-axis reasoning and premature pose freezing remain unresolved.

The unchanged initial-design geometry conventions now come from a fresh shared factory and are also supplied to repair, with an explicit host system instruction requiring degrees and the existing V2 extension. No upstream skill file, product geometry, schema acceptance rule, source identity or immutable requirement was changed. The aggregate cad-solids ID and FAIL predicate remain intact, but its label now says CAD kernel result and its observed evidence includes worker errors; valid individual solids remain separately reported. This avoids sending the model a misleading bad-solid diagnosis for an assembly overlap.

Two RED regressions reproduced missing repair conventions and the misleading aggregate label. GREEN: 49 focused tests; full hash-checked clean source suite 692 passed, 21 skipped, 713 total; syntax/import/boundary checks 228 passed; typecheck/build passed with the existing large DrivingSandbox chunk warning. Independent read-only review found no important issues and reran 27 contract/repair tests; its six HTTP fixture tests were blocked by sandbox loopback permissions. The primary run executed those successfully with normal loopback access. Source package allowlist/hash/known-risk scan passed for 359 files, SHA256 0a288b44f1b91e419c6b4f73059609f0f28e22749289fdc7c855187d29c5b803. Supplier-CAD suites remain deferred; no bug-free or complete secret-scan guarantee is implied.

Offline comparison inputs are prepared privately in .setup/airplane-comparison-prepared with exact request/schema/context hashes and model digest. No inference was run. Compare (A) minimal direct CAD-contract generation, (B) full design guidance in one response and (C) staged generation. A/B share byte-identical task/source data and schema; C must use the same frozen sources and original brief. All use the same model, temperature, context and thinking setting. Record token allocations, truncations, retries and total elapsed time; the paths have different token allocation and are not equal-compute causal experiments. A is constrained CAD generation, not unrestricted code generation.

Inspect each initial output with the same host/native gates and hash-verified zero-explode views before any common repair allowance. Preserve all failures, render failures and unanswered questions; do not cherry-pick retries, repair by hand or use a visual-only baseline as engineering proof. Check recognizable silhouette, world-axis consistency, bilateral geometry, connected assembly, overlaps and declared dimensions independently. Reuse one approved owner-guarded slot sequentially only after a new explicit time window and teammate release. No runner has been launched. This is the next experiment before changing the placement-lock architecture; successful airplane generation remains unproven.


## Actual three-path comparison — 2026-10-13 12:16 UTC

The user's latest approval superseded local-only preparation and authorized one sequential comparison window of at most 40 minutes after teammate release. Source commit 67f1826225d663fbe8eed91100bef79cd31fe022 was frozen. Start 12:16:49 UTC, fixed deadline 12:56:49 UTC; terminal cleanup completed 12:28:21 UTC. Model qwen3.5:122b-a10b digest 8b9d11d807c57feb1e2ecb0d6cbf40334c37dcc3523bed5540af4f927f112a37. Source archive SHA256 5fed731d7339e49b20dc6b750138ca3fd257225138068096ca360c51e11c7c1c.

All three initial outputs were collected before repairs. Direct-contract and guided-single shared byte-identical task/source data and schema; only system guidance differed. Staged mode was explicitly design, followed by the same native build gate. This is an initial-output experiment followed by a common host repair path, not another test of the automatic workflow. Each admissible native failure received at most one model repair and rebuild. The rejected direct spec had no admissible previousSpec and could not enter native repair. No manual geometry changes or relaxed checks were used.

| Path | Initial generation | Initial result | After one native repair |
| --- | ---: | --- | --- |
| Minimal direct CAD contract | 145.006 s | Rejected: first loft sections include z=-600 and +600, outside the bounded contract | Not eligible; no native model |
| Full guidance, single response | 182.903 s | 11 valid individual solids; 9 overlapping pairs | 9 overlapping pairs; FAILED |
| Staged generation | 225.989 s | 6 valid individual solids; 15 overlapping pairs | 4 overlapping pairs; FAILED |

Times cover initial generation, not native builds or repairs. Direct includes 13.312 s model loading; guided load was 0.002 s. Staged initial generation used six inference calls. Context, temperature and thinking settings were common, but token allocation and prompt volume differed. This is one sample per path, not equal-compute causal evidence or a general ranking of Qwen versus the skill. The direct baseline is constrained by our CAD schema, not unrestricted native CAD code generation.

Actual guided and staged initial/repaired STL files were SHA256-verified and rendered locally using production StudioViewportController. All 11/11 or 6/6 meshes loaded with zero page errors and zero explode. Perspective and top views were inspected: both paths remain primitive upright assemblies with misplaced or disconnected components, not acceptable coherent airplanes. This is diagnostic preview evidence, not manufacturing release. Direct has no renderable admitted model. Physical qualification remains NOT_TESTED.

Guided repair changed positions but no shapes or rotations; overlap count remained nine. Staged repair also changed only positions; all six rotations remain zero. Remaining staged intersections: fuselage_main/wings_main 1004.8510093494873 mm3, fuselage_main/tail_assembly 2266.5305427393037 mm3, fuselage_main/landing_gear_bay 2679.6026915986326 mm3 and wings_main/tail_assembly 180 mm3. The explicit degree-context correction did not suffice for visual or geometric acceptance. These model outputs do not demonstrate a radians/degree conversion defect in the renderer. Premature pose locking remains a concrete staged limitation, but the independent single-response failure means it cannot explain every failure.

Next investigation for the design/orchestration owner: compare model-authored local-axis choices, plan poses frozen before detailed geometry, and assembly prose that cannot revise those poses. Execution owner should support any approved protocol change without inventing airplane coordinates, altering declared requirements or excusing intersections. No successful-generation claim or production deployment follows this comparison.

Machine-readable measured results, job/revision hashes and preview receipts: 2026-10-13-airplane-comparison.json. Private full evidence: tests/coop3-airplane-comparison-20261013-1217 on DGX and matching local output folder. Evidence archive SHA256 0503f1514d31f0b890abac9ef9a2badcf54c4efa08cd867d4b2e4505a88959f0. All 49 monitored shared files unchanged; owned supervisor/app/collector PIDs absent and port4182 closed. The supervisor released the slot in shared texting.txt. No extra inference run was launched after completion.

Skill application: inspect-3d guided exact saved-artifact/hash inspection, measured overlap attribution and zero-explode visual review; verification-before-completion keeps successful transport/rendering separate from failed model acceptance. This evidence-only update changes no runtime source; prior source tests above apply to the frozen code, not to successful generated geometry.
