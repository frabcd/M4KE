"""Run with the CAD virtualenv. Offline, temporary fixtures only."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import cadquery as cq
from catalog_geometry import CatalogError, load_catalog_component


class CatalogGeometryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "models").mkdir()
        self.step = self.root / "models" / "two.step"
        a = cq.Workplane("XY").box(10, 20, 2).val()
        b = cq.Workplane("XY").box(2, 2, 4).translate((0, 0, 5)).val()
        cq.exporters.export(cq.Compound.makeCompound([a, b]), str(self.step))
        self.entry = {"id": "fixture", "manufacturer": "TEST FIXTURE", "sku": "not real",
                      "geometry": {"step": "models/two.step", "sha256": hashlib.sha256(self.step.read_bytes()).hexdigest(),
                                   "units": "mm", "frame": {"method": "bbox-center", "rotationDeg": [0, 0, 90]}}}
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self, extra=None):
        (self.root / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "components": [self.entry] + (extra or [])}))

    def test_real_import_multisolid_and_centred_frame(self):
        shape, meta = load_catalog_component("fixture", self.root)
        self.assertEqual(meta["solidCount"], 2)
        self.assertTrue(meta["valid"])
        self.assertAlmostEqual(meta["boundsMm"][0], 20)
        self.assertAlmostEqual(meta["boundsMm"][1], 10)
        self.assertAlmostEqual(shape.BoundingBox().center.x, 0)
        self.assertAlmostEqual(shape.BoundingBox().center.z, 0)
        self.assertIsNone(meta["massG"])

    def test_tampered_step_fails(self):
        self.step.write_bytes(self.step.read_bytes() + b"\ntampered")
        with self.assertRaisesRegex(CatalogError, "SHA256"):
            load_catalog_component("fixture", self.root)

    def test_unknown_id_fails(self):
        with self.assertRaisesRegex(CatalogError, "Unknown"):
            load_catalog_component("missing", self.root)

    def test_traversal_id_fails(self):
        with self.assertRaises(CatalogError):
            load_catalog_component("../fixture", self.root)

    def test_traversal_path_fails(self):
        self.entry["geometry"]["step"] = "models/../../secret.step"
        self.save()
        with self.assertRaises(CatalogError):
            load_catalog_component("fixture", self.root)

    def test_scale_fails(self):
        self.entry["geometry"]["scale"] = 2
        self.save()
        with self.assertRaisesRegex(CatalogError, "scaling"):
            load_catalog_component("fixture", self.root)

    def test_duplicate_id_fails(self):
        self.save([copy.deepcopy(self.entry)])
        with self.assertRaisesRegex(CatalogError, "Duplicate"):
            load_catalog_component("fixture", self.root)

    def test_wrong_dimensions_fail(self):
        self.entry["geometry"]["boundsMm"] = [21, 10, 8]
        self.save()
        with self.assertRaisesRegex(CatalogError, "dimensions"):
            load_catalog_component("fixture", self.root)

    def test_wrong_translation_fails(self):
        self.entry["geometry"]["sourceToLocal"] = {"rotationDegXYZ": [0, 0, 90], "rotationOrderApplied": "Z,Y,X", "translationMm": [0, 0, 99], "scale": 1}
        self.save()
        with self.assertRaisesRegex(CatalogError, "translation"):
            load_catalog_component("fixture", self.root)

    def test_wrong_units_fail(self):
        self.entry["geometry"]["units"] = "inch"
        self.save()
        with self.assertRaisesRegex(CatalogError, "mm"):
            load_catalog_component("fixture", self.root)

    def test_no_geometry_fails(self):
        self.entry["geometry"] = None
        self.save()
        with self.assertRaisesRegex(CatalogError, "no verified STEP"):
            load_catalog_component("fixture", self.root)

    def test_unexpected_frame_options_fail(self):
        self.entry["geometry"]["frame"]["url"] = "https://example.invalid"
        self.save()
        with self.assertRaisesRegex(CatalogError, "frame"):
            load_catalog_component("fixture", self.root)


if __name__ == "__main__":
    unittest.main(verbosity=2)
