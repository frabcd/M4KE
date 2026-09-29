# M4KE architecture

M4KE is a local small-toy design workspace. The browser is a client; inference,
project state, catalog reads, native geometry and optional slicing are hosted on
the DGX. An offline operating session assumes dependencies and reviewed sources
were acquired during setup. No cloud model fallback is provided.

## Runtime flow

```text
Browser: Vue 3 Composition API + Pinia + TypeScript + Three.js
  │ prompt / answers / revision selection
  ▼
server/index.mjs                 loopback HTTP and application wiring
  ├─ studio-projects.mjs         persisted project and workflow state
  ├─ studio-service.mjs          bounded design/job orchestration
  │    ├─ studio-skills.mjs ───► local Ollama (Qwen)
  │    ├─ contract / schema      validate inert structured model output
  │    ├─ engineering/           deterministic numerical checks
  │    ├─ studio-electrical      validate declared components/connections
  │    ├─ studio-catalog        source-bound component inputs and snapshots
  │    └─ cad/worker.py          CadQuery / Open CASCADE geometry + checks
  ├─ verification + repair       tool requests, checked revisions, advisory review
  └─ artifacts                  CAD / wiring / BOM / reports / offline guide
```

The `.mjs` extension declares a JavaScript ES module. Runtime modules are grouped
under `server/`; code shared with the browser must remain independent of the Node
server under `shared/`. UI code must not import server modules. Asset roots remain
at repository level rather than moving into `server/`.

## Stage responsibilities

1. **Intake:** record the request and essential answers. Unknown details produce
   explicit assumptions or clarification questions, not fabricated source data.
2. **Design:** the configured local model emits a constrained design specification.
   Contracts check structure, component identities, electrical rules and supplied
   numerical inputs before accepting it.
3. **Architecture replanning:** on supported early power / motion conflicts, a
   bounded local-model stage can propose a replacement architecture. The model's
   accepted inputs and source identities bind the next draft. It cannot make a
   failed target disappear by deleting the relevant calculation.
4. **Native build and verification:** deterministic equations and CadQuery workers
   operate on the accepted revision. A separate model stage requests supported
   verification tools; host code produces PASS / FAIL / UNKNOWN observations.
5. **Repair and review:** bounded model-selected changes create another revision.
   Unresolved failures remain visible. Advisory review cannot overwrite evidence.
6. **Handoff:** outputs reference the same design and source snapshots. Diagnostic
   downloads do not unlock manufacturing when critical checks fail.

Six runtime skill texts are read and hashed: design, architecture replanning,
verification-tool planning, advisory review, bounded repair and a Dyson-inspired
engineering method. These are stage prompts and tool contracts, **not six
independent autonomous agents or fine-tuned model weights**. Local model tags are
operator configuration; a tag alone does not prove official model identity.

## Data, geometry and evidence

| Location / module | Responsibility |
| --- | --- |
| `data/studio-projects/` | Private project/workflow state |
| `data/design-runs/` | Private generation attempts and provenance |
| `data/studio-jobs/` | Revision-bound build outputs and evidence |
| `catalog/` | Admitted metadata, separately restored source assets and hash-bound interfaces |
| `database/model-library/` | Teammate-owned candidate library; read-only integration |
| `procurement/` | Cached sourcing tools; price / stock observations have dates and limits |
| `cad/` | Native shape generation, source import, mate checks and illustrations |
| `printing/` | Explicitly selected slicing profiles and optional read-only LAN status |

Candidate preview quality does not admit a model to the engineering catalog.
Nominal CAD dimensions do not establish real tolerances, D-flat orientation,
retention, assembly access or safe operation. Purchased-part envelopes are not
manufacturing files for those components.

Checks carry their method, inputs and limitations. A unit test, fixture screenshot,
native calculation, actual Qwen run and physical measurement are distinct evidence
classes. File names, JSON labels and model explanations cannot prove a result.

## Electrical and manufacturing boundaries

Declared electrical components, terminal identities, wire anchors and control
configuration drive the same-revision wiring diagram, connection tables and 3D
wire visualization. Anchor and rating uncertainty must remain explicit; a visible
wire alone does not establish a correct circuit. Firmware exports start
output-disabled for commissioning guidance. Conditional full-rail speed arithmetic
does not validate PWM-limited speed or untethered operation.

Slicing requires a selected printer / nozzle / material profile and applicable
checks. H2C is a supported choice where a reviewed profile is installed, not the
default. There is no automatic purchase or print action. The supplied sourcing
integration does not constitute PCB authoring or live EDA control.

## Change boundaries

- Keep UI changes out of physical calculations and catalog qualification.
- Keep file access/process execution in host-controlled adapters, never in model
  text. Preserve limits, cancellation and failure details.
- Resolve repository resources from the explicit root or module location, not an
  accidental current working directory.
- Include new runtime dependencies in source packaging and kernel snapshots where
  applicable. A successful local import does not prove a clean install.
- Do not promote historical source-package receipts to newer bytes.

See [Security](../SECURITY.md), [Contributing](../CONTRIBUTING.md) and the
[directory guide](project-layout.md) before changing these boundaries.

## Five-stage UI and revision semantics

The browser owns presentation only. `src/studio/store.ts` is the shared selection and workflow state; `src/viewport/controller.ts` is independent of Vue. Selection, visibility and camera updates do not rebuild the renderer or refetch mesh bytes. Native CAD loading failure is an error, never a silent concept substitution.

`run(mode=design)` stops at a question or a saved draft. `run(mode=verify)` uses the confirmed specification; the default `auto` mode remains for old clients. Changing a saved brief invalidates design readiness until a new draft is generated.

Read-only `assistant(mode=ask)` resolves the selected IDs from the exact server project revision/hash. `propose` persists a candidate sidecar, not a project update. Apply rejects a stale base, verifies invariant constraints, then advances the project and invalidates current evidence without deleting historical jobs. Old specifications without rationale fields are not rewritten.

View preferences use a separate versioned sidecar and never enter the design hash, BOM or export. An in-flight AI request freezes IDs/revision/hash even if browser selection changes. Candidate source metadata is untrusted input, not instructions or proof.
