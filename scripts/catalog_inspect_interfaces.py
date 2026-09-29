#!/usr/bin/env python3
"""Offline native surface inventory; does not assign functional meaning to faces."""
import hashlib
import json
from pathlib import Path
import cadquery as cq
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane

ROOT = Path(__file__).resolve().parents[1] / "catalog"
PATHS = ["models/pico/Pico-R3.step", "sources/pololu-2130.step", "models/pololu-motors/No Encoder/mmgm-pm.step",
         "models/pololu-motors/With Bracket/mmgm-pm-with-1086-bracket.step",
         "sources/pololu-1086.step", "sources/pololu-950.step"]
PATHS += [p.relative_to(ROOT).as_posix() for p in (ROOT / "models/pololu-wheels-60x8").rglob("*.step")]

def vec(v):
    return [round(v.X(), 6), round(v.Y(), 6), round(v.Z(), 6)]

def bbox(b):
    return [[round(b.xmin, 6), round(b.ymin, 6), round(b.zmin, 6)],
            [round(b.xmax, 6), round(b.ymax, 6), round(b.zmax, 6)]]

records = []
for rel in PATHS:
    path = ROOT / rel
    if not path.is_file():
        continue
    shape = cq.importers.importStep(str(path)).val()
    faces = []
    for i, face in enumerate(shape.Faces()):
        surface = BRepAdaptor_Surface(face.wrapped)
        if surface.GetType() == GeomAbs_Cylinder:
            cylinder = surface.Cylinder()
            faces.append({"faceIndex": i, "radiusMm": round(cylinder.Radius(), 6),
                          "axisLocationMm": vec(cylinder.Location()), "axisDirection": vec(cylinder.Axis().Direction()),
                          "boundsMm": bbox(face.BoundingBox())})
    record = {"path": rel, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "coordinateFrame": "untransformed manufacturer STEP source, mm",
              "boundsMm": bbox(shape.BoundingBox()), "solidCount": len(shape.Solids()),
              "cylinders": faces}
    records.append(record)
    print(json.dumps(record), flush=True)
(ROOT / "interface-surface-inventory.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
