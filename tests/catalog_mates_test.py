"""Generic mate-tool regression; fixtures are not a hand-designed toy or car."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'cad'))
import catalog_mates as mates
from catalog_geometry import CatalogError,load_catalog_component,resolve_component
import worker
KERNEL='--kernel' in sys.argv
if KERNEL:sys.argv.remove('--kernel')
CATALOG=ROOT/'catalog'
if '--catalog-root' in sys.argv:
    index=sys.argv.index('--catalog-root');CATALOG=Path(sys.argv[index+1]);del sys.argv[index:index+2]


def request():return {'id':'mate','requirementId':'fit','type':'catalogMate','shaftPartId':'shaft','shaftInterfaceId':'output','borePartId':'hub','boreInterfaceId':'bore','minimumEngagementMm':3,'diametralClearanceMm':[0,.2]}
def interface(kind='shaft-axis',diameter=3):return {'id':'output' if kind=='shaft-axis' else 'bore','type':kind,'origin':[0,0,0],'axis':[0,0,1],'supportIntervalsMm':[[0,9]],'diameterMm':diameter,'lineage':{'stepSha256':'synthetic unit fixture'}}
def pose(position=None,rotation=None):return {'position':position or [0,0,0],'rotation':rotation or [0,0,0]}


class MathTests(unittest.TestCase):
    def run_mate(self,shaft=None,bore=None,a=None,b=None,r=None):return mates.evaluate_mate(r or request(),shaft or interface(),bore or interface('d-shaft-bore'),a or pose(),b or pose())
    def test_nominal_aligned_is_never_physical_fit_pass(self):
        value=self.run_mate();self.assertEqual(value['status'],'UNKNOWN');self.assertEqual(value['nominalGeometryStatus'],'PASS');self.assertEqual(value['axialEngagementMm'],9)
        for key in ['dFlatOrientation','tolerance','retention','physicalFit']:self.assertEqual(value[key],'UNKNOWN')
    def test_antiparallel_axis_and_rigid_transform_preserve_engagement(self):
        value=self.run_mate(b=pose([0,0,9],[180,0,0]));self.assertEqual(value['nominalGeometryStatus'],'PASS');self.assertAlmostEqual(value['axialEngagementMm'],9)
        common=pose([25,-41,130],[40,30,70]);rotated=self.run_mate(a=common,b=common);self.assertEqual(rotated['nominalGeometryStatus'],'PASS');self.assertAlmostEqual(rotated['axialEngagementMm'],9)
    def test_radial_offset_angle_gap_and_floating_parts_fail(self):
        for b in [pose([1,0,0]),pose([0,0,30]),pose(rotation=[90,0,0]),pose(rotation=[.2,0,0])]:self.assertEqual(self.run_mate(b=b)['status'],'FAIL')
        self.assertEqual(self.run_mate(bore=interface('d-shaft-bore',2.9))['status'],'FAIL')
        self.assertEqual(self.run_mate(bore=interface('d-shaft-bore',3.5))['status'],'FAIL')
    def test_partial_and_disjoint_native_support_not_bounding_length(self):
        shaft=interface();shaft['supportIntervalsMm']=[[0,1],[7,9]]
        self.assertEqual(self.run_mate(shaft=shaft)['axialEngagementMm'],3)
        self.assertEqual(self.run_mate(b=pose([0,0,7]))['status'],'FAIL')
        self.assertEqual(self.run_mate(b=pose([0,0,5]))['axialEngagementMm'],4)
    def test_worker_validator_accepts_ids_only_and_rejects_forged_axes(self):
        spec=json.loads((ROOT/'cad/smoke-spec.json').read_text());spec['requirements']=[{'id':'fit','text':'Check native interfaces'}]
        spec['parts']=spec['parts'][:2]
        for p,pid in zip(spec['parts'],['shaft','hub']):
            p.update(id=pid,kind='purchased',shape={'type':'catalog','catalogId':'synthetic'})
            for key in ['fillet','holes','pockets']:p.pop(key,None)
        spec['verificationRequests']=[request()];worker.validate_spec(copy.deepcopy(spec))
        for edit in [lambda r:r.update(axis=[0,0,1]),lambda r:r.update(borePartId='shaft'),lambda r:r.update(shaftInterfaceId='../bad'),lambda r:r.update(diametralClearanceMm=[.2,0])]:
            bad=copy.deepcopy(spec);edit(bad['verificationRequests'][0])
            with self.assertRaises(worker.SpecError):worker.validate_spec(bad)


@unittest.skipUnless(KERNEL,'requires actual CadQuery')
class NativeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import cadquery as cq
        from OCP.BRepAdaptor import BRepAdaptor_Surface
        from OCP.GeomAbs import GeomAbs_Cylinder
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name);(cls.root/'models').mkdir()
        cls.source=cq.Solid.makeCylinder(1.5,10)
        step=cls.root/'models/fixture.step';cq.exporters.export(cls.source,str(step),'STEP');source_hash=hashlib.sha256(step.read_bytes()).hexdigest()
        imported=cq.importers.importStep(str(step)).val();face_index=next(i for i,f in enumerate(imported.Faces()) if BRepAdaptor_Surface(f.wrapped).GetType()==GeomAbs_Cylinder)
        inventory=[{'path':'models/fixture.step','sha256':source_hash,'cylinders':[{'faceIndex':face_index,'radiusMm':1.5}]}]
        raw=json.dumps(inventory).encode();(cls.root/'interface-surface-inventory.json').write_bytes(raw)
        cls.component={'id':'fixture','geometry':{'step':'models/fixture.step','sha256':source_hash,'units':'mm','frame':{'method':'bbox-center','rotationDeg':[0,0,0]}}}
        (cls.root/'manifest.json').write_text(json.dumps({'schemaVersion':1,'components':[cls.component]}))
        cls.shape,cls.metadata=load_catalog_component('fixture',cls.root)
        frame=cls.metadata['sourceToLocal'];cls.record={'id':'output','type':'shaft-axis','coordinateFrame':'catalog-local-centred-mm','dimensions':{'centresMm':[mates.transform(p,[0,0,0],frame['translationMm']) for p in [[0,0,0],[0,0,10]]],'axis':[0,0,1],'diameterMm':3},'sourceCoordinates':{'centresMm':[[0,0,0],[0,0,10]],'axis':[0,0,1]},'sourceArtifact':'models/fixture.step','sourceSha256':source_hash,'sourceToLocal':frame,'evidenceArtifact':'interface-surface-inventory.json','evidenceSha256':hashlib.sha256(raw).hexdigest(),'faceIndices':[face_index],'reconciliation':'source-step-to-catalog-local-reconciled'}
        cls.component['interfaces']=[cls.record]
        (cls.root/'manifest.json').write_text(json.dumps({'schemaVersion':1,'components':[cls.component]}))
        cls.shape,cls.metadata=load_catalog_component('fixture',cls.root)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def load(self,record=None,shape=None):return mates.load_interface(self.component,record or self.record,self.metadata,shape or self.shape,self.root)
    def test_actual_native_support_is_measured(self):self.assertEqual(self.load()['supportIntervalsMm'],[[0.0,10.0]])
    def test_source_frame_hash_path_face_axis_and_dimensions_tampering_rejected(self):
        edits=[lambda r:r.update(sourceSha256='0'*64),lambda r:r.update(evidenceSha256='0'*64),lambda r:r.update(evidenceArtifact='../inventory.json'),lambda r:r.update(faceIndices=[999]),lambda r:r['dimensions'].update(diameterMm=4),lambda r:r['dimensions'].update(axis=[1,0,0]),lambda r:r['dimensions']['centresMm'][0].__setitem__(0,1),lambda r:r['sourceToLocal'].update(scale=2),lambda r:r.update(type='clearance-hole')]
        for edit in edits:
            record=copy.deepcopy(self.record);edit(record)
            with self.assertRaises(CatalogError):self.load(record)
    def test_native_surface_cannot_be_replaced_by_metadata_matching_wrong_shape(self):
        import cadquery as cq
        with self.assertRaises(CatalogError):self.load(shape=cq.Solid.makeCylinder(2,10).translate((0,0,-5)))
    def test_uncovered_output_is_critical_unknown_not_nonintersection_pass(self):
        spec={'parts':[{'id':'shaft','shape':{'type':'catalog','catalogId':'fixture'},**pose()}],'verificationRequests':[]}
        checks=mates.catalog_mate_checks(spec,{'shaft':self.shape},{'shaft':self.metadata},self.root)
        self.assertEqual(len(checks),1);self.assertIn('uncovered',checks[0]['id']);self.assertEqual(checks[0]['status'],'UNKNOWN')
    def test_unknown_interface_request_retains_uncovered_claim(self):
        spec={'parts':[{'id':pid,'shape':{'type':'catalog','catalogId':'fixture'},**pose()} for pid in ['shaft','hub']],'verificationRequests':[request()]}
        checks=mates.catalog_mate_checks(spec,{pid:self.shape for pid in ['shaft','hub']},{pid:self.metadata for pid in ['shaft','hub']},self.root)
        self.assertEqual(checks[0]['status'],'UNKNOWN');self.assertEqual(len([c for c in checks if 'uncovered' in c['id']]),2)
    def test_stale_manifest_cannot_rebind_an_already_imported_native_part(self):
        spec={'parts':[{'id':'shaft','shape':{'type':'catalog','catalogId':'fixture'},**pose()}],'verificationRequests':[]}
        stale=copy.deepcopy(self.metadata);stale['manifestSha256']='0'*64
        checks=mates.catalog_mate_checks(spec,{'shaft':self.shape},{'shaft':stale},self.root)
        self.assertEqual(checks[0]['status'],'UNKNOWN');self.assertIn('changed after',checks[0]['observed'])
    def test_full_native_worker_emits_interface_coverage_and_hashes_exact_exports(self):
        import catalog_geometry
        spec={'schemaVersion':1,'title':'Isolated native source-interface fixture','units':'mm','parts':[{'id':'shaft','name':'Fixture shaft','kind':'purchased','material':'test fixture','color':'#123456','shape':{'type':'catalog','catalogId':'fixture'},**pose()}]}
        with tempfile.TemporaryDirectory() as tmp,patch.object(catalog_geometry,'DEFAULT_CATALOG_ROOT',self.root):
            result=worker.run(worker.validate_spec(spec),Path(tmp))
            self.assertEqual(next(c for c in result['checks'] if c['id']=='catalog-mate-uncovered:shaft:output')['status'],'UNKNOWN')
            self.assertEqual(next(c for c in result['checks'] if c['id']=='physical:function')['status'],'UNKNOWN')
            for part in result['parts']:
                for kind in ['stl','step']:self.assertEqual(worker.sha(Path(tmp)/part[kind]),part['sha256'][kind])
    def test_actual_catalog_motor_and_bore_bind_without_modifying_source(self):
        if not (CATALOG/'models').exists():self.skipTest('actual catalog source files are remote')
        loaded=[];before=hashlib.sha256((CATALOG/'manifest.json').read_bytes()).hexdigest()
        for cid,iid in [('pololu-lp6v-1098','native-output-shaft'),('pololu-wheel-1420','hub-bore')]:
            shape,metadata=load_catalog_component(cid,CATALOG);root,_,c,_,_=resolve_component(cid,CATALOG);record=next(i for i in c['interfaces'] if i['id']==iid);loaded.append(mates.load_interface(c,record,metadata,shape,root))
        shaft,bore=loaded;self.assertAlmostEqual(sum(b-a for a,b in shaft['supportIntervalsMm']),9.23,places=3)
        self.assertAlmostEqual(sum(b-a for a,b in bore['supportIntervalsMm']),9.25,places=3)
        s=pose(rotation=[0,90,0]);target=mates.transform(shaft['origin'],s['rotation']);b=pose([target[i]-bore['origin'][i] for i in range(3)])
        result=mates.evaluate_mate(request(),shaft,bore,s,b);self.assertEqual(result['nominalGeometryStatus'],'PASS');self.assertEqual(result['status'],'UNKNOWN')
        self.assertEqual(hashlib.sha256((CATALOG/'manifest.json').read_bytes()).hexdigest(),before)


if __name__=='__main__':unittest.main(verbosity=2)
