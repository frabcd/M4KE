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
