"""No-CAD negative controls for the optional frozen-STEP illustration worker."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
module=importlib.util.spec_from_file_location('illustrate',ROOT/'cad/illustrate.py')
illustrate=importlib.util.module_from_spec(module);module.loader.exec_module(illustrate)


class IllustrationContract(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.design=self.root/'design.json';self.cad=self.root/'cad/result.json'
        self.cad.parent.mkdir();(self.cad.parent/'parts').mkdir()
        self.part=self.cad.parent/'parts/part.step';self.part.write_bytes(b'Only a hash fixture, not real STEP')
        self.spec={'units':'mm','parts':[{'id':'part','position':[1,2,3],'rotation':[10,20,30]}],'assembly':[{'id':'inspect','partIds':['part']}]}
        self.result={'parts':[{'id':'part','step':'parts/part.step','sha256':{'step':illustrate.digest(self.part)}}]}
        self.save()

    def save(self):
        self.design.write_text(json.dumps(self.spec));self.result['inputSha256']=illustrate.digest(self.design)
        self.cad.write_text(json.dumps(self.result))

    def test_exact_coverage_and_hashes(self):
        _,_,parts,steps=illustrate.load_frozen(self.design,self.cad)
        self.assertEqual(list(parts),['part']);self.assertEqual(steps[0]['id'],'inspect')
        self.part.write_bytes(b'changed')
        with self.assertRaisesRegex(illustrate.IllustrationError,'hash mismatch'):illustrate.load_frozen(self.design,self.cad)

    def test_stale_design_rejected(self):
        self.design.write_text(self.design.read_text()+' ')
        with self.assertRaisesRegex(illustrate.IllustrationError,'exact design'):illustrate.load_frozen(self.design,self.cad)

    def test_arbitrary_step_paths_are_rejected_even_with_matching_hash(self):
        self.result['parts'][0]['step']='../part.step';self.save()
        with self.assertRaisesRegex(illustrate.IllustrationError,'canonical'):illustrate.load_frozen(self.design,self.cad)

    def test_duplicate_dangling_or_unsafe_ids_rejected(self):
        for value in ['../../escape','inspect/script','x'*65]:
            self.spec['assembly'][0]['id']=value;self.save()
            with self.assertRaises(illustrate.IllustrationError):illustrate.load_frozen(self.design,self.cad)
        self.spec['assembly'][0]={'id':'inspect','partIds':['missing']};self.save()
        with self.assertRaises(illustrate.IllustrationError):illustrate.load_frozen(self.design,self.cad)

    def test_svg_is_paths_only_without_script_external_assets_or_entities(self):
        valid='<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
        self.assertEqual(illustrate.validate_svg(valid),valid.encode())
        for value in ['<svg><script>alert(1)</script></svg>','<svg><path onload="x"/></svg>','<svg><path fill="url(https://example.test/x)"/></svg>','<!DOCTYPE svg [<!ENTITY a SYSTEM "file:///x">]><svg><path/></svg>','<svg><image href="file:///secret"/></svg>','<svg/>']:
            with self.assertRaises(illustrate.IllustrationError):illustrate.validate_svg(value)

    def test_same_euler_operation_order_as_worker(self):
        class RecordingShape:
            def __init__(self):self.operations=[]
            def rotate(self,origin,axis,angle):self.operations.append(('rotate',axis,angle));return self
            def translate(self,value):self.operations.append(('translate',value));return self
        shape=RecordingShape();illustrate.transform(shape,self.spec['parts'][0])
        self.assertEqual(shape.operations,[('rotate',(0,0,1),30),('rotate',(0,1,0),20),('rotate',(1,0,0),10),('translate',(1,2,3))])

    def test_expired_budget_is_unavailable_without_starting_projection(self):
        with patch.object(illustrate.subprocess,'run') as run:
            result=illustrate.generate(self.design,self.cad,self.root/'output',budget=.01)
            run.assert_not_called()
        self.assertEqual(result['status'],'UNAVAILABLE');self.assertTrue((self.root/'output/manifest.json').is_file())

    def test_invalid_evidence_records_unavailable_and_does_not_change_cad(self):
        before=self.cad.read_bytes();self.part.write_bytes(b'changed')
        result=illustrate.generate(self.design,self.cad,self.root/'output')
        self.assertEqual(result['status'],'UNAVAILABLE');self.assertEqual(self.cad.read_bytes(),before)

    def test_existing_output_is_never_overwritten(self):
        output=self.root/'output';output.mkdir();prior=output/'manifest.json';prior.write_text('preserve')
        with self.assertRaises(illustrate.IllustrationError):illustrate.generate(self.design,self.cad,output)
        self.assertEqual(prior.read_text(),'preserve')

    def set_parts(self, count):
        self.spec['parts']=[{'id':f'part{i}','position':[0,0,0],'rotation':[0,0,0]} for i in range(count)]
        self.result['parts']=[]
        for part in self.spec['parts']:
            name=f"parts/{part['id']}.step";file=self.cad.parent/name
            file.write_bytes(b'Synthetic transport fixture, not native CAD')
            self.result['parts'].append({'id':part['id'],'step':name,'sha256':{'step':illustrate.digest(file)}})
        self.spec['assembly']=[{'id':'inspect','partIds':[self.spec['parts'][0]['id']]}]
        self.save()

    def test_49_total_parts_rejected_before_projection(self):
        self.set_parts(49)
        with self.assertRaisesRegex(illustrate.IllustrationError,'1..48 frozen parts'):
            illustrate.load_frozen(self.design,self.cad)

    def test_per_step_25_parts_remains_rejected_with_48_total(self):
        self.set_parts(48);self.spec['assembly'][0]['partIds']=[p['id'] for p in self.spec['parts'][:25]];self.save()
        with self.assertRaisesRegex(illustrate.IllustrationError,'assembly step references'):
            illustrate.load_frozen(self.design,self.cad)

    def test_oversized_step_file_still_rejected(self):
        with self.part.open('ab') as file:file.truncate(illustrate.MAX_STEP_BYTES+1)
        with self.assertRaisesRegex(illustrate.IllustrationError,'bounded regular file'):
            illustrate.load_frozen(self.design,self.cad)

    def test_actual_portable_48_part_spec_and_nine_step_references_load_unchanged(self):
        catalog=json.loads((ROOT/'catalog/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(catalog.get('schemaVersion'),1)
        self.assertIsInstance(catalog.get('components'),list)
        self.assertTrue(all(isinstance(c,dict) and isinstance(c.get('id'),str) for c in catalog['components']))
        required={'raspberry-pi-pico-r3','pololu-drv8833-2130','pololu-lp6v-1098','pololu-bracket-1086','pololu-wheel-1420','pololu-caster-950','adafruit-max4466-1063'}
        missing=required-{c['id'] for c in catalog['components']}
        if missing:self.skipTest('Source-only release lacks setup-imported catalog components: '+', '.join(sorted(missing)))
        # Existing but invalid source records must reach the strict compiler and
        # fail. Missing geometry, malformed metadata or bad hashes are not skips.
        code="""import fs from 'node:fs';
