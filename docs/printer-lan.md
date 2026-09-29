# DGX-local printer connection and manufacturing handoff

The slicer and printer connection are separate capabilities. Nothing selects H2C
by default. Slicing with an H2C profile does **not** prove that a printer is online
or compatible with this connection adapter.

## Read-only LAN check in M4KE

1. On the physical printer, inspect its network settings and the manufacturer's
   instructions for your exact model/firmware. Put it on a trusted network reachable
   from the DGX. No cloud account or internet connection is used by this adapter.
2. Choose the actual printer in Export. Enter its private IPv4 address and serial
   from the printer screen. M4KE supports explicit H2C, A1, A1 mini, P1S and X1C
   choices; actual compatibility is unverified until a hardware test is recorded.
3. Inspect its certificate. This makes one TLS connection to that address on port
   8883 and sends **no access code**. Inspect the physical serial/address; compare the
   SHA-256 certificate fingerprint through an independent trusted channel where
   available. The first observation is **not manufacturer-CA authentication**.
   Trust-on-first-use cannot itself rule out interception of that first connection.
4. If you trust that device/network, explicitly confirm the fingerprint and enter
   the printer's LAN access code in the password field. Do not enter a Bambu account
   password, and do not send the code in chat. Press Read status once.
5. M4KE checks the exact certificate pin, serial CN and validity dates **before**
   sending credentials. It authenticates as `bblp`, subscribes only to
   `device/<serial>/report`, and closes after a whitelisted status or a 20-second
   timeout. A successful subscription with no report is distinct from a received
   report. The receipt is a point-in-time connection check, not a persistent online badge.
   Retained reports are labelled; report freshness is not independently established.

No discovery scan, hostname lookup, cloud fallback, background reconnect, FTP,
upload, MQTT command publication, firmware update, heating, movement, pause or print
start is implemented. Input credentials exist transiently in process/browser memory,
not in saved project state, disk files, logs, Qwen prompts or export packages. Memory
zeroization is not guaranteed by JavaScript; pairing fields clear on reload and the
code field clears when submitted. Do not expose the loopback app over public HTTP.

The status check only accepts a single private IPv4 address on fixed port 8883.
It is serialized, time-bounded and byte-bounded; wrong serial, changed/expired
certificate, authentication denial and malformed reports fail closed. It can still
temporarily consume a printer connection slot. Run it when doing so will not
interrupt another operator's monitoring session.

## Printing remains a separate deliberate action

Review each printed-part STL and exact printer/nozzle/material/plate choice. Generate
and inspect the entire `REVIEW-REQUIRED.3mf` toolpath. Purchased-component previews
are not printable substitutes. Use the printer's supported local media or a validated
local client to transfer the reviewed file, then approve the print physically.
M4KE's current LAN adapter does **not** upload or start prints.

For third-party controls, current Bambu firmware may require LAN-only Developer
Mode. Read-only monitoring and control authorization are different. M4KE neither
changes printer modes nor bypasses authorization. Do not downgrade firmware or
replace the official networking plugin just to make an unverified demo appear ready.

## Research and evidence limits — 2026-09-27

- Bambu's official documentation entry points: [LAN mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-lan-mode),
  [Developer Mode](https://wiki.bambulab.com/en/knowledge-sharing/enable-developermode),
  [Security White Paper](https://cdn1.bambulab.com/trust-center/file/bambulab-security-whitepaper-en.pdf).
  The official pages/PDF were access-blocked during this research. Their full contents
  were not treated as newly verified evidence.
- [OpenBambuAPI's author-maintained MQTT protocol notes](https://github.com/Doridian/OpenBambuAPI/blob/main/mqtt.md)
  and [TLS notes](https://github.com/Doridian/OpenBambuAPI/blob/main/tls.md) document the
  local `bblp`/LAN-code/report-topic convention and serial-number certificate identity.
  This is community protocol documentation, not a manufacturer compatibility warranty.
- [Bambu Studio PR11738](https://github.com/bambulab/BambuStudio/pull/11738) is an open
  contributor report that the proprietary networking plugin is unavailable on Linux
  ARM64. It is not proof that our DGX can connect through the stock plugin. Native
  DGX slicing has separate tested evidence and does not require that plugin.

The implementation is original bounded protocol code, not a copied replacement
networking plugin. Synthetic transport tests prove parser/credential-gating behavior,
not H2C hardware compatibility. Actual printer address, access code and a successful
on-device test are still required. No physical printer was contacted during development.
