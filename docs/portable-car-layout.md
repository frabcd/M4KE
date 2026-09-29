# Portable sound-car geometry candidate — separate regulated-5-V revision

Status: **CAD candidate, not a physical build release**. It does not replace
`sound-car-v1`, the current DGX production kit, or an already released review ZIP.
No parts were bought, printed, flashed or energized by this work.

## Contract and integration

`engineering/portable-kit.mjs` exports:

```js
compilePortableKit(baseSpec, catalog) // -> { spec, revision }
partBounds(part, catalog)             // AABB only, not an exact-fit check
```

The base must be the unchanged 20-part, 180 × 100 × 4 mm source car. The compiler
checks every base part's shape, position, rotation and features against the
source-bound default kit. It never rescales a purchased part. Original part IDs
remain; only six additional mounting holes are added to the chassis. Other base
sizes or modified interfaces fail closed, rather than receiving a guessed layout.

New revision ID: `sound-car-portable-reg5-candidate-v1`. There are **48 modeled
parts, including 22 printed parts**. Purchased switch cases, leads and movement
reservations are separate collision objects, **not separate items to purchase**;
use `revision.componentGroups` to group them into six actual component assemblies.
The MAX4466 remains its explicitly limited source-derived PCB outline, not an
invented populated manufacturer model.

Host/native capacity must be 48; the generic Qwen design schema remains 24.
Do not send this whole candidate through a 24-part generic repair schema or
silently drop parts. Each assembly step is still limited to 24 IDs. Commissioning
is last and depends on installation of the power/control components. A new job
must freeze the worker, catalog helper, selected STEP sources and this revision's
spec; old job receipts cannot establish this revision's validity.

The returned `revision.nativeStatus` is initially `NOT_RUN`; attach the actual
job receipt separately. Neither a compiler return value nor a nominal analytical
PASS is a physical release.

## Layout, interfaces and source limits

All coordinates below are world millimetres; X is vehicle length, Y width, Z up.
Chassis bounds are X ±90, Y ±50, Z 21–25. Existing wheel/motor/Pico/driver/microphone
source transforms are unchanged. The battery and controls occupy the previously
unused forward section, not floating black boxes above the electronics.

| Component / feature | Proposed position and dimensions | Evidence boundary |
|---|---|---|
| Pololu #1159 with four AA cells | Holder bounds X 2.5–73.5, Y ±32.5, Z 33–53; 71 × 65 × 20 package | Published package dimensions; switch/lead locations and cover access still require the actual holder |
| Printed battery tray | 82 × 76 × 12, centre (38,0,31); 72 × 66 seat, Z33; underside relief to Z31 | Nominal 0.5 mm side clearance, not a manufacturing tolerance guarantee |
| Rear retaining crossbar | 22 × 76 × 20, centre (18.5,0,47) | Captures the package at Z53; removable, not a permanent cell enclosure |
| Front retention/control bridge | 22 × 76 × 48, centre (57.5,0,61) | Lower retention rung Z53–57; upper control deck Z81–85; stiffness/handling not validated |
| Fuse-holder body | 15 × 41 × 11, centre (18.5,0,64.5) | Approximate Littelfuse body only; free leads are not exact source solids |
| Regulator module | 12.1 × 8.9 × 5.6, centre (57.5,-22,62.8) | Published Pololu #4085 package, not exact populated STEP |
| NKK power disconnect | Body 13 × 7.9 × 9.4, front plane Z78; terminal envelope Z64.1–68.6 | Official drawing reviewed; neutral lever and terminal keepouts, not a moving contact model |
| ARM | B3F maximum XY case 6.2 × 6.2; base Z87; lead pattern 6.5 × 4.5 | Four independent lead reservations; final actual lead bending/soldering unverified |
| NC STOP | D2F body 12.8 × 5.8 × 6.5, base Z91; 6.5 mm-spaced side holes | Left oblong hole conservatively drawn as its inscribed 2 mm circle; lever travel is a reserved envelope |
| Harness channel | X 0–70, Y40–48, Z25–35; interior Y42–46 above Z27 | Proposed 4 mm bundle reservation; not proof that an unspecified harness fits |