import {compileDesignKit,PORTABLE_KIT_ID} from './engineering/kit-registry.mjs';
const catalog=JSON.parse(fs.readFileSync('catalog/manifest.json','utf8'));
console.log(JSON.stringify(compileDesignKit(PORTABLE_KIT_ID,{lengthMm:180,widthMm:100,targetSpeedMS:.5,thresholdDbfs:-25},catalog).spec));"""
        compiled=subprocess.run(['node','--input-type=module','-e',code],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',check=True)
        self.spec=json.loads(compiled.stdout);self.assertEqual(len(self.spec['parts']),48)
        self.result['parts']=[]
        for part in self.spec['parts']:
            name=f"parts/{part['id']}.step";file=self.cad.parent/name
            file.write_bytes(('Only a source-identity/hash fixture: '+part['id']).encode())
            self.result['parts'].append({'id':part['id'],'step':name,'sha256':{'step':illustrate.digest(file)}})
        self.save();before=self.design.read_bytes();spec,_,parts,steps=illustrate.load_frozen(self.design,self.cad)
        self.assertEqual(spec,self.spec);self.assertEqual(len(parts),48);self.assertEqual(len(steps),9)
        self.assertEqual({p for step in steps for p in step['partIds']},set(parts))
        self.assertTrue(all(len(step['partIds'])<=24 for step in steps))
        self.assertEqual(parts['power_tray']['spec']['shape'],next(p for p in self.spec['parts'] if p['id']=='power_tray')['shape'])
        self.assertEqual(self.design.read_bytes(),before)


if __name__=='__main__':unittest.main(verbosity=2)
