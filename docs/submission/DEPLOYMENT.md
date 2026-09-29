# Clean DGX deployment and offline preparation

## Scope and prerequisites

Use a **new directory**, not an existing production checkout. Target: Linux aarch64,
Python 3.12, Node 22+, npm, a working user account and sufficient storage. No sudo,
NVIDIA driver change, existing-service restart or automatic model download occurs.
The archive is source-only: node_modules, Python wheels, model weights, supplier CAD,
the teammate database, slicer binaries and runtime data are deliberately excluded.

The source ZIP is a local release candidate, **not an authorized publication**.
The owner approved MIT for original code; third-party rights remain separate.

## 1. Check and extract the source ZIP

Run the checker from the trusted source checkout before extraction:

```sh
python3 scripts/check-submission.py /path/to/M4KE-source-review.zip
mkdir -p "$HOME/m4ke-source-review"
# Only extract a checker-approved ZIP into this new directory.
python3 -m zipfile -e /path/to/M4KE-source-review.zip "$HOME/m4ke-source-review"
cd "$HOME/m4ke-source-review"
```

The checker rejects non-allowlisted paths, traversal, symlinks, duplicate members,
unexpected binaries, known private endpoints and hash mismatches. It is a bounded
screen, not a guarantee that every imaginable secret or licence issue was detected.

## 2. Install clean frontend and native CAD dependencies

```sh
python3 scripts/setup-submission.py --smoke
```

This performs `npm ci`, creates `.venv-cad`, installs the **full recorded** Python
lock using wheels only, builds the frontend, runs software tests and a real native
CAD smoke, then starts and stops its own temporary loopback server. No existing
service is touched. The report is `.setup/clean-install.json`; logs are private and
must not be blindly added to a public repository. A missing wheel/version or failed
dependency install is an explicit failure, never an undocumented substitution.

The empty catalog intentionally defers source-kit and portable-kit suites in this
initial phase; the receipt lists the exact deferred files. Run the full suite after
restoring exact source assets in step 4. The native setup also runs the illustration
contract tests: only the real-source portable case skips while required catalog
components are absent; a present but invalid source must fail, not skip.
`--frontend-only`
is an explicit diagnostic mode, not a full successful install. `--verify-only`
tests already installed dependencies; it is not a fresh install.

For a later offline reinstall, stage dependencies while online:

```sh
python3 -m pip download --only-binary=:all: -r cad/requirements-lock-dgx.txt -d .setup/wheels
npm ci --cache .setup/npm-cache --no-audit --no-fund
# Preserve the source, wheel directory and npm cache privately on the same platform.
python3 scripts/setup-submission.py --offline --wheelhouse .setup/wheels --npm-cache .setup/npm-cache --smoke
```

The Python lock pins versions; it is not itself a wheel-hash lock. The install report
records actual download digests. `package-lock.json` supplies npm integrity fields.
Offline installation needs complete caches; do not claim that the small ZIP alone
can install everything without networking.

Optional copy-only wheel-cache recovery for a previously prepared DGX:

```sh
# Fresh .venv-cad must already exist; this does NOT copy installed production packages.
.venv-cad/bin/python scripts/stage-submission-wheels.py --cache "$HOME/.cache/pip" --output .setup/cached-wheels --verify-pypi
python3 scripts/setup-submission.py --offline --wheelhouse .setup/cached-wheels --smoke
```

This reads only wheel ZIP metadata matching locked packages, checks platform tags,
queries official PyPI metadata and requires exact wheel SHA before copying bytes.
It never alters the cache or silently accepts a different version. The current
bootstrap pip may already satisfy its lock without a staged pip wheel; a different
bootstrap version requires that wheel separately. The report distinguishes this
verified cached installation from fresh wheel downloads. Old failed install receipts
are retained; an eventual retry does not erase the failed first attempt.

## 3. Configure an already installed local model and start

Install a reviewed Ollama runtime and obtain model weights separately under their
own terms. No weights or model-install shell script are redistributed here. The
previous DGX recorded tag `qwen3.8:27b` with metadata family `qwen35`, but a tag is
not independent proof of official model identity. Inspect the **new host's** local
inventory; no exact tag available means generation is unavailable, not substituted.

```sh
ollama list
ollama show qwen3.8:27b
# Configure the Ollama service for local weights and no cloud features separately.
export OLLAMA_NO_CLOUD=1
export OLLAMA_URL=http://127.0.0.1:11434
export QWEN_MODEL=qwen3.8:27b
export PORT=4173
npm start
```

