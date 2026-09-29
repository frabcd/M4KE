# Skill integration handoff — September 28, 15:14 China

This update describes inspected runtime integration and its evidence limits. The September 27 handoff below is preserved as history; its four-file count, missing-electrical statements and proposed actions must not be read as current implementation status. Original skill documents are reference material, not instructions that override the user's request or host evidence rules.

## Six runtime skill files, not six independent agents

`studio-skills.mjs::loadStudioSkills()` reads the following six files on demand, rejects empty files and files over 32,000 bytes, and computes SHA-256 from the actual bytes. Design-run records retain the hashes used for that run. A copied Codex skill, a filename or this document alone does not establish that Qwen executed it. These are prompt/tool contracts, not fine-tuned model weights.

| Runtime key | File | Implemented role and boundary |
|---|---|---|
| `design` | `skills/prompt-to-cad/runtime-design.md` | Essential questions, explicit assumptions, bounded CAD specification, component identities, electrical graph and assembly intent. `buildDesignMessages()` sends this through local Qwen; host schema checks the reply. |
| `architecture` | `skills/prompt-to-cad/runtime-architecture.md` | `studio-architecture-plan.mjs` requests a bounded model-selected replacement architecture after declared-input failures, before accepting CAD. Known failures must be rechecked, not hidden by missing values. Accepted numerical inputs and catalog identities bind subsequent full generation; this is not a developer-authored car or a physical solver. |
| `plan` | `skills/engineering-verification/runtime-plan.md` | `studio-verification-plan.mjs` asks local Qwen for bounded, requirement-linked host-tool requests and uncovered requirements. It cannot delete existing checks, supply check results or turn unsupported tools into PASS. |
| `verify` | `skills/engineering-verification/runtime-verify.md` | `buildReviewMessages()` obtains a separate advisory review of the actual design/report. Model concerns are not deterministic evidence or physical test results. |
| `repair` | `skills/engineering-verification/runtime-repair.md` | The service requests bounded model-selected corrective patches, retains failed attempts and re-runs host checks. It cannot lower frozen targets, silently resize source geometry or replace the original benchmark with a preset. |
| `dyson` | `skills/james-dyson-perspective/SKILL.md` | Source-backed failure-first prototyping lens used in design messages. It is not James Dyson's identity, endorsement or an engineering certification. |

**Deployment boundary:** the 14:37 UI deployment (`ec862f14560d48b827e52396474868eb94b52e06c0974601486a7d8bcb18797e`) has the earlier tested backend. The new architecture stage and native catalogMate implementation are local/staging changes, not yet production capabilities. Source-review-12 is a separate immutable, scan-passed checkpoint (`f4a6e8f5050bf188cfce5024f4792c6a7019d8417cdf782ae7e5e0e788aa9805`); it has not been clean-installed or deployed. Later edits require new evidence rather than reusing those hashes.

## Concrete integration since the historical handoff

- **Electrical source of truth:** one structured Qwen netlist identifies component profiles, terminal-to-terminal connections, control pins and proposed terminal anchors. It drives labelled SVG, CSV, same-revision 3D wires, guide and firmware configuration. Missing anchors are not replaced by component centers; exploded view hides untransformed wires. Anchors remain MODEL_ASSUMED unless supported by actual source evidence. Firmware remains output-disabled or BLOCKED; graph consistency is not commissioning.
- **Verification planning:** supported native requests include `envelope`, `shaftHole`, `rotationSweep` and, in the newer candidate, `catalogMate`. Host calculations and exact native checks own their evidence. Sampled rotation does not prove continuous dynamic clearance. Native catalog mating tests source-bound nominal shafts/bores, axes and engagement; matching still leaves real tolerances, D-flat orientation, retention and physical fit UNKNOWN, with no automatic collision exemption.
- **UI evidence:** the deployed Chinese/English, model-primary workspace passed five actual read-only browser checks on a historical diagnostic job. All 21 parts rendered in 65.5 seconds on that run; 2D/3D wire selection and structured issue localization worked. The design remained FAILED, firmware BLOCKED, physical UNKNOWN. This is a viewer/workflow result, not a successful car design.
- **Supplier boundary:** the supplied LCSC ZIP is a browser lookup skill. The implemented supplier MCP exposes cached search, quantity quotes and capability information. It is not 嘉立创 EDA authoring, PCB layout/routing, live-stock certification or purchasing. Source scale review does not prove circuit ratings or full BOM completeness.

