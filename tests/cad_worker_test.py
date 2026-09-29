"""Stdlib validation tests; --kernel also exercises real CadQuery geometry."""
import copy
import importlib.util
import io
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cad_worker", ROOT / "cad" / "worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
KERNEL = "--kernel" in sys.argv
if KERNEL:
    sys.argv.remove("--kernel")


def sample():
    return json.loads((ROOT / "cad" / "smoke-spec.json").read_text())


def union_part():
    return {"id":"stand", "name":"Single-print stand", "kind":"printed", "material":"PLA", "color":"#336699",
            "shape":{"type":"union", "solids":[
                {"type":"box","size":[40,30,8],"position":[0,0,0],"rotation":[0,0,0]},
                {"type":"cylinder","radius":5,"height":30,"position":[0,0,17],"rotation":[0,0,0]}]},
            "position":[0,0,4], "rotation":[0,0,0], "fillet":0, "holes":[], "pockets":[]}


class Validation(unittest.TestCase):
    def test_pair_fingerprint_preserves_geometry_and_source_identity(self):
        p=union_part();same=copy.deepcopy(p);same.update(id='other',position=[100,0,0],name='Other')
        self.assertEqual(worker.geometry_fingerprint(p),worker.geometry_fingerprint(same))
        same['holes']=[{'axis':'z','diameter':2,'position':[0,0,0]}]
        self.assertNotEqual(worker.geometry_fingerprint(p),worker.geometry_fingerprint(same))
        p['shape']={'type':'catalog','catalogId':'example'}
        with self.assertRaises(worker.SpecError):worker.geometry_fingerprint(p)
        self.assertNotEqual(worker.geometry_fingerprint(p,{'stepSha256':'a','manifestSha256':'b'}),worker.geometry_fingerprint(p,{'stepSha256':'a','manifestSha256':'c'}))

    def test_pair_cache_uses_exact_poses_and_returns_unshared_summaries(self):
        a={'id':'a','position':[0.,0.,0.],'rotation':[0.,0.,0.]};b={'id':'b','position':[1.,0.,0.],'rotation':[0.,0.,0.]}
        shape=mock.Mock();shape.Volume.return_value=2.
        calculate=mock.Mock(return_value=shape);cache=worker.ExactIntersectionCache()
        with mock.patch.object(worker,'bounds',return_value={'min':[0.,0.,0.],'max':[1.,2.,1.],'size':[1.,2.,1.]}):
            first=cache.measure(a,b,'shape-a','shape-b',calculate);first['intersectionBoundsMm']['min'][0]=999
            aa=dict(a,position=[140.,0.,0.]);bb=dict(b,position=[141.,0.,0.])
            second=cache.measure(aa,bb,'shape-a','shape-b',calculate)
            self.assertEqual(calculate.call_count,1);self.assertEqual(second['volumeMm3'],2.)
            self.assertEqual(second['intersectionBoundsMm'],{'min':[140.,0.,0.],'max':[141.,2.,1.],'size':[1.,2.,1.]})
            near=dict(bb,position=[math.nextafter(141.,math.inf),0.,0.]);cache.measure(aa,near,'shape-a','shape-b',calculate)
            changed=dict(bb,rotation=[0.,0.,360.]);cache.measure(aa,changed,'shape-a','shape-b',calculate)
            cache.measure(aa,bb,'shape-changed','shape-b',calculate)
            self.assertEqual(calculate.call_count,4)

    def test_diagnostics_are_bounded_and_last_operation_survives_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp);stream=io.StringIO();trace=worker.Diagnostics(output,max_bytes=500,stream=stream)
            for i in range(12):trace.record('assembly-intersection',f'a:b{i}','RUNNING')
            self.assertLessEqual((output/'diagnostics.jsonl').stat().st_size,500)
            last=json.loads((output/'diagnostics-last.json').read_text())
            self.assertEqual(last['operation'],'a:b11');self.assertEqual(last['status'],'RUNNING')
            self.assertTrue(last['journalTruncated']);self.assertFalse(last['verificationEvidence'])
            self.assertEqual(last['sequence'],12)

    def test_diagnostics_retain_measured_completion_or_exception_not_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            trace=worker.Diagnostics(Path(tmp),stream=io.StringIO())
            self.assertEqual(worker.timed(trace,'part-build','body',lambda:42),42)
            self.assertEqual(trace.last['status'],'COMPLETE');self.assertGreaterEqual(trace.last['durationMs'],0)
            def bad():raise ValueError('test only')
            with self.assertRaises(ValueError):worker.timed(trace,'part-build','bad',bad)
            self.assertEqual(trace.last['status'],'ERROR');self.assertEqual(trace.last['operation'],'bad')

    def test_rotation_frame_must_be_an_existing_part(self):
        s=sample();s['requirements']=[{'id':'R1','text':'Rotate'}]
        r={'id':'move','requirementId':'R1','type':'rotationSweep','partIds':[s['parts'][0]['id']],
           'axis':'z','originMm':[0,0,0],'minDeg':0,'maxDeg':90,'framePartId':s['parts'][0]['id']}
        s['verificationRequests']=[r];worker.validate_spec(copy.deepcopy(s))
        for value in ['missing',None,[],True]:
            r['framePartId']=value
            with self.assertRaises(worker.SpecError):worker.validate_spec(copy.deepcopy(s))

    def test_roundtrip_source_drift_is_unknown_not_pass_and_printed_stays_strict(self):
        args = (True, 1, 1, 1e-12, 0.0068, 10786)
        self.assertEqual(worker.roundtrip_status(*args, True), "UNKNOWN")
        self.assertEqual(worker.roundtrip_status(*args, False), "FAIL")
        self.assertEqual(worker.roundtrip_status(True, 1, 1, 0, 0.00001, 1000, True), "PASS")
        self.assertEqual(worker.roundtrip_status(True, 1, 1, 0, 0.02, 10786, True), "FAIL")
        self.assertEqual(worker.roundtrip_status(False, 1, 1, 0, 0, 10786, True), "FAIL")
        self.assertEqual(worker.roundtrip_status(True, 2, 1, 0, 0, 10786, True), "FAIL")
        self.assertEqual(worker.roundtrip_status(True, 1, 1, 0.001, 0, 10786, True), "FAIL")

    def reject(self, edit):
        s = sample()
        edit(s)
        with self.assertRaises(worker.SpecError):
            worker.validate_spec(s)

    def test_valid(self):
        self.assertEqual(len(worker.validate_spec(sample())["parts"]), 3)

    def test_part_explanation_is_optional_preserved_and_geometry_inert(self):
        legacy = worker.validate_spec(sample())
        self.assertNotIn("explanation", legacy["parts"][0])
        explained = copy.deepcopy(legacy)
        explanation = {"purpose": "Support the assembly", "placementReason": "At the base",
                       "selectionReason": "Printed mounting geometry"}
        explained["parts"][0]["explanation"] = explanation
        result = worker.validate_spec(explained)
        self.assertEqual(result["parts"][0]["explanation"], explanation)
        self.assertEqual(worker.geometry_fingerprint(legacy["parts"][0]),
                         worker.geometry_fingerprint(result["parts"][0]))

    def test_part_explanation_rejects_invalid_metadata(self):
        valid = {"purpose": "Purpose", "placementReason": "Placement", "selectionReason": "Choice"}
        invalid = [None, [], {}, {"purpose": "Purpose"}, dict(valid, evidence="PASS")]
        for key in valid:
            for value in [None, 1, "", "   ", "a" * 1001, "safe\x00unsafe", "a" * 1000 + " "]:
                invalid.append(dict(valid, **{key: value}))
        for explanation in invalid:
            with self.subTest(explanation=explanation):
                self.reject(lambda s: s["parts"][0].update(explanation=explanation))

    def test_catalog_explanation_uses_same_validation(self):
        s = sample()
        part = s["parts"][0]
        part.update(kind="purchased", shape={"type": "catalog", "catalogId": "example"},
                    explanation={"purpose": "Component", "placementReason": "Assembly", "selectionReason": "Fits"})
        for key in ("fillet", "holes", "pockets"):
            part.pop(key, None)
        self.assertEqual(worker.validate_spec(copy.deepcopy(s))["parts"][0]["explanation"], part["explanation"])
        part["explanation"]["purpose"] = ""
        with self.assertRaises(worker.SpecError):
            worker.validate_spec(s)

    def test_union_bounded_inert_members(self):
        s=sample();s["parts"]=[union_part()]
        self.assertEqual(len(worker.validate_spec(s)["parts"][0]["shape"]["solids"]),2)
        edits=[lambda p:p.update(kind="purchased"),
               lambda p:p["shape"].update(solids=p["shape"]["solids"]*5),
               lambda p:p["shape"]["solids"][0].update(type="union"),
               lambda p:p["shape"]["solids"][0].update(type="catalog"),
               lambda p:p["shape"]["solids"][0].update(code="unsafe()"),
               lambda p:p["shape"]["solids"][0].update(position=[251,0,0]),
               lambda p:p["shape"]["solids"][0].update(rotation=[0,False,0]),
               lambda p:p["shape"]["solids"][0].update(radius=3)]
        for edit in edits:
            s=sample();s["parts"]=[union_part()];edit(s["parts"][0])
            with self.assertRaises(worker.SpecError):worker.validate_spec(s)

    def test_path_traversal(self):
        self.reject(lambda s: s["parts"][0].update(id="../../escape"))

    def test_duplicate_ids(self):
        self.reject(lambda s: s["parts"][1].update(id="base"))

    def test_nonfinite(self):
        self.reject(lambda s: s["parts"][0].update(position=[math.nan, 0, 0]))

    def test_boolean_dimension(self):
        self.reject(lambda s: s["parts"][0]["shape"].update(size=[True, 20, 30]))

    def test_oversize(self):
        self.reject(lambda s: s["parts"][0]["shape"].update(size=[501, 20, 30]))

    def test_cylinder_diameter_limit(self):
        self.reject(lambda s: s["parts"][1]["shape"].update(radius=251))

    def test_parts_limit(self):
        s = sample()
        original = s["parts"][0]
        s["parts"] = [dict(copy.deepcopy(original), id=f"p{i}") for i in range(48)]
        self.assertEqual(len(worker.validate_spec(s)["parts"]), 48)
        s["parts"].append(dict(copy.deepcopy(original), id="p48"))
        with self.assertRaisesRegex(worker.SpecError, "1..48"):
            worker.validate_spec(s)

    def test_hole_limit(self):
        self.reject(lambda s: s["parts"][0].update(holes=s["parts"][0]["holes"] * 9))

    def test_code_not_supported(self):
        self.reject(lambda s: s["parts"][0].update(code="print('never execute')"))

    def test_feature_not_silently_ignored(self):
        self.reject(lambda s: s["parts"][0].update(chamfer=2))

    def test_fillet_limit(self):
        self.reject(lambda s: s["parts"][0].update(fillet=5))

    def test_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "duplicate.json"
            p.write_text('{"schemaVersion":1,"schemaVersion":2}')
            with self.assertRaises(worker.SpecError):
                worker.read_spec(p)

    def test_catalog_contract(self):
        s = sample()
        p = s["parts"][0]
        p.update(kind="purchased", shape={"type":"catalog", "catalogId":"raspberry-pi-pico-r3"})
        for key in ("holes", "fillet"):
            p.pop(key, None)
        self.assertEqual(worker.validate_spec(s)["parts"][0]["shape"]["type"], "catalog")
        p["shape"]["catalogId"] = "../../escape"
        with self.assertRaises(worker.SpecError): worker.validate_spec(s)
        p["shape"]["catalogId"] = "raspberry-pi-pico-r3"
        p["holes"] = []
        with self.assertRaises(worker.SpecError): worker.validate_spec(s)

    def test_pocket_contract(self):
        s = sample()
        s["parts"][0]["pockets"] = [{"size":[20,10,4], "position":[0,0,3]}]
        self.assertEqual(len(worker.validate_spec(s)["parts"][0]["pockets"]), 1)
        s["parts"][0]["pockets"][0]["size"][0] = float("nan")
        with self.assertRaises(worker.SpecError): worker.validate_spec(s)

    def test_existing_output_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "retained.txt"
            marker.write_text("keep")
            run = subprocess.run([sys.executable, str(ROOT / "cad" / "worker.py"), "--input", str(ROOT / "cad" / "smoke-spec.json"), "--output", tmp], capture_output=True, text=True)
            self.assertEqual(run.returncode, 2)
            self.assertEqual(marker.read_text(), "keep")
            self.assertFalse((Path(tmp) / "result.json").exists())


