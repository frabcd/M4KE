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
