# Geometry contract integration implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; final fresh-context review only.

**Goal:** Execute design-owned fixed attachments and richer bounded forms with native checks and faithful previews.
**Architecture:** Optional geometryVersion:2 on the existing inert document; named local datums and an acyclic placement contract resolve after geometry units. Existing version-1 bytes and hashes remain unchanged. Native worker independently validates resolved frames and requested contact, and exports one local mesh per part for the current viewport.
**Tech Stack:** JavaScript, CadQuery 2.8/OCC, Three.js r180, Vue/TypeScript.
**Contract and scope:** [geometry-contract-v2.md](../../geometry-contract-v2.md). The earlier local feasibility proof is not an AI-generation acceptance result.

## Global constraints
- Designer owns dimensions, hardware, topology, form and datum definitions; host invents none.
- Preserve historical source identities, requirements, cancellation/checkpoints, pricing and verification gates.
- New geometry requires geometryVersion:2. Profile extrusion: simple implicit-closed XY polygon, 3..32 vertices in [-250,250] mm, height 0.5..500 along +Z. Loft: 2..8 parallel XY sections with same vertex count/winding, strictly increasing z in [-250,250], ruled interpolation, one valid solid. No arbitrary code or imported-asset editing.
- Datum frames use existing XYZ Euler degrees; roots explicit, children have one parent, no cycles or implicit roots. Frame offsets are designer-supplied. Optional face/bounds guessing is not implemented.
- A declared contact needs actual native distance/intersection measurements; frame-only relationships retain an explicit reason and do not imply physical contact.
- Do not deploy, start DGX inference, merge, or edit upstream design skill as part of this source integration.

## Review focus
- V1 normalization/hash regression and downgrade of failed V2 checks.
- Cycles, duplicated/missing datums, mixed rotations and idempotent resolution.
- Invalid/degenerate/oversized profiles and loft winding mismatch before native execution.
- Snapshot completeness and native schema independence, including direct worker calls with false child poses.
- Stale native preview identities and repair weakening of relationship requirements.

## Tasks
1. Contract and placement: tests/studio-parametric.test.mjs RED then implement shared geometry helpers, server contract/schema, staged plan/unit assembly and repair preservation. Keep generated unit poses frozen as planning placeholders; resolve final declared attachments after all units. Test source purity, hashes, graph negatives and dimensions/datums propagating.
2. Native forms and checks: tests/cad_parametric_test.py RED then implement cad/parametric_geometry.py, worker hooks and snapshot inclusion. Test analytic volumes, real contact/gap/penetration, mixed transforms, precise native bounds and STEP export. Independently reject false resolved poses.
3. Preview and host capability: extend TS types and preview behavior; richer shapes require native output, never silently fall through to cylinder. Advertise exact supported contract to staged generator without changing design ownership. Test stage carry-through and repair/caching behavior.
4. Verification and handoff: focused tests, native worker integration, source suite/build, code review. Save exact results and remaining real-model/browser limits; leave integration isolated and reviewable.

## Rulings and progress
- Approved by user: “so continue” after explicit integration + fresh-test next step. Local source integration is authorized; expired DGX reservations are not extended.
- Ruling: fixed-frame attachments first; standalone axis solver and mirrored asymmetric solids deferred. These were not proven by the spike; deterministic full frames handle supplied axis directions without underconstrained solving.
- Ruling: datums have design-authored numeric local frames. Changing a shape alone does not invent updated interfaces; an upstream edit must update its datum too. Descendant world poses then recompute automatically.
- Skills: conductor routing; inspect-3d measured actual native solids and unverified domains; TDD red/green; executing-plans inline with final fresh review. Prior read-only specialist comparison reused.
- Baseline: b103614, clean worktree. GitHub main texting and PR14 read; no new PR14 feedback. No live DGX inspection claimed.
- Tasks 1–3: implemented. Host contract/repair/staged integration and native solids/exports tested; richer concept previews reject substitution. Source snapshot includes the independent native validator.
- Task 4: reviewed and verified locally. See [verification report](../../verification/2026-10-12-geometry-contract-v2.md). Browser loading timed out in the worktree setup; unchanged baseline and the same modified source passed in a clean hash-checked copy. Shared dependencies were not removed.
- Final review fix: composed near-singular XYZ frames lost orientation. Both host reproductions failed before the fix; host and independent native regressions now pass. Standalone server startup dependency and V1 repair-schema regressions were also corrected.
- Deferred review minors: profile dimensions are blank in the Inspector formatter; the verification panel's generic grammar-limitation sentence still lists only the old shapes. No geometry acceptance was inferred from either display.
- Ruling: preserve a separate draft contribution stacked on PR14; do not expand PR14, merge or deploy. The tradeoff is another dependent PR before production rollout.
- Unverified: actual upstream-model use, fresh airplane generation, new-profile browser visual review, physical fit/strength/printing, and unavailable supplier-CAD catalog suites. No success claim for those domains.

