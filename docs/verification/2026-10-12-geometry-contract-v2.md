# Geometry contract v2 — local verification

Scope: opt-in fixed-frame attachments, bounded profile extrusion/ruled loft,
independent native admission and contact measurements, frozen job dependencies,
and native-only profile preview handling. This report covers execution code and
synthetic regressions, not the quality of an AI-generated product.

## Results

| Check | Observed result |
|---|---|
| Source syntax/import/path/browser-boundary checks | 228 files passed |
| Source regression suite | 656 passed, 21 skipped, zero failures/cancellations |
| Existing native CAD worker, with `--kernel` | 44 passed |
| New native geometry contract suite | 7 passed |
| Additional native test discovery | 66 run: 48 passed, 18 kernel-flag skips; the separate 44-test run includes the kernel tests |
| Vue/TypeScript + Vite production build | Passed; existing large-bundle warning remains |
| Fresh independent code review | One important rotation finding fixed with failing-then-passing host and native regressions; two display/documentation minors deferred |

The final source suite ran on a clean source snapshot over baseline `b103614`.
All 21 changed source/test/document files at snapshot creation were SHA-256 matched
against the working copy before execution. Subsequent changes were documentation
only. Runtime dependency versions were unchanged. The original worktree browser
test stalled at page load; both the unchanged baseline and the updated preview
source passed in clean copies. No teammate dependency directory was deleted or
modified to resolve that test environment issue.

Environment: Windows, Node 24.19.0, Python 3.12, CadQuery 2.8.0,
Open CASCADE binding 7.9.3.1.1. The DGX was not accessed or deployed to.

Commands, from the repository root with the local runtimes available:

```text
node scripts/check-source.mjs
node scripts/test-source.mjs
python tests/cad_worker_test.py --kernel
python tests/cad_parametric_test.py
python -m unittest discover -s tests -p "cad_*_test.py"
npm run build
```

## Evidence covered

- Existing documents keep their version-1 normalization and repair options.
- Final poses resolve after staged geometry, remain idempotent, and change when
  an upstream edit updates the relevant local datum.
- Missing/duplicate datums, cycles, ambiguous parents, unknown requirements,
  unbound parts and illegal profiles are rejected.
- Real native contact passes for the contact fixture; a 17.5 mm gap and positive
  penetration fail. Contradictory supplied child poses fail native admission.
- Three-part mixed rotations, off-center datums, and composed orientations near
  both ±90° pass independent JavaScript/native transform checks. The original
  near-singularity conversion failed these tests before correction.
- Extrusion and loft volumes match analytic fixtures. Actual STEP exports retain
  assembly volume and local bounds; loft STL readback has positive signed volume
  and closed welded topology within the existing gates.
- Automatic repair cannot remove or weaken original attachment criteria.
- Frozen jobs include the version-2 native helper and its hash; a missing helper
  fails snapshot creation.
- New forms require native preview artifacts; the concept path does not silently
  substitute a box or cylinder. Existing browser project switching passes.

## Limits and remaining acceptance

The checkout's supplier catalog is empty. Nine catalog-dependent suites are
explicitly deferred, not passed. The 21 source-test skips also remain skips.
No live supplier, physical, printer, strength or electrical-function acceptance
is established by these results.

The producer must explicitly emit `geometryVersion: 2` and design-owned datum
relationships. An unchanged producer may still emit a legacy design. Fresh model
generation and visual review of the new profile artifacts in the connected app
remain unverified. A new airplane acceptance test must use the actual upstream
design skill and these native/preview checks; regression fixtures cannot replace it.

Two minor review items remain: Inspector dimensions formatting does not yet label
the new profiles, and the verification panel's generic grammar-limitation sentence
still enumerates the old forms. Exact native geometry and blocking checks do not
depend on those text fields.

The first version deliberately uses explicit fixed frames rather than axis-only
constraints, moving joints or mirrored asymmetric solids. Datum positions are
designer-authored, so a shape edit must also update affected interfaces. These
choices keep execution deterministic but leave those other operations unsupported.
