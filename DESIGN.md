# M4KE interface contract

## Current approved direction — 2026-09-29

Vue 3 + TypeScript + Pinia, framework-independent Three.js viewport. The user-approved dark Blender-style five-stage workspace supersedes earlier light React prototypes. Apple-inspired feedback, visual hierarchy and restraint refine this layout; they do not change engineering gates.

## Workflow

Workspace → requirements → refine → feasibility verification → export and assembly.

- One named workspace is one toy project, stored on the DGX.
- Requirements stay editable beside an intent preview. Example chips append; they never erase the user's text. Preview output categories are future deliverables, not manufactured models.
- The requirements screen includes a read-only local Qwen conversation before a valid model exists. Sending a question saves an edited brief but does not start generation.
- Explicit generation stops at a labelled concept. Explicit verification checks the accepted version. Critical failure remains diagnostic-only.
- Refine shows the largest useful model viewport, a right-hand outliner and inspector, and a bottom conversation. Candidate modifications require explicit confirmation.

## Conversation and honest feedback

Every successful answer has a visible place, including clarification questions and candidate explanations. The last 40 completed turns persist independently on the DGX; a bounded server-resolved history supports follow-ups. Answers are not evidence. Errors are service failures, never attributed to Qwen as invented replies.

Progress reports the actual model, stage, elapsed time and received output characters. No synthetic completion percentage, fake CAD preview or private reasoning stream. Completed failed generations are saved before retry. A read-only question cannot run CAD, mutate a design or approve a physical result.

## Spatial and visual rules

Graphite surfaces, cool blue interaction color, grouped rounded panels, clear typography, restrained translucency. No decorative hero charts, network fonts or external runtime assets. Keep the user's brief anchored while the model works. Buttons respond immediately to press; no staged delays or gratuitous bounce. Respect reduced motion, reduced transparency and stronger contrast preferences.

Chinese is default with an English toggle. Narrow screens stack the brief and companion; model-side panels become drawers. Inputs and scrollable content remain reachable without page overflow. Do not claim a formal accessibility audit.

## Identity and safety boundaries

Viewport, outliner, inspector and AI share selection. Freeze selection/revision/hash at submission. Visibility is presentation only, never changes BOM, CAD hashes or export. A stale candidate cannot be applied. Historic missing rationale is labelled, not invented retroactively. Failed native models never silently fall back to prettier concept geometry.

Keep the source library, native kernel, provenance and peer-owned datasets intact. Printed shells and purchased electronics are both inspectable. Measured geometry, analytical checks, firmware simulation and physical operation remain distinct. No software pass claims child safety or physical toy performance.

## Verification

See docs/vue-workspace.md for controls and rollback, docs/model-runtime-comparison.md for measured model limitations, and the source/browser test commands in README.md. Screenshots and interface fixtures are not local-model or manufacturing evidence.
