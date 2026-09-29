# Optional signed-in Codex demo

The source release still defaults to **Ollama / DGX-local Qwen**. This optional
mode explicitly uses the operator's existing Codex ChatGPT login and requires
internet access. Prompts and relevant design context leave the DGX for Codex;
CAD, verification and project storage remain on the DGX. It is not offline and
is not a Qwen-generated result. No automatic model fallback is configured.

1. Install the Codex CLI and sign in interactively (`codex login`). Never copy
   its auth files or share a password/API key.
2. On the signed-in computer run `node scripts/codex-demo-bridge.mjs`.
   It listens only on `127.0.0.1:4181`, with one bounded request at a time.
3. Establish an authenticated SSH reverse forward to the DGX, mapping its
   loopback port 4181 to this computer's loopback port 4181. Do not bind either
   end to `0.0.0.0` or expose the bridge through an HTTP tunnel.
4. In M4KE runtime settings choose **Codex online demo**, endpoint
   `http://127.0.0.1:4181`, and exact model `codex-gpt-6-sol`.
5. Keep both the bridge and SSH connection running. To return to offline mode,
   restore the previously saved Ollama endpoint/model/provider; disconnect the
   bridge. User projects and component assets do not need to be rolled back.

The adapter uses data-only, ephemeral Codex invocations in a fresh temporary
workspace, read-only sandbox, disabled shell/apply-patch tools, no user MCP
configuration and no web search. The normal schema, catalog-source, CAD,
electrical and physics checks still apply. The adapter neither prints parts nor
enables motor outputs. Browser-origin requests are rejected and no CORS is
enabled. Treat local machine access as trusted; do not run it on a shared host
where other local users may spend the logged-in account's allowance.

## Delivery behavior

New UI generation uses staged delivery: native failures are kept in task
history rather than replacing the published design. One bounded repair remains
available. Proposed edits undergo native checks before the user can accept them;
acceptance binds the matching job/hash. A passed digital check is not physical
testing: calibration, supplier dimensions and actual behavior still need
confirmation, summarized separately from errors.

A requested edit that changes a design target is different from automatic repair.
Candidates retain existing requirement/check IDs, show old/new targets, and need
an additional explicit target-change acknowledgment before application. Automatic
repair may not change those frozen targets. Purchased identities, electrical
controls and acceptance-driving physics inputs remain protected.