@unittest.skipUnless(KERNEL, "pass --kernel in isolated CAD environment")
class Kernel(unittest.TestCase):
    def test_rotation_proven_neutral_collision_short_circuits_fail_not_pass(self):
        import cadquery as cq
        beam=union_part();beam.update(id='beam',shape={'type':'box','size':[20,2,2]},position=[0,0,0])
        obstacle=union_part();obstacle.update(id='obstacle',shape={'type':'box','size':[3,3,3]},position=[8,0,0])
        s=sample();s.update(parts=[beam,obstacle],requirements=[{'id':'R1','text':'Rotate'}],verificationRequests=[{'id':'motion','requirementId':'R1','type':'rotationSweep','partIds':['beam'],'axis':'z','originMm':[0,0,0],'minDeg':-180,'maxDeg':180}])
        s=worker.validate_spec(s);world=[(p['id'],worker.transform(worker.build_shape(cq,p),p)) for p in s['parts']]
        exact_volume=world[0][1].intersect(world[1][1]).Volume()
        self.assertGreater(exact_volume,1e-5)
        with mock.patch.object(cq.Shape,'intersect',side_effect=AssertionError('known exact neutral intersection must not be recomputed')):
            result=worker.requested_checks(cq,s,world,known_intersections={frozenset(('beam','obstacle')):exact_volume})[0]
        self.assertEqual(result['status'],'FAIL');observed=result['observed']
        self.assertEqual(observed['requestedAnglesDeg'],[-180,-120,-60,0,60,120,180])
        self.assertEqual(observed['evaluatedAnglesDeg'],[0]);self.assertTrue(observed['earlyExitAfterCollision'])
        self.assertEqual(observed['coverage'],'PARTIAL_FAILURE_PROVEN');self.assertEqual(observed['collisions'][0]['intersectionMm3'],exact_volume)

    def test_exact_pair_cache_matches_native_translated_intersection(self):
        import cadquery as cq
        a={'id':'a','position':[0.,0.,0.],'rotation':[0.,0.,0.]};b={'id':'b','position':[5.,0.,0.],'rotation':[0.,0.,0.]}
        shape=cq.Workplane('XY').box(10,10,10).val();right=shape.translate((5,0,0));cache=worker.ExactIntersectionCache()
        first=cache.measure(a,b,'cube','cube',lambda:shape.intersect(right))
        aa=dict(a,id='aa',position=[140.,0.,0.]);bb=dict(b,id='bb',position=[145.,0.,0.])
        calculate=mock.Mock(side_effect=AssertionError('identical translated pair must reuse exact result'))
        reused=cache.measure(aa,bb,'cube','cube',calculate)
        direct=shape.translate((140,0,0)).intersect(right.translate((140,0,0)))
        self.assertEqual(cache.hits,1);self.assertAlmostEqual(reused['volumeMm3'],direct.Volume(),places=8)
        self.assertEqual(reused['intersectionBoundsMm'],worker.bounds(direct))
        self.assertEqual(first['volumeMm3']>1e-5,reused['volumeMm3']>1e-5)

    def test_rotation_bounds_are_computed_once_per_immutable_shape_and_pose(self):
        import cadquery as cq
        beam=union_part();beam.update(id='beam',shape={'type':'box','size':[20,2,2]},position=[0,0,0])
        obstacle=union_part();obstacle.update(id='obstacle',shape={'type':'box','size':[3,3,3]},position=[0,8,0])
        distant=copy.deepcopy(obstacle);distant.update(id='distant',position=[100,100,100])
        s=sample();s.update(parts=[beam,obstacle,distant],requirements=[{'id':'R1','text':'Rotate beam'}],verificationRequests=[{'id':'motion','requirementId':'R1','type':'rotationSweep','partIds':['beam'],'axis':'z','originMm':[0,0,0],'minDeg':0,'maxDeg':90}])
        spec=worker.validate_spec(s);world=[(p['id'],worker.transform(worker.build_shape(cq,p),p)) for p in spec['parts']]
        with mock.patch.object(worker,'bounds',wraps=worker.bounds) as measured:
            c=worker.requested_checks(cq,spec,world)[0]
        self.assertEqual(measured.call_count,3+sum(a!=0 for a in c['observed']['evaluatedAnglesDeg']))
        self.assertEqual(c['status'],'FAIL')
        self.assertTrue(any(x['angleDeg']>0 for x in c['observed']['collisions']))
        self.assertFalse(any('distant' in x['parts'] for x in c['observed']['collisions']))

    def test_catalog_cache_reuses_only_hash_bound_immutable_source(self):
        import cadquery as cq
        module_spec=importlib.util.spec_from_file_location('catalog_test_module',ROOT/'cad'/'catalog_geometry.py')
        catalog=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(catalog)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'sources').mkdir();source=root/'sources'/'part.step'
            cq.exporters.export(cq.Workplane('XY').box(10,20,30).val(),str(source),exportType='STEP')
            manifest={'schemaVersion':1,'components':[{'id':'test-part','geometry':{'step':'sources/part.step','units':'mm','sha256':worker.sha(source),'frame':{'method':'bbox-center','rotationDeg':[0,0,0]}}}]}
            (root/'manifest.json').write_text(json.dumps(manifest));cache={}
            with mock.patch.object(cq.importers,'importStep',wraps=cq.importers.importStep) as importer:
                first,metadata=catalog.load_catalog_component('test-part',root,cache=cache)
                cq.exporters.export(first,str(root/'meshed.stl'),exportType='STL')
                second,_=catalog.load_catalog_component('test-part',root,cache=cache)
                self.assertEqual(importer.call_count,1);self.assertIsNot(first,second)
                self.assertFalse(first.wrapped.IsPartner(second.wrapped))
                moved=worker.transform(first,{'position':[100,0,0],'rotation':[0,90,0]})
                self.assertAlmostEqual(worker.bounds(first)['max'][0],5,places=6)
                self.assertGreater(worker.bounds(moved)['min'][0],80)
                manifest['components'][0]['geometry']['frame']['rotationDeg']=[0,0,90]
                (root/'manifest.json').write_text(json.dumps(manifest))
                third,_=catalog.load_catalog_component('test-part',root,cache=cache)
                self.assertEqual(importer.call_count,2);self.assertAlmostEqual(worker.bounds(third)['max'][0],10)
                source.write_bytes(source.read_bytes()+b'\nchanged')
                with self.assertRaisesRegex(catalog.CatalogError,'SHA256 mismatch'):
                    catalog.load_catalog_component('test-part',root,cache=cache)

    def test_requested_rotation_uses_part_local_frame_without_changing_criterion(self):
        import cadquery as cq
        beam=union_part();beam.update(id='beam',shape={'type':'box','size':[20,2,2]},position=[10,20,30],rotation=[0,90,0])
        obstacle=union_part();obstacle.update(id='obstacle',shape={'type':'box','size':[3,3,3]},position=[10,28,30])
        s=sample();s.update(parts=[beam,obstacle],requirements=[{'id':'R1','text':'Rotate beam'}],verificationRequests=[{'id':'motion','requirementId':'R1','type':'rotationSweep','partIds':['beam'],'framePartId':'beam','axis':'z','originMm':[0,0,0],'minDeg':0,'maxDeg':90}])
        def result():
            spec=worker.validate_spec(copy.deepcopy(s))
            return worker.requested_checks(cq,spec,[(p['id'],worker.transform(worker.build_shape(cq,p),p))for p in spec['parts']])[0]
        c=result();self.assertEqual(c['status'],'FAIL');self.assertEqual(c['observed']['worldOriginMm'],[10,20,30])
        for value,wanted in zip(c['observed']['worldAxisDirection'],[1,0,0]):self.assertAlmostEqual(value,wanted,places=7)
        self.assertTrue(any(x['angleDeg']>0 for x in c['observed']['collisions']))
        for p in s['parts']:p['position']=[x+10 for x in p['position']]
        self.assertEqual(result()['status'],'FAIL');self.assertEqual(result()['observed']['worldOriginMm'],[20,30,40])
        s['parts'][1]['position'][1]=45;self.assertEqual(result()['status'],'PASS')

    def test_requested_shaft_engagement_and_envelope_fail_on_floating_post(self):
        import cadquery as cq
        s=sample();base=union_part();base.update(id='base',shape={'type':'box','size':[30,30,10]},position=[0,0,5],holes=[{'axis':'z','diameter':10.4,'position':[0,0,0]}])
        post=union_part();post.update(id='post',shape={'type':'cylinder','radius':5,'height':30},position=[0,0,25])
        s['parts']=[base,post];s['requirements']=[{'id':'R1','text':'Test engagement'}]
        s['verificationRequests']=[{'id':'mate','requirementId':'R1','type':'shaftHole','shaftPartId':'post','holePartId':'base','holeIndex':0,'minimumEngagementMm':5,'diametralClearanceMm':[.2,.5]}, {'id':'size','requirementId':'R1','type':'envelope','partIds':['base','post'],'maxSizeMm':[30,30,35]}]
        def checks():
            spec=worker.validate_spec(copy.deepcopy(s));world=[(p['id'],worker.transform(worker.build_shape(cq,p),p))for p in spec['parts']]
            return worker.requested_checks(cq,spec,world)
        failed=checks();self.assertEqual([x['status']for x in failed],['FAIL','FAIL']);self.assertAlmostEqual(failed[0]['observed']['axialEngagementMm'],0)
        s['parts'][1]['position'][2]=20;passed=checks();self.assertEqual([x['status']for x in passed],['PASS','PASS']);self.assertAlmostEqual(passed[0]['observed']['axialEngagementMm'],5)
        s['parts'][1]['position'][0]=1;self.assertEqual(checks()[0]['status'],'FAIL')
        s['parts'][1]['position'][0]=0;s['parts'][1]['fillet']=.5;self.assertEqual(checks()[0]['status'],'UNKNOWN')

    def test_requested_rotation_detects_non_neutral_collision(self):
        import cadquery as cq
        s=sample();beam=union_part();beam.update(id='beam',shape={'type':'box','size':[20,2,2]},position=[0,0,0])
        obstacle=union_part();obstacle.update(id='obstacle',shape={'type':'box','size':[3,3,3]},position=[0,8,0])
        s.update(parts=[beam,obstacle],requirements=[{'id':'R1','text':'Rotate beam'}],verificationRequests=[{'id':'motion','requirementId':'R1','type':'rotationSweep','partIds':['beam'],'axis':'z','originMm':[0,0,0],'minDeg':0,'maxDeg':90}])
        def checks():
            spec=worker.validate_spec(copy.deepcopy(s));return worker.requested_checks(cq,spec,[(p['id'],worker.transform(worker.build_shape(cq,p),p))for p in spec['parts']])
        c=checks()[0];self.assertEqual(c['status'],'FAIL');self.assertTrue(any(x['angleDeg']>0 for x in c['observed']['collisions']));self.assertFalse(any(x['angleDeg']==0 for x in c['observed']['collisions']))
        s['parts'][1]['position'][1]=15;clear=checks()[0];self.assertEqual(clear['status'],'PASS');self.assertEqual(sorted(clear['observed']['evaluatedAnglesDeg']),clear['observed']['requestedAnglesDeg']);self.assertEqual(clear['observed']['coverage'],'ALL_REQUESTED_SAMPLES');self.assertFalse(clear['observed']['earlyExitAfterCollision'])

    def test_union_exact_volume_and_connected_solid(self):
        import cadquery as cq
        p=union_part();shape=worker.build_shape(cq,p)
        self.assertTrue(shape.isValid());self.assertEqual(len(shape.Solids()),1)
        self.assertAlmostEqual(shape.Volume(),40*30*8+math.pi*25*28,places=5)
        self.assertAlmostEqual(worker.bounds(shape)["max"][2],32,places=6)
        p["shape"]["solids"][1]["position"]=[0,0,40]
        with self.assertRaisesRegex(worker.SpecError,"connected"):worker.build_shape(cq,p)

    def test_union_member_frame_and_post_fusion_cut(self):
        import cadquery as cq
        p=union_part();p["shape"]["solids"][1].update(position=[17,0,0],rotation=[0,90,0])
        shape=worker.build_shape(cq,p)
        self.assertAlmostEqual(worker.bounds(shape)["max"][0],32,places=6)
        p["holes"]=[{"axis":"z","diameter":2,"position":[0,0,0]}]
        cut=worker.build_shape(cq,p)
        self.assertAlmostEqual(shape.Volume()-cut.Volume(),math.pi*8,places=5)
        p=union_part();p["shape"]["solids"][0].update(size=[500,20,8],position=[-50,0,0])
        p["shape"]["solids"][1].update(type="box",size=[500,20,8],position=[50,0,0]);p["shape"]["solids"][1].pop("radius");p["shape"]["solids"][1].pop("height")
        with self.assertRaisesRegex(worker.SpecError,"extent"):worker.build_shape(cq,p)

    def test_separate_rigid_overlap_is_failure_with_matched_clear_control(self):
        s=sample();p=union_part();p["shape"]={"type":"box","size":[10,10,10]};s["parts"]=[p,dict(copy.deepcopy(p),id="second",position=[5,0,4])]
        with tempfile.TemporaryDirectory() as tmp:
            result=worker.run(worker.validate_spec(s),Path(tmp)/"overlap")
            c=next(c for c in result["checks"] if c["id"]=="assembly:overlaps")
            self.assertEqual(c["status"],"FAIL");self.assertFalse(result["ok"])
            self.assertAlmostEqual(c["observed"][0]["volumeMm3"],500,places=5)
            collision_bounds = c["observed"][0]["intersectionBoundsMm"]
            self.assertEqual([round(b-a, 5) for a, b in zip(collision_bounds["min"], collision_bounds["max"])], [5, 10, 10])
            s["parts"][1]["position"]=[10,0,4]
            result=worker.run(worker.validate_spec(s),Path(tmp)/"touching")
            c=next(c for c in result["checks"] if c["id"]=="assembly:overlaps")
            self.assertEqual(c["status"],"PASS");self.assertTrue(result["ok"])

    def test_pocket_volume_and_no_silent_cut_fallback(self):
        import cadquery as cq
        s = sample()
        p = s["parts"][0]
        p.update(shape={"type":"box","size":[40,30,8]},fillet=0,holes=[],pockets=[{"size":[30,20,10],"position":[0,0,4]}])
        p = worker.validate_spec(s)["parts"][0]
        shape = worker.build_shape(cq,p)
        self.assertAlmostEqual(shape.Volume(),6600,places=5)
        self.assertEqual(len(shape.Solids()),1)
        p["pockets"][0]["position"] = [100,0,0]
        with self.assertRaises(worker.SpecError): worker.build_shape(cq,p)
        p["pockets"] = [{"size":[2,40,10],"position":[0,0,0]}]
        with self.assertRaises(worker.SpecError): worker.build_shape(cq,p)

    def test_smoke_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "job"
            run = subprocess.run([sys.executable, str(ROOT / "cad" / "worker.py"), "--input", str(ROOT / "cad" / "smoke-spec.json"), "--output", str(out)], capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            final = json.loads(run.stdout)
            self.assertTrue(final["ok"])
            result = json.loads((out / "result.json").read_text())
            self.assertEqual(len(result["parts"]), 3)
            self.assertFalse(any(x["status"] == "FAIL" for x in result["checks"]))
            for p in result["parts"]:
                self.assertTrue(p["valid"])
                self.assertEqual(p["solidCount"], 1)
                self.assertGreater(p["volumeMm3"], 0)
                self.assertEqual(worker.sha(out / p["stl"]), p["sha256"]["stl"])
                self.assertEqual(worker.sha(out / p["step"]), p["sha256"]["step"])
            self.assertEqual(next(x for x in result["checks"] if x["id"] == "physical:function")["status"], "UNKNOWN")

    def test_xyz_transform_independent_matrix(self):
        import cadquery as cq
        p = worker.validate_spec(sample())["parts"][2]
        transformed = worker.transform(worker.build_shape(cq, p), p)
        # Independently calculate Three.js Euler XYZ matrix on all box vertices.
        x, y, z = map(math.radians, p["rotation"])
        a, b, c, d, e, f = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
        matrix = [[c * e, -c * f, d], [a * f + b * e * d, a * e - b * f * d, -b * c], [b * f - a * e * d, b * e + a * f * d, a * c]]
        vertices = [[i, j, k] for i in (-5, 5) for j in (-10, 10) for k in (-15, 15)]
        points = [[sum(row[k] * v[k] for k in range(3)) + p["position"][axis] for axis, row in enumerate(matrix)] for v in vertices]
        observed = worker.bounds(transformed)
        for axis in range(3):
            self.assertAlmostEqual(observed["min"][axis], min(v[axis] for v in points), places=6)
            self.assertAlmostEqual(observed["max"][axis], max(v[axis] for v in points), places=6)

    def test_hole_volume(self):
        import cadquery as cq
        p = worker.validate_spec(sample())["parts"][0]
        p["fillet"] = 0
        shape = worker.build_shape(cq, p)
        expected = 60 * 40 * 8 - 4 * math.pi * (3.2 / 2) ** 2 * 8
        self.assertAlmostEqual(shape.Volume(), expected, places=5)

    def test_missing_hole_fails(self):
        import cadquery as cq
        p = worker.validate_spec(sample())["parts"][0]
        p["holes"][0]["position"] = [450, 450, 0]
        with self.assertRaises(worker.SpecError):
            worker.build_shape(cq, p)

    def test_holes_all_axes(self):
        import cadquery as cq
        for axis in "xyz":
            p = worker.validate_spec(sample())["parts"][0]
            p["shape"]["size"] = [20, 20, 20]
            p["fillet"] = 0
            p["holes"] = [{"axis": axis, "diameter": 4, "position": [0, 0, 0]}]
            shape = worker.build_shape(cq, p)
            self.assertAlmostEqual(shape.Volume(), 20 ** 3 - math.pi * 2 ** 2 * 20, places=5)

    def test_duplicate_hole_fails(self):
        import cadquery as cq
        p = worker.validate_spec(sample())["parts"][0]
        p["holes"] = p["holes"][:1] * 2
        with self.assertRaises(worker.SpecError):
            worker.build_shape(cq, p)

    def test_cutting_part_apart_fails(self):
        import cadquery as cq
        p = worker.validate_spec(sample())["parts"][0]
        p["fillet"] = 0
        p["holes"] = [{"axis": "z", "diameter": 45, "position": [0, 0, 0]}]
        with self.assertRaises(worker.SpecError):
            worker.build_shape(cq, p)


if __name__ == "__main__":
    unittest.main(verbosity=2)
