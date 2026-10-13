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
