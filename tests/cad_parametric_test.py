"""Native contract regression fixtures; no AI-generation claim."""
import copy, importlib.util, json, math, pathlib, shutil, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'cad'))
import worker

def fixture():
    frame=lambda id,z:{'id':id,'position':[0,0,z],'rotation':[0,0,0]}
    common={'kind':'printed','material':'PLA','color':'#808080','rotation':[0,0,0]}
    return {'schemaVersion':1,'geometryVersion':2,'title':'Native fixture','units':'mm','requirements':[{'id':'R1','text':'Contact'}],
      'parts':[dict(common,id='base',name='Base',position=[0,0,0],shape={'type':'box','size':[30,30,6]},datums=[frame('top',3)]),
               dict(common,id='cap',name='Cap',position=[0,0,3],shape={'type':'profileExtrusion','points':[[-5,-5],[5,-5],[5,5],[-5,5]],'height':6},datums=[frame('bottom',0)])],
      'placement':{'version':1,'roots':[{'partId':'base','reason':'Reference'}],'attachments':[{'id':'join','requirementId':'R1','parentId':'base','parentDatum':'top','childId':'cap','childDatum':'bottom','offset':{'position':[0,0,0],'rotation':[0,0,0]},'verification':{'type':'contact','maxGapMm':.01,'maxIntersectionMm3':.001}}]}}

