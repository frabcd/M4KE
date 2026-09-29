"""Real OCCT source identity/frame tests; no physical qualification claims."""
import unittest,tempfile,json,hashlib,sys
from pathlib import Path
import cadquery as cq
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'cad'))
from library_geometry import load_library_component

class LibrarySourceTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='m4ke-source13-');self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);(self.root/'models').mkdir()
  shape=cq.Workplane('XY').box(10,20,30).translate((7,12,19)).val()
  source=self.root/'temp.step';cq.exporters.export(shape,str(source));self.sha=hashlib.sha256(source.read_bytes()).hexdigest()
  self.source=self.root/'models'/f'{self.sha}.step';source.rename(self.source)
  b=shape.BoundingBox();self.bounds=[b.xmin,b.ymin,b.zmin,b.xmax,b.ymax,b.zmax]
  self.entry={'sourceSha256':self.sha,'file':f'models/{self.sha}.step','units':'mm','frame':'source-origin','sourceBoundsMm':self.bounds,'solidCount':1,'faceCount':6}
  self.save()
 def save(self):
  (self.root/'manifest.json').write_text(json.dumps({'schema':'m4ke-job-library-snapshot-1','entries':[self.entry]}))
 def test_original_origin_and_dimensions(self):
  shape,e=load_library_component(self.sha,self.root)
  self.assertAlmostEqual(shape.Volume(),6000,places=6)
  self.assertEqual(e['sourceToLocal']['translationMm'],[0,0,0]);self.assertEqual(e['sourceToLocal']['scale'],1)
  actual=[*e['sourceBoundsMm']['min'],*e['sourceBoundsMm']['max']]
  for a,b in zip(actual,self.bounds):self.assertAlmostEqual(a,b,places=6)
 def test_source_change_rejected_even_with_cache(self):
  cache={};load_library_component(self.sha,self.root,cache)
  self.source.write_bytes(self.source.read_bytes()+b'\nchanged')
  with self.assertRaisesRegex(ValueError,'hash mismatch'):load_library_component(self.sha,self.root,cache)
 def test_frame_or_scale_claim_cannot_hide_in_manifest(self):
  for field,value in [('units','m'),('frame','centered'),('sourceBoundsMm',[0,0,0,10,20,30]),('faceCount',5),('solidCount',2)]:
   old=self.entry[field];self.entry[field]=value;self.save()
   with self.assertRaises(ValueError):load_library_component(self.sha,self.root)
   self.entry[field]=old
 def test_path_and_symlink_rejected(self):
  self.entry['file']='../temp.step';self.save()
  with self.assertRaisesRegex(ValueError,'Unsafe'):load_library_component(self.sha,self.root)
  self.entry['file']=f'models/{self.sha}.step';self.save()
  other=self.root/'other.step';self.source.rename(other);self.source.symlink_to(other)
  with self.assertRaisesRegex(ValueError,'Invalid source'):load_library_component(self.sha,self.root)
 def test_cached_shapes_are_isolated(self):
  cache={};one,e=load_library_component(self.sha,self.root,cache);e['sourceToLocal']['scale']=123
  two,second=load_library_component(self.sha,self.root,cache)
  self.assertEqual(second['sourceToLocal']['scale'],1);self.assertIsNot(one,two)

if __name__=='__main__':unittest.main()
