"""Offline, allowlisted purchased-component STEP import.

The caller supplies a catalog ID, never an executable, scale factor or model path.
catalog_root is a trusted deployment/test setting and MUST NOT come from model/user
part input. Coordinates: fixed catalogue XYZ Euler rotation (Z, then Y, then X),
then translate the rotated bounding-box centre to (0,0,0). Units remain mm.
Drawing coordinates are NOT reconciled with STEP coordinates by this operation.
"""
from __future__ import annotations

import hashlib
from copy import deepcopy
import json
import math
from pathlib import Path, PurePosixPath
import re

ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,95}$")
MAX_STEP_BYTES = 80 * 1024 * 1024
DEFAULT_CATALOG_ROOT = Path(__file__).resolve().parents[1] / "catalog"


class CatalogError(ValueError):
    pass


def _digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _vector(value, label, bound=360):
    if not isinstance(value, list) or len(value) != 3 or any(
        isinstance(v, bool) or not isinstance(v, (float, int)) or not math.isfinite(v) or abs(v) > bound
        for v in value
    ):
        raise CatalogError(label + " must be three finite bounded numbers")
    return [float(v) for v in value]


def resolve_component(catalog_id, catalog_root=None):
    if not isinstance(catalog_id, str) or not ID_RE.fullmatch(catalog_id):
        raise CatalogError("Invalid catalogue ID")
    root = Path(catalog_root or DEFAULT_CATALOG_ROOT).resolve(strict=True)
    manifest_path = root / "manifest.json"
    if manifest_path.stat().st_size > 2 * 1024 * 1024:
        raise CatalogError("Catalogue manifest exceeds size limit")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if type(manifest.get("schemaVersion")) is not int or manifest["schemaVersion"] != 1:
        raise CatalogError("Unsupported catalogue version")
    components = manifest.get("components")
    if not isinstance(components, list) or len(components) > 500:
        raise CatalogError("Invalid component list")
    ids = [c.get("id") for c in components if isinstance(c, dict)]
    if len(ids) != len(components) or len(set(ids)) != len(ids):
        raise CatalogError("Duplicate or malformed catalogue entries")
    matches = [c for c in components if c.get("id") == catalog_id]
    if len(matches) != 1:
        raise CatalogError("Unknown catalogue ID")
    component = matches[0]
    geometry = component.get("geometry")
    if not isinstance(geometry, dict) or not geometry.get("step"):
        raise CatalogError("Component has no verified STEP geometry")
    if geometry.get("units") != "mm":
        raise CatalogError("Catalogue geometry must explicitly use mm")
    if "scale" in geometry or "scaling" in geometry:
        raise CatalogError("Catalogue geometry scaling is forbidden")
    rel_string = geometry["step"]
    if not isinstance(rel_string, str) or len(rel_string) > 400 or "\\" in rel_string or ":" in rel_string:
        raise CatalogError("Unsafe catalogue path")
    rel = PurePosixPath(rel_string)
    if rel.is_absolute() or ".." in rel.parts or not rel.parts or rel.parts[0] not in {"sources", "models"}:
        raise CatalogError("STEP must be an allowlisted catalogue-relative path")
    if rel.suffix.lower() not in {".step", ".stp"}:
        raise CatalogError("Expected STEP file")
    path = root.joinpath(*rel.parts).resolve(strict=True)
    if not path.is_relative_to(root) or not path.is_file():
        raise CatalogError("STEP path escapes catalogue")
    if not 20 <= path.stat().st_size <= MAX_STEP_BYTES:
        raise CatalogError("STEP file exceeds size bounds")
    expected = geometry.get("sha256")
    if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{64}", expected) or _digest(path) != expected:
        raise CatalogError("STEP SHA256 mismatch")
    frame = geometry.get("frame")
    if not isinstance(frame, dict) or set(frame) - {"method", "rotationDeg", "description"} or frame.get("method") != "bbox-center":
        raise CatalogError("Unsupported catalogue frame")
    rotation = _vector(frame.get("rotationDeg"), "frame.rotationDeg")
    return root, manifest_path, component, path, rotation


