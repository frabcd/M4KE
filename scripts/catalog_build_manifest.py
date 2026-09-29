#!/usr/bin/env python3
"""Offline source-to-catalog compilation and native STEP verification on the DGX."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cad"))
from catalog_geometry import load_catalog_component


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reconcile_interfaces(component, metadata, root):
    """Publish only explicitly identified, hash-bound native cylindrical features.

    Coordinates are source STEP points plus the recorded sourceToLocal transform.
    Published hole sizes remain distinct from source CAD dimensions/tolerances.
    """
    definitions = {
        "raspberry-pi-pico-r3": [("mounting-holes", "clearance-hole", 1.05, [0, 1, 0], [[x, -0.5, z] for x in [4.8, 16.2] for z in [-49, -2]], {"sourceBoardTopMm": 0.5, "sourceBoardBottomMm": -0.5, "sourceBoardThicknessMm": 1.0, "sourcePlaneAxis": "Y", "drawingDiameterMm": 2.1})],
        "pololu-lp6v-992": [("native-output-shaft", "shaft-axis", 1.5, [0, 0, 1], [[0, 0, 9.72], [0, 0, 19]], {"endpointMeaning": ["cylindrical shaft start", "tip"], "dFlatOrientation": "PENDING", "nominalProtrusionMm": 9})],
        "pololu-lp6v-1098": [("native-output-shaft", "shaft-axis", 1.5, [0, 0, 1], [[0, 0, 9.72], [0, 0, 19]], {"endpointMeaning": ["cylindrical shaft start", "tip"], "dFlatOrientation": "PENDING", "nominalProtrusionMm": 9})],
        "pololu-bracket-1086": [("chassis-mounting-holes", "clearance-hole", 1.15, [0, 1, 0], [[4.95, -5, -9], [4.95, -5, 9]], {"spacingMm": 18, "sourceContactPlane": {"axis": "Y", "valueMm": -5}, "sourceBarrelEndMm": -3.6, "fastener": "#2-56"})],
        "pololu-pm-motor-1086-assembly": [("chassis-mounting-holes", "clearance-hole", 1.15, [0, 1, 0], [[4.95, -5, -9], [4.95, -5, 9]], {"spacingMm": 18, "sourceContactPlane": {"axis": "Y", "valueMm": -5}, "fastener": "#2-56"}), ("native-output-shaft", "shaft-axis", 1.5, [1, 0, 0], [[9.6, 0, 0], [18.27, 0, 0]], {"endpointMeaning": ["cylindrical shaft start", "source model tip"], "dFlatOrientation": "PENDING", "limitation": "Older assembly CAD shaft envelope differs from newer standalone motor STEP. Do not conflate source frames or derive perfect mate from bbox."})],
        "pololu-wheel-1420": [("hub-bore", "d-shaft-bore", 1.5, [1, 0, 0], [[-7, 0, 0], [2.25, 0, 0]], {"endpointMeaning": ["hub entry", "bore inner end"], "sourceDFlatPlane": {"axis": "Y", "valueMm": 1}, "sourceTireCentreMm": [0, 0, 0], "nominalOuterDiameterMm": 60})],
        "pololu-caster-950": [("mounting-holes", "clearance-hole", 1.143, [0, 0, 1], [[-6.731, 0, -1.524], [6.731, 0, -1.524]], {"sourceContactPlane": {"axis": "Z", "valueMm": -1.524}, "sourceBallLowestPointMm": [0, 0, 8.545025], "sourceExtendsToward": "+Z", "drawingRoundedSpacingMm": 13.5, "drawingRoundedDiameterMm": 2.3})],
    }
    specs = definitions.get(component["id"], [])
    if not specs:
        return
    records = json.loads((root / "interface-surface-inventory.json").read_text())
    surface = next(r for r in records if r["path"] == component["geometry"]["step"])
    if surface["sha256"] != metadata["stepSha256"] or metadata["sourceToLocal"]["rotationDegXYZ"] != [0, 0, 0]:
        raise ValueError("Interface source hash/frame mismatch")
    translation = metadata["sourceToLocal"]["translationMm"]
    for id_, type_, radius, axis, points, extra in specs:
        candidates = []
        perpendicular_axes = [i for i, value in enumerate(axis) if not value]
        for point in points:
            matches = [c for c in surface["cylinders"] if abs(c["radiusMm"] - radius) < 0.00001
                       and abs(abs(sum(a * b for a, b in zip(c["axisDirection"], axis))) - 1) < 0.00001
                       and all(abs(c["axisLocationMm"][i] - point[i]) < 0.0001 for i in perpendicular_axes)]
            if not matches:
                raise ValueError("Expected native interface cylinder not present: " + id_)
            candidates.extend(c["faceIndex"] for c in matches)
        component["interfaces"].append({"id": id_, "type": type_, "coordinateFrame": "catalog-local-centred-mm",
            "dimensions": {"diameterMm": radius * 2, "centresMm": [[round(a + b, 7) for a, b in zip(p, translation)] for p in points], "axis": axis, **extra},
            "sourceCoordinates": {"frame": "manufacturer STEP source, mm", "centresMm": points, "axis": axis},
            "sourceArtifact": component["geometry"]["step"], "sourceSha256": metadata["stepSha256"],
            "sourceToLocal": metadata["sourceToLocal"], "verification": "native-cylinder-geometry-with-manufacturer-interface-context",
            "evidenceArtifact": "interface-surface-inventory.json", "evidenceSha256": digest(root / "interface-surface-inventory.json"),
            "faceIndices": sorted(set(candidates)), "reconciliation": "source-step-to-catalog-local-reconciled", "physicalFit": "UNKNOWN"})
    if component["id"] == "raspberry-pi-pico-r3":
        component["limitations"] = [s for s in component["limitations"] if "not been reconciled" not in s]
        component["limitations"].append("Mounting holes reconciled against native STEP and drawing; fastener head/copper clearance and physical fit remain untested.")


def main():
    root = ROOT / "catalog"
    index = json.loads((root / "source-index.json").read_text())
    sources = {r["name"]: r for r in index["sources"]}
    inventory = {r["path"]: r for r in json.loads((root / "model-inventory.json").read_text())}
    for record in sources.values():
        if digest(root / record["path"]) != record["sha256"]:
            raise ValueError("Archived source hash mismatch: " + record["path"])

    def artifact(name):
        s = sources[name]
        return {k: s[k] for k in ["path", "url", "sha256", "bytes", "role", "capturedAt"]}

    def rating(value, unit, source, notes=""):
        return {"value": value, "unit": unit, "basis": "MANUFACTURER_PUBLISHED", "sourceArtifact": "sources/" + source, "notes": notes}

    def geom(path):
        expected = inventory.get(path, {}).get("sha256") or digest(root / path)
        return {"step": path, "sha256": expected, "units": "mm", "frame": {"method": "bbox-center", "rotationDeg": [0, 0, 0], "description": "Preserve source axes; centre source bounding box. Functional axis mappings are not inferred."}, "status": "IMPORT_PENDING"}

    def entry(id_, name, maker, sku, urls, filenames, revision, geometry, limitations):
        return {"id": id_, "name": name, "manufacturer": maker, "sku": sku, "variant": name,
                "sourceUrls": urls, "revision": revision,
                "license": {"status": "UNKNOWN", "sourceUrl": urls[0], "notes": "Public manufacturer download; external redistribution permission not established. Local engineering reference only; do not publish the source files."},
                "sourceArtifacts": [artifact(n) for n in filenames], "geometry": geometry,
                "interfaces": [], "ratings": {}, "massG": None, "priceSnapshot": None,
                "selectionStatus": "CANDIDATE_NOT_SELECTED", "limitations": limitations}

    pico = entry("raspberry-pi-pico-r3", "Raspberry Pi Pico RP2040 R3, without headers", "Raspberry Pi", "Pico RP2040 R3",
                 ["https://pip.raspberrypi.com/categories/610-raspberry-pi-pico"],
                 ["pico-step.zip", "pico-product-brief.pdf", "pico-resources.html"], "Pico-R3; archive RP-008311-DS-1",
                 geom("models/pico/Pico-R3.step"), ["Not Pico H/W/WH/Pico 2. Headers/cables are not implicitly added.", "Mounting drawing coordinates have not been reconciled with source STEP coordinates."])
    pico["interfaces"] = [{"id": "board-outline", "type": "board", "dimensions": {"widthMm": 21, "lengthMm": 51}, "coordinateFrame": "manufacturer dimension drawing; not STEP-local", "sourceArtifact": "sources/pico-product-brief.pdf", "verification": "manufacturer-drawing", "reconciliation": "pending"},
                          {"id": "gpio-pitch", "type": "through-hole-header", "dimensions": {"pitchMm": 2.54}, "coordinateFrame": "manufacturer dimension drawing; not STEP-local", "sourceArtifact": "sources/pico-product-brief.pdf", "verification": "manufacturer-drawing", "reconciliation": "pending"}]
    pico["ratings"] = {"vsysSupplyRangeV": rating([1.8, 5.5], "V", "pico-product-brief.pdf", "VSYS/input supply range, NOT an ADC input limit.")}
    pico["license"] = {"status": "MANUFACTURER_PERMISSION_OBSERVED_DOCUMENTATION_NOT_ARCHIVED", "sourceUrl": "https://www.raspberrypi.com/documentation/microcontrollers/pico-series.html", "notes": "Official documentation permits use/copy/modify/distribute Pico/Pico H designs as-is; that documentation endpoint returned 403 during DGX acquisition. Resource index archived. No external publication authorized."}

    driver = entry("pololu-drv8833-2130", "Pololu DRV8833 Dual Motor Driver Carrier, md17a", "Pololu", "2130",
                   ["https://www.pololu.com/product/2130/resources", "https://www.pololu.com/product/2130"],
                   ["pololu-2130.step", "pololu-2130-dimensions.pdf", "pololu-2130-drill.dxf", "pololu-2130-product.html"], "md17a; dimensional drawing 2018-10-26",
                   geom("sources/pololu-2130.step"), ["Model is carrier without user-added header/wiring unless present in source.", "Connector holes are electrical interfaces, not qualified structural mounting holes.", "Continuous current depends on thermal conditions; no board bench test."])
    driver["interfaces"] = [{"id": "board-and-connectors", "type": "board-header-grid", "dimensions": {"boardMm": [12.7, 20.3, 1.57], "holeDiameterMm": 1.02, "holeCount": 16, "rowSeparationMm": 10.16, "pitchMm": 2.54, "drillLocationToleranceMm": 0.1, "boardEdgeToleranceMm": 0.3}, "coordinateFrame": "md17a PDF/DXF drawing; not centred STEP", "sourceArtifact": "sources/pololu-2130-dimensions.pdf", "verification": "manufacturer-drawing", "reconciliation": "pending"}]
    driver["ratings"] = {"motorSupplyRangeV": rating([2.7, 10.8], "V", "pololu-2130-product.html"), "continuousCurrentPerChannelA": rating(1.2, "A", "pololu-2130-product.html", "Typical room-temperature thermal conditions; not universal."), "peakCurrentPerChannelA": rating(2.0, "A", "pololu-2130-product.html", "Not continuous rating.")}

    motors = []
    for sku, ratio, rpm, torque in [("992", 100.37, 130, 0.74), ("1098", 51.45, 270, 0.44)]:
        name = f"Pololu {100 if sku == '992' else 50}:1 Micro Metal Gearmotor LP 6V, no encoder"
        motor = entry("pololu-lp6v-" + sku, name, "Pololu", sku, ["https://www.pololu.com/product/" + sku, "https://www.pololu.com/product/" + sku + "/resources"],
                      [f"pololu-{sku}-product.html", "pololu-micro-motors-step.zip", "pololu-micro-motors-dimensions.pdf", "pololu-micro-motors-datasheet.pdf"],
                      "Family archive README maps pm=LP/MP/HP; non-1000 gearbox; no encoder or rear extension. Drawing 2024-04-03; performance datasheet rev6.2.",
                      geom("models/pololu-motors/No Encoder/mmgm-pm.step"),
                      ["Shared manufacturer external geometry; internal gear train/windings do not identify SKU. Bind ratings separately to selected exact SKU.", "Stall torque/current are theoretical; not continuous operating values.", "No measured torque-speed/load/traction/stop test or battery-voltage characterization.", "3 mm shaft does not establish wheel interference-fit tolerance or permissible hub load."])
        motor["sourceArtifacts"].append({**inventory["models/pololu-motors/README.txt"], "role": "manufacturer variant filename mapping"})
        motor["interfaces"] = [{"id": "output-shaft", "type": "d-shaft", "dimensions": {"nominalDiameterMm": 3.0, "protrusionMm": 9.0}, "coordinateFrame": "manufacturer drawing; source STEP axis pending reconciliation", "sourceArtifact": "sources/pololu-micro-motors-dimensions.pdf", "verification": "manufacturer-drawing", "reconciliation": "pending"},
                               {"id": "gearbox-face", "type": "threaded-mount", "dimensions": {"crossSectionMm": [10, 12], "thread": "M1.6", "threadCount": 2, "maximumScrewEngagementMm": None}, "coordinateFrame": "manufacturer drawing page4; not centred STEP", "sourceArtifact": "sources/pololu-micro-motors-dimensions.pdf", "verification": "manufacturer-drawing", "reconciliation": "pending"}]
        motor["ratings"] = {"voltageV": rating(6, "V", f"pololu-{sku}-product.html"), "gearRatio": rating(ratio, "ratio", f"pololu-{sku}-product.html"), "noLoadRpm": rating(rpm, "rpm", f"pololu-{sku}-product.html", "At6V; not loaded vehicle speed."), "noLoadCurrentA": rating(0.04, "A", f"pololu-{sku}-product.html"), "theoreticalStallCurrentA": rating(0.36, "A", f"pololu-{sku}-product.html"), "theoreticalStallTorqueKgfCm": rating(torque, "kgf*cm", f"pololu-{sku}-product.html", "Extrapolated stall; not continuous torque.")}
        motor["benchmarkScreen"] = {"targetSpeedMS": 0.5, "assumedWheelDiameterMm": 50, "requiredWheelRpm": 0.5 / (math.pi * 0.05) * 60, "noLoadSpeedMSAt6V": rpm * math.pi * 0.05 / 60, "status": "REJECTED_NO_LOAD_SPEED_TOO_LOW" if sku == "992" else "UNKNOWN_LOADED_OPERATING_POINT", "selected": False}
        motors.append(motor)

    mic = entry("adafruit-max4466-1063", "Adafruit MAX4466 Electret Microphone Amplifier #1063", "Adafruit", "1063",
                ["https://www.adafruit.com/product/1063", "https://github.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs"],
                ["adafruit-1063.brd", "adafruit-1063.sch", "adafruit-1063-license.txt", "adafruit-1063-readme.md", "adafruit-1063-product.html"],
                "Git commit04f6f23f995a4a0c8b944c07b2d74d602898c528, 2019-05-17", None,
                ["Native Eagle source acquired, but no manufacturer STEP. Do not render an invented rectangular block as actual manufacturer geometry.", "PCB source and current delivered hardware revision must be matched. Height/headers/cable clearance not fully reconciled.", "Relative loudness only; motor self-noise and microphone response require physical tests."])
    mic["license"] = {"status": "CC-BY-SA-3.0", "sourceUrl": sources["adafruit-1063-license.txt"]["url"], "artifact": "sources/adafruit-1063-license.txt", "notes": "Preserve attribution/readme and share-alike requirements for derivatives; no external publication in this task."}
    eagle = ET.fromstring((root / "sources/adafruit-1063.brd").read_bytes())
    holes = [e for e in eagle.findall("./drawing/board/elements/element") if e.get("package") == "MOUNTINGHOLE_2.5_PLATED"]
    centres = [[float(e.get("x")), float(e.get("y"))] for e in holes]
    mic["interfaces"] = [{"id": "board-outline", "type": "board", "dimensions": {"widthMm": 13.97, "lengthMm": 21.59, "cornerRadiusMm": 2.54}, "coordinateFrame": "Eagle board XY, lower-left outline extent=(0,0); NOT STEP-centred", "sourceArtifact": "sources/adafruit-1063.brd", "verification": "source-derived", "reconciliation": "pending-no-step"},
                         {"id": "mounting-holes", "type": "plated-hole", "dimensions": {"diameterMm": 2.5, "centresMmXY": centres}, "coordinateFrame": "Eagle board XY; NOT STEP-centred", "sourceArtifact": "sources/adafruit-1063.brd", "verification": "source-derived", "reconciliation": "pending-no-step"}]

    bundle = entry("pololu-pm-motor-1086-assembly", "Pololu precious-metal micro gearmotor with #1086 bracket, reference assembly", "Pololu", "family-pm + 1086",
                   ["https://www.pololu.com/product/1086", "https://www.pololu.com/product/1098/resources"], ["pololu-micro-motors-step.zip"],
                   "Manufacturer archive: With Bracket/mmgm-pm-with-1086-bracket.step; motor variant mapping per README",
                   geom("models/pololu-motors/With Bracket/mmgm-pm-with-1086-bracket.step"),
                   ["Manufacturer subassembly, not a whole-car kit or physical assembly proof.", "Motor electrical SKU unspecified by shared source model; #992 and #1098 cannot inherit identical performance.", "Purchased bracket geometry is not automatically an approved printable replacement.", "Bracket chassis-hole coordinates pending exact source reconciliation."])
    bracket = entry("pololu-bracket-1086", "Pololu Micro Metal Gearmotor Bracket #1086, one bracket", "Pololu", "1086",
                    ["https://www.pololu.com/product/1086", "https://www.pololu.com/product/1086/resources"],
                    ["pololu-1086.step", "pololu-1086-product.html"], "Manufacturer STEP download 0J1723; no explicit revision published",
                    geom("sources/pololu-1086.step"), ["Sold as a pair; CAD geometry represents one bracket.", "Purchased injection-moulded bracket, not a qualified printed replacement.", "Included hardware is #2-56 x 7/16 inch, not M2 by default.", "Motor-to-bracket positioning must use manufacturer assembly frame, not matching bounding-box centres."])
    bracket["interfaces"] = [{"id": "mounting-fasteners", "type": "fastener-specification", "dimensions": {"thread": "#2-56", "lengthInch": 7 / 16, "countPerBracket": 2}, "coordinateFrame": "not applicable", "sourceArtifact": "sources/pololu-1086-product.html", "verification": "manufacturer-published"}]
    wheel = entry("pololu-wheel-1420", "Pololu Wheel 60x8 mm, black, one wheel from #1420 pair", "Pololu", "1420",
                  ["https://www.pololu.com/product/1420", "https://www.pololu.com/product/1420/resources"],
                  ["pololu-1420-step.zip", "pololu-wheel-dimensions.pdf", "pololu-1420-product.html"], "w3d03a; drawing 2019-09-12 page3; black STEP archive member",
                  geom("models/pololu-wheels-60x8/pololu-wheel-60x8mm-black.step"), ["Sold as a pair; CAD geometry is one wheel including tire.", "Manufacturer states compatibility with 3 mm D-shaft micro metal gearmotors; fit tolerance/retention force not specified.", "60 mm diameter is source-backed replacement for the old assumed 50 mm benchmark, not a new user requirement.", "Tire traction, deformation and rolling resistance remain unmeasured."])
    wheel["ratings"] = {"diameterMm": rating(60, "mm", "pololu-wheel-dimensions.pdf", "Page3, diameter with tire."), "tireWidthMm": rating(8, "mm", "pololu-wheel-dimensions.pdf"), "shaftDiameterMm": rating(3, "mm", "pololu-1420-product.html", "Press-fit D shaft compatibility, not tolerance guarantee.")}
    caster = entry("pololu-caster-950", "Pololu Ball Caster with 3/8 inch plastic ball #950, no spacers", "Pololu", "950",
                   ["https://www.pololu.com/product/950", "https://www.pololu.com/product/950/resources"],
                   ["pololu-950.step", "pololu-950-dimensions.pdf", "pololu-950-product.html"], "cst01a/cst01b shared drawing 2019-02-05; STEP0J1637; plastic-ball SKU950",
                   geom("sources/pololu-950.step"), ["Shared manufacturer external CAD for plastic/metal ball variants; bind plastic-ball SKU950 separately.", "Spacers, fasteners and load rating not established by imported geometry.", "Caster friction and impact strength require physical tests."])
    caster["interfaces"] = [{"id": "nominal-mounting", "type": "clearance-hole", "dimensions": {"nominalHoleDiameterMm": 2.3, "nominalHoleSpacingMm": 13.5, "intendedScrews": ["#2", "M2"]}, "coordinateFrame": "manufacturer drawing", "sourceArtifact": "sources/pololu-950-dimensions.pdf", "verification": "manufacturer-drawing", "reconciliation": "see-native-mounting-holes"}]
    components = [pico, driver, *motors, mic, bundle, bracket, wheel, caster]
    manifest = {"schemaVersion": 1, "catalogRevision": "m4ke-source-catalog-2026-09-27-v1", "createdAt": datetime.now(timezone.utc).isoformat(),
                "runtimeNetworkRequired": False, "components": components, "materials": [],
                "kits": [{"id": "micro-motor-bracket-reference", "name": "Micro metal gearmotor + #1086 bracket + 60 mm wheel + plastic caster reference", "status": "SOURCE_BACKED_INTERFACES_NOT_PHYSICALLY_VERIFIED", "geometryCatalogId": bundle["id"], "motorChoices": [m["id"] for m in motors], "componentIds": [bracket["id"], wheel["id"], caster["id"]], "unresolved": ["Exact motor SKU loaded operating point", "Full assembly clearances and fasteners", "Battery/driver/wiring", "Physical fit and test"]}],
                "limitations": ["No live price/stock and no purchases.", "No filament structural-property database acquired in this increment.", "Source models/drawings are not physical fit or performance proof.", "Only IDs with geometry.status=VERIFIED_IMPORT have measured native import bounds."]}
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        archive = root / "history" / ("manifest-" + digest(manifest_path)[:16] + ".json")
        archive.parent.mkdir(exist_ok=True)
        if not archive.exists():
            archive.write_bytes(manifest_path.read_bytes())
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (root / "previews").mkdir(exist_ok=True)
    evidence = []
    import cadquery as cq
    for component in components:
        if not component["geometry"]:
            evidence.append({"catalogId": component["id"], "status": "NO_MANUFACTURER_STEP", "reason": "Eagle source only; source-backed derivation is separate work."})
            continue
        try:
            shape, meta = load_catalog_component(component["id"], root)
            geometry = component["geometry"]
            geometry.update({k: meta[k] for k in ["boundsMm", "solidCount", "sourceToLocal", "sourceBoundsMm"]})
            geometry["status"] = "VERIFIED_IMPORT"
            reconcile_interfaces(component, meta, root)
            stl = root / "previews" / (component["id"] + ".stl")
            cq.exporters.export(shape, str(stl), tolerance=0.05, angularTolerance=0.15)
            geometry["stl"] = stl.relative_to(root).as_posix()
            geometry["stlSha256"] = digest(stl)
            geometry["stlScope"] = "visual preview from exact imported centred STEP; not printable substitute for purchased part"
            evidence.append({**meta, "status": "PASS_NATIVE_IMPORT", "stlSha256": geometry["stlSha256"], "stlBytes": stl.stat().st_size})
        except Exception as exc:
            component["geometry"]["status"] = "IMPORT_FAILED"
            component["geometry"]["error"] = str(exc)
            evidence.append({"catalogId": component["id"], "status": "FAIL", "error": str(exc)})
        print(json.dumps(evidence[-1]), flush=True)
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    report = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(), "sourceCount": len(sources), "sourceIndexSha256": digest(root / "source-index.json"), "manifestSha256": digest(manifest_path), "imports": evidence,
              "physicalTests": "NOT_PERFORMED", "runtimeNetworkCalls": 0, "massCalculatedFromMixedCadVolume": False}
    (root / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(manifest_path), "sha256": report["manifestSha256"], "imported": sum(e["status"] == "PASS_NATIVE_IMPORT" for e in evidence), "failed": sum(e["status"] == "FAIL" for e in evidence)}), flush=True)
    return int(any(e["status"] == "FAIL" for e in evidence))


if __name__ == "__main__":
    raise SystemExit(main())