## Actual Qwen result and remaining work

Seven fresh September 28 car runs have produced **zero passing end-to-end car workflows**. The seventh project, `bb6ef36f-e3d5-48a0-a351-051e84528fa6`, ended ERROR at 15:04:22 China. Its initial voltage contradiction triggered architecture replanning, but both architecture responses omitted required numeric inputs. The host preserved the known failure rather than allowing UNKNOWN to clear it; architecture FAILED, `designHash: null`, and no CAD specification was accepted. Receipt: `test-results/qwen-acceptance-3euaxatq-evidence.tar.gz`, design run `70e05213-40b7-4dc1-9786-ee2f0b35c840`. The isolated service/children stopped without production changes.

Local regression is separately recorded as 412 tests, 410 PASS / 2 SKIP / 0 FAIL (`test-results/resumed-full-node-final2.log`); native catalog mating 13/13 and prior worker regression 41/41 (`test-results/catalog-mate-native/handoff.json`). These results support specific implementation contracts, not model quality, complete original-document coverage or hardware performance. Ongoing code iterations must preserve model ownership of design, repeat the actual fresh-request acceptance, and retain failures; no hand-designed replacement counts.

Coops 1/2 own video/editing, Coop 3 owns the versioned model library. Do not alter its scale or files to improve screenshots. All physical operation, manufacturing readiness and electrical commissioning remain unproven. No inference, deployment, source packaging or teammate-data mutation was performed for this documentation update.

---

# Historical handoff — September 27 design and verification

Snapshot: **2026-09-27 13:05:50 UTC**, local working source. This is a bounded feature map for the competition README, not a new toy design, deployment receipt, or competition-ready declaration. Source-review-06 is an older validated snapshot and does not certify subsequent changes.

## Ownership and intended product

- Coop 1's supplied design materials define the prompt-to-physical-design workflow.
- Coop 2's Engineering Verification document defines evidence-first checking and the failed/unknown handoff.
- Qwen owns request interpretation, component/design choices, verification-tool requests and bounded corrective patches. The studio implements the tools and evidence rules. Codex must not replace this workflow with a manually engineered car.
- The sound-threshold car is one benchmark of the general small-toy studio. A deterministic car preset is not a successful fresh-Qwen benchmark.

## Original materials are preserved

The following checks compared current repository bytes with the user-supplied original files and the stored provenance manifests. Both design texts and the verification DOCX match their supplied originals exactly. The extraction matches its recorded provenance hash.

| Preserved source | SHA-256 | Current comparison |
|---|---|---|
| `skills/prompt-to-cad/references/design-package.md` | `43d5c6f18cd205a1ef56a843215d64394e8a46d2aa66018c363a32ace06dba8f` | Matches first pasted original |
| `skills/prompt-to-cad/references/design-intent.md` | `2c00672eb3308bc6dc579d7fbd5be209a1c0e0cb7c1c3ed1011d98e02544563a` | Matches both copies of the supplied design-assistant text |
| `skills/engineering-verification/references/Hackathon verification skill.docx` | `e5af8bfc453abd5ab0b37abf909d604d61a6eb9880f3c5f1d55580d36ffa0054` | Matches original DOCX |
| `skills/engineering-verification/references/hackathon-verification-extracted.txt` | `d2bee4e56d798800f856d6cc4723f7048b0f993871b5283642ac8c571c18cf37` | Matches extraction provenance; paragraph ordinals retained |

Preservation does **not** mean every original instruction is implemented. Originals remain reference data. Qwen receives normalized runtime stages, not an automatic concatenation of these source files. The verifier document's duplicated ellipsis-only outline at P292–375 is unfinished scaffolding, not a hidden implemented feature.

## Actual runtime loading and hashes

