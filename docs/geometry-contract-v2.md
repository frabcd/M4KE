# Native geometry contract v2

This is an opt-in execution contract, not a product-design system. The designated
design skill supplies every dimension, profile, interface datum and relationship.
The host validates that data, resolves declared fixed frames, builds native solids
and measures the requested contact. It does not infer the missing engineering.

## Adoption and compatibility

Set `geometryVersion: 2` alongside the existing `schemaVersion: 1`. Historical
documents without the extension keep their original normalization and hashes.
New profile shapes, datums and placement require the explicit version. Merely
supporting v2 does not prove that a model will choose or use it correctly.

The runtime context advertises the supported fields in
`geometryConventions.geometryV2`. The staged planner declares `datumIds` per part
and the complete placement graph. Each part stage supplies those named datum
coordinates with its geometry. Final assembly resolves the world poses after all
geometry units are validated. Changing the validator invalidates saved generation
checkpoints rather than reusing incompatible intermediate results.

## Bounded forms

Printed parts additionally support:

- `profileExtrusion`: `points` is a simple implicitly closed XY polygon of 3–32
  vertices, each coordinate in −250…250 mm. `height` is 0.5…500 mm along +Z,
  beginning at local Z=0. The extrusion is not centered.
- `profileLoft`: `sections` contains 2–8 `{z, points}` records. Z is −250…250 mm
  and increases by at least 0.5 mm per section. Profiles have equal vertex counts
  and matching winding; they are connected by a ruled loft. The native kernel
  must still produce exactly one valid positive-volume solid.

Nonzero profile fillets are unsupported and rejected. Existing cuts retain their
native cut checks. Purchased/catalog/library source geometry stays immutable.
STEP round trips and the existing STL topology/volume checks apply to these forms.

## Fixed attachment frames

A part can declare 1–16 `datums`, each `{id, position, rotation}` in the same local
millimeter/XYZ-Euler-degree frame as its native mesh. `placement` has `version: 1`,
explicit `roots` (`{partId, reason}`) and `attachments`. An attachment contains:

```json
{
  "id": "declared_joint",
  "requirementId": "existing_requirement",
  "parentId": "existing_parent",
  "parentDatum": "declared_parent_frame",
  "childId": "existing_child",
  "childDatum": "declared_child_frame",
  "offset": {"position": [0, 0, 0], "rotation": [0, 0, 0]},
  "verification": {"type": "contact", "maxGapMm": 0.01, "maxIntersectionMm3": 0.001}
}
```

These are schema examples, not a proposed design or default mating tolerance.
The designer must choose the actual values. Every nonroot has one parent; cycles,
unknown references and ambiguous parents are rejected. Independent roots require
explicit reasons. No relationships are guessed from names or proximity.

The solver applies `Tchild = Tparent × Dparent × Offset × inverse(Dchild)`.
Native admission independently recomputes this transform and rejects contradictory
supplied poses. Automatic repair preserves the placement graph and its acceptance
criteria. A geometry edit must also update any affected design-owned datum;
the host then recomputes descendant poses. It never guesses new datum positions
from a bounding box. A topology change needs an explicit new design decision.

`contact` measures BRep distance and positive-volume intersection. Its bounded
thresholds are 0…0.1 mm and 0…0.01 mm³. The separate assembly-overlap gate remains
active and can be stricter; passing this individual check does not bypass it.
`frameOnly` instead requires a reason and remains **UNKNOWN** for physical contact.
Missing or duplicate current-revision attachment records remain **UNKNOWN**.

## Preview and reproducibility

Profile shapes require the native local STL and the resolved part transform.
The preview must not replace them with boxes or cylinders. Saved native jobs
freeze and hash `parametric_geometry.py` with the existing worker and source
dependencies. Imported assets retain their existing source identities.

## What this does not establish

Contact is not fastening, hole engagement, retention, clearance through motion,
printability, strength or electrical operation. Existing specific checks still
need to be requested where applicable. Axis-only solving, moving joints, mirrored
asymmetric solids and inferred datums are outside this version. Browser appearance,
upstream-model quality and physical qualification need separate acceptance tests.
Synthetic native regressions must never be presented as an AI-generated airplane
or evidence that every future model will be correct.