def load_catalog_component(catalog_id, catalog_root=None, cache=None):
    """Return (CadQuery Shape, evidence dict); fails closed on any mismatch."""
    import cadquery as cq

    _, manifest_path, component, path, rotation = resolve_component(catalog_id, catalog_root)
    # Per-build cache only: each access still resolves and hashes source bytes.
    # Any source/manifest change invalidates the entry; no global stale geometry.
    manifest_hash = _digest(manifest_path)
    cache_key = (str(path), catalog_id, component['geometry']['sha256'], manifest_hash)
    if cache is not None and cache_key in cache:
        cached_shape, cached_metadata = cache[cache_key]
        # STL meshing attaches triangulation to OCCT topology. A deep geometry
        # copy without meshes prevents one instance's export changing another's
        # bounds or STEP round-trip diagnostics.
        return cached_shape.copy(mesh=False), deepcopy(cached_metadata)
    imported = cq.importers.importStep(str(path))
    values = imported.vals()
    if not values or not all(isinstance(v, cq.Shape) for v in values):
        raise CatalogError("STEP contained no importable shapes")
    shape = values[0] if len(values) == 1 else cq.Compound.makeCompound(values)
    solids = shape.Solids()
    if not 1 <= len(solids) <= 3000 or not shape.isValid() or any(not s.isValid() for s in solids):
        raise CatalogError("Purchased STEP contains invalid solids")
    source_bbox = shape.BoundingBox()
    # Three.js XYZ convention: active rotations applied Z then Y then X.
    for axis, degree in [((0, 0, 1), rotation[2]), ((0, 1, 0), rotation[1]), ((1, 0, 0), rotation[0])]:
        if degree:
            shape = shape.rotate((0, 0, 0), axis, degree)
    rotated = shape.BoundingBox()
    centre = [(rotated.xmin + rotated.xmax) / 2, (rotated.ymin + rotated.ymax) / 2, (rotated.zmin + rotated.zmax) / 2]
    translation = [-v for v in centre]
    shape = shape.translate(tuple(translation))
    b = shape.BoundingBox()
    bounds = [b.xlen, b.ylen, b.zlen]
    if any(not math.isfinite(v) or not 0.01 <= v <= 2000 for v in bounds):
        raise CatalogError("STEP dimensions outside catalogue bounds")
    expected_bounds = component["geometry"].get("boundsMm")
    if expected_bounds is not None:
        expected_bounds = _vector(expected_bounds, "geometry.boundsMm", 2000)
        if any(abs(a-b) > 0.002 for a, b in zip(bounds, expected_bounds)):
            raise CatalogError("STEP dimensions differ from recorded catalogue bounds")
    expected_solids = component["geometry"].get("solidCount")
    if expected_solids is not None and expected_solids != len(solids):
        raise CatalogError("STEP solid count differs from catalogue")
    metadata = {
        "catalogId": catalog_id, "manufacturer": component.get("manufacturer"), "sku": component.get("sku"),
        "stepSha256": component["geometry"]["sha256"], "manifestSha256": manifest_hash,
        "units": "mm", "boundsMm": bounds, "solidCount": len(solids), "valid": shape.isValid(),
        "sourceBoundsMm": {"min": [source_bbox.xmin, source_bbox.ymin, source_bbox.zmin], "max": [source_bbox.xmax, source_bbox.ymax, source_bbox.zmax]},
        "sourceToLocal": {"rotationDegXYZ": rotation, "rotationOrderApplied": "Z,Y,X", "translationMm": translation,
                          "equation": "local_mm = Rx * Ry * Rz * source_mm + translationMm", "scale": 1},
        "localFrame": "centred rotated bounding box; no scaling",
        "interfaceReconciliation": "Drawing/source interface coordinates are not transformed unless separately reconciled and recorded.",
        "massG": component.get("massG"), "physicalFit": "UNKNOWN",
    }
    recorded = component["geometry"].get("sourceToLocal")
    if recorded is not None:
        if recorded.get("scale") != 1:
            raise CatalogError("Source-to-local scale record mismatch")
        if recorded.get("rotationDegXYZ") != rotation or recorded.get("rotationOrderApplied") != "Z,Y,X":
            raise CatalogError("Source-to-local rotation record mismatch")
        expected_translation = _vector(recorded.get("translationMm"), "sourceToLocal.translationMm", 100000)
        if any(abs(a-b) > 0.002 for a, b in zip(translation, expected_translation)):
            raise CatalogError("Source-to-local translation record mismatch")
    if cache is not None:
        cache[cache_key] = (shape, metadata)
        return shape.copy(mesh=False), deepcopy(metadata)
    return shape, metadata
