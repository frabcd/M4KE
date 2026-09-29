#!/usr/bin/env python3
"""Bounded optional SVG projections from frozen, hash-checked native STEP parts.

No network, model calls, new geometry or arbitrary code. This is a separate
process from the CAD worker: unavailable illustrations never change CAD claims.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
SHA = re.compile(r"^[a-f0-9]{64}$")
MAX_JSON_BYTES = 2_000_000
MAX_STEP_BYTES = 25_000_000
MAX_SVG_BYTES = 4_000_000
# Frozen host CAD can contain the explicit 48-part source kit. This does not
# change the separate 24-part Qwen generation schema or per-step work bound.
MAX_PARTS = 48
MAX_STEP_PARTS = 24


class IllustrationError(ValueError):
    pass


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_JSON_BYTES:
        raise IllustrationError("JSON input must be a bounded regular file")
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise IllustrationError("Duplicate JSON key")
            value[key] = item
        return value
    return json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique)


def safe_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise IllustrationError("Invalid bounded identifier")
    return value


def vector(value, bound):
    if not isinstance(value, list) or len(value) != 3 or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > bound for v in value):
        raise IllustrationError("Invalid transform vector")
    return value


def load_frozen(design_path, result_path):
    spec, result = read_json(design_path), read_json(result_path)
    if result.get("inputSha256") != digest(design_path):
        raise IllustrationError("CAD evidence does not match the exact design input SHA256")
    if spec.get("units") != "mm" or not isinstance(spec.get("parts"), list) or not 1 <= len(spec["parts"]) <= MAX_PARTS:
        raise IllustrationError("Expected a millimetre design with 1..48 frozen parts")
    records = result.get("parts")
    if not isinstance(records, list) or len(records) != len(spec["parts"]):
        raise IllustrationError("CAD part coverage mismatch")
    by_id = {}
    for record in records:
        identity = safe_id(record.get("id"))
        if identity in by_id:
            raise IllustrationError("Duplicate CAD part ID")
        by_id[identity] = record
    parts = {}
    cad_root = result_path.resolve().parent
    if (cad_root / "parts").is_symlink():
        raise IllustrationError("Symlinked parts folder is forbidden")
    for part in spec["parts"]:
        identity = safe_id(part.get("id"))
        if identity in parts or identity not in by_id:
            raise IllustrationError("Duplicate or missing design part")
        vector(part.get("position"), 500)
        vector(part.get("rotation"), 360)
        record = by_id[identity]
        name = f"parts/{identity}.step"
        if record.get("step") != name:
            raise IllustrationError("Only canonical frozen per-part STEP paths are allowed")
        step = cad_root / name
        if step.is_symlink() or step.resolve().parent != cad_root / "parts" or not step.is_file() or step.stat().st_size > MAX_STEP_BYTES:
            raise IllustrationError("STEP must be a bounded regular file inside the frozen CAD parts directory")
        expected = record.get("sha256", {}).get("step")
        if not isinstance(expected, str) or not SHA.fullmatch(expected) or digest(step) != expected:
            raise IllustrationError(f"STEP hash mismatch: {identity}")
        parts[identity] = {"spec": part, "path": step, "sha256": expected}
    steps = spec.get("assembly")
    if not isinstance(steps, list) or not 1 <= len(steps) <= 48:
        raise IllustrationError("Expected 1..48 assembly steps")
    identities = set()
    for step in steps:
        identity = safe_id(step.get("id"))
        selected = step.get("partIds")
        if identity in identities or not isinstance(selected, list) or not 1 <= len(selected) <= MAX_STEP_PARTS or any(not isinstance(p, str) or p not in parts for p in selected) or len(selected) != len(set(selected)):
            raise IllustrationError("Invalid assembly step references")
        identities.add(identity)
    return spec, result, parts, steps


def transform(shape, part):
    # Same Three.js XYZ Euler convention as worker.py: apply Z, Y, then X.
    for axis, angle in zip(((0, 0, 1), (0, 1, 0), (1, 0, 0)), reversed(part["rotation"])):
        if angle:
            shape = shape.rotate((0, 0, 0), axis, angle)
    return shape.translate(tuple(part["position"]))


def validate_svg(svg):
    raw = svg.encode("utf-8")
    if len(raw) > MAX_SVG_BYTES or "<!DOCTYPE" in svg.upper() or "<!ENTITY" in svg.upper():
        raise IllustrationError("Unbounded or external-entity SVG")
    root = ET.fromstring(svg)
    allowed = {"svg", "g", "path", "line", "polyline", "polygon", "circle", "ellipse", "rect", "title", "desc"}
    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag not in allowed:
            raise IllustrationError(f"Unexpected SVG element: {tag}")
        for key, value in node.attrib.items():
            if key.rsplit("}", 1)[-1].lower().startswith("on") or any(token in value.lower() for token in ("javascript:", "url(", "http://", "https://", "data:")) or key.rsplit("}", 1)[-1] in ("href", "src"):
                raise IllustrationError("External or executable SVG attribute")
    if root.tag.rsplit("}", 1)[-1] != "svg" or not any(node.tag.rsplit("}", 1)[-1] == "path" for node in root.iter()):
        raise IllustrationError("Expected an actual projected-path SVG")
    return raw


def render_step(design_path, result_path, output, identity):
    import cadquery as cq
    _, _, parts, steps = load_frozen(design_path, result_path)
    step = next((s for s in steps if s["id"] == identity), None)
    if step is None:
        raise IllustrationError("Unknown requested step")
    shapes = []
    for part_id in step["partIds"]:
        part = parts[part_id]
        shape = cq.importers.importStep(str(part["path"])).val()
        if not shape.isValid() or not shape.Solids():
            raise IllustrationError("Invalid frozen STEP geometry")
        shapes.append(transform(shape, part["spec"]))
    combined = cq.Compound.makeCompound(shapes)
    svg = cq.exporters.getSVG(combined, {"width": 960, "height": 640, "marginLeft": 28, "marginTop": 28, "projectionDir": (-1.4, -1.8, 1.35), "showAxes": False, "showHidden": False, "strokeColor": (42, 66, 83), "strokeWidth": 0.2})
    payload = validate_svg(svg)
    target = output / f"{identity}.svg"
    if target.exists() or target.is_symlink():
        raise IllustrationError("Illustration already exists")
    target.write_bytes(payload)
    return {"stepId": identity, "svg": target.name, "sha256": digest(target), "bytes": len(payload), "partIds": step["partIds"], "sourceStepSha256": {p: parts[p]["sha256"] for p in step["partIds"]}, "method": "Open CASCADE native STEP hidden-line projection; selected step parts in actual assembled transforms", "physicalFit": "UNKNOWN"}


def generate(design_path, result_path, output, budget=90, only_step=None):
    started = time.monotonic()
    if output.is_symlink() or output.exists() and any(output.iterdir()):
        raise IllustrationError("Output must be a fresh empty directory")
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"schemaVersion": 1, "status": "UNAVAILABLE", "createdAt": datetime.now(timezone.utc).isoformat(), "method": "Hash-bound source STEP projection, not a concept image or box substitute", "illustrations": [], "unavailable": [], "limits": {"budgetSeconds": budget, "maxSvgBytes": MAX_SVG_BYTES}, "limitations": ["Only parts referenced by each step are projected; this is not an exploded view or a depiction of the assembly motion.", "Projection does not prove tolerances, tool access, wiring, physical fit or assembly success."]}
    try:
        _, result, _, steps = load_frozen(design_path, result_path)
        manifest.update({"designSha256": digest(design_path), "cadResultSha256": digest(result_path), "cadOk": result.get("ok"), "scriptSha256": digest(Path(__file__))})
        if only_step:
            steps = [s for s in steps if s["id"] == only_step]
            if not steps:
                raise IllustrationError("Unknown requested step")
        for step in steps:
            remaining = budget - (time.monotonic() - started)
            if remaining <= 0.25:
                manifest["unavailable"].append({"stepId": step["id"], "reason": "Total illustration budget exhausted"})
                continue
            command = [sys.executable, str(Path(__file__).resolve()), "--input", str(design_path.resolve()), "--cad", str(result_path.resolve()), "--output", str(output.resolve()), "--render-step", step["id"]]
            try:
                # One slow HLR cannot exhaust all 90 s; leave other steps a chance.
                run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=min(25, remaining))
                if run.returncode:
                    raise IllustrationError((run.stderr or run.stdout or "Projection process failed")[-1200:])
                record = json.loads(run.stdout)
                path = output / record["svg"]
                if record["svg"] != f"{step['id']}.svg" or record["sha256"] != digest(path):
                    raise IllustrationError("Projection output hash/path mismatch")
                validate_svg(path.read_text(encoding="utf-8"))
                manifest["illustrations"].append(record)
            except subprocess.TimeoutExpired:
                manifest["unavailable"].append({"stepId": step["id"], "reason": "Native projection exceeded per-step or remaining total budget"})
            except Exception as exc:
                manifest["unavailable"].append({"stepId": step["id"], "reason": f"{type(exc).__name__}: {exc}"[:1400]})
        if manifest["illustrations"]:
            manifest["status"] = "PARTIAL" if manifest["unavailable"] else "AVAILABLE"
    except Exception as exc:
        manifest["unavailable"].append({"stepId": None, "reason": f"{type(exc).__name__}: {exc}"[:1400]})
    manifest["elapsedSeconds"] = round(time.monotonic() - started, 3)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--cad", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--budget-seconds", type=float, default=90)
    parser.add_argument("--step")
    parser.add_argument("--render-step", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if not math.isfinite(args.budget_seconds) or not 0.1 <= args.budget_seconds <= 90:
            raise IllustrationError("Budget must be 0.1..90 seconds")
        if args.render_step:
            record = render_step(args.input, args.cad, args.output, safe_id(args.render_step))
        else:
            record = generate(args.input, args.cad, args.output, args.budget_seconds, safe_id(args.step) if args.step else None)
        print(json.dumps(record, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