## 2026-10-13 upstream integration
- User approved continuing after checking teammate work. Reuse existing isolated worktree on new branch codex/geometry-quality-integration; preserve both published PR branches. Merge exact PR15 374e828 into PR16 e30a403 locally, no production deployment or GPU claim.
- Reproduced integration defects: proposal builder made optional v2 fields mandatory; source/context fixture overflow; host pose guidance contradicted attachment placeholders. Added proposal/guide regressions and preserved upstream source/profile binding, measured progress, retries and immutable intake reconstruction.
- Fixed required-field lists by inheriting explicit parent requirements; compacted only host-authored capability explanations. Source facts, upstream skill text and prompt budget unchanged. Focused62PASS with normal Windows filesystem permissions (sandbox rename failures recorded separately).
- Skills: conductor; executing-plans inline; using-git-worktrees confirmed existing isolation; inspect-3d retains actual-native/preview evidence boundary; TDD watched failing compatibility regressions before fix.
- Next: full source/build/native regressions and final independent review, then publish reviewable integration and coordinate actual-model retest. This is not end-to-end acceptance.

- Integration final review: fixed system-level legacy grammar contradiction and datum decoder omissions with failing/passing regressions. Fixed host-only capability text never promotes task data to instructions. Added guidance source to checkpoint identity. Full677PASS/21SKIP; native7PASS; focused64PASS; after hash hardening34PASS; syntax228/buildPASS. Actual model test remains pending free coordinated GPU. See verification/2026-10-13-geometry-quality-integration.md.


## 2026-10-13 actual-model follow-up
- User requested latest teammate fix and isolated testing. Their published PR15 remained 374e828; reviewed the released DGX v12 budget patch by source hashes and integrated only planning allowance/accounting changes.
- Ruling: retain the original coordinated 09:52:39 UTC cutoff across the harness correction and decoder retest. No extension, shared app changes or competing inference.
- Combined 122B airplane intake now passes, but planning stopped on profiles with no circuit after136.08s. NOT_ACCEPTED; 49 shared files unchanged and own workers stopped.
- RED: decoder admitted orphan profiles in a plan with electrical:null. GREEN: unpowered schema requires null profiles; printed schema excludes electrical profiles. Existing host rejection and product-design ownership preserved. Focused58PASS Windows/Linux, clean full679PASS/21SKIP; independent29PASS. Residual all-null/empty non-null circuit remains host-rejected and is documented, not normalized away.
- Second fresh model test uses another isolated source snapshot, unchanged request and original deadline. Save its actual receipt before claiming any further stage success.

- Second model run ended126.01s at the existing version gate, with no orphan electrical-profile diagnostic. RED/GREEN added decoder version coupling for profiles/datums/placement and preserved legacy plans. Full680PASS/21SKIP, focused59PASS Windows/Linux; independent16tests+14variants. Third run is isolated with unchanged request and original deadline. No real model acceptance yet.

- Third test ended137.05s NOT_ACCEPTED at late metadata questions. Saved units: five cylinders, all at origin, contradict claimed profile form. No native/preview.49 shared files unchanged, owned workers stopped/port closed. Upstream design/clarification handoff appended to shared texting.txt with exact receipts. Do not manufacture geometry or call schema passes product success.