class Parametric(unittest.TestCase):
    def test_composed_near_gimbal_js_poses_pass_independent_native_admission(self):
        batch=[]
        for pitch in (89.99,89.99999999,89.9999999999,-89.99,-89.99999999,90,-90):
            s=fixture();s['parts'][0]['rotation']=[30,pitch,40]
            for p in s['parts']:p['datums'][0].update(position=[0,0,0],rotation=[13,27,58])
            batch.append(s)
        code="import {resolvePlacement} from './server/studio-parametric.mjs';let text='';for await(const c of process.stdin)text+=c;const batch=JSON.parse(text);for(const s of batch)s.parts=resolvePlacement(s.parts,s.placement);process.stdout.write(JSON.stringify(batch));"
        result=subprocess.run([shutil.which('node'),'--input-type=module','-e',code],cwd=ROOT,input=json.dumps(batch),text=True,capture_output=True,check=True)
        for s in json.loads(result.stdout):worker.validate_spec(s)

    def test_js_resolved_three_part_frames_match_native_transforms(self):
        import cadquery as cq
        import parametric_geometry as pg
        s=fixture();s['parts'][0].update(position=[12,-8,5],rotation=[15,25,40])
        s['parts'][0]['datums'][0]['rotation']=[5,20,7]
        s['parts'][1]['datums'][0].update(position=[1,2,-3],rotation=[-10,15,4])
        a=s['placement']['attachments'][0];a['offset']={'position':[2,-1,0],'rotation':[4,7,-20]};a['verification']={'type':'frameOnly','reason':'Transform regression; no fit claim'}
        third=copy.deepcopy(s['parts'][1]);third['id']='tip';s['parts'].append(third)
        second=copy.deepcopy(a);second.update(id='second',parentId='cap',parentDatum='bottom',childId='tip');s['placement']['attachments'].append(second)
        code="import {resolvePlacement} from './server/studio-parametric.mjs';let text='';for await(const c of process.stdin)text+=c;const s=JSON.parse(text);s.parts=resolvePlacement(s.parts,s.placement);process.stdout.write(JSON.stringify(s));"
        node=shutil.which('node');self.assertIsNotNone(node,'Node required for cross-runtime test')
        result=subprocess.run([node,'--input-type=module','-e',code],cwd=ROOT,input=json.dumps(s),text=True,capture_output=True,check=True)
        solved=json.loads(result.stdout);worker.validate_spec(solved)
        for p in solved['parts']:
            point=[.3,-.7,1.2];m=pg.matrix(p);expected=[sum(m[i][j]*point[j] for j in range(3))+m[i][3] for i in range(3)]
            actual=worker.transform(cq.Vertex.makeVertex(*point),p).Center().toTuple()
            for a,b in zip(actual,expected):self.assertAlmostEqual(a,b,places=7)
        solved['parts'][2]['rotation'][0]+=.01
        with self.assertRaisesRegex(ValueError,'pose'):worker.validate_spec(solved)

    def test_loft_step_and_local_preview_export_preserve_volume_and_bounds(self):
        import cadquery as cq
        s=fixture();s['parts'][1]['shape']={'type':'profileLoft','sections':[{'z':0,'points':[[-5,-5],[5,-5],[5,5],[-5,5]]},{'z':20,'points':[[-3,-3],[3,-3],[3,3],[-3,3]]}]}
        worker.validate_spec(s)
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);r=worker.run(s,root);self.assertTrue(r['ok'])
            steps=list(root.rglob('*.step'));stls=list(root.rglob('*.stl'));self.assertTrue(steps);self.assertTrue(stls)
            # Full assembly STEP must retain both solids; no bounding-box substitute.
            expected=30*30*6+20*(100+60+36)/3
            native=[cq.importers.importStep(str(p)).val() for p in steps]
            self.assertTrue(any(abs(shape.Volume()-expected)<1e-5 for shape in native))
            self.assertTrue(all(p.stat().st_size>84 for p in stls))
            cap=next(p for p in r['parts'] if p['id']=='cap')
            for key,values in [('min',[-5,-5,0]),('max',[5,5,20])]:
                for a,b in zip(cap['bounds'][key],values):self.assertAlmostEqual(a,b,places=6)
            self.assertTrue(cap['mesh']['closedAtWeldTolerance']);self.assertGreater(cap['mesh']['signedVolumeMm3'],0)
            self.assertLess(abs(cap['mesh']['volumeMm3']-cap['volumeMm3']),1e-5)
            self.assertEqual(next(c['status'] for c in r['checks'] if c['id']=='cap:step'),'PASS')
    def test_native_extrusion_and_loft_analytic_volumes(self):
        import cadquery as cq
        s=fixture();worker.validate_spec(s);shape=worker.build_shape(cq,s['parts'][1]);self.assertAlmostEqual(shape.Volume(),600,places=6)
        s['parts'][1]['shape']={'type':'profileLoft','sections':[{'z':0,'points':[[-5,-5],[5,-5],[5,5],[-5,5]]},{'z':20,'points':[[-3,-3],[3,-3],[3,3],[-3,3]]}]}
        worker.validate_spec(s);shape=worker.build_shape(cq,s['parts'][1]);self.assertTrue(shape.isValid());self.assertEqual(len(shape.Solids()),1);self.assertAlmostEqual(shape.Volume(),20*(100+60+36)/3,places=6)
    def test_native_rejects_false_pose_and_bad_profile(self):
        s=fixture();s['parts'][1]['position'][2]=30
        with self.assertRaisesRegex(ValueError,'pose|frame'):worker.validate_spec(s)
        s=fixture();s['parts'][1]['shape']['points']=[[0,0],[4,4],[0,4],[4,0]]
        with self.assertRaisesRegex(ValueError,'profile'):worker.validate_spec(s)
    def test_worker_actual_contact_and_failure_evidence(self):
        for offset,expected in [(0,'PASS'),(17.5,'FAIL'),(-2,'FAIL')]:
            s=fixture();s['placement']['attachments'][0]['offset']['position'][2]=offset;s['parts'][1]['position'][2]+=offset
            worker.validate_spec(s)
            with tempfile.TemporaryDirectory() as tmp:
                r=worker.run(s,pathlib.Path(tmp));check=next(c for c in r['checks'] if c['id']=='attachment:join')
                self.assertEqual(check['status'],expected)
                if offset==0:self.assertTrue(r['ok']);self.assertTrue(all(p['valid'] for p in r['parts']))
    def test_native_requires_geometry_version_and_preserves_source_immutability(self):
        s=fixture();del s['geometryVersion']
        with self.assertRaisesRegex(ValueError,'geometryVersion'):worker.validate_spec(s)
        s=fixture();s['parts'][1]['kind']='purchased'
        with self.assertRaisesRegex(ValueError,'printed'):worker.validate_spec(s)

if __name__=='__main__':unittest.main()
