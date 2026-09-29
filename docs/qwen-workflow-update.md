# Local Qwen editing, assembly playback and source research

## What was actually exercised (2026-09-29)

- A separate DGX application used **Qwen3.6-35B-A3B FP8**, served by vLLM with the exact service model ID `qwen3.6-35b-fp8`. No cloud model produced this refinement.
- The test started with an **imported 21-part F1-style baseline**, selected its printed shell and two wings, and requested visible form changes without changing electronics, interfaces or wiring.
- One model response took **38.8 seconds**. Candidate generation plus native CAD and checks took **184.6 seconds**. The resulting three printed-part STL hashes changed; purchased-part mesh hashes did not. The candidate was then explicitly applied as a new revision.
- Current critical checks reported no FAIL. This is **one successful refinement**, not a general success-rate measurement, fresh prompt-to-car success, child-safety approval or physical test.
- An initial test-harness confirmation sent an unsupported field and was correctly rejected. The original failure was retained; the same candidate was confirmed using the supported API. There was no host-authored geometry replacement.
- The original online/Codex application, project and data were retained separately. Providers are labelled by their actual identity.

The geometry vocabulary still limits form quality. A valid primitive-based body is not a guarantee of attractive, injection-mould-quality surfacing. Source models retain their scale and provenance; viewport decoration never replaces printable geometry.

## Editing contract

1. Select parts in the viewport or outliner, then choose **Modify** in the conversation dock.
2. Qwen receives the frozen version, actual selected parts, supported fields and runtime skill. Legacy parts being changed must gain explicit, current explanations.
3. A modification that only rewrites explanations is rejected as a geometry edit. Qwen has a bounded correction opportunity, not an unlimited retry loop.
4. Review the candidate and changes. Only confirmation applies it. Stale-parent candidates cannot overwrite a newer design.
5. Deterministic checks, native CAD and any remaining physical unknowns stay separate from model assertions.

**Ask** remains read-only. Conversation text cannot grant a PASS or silently apply changes.

## Animated assembly

Open **Export & assemble → Assembly tutorial**. Previous/next, play/pause, replay and a scrubber control the same version-bound native meshes shown in the design viewport.

- Completed prerequisite parts remain visible; later parts are hidden for the selected step.
- The animation is an **illustrative vertical move**, not a verified collision-free insertion path. It never checks an assembly checklist for the user.
- Mesh identity, dimensions, design hash and export bytes do not change. Exiting the tutorial restores original poses.
- Reduced-motion preferences disable playback and leave a static step view. Background tabs pause playback.

## Clear wiring

The wiring panel groups connections by **power, ground/return, signal and motor output**. Each card names both parts and pins, known terminal roles, suggested colour and AWG. **Locate in 3D** selects that connection and dims unrelated wires; the pin-to-pin SVG and CSV remain available.

Colours, terminal anchors and AWG are design proposals. Check component revisions, actual header pin numbering, current, voltage, insulation, connectors and length before assembly. GPIO labels are not physical header indexes. Keep power disconnected during wiring. This release does not add PCB routing or Gerber generation.

## Optional web research and MCP

Source releases stay offline by default. An operator can run a DGX-local [SearXNG search service](https://docs.searxng.org/dev/search_api.html), enable its JSON output, and explicitly opt in:

```sh
export M4KE_ALLOW_WEB=1
export M4KE_SEARCH_URL=http://127.0.0.1:18080
# Optional: select engines available on your network, separated by commas.
export M4KE_SEARCH_ENGINES=360search,bing
npm start
```

Use [SearXNG's installation documentation](https://docs.searxng.org/admin/installation-docker.html) and pin your chosen version. M4KE does not download or launch a search service automatically. Keep it on loopback; do not expose the unauthenticated application or search backend directly to the Internet. If explicit engines are supplied, M4KE does not also enable an entire category of engines.

- **Library → Source research** searches component names/MPNs for datasheets, CAD or supplier/price leads.
- The existing MCP adapter exposes `search_component_sources` with `query` and optional `kind` (`datasheet`, `cad`, `price`). Other local library and cached-pricing tools remain available.
- With online research enabled, initial generation lets the local model select up to two component searches from catalog or verified library identities. No complete brief, project geometry or credentials are sent to the search engine. Pure styling can select no searches.
- Results are HTTPS discovery links from an allowlist, cached with timestamps and content hashes. Returning a link does **not** download/admit its CAD, certify its dimensions, establish a price or make a purchase.
- Cache freshness is 24 hours. Offline mode can use marked stale cached leads; no cache yields an explicit miss. Gateway failures do not cause an undeclared cloud-model fallback.
- External text is untrusted source material, not tool instructions. Check the exact SKU, licence, units and critical interfaces before importing data.

The deployed network smoke found Espressif's official DevKitC documentation and then served the same query from cache. This is source discovery, not verification of the current project's board variant. Search providers and sites can be unavailable or challenge requests; the application does not bypass those challenges.

## Regression commands

```sh
npm run typecheck
npm run build
node --test --test-concurrency=4 tests/*.test.mjs
npm run test:e2e
# Opt-in read-only test against an idle deployed project:
M4KE_UI_LIVE_URL=http://127.0.0.1:4173 \
M4KE_UI_LIVE_PROJECT=<project-uuid> node tests/vue-deployed-e2e.mjs
```

The full Node regression run recorded **552 passed, 6 skipped, 0 failed** at bounded concurrency. An earlier unbounded run retained two timing failures; assertions were not relaxed. Skipped and browser tests are separate scopes, not extra passes. Live browser checks inspect actual STL hashes, selection, animation, wire labels, reduced motion and unchanged project identity; they do not test physical assembly.

## Isolation and rollback

Use separate application directories, data roots and ports for online and local-model variants. Save current code/config before switching services. Do not copy a runtime data directory over the other variant or overwrite a teammate's catalog/database. Verify no task is running before stopping an application.

For this review, the old online app remains unchanged. The isolated local app can be stopped independently; returning to the original URL needs no user-data rollback. To undo source changes, use the local pre-change Git backup tag in a separate checkout, not a destructive reset of shared work. Search cache can be retained offline. Stop only owned services/containers; the model consumes substantial unified memory while resident.
