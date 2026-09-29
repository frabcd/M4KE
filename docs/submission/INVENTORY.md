# Dependency, NVIDIA, model and skill inventory

> Historical deployment inventory. Model tags below belong to their recorded
> snapshots, not a fresh installation default. The current README documents the
> later local Qwen FP8 trial; see [public release scope](PUBLIC-RELEASE.md).

This describes the source snapshot, not unobserved improvements or a sponsor SDK checklist.

| Layer | Actual implementation / pin | Packaging and evidence boundary |
|---|---|---|
| Hardware | DGX Spark, observed NVIDIA GB10; Linux aarch64 | Hardware and host drivers are prerequisites, not bundled or modified |
| Model serving | Existing Ollama; prior environment recorded 0.32.14 | No runtime/weights copied, no cloud fallback; inspect each new host |
| Model | Local tag `qwen3.8:27b`; recorded family `qwen35`, 27.3B, Q4_K_M | Tag/metadata distinction preserved; no official identity inferred from an alias |
| Backend | Node 22+, ESM modules, loopback HTTP, bounded child processes | Current exact dependency graph in package-lock.json |
| UI | Vue 3.5.43, Pinia 4.0.3, Three.js 0.180.0, @lucide/vue 1.48.0, fflate 0.8.3 | These versions and licence labels below are observed lock metadata |
| Build/test | Vite 7.3.6, TypeScript 5.9.3, Vue Vite plugin 6.0.9, vue-tsc 3.3.11, Playwright 1.63.0 | Clean install runs unit/API tests; browser binaries/tests are an additional setup |
| CAD | CadQuery 2.8.0, cadquery-ocp 7.9.3.1.1, VTK 9.6.2 | Full recorded Linux/Python3.12 transitive lock provided; no wheels shipped |
| Slicing | Bambu Studio 2.8.2.61 maintained Flathub aarch64 build | Native binary/runtime pinned in setup and adapter; not an official ARM AppImage claim |
| Source kits | Manufacturer URL/hash/frame/interface metadata and bounded compiler | Source STEP/PDF/Eagle/archives excluded; explicit exact-hash reacquisition |
| Portable candidate | `sound-car-portable-reg5-candidate-v1`, explicit fixed-size route, registry and package helpers | 48 objects / 22 printed; extra purchased geometry remains source-derived envelopes; no automatic generic repair or manufacturing release |
| Electrical design | Validated component/terminal netlist; shared 3D routes, SVG diagram, CSV table, guide and control-pin configuration | Model-assumed terminal locations remain explicit; no PCB routing, powered test or automatic motor arming |
| Procurement | Exact-identity offline snapshots, local SHA checks, two-read admission cap | Raw supplier evidence excluded; no quote/adoption when the pinned snapshot is missing |
| Printer status | Bounded TLS-pinned read-only LAN MQTT operation | Explicit trust/serial first; no access-code persistence, upload, heat/movement or start-print commands; physical compatibility untested |
| Skills | Prompt-to-CAD runtime-design.md; engineering runtime-plan.md, runtime-verify.md and runtime-repair.md; Dyson-inspired SKILL.md | Independent model tool selection and bounded repair; runtime text + SHA-256, not fine-tuning or a change to model weights |

The lock records MIT for Vue, Pinia, Three.js, fflate, Vite and its Vue
plugin; ISC for Lucide; Apache-2.0 for TypeScript and Playwright. These are
**dependency metadata**, separate from the owner-approved MIT licence for M4KE original code. Downloaded dependency
packages must retain their upstream notices. Review all transitive licences and
the Python/slicer/model distribution terms before publishing a combined binary.
This source-only package does not relicense or vendor those dependencies.

The James Dyson method is a bounded, cited adaptation using the Nuwa extraction
framework. Its attribution/research Markdown is included; the upstream Nuwa
repository itself is not bundled. User-supplied DOCX and pasted original prompts
are excluded. The normalized runtime skills remain source requiring owner/provenance
review before publication. No endorsement from James Dyson, component makers or
printer manufacturers is implied.

## Optimization claims that are supported, and those that are not

- Structured outputs, strict host validation, one format retry (one additional
  format attempt only after a truncated first or second attempt), one unchanged-input native timeout
  retry and one model engineering repair at distinct stages, queued model use, gzip transport and frozen evidence are code
  features. They are not neural-network training or guaranteed design quality.
- Prior DGX telemetry observed GPU activity on GB10 during inference. Ollama's
  `100% GPU` placement report is not sustained 100% utilization or a benchmark gain.
- No TensorRT, Isaac, NVIDIA training SDK or StepFun inference integration is
  implemented/claimed. Existing NVIDIA GPU execution is the verified platform use.
- Performance comparisons need the same retained prompts, model digest, context,
  output budget and hardware measurements; this archive does not invent throughput.
- Native replay on September 28 used identical input bytes and preserved all 51
  check observations: 365.9 seconds before, 136.5 seconds after scoped geometry
  caching/bounding work. The replay still returned the original interference and
  sampled-rotation failures. This is one measured CAD workload, not an inference
  throughput result, general speedup guarantee or passing car acceptance.
- CAD operation diagnostics retain the last phase and duration. One timeout retry
  reuses the unchanged input; process diagnostics are not verification evidence.
- No PCB authoring MCP or live LCSC pricing session is established by the source
  scraper materials. Missing prices/stock remain unknown, not estimates or quotes.

## Team library and electrical boundaries

The read-only teammate handoff is preview-10 / usability-11: 505 previewable
entries are not 505 manufacturing-qualified parts. The optional collision-12
handoff is not dynamic, assembled-fit or physical qualification. Neither UI
quality nor candidate library scale checks admit new components into the runtime
catalog automatically.

Electrical netlists and firmware configuration share the job design hash.
Supported control profiles bind actual component roles and controller pins;
unknown identity, pin or power prerequisites remain unresolved or block output.
Firmware starts output-disabled. Three-dimensional wiring is a proposed route
with model-assumed terminal anchors, not measured harness clearance or proof of
a physically working circuit. See [electrical workflow](../electrical-workflow.md).

System-13 adds read-only unified source discovery and exact SHA-bound native source imports. Original millimetre origin is preserved. Searchability / positive solids / static colliders do not establish fabrication permission, dynamic behavior or physical fit. The original source bytes and licences remain separately installed; no library assets are bundled with this source release.
