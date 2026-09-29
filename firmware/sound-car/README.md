# Sound-threshold car firmware — hardware reference, not physically validated

**Status: source code and synthetic logic tests only. Not flashed, wired, purchased or tested on a car.** The default `MOTOR_OUTPUT_ENABLED = False` deliberately prevents motor drive. A generated package is not permission to energize hardware.

**Hardware binding:** For the explicit `sound-car-v1` kit, use the job-generated `KIT-HARDWARE-REFERENCE.json` and its design hash: it selects **Pololu #1098 50:1 LP 6V motors and #1420 60 mm wheels**, with source-matched #1086 brackets and #950 caster. `components/car-reference.json` preserves earlier module/wiring research using #992; it is **not this kit's BOM or motor selection**. This common wiring guide does not override the job-specific hardware reference.

## Behavior and boundaries

- Desired final behavior: move forward while sound exceeds an adjustable relative threshold; stop driving at/below it. This is not speech recognition or calibrated sound-pressure level.
- `controller.py` calculates AC RMS after removing each window's DC mean, relative to the ADC half-range. Threshold units are relative **dBFS**, not dB SPL; browser-microphone values will not numerically match this sensor without separate characterization.
- Firmware boots **disarmed**. ARM must be released and then pressed. A held button at startup does not arm. Stop, driver fault, invalid readings, stale sampling and bench timeout require rearming.
- Output zero plus driver sleep means **coast**, not active braking or an instantaneous physical stop. Measure stopping distance with the real car. This software is not a certified emergency-stop system.
- Two explicit profiles exist (table below). The default commissioning profile has a 2-second cap and latches disarmed. The separately reviewed continuous profile has no artificial run-time cap: loud requests drive, quiet removes drive, and STOP/fault/stale observations still disarm. Neither profile is hardware acceptance evidence.
- Rail/DC rejection catches some invalid ADC windows, but **does not reliably detect a disconnected microphone**. Floating ADC input can look like sound. Motor self-noise can maintain motion after the external sound stops. Both are unresolved physical failure modes.

## Explicit behavior profiles

| Setting | Default commissioning | Intended continuous-while-loud |
|---|---|---|
| `BEHAVIOR_PROFILE` | `'commissioning'` | `'continuous_while_loud'` |
| `CONTINUOUS_PROFILE_REVIEWED` | `False` | Must explicitly be `True` |
| `MAX_CONTINUOUS_MS` | `2000` (allowed 100–10000) | Must explicitly be `0` |
| `PWM_DUTY` | `0.20`, allowed >0 and ≤0.5 | Explicitly reviewed >0 and ≤1; **not** automatically 1 |
| `MOTOR_OUTPUT_ENABLED` | `False` | Remains `False` until separate operator commissioning decision |
| ARM / STOP / fault / stale | Enforced | Enforced identically |

The review flag is an operator acknowledgement, **not a stored physical PASS**.
Changing only the profile name is rejected. Both profiles boot disarmed; ordinary
quiet removes drive without disarming, so later loud sound can request drive while
still armed. STOP, fault, invalid/stale windows and commissioning timeout require
release then press of ARM again. Default settings stay conservative.

A continuous-profile test must include motor self-noise: loud audio starts motion,
external audio stops, and the actual car must stop requesting drive despite its
own motor noise. Synthetic tests cannot prove this. Software coast and a watchdog
are not a physical emergency stop.

## Hardware target and source-backed wiring

The common wiring target is the original non-wireless **Raspberry Pi Pico/Pico H RP2040** using MicroPython, **Adafruit MAX4466 #1063**, and **Pololu DRV8833 carrier #2130**. The source kit binds the exact **Pico R3 without headers** and two **Pololu #1098 LP 6V gearmotors**; the legacy module reference's #992 candidate must not be silently substituted. Alternatives require review; no custom PCB has been designed.

**Operating-point gap:** The default bench configuration is `PWM_DUTY = 0.20`, output disabled, with a 2-second run cap. `validate_profile` restricts commissioning duty to at most 0.5; the intended continuous profile accepts a reviewed duty up to 1 but never raises it automatically. The kit's nominal-voltage motor calculation is **not** this PWM operating point and does not prove the requested 0.5 m/s or unlimited while-loud motion. Do not increase duty, remove caps or enable outputs merely because an analytical check passes. This requires a separately reviewed and physically tested commissioning/release step.

The job hardware reference now includes an exact **candidate** portable power BOM/netlist and nominal fastener stacks. Read `docs/car-power-and-wiring.md`: matched AA NiMH cells, regulated 5 V, a Schottky-isolated Pico VSYS branch, fuse, mechanical disconnect and exact ARM/STOP candidates. These are **not placed in the current CAD**, not an approved harness, and not a validated power system. MAX4466 geometry remains only a source-derived PCB outline.