The holder dimensions are from [Pololu #1159](https://www.pololu.com/product/1159),
and regulator package dimensions from [Pololu #4085](https://www.pololu.com/product/4085).
The fuse body uses the [Littelfuse holder drawing](https://www.littelfuse.com/assetdocs/0fhm0001zxj-t-2d-print?assetguid=921afcbd-065f-46c9-bcf7-00546532d5da).

### NKK panel and terminal stack

The reviewed MN12SS1W01 drawing gives a 13 × 7.9 mm case, 9.4 mm rear case depth,
three terminals at 4.7 mm pitch, 4.5 mm terminal projection, 1/4-40 bushing with
8.9 mm projection and a 10.5 mm lever. The indicated 25° is **total throw**, not
±25°. Standard mounting hardware permits at most **2.6 mm panel thickness**.
The new bridge therefore recesses its 4 mm deck by 1.6 mm, leaving a **2.4 mm seat**,
with a Ø6.5 main hole and Ø2.2 antirotation hole 6.1 mm away. This is not a switch
mounted through an invalid 4 mm panel. The official PDF was visually inspected
on A57/A58/A61. [NKK M-series drawing](https://www.nkkswitches.com.cn/pdf/toggle_M.pdf)

A 3 mm backside allowance is **assumed** for nut/lock-ring hardware; exact included
nut/washer dimensions and tool access still require source confirmation or a
physical fit check. The terminal cup protects a reserved solder volume and has
three Ø4 lead exits, but does not prove creepage, insulation, soldering clearance
or strain relief. The neutral lever cylinder is not full moving geometry.

### ARM / STOP supports

The B3F support has a 6.6 × 6.6 mm case pocket, four Ø1.8 lead passage holes and a
removable plunger-access lid. These passage holes are printed clearances, not the
manufacturer's PCB drill sizes. Its lead envelopes are expanded to respect the
kernel's minimum primitive dimensions; they must not be presented as exact leads.
[Omron B3F drawing](https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf)

The D2F is side-mounted using its body holes, rather than glue or guessed bottom
holes. A terminal-floor gap and an unobstructed lever keepout are included. The
source's maximum free position and operating-position range are not a guaranteed
switch actuation setting. Use COM–NC and verify the chosen contact pair electrically;
3.3 V low-current contact reliability remains unresolved.
[Omron D2F drawing](https://omronfs.omron.com/en_US/ecb/products/pdf/en-d2f.pdf)

## Power and firmware are different from the old screening assumptions

Use `docs/car-power-and-wiring.md` for the proposed electrical architecture:
four matched NiMH AA cells → provisional fuse → independent NKK cutoff →
Pololu S13V20F5 regulator → motor driver and separately isolated Pico VSYS feed.
The existing exact Pico/DRV8833/MAX4466 netlist and firmware pin mapping remain.
USB VBUS is not an external supply input; no improvised lithium charging is added.

This revision's `physicsInputs.batteryVoltage` is explicitly the **nominal 5 V
motor rail**, despite the legacy field name. Raw battery nominal voltage remains
4.8 V; four series 2000 mAh cells do not become 8000 mAh. Old raw-battery current,
maximum voltage and runtime inputs are removed instead of being mixed across
voltage domains. Regulator efficiency, pack droop and startup peaks are not measured.

Firmware still boots with motor outputs disabled and the commissioning profile
at 20% PWM. The full-rail analytical speed below does **not** predict that default
commissioning speed. Continuous-while-loud mode requires its explicit reviewed
profile; quiet removes drive and coasts. It does not guarantee instantaneous
braking, fail-safe acoustic sensing, or immunity to the car's own motor noise.

## Conditional mass, axle loads and operating point

The declared scenario is **298.6–550.8 g**, not a measured or guaranteed bound.
It includes manufacturer typical cell/motor/wheel masses with labelled planning
allowances, assumed ranges for electronics/holder/harness/fasteners, and a printed
polymer density of 1.15–1.30 g/cm³ with 50–100% material occupancy. Rectangular
pocket unions are subtracted; holes and fillets are not, giving a conservative
geometric volume estimate but not a slicer mass. The lower occupancy is merely a
scenario. Replace these values with the chosen material, slicer results and scale.

Printed-part centre positions conservatively span their X bounds; mass intervals
and position intervals are independent. This intentionally broad interval gives
CG X **-18.31 to 52.67 mm**, rear driven axle X-50, caster X72, and static driven
weight fraction **15.84–74.02%**. It is not a lateral/tipping/dynamic stability model.

At the upper mass, level floor, assumed Crr0.03, acceleration0.5 m/s², friction0.6,
60 mm wheels, two source #1098 motors, 5 V rail and 0.9 downstream efficiency:

- Required force ≈0.4374 N; per-motor output torque ≈0.00729 N·m.
- Nominal linear torque-speed screen predicts ≈179.38 RPM / **0.5635 m/s**.
- Conservative interval traction screen leaves ≈0.0760 N margin.
- An explicitly **assumed** 20% lower no-load motor speed predicts ≈**0.4508 m/s**,
  failing the requested 0.5 m/s. This is a sensitivity case, not a sourced tolerance.
- Host negative cases also reject 1 m/s, 1 kg or friction0.2 in their relevant checks.

Thus nominal arithmetic passes only its declared conditions; **robust 0.5 m/s is
not established**. Motor variability, actual wheel radius, voltage/PWM losses,
continuous heating, gearbox losses and floor grip need measurements. The existing
simple beam calculation cannot qualify the new tall control bridge or perforated
tray. Printed modulus/allowables and local-load/fastener analysis remain unknown.

## Fastening and remaining release gates

The old 14 mounting locations and source dimensions remain. New primary retention
uses four M2 locations at X18.5/57.5, Y±35.5. Rear grip is 36 mm (two locations),
front full-height grip is 64 mm (two locations), before nuts/washers. Approximate
40/70 mm bolts are **selection proposals, not verified supplier SKUs**. Do not use
the old short mounting screws here. The tall bridge's long-through-fastener scheme
still needs sourcing, tool-access and handling/load qualification; a later geometry
revision must not silently alter this frozen candidate.

Before a physical release:

1. Source the final fasteners/nut/washer stack and validate tool paths, engagement,
   preload, retention and bridge strength. Fastener heads/nuts are not collision solids.
2. Confirm source package tolerances, holder cover/switch/lead access, populated
   microphone/regulator keepouts and soldered terminals using real components.
3. Specify rated wire/connector/insulation/strain-relief details; verify the actual
   harness fits the reserved corridors and cannot contact wheels or exposed conductors.
4. Confirm fuse/wire/pack coordination, regulator transient/thermal capability,
   reverse-polarity strategy and low-current STOP contact behaviour.
5. Select print material/process, slice **all 22** printed parts with explicit
   orientation/support choices, print fit coupons and measure holes/clearance.
6. Weigh the assembly/axle reactions and run the recorded unpowered, wheels-raised
   and contained-floor commissioning tests. No child-toy certification is claimed.

## Verification receipts

- `node --test tests/portable-kit.test.mjs`: **11/11 PASS**.
- Initial isolated DGX kernel receipt: `test-results/portable-native-v1.json`.
  48 parts, 148.702 s; all 22 printed BRep/STEP/mesh gates PASS; exact assembly
  intersection list empty. Purchased-source serialization/topology limitations
  remain UNKNOWN, not newly hidden or promoted.
- Final frozen-spec replay: `test-results/portable-native-v2.json`, **145.520 s**,
  48 parts / 22 printed, no kernel errors, exact assembly intersection list empty.
  All 22 printed BRep, STEP round-trip and closed-mesh checks PASS. The isolated
  stage contains copied, hash-checked STEP sources rather than a live catalog link:
  `<M4KE_ROOT>/test-results/portable-frozen-caye8enc`.
- Matched native collision control: original holder/tray intersection **0 mm³**;
  shifting only the holder +2 mm in Y produces **425.0788 mm³** intersection.
  The control correctly detects this interference. No deployed job was mutated.
- Exact native nominal distances: switch case/cup **1.0 mm**, terminal-envelope/cup
  **2.4 mm**, STOP terminal-envelope/floor **0.5 mm**, wheel/chassis **1.2 mm**,
  tray/driver rail **3.15 mm**. Battery clamp and regulator seat have intended
  zero-gap contacts with zero positive intersection. These are not tolerance margins.
- Frozen design hash: `33c02e1f23365e2945a8d03e9580a304f12b0c720a4823d497ff8fd04224d9fa`.

An empty intersection list validates the modeled solids only. It cannot prove fit
of omitted nuts, solder, wires, PCB components or manufacturing variation.
