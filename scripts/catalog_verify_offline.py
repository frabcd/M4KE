#!/usr/bin/env python3
"""Replay all exact assets with network connections disabled; fixture tests too."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import socket
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cad"))
import cadquery
from catalog_geometry import load_catalog_component, CatalogError
from catalog_geometry_test import CatalogGeometryTests

def no_network(*args, **kwargs):
    raise AssertionError("Network use forbidden during offline catalog replay")

socket.create_connection = no_network
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
root = ROOT / "catalog"
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
index = json.loads((root / "source-index.json").read_text())
manifest = json.loads((root / "manifest.json").read_text())
source_results = [{"path": s["path"], "pass": sha(root / s["path"]) == s["sha256"]} for s in index["sources"]]
imports = []
for component in manifest["components"]:
    if component.get("geometry"):
        shape, metadata = load_catalog_component(component["id"], root)
        imports.append({"catalogId": component["id"], "pass": shape.isValid(), "boundsMm": metadata["boundsMm"], "stepSha256": metadata["stepSha256"]})
    else:
        try:
            load_catalog_component(component["id"], root)
            raise AssertionError("Missing geometry must fail closed")
        except CatalogError:
            imports.append({"catalogId": component["id"], "pass": True, "expectedFailure": "no STEP source"})
result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(CatalogGeometryTests))
report = {"schemaVersion": 1, "at": datetime.now(timezone.utc).isoformat(), "manifestSha256": sha(root / "manifest.json"),
          "networkConnectFunctionsBlocked": True, "sourceHashes": source_results, "imports": imports,
          "fixtureTests": {"run": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)},
          "physicalTests": "NOT_PERFORMED"}
report["pass"] = all(r["pass"] for r in source_results + imports) and result.wasSuccessful()
(root / "offline-replay.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print(json.dumps({"pass": report["pass"], "sources": len(source_results), "components": len(imports), "fixtureTests": report["fixtureTests"]}))
raise SystemExit(0 if report["pass"] else 1)
