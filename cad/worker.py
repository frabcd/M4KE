#!/usr/bin/env python3
"""Bounded data-to-BRep worker. Never evaluates model-supplied Python/code.

STL / per-part STEP coordinates are local mm. Assembly transforms match
Three.js Euler order XYZ: local Z rotation, then Y, then X, then translation.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import time

MAX_INPUT_BYTES = 262_144
MAX_PARTS = 48
MAX_HOLES = 24
ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class SpecError(ValueError):
    pass


class Diagnostics:
    """Bounded append journal plus atomic last operation, never a verification verdict."""
    def __init__(self, output, max_bytes=262144, stream=None):
        self.output = Path(output)
        self.output.mkdir(parents=True, exist_ok=True)
        self.max_bytes = max_bytes
        self.bytes = 0
        self.sequence = 0
        self.started = time.monotonic()
        self.last = None
        self.stream = sys.stderr if stream is None else stream

    def record(self, phase, operation, status, duration=None):
        self.sequence += 1
        event = {"schemaVersion": 1, "sequence": self.sequence,
                 "at": datetime.now(timezone.utc).isoformat(),
                 "elapsedMs": round((time.monotonic()-self.started)*1000, 3),
                 "phase": str(phase)[:64], "operation": str(operation)[:180],
                 "status": status, "verificationEvidence": False}
        if duration is not None:
            event["durationMs"] = round(duration*1000, 3)
        encoded = (json.dumps(event, separators=(",", ":")) + "\n").encode("utf-8")
        event["journalTruncated"] = self.bytes + len(encoded) > self.max_bytes
        temporary = self.output / "diagnostics-last.json.tmp"
        with temporary.open("w", encoding="utf-8") as file:
            json.dump(event, file, separators=(",", ":")); file.write("\n")
            file.flush(); os.fsync(file.fileno())
        temporary.replace(self.output / "diagnostics-last.json")
        if not event["journalTruncated"]:
            with (self.output / "diagnostics.jsonl").open("ab") as file:
                file.write(encoded); file.flush(); os.fsync(file.fileno())
            self.bytes += len(encoded)
            self.stream.write("M4KE_DIAGNOSTIC " + encoded.decode("utf-8")); self.stream.flush()
        self.last = event


def timed(diagnostics, phase, operation, function):
    if diagnostics is None:
        return function()
    diagnostics.record(phase, operation, "RUNNING")
    started = time.monotonic()
    try:
        result = function()
    except BaseException:
        diagnostics.record(phase, operation, "ERROR", time.monotonic()-started)
        raise
    diagnostics.record(phase, operation, "COMPLETE", time.monotonic()-started)
    return result


def geometry_fingerprint(part, catalog_metadata=None):
    """Only immutable local geometry inputs; instance labels/poses are not geometry."""
    value={key:part.get(key) for key in ('shape','fillet','holes','pockets')}
    if part['shape']['type'] in ('catalog','library'):
        if not catalog_metadata or not catalog_metadata.get('stepSha256') or not catalog_metadata.get('manifestSha256'):
            raise SpecError('Exact pair cache requires verified catalog source and frame provenance')
        value['catalog']=catalog_metadata
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


class ExactIntersectionCache:
    """Per-run exact ordered-pair reuse under common translation, never rounded poses.

    Cached values are immutable scalar/tuple summaries, not mutable OCCT topology.
    Relative translations use exact rational values of the supplied binary floats.
    Rotation commands must match exactly; equivalent angles are not normalized.
    """
    def __init__(self):
        self.entries={}
        self.hits=0

    def measure(self, a_part, b_part, a_fingerprint, b_fingerprint, calculate,
                diagnostics=None, phase='assembly-intersection', a_rotation_command=()):
        pa=tuple(a_part['position']);pb=tuple(b_part['position'])
        relative=tuple(Fraction(b)-Fraction(a) for a,b in zip(pa,pb))
        key=(a_fingerprint,tuple(a_part['rotation']),a_rotation_command,
             b_fingerprint,tuple(b_part['rotation']),relative)
        operation=f"{a_part['id']}:{b_part['id']}"
        if key not in self.entries:
            shape=timed(diagnostics,phase,operation,calculate)
            volume=shape.Volume()
            box=bounds(shape) if volume>1e-5 else None
            immutable_box=None if box is None else tuple((edge,tuple(values)) for edge,values in box.items())
            self.entries[key]=(volume,pa,immutable_box)
        else:
            self.hits+=1
            if diagnostics:diagnostics.record(phase,operation,'REUSED_EXACT_TRANSLATION')
        volume,origin,box=self.entries[key]
        if box is None:return {'volumeMm3':volume,'intersectionBoundsMm':None}
        delta=tuple(Fraction(a)-Fraction(b) for a,b in zip(pa,origin))
        translated={edge:[float(Fraction(v)+delta[i]) if edge in ('min','max') else v for i,v in enumerate(values)] for edge,values in box}
        return {'volumeMm3':volume,'intersectionBoundsMm':translated}


def finite(value, label, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SpecError(f"{label} must be a finite number")
    if not math.isfinite(value) or not low <= value <= high:
        raise SpecError(f"{label} must be in [{low}, {high}]")
    return float(value)


def vector(value, label, low, high):
    if not isinstance(value, list) or len(value) != 3:
        raise SpecError(f"{label} must be an array of three numbers")
    return [finite(v, f"{label}[{i}]", low, high) for i, v in enumerate(value)]


def exact_keys(obj, allowed, label):
    if not isinstance(obj, dict):
        raise SpecError(f"{label} must be an object")
    unknown = sorted(set(obj) - set(allowed))
    if unknown:
        raise SpecError(f"{label} has unsupported fields: {', '.join(unknown)}")


def validate_spec(spec):
    if not isinstance(spec, dict) or type(spec.get("schemaVersion")) is not int or spec["schemaVersion"] != 1:
        raise SpecError("schemaVersion must be 1")
    if spec.get("units") != "mm":
        raise SpecError("units must be mm")
    if not isinstance(spec.get("title"), str) or not 1 <= len(spec["title"].strip()) <= 200:
        raise SpecError("title must contain 1..200 characters")
    parts = spec.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise SpecError(f"parts must contain 1..{MAX_PARTS} parts")
    ids = set()
    for i, p in enumerate(parts):
        label = f"parts[{i}]"
        exact_keys(p, {"id", "name", "kind", "material", "color", "shape", "position", "rotation", "fillet", "holes", "pockets", "source", "explanation"}, label)
        if not isinstance(p.get("id"), str) or not ID_RE.fullmatch(p["id"]) or p["id"] in ids:
            raise SpecError(f"{label}.id must be a unique safe ASCII identifier")
        ids.add(p["id"])
        for name in ("name", "material"):
            if not isinstance(p.get(name), str) or not 1 <= len(p[name].strip()) <= 160:
                raise SpecError(f"{label}.{name} must contain 1..160 characters")
        if "source" in p and (not isinstance(p["source"], str) or len(p["source"]) > 4000):
            raise SpecError(f"{label}.source must be a provenance string of at most 4000 characters")
        if "explanation" in p:
            explanation = p["explanation"]
            keys = {"purpose", "placementReason", "selectionReason"}
            exact_keys(explanation, keys, f"{label}.explanation")
            for key in keys:
                value = explanation.get(key)
                if (not isinstance(value, str) or not 1 <= len(value.strip()) <= 1000
                        or len(value) > 1000 or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", value)):
                    raise SpecError(f"{label}.explanation.{key} must contain 1..1000 control-free characters")
        if p.get("kind") not in ("printed", "purchased"):
            raise SpecError(f"{label}.kind must be printed or purchased")
        if not isinstance(p.get("color"), str) or not COLOR_RE.fullmatch(p["color"]):
            raise SpecError(f"{label}.color must be #RRGGBB")
        p["position"] = vector(p.get("position"), f"{label}.position", -500, 500)
        p["rotation"] = vector(p.get("rotation"), f"{label}.rotation", -360, 360)
        shape = p.get("shape")
        if not isinstance(shape, dict):
            raise SpecError(f"{label}.shape must be an object")
        if shape.get("type") == "box":
            exact_keys(shape, {"type", "size"}, f"{label}.shape")
            shape["size"] = vector(shape.get("size"), f"{label}.shape.size", 1, 500)
            minimum = min(shape["size"])
        elif shape.get("type") == "cylinder":
            exact_keys(shape, {"type", "radius", "height"}, f"{label}.shape")
            shape["radius"] = finite(shape.get("radius"), f"{label}.shape.radius", 1, 250)
            shape["height"] = finite(shape.get("height"), f"{label}.shape.height", 1, 500)
            minimum = min(2 * shape["radius"], shape["height"])
        elif shape.get("type") == "union":
            exact_keys(shape, {"type", "solids"}, f"{label}.shape")
            solids = shape.get("solids")
            if p["kind"] != "printed" or not isinstance(solids, list) or not 2 <= len(solids) <= 8:
                raise SpecError(f"{label}: printed union requires 2..8 basic primitives")
            minimum = 500
            for k, member in enumerate(solids):
                at = f"{label}.shape.solids[{k}]"
                if not isinstance(member, dict):
                    raise SpecError(f"{at} must be a basic primitive")
                if member.get("type") == "box":
                    exact_keys(member, {"type", "size", "position", "rotation"}, at)
                    member["size"] = vector(member.get("size"), f"{at}.size", 1, 500)
                    minimum = min(minimum, *member["size"])
                elif member.get("type") == "cylinder":
                    exact_keys(member, {"type", "radius", "height", "position", "rotation"}, at)
                    member["radius"] = finite(member.get("radius"), f"{at}.radius", 1, 250)
                    member["height"] = finite(member.get("height"), f"{at}.height", 1, 500)
                    minimum = min(minimum, 2*member["radius"], member["height"])
                else:
                    raise SpecError(f"{at}: no nested union, catalog or executable member")
                member["position"] = vector(member.get("position"), f"{at}.position", -250, 250)
                member["rotation"] = vector(member.get("rotation"), f"{at}.rotation", -360, 360)
        elif shape.get("type") == "library":
            exact_keys(shape, {"type", "sourceSha256"}, f"{label}.shape")
            if not isinstance(shape.get("sourceSha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", shape["sourceSha256"]):
                raise SpecError(f"{label}: full source SHA256 required")
            if any(key in p for key in ("fillet", "holes", "pockets")):
                raise SpecError(f"{label}: library source geometry cannot be modified")
            continue
        elif shape.get("type") == "catalog":
            exact_keys(shape, {"type", "catalogId"}, f"{label}.shape")
            if p["kind"] != "purchased" or not isinstance(shape.get("catalogId"), str) or not ID_RE.fullmatch(shape["catalogId"]):
                raise SpecError(f"{label}: catalog ID must be a safe purchased-component identifier")
            if any(key in p for key in ("fillet", "holes", "pockets")):
                raise SpecError(f"{label}: catalog source geometry cannot be modified")
            continue
        else:
            raise SpecError(f"{label}.shape.type must be box, cylinder, printed union or purchased catalog")
        p["fillet"] = finite(p.get("fillet", 0), f"{label}.fillet", 0, min(100, minimum * 0.49))
        holes = p.get("holes", [])
        if not isinstance(holes, list) or len(holes) > MAX_HOLES:
            raise SpecError(f"{label}.holes must contain at most {MAX_HOLES} holes")
        for j, hole in enumerate(holes):
            hole_label = f"{label}.holes[{j}]"
            exact_keys(hole, {"axis", "diameter", "position", "depth"}, hole_label)
            if hole.get("axis") not in ("x", "y", "z"):
                raise SpecError(f"{hole_label}.axis must be x, y or z")
            hole["diameter"] = finite(hole.get("diameter"), f"{hole_label}.diameter", 0.5, 500)
            hole["position"] = vector(hole.get("position"), f"{hole_label}.position", -500, 500)
            if "depth" in hole:
                hole["depth"] = finite(hole["depth"], f"{hole_label}.depth", 0.5, 500)
        p["holes"] = holes
        pockets = p.get("pockets", [])
        if not isinstance(pockets, list) or len(pockets) > 8 or pockets and p["kind"] != "printed":
            raise SpecError(f"{label}.pockets must contain 0..8 printed-part box cuts")
        for j, pocket in enumerate(pockets):
            exact_keys(pocket, {"size", "position"}, f"{label}.pockets[{j}]")
            pocket["size"] = vector(pocket.get("size"), f"{label}.pockets[{j}].size", 0.5, 500)
            pocket["position"] = vector(pocket.get("position"), f"{label}.pockets[{j}].position", -500, 500)
        p["pockets"] = pockets
    requests = spec.get('verificationRequests', [])
    if not isinstance(requests, list) or len(requests) > 12:
        raise SpecError('verificationRequests must contain at most 12 bounded tool requests')
    seen = set(); sweeps = 0
    for r in requests:
        if not isinstance(r, dict) or not isinstance(r.get('id'), str) or not ID_RE.fullmatch(r['id']) or r['id'] in seen:
            raise SpecError('verification request IDs must be unique safe identifiers')
        seen.add(r['id'])
        if r.get('requirementId') not in [q.get('id') for q in spec.get('requirements', [])]:
            raise SpecError('verification request must bind an existing requirement')
        common = {'id', 'requirementId', 'type'}
        if r.get('type') in ('envelope', 'rotationSweep'):
            refs = r.get('partIds');limit = 8 if r['type']=='rotationSweep' else 48
            if not isinstance(refs,list) or not 1 <= len(refs) <= limit or any(x not in ids for x in refs) or len(set(refs))!=len(refs):
                raise SpecError('verification request must name unique existing parts')
            if r['type']=='envelope':
                exact_keys(r,common|{'partIds','maxSizeMm'},'envelope request');vector(r.get('maxSizeMm'),'maxSizeMm',1,1000)
            else:
                sweeps+=1;exact_keys(r,common|{'partIds','axis','originMm','minDeg','maxDeg','framePartId'},'rotation request')
                if r.get('axis') not in ('x','y','z'):raise SpecError('invalid rotation axis')
                if 'framePartId' in r and (not isinstance(r['framePartId'],str) or r['framePartId'] not in ids):raise SpecError('rotation frame part must exist')
                vector(r.get('originMm'),'originMm',-500,500)
                if finite(r.get('minDeg'),'minDeg',-180,0)==finite(r.get('maxDeg'),'maxDeg',0,180):raise SpecError('empty rotation interval')
        elif r.get('type')=='shaftHole':
            exact_keys(r,common|{'shaftPartId','holePartId','holeIndex','minimumEngagementMm','diametralClearanceMm'},'shaftHole request')
            if r.get('shaftPartId') not in ids or r.get('holePartId') not in ids or r['shaftPartId']==r['holePartId']:raise SpecError('invalid mating parts')
            index=r.get('holeIndex');part=next(p for p in parts if p['id']==r['holePartId'])
            if type(index) is not int or not 0<=index<len(part.get('holes',[])):raise SpecError('mating hole does not exist')
            finite(r.get('minimumEngagementMm'),'minimumEngagementMm',.1,500)
            gap=r.get('diametralClearanceMm')
            if not isinstance(gap,list) or len(gap)!=2 or finite(gap[0],'clearance',0,5)>finite(gap[1],'clearance',0,5):raise SpecError('invalid clearance interval')
        elif r.get('type')=='catalogMate':
            exact_keys(r,common|{'shaftPartId','shaftInterfaceId','borePartId','boreInterfaceId','minimumEngagementMm','diametralClearanceMm'},'catalogMate request')
            if r.get('shaftPartId') not in ids or r.get('borePartId') not in ids or r['shaftPartId']==r['borePartId']:raise SpecError('invalid catalog mating parts')
            if any(next(p for p in parts if p['id']==r[k])['shape']['type']!='catalog' for k in ('shaftPartId','borePartId')):raise SpecError('catalogMate requires source-catalog parts')
            for k in ('shaftInterfaceId','boreInterfaceId'):
                if not isinstance(r.get(k),str) or not ID_RE.fullmatch(r[k]):raise SpecError('invalid catalog interface ID')
            finite(r.get('minimumEngagementMm'),'minimumEngagementMm',.1,500)
            gap=r.get('diametralClearanceMm')
            if not isinstance(gap,list) or len(gap)!=2 or finite(gap[0],'clearance',0,5)>finite(gap[1],'clearance',0,5):raise SpecError('invalid clearance interval')
        else:raise SpecError('unsupported verification request tool')
    if sweeps>3:raise SpecError('at most three motion sweeps')
    return spec


def read_spec(path):
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise SpecError(f"input exceeds {MAX_INPUT_BYTES} bytes")
    # Reject duplicate object keys rather than silently accepting the last one.
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise SpecError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    return validate_spec(json.loads(path.read_text(encoding="utf-8-sig"), object_pairs_hook=unique))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(shape):
    b = shape.BoundingBox()
    return {"min": [b.xmin, b.ymin, b.zmin], "max": [b.xmax, b.ymax, b.zmax]}


def dimension_error(a, b):
    return max(abs(x - y) for key in ("min", "max") for x, y in zip(a[key], b[key]))


def transform(shape, part):
    result = shape
    for axis, angle in zip(((0, 0, 1), (0, 1, 0), (1, 0, 0)), reversed(part["rotation"])):
        if angle:
            result = result.rotate((0, 0, 0), axis, angle)
    return result.translate(tuple(part["position"]))


def cut_material(shape, cutter, part_id, feature):
    """Keep empty Boolean results from reaching later OCCT features without context."""
    previous = shape.Volume()
    candidate = shape.cut(cutter)
    if candidate.wrapped.IsNull() or not candidate.Solids() or candidate.Volume() <= 1e-6:
        raise SpecError(f"{part_id}: {feature} removes all solid material; revise the cut and supporting body dimensions so a positive solid remains")
    candidate = candidate.clean()
    if previous - candidate.Volume() <= max(1e-7, previous * 1e-10):
        raise SpecError(f"{part_id}: {feature} does not remove material (outside or duplicate feature)")
    return candidate


def hole_cutter(cq, hole):
    """Finite cuts are centered locally; omitted depth preserves legacy through intent."""
    axis = "xyz".index(hole["axis"])
    direction = [int(i == axis) for i in range(3)]
    start = list(hole["position"])
    depth = hole.get("depth", 1002)
    start[axis] = start[axis] - depth / 2 if "depth" in hole else -501
    return cq.Solid.makeCylinder(hole["diameter"] / 2, depth, cq.Vector(*start), cq.Vector(*direction))


def build_shape(cq, part):
    s = part["shape"]
    if s["type"] == "library":
        from library_geometry import load_library_component
        return load_library_component(s["sourceSha256"])[0]
    if s["type"] == "catalog":
        from catalog_geometry import load_catalog_component
        shape, _ = load_catalog_component(s["catalogId"])
        return shape
    if s["type"] == "union":
        members = []
        for member in s["solids"]:
            primitive = (cq.Workplane("XY").box(*member["size"]) if member["type"] == "box"
                         else cq.Workplane("XY").cylinder(member["height"], member["radius"]))
            members.append(transform(primitive.val(), member))
        fused = members[0].fuse(*members[1:]).clean()
        if not fused.isValid() or len(fused.Solids()) != 1 or fused.Volume() <= 0:
            raise SpecError("union must produce one connected, valid positive-volume solid; no disconnected assembly masquerading as one print")
        bb = bounds(fused)
        if any(bb["max"][i] - bb["min"][i] > 500.000001 for i in range(3)):
            raise SpecError("union local extent exceeds 500 mm")
        work = cq.Workplane("XY").newObject([fused])
    elif s["type"] == "box":
        work = cq.Workplane("XY").box(*s["size"])
    else:
        work = cq.Workplane("XY").cylinder(s["height"], s["radius"])
    if part["fillet"]:
        # A failed feature is a failed job: never silently revert to a plain box.
        work = work.edges().fillet(part["fillet"])
    shape = work.val()
    for index, pocket in enumerate(part.get("pockets", [])):
        cutter = cq.Workplane("XY").box(*pocket["size"]).val().translate(tuple(pocket["position"]))
        shape = cut_material(shape, cutter, part["id"], f"pocket {index}")
    for index, hole in enumerate(part["holes"]):
        shape = cut_material(shape, hole_cutter(cq, hole), part["id"], f"hole {index}")
    if not shape.isValid() or len(shape.Solids()) != 1 or shape.Volume() <= 1e-6:
        raise SpecError(f"{part['id']}: features must retain one valid positive-volume solid")
    return shape


def mesh_stats(path):
    """Read actual binary STL output; edge welding tolerance is 1e-5 mm."""
    if path.stat().st_size > 50_000_084:
        raise SpecError("STL exceeds the one-million-triangle output limit")
    data = path.read_bytes()
    if len(data) < 84:
        raise SpecError("STL is truncated")
    count = struct.unpack_from("<I", data, 80)[0]
    if not 4 <= count <= 1_000_000 or len(data) != 84 + count * 50:
        raise SpecError("STL has invalid binary triangle count/length")
    edges = Counter()
    volume = 0.0
    degenerate = 0
    vertices = set()
    min_xyz = [math.inf] * 3
    max_xyz = [-math.inf] * 3
    for i in range(count):
        values = struct.unpack_from("<12fH", data, 84 + i * 50)
        a, b, c = values[3:6], values[6:9], values[9:12]
        if not all(math.isfinite(v) for xyz in (a, b, c) for v in xyz):
            raise SpecError("STL contains non-finite vertex")
        keys = [tuple(round(v, 5) for v in xyz) for xyz in (a, b, c)]
        vertices.update(keys)
        if len(set(keys)) != 3:
            degenerate += 1
        for u, v in ((0, 1), (1, 2), (2, 0)):
            edges[tuple(sorted((keys[u], keys[v])))] += 1
        volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        for xyz in (a, b, c):
            for j, value in enumerate(xyz):
                min_xyz[j] = min(min_xyz[j], value)
                max_xyz[j] = max(max_xyz[j], value)
    bad_edges = sum(1 for multiplicity in edges.values() if multiplicity != 2)
    return {"triangles": count, "vertices": len(vertices), "volumeMm3": abs(volume), "signedVolumeMm3": volume,
            "bounds": {"min": min_xyz, "max": max_xyz}, "nonManifoldEdges": bad_edges,
            "degenerateTriangles": degenerate, "closedAtWeldTolerance": bad_edges == 0 and degenerate == 0,
            "weldToleranceMm": 1e-5}


def remove_collapsed_stl_triangles(path):
    """Remove only float32 triangles collapsed under the stated weld tolerance.

    OCCT can emit tiny corner triangles whose vertices become identical in STL.
    No vertex is moved, hole filled or face invented. The resulting file must
    still pass closed-edge incidence and BRep-volume comparison independently.
    """
    if path.stat().st_size > 50_000_084:
        raise SpecError("STL exceeds the one-million-triangle output limit")
    data = path.read_bytes()
    if len(data) < 84:
        raise SpecError("STL is truncated")
    count = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + count * 50:
        raise SpecError("STL has invalid binary triangle count/length")
    kept = []
    for index in range(count):
        record = data[84 + index * 50:84 + (index + 1) * 50]
        values = struct.unpack("<12fH", record)
        keys = {tuple(round(v, 5) for v in values[start:start + 3]) for start in (3, 6, 9)}
        if len(keys) == 3:
            kept.append(record)
    removed = count - len(kept)
    if removed:
        path.write_bytes(data[:80] + struct.pack("<I", len(kept)) + b"".join(kept))
    return {"originalTriangles": count, "removedCollapsedTriangles": removed,
            "method": "Remove only triangles with duplicate vertices at 1e-5 mm weld tolerance; no vertex motion, hole filling or new faces"}


def check(identity, label, status, method, observed, required, details):
    return {"id": identity, "label": label, "status": status, "method": method,
            "observed": observed, "required": required, "details": details}


def requested_checks(cq, spec, world_shapes, diagnostics=None, world_bounds=None, known_intersections=None):
    """Model-selected inert tool calls; native observations, never model verdicts."""
    output=[];shapes=dict(world_shapes);parts={p['id']:p for p in spec['parts']}
    # Shapes are immutable throughout verification. Compute exact OCCT bounds once,
    # not for every stationary part at every sampled rotation/pair comparison.
    if world_bounds is None:
        world_bounds={pid:timed(diagnostics,'world-bounds',pid,lambda:bounds(shape)) for pid,shape in world_shapes}
    def point(v,part,translate=True):
        v=list(v)
        for (a,b),degree in zip(((0,1),(2,0),(1,2)),reversed(part['rotation'])):
            c=math.cos(math.radians(degree));s=math.sin(math.radians(degree));v[a],v[b]=c*v[a]-s*v[b],s*v[a]+c*v[b]
        return [x+(part['position'][i] if translate else 0) for i,x in enumerate(v)]
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def overlaps(ba,bb):
        return not any(ba['max'][i]<=bb['min'][i]+1e-7 or bb['max'][i]<=ba['min'][i]+1e-7 for i in range(3))
    for r in spec.get('verificationRequests',[]):
        if r['type']=='catalogMate':continue  # Source-bound interface helper below owns this tool.
        identity='request:'+r['id'];observed={'requirementId':r['requirementId']}
        if r['type']=='envelope':
            b={edge:[fn(world_bounds[p][edge][i] for p in r['partIds']) for i in range(3)] for edge,fn in [('min',min),('max',max)]}
            size=[b['max'][i]-b['min'][i] for i in range(3)];observed.update(boundsMm=b,sizeMm=size)
            output.append(check(identity,'Requested assembly envelope','PASS' if all(size[i]<=r['maxSizeMm'][i]+1e-5 for i in range(3)) else 'FAIL','Native world-space BRep bounds',observed,{'maxSizeMm':r['maxSizeMm']},'Checks the named pose/parts, not their motion envelope or a complete interpretation of free-text requirements.'))
        elif r['type']=='shaftHole':
            shaft=parts[r['shaftPartId']];body=parts[r['holePartId']];hole=body['holes'][r['holeIndex']]
            if shaft['shape']['type']!='cylinder' or shaft.get('fillet',0) or shaft.get('holes') or shaft.get('pockets'):
                output.append(check(identity,'Requested shaft/hole engagement','UNKNOWN','Unsupported exact shaft representation',observed,r,'This tool supports a plain unfilleted cylinder pin and an actual declared bore. Catalog/compound/modified shafts need a separately implemented interface tool, not invented dimensions.'));continue
            axis='xyz'.index(hole['axis']);direction=[int(i==axis) for i in range(3)];world_axis=point(direction,body,False);pin_axis=point([0,0,1],shaft,False)
            pin_center=shaft['position'];hole_center=point(hole['position'],body);delta=[a-b for a,b in zip(pin_center,hole_center)]
            radial=math.sqrt(max(0,dot(delta,delta)-dot(delta,world_axis)**2));parallel=abs(dot(pin_axis,world_axis))>=math.cos(math.radians(.1))
            blank=dict(body,holes=[]);solid=build_shape(cq,blank)
            # Other bores may remove the support (e.g. a wide counterbore).
            # Do not credit that empty axial interval to the narrower hole.
            for index,other in enumerate(body['holes']):
                if index != r['holeIndex']:
                    solid=solid.cut(hole_cutter(cq,other))
            removed=solid.intersect(hole_cutter(cq,hole))
            center=dot(pin_center,world_axis);height=shaft['shape']['height'];intervals=[]
            for segment in removed.Solids():
                bb=bounds(segment);ends=[]
                for edge in ('min','max'):
                    local=list(hole['position']);local[axis]=bb[edge][axis];ends.append(dot(point(local,body),world_axis))
                lo=max(min(ends),center-height/2);hi=min(max(ends),center+height/2)
                if hi>lo:intervals.append((lo,hi))
            merged=[]
            for lo,hi in sorted(intervals):
                if merged and lo<=merged[-1][1]+1e-7:merged[-1][1]=max(hi,merged[-1][1])
                else:merged.append([lo,hi])
            engagement=sum(hi-lo for lo,hi in merged) if parallel else 0
            gap=hole['diameter']-2*shaft['shape']['radius']
            passed=parallel and gap>=r['diametralClearanceMm'][0]-1e-6 and gap<=r['diametralClearanceMm'][1]+1e-6 and radial<=gap/2+1e-6 and engagement>=r['minimumEngagementMm']-1e-6
            observed.update(axialEngagementMm=engagement,diametralClearanceMm=gap,radialAxisOffsetMm=radial,axesParallelWithinDeg=.1,axesParallel=parallel,supportIntervalsMm=merged)
            output.append(check(identity,'Requested shaft/hole engagement','PASS' if passed else 'FAIL','Native bore-support segments and transformed cylinder/hole axes',observed,{'minimumEngagementMm':r['minimumEngagementMm'],'diametralClearanceMm':r['diametralClearanceMm']},'Nominal undeformed geometry only. Engagement and clearance do not prove retention, load capacity, friction, print accuracy or full assembly access.'))
        else:
            origin=r['originMm'];direction=[int(i=='xyz'.index(r['axis'])) for i in range(3)]
            if 'framePartId' in r:
                frame=parts[r['framePartId']];origin=point(origin,frame);direction=point(direction,frame,False)
            end=[origin[i]+direction[i] for i in range(3)]
            angles=sorted(set([0.0]+[r['minDeg']+(r['maxDeg']-r['minDeg'])*i/6 for i in range(7)]));hits=[];evaluated=[]
            # A neutral-pose collision already disproves clearance. Evaluate it
            # first, reusing only exact intersections of these same world shapes.
            for angle in [0.0]+[a for a in angles if a!=0.0]:
                evaluated.append(angle)
                for pid in r['partIds']:
                    moving=timed(diagnostics,'rotation-transform',f"{r['id']}:{angle:g}:{pid}",lambda:shapes[pid].rotate(tuple(origin),tuple(end),angle)) if angle else shapes[pid]
                    moving_bounds=timed(diagnostics,'rotation-bounds',f"{r['id']}:{angle:g}:{pid}",lambda:bounds(moving)) if angle else world_bounds[pid]
                    for fixed,shape in world_shapes:
                        if fixed in r['partIds'] or not overlaps(moving_bounds,world_bounds[fixed]):continue
                        pair=frozenset((pid,fixed))
                        if angle==0 and known_intersections is not None and pair in known_intersections:
                            volume=known_intersections[pair]
                            if diagnostics:diagnostics.record('rotation-intersection',f"{r['id']}:0:{pid}:{fixed}",'REUSED_EXACT_NEUTRAL')
                        else:volume=timed(diagnostics,'rotation-intersection',f"{r['id']}:{angle:g}:{pid}:{fixed}",lambda:moving.intersect(shape).Volume())
                        if volume>1e-5:
                            hits.append({'angleDeg':angle,'parts':[pid,fixed],'intersectionMm3':volume});break
                    if hits:break
                if hits:break
            partial=bool(hits)
            observed.update(sampleAnglesDeg=evaluated,requestedAnglesDeg=angles,evaluatedAnglesDeg=evaluated,earlyExitAfterCollision=partial,coverage='PARTIAL_FAILURE_PROVEN' if partial else 'ALL_REQUESTED_SAMPLES',collisions=hits,framePartId=r.get('framePartId'),worldOriginMm=origin,worldAxisDirection=direction)
            output.append(check(identity,'Requested sampled rotation clearance','FAIL' if hits else 'PASS','Native exact intersections; first proven collision short-circuits FAIL, PASS requires all requested samples',observed,'No positive nominal intersection at every requested sampled pose','Partial evaluation can only prove FAIL; an incomplete run cannot PASS. A bounded kinematic sample, NOT continuous collision detection, rigid-body dynamics, joint retention, contact stability or a physical motion test.'))
    return output


def roundtrip_status(valid, actual_solids, expected_solids, bounds_error, volume_error, volume, has_catalog):
    """Never hide source-CAD serialization drift behind a widened PASS tolerance.

    Purchased curved/spline geometry can change quadrature/STEP representation
    slightly despite unchanged bounds. At most 1 ppm volume-only drift is retained
    as UNKNOWN for review; printed pieces retain the original strict FAIL gate.
    """
    if not valid or actual_solids != expected_solids or bounds_error > 1e-5:
        return "FAIL"
    if volume_error <= max(1e-5, volume * 1e-8):
        return "PASS"
    if has_catalog and volume_error <= max(1e-5, volume * 1e-6):
        return "UNKNOWN"
    return "FAIL"


def run(spec, output, diagnostics=None):
    import cadquery as cq
    started = time.monotonic()
    result = {"schemaVersion": 1, "title": spec["title"], "units": "mm", "ok": False,
              "createdAt": datetime.now(timezone.utc).isoformat(), "kernel": "Open CASCADE / CadQuery",
              "version": {name: importlib.metadata.version(name) for name in ("cadquery", "cadquery-ocp", "vtk")},
              "parts": [], "checks": [], "errors": [], "limitations": [
                  "Geometry validity is not structural, electrical or physical-function verification.",
                  "Purchased catalog parts are hash-bound supplier geometry, not physical fit certification; other purchased parts are envelopes.",
                  "Part mating, tolerances, material strength and print settings require separate validation.",
                  "STL units are implicit millimetres; STEP records millimetres."]}
    output.mkdir(parents=True, exist_ok=True)
    part_dir = output / "parts"
    part_dir.mkdir(exist_ok=True)
    assembly = cq.Assembly(name="M4KE")
    world_shapes = [];world_bounds = {};catalog_cache = {};fingerprints = {};catalog_locals={};catalog_records={}
    parts_by_id={p['id']:p for p in spec['parts']};intersection_cache=ExactIntersectionCache()
    for part in spec["parts"]:
        catalog_metadata = None
        if part["shape"]["type"] == "library":
            from library_geometry import load_library_component
            shape, catalog_metadata = timed(diagnostics,"part-import",part["id"],lambda:load_library_component(part["shape"]["sourceSha256"],cache=catalog_cache))
            if part["kind"] == "printed" and len(shape.Solids()) != 1:
                raise SpecError("A printed library source must be one solid; multi-solid source assemblies require separate part selection")
        elif part["shape"]["type"] == "catalog":
            from catalog_geometry import load_catalog_component
            shape, catalog_metadata = timed(diagnostics,"part-import",part["id"],lambda:load_catalog_component(part["shape"]["catalogId"],cache=catalog_cache))
            catalog_locals[part['id']]=shape;catalog_records[part['id']]=catalog_metadata
        else:
            shape = timed(diagnostics,"part-build",part["id"],lambda:build_shape(cq, part))
        solids = shape.Solids();solid_count = len(solids)
        valid = timed(diagnostics,"part-validity",part["id"],lambda:shape.isValid())
        if not valid or solid_count < 1 or timed(diagnostics,"part-solid-volumes",part["id"],lambda:any(s.Volume() <= 0 for s in solids)):
            raise SpecError(f"{part['id']}: all solids must be valid with positive volume")
        local_bounds = timed(diagnostics,"part-bounds",part["id"],lambda:bounds(shape))
        volume = timed(diagnostics,"part-volume",part["id"],lambda:shape.Volume())
        stl_name = f"parts/{part['id']}.stl"
        step_name = f"parts/{part['id']}.step"
        stl_path, step_path = output / stl_name, output / step_name
        timed(diagnostics,"part-stl-export",part["id"],lambda:cq.exporters.export(shape, str(stl_path), exportType="STL", tolerance=0.03, angularTolerance=0.1, opt={"ascii": False}))
        mesh_cleanup = remove_collapsed_stl_triangles(stl_path)
        timed(diagnostics,"part-step-export",part["id"],lambda:cq.exporters.export(shape, str(step_path), exportType="STEP"))
        reimport = timed(diagnostics,"part-step-reimport",part["id"],lambda:cq.importers.importStep(str(step_path)).val())
        roundtrip_bounds = timed(diagnostics,"part-roundtrip-bounds",part["id"],lambda:dimension_error(local_bounds, bounds(reimport)))
        roundtrip_volume = timed(diagnostics,"part-roundtrip-volume",part["id"],lambda:abs(reimport.Volume() - volume))
        restored_valid = timed(diagnostics,"part-roundtrip-validity",part["id"],lambda:reimport.isValid())
        restored_solids = len(reimport.Solids())
        step_status = roundtrip_status(restored_valid, restored_solids, solid_count, roundtrip_bounds, roundtrip_volume, volume, catalog_metadata is not None and part["kind"] == "purchased")
        mesh = timed(diagnostics,"part-mesh-check",part["id"],lambda:mesh_stats(stl_path))
        mesh["cleanup"] = mesh_cleanup
        mesh_volume_error = abs(mesh["volumeMm3"] - volume) / volume
        mesh_pass = mesh["closedAtWeldTolerance"] and mesh["signedVolumeMm3"] > 0 and mesh_volume_error <= 0.01
        world = transform(shape, part)
        fingerprints[part['id']]=geometry_fingerprint(part,catalog_metadata)
        world_shapes.append((part["id"], world))
        world_bounds[part["id"]] = timed(diagnostics,"world-bounds",part["id"],lambda:bounds(world))
        rgb = [int(part["color"][j:j+2], 16) / 255 for j in (1, 3, 5)]
        assembly.add(world, name=part["id"], color=cq.Color(*rgb))
        result["parts"].append({"id": part["id"], "name": part["name"], "kind": part["kind"],
                                "material": part["material"], "color": part["color"], "position": part["position"],
                                "rotation": part["rotation"], "stl": stl_name, "step": step_name,
                                "volumeMm3": volume, "bounds": local_bounds, "worldBounds": world_bounds[part["id"]],
                                "valid": valid, "solidCount": solid_count, "mesh": mesh,
                                "features": {"filletMm": part.get("fillet", 0), "holesApplied": len(part.get("holes", [])), "pocketsApplied": len(part.get("pockets", []))},
                                "catalog": catalog_metadata if part["shape"]["type"] == "catalog" else None,
                                "library": catalog_metadata if part["shape"]["type"] == "library" else None,
                                "sha256": {"stl": sha(stl_path), "step": sha(step_path)}})
        result["checks"].extend([
            check(f"{part['id']}:brep", f"{part['name']}: valid solid", "PASS", "Open CASCADE isValid / solid count / volume", {"valid": True, "solidCount": solid_count, "volumeMm3": volume}, "One printed solid, or positive catalog component solids", "Checks geometry only, not physical fit."),
            check(f"{part['id']}:step", f"{part['name']}: STEP round trip", step_status, "Export STEP, re-import in CadQuery, compare local bounds and volume", {"boundsErrorMm": roundtrip_bounds, "volumeErrorMm3": roundtrip_volume, "relativeVolumeError": roundtrip_volume / volume, "valid": restored_valid, "solidCount": restored_solids}, "Bounds <= 1e-5 mm, volume <= max(1e-5 mm3, 1e-8 relative), matching positive-solid count", "No proof of fit or assembly. Catalog-only volume drift between the strict gate and 1 ppm is UNKNOWN, never PASS; larger drift or invalid/bounds/solid-count mismatch is FAIL."),
            check(f"{part['id']}:mesh", f"{part['name']}: STL topology", "PASS" if mesh_pass else "UNKNOWN" if catalog_metadata and part["kind"] == "purchased" else "FAIL", "Binary STL readback, welded edge incidence, signed volume", {"triangles": mesh["triangles"], "nonManifoldEdges": mesh["nonManifoldEdges"], "degenerateTriangles": mesh["degenerateTriangles"], "relativeVolumeError": mesh_volume_error}, "Closed 2-manifold edges at 1e-5 mm weld tolerance, positive signed volume, volume error <= 1%", "Purchased catalog assemblies may have touching component surfaces; unresolved mesh topology is UNKNOWN and never printable. Printed-part topology failure is FAIL.")])
    assembly_path = output / "assembly.step"
    timed(diagnostics,"assembly-export","assembly.step",lambda:assembly.export(str(assembly_path), "STEP"))
    restored = timed(diagnostics,"assembly-reimport","assembly.step",lambda:cq.importers.importStep(str(assembly_path)).val())
    compound = cq.Compound.makeCompound([shape for _, shape in world_shapes])
    assembly_bounds = timed(diagnostics,"assembly-bounds","source",lambda:bounds(compound))
    assembly_error = timed(diagnostics,"assembly-bounds","roundtrip",lambda:dimension_error(assembly_bounds, bounds(restored)))
    assembly_volume = timed(diagnostics,"assembly-volume","source",lambda:compound.Volume())
    assembly_volume_error = timed(diagnostics,"assembly-volume","roundtrip",lambda:abs(assembly_volume - restored.Volume()))
    expected_solids = sum(len(shape.Solids()) for _, shape in world_shapes)
    assembly_status = timed(diagnostics,"assembly-validity","roundtrip",lambda:roundtrip_status(restored.isValid(), len(restored.Solids()), expected_solids, assembly_error, assembly_volume_error, assembly_volume, any(p["shape"]["type"] == "catalog" for p in spec["parts"])))
    result.update({"assemblyStep": "assembly.step", "assemblySha256": sha(assembly_path), "assemblyBounds": assembly_bounds})
    result["checks"].append(check("assembly:step", "Assembly STEP round trip", assembly_status, "Export assembly STEP and re-import all transformed solids", {"solidCount": len(restored.Solids()), "boundsErrorMm": assembly_error, "volumeErrorMm3": assembly_volume_error, "relativeVolumeError": assembly_volume_error / assembly_volume}, f"{expected_solids} valid solids, bounds <= 1e-5 mm, volume <= max(1e-5 mm3, 1e-8 relative)", "Transforms use Three.js XYZ Euler, mm; no part fusion. Small catalog-only volume serialization drift up to 1 ppm is UNKNOWN, not PASS."))
    # At most 48*47/2 exact pair checks, with cheap axis-aligned bounds rejection.
    overlaps = [];known_intersections={}
    for i, (a_id, a) in enumerate(world_shapes):
        ba = world_bounds[a_id]
        for b_id, b in world_shapes[i+1:]:
            bb = world_bounds[b_id]
            if any(ba["max"][axis] <= bb["min"][axis] + 1e-7 or bb["max"][axis] <= ba["min"][axis] + 1e-7 for axis in range(3)):
                continue
            summary=intersection_cache.measure(parts_by_id[a_id],parts_by_id[b_id],fingerprints[a_id],fingerprints[b_id],lambda:a.intersect(b),diagnostics)
            overlap = summary['volumeMm3']
            known_intersections[frozenset((a_id,b_id))]=overlap
            if overlap > 1e-5:
                overlaps.append({"parts": [a_id, b_id], "volumeMm3": overlap,
                                 "intersectionBoundsMm": summary['intersectionBoundsMm']})
    result["checks"].extend([
        check("assembly:overlaps", "Assembly solid intersections", "FAIL" if overlaps else "PASS", "Open CASCADE exact pair intersections after AABB rejection", overlaps, "Separate parts must have no positive-volume intersections above 1e-5 mm3", "This rigid-solid grammar has no validated interference-fit or deformable mating model. Overlap is a blocking nominal-geometry failure, not excused by prose. Unions fuse only members of one printed part; clearance, retention and motion still require separate checks."),
        check("physical:function", "Physical operation", "UNKNOWN", "Not tested", "No built hardware observed", "Actual physical test with measured results", "Rendered geometry and software tests cannot prove physical function."),
        check("purchased:interfaces", "Purchased component interfaces", "UNKNOWN", "Source-bound catalog geometry or explicitly labelled envelopes; physical fit not measured", [p["id"] for p in spec["parts"] if p["kind"] == "purchased"], "Supplier drawings or measured dimensions and tolerance stack", "No fabricated supplier dimensions or fit certification.")])
    result['checks'].extend(requested_checks(cq,spec,world_shapes,diagnostics,world_bounds,known_intersections))
    if catalog_records:
        from catalog_mates import catalog_mate_checks
        result['checks'].extend(timed(diagnostics,'catalog-mates','selected-interfaces',lambda:catalog_mate_checks(spec,catalog_locals,catalog_records)))
    result['exactIntersectionCache']={'hits':intersection_cache.hits,'entries':len(intersection_cache.entries),'scope':'Same verified geometry, exact ordered rotations and relative translations; no approximate pose keys'}
    result["errors"] = [f"{c['id']}: {c['label']} failed" for c in result["checks"] if c["status"] == "FAIL"]
    result["ok"] = not result["errors"]
    result["elapsedSeconds"] = round(time.monotonic() - started, 3)
    if diagnostics:
        diagnostics.record("worker", "complete", "COMPLETE")
        result["diagnostics"] = {"journal":"diagnostics.jsonl", "lastOperation":"diagnostics-last.json", "events":diagnostics.sequence, "verificationEvidence":False}
    return result


def write_result(output, result):
    output.mkdir(parents=True, exist_ok=True)
    temporary = output / "result.json.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(output / "result.json")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    writable_output = False
    try:
        # Dedicated jobs must be fresh. Do not overwrite prior evidence or follow
        # an attacker-created parts symlink into unrelated files.
        if args.output.is_symlink() or (output.exists() and any(output.iterdir())):
            raise SpecError("output must be a fresh empty job directory")
        writable_output = True
        spec = read_spec(args.input)
        # OCCT writes progress directly to fd 1. Capture kernel chatter to stderr
        # so stdout remains exactly one machine-readable JSON object.
        stdout_fd = os.dup(1)
        try:
            os.dup2(2, 1)
            result = run(spec, output, Diagnostics(output))
        finally:
            sys.stdout.flush()
            os.dup2(stdout_fd, 1)
            os.close(stdout_fd)
        result["inputSha256"] = sha(args.input)
        write_result(output, result)
        print(json.dumps({"ok": result["ok"], "result": str(output / "result.json"), "parts": len(result["parts"]), "errors": result["errors"]}, separators=(",", ":")))
        return 0 if result["ok"] else 2
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"[:1500]
        failure = {"schemaVersion": 1, "ok": False, "parts": [], "checks": [], "errors": [message]}
        # Preserve partial files for diagnosis; they never establish a pass.
        if writable_output and not (output / "result.json").exists():
            try:
                write_result(output, failure)
            except OSError:
                pass
        print(json.dumps(failure, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