Names below are **GP identifiers, NOT physical header pin numbers**. Check the actual board silkscreen and official [Pico pinout](https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html#board-layouts) before wiring. The Pico ADC accepts 0–3.3V and `ADC(Pin(26))` addresses ADC0. [MicroPython RP2 reference](https://docs.micropython.org/en/latest/rp2/quickref.html)

| Pico signal | Connect to | Reason |
|---|---|---|
| `3V3(OUT)` | MAX4466 `VCC` | Sensor domain stays 3.3V; NOT 5V |
| GND | Sensor GND, driver GND, motor-supply negative | Common signal reference, with proper motor-current return routing |
| `GP26` | MAX4466 `OUT` | Analog microphone sample |
| `GP2` | Driver `AIN1` | Motor A input 1 |
| `GP3` | Driver `AIN2` | Motor A input 2 |
| `GP4` | Driver `BIN1` | Motor B input 1 |
| `GP5` | Driver `BIN2` | Motor B input 2 |
| `GP6` | Driver `SLP` | Active-low sleep; firmware drives low while stopped |
| `GP7` | Driver `FLT` | Active-low fault; firmware enables a 3.3V input pull-up |
| `GP14` | Normally-open ARM button to GND | Press reads low; released reads high |
| `GP15` | Normally-closed STOP sensing contact to GND | Opening the loop or breaking its wire requests stop |

Driver `AOUT1/AOUT2` connect only to motor A; `BOUT1/BOUT2` only to motor B. Driver `VIN` takes the **reviewed motor supply through a suitable fuse and accessible physical disconnect** (the portable candidate uses a regulated 5 V rail). Its `VMM` is **left unconnected** in this reference. Never connect motor VIN directly to Pico 3V3, VSYS or VBUS. Power Pico through USB for initial bench work; the proposed portable logic path separately passes regulated 5 V through a correctly oriented external Schottky diode into VSYS. Do not bypass USB power ORing. Do not return motor current through the microphone/Pico breadboard rails. Driver labels and behavior are verified against the [exact Pololu carrier](https://www.pololu.com/product/2130).

The microphone module permits a wider supply, but its analog output can approach that supply. We choose **3.3V** to match the ADC. Its midpoint bias is removed in software. [Adafruit #1063](https://www.adafruit.com/product/1063)

The STOP sense loop is software-supervised; it is not independently power-cutting. The motor-power disconnect must physically interrupt motor power independently of this firmware. Select its DC current/voltage rating, fuse and wire size against the actual pack and motors before use. No battery charger or lithium cell protection design is included.

## Before uploading

1. Keep motor power physically disconnected. Verify exact component variants, polarity and wiring with power off; measure component interfaces before using printed mounts.
2. Obtain the correct official MicroPython UF2 for the exact Pico model yourself and follow the [official MicroPython setup instructions](https://docs.micropython.org/en/latest/rp2/quickref.html). This task did not download/flash any board firmware.
3. Copy `controller.py`, `config.py` and `main.py` to the Pico filesystem using an appropriate MicroPython editor/tool, initially leaving the commissioning lock false. Copying `main.py` makes it run on boot, still disarmed and output-disabled.
4. With motor power absent, observe console values, test ARM release/press, open the STOP loop and inspect logic outputs. Confirm the actual reading range and sensor bias. **No physical result is prefilled.**
5. Review the exact portable candidate in `docs/car-power-and-wiring.md` or supply a separately verified alternative. Its dimensions/rated components do not establish startup/thermal/fuse coordination or fit. Check maximum battery voltage/current, regulator and motor/driver limits, fuse and switch. The candidate regulated 5 V rail is a future design revision, not the current kit's assumed 4.8 V rail. Do not infer usable torque from stall torque. For the source kit, read actual selected ratings in the job's `KIT-HARDWARE-REFERENCE.json`; `components/car-reference.json` is only the legacy module reference.
6. Secure the car with wheels raised and nobody near moving parts; use a current-limited bench arrangement where available. Only after inspection, change `MOTOR_OUTPUT_ENABLED=True`, review duty/threshold, and cycle power. It still requires ARM release then press. Disconnect motor power before changing motor polarity or wiring.

## Hardware acceptance checklist — all initially UNKNOWN

Record date, exact firmware/config hashes, measured components, supply voltage and each result. Keep failed results.

| Test | Observe before passing |
|---|---|
| Boot/held ARM | No drive at boot, even with ARM held; release then press is required |
| Forward direction | Both wheels propel forward at the chosen polarities; no inferred direction from pin labels |
| Quiet/loud/quiet | Sound starts drive only above threshold; removing sound ends drive and measured coast distance meets the chosen bound |
| Equality/staleness | Synthetic software cases pass; physical latency measured separately, not assumed to equal Python timing |
| STOP/wire break | Opening STOP sense disables drive; separate power switch independently removes motor power |
| Driver fault/reset | No automatic restart after fault/reset; rearm required |
| Motor self-noise negative control | After initiating motion, remove external sound; motor noise alone must not keep the system running |
| Microphone fault | Characterize unplugged/shorted wiring with motors disabled; do not rely on ADC silence as a disconnect detector |
| Thermal/current | Verify running current and temperature under expected load; do NOT intentionally stall this gearmotor to derive torque |
| Bench cap | Continuous noise triggers the explicit run-time cutoff; no automatic rearm |

After bench acceptance, test in a bounded clear floor area, not near stairs/people/pets. Age suitability, small parts, entanglement, battery enclosure and final safety remain unresolved. No child-use certification is implied.

## Tests and watchdog

From the workspace:

```powershell
python -m unittest discover -s firmware/sound-car -p 'test_*.py' -v
```

The portable tests cover low/high/equality, invalid/stale readings, disarm/stop, startup ARM handling, fault rearm, synthetic RMS and invalid ADC windows. Mocked adapter tests additionally exercise the commissioning lock, held ARM at boot, an open STOP loop, exception cleanup after mock drive, the bench run-cap latch, continuous drive beyond that cap, and quiet/STOP/fault/stale removal of drive in the continuous profile. Invalid profiles fail before PWM creation. CPython syntax checking and mocks are not on-device proof.

`main.py` feeds a 500ms watchdog only after a successful sample/check/output cycle. A stalled interpreter may therefore leave drive active until reset; that delay is not a guaranteed stop time. Unexpected exceptions attempt to disable driver sleep/PWM. Watchdog reset returns to the disarmed boot path. Once started, MicroPython's WDT cannot be stopped; debugging pauses may reset the board. [MicroPython WDT documentation](https://docs.micropython.org/en/latest/library/machine.WDT.html)
