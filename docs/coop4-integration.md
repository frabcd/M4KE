# Coop 4: local sourcing MCP and capability boundary

The user confirmed that `lcsc-part-scraper.zip` is the complete supplied package. It is a browser-automation **skill**, not an MCP server or editable PCB designer. We preserve its contribution without claiming functions it does not implement.

## Implemented now

`server/studio-integrations.mjs` is a new, dependency-free, read-only **MCP stdio server**. Run it on the DGX alongside M4KE; it does not require or contact a cloud model:

```sh
cd <M4KE_ROOT>
node server/studio-integrations.mjs --stdio
```

Standard MCP client configuration (the process must run on the DGX, not the home browser):

```json
{
  "mcpServers": {
    "m4ke-offline-sourcing": {
      "command": "node",
      "args": ["<M4KE_ROOT>/server/studio-integrations.mjs", "--stdio"]
    }
  }
}
```

| Tool | Actual result |
|---|---|
| `list_capabilities` | Local adapter inventory; supplied-source byte status; separate absent PCB/live-provider states |
| `search_cached_parts` | At most eight matching entries from the pinned, integrity-checked supplier snapshot; identities, dated prices/stock, source links/hashes and compatibility limitations |
| `quote_cached_part` | Quantity-specific indicative subtotal for an exact cached entry; stale, missing or incomplete prices stay null, never zero |

The optional application route is **GET `/api/studio/integrations`**. Root service wiring is separate from this module; `createIntegrationsService({root,json})` returns the usual exact-route handler. `createIntegrationRuntime({root})` gives the same tools directly to the Qwen orchestrator without a second server or network round trip. Merely exposing the MCP process does not prove the current Qwen job called it: record actual tool calls in the design-run provenance.

Prices reuse the existing reviewed snapshot `10274e8058359c921c6880058ea51f8856e4be409b551abf11d78d1de95a64b4`, its original evidence hashes and 24-hour policy. Current snapshot coverage is four references, **not a full toy BOM or universal supplier database**. Cached stock is an observation, not a reservation. Tax/shipping and exact SKU variants remain explicit. Bare DRV8833 IC is not a populated driver board. Supplier text is data, never an instruction or engineering qualification.

## Supplied package versus runtime

Original ZIP SHA256: `9243fe2a4d11c1be89103cd431d5e0d372e6c5ab7a18eb16c69ba0a4acee9cab`. The adapter checks the five inspected extracted files when present; an absent or changed package is reported, not executed. Static inspection found:

- Browser search-page extraction of part identity, displayed price tiers and stock text.
- Symbol/footprint **SVG previews**, and a **PNG screenshot** of a 3D canvas.
- Windows-specific Chrome launcher, Playwright and an operator-controlled browser login.
- **No** MCP transport, editable schematic/PCB authoring, routing, Gerber export or scaled STEP/STL download.

Those browser scripts are **not installed as executable DGX tools**. During the scoped live check, DGX CDP port 9222 was unavailable. Live retrieval requires a separately configured, isolated browser during setup and supplier internet. The application remains offline afterward. We do not transfer browser sessions, expose arbitrary `eval`/click commands, execute supplier JavaScript, put previews into printable geometry, or claim the UI screenshots are CAD files.

No separate PCB tool will be searched for or invented: the user confirmed none is available. The inventory accurately shows `MISSING_PROVIDER`; the benchmark can use ready-made modules. The model-library teammate owns genuine scaled geometry and admission, not this sourcing adapter.

## Checks

```sh
node --test tests/studio-integrations.test.mjs
```

Tests cover real MCP subprocess handshake/tool discovery, bounded messages and arguments, exact GET route, no online fallback, stale quantities, missing data, exact identity and the bare-IC negative control. Source-only distributions omit private supplier page fixtures; those fixture-dependent cases explicitly skip, while protocol/boundary checks still run. Passing these tests does not establish physical behavior, successful PCB design, live scraping or a complete BOM.

2026-09-27 validation: **9/9 local tests passed**. An isolated DGX run of the exact adapter (`f166413791758d4cdda8c968167eaa4f9d17739bbfedf8aaabc301881244be58`) also completed the real stdio initialization/three-tool discovery and the runtime's offline C50506 search plus quantity-three Pico quote. Receipt: `<M4KE_ROOT>/test-results/coop4-mcp-8lzb88g_/receipt.json`. This test did not deploy or restart production. It found four cached references and correctly reported that the original browser-script extraction was not installed on the DGX.

No purchase, account change, PCB submission, printer action or teammate database modification is performed.
