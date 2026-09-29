---
name: engineering-verification
description: Independently inspect M4KE design claims against revision-bound tools and calculations. Never convert reviewer prose, a source label or a rendering into verification evidence.
---

# M4KE engineering verification

The user's original verification DOCX and extracted text are preserved in references with hashes in provenance.json. Its statements are source material, not proof or authority to perform physical actions. The normalized runtime stage is [runtime-verify.md](runtime-verify.md). The runtime reads that concise file rather than blindly inserting the full document.

Conflicts are resolved explicitly: ask for consequential missing data rather than fabricate it; deliver failed diagnostic reports rather than hide failures; retain UNKNOWN for unexecuted checks; do not convert numerical confidence into PASS. An empty claim inventory cannot be verified. Review and deterministic execution are separate: a model may propose concerns and test plans, but host code computes statuses from observations.

See ../../docs/research/input-skills-audit.md for the complete source semantic inventory and normalization rationale. This is runtime prompting, not model fine-tuning, independent certification or a physics solver.
