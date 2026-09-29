"""Real-kernel blind bore regressions, including finite engagement and legacy behavior."""
import copy, importlib.util, json, math, pathlib, tempfile, unittest
import cadquery as cq
ROOT=pathlib.Path(__file__).resolve().parents[1]
module=importlib.util.spec_from_file_location('depth_worker',ROOT/'cad/worker.py')
worker=importlib.util.module_from_spec(module);module.loader.exec_module(worker)
def bore(axis='z',depth=5,center=7.5,diameter=4):
 p=[0,0,0];p['xyz'.index(axis)]=center
 return dict(axis=axis,diameter=diameter,position=p,**({} if depth is None else {'depth':depth}))
def part(holes):
 return dict(id='body',shape={'type':'box','size':[20,20,20]},fillet=0,holes=holes,pockets=[],position=[0,0,0],rotation=[0,0,0])
class DepthTests(unittest.TestCase):
 def test_finite_bore_survives_native_step_and_stl_export(self):
  spec=json.loads((ROOT/'cad/smoke-spec.json').read_text())
  p=spec['parts'][0];p.update(shape={'type':'box','size':[20,20,20]},fillet=0,holes=[bore()],pockets=[],position=[0,0,0],rotation=[0,0,0])
  spec['parts']=[p]
  with tempfile.TemporaryDirectory() as tmp:
   result=worker.run(worker.validate_spec(spec),pathlib.Path(tmp))
   self.assertTrue(result['ok'],result['errors'])
   shape=cq.importers.importStep(str(pathlib.Path(tmp)/result['parts'][0]['step'])).val()
   self.assertAlmostEqual(shape.Volume(),8000-20*math.pi,places=5)
   self.assertAlmostEqual(shape.intersect(cq.Workplane('XY').box(1,1,1).val()).Volume(),1,places=6)
   self.assertEqual(result['parts'][0]['sha256']['stl'],worker.sha(pathlib.Path(tmp)/result['parts'][0]['stl']))
 def test_blind_bore_retains_floor_on_every_axis(self):
  for axis in 'xyz':
   with self.subTest(axis=axis):
    shape=worker.build_shape(cq,part([bore(axis)]))
    self.assertTrue(shape.isValid());self.assertEqual(len(shape.Solids()),1)
    self.assertAlmostEqual(shape.Volume(),8000-20*math.pi,places=5)
    floor=[0,0,0];floor['xyz'.index(axis)]=4.5
    self.assertAlmostEqual(shape.intersect(cq.Workplane('XY').box(1,1,1).val().translate(tuple(floor))).Volume(),1,places=6)
 def test_legacy_through_hole_still_ignores_axial_coordinate(self):
  for axis in 'xyz':
   for center in [-500,0,500]:
    self.assertAlmostEqual(worker.build_shape(cq,part([bore(axis,None,center)])).Volume(),8000-80*math.pi,places=5)
 def test_counterbore_retains_annular_shoulder_in_either_order(self):
  holes=[bore(depth=5,diameter=10),bore(depth=None)]
  for order in [holes,list(reversed(holes))]:
   shape=worker.build_shape(cq,part(order))
   self.assertAlmostEqual(shape.Volume(),8000-185*math.pi,places=5)
   witness=cq.Workplane('XY').box(1,1,1).val().translate((3.5,0,4.5))
   self.assertAlmostEqual(shape.intersect(witness).Volume(),1,places=6)
 def test_finite_off_body_or_duplicate_cut_stays_rejected(self):
  for holes in [[bore(center=100)],[bore(),bore()]]:
   with self.assertRaisesRegex(worker.SpecError,'does not remove material'):worker.build_shape(cq,part(holes))
 def test_native_validator_accepts_only_bounded_finite_depth(self):
  for depth in [.5,500,5]:
   spec=json.loads((ROOT/'cad/smoke-spec.json').read_text());spec['parts'][0]['holes']=[bore(depth=depth)]
   self.assertEqual(worker.validate_spec(spec)['parts'][0]['holes'][0]['depth'],depth)
  for depth in [0,-1,.49,501,True,None,'5',math.inf,math.nan]:
   spec=json.loads((ROOT/'cad/smoke-spec.json').read_text());hole=bore();hole['depth']=depth;spec['parts'][0]['holes']=[hole]
   with self.assertRaises(worker.SpecError):worker.validate_spec(spec)
 def test_shaft_engagement_cannot_extend_beyond_blind_depth(self):
  body=part([bore()]);pin=dict(part([]),id='pin',shape={'type':'cylinder','radius':1.9,'height':20})
  request=dict(id='fit',type='shaftHole',requirementId='R1',shaftPartId='pin',holePartId='body',holeIndex=0,minimumEngagementMm=6,diametralClearanceMm=[.1,.3])
  spec={'parts':[body,pin],'verificationRequests':[request]}
  shapes=[(p['id'],worker.transform(worker.build_shape(cq,p),p)) for p in spec['parts']]
  result=worker.requested_checks(cq,spec,shapes)[0]
  self.assertEqual(result['status'],'FAIL')
  self.assertAlmostEqual(result['observed']['axialEngagementMm'],5,places=6)
 def test_wider_counterbore_does_not_count_as_support_for_narrow_shaft(self):
  body=part([bore(depth=None),bore(depth=5,diameter=10)])
  pin=dict(part([]),id='pin',shape={'type':'cylinder','radius':1.9,'height':20})
  request=dict(id='fit',type='shaftHole',requirementId='R1',shaftPartId='pin',holePartId='body',holeIndex=0,minimumEngagementMm=18,diametralClearanceMm=[.1,.3])
  spec={'parts':[body,pin],'verificationRequests':[request]}
  shapes=[(p['id'],worker.transform(worker.build_shape(cq,p),p)) for p in spec['parts']]
  result=worker.requested_checks(cq,spec,shapes)[0]
  self.assertEqual(result['status'],'FAIL')
  self.assertAlmostEqual(result['observed']['axialEngagementMm'],15,places=6)
if __name__=='__main__':unittest.main()
