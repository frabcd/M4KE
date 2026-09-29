"""No network, model, printer or publication actions; temporary ZIPs only."""
import importlib.util
import ast
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('submission_package', ROOT / 'scripts/package-submission.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
restore_spec=importlib.util.spec_from_file_location('submission_restore',ROOT/'scripts/restore-submission-catalog.py')
restore=importlib.util.module_from_spec(restore_spec);restore_spec.loader.exec_module(restore)


class PackageTests(unittest.TestCase):
    def test_public_release_requires_explicit_flag_and_preserves_source_boundaries(self):
        with tempfile.TemporaryDirectory() as folder:
            private = module.package(ROOT, Path(folder) / 'review.zip')
            public = module.package(ROOT, Path(folder) / 'public.zip', publication_approved=True)
            self.assertFalse(private['publicationApproved'])
            self.assertTrue(public['publicationApproved'])
            self.assertTrue(public['ok'])
            with zipfile.ZipFile(Path(folder) / 'public.zip') as archive:
                self.assertEqual(archive.read('README.md'), (ROOT / 'README.md').read_bytes().replace(b'\r\n', b'\n'))
                self.assertEqual(json.loads(archive.read('catalog/manifest.json'))['components'], [])
                self.assertFalse(any(name.startswith(('data/', 'database/', 'deploy/')) for name in archive.namelist()))
            with self.assertRaises(ValueError):
                module.collect(ROOT, publication_approved='true')

    def test_allowlist_excludes_private_and_supplier_trees(self):
        for name in ['deploy/remote-known-hosts', '.env', 'data/settings.json', 'catalog/models/a.step',
                     'database/model-library/index.json', 'skills/prompt-to-cad/references/design-intent.md',
                     '../server.mjs', '/server.mjs', 'src/../server.mjs', 'models/weights.gguf',
                     'server.mjs', 'studio-service.mjs', 'car-contract.mjs',
                     'server/credentials.json', 'server/unreviewed.mjs',
                     'shared/unreviewed.mjs', 'docs/history/README-pre-layout-20260928.md']:
            self.assertFalse(module.check.allowed_name(name), name)

    def test_module_layout_and_community_files_are_explicitly_allowlisted(self):
        for name in ['server/index.mjs', 'server/studio-service.mjs', 'shared/car-contract.mjs',
                     'CONTRIBUTING.md', 'SECURITY.md', 'docs/architecture.md',
                     'docs/project-layout.md', 'docs/README.md', '.editorconfig', '.gitattributes',
                     '.github/workflows/ci.yml', 'scripts/check-source.mjs', 'scripts/test-source.mjs']:
            self.assertTrue(module.check.allowed_name(name), name)

    def test_nested_vue_sources_are_allowed_without_private_or_dependency_trees(self):
        for name in ['src/App.vue', 'src/components/Inspector.vue', 'src/stores/studio.ts', 'src/viewport/controller.ts']:
            self.assertTrue(module.check.allowed_name(name), name)
        for name in ['src/.env', 'src/.private/key.ts', 'src/node_modules/pkg/index.ts', 'src/components/../../../.env']:
            self.assertFalse(module.check.allowed_name(name), name)

    def test_archive_is_reproducible_hash_checked_and_keeps_catalog_unavailable(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / 'first.zip', Path(folder) / 'second.zip'
            a, b = module.package(ROOT, first), module.package(ROOT, second)
            self.assertTrue(a['ok'])
            self.assertEqual(a['archiveSha256'], b['archiveSha256'])
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.read('README.md'), (ROOT / 'README.md').read_bytes().replace(b'\r\n', b'\n'))
                self.assertTrue(all(b'\r\n' not in archive.read(name) for name in archive.namelist()))
                self.assertTrue(module.check.SERVER_FILES.issubset(set(archive.namelist())))
                self.assertNotIn('server.mjs', archive.namelist())
                self.assertNotIn('studio-service.mjs', archive.namelist())
                self.assertNotIn('car-contract.mjs', archive.namelist())
                self.assertEqual(json.loads(archive.read('catalog/manifest.json'))['components'], [])
                self.assertGreater(len(json.loads(archive.read('catalog/reference-manifest.json'))['components']), 0)
                inventory=archive.read('catalog/interface-surface-inventory.json')
                self.assertEqual(inventory,(ROOT/'catalog/interface-surface-inventory.json').read_bytes())
                self.assertEqual(hashlib.sha256(inventory).hexdigest(),module.check.INTERFACE_INVENTORY_SHA256)
                self.assertNotIn(b'/catalog/interface-surface-inventory.json\n',archive.read('.gitignore'))
                self.assertIn('numerical interface metadata',json.loads(archive.read('SUBMISSION-MANIFEST.json'))['scope'])
            with self.assertRaises(ValueError):
                module.package(ROOT, first)

    def test_tampering_and_extra_private_file_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path(folder) / 'original.zip'
            module.package(ROOT, original)
            for mode in ['tamper', 'extra']:
                changed = Path(folder) / (mode + '.zip')
                with zipfile.ZipFile(original) as source, zipfile.ZipFile(changed, 'w') as target:
                    for entry in source.infolist():
                        data = source.read(entry)
                        if mode == 'tamper' and entry.filename == 'server/index.mjs':
                            data += b'\n// modified\n'
                        target.writestr(entry, data)
                    if mode == 'extra':
                        target.writestr('data/settings.json', '{}')
                self.assertFalse(module.check.check_archive(changed)['ok'])

    def test_private_endpoint_scan_and_nonblank_settings_fail(self):
        self.assertTrue(module.check.scan_bytes('README.md', ('host=' + '172.20.' + '99.250').encode()))
        self.assertTrue(module.check.scan_bytes('README.md', ('/home/' + 'example-user/private').encode()))
        self.assertTrue(module.check.scan_bytes('README.md', ('https://sample-only' + '.vicp.fun').encode()))
        self.assertTrue(module.check.scan_bytes('.env.example', b'QWEN_MODEL=private-model'))
        self.assertTrue(module.check.scan_bytes('.env.example', b'M4KE_ALLOW_WEB=1'))
        self.assertFalse(module.check.scan_bytes('.env.example', b'M4KE_ALLOW_WEB=\nM4KE_SEARCH_URL=\nM4KE_SEARCH_ENGINES=\n'))
        self.assertFalse(module.check.scan_bytes('.env.example', b'OLLAMA_URL=\nQWEN_MODEL=\nPORT=4173\n'))

    def test_inventory_tampering_is_rejected_even_if_archive_manifest_is_rehashed(self):
        with tempfile.TemporaryDirectory() as folder:
            original=Path(folder)/'original.zip';module.package(ROOT,original)
            changed=Path(folder)/'changed.zip'
            with zipfile.ZipFile(original) as source:
                contents={name:source.read(name) for name in source.namelist()}
            name='catalog/interface-surface-inventory.json';contents[name]+=b'\n'
            manifest=json.loads(contents['SUBMISSION-MANIFEST.json']);manifest['files'][name]={'sha256':hashlib.sha256(contents[name]).hexdigest(),'bytes':len(contents[name])};contents['SUBMISSION-MANIFEST.json']=json.dumps(manifest).encode()
            with zipfile.ZipFile(changed,'w') as target:
                for name,data in contents.items():target.writestr(name,data)
            report=module.check.check_archive(changed);self.assertFalse(report['ok']);self.assertTrue(any('inventory SHA256' in e['error'] for e in report['errors']))

    def test_restore_requires_exact_inventory_and_matching_source_interface_bindings(self):
        reference_path = ROOT / 'catalog/reference-manifest.json'
        if not reference_path.is_file():
            reference_path = ROOT / 'catalog/manifest.json'
        reference=json.loads(reference_path.read_text(encoding='utf8'))
        inventory=(ROOT/'catalog/interface-surface-inventory.json').read_bytes()
        with tempfile.TemporaryDirectory() as folder:
            catalog=Path(folder)
            with self.assertRaisesRegex(RuntimeError,'missing'):restore.verify_interface_inventory(catalog,reference)
            file=catalog/'interface-surface-inventory.json';file.write_bytes(inventory)
            checked=restore.verify_interface_inventory(catalog,reference);self.assertEqual(checked['sha256'],module.check.INTERFACE_INVENTORY_SHA256)
            for key,value in [('evidenceSha256','0'*64),('sourceSha256','0'*64),('evidenceArtifact','../outside.json'),('sourceArtifact','models/wrong.step')]:
                altered=json.loads(json.dumps(reference));record=next(i for c in altered['components'] for i in c.get('interfaces',[]) if i.get('evidenceArtifact'));record[key]=value
                with self.assertRaisesRegex(RuntimeError,'rejected'):restore.verify_interface_inventory(catalog,altered)
            file.write_bytes(inventory+b'\n')
            with self.assertRaisesRegex(RuntimeError,'SHA256'):restore.verify_interface_inventory(catalog,reference)
            file.write_bytes(b'x'*(2*1024*1024+1))
            with self.assertRaisesRegex(RuntimeError,'unsafe'):restore.verify_interface_inventory(catalog,reference)

    def test_embedded_native_restore_program_compiles_with_interface_verification(self):
        tree=ast.parse((ROOT/'scripts/restore-submission-catalog.py').read_text(encoding='utf8'))
        code=next(node.value.value for node in ast.walk(tree) if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id=='code' for target in node.targets))
        compile(code,'<isolated-native-restore>','exec')
        self.assertIn("staged/'interface-surface-inventory.json'",code)
        self.assertIn('load_interface(component,record,meta,shape,staged)',code)

    def test_symlinks_and_duplicate_members_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            original = Path(folder) / 'original.zip'
            module.package(ROOT, original)
            linked = Path(folder) / 'linked.zip'
            with zipfile.ZipFile(original) as source, zipfile.ZipFile(linked, 'w') as target:
                for entry in source.infolist():
                    if entry.filename == 'server/index.mjs':
                        entry.external_attr = 0o120777 << 16
                    target.writestr(entry, source.read(entry.filename))
            self.assertFalse(module.check.check_archive(linked)['ok'])
            duplicate = Path(folder) / 'duplicate.zip'
            duplicate.write_bytes(original.read_bytes())
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                with zipfile.ZipFile(duplicate, 'a') as target:
                    target.writestr('server/index.mjs', 'duplicate')
            with self.assertRaises(ValueError):
                module.check.check_archive(duplicate)


if __name__ == '__main__':
    unittest.main(verbosity=2)
