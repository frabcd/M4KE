"""Fail-closed input tests. No printer actions and no successful slices requested."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import adapter
import profiles

class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "parts").mkdir()
        self.stl = self.root / "parts/test.stl"
        self.stl.write_bytes(b"test fixture" + bytes(100))
        self.result = {"ok": True, "parts": [{"id": "test", "kind": "printed", "valid": True, "stl": "parts/test.stl", "sha256": {"stl": hashlib.sha256(self.stl.read_bytes()).hexdigest()}}]}
        self.save()

    def save(self):
        (self.root / "result.json").write_text(json.dumps(self.result))

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self):
        adapter.slice_part(self.stl, "h2c-04-pla-standard", adapter.BASE / "jobs/negative-not-created")

    def test_purchased_is_rejected(self):
        self.result["parts"][0]["kind"] = "purchased"
        self.save()
        with self.assertRaisesRegex(ValueError, "printed"):
            self.invoke()

    def test_stale_hash_is_rejected(self):
        self.stl.write_bytes(self.stl.read_bytes() + b"changed")
        with self.assertRaisesRegex(ValueError, "hash"):
            self.invoke()

    def test_failed_cad_is_rejected(self):
        self.result["ok"] = False
        self.save()
        with self.assertRaisesRegex(ValueError, "successful"):
            self.invoke()

    def test_invalid_shape_is_rejected(self):
        self.result["parts"][0]["valid"] = False
        self.save()
        with self.assertRaisesRegex(ValueError, "valid printed"):
            self.invoke()

    def test_output_escape_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "fresh child"):
            adapter.slice_part(self.stl, "h2c-04-pla-standard", self.root / "outside")

    def test_profile_path_not_accepted(self):
        with self.assertRaisesRegex(ValueError, "allowlisted"):
            profiles.selection(self.root, "../../malicious.json")

    def test_duplicate_parts_rejected(self):
        self.result["parts"].append(dict(self.result["parts"][0]))
        self.save()
        with self.assertRaisesRegex(ValueError, "printed"):
            self.invoke()

if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests))
    report = {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors), "pass": result.wasSuccessful(), "printerOperations": False}
    (adapter.BASE / "evidence/adapter-tests.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    raise SystemExit(0 if result.wasSuccessful() else 1)
