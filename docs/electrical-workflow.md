# Qwen electrical design: one netlist, matching outputs

M4KE is a general small-toy studio. The sound-controlled car is an acceptance
benchmark, not a hardcoded replacement for arbitrary requests. This document
describes implemented software interfaces; it does not certify a working car.

## Runtime sequence and ownership

1. Qwen's design skill produces a bounded design specification, component choices,
   assumptions, mechanical parts and (when electronics are needed) `electrical`.
2. A separate local Qwen stage loads `runtime-plan.md` and selects supported host
   checks. It may add envelope, shaft/hole and sampled rotation requests, but may
   not delete existing checks, weaken requirements, edit geometry or return results.
   Unsupported requirements are recorded as uncovered.
3. Host tools validate the design, build native CAD and compute supported physics
   and electrical checks. Only actual tool observations establish check status.
4. Qwen receives failed checks and may propose a bounded repair under the existing
   revision/identity rules. It cannot turn its prose into PASS evidence. A CAD
   timeout first receives one infrastructure retry of the same input; an elapsed
   time problem is not automatically a geometry instruction.
5. The final job binds CAD, netlist, diagram, connection table, firmware configuration,
   BOM and build instructions to the same design hash. The user builds and reports
   physical observations later; software cannot invent them.

Coops 1 and 2 supplied design/verification skills and now prepare the video.
Coop 3's completed source-library handoff is read-only. The studio developer owns
integration, not a manually substituted benchmark car. Procurement, assembly,
commissioning, printing and final public submission remain human decisions.

## Design and job contracts

The optional `electrical` design block contains:

- `schemaVersion: 1`;
- `components`: references to existing design `partId`s and supported electrical
  `profileId`s, plus optional component-local `terminalAnchors` in millimetres;
- `connections`: unique IDs, `from`/`to` pairs `{partId, terminal}`, purpose
  (`signal`, `power`, `ground`, `motor`), display colour, proposed `wireAwg` and
  optional world-space routing waypoints;
- optional `control`: supported controller/microphone/driver/motor/arming/stop
  roles, loudness threshold, polarity and bounded commissioning duty.

The host rejects malformed references and duplicates. Profiles expose supported
terminal names and component identity; a familiar-looking rectangular PCB does
not establish either. Source/catalog identity and non-catalog assumptions remain
different states. The currently supported firmware-binding profile is
`pico-max4466-drv8833-sound-v1`; other electrical concepts must not be advertised
as having generated matching firmware merely because a generic file exists.

`job.electrical` contains the exact `designHash`, scoped claims, resolved components
and connections, firmware status and artifact paths. Resolved wire endpoints and
`polylineMm` use the same part transforms as the 3D assembly. Terminal coordinates
supplied by the model are labelled `MODEL_ASSUMED`. Missing anchors produce
`MISSING_ANCHORS`, not an invented line to the centre of the component.

Electrical summary statuses are `NOT_APPLICABLE`, `UNVERIFIED` or `FAIL`.
An internally consistent netlist can remain `UNVERIFIED`: physical pin identity,
cable current ratings, grounding, thermal operation and real hardware behavior
have not thereby been established.

## What the user sees and downloads

Design, Build and Export show one connection table and a labelled, same-origin SVG
from the current job. Selecting a table row or rendered 3D wire highlights both
endpoint parts and shows their terminal labels. The wire overlay is hidden while
geometry is unavailable or exploded; returning to the assembled view restores
the correct coordinates. Wire thickness is a display aid, not cable-diameter
measurement. Missing or stale job evidence never receives decorative replacement
wires, diagrams or automatic firmware.

The generated job package contains:

| Artifact | Purpose |
|---|---|
| `electrical/netlist.json` | Canonical netlist, design identity, checks and firmware binding |
| `electrical/wiring.svg` | Labelled terminal-to-terminal diagram; not a PCB layout |
| `electrical/connections.csv` | Exact connection list for inspection and assembly |
| `electrical/README.md` | Connection order, evidence limits and commissioning prerequisites |
| `firmware/config.py` | Pins/settings derived from the supported netlist, if admitted |
| `firmware/main.py`, `firmware/controller.py`, `firmware/README.md` | Matching supported controller runtime and instructions, if admitted |

The UI accepts only the exact known per-job relative artifact paths. SVG is loaded
as an image, never injected as raw application markup. Wires and purchased
electronics do not become printable STL objects. Manufacturer geometry and the
separately owned model database retain their original identities and licences.

## Firmware, wiring and physical test boundaries

- `GENERATED_OUTPUT_DISABLED` is a netlist-bound candidate, not a commissioned
  controller. `MOTOR_OUTPUT_ENABLED=False` remains the default. Missing required
  roles, identity or electrical prerequisites may instead yield `BLOCKED`.
- The default commissioning behavior is bounded. Continuous movement while loud
  requires the documented explicit profile/configuration and later hardware tests;
  a short commissioning burst must not be filmed as proof of continuous control.
- For a positive requested speed, the critical `electrical-drive-settings` check
  remains **UNKNOWN**. It records the exported duty, disabled motor output and
  2-second commissioning cap. A conditional full-rail torque/speed calculation
  does not establish the speed of this exported PWM configuration. The software
  does not derive a physical PASS or FAIL merely by multiplying speed by duty.
- Selecting `continuous_while_loud` requires explicit review and a zero run cap;
  **it does not automatically change `PWM_DUTY`**. The Python controller permits
  duty up to 1 in a reviewed continuous profile, but this studio's generated
  commissioning contract remains capped at 0.5. Do not silently alter the duty
  to match a calculation. Changes to PWM, supply or mode require a reviewed new
  configuration and renewed direction, noise, stopping, speed and thermal tests.
- Relative dBFS is not calibrated dB SPL. Quiet removes motor drive and coasts;
  it does not establish instantaneous braking or a measured stopping distance.
- Confirm exact physical pin labels, supply limits, polarity, isolation, fuse,
  connectors and independent motor-power cutoff with power disconnected. A stop
  input in firmware is not independent removal of motor power.
- Human commissioning must cover boot/disarm, arming, stop/fault behavior, direction,
  quiet → loud → quiet, motor self-noise, speed, current/temperature and actual fit.
  Do not claim those results before recording the real test observations.

## Software verification and the September 28 delivery gate

The dedicated electrical browser acceptance currently covers 15 mocked scenarios,
including actual 3D ray picking, direct backend-summary compatibility, same-revision
downloads, absent anchors, legacy/stale designs, exploded views and mobile layout.
It recorded no page errors or mutation requests. This is UI evidence, not Qwen,
native-car or physical acceptance. Unit/API tests separately exercise netlist
validation and firmware binding; the fresh Qwen workflow has its own receipt.

A retained failed CAD input completed in **136.5 s instead of 365.9 s** after
scoped native caching/bounding optimization, preserving all **51 check observations**.
The assembly-overlap and sampled-rotation failures remained failures. This one
same-input replay proves neither general inference speed nor a working car.

The team target is a frozen software handoff by **September 28, 13:20 China time**.
Actual fresh-Qwen car acceptance, final source clean-install validation, purchased
hardware arrival and physical recording remain separately reported gates. A demo
must distinguish a historical kit, a fresh Qwen result and a real physical test.
