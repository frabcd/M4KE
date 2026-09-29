"""Reviewed preset combinations; no printer is chosen by default."""
import hashlib
import json

CHOICES = {
    "h2c-04-pla-standard": {"machine": "Bambu Lab H2C 0.4 nozzle", "process": "0.20mm Standard @BBL H2C", "filament": "Generic PLA @BBL H2C 0.4 nozzle", "bed": "Textured PEI Plate"},
    "a1mini-04-pla-standard": {"machine": "Bambu Lab A1 mini 0.4 nozzle", "process": "0.20mm Standard @BBL A1M", "filament": "Generic PLA @BBL A1M", "bed": "Textured PEI Plate"},
}

def resolve(root, kind, name, stack=None, lineage=None):
    stack = list(stack or [])
    if name in stack or len(stack) > 24:
        raise ValueError("Preset inheritance cycle/depth limit")
    if kind not in {"machine", "process", "filament"}:
        raise ValueError("Unknown preset type")
    found = []
    for path in (root / kind).glob("*.json"):
        item = json.loads(path.read_text())
        if item.get("name", path.stem) == name:
            found.append((item, path))
    if len(found) != 1:
        raise ValueError("Missing/ambiguous exact profile: " + name)
    item, path = found[0]
    stack.append(name)
    result = {}
    if item.get("inherits"):
        result.update(resolve(root, kind, item["inherits"], stack, lineage))
    for include in item.get("include", []):
        result.update(resolve(root, kind, include, stack, lineage))
    result.update({k: v for k, v in item.items() if k not in {"include", "inherits"}})
    if lineage is not None:
        lineage.append({"name": name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "file": path.relative_to(root).as_posix()})
    return result

def selection(root, id_):
    if id_ not in CHOICES:
        raise ValueError("Unknown allowlisted profile ID; select an explicit choice")
    names = CHOICES[id_]
    lineage = {k: [] for k in ["machine", "process", "filament"]}
    resolved = {k: resolve(root, k, names[k], lineage=lineage[k]) for k in lineage}
    if any(str(v.get("instantiation")).lower() != "true" for v in resolved.values()):
        raise ValueError("Base profiles cannot be selected")
    for kind in ["process", "filament"]:
        if names["machine"] not in resolved[kind].get("compatible_printers", []):
            raise ValueError("Preset does not explicitly support selected machine/nozzle")
    model = resolve(root, "machine", resolved["machine"]["printer_model"])
    if names["bed"] in model.get("not_support_bed_type", "").split(";"):
        raise ValueError("Selected bed unsupported")
    return names, resolved, lineage

def choices(root):
    result = []
    for id_ in CHOICES:
        try:
            names, resolved, _ = selection(root, id_)
            result.append({"id": id_, "label": names["machine"] + " / Generic PLA / 0.20 mm / Textured PEI",
                           "printer": "bambu-h2c" if id_.startswith("h2c-") else "bambu-a1-mini", "nozzle": "0.4",
                           "material": "PLA", **names, "profileVerified": True})
        except Exception as exc:
            result.append({"id": id_, "profileVerified": False, "error": str(exc)})
    return result