Setting `OLLAMA_NO_CLOUD` in the app shell does not reconfigure an already-running
Ollama daemon; check its actual service configuration. The application accepts only
loopback inference endpoints and no cloud fallback. Start only after verifying the
chosen tag locally. Alternatively start with blank model settings and configure them
in the UI. Open `http://127.0.0.1:4173/`. A user-managed SSH tunnel may forward that
loopback service, but this package contains no private connection endpoints or keys.

## 4. Restore source kits without redistributing supplier CAD

`catalog/reference-manifest.json` and `reference-source-index.json` preserve
historical identity/frame metadata, not installed geometry. Active `manifest.json`
starts empty. The following explicit **online setup** action reacquires the 25
reviewed official-source URLs, requires the recorded SHA-256 (including archives),
extracts bounded allowlisted files, checks selected STEP hashes and performs native
imports in an isolated temporary catalog. Only then is the active catalog promoted.

```sh
python3 scripts/restore-submission-catalog.py --accept-source-downloads
.venv-cad/bin/python scripts/catalog_verify_offline.py
node --test tests/*.test.mjs
.venv-cad/bin/python -B tests/illustrate_test.py
```

If a mutable product page changed, exact restoration intentionally stops. Do not
silently update its hash, invent availability, or claim the new source is the old
revision. Review that change separately. Files already downloaded remain for a
resumable retry; an existing differing catalog/file is not overwritten. Once all
sources are present, use `--offline` instead of `--accept-source-downloads` to check
without fetching. `catalog/submission-restore.json` is the current restoration receipt.

The 2026-09-27 audit found byte drift on all eight HTML pages, not just Adafruit,
while all thirteen CAD/drawing/datasheet assets matched their historical hashes.
One commit-pinned README still timed out after a bounded retry. See
`SOURCE-DRIFT-REVIEW.md`: the separate current-observation reconstruction tool is now implemented and tested
as a candidate-only setup operation. See `docs/source-reconstruction.md` for the
actual flags. It does not silently activate a catalog or overwrite historical data.

If you already privately staged the **exact** original source files, an explicit
offline copy-and-verify route is available:

```sh
python3 scripts/restore-submission-catalog.py --offline --source-cache /path/to/private/original-catalog
```

Only the 25 allowlisted source files are copied, each checked against the recorded
SHA before and after copying. This is an exact-cache replay, **not a fresh online
reacquisition**. Keep that distinction in demonstrations. Earlier failed restoration
receipts are retained under private `catalog/history/`; a later success cannot erase
the evidence that an upstream page changed.

Manufacturer files remain subject to their own rights. The separate model-library
candidate database is **not** bundled or recreated; absent it, the app reports no
candidate index while the reviewed runtime catalog can still operate. Optional
candidate previews require the teammate's separately reviewed versioned database
handoff; the submission installer does not populate or modify that owned database.

## 5. Optional native slicer setup, no printer operations

```sh
python3 scripts/setup-dgx-slicer.py
python3 printing/dgx/adapter.py probe
python3 printing/dgx/adapter.py status
```

This separately downloads pinned user-local aarch64 Bambu Studio/GNOME/Ubuntu
runtime components. It may fail if upstream packages become unavailable. No drivers
or global security policies are changed. The adapter's observed fallback uses kernel
seccomp to allow AF_UNIX only, with no-new-privileges, and a private Xvfb display.
It is **not** a complete filesystem sandbox. Select either reviewed H2C or A1 mini
0.4 mm/PLA preset explicitly; capability remains unavailable until real probes pass.
Check a current printed-part slice and inspect `REVIEW-REQUIRED.3mf` before any
separate printer action. No upload or start-print API is provided. The separate
optional LAN status operation requires an explicit certificate/serial trust check;
it does not install a persistent pairing or authorize manufacturing.

## 6. Runtime and physical acceptance

Keep all configured dependencies and sources locally, then test a new generic toy
and the restored source-car kit with networking disconnected from external services.
Do not reuse old evidence after edits. Source restoration, native CAD, model quality,
cutting a 3MF and a working physical car are independent acceptance stages. Complete
the unresolved power/fastener/fit/wiring/physical tests before treating a build
package as a finished toy. Never infer physical PASS from this installation guide.