`studio-skills.mjs::loadStudioSkills()` reads all four files on demand, rejects empty/oversized stages, and computes SHA-256 from their actual bytes. `buildDesignMessages()` includes the design stage and Dyson lens. `buildReviewMessages()` separately includes the verification stage. `studio-service.mjs` uses the repair stage for constrained model-selected geometry patches. Model calls use the configured local Ollama endpoint; copying a Codex skill alone is not the integration mechanism.

| Runtime file | Snapshot SHA-256 | Runtime role |
|---|---|---|
| `skills/prompt-to-cad/runtime-design.md` | `1e13bf3fb97a4da8911fbabe1259cb18b9b1c93337fa85d3d9f81431a457ef1c` | Requirement/intake rules, supported design JSON, component and interface discipline, host verification requests |
| `skills/engineering-verification/runtime-verify.md` | `78d2f4a2f22f385a6b951d6941b7f22024ab7cbeabfda002a1a00c21c440d4a0` | Separate evidence-oriented advisory concerns; cannot award host statuses or rewrite geometry |
| `skills/engineering-verification/runtime-repair.md` | `fe4e92a03958e1f097585872434c7676fe7a4e711148c812259c45555ae90f4d` | Model-selected bounded part patches responding to host failures |
| `skills/james-dyson-perspective/SKILL.md` | `f25ccd024822142989ad1508e56983ad1a940730cc76ddb0eeadc7b7dbac34ec` | Failure-first prototyping lens, not impersonation or endorsement |

These hashes describe the inspected local snapshot, not proof of deployment, adherence, model quality, or physical success. They must be refreshed if files change.

## Original → runtime mapping

| Original requirement | Concrete runtime mapping | Accurate implementation boundary |
|---|---|---|
| Design-package §1–3; design-intent §4–5: understand requirements, assumptions, essential questions | `runtime-design.md` clarification rules; `requirements`, `assumptions`, `unknowns`, `questions`; persisted project answers | Structured intake exists. No separate mandatory user-confirmed read-back stage or typed confidence/impact record for every assumption. |
| Design-intent §3, §7–9: complexity, concept, minimal subsystems | General-toy runtime instructions; description, parts and assembly graph | Model-guided design reasoning, not a host-enforced four-level complexity/subsystem schema. |
| Design-package §4, §9–10; design-intent §10, §15: real component sources and compatibility | `studio-catalog.mjs`; fixed-scale hash-bound catalog STEP; metadata-only candidate search; provenance labels | Source geometry can be imported. Catalog identity and a source label do not certify electrical equivalence, all mounting interfaces, materials, prices or fit. Candidate-library metadata is not admitted build geometry. |
| Design-package §5–6; design-intent §11–13: plan, design representation and named features | Strict `studio-contract.mjs`/`studio-schema.mjs`; IDs, dimensions, feature data, assembly references; `verificationRequests` | Geometry is editable data. Per-parameter source/reason, relational constraints, named feature provenance and a complete pre-model verification plan are not structured for every dimension. |
| Design-package §7: real CAD backend, no invented files | Native CadQuery/Open CASCADE adapter, frozen input/dependency hashes, artifact readback | Bounded boxes, cylinders, printed unions, holes, fillets and pockets; no arbitrary CAD code, general sculpting, gear/thread generator or universal CAD feature tree. |
| Design-package §8, §16: coherent deliverables | Same revision produces STEP/STL, BOM, verification JSON, assembly guidance and native projection illustrations when available | Not a complete dimensioned/toleranced/layered manufacturing drawing set or circuit-diagram generator. A BOM of modelled parts is not necessarily a complete purchasable build list. |
| Verification P25–46, P150–183, P245–263: do not trust designer claims; evidence-specific statuses | `verifyDesign()`, native checks and hash-readback; PASS/FAIL/UNKNOWN; FAILED/UNVERIFIED/VERIFIED_WITHIN_SCOPE | Host owns evidence. Model reviewer remains advisory. Same-model stage separation is not independent ground truth. Physical status remains UNKNOWN. |
| Verification P68–110: requirement-linked claims and verification plan | Requested checks reference requirement IDs; `VERIFICATION-PLAN.json`; review concerns reference requirements | No guaranteed executable acceptance test for every free-text requirement. General requirement coverage remains UNKNOWN; the advisory response is bounded, not an exhaustive claim registry. |
| Verification P114–148, P191–214: validate geometry and calculations, seek failure modes | Native validity/STEP/STL/intersection checks; envelope, bounded shaft/hole and sampled rotation requests; conditional motion, voltage, current, beam and sound-controller checks | Calculations use disclosed inputs; missing data does not become zero or a fabricated manufacturer value. Supported pin and sampled-motion checks do not cover all compound/catalog interfaces or continuous dynamics. |
| Verification P218–243: simulation and manufacturing | Explicit selected-printer/slicer workflow plus available geometric and numerical screening | No general FEA, CFD, thermal solver, full tolerance-stack solver, automatic wiring validation or manufacturing/safety certification. |
| Design-package §12; verification P265–279: checker hands back failures, designer repairs | Native failure feedback → Qwen patch stage → host validation → regenerated checks; failed attempts retained | Up to one engineering repair cycle with bounded response-validation retry. No requirement/input/predicate weakening; no silent source-part resizing, part deletion or manual car replacement. |
| Design-package §13–15: sourcing/budget cross-reference and verification modes | Project budget field, source/price status disclosure, individual host checks and review concerns | No complete costed BOM/budget gate, five-domain discrepancy matrix, automatic `verf.*+` double-pass dispatcher or full standards conformance engine. |

