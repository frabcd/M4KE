# Sound-car v1: candidate portable power, wiring and fastener plan

Revision 2026-09-27. **SOURCE-REVIEWED CANDIDATE; NOT PHYSICALLY VALIDATED OR
RELEASED FOR ENERGIZATION.** This fills in exact proposed components and wiring,
not a false claim that the current 20-part CAD already contains them. No purchase,
flash, print or powered test has been performed by this document.

The generated `KIT-HARDWARE-REFERENCE.json` binds this proposal to the actual design
hash. It retains the selected #1098 motors/#1420 wheels and the current 4.8 V
screening assumption. The candidate below introduces a **regulated 5 V motor
rail**, so applying it requires an explicit design/physics/mass/layout revision;
it does not overwrite the current calculation or silently upgrade an old job.

## 1. Exact candidate electrical BOM

Quantities are installed units, not purchase packs. No price or availability is
promised. Source facts are separated from design choices and unknowns.

| Ref | Qty | Proposed exact component | Published facts / constraints |
|---|---:|---|---|
| BT1 | 4 cells | Panasonic **BK-3MCD/4H** | AA NiMH, each 1.2 V nominal, minimum 2000 mAh, approximately 28 g; Ø14.5×50.5 mm. The SKU packages four cells. [Panasonic](https://panasonic.jp/battery/products/BK-3MCD_4H/spec.html) |
| BH1 | 1 | Pololu **#1159** four-AA holder | Generic manufacturer; 71×65×20 mm, 6-inch 24 AWG leads. Built-in switch current rating unknown: do not rely on it as the independent cutoff. [Supplier primary listing](https://www.pololu.com/product/1159) |
| U1 | 1 | Pololu **#4085 / S13V20F5** | 2.8–22 V input, 5 V ±3% output, 8.9×12.1×5.6 mm. Typical maximum output 1–2.5 A depends on voltage/cooling; the title's 2 A is not an unconditional guarantee. No reverse-polarity protection. [Pololu](https://www.pololu.com/product/4085) |
| D1-ext | 1 | Vishay **1N5817-E3/54** | Schottky, 20 V reverse rating, 1 A average forward rating subject to datasheet thermal/lead conditions. Logic branch only; band marks cathode. [Vishay datasheet](https://www.vishay.com/docs/88525/1n5817.pdf) |
| SW1 | 1 | NKK **MN12SS1W01** | Mechanical SPDT ON-ON, solder lugs, Ø6.5 mm panel hole; 4 A at 30 VDC **resistive** rating. Terminal 2 COM, selected output 3, terminal 1 insulated. Inrush/switch life remains untested. [NKK A52/A56](https://www.nkkswitches.com/pdf/MN_ToggleSections_DP.pdf) |
| F1 | 1 | Littelfuse **0297002.H** | MINI 2 A / 32 VDC fuse. **Provisional coordination choice**, not motor stall protection. H denotes packaging, not installed quantity. [Littelfuse](https://www.littelfuse.com/assetdocs/littelfuse-datasheet-297-mini32v?assetguid=42c9dd21-a88e-4328-8e67-2f832444faf1) |
| FH1 | 1 | Littelfuse **0FHM0001ZXJ-T** | MINI holder, 20 A / 58 VDC, 14 AWG leads; body roughly 41×15×11 mm. Its rating does not uprate BH1's thinner leads. [Manufacturer drawing](https://www.littelfuse.com/assetdocs/0fhm0001zxj-t-2d-print?assetguid=921afcbd-065f-46c9-bcf7-00546532d5da) |
| ARM | 1 | Omron **B3F-1002-G** | Gold-contact SPST-NO; rated 0.1–50 mA at 3–24 VDC. Use a pair that is open until pressed, not two permanently connected legs. [Omron pp.2–4](https://components.omron.com/us-en/system/files/2023-01/datasheet_pdf/A070-E1.pdf) |
| STOP | 1 | Omron **D2F-01L-D3** | Gold SPDT hinge-lever switch with solder terminals; use **COM–NC**. Rated 0.1 A at 30 VDC; minimum-load reference 1 mA at 5 VDC. Exact 3.3 V microload reliability still needs confirmation. [Omron](https://components.omron.com/sites/default/files/datasheet_pdf/B036-E1.pdf) |
| R-ARM | 1 | Adafruit **#2784** | 10 kΩ, 5%, ¼ W; external ARM pull-up to 3.3 V. [Primary listing](https://www.adafruit.com/product/2784) |
| R-STOP | 1 | Adafruit **#2782** | 2.2 kΩ, 5%, ¼ W; external STOP pull-up to 3.3 V. [Primary listing](https://www.adafruit.com/product/2782) |

Exact wire/connector/insulation/strain-relief SKUs and lengths remain unresolved;
do not use loose Dupont leads or solderless breadboard contacts as an implicitly
approved motor-power harness. The 14→24 AWG transition needs an appropriate
insulated termination. A holder, fuse and mechanical switch also need protected,
accessible placement; a 71×65 mm rectangle is not a proof that the battery fits
the existing populated chassis. Cells alone add about 112 g; total car mass is
still unknown. No battery enclosure, charger or BMS is provided.

## 2. Proposed power topology

```text
4 matched AA NiMH cells in BH1, SERIES
BH1 + -> FH1 containing F1 -> SW1 COM(2) -> SW1(3) -> U1 VIN
BH1 - -------------------------------------------------> common GND

U1 VOUT (regulated 5 V) ----+----> DRV8833 VIN
                           +----> D1-ext ANODE --|>|-- CATHODE/band -> Pico VSYS(39)

USB VBUS -> Pico onboard Schottky D1 -> Pico VSYS  [existing board circuit]

Pico 3V3(OUT)(36) -> MAX4466 VCC and control pull-up resistors
Pico AGND(33) -> MAX4466 GND; common GND also connects Pico(38), U1 and driver
```

Place F1 near the battery positive terminal before SW1; protect the short unfused
lead. SW1's unused terminal 1 must be insulated. Identify actual COM/NC/NO and
switch terminal functions with an **unpowered continuity test**; do not guess from
a top-view versus bottom-view drawing.

The external Schottky ORing arrangement follows [Pico datasheet §4.5](https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf).
Do **not** bypass the diode, tie external power to VBUS, short VBUS to VSYS, or
connect raw battery/motor power to 3V3. With USB plugged in, SW1 OFF can leave Pico
alive; verify that the motor rail is not parasitically powered through signals.
SW1 is not a certified emergency stop. The software STOP loop only senses a
contact and does not physically interrupt motor current.

Use a short star-style power return near the regulator/driver, with separate
motor-current and microphone/Pico branches. Netlist equality means electrical
connection, **not** routing motor current through ADC ground or a breadboard.

## 3. Signal mapping for the original Pico R3 RP2040

Physical numbers below use the official Pico pinout; `GPxx` in firmware is a GPIO
identifier, not that physical number. This is **not** a Pico 2/W/H geometry claim.

| Physical pin | Signal | Destination |
|---:|---|---|
| 4 | GP2 | Pololu #2130 AIN1 |
| 5 | GP3 | AIN2 |
| 6 | GP4 | BIN1 |
| 7 | GP5 | BIN2 |
| 9 | GP6 | SLP / nSLEEP |
| 10 | GP7 | FLT / nFAULT; internal 3.3 V pull-up in firmware |
| 19 | GP14 | ARM NO contact to GND, 10 kΩ pull-up to 3.3 V |
| 20 | GP15 | STOP NC contact to GND, 2.2 kΩ pull-up to 3.3 V |
| 31 | GP26 / ADC0 | MAX4466 OUT, never 5 V |
| 33 | AGND | MAX4466 GND; part of common return |
| 36 | 3V3(OUT) | MAX4466 VCC, R-ARM/R-STOP high ends |
| 38 | GND | Common logic/power reference |
| 39 | VSYS | External diode cathode/band, not raw battery |
| 40 | VBUS | Leave external wiring unconnected; USB board circuit unchanged |

Driver AOUT1/AOUT2 go to the left motor and BOUT1/BOUT2 to the right. Wire direction
labels do not prove forward rotation; inspect with wheels raised and change
polarity only with motor power removed. Leave driver VMM unconnected. Carrier
inputs have pull-downs, SLP is normally high, FLT is open-drain; firmware drives
SLP low before configuring PWM. Hardware boot/reset behavior remains to be tested.
[Exact carrier source](https://www.pololu.com/product/2130)

The two external pull-ups nominally pass 0.33 mA and 1.5 mA when contacts close;
their nominal dissipation is 1.09 mW and 4.95 mW. These are Ohm's-law calculations,
not switch reliability tests. Firmware internal pull-ups remain enabled as well.

## 4. Power screening, not a power PASS

- Four series 1.2 V / 2000 mAh cells give **4.8 V nominal / 2000 mAh**, not 8000 mAh.
  Maximum charged voltage and usable discharge limit have not been established
  from this cell's manufacturer data. Regulator undervoltage protection is not
  NiMH per-cell protection. Remove depleted cells and use a compatible external
  charger; do not charge inside this unvalidated car.
- U1's nominal output interval is **4.85–5.15 V**. Do not replace maximum battery
  voltage with 4.8 V in a compatibility check. Maximum output transients also
  require measurement.
- Source #1098 theoretical stall current is 0.36 A at 6 V. A linear resistance
  approximation at 5 V gives **0.30 A per motor / 0.60 A for both**; this is not a
  recommended operating current or measured startup pulse. [Motor source](https://www.pololu.com/product/1098)
- Add an **assumed**, not measured, 150 mA logic allowance: nominal output budget
  0.75 A / 3.75 W. At assumed 85% efficiency and nominal 4.8 V battery voltage,
  input is approximately **0.919 A**. Cold cells, sag, transients, winding variation,
  logic demand and thermal conditions can invalidate that calculation.
- The provisional 2 A fuse will not protect 0.3 A-stalled motors. Fuse time/current
  curve, pack fault current, the weakest wire/contact and regulator startup must
  be coordinated. Do not deliberately stall the motors to obtain a torque point.
- No runtime estimate is approved. Nominal motor-voltage arithmetic is also not
  the default firmware's 20% PWM operating point or proof of 0.5 m/s.

## 5. Existing mount fastener candidates

There are 14 existing mounting locations. Power/control mounts are additional.

| Mount | Qty | Candidate | Nominal unfastened grip |
|---|---:|---|---:|
| Two #1086 brackets | 4 | Included **#2-56 × 7/16 inch**, with included nuts | Actual bracket/captured-nut stack must be inspected |
| Pico R3 | 4 | Accu **SSC-M2-16-A2**, M2×16 | 4 + 6 + 1 = 11 mm |
| MAX4466 | 2 | Same M2×16 | 4 + 6 + 1.6 = 11.6 mm |
| Driver rails | 2 | Same M2×16 | 4 + 6 = 10 mm |
| Caster | 2 | Accu **SSC-M2-20-A2-BL**, M2×20 | 4 + 10.930975 + 1.524 = 16.454975 mm at default kit |

Bracket supplier includes four **7/16-inch** screws, not 1/4-inch; do not mix their
#2-56 thread with M2. [Pololu #1086](https://www.pololu.com/product/1086)
Proposed metric hardware: ten [HPN-M2-A2 nuts](https://www.accu.co.uk/hexagon-nuts/7884-HPN-M2-A2)
(1.6 mm high), twenty [HPW-M2-V1-PK PEEK washers](https://www.accu.co.uk/metric-flat-washers/404101-HPW-M2-V1-PK)
(0.3 mm thick, 5 mm OD), eight [M2×16 screws](https://www.accu.co.uk/metric-cap-head-screws/2774-SSC-M2-16-A2)
and two [M2×20 screws](https://www.accu.co.uk/metric-cap-head-screws/151771-SSC-M2-20-A2-BL).
Both screws have nominal 3.8 mm head diameter, 2 mm head height and 1.5 mm hex drive.

The nominal tip protrusion after one nut/two washers is 2.8 mm for Pico, 2.2 mm for
microphone, 3.8 mm for rails and about 1.345 mm for caster. **This is not a fit PASS.**
Washer/copper keepout, 4 mm nut-tool access, head collisions, protruding tips,
actual screw length tolerance and print compression are not checked by the
current assembly CAD. Washer insulation alone cannot guarantee no copper contact.
No torque is invented for printed parts. Caster source dimensions, including
13.462 mm native hole spacing, are not a measured tolerance.

## 6. Release/acceptance record — all physical results initially UNKNOWN

### Bounded next-layout proposal, not released CAD

For the **180×100 mm default only**, current chassis bounds are X[-90,90],
Y[-50,50], Z[21,25] mm. Existing above-deck electronics stop at X=-6.15 mm.
The following are engineering-proposed positions using published package extents,
not manufacturer mounting coordinates or actual placed parts:

| Envelope | Proposed center XYZ mm | Bounds XYZ mm |
|---|---|---|
| #1159 holder 71×65×20 | [45,0,39] | [9.5,80.5], [-32.5,32.5], [29,49] |
| #4085 regulator, rotated plan 12.1×8.9×5.6 | [20,-41,31.8] | [13.95,26.05], [-45.45,-36.55], [29,34.6] |
| Fuse-holder approximate body 41×15×11 | [54,41.5,34.5] | [33.5,74.5], [34,49], [29,40] |

Those body envelopes do not intersect existing body AABBs, but this is **not a
complete fit check**: the fuse holder has only 1 mm edge margin and its long stiff
leads need an added bend/retention volume. The holder bottom is nominally only
0.755 mm above proposed caster-fastener tips; print/washer/bolt tolerances can
consume this. Design a removable insulated support/retention structure rather
than resting a battery on exposed fasteners. The battery cover must remain
serviceable and straps must not block controls.

NKK SW1's source establishes a Ø6.5 mm panel hole, 8.9 mm threaded bushing and
10.5 mm bat lever; full body/terminal orientation on drawing A61 must be reconciled
before adding a source-derived envelope. Do not treat these three dimensions as
the complete switch size. Its panel and touch clearance, ARM/STOP support board,
diode/resistors, cable insulation, connector keepouts and enclosure are still
unplaced. Moving 112 g of cells toward the front caster changes driven-axle load;
the previous assumed 65% traction load fraction cannot be retained as measured.

### Physical acceptance sequence

1. Finish battery/control/connector enclosure and mounts; rerun exact CAD clearance,
   full print review and mass/traction/beam screening with the chosen power revision.
2. Unpowered: verify polarized wiring, fuse location, contact continuity, insulation,
   correct pin numbering, screw stacks and accessible independent cutoff.
3. Motor output disabled: measure loaded 5 V/VSYS/3.3 V rails, microphone bias and
   current; verify USB-only, battery-only and both-source states do not backfeed.
4. Wheels raised, restrained and with suitable current-limited commissioning:
   verify boot/held-ARM, STOP/wire break, fault/reset, forward direction and the
   commissioning 2-second cap. Keep the independent power switch reachable.
5. Explicitly choose the continuous profile only after the commissioning review.
   Measure quiet-stop latency/distance, speed, running current/temperature and
   motor-self-noise negative control on a bounded clear floor. A quiet command
   removes drive and **coasts**, not instantaneous braking.
6. Log actual results, dates and firmware/design hashes. Failed observations stay
   failed; analytical or mocked PASS does not substitute for these measurements.

Reference firmware profiles and upload procedure: `firmware/sound-car/README.md`.
No toy-safety certification or unsupervised/child-use claim is made.
