"""Native geometry regressions: no mocks and no generated-design rewriting."""
import importlib.util, math, pathlib, unittest
import cadquery as cq
root=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cut_worker',root/'cad/worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
def part(shape=None):
 return {'id':'support','shape':shape or {'type':'box','size':[20,20,10]},'fillet':0,'holes':[],'pockets':[]}
class CutDiagnostics(unittest.TestCase):
 def test_complete_hole_removal_reports_part_and_feature(self):
  p=part({'type':'cylinder','radius':10,'height':30});p['holes']=[{'axis':'z','diameter':22,'position':[0,0,15]}]
  with self.assertRaisesRegex(worker.SpecError,'support: hole 0 removes all solid material'):worker.build_shape(cq,p)
 def test_recorded_union_bearing_failure(self):
  p=part({'type':'union','solids':[{'type':'cylinder','radius':10,'height':30,'position':[0,0,15],'rotation':[0,0,0]},{'type':'cylinder','radius':11,'height':2,'position':[0,0,1],'rotation':[0,0,0]}]});p['holes']=[{'axis':'z','diameter':22,'position':[0,0,15]},{'axis':'z','diameter':4.5,'position':[-20,0,1]},{'axis':'z','diameter':4.5,'position':[20,0,1]}]
  with self.assertRaisesRegex(worker.SpecError,'support: hole 0 removes all solid material'):worker.build_shape(cq,p)
 def test_complete_pocket_removal_reports_part_and_feature(self):
  p=part();p['pockets']=[{'size':[22,22,12],'position':[0,0,0]}]
  with self.assertRaisesRegex(worker.SpecError,'support: pocket 0 removes all solid material'):worker.build_shape(cq,p)
 def test_valid_bore_keeps_exact_volume(self):
  p=part();p['holes']=[{'axis':'z','diameter':4,'position':[0,0,99]}];v=worker.build_shape(cq,p)
  self.assertTrue(v.isValid());self.assertEqual(len(v.Solids()),1);self.assertAlmostEqual(v.Volume(),4000-40*math.pi,places=5)
 def test_valid_cavity_retains_floor(self):
  p=part();p['pockets']=[{'size':[16,16,9],'position':[0,0,1.5]}];v=worker.build_shape(cq,p)
  self.assertEqual(len(v.Solids()),1);self.assertAlmostEqual(v.Volume(),1952,places=5)
 def test_missing_hole_stays_rejected(self):
  p=part();p['holes']=[{'axis':'z','diameter':4,'position':[30,0,0]}]
  with self.assertRaisesRegex(worker.SpecError,'does not remove material'):worker.build_shape(cq,p)
 def test_missing_pocket_stays_rejected(self):
  p=part();p['pockets']=[{'size':[2,2,2],'position':[30,0,0]}]
  with self.assertRaisesRegex(worker.SpecError,'does not remove material'):worker.build_shape(cq,p)
 def test_disconnected_cut_stays_rejected(self):
  p=part();p['pockets']=[{'size':[2,22,12],'position':[0,0,0]}]
  with self.assertRaisesRegex(worker.SpecError,'one valid positive-volume solid'):worker.build_shape(cq,p)
if __name__=='__main__':unittest.main()