## Substantive gaps to disclose, not conceal

1. **Full-design skill coverage is partial.** The bounded design schema lacks per-feature intent/provenance, complete electromechanical connection records, manufacturing drawings and circuit diagrams. Do not describe this as unrestricted AutoCAD-equivalent generation.
2. **Verification coverage is partial.** Requirement-linked tool requests exist, but generic requirement acceptance and unsupported interfaces remain UNKNOWN. A finished workflow means tool execution completed, not that every functional claim passed.
3. **The reviewer is advisory.** It identifies concerns and missing evidence; it does not yet independently select and execute an arbitrary verification plan. Deterministic host tools perform the available checks. A reviewer concern does not automatically become a proven FAIL.
4. **Build sourcing is incomplete.** Offline source/catalog data and metadata-only library references are distinct. Stock, price totals, all fasteners/wiring/connectors and exact critical interfaces are not guaranteed complete.
5. **Physical and process outcomes are not demonstrated by software.** Printable geometry export, slicer output and tutorials are useful deliverables but not proof of a physically working toy. The user performs the later real build.

## Minimum remaining integration actions — proposals, not changes made here

- Keep the two normalized stages actually loaded in local inference and retain their hashes, model identity, raw responses, current design hash and checked artifacts. Do not spend the deadline hand-designing the benchmark.
- Make README/UI wording explicit: **Qwen-generated concept → host calculations/native checks → separate advisory review → bounded Qwen repair → revision-matched export**. Show unresolved checks next to completed workflow status.
- Do not claim the full supplied workflow is implemented merely because its files are preserved. Prioritize clear requirement-to-check links and unsupported-capability disclosure over new physical simulation, drawing, PCB or procurement scope during the deadline.
- Before claiming a current source release, package the finalized snapshot anew. Do not overwrite source-review-06 or cite its successful installation as evidence for newer code.

## README-ready factual description

> M4KE is a local small-toy design studio. A configured Qwen model turns a request and essential answers into a bounded editable design specification, using normalized versions of the team's design and verification skills. The studio executes native CAD and scoped deterministic checks, records PASS/FAIL/UNKNOWN evidence, obtains a separate advisory review, and can ask Qwen for bounded geometry corrections without weakening the original tests. It exports revision-matched CAD, a modelled-parts BOM and assembly guidance. The sound-controlled car is a benchmark, not a hard-coded substitute for model design. Unsupported interfaces, incomplete sourcing, manufacturing readiness and physical performance remain explicitly unverified.

This handoff changed documentation only. No service, runtime skill, geometry, source library, model configuration or deployment was modified.