## 2026-10-13 model-visible planning contract
- User requested fixing the remaining failure and explicitly approved one new isolated 122B test with a hard cutoff 40 minutes after launch, contingent on teammate GPU release.
- Debugging evidence: decoder knows identity alternatives, but model-visible planning summary showed only required field names and vague identity prose. Optional geometryVersion/placement/datumIds were absent from that summary. Saved generation put profileLoft/profileExtrusion into provenance source while freezing cylinder identities and zero poses. This is a concrete representation-guidance gap; causal influence on model quality remains a live-test hypothesis.
- RED/GREEN regression verifies legal model-visible identity forms, provenance distinction and optional versioned fields. Guidance uses schema-derived alternatives and never selects geometry or hardware. Repeated host wording compacted; original source records/upstream sections and context bound remain covered. Full683PASS/21SKIP; independent context16PASS, no important findings; inspect-3d acceptance principle remains actual geometry rather than descriptions.
- Fresh owner-registered test tests/coop3-identity-contract-20261013 uses unchanged original display brief and exact122B, isolated4182. Started09:54:09UTC, hard cutoff10:34:09UTC (18:34 Singapore). Hash b122cbe25ab08bc0c877bfb77f6305c570b18f0dee54c4a32488d410e81f6dd1. Native build occurs only after existing admission; shared source monitored; supervisor stops only owned children.
- Next: inspect actual model, native and visual evidence. This remains a test hypothesis, not an airplane acceptance claim. No teammate work or production changes.

- 2026-10-13 bounded follow-up: user authorized cycles only until unchanged18:34Singapore cutoff. Field-semantics clarification tested; native CAD now reached but failed overlap and visual acceptance. Applied inspect-3d principle using exact hash-verified native STL and production viewport (5/5 loaded), not narrative. Systematic-debugging architectural review: immutable weak planning propagates into parts/metadata and cannot be repaired by assembly prose. Separate per-stage thinking experiment is isolated/unpublished; no product design edits or relaxed checks. Source683PASS21SKIP; independent16contextPASS/nonplan byte equality. Next: collect experiment outcome, preserve diagnostics, stop own workers at deadline and hand upstream concrete planning findings.


## 2026-10-13 test-path correction
- Earliest unfinished step is verification of the existing automatic native repair path. The private test used design mode plus a separate build, bypassing runWorkflow's native-check/patch/rebuild loop. Preserve failed initial geometry evidence; defer new layout architecture until the existing path is exercised.
- Applied conductor routing, systematic-debugging source tracing, TDD for benchmark receipt/mode regressions, and inspect-3d's distinction between artifact availability and revision-bound verification. Independent review added verification.revisionHash binding.
- Local private supervisor prepared for explicit auto mode; no separate build, no launch, original receipts preserved. User's previous 18:34 Singapore cutoff remains expired. Next live test requires a new approved window and teammate slot release.


## Assembly-reference follow-up
- User continued after the auto run failed. Systematic-debugging traced mismatch between unrestricted assembly decoder and exact-reference host gate; TDD reproduced it before the fix. Reused existing wire/part decoder patterns.
- Integrate reviewed upstream PR15 5c41472 in our isolated branch, retaining V2 and benchmark fixes. Pin each assembly step's references in its decoder; preserve host rules and upstream product-design ownership. No benchmark geometry or source modifications.
- inspect-3d evidence boundary retained: local source/decoder tests are not native or visual success. Full691PASS21SKIP, syntax228PASS; independent review and build recorded in verification report. Next actual-model run needs separate time approval; previous one-run authorization was consumed.

## Repair execution-context follow-up
- User continued after rejecting the actual failed airplane. No new teammate response or PR15 change as of this local correction; shared TXT was read first. Existing isolated branch only.
- Systematic-debugging traced missing degree/profile context in repair and misleading aggregate CAD error. TDD reproduced both; shared host conventions now reach repair, and aggregate errors are named without changing acceptance predicates or individual-solid evidence. Upstream skill files and product design untouched.
- Verification: focused49PASS, full692PASS21SKIP, syntax228PASS, typed buildPASS with existing chunk warning. Independent review no important issues; reviewer27PASS and loopback limitation documented. inspect-3d keeps actual geometry and physical claims separate.
- Prepared offline direct-contract / guided-single / staged comparison with pinned request, source context, schema and model. Single previous run consumed; no model calls or new GPU reservation made. Earliest unfinished stage is controlled comparison and placement-lock architecture assessment, not another prompt-only success claim. Detailed protocol and limitations in the verification report.
