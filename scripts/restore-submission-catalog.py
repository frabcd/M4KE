#!/usr/bin/env python3
"""Explicit one-time official-source reacquisition; exact historical hashes or fail closed.

No third-party CAD is shipped in the review archive. This script downloads it to
the installing user's private workspace. It never grants redistribution rights.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_interface_inventory(catalog, reference):
    """Require the reviewed metadata bytes before any source acquisition/promotion."""
    file=catalog/'interface-surface-inventory.json'
    if file.is_symlink() or not file.is_file() or not 1<=file.stat().st_size<=2*1024*1024:
        raise RuntimeError('Reviewed interface inventory missing or unsafe; no catalog promotion.')
    module_spec=importlib.util.spec_from_file_location('submission_interface_check',ROOT/'scripts/check-submission.py')
    check=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(check)
    data=file.read_bytes();errors=check.validate_interface_inventory(data,reference)
    if errors:raise RuntimeError('Reviewed interface inventory rejected: '+', '.join(errors))
    return {'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'verified':True,
            'scope':'Reviewed numerical source metadata only; native STEP must be restored and imported separately. Physical fit remains UNKNOWN.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accept-source-downloads', action='store_true', help='Explicitly allow public manufacturer requests during setup.')
    parser.add_argument('--offline', action='store_true', help='Verify already populated exact sources without network.')
    parser.add_argument('--source-cache', type=Path, help='Copy only exact-hash sources from a private pre-staged catalog directory.')
    args = parser.parse_args()
    if not args.offline and not args.accept_source_downloads:
        raise SystemExit('Use --accept-source-downloads for setup networking, or --offline for existing files.')
    catalog = ROOT / 'catalog'
    cache = args.source_cache.resolve(strict=True) if args.source_cache else None
    if cache is not None and not cache.is_dir():
        raise SystemExit('Source cache must be a private catalog directory, not an archive.')
    reference = json.loads((catalog / 'reference-manifest.json').read_text())
    index = json.loads((catalog / 'reference-source-index.json').read_text())
    active = json.loads((catalog / 'manifest.json').read_text())
    if active.get('components') and active != reference:
        raise SystemExit('Existing active catalog differs; do not overwrite another user/team catalog.')
    python = ROOT / '.venv-cad/bin/python'
    if not python.is_file():
        raise SystemExit('Install the isolated native CAD environment first.')
    module_spec = importlib.util.spec_from_file_location('catalog_acquire', ROOT / 'scripts/catalog_acquire.py')
    acquire = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(acquire)
    reviewed_urls = {name: url for name, url, _ in acquire.SOURCES}
    report = {'schemaVersion': 1, 'at': datetime.now(timezone.utc).isoformat(), 'offline': args.offline,
              'sources': [], 'usedPrivateSourceCache': cache is not None, 'ok': False,
              'physicalValidation': 'UNKNOWN', 'redistributionApproved': False}
    try:
        report['interfaceEvidence']=verify_interface_inventory(catalog,reference)
        if len(index['sources']) != len(reviewed_urls):
            raise RuntimeError('Source index differs from the reviewed acquisition inventory.')
        for record in index['sources']:
            name = record['name']
            if reviewed_urls.get(name) != record['url'] or record['path'] != 'sources/' + name or '/' in name or '\\' in name:
                raise RuntimeError('Unreviewed source URL/path.')
            target = catalog / record['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            origin = 'existing-exact-file'
            if target.exists():
                if target.is_symlink() or sha(target) != record['sha256']:
                    raise RuntimeError('Existing source differs; refusing overwrite: ' + name)
            elif cache is not None:
                source = (cache / record['path']).resolve(strict=True)
                if not source.is_relative_to(cache) or not source.is_file() or sha(source) != record['sha256']:
                    raise RuntimeError('Private source cache differs: ' + name)
                shutil.copyfile(source, target)
                if sha(target) != record['sha256']:
                    raise RuntimeError('Private source copy hash mismatch: ' + name)
                origin = 'private-exact-hash-cache'
            elif args.offline:
                raise RuntimeError('Missing offline source: ' + name)
            else:
                origin = 'official-url-current-download'
                opener = urllib.request.build_opener(acquire.PublicRedirects())
                request = urllib.request.Request(record['url'], headers={'User-Agent': 'M4KE-source-review-restore/1.0'})
                with tempfile.NamedTemporaryFile(dir=target.parent, suffix='.partial', delete=False) as tmp:
                    temporary = Path(tmp.name)
                    try:
                        with opener.open(request, timeout=60) as response:
                            length = 0
                            while block := response.read(256 * 1024):
                                length += len(block)
                                if length > min(acquire.MAX_BYTES, record['bytes'] + 1024):
                                    raise RuntimeError('Source size changed: ' + name)
                                tmp.write(block)
                        tmp.close()
                        actual = sha(temporary)
                        if actual != record['sha256']:
                            rejected = catalog / 'history' / ('rejected-' + name + '-' + actual[:16])
                            rejected.parent.mkdir(exist_ok=True)
                            observed_bytes = temporary.stat().st_size
                            if not rejected.exists():
                                temporary.replace(rejected)
                            report['sourceMismatch'] = {'name': name, 'url': record['url'],
                                'expectedSha256': record['sha256'], 'observedSha256': actual,
                                'observedBytes': observed_bytes,
                                'quarantine': rejected.relative_to(catalog).as_posix(), 'accepted': False}
                            raise RuntimeError('Official source changed; do not accept a new revision silently: ' + name)
                        temporary.replace(target)
                    finally:
                        tmp.close()
                        if temporary.exists():
                            temporary.unlink()
            report['sources'].append({'name': name, 'sha256': record['sha256'], 'verified': True, 'origin': origin})
        # Existing extraction helper bounds extensions, paths, symlinks and ZIP expansion.
        entries = acquire.extract_step_archives(catalog, index['sources'])
        for component in reference['components']:
            geometry = component.get('geometry')
            if geometry:
                relative = geometry['step']
                path = (catalog / relative).resolve(strict=True)
                if not path.is_relative_to(catalog.resolve()) or sha(path) != geometry['sha256']:
                    raise RuntimeError('Derived STEP hash mismatch for ' + component['id'])
        # Keep the active catalog unavailable until imports pass. Isolated copied
        # geometry uses the existing helper unchanged, with its normal manifest path.
        code = """import json,sys,tempfile,shutil
from pathlib import Path
sys.path.insert(0,str(Path('cad').resolve()))
from catalog_geometry import load_catalog_component
from catalog_mates import load_interface,SUPPORTED
root=Path('catalog').resolve()
manifest=json.loads((root/'reference-manifest.json').read_text())
checks=[]
with tempfile.TemporaryDirectory(prefix='native-import-',dir=root) as temp:
 staged=Path(temp)
 (staged/'manifest.json').write_text(json.dumps(manifest))
 shutil.copyfile(root/'interface-surface-inventory.json',staged/'interface-surface-inventory.json')
 for component in manifest['components']:
  if component.get('geometry'):
   relative=component['geometry']['step']
   target=staged/relative
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copyfile(root/relative,target)
   shape,meta=load_catalog_component(component['id'],staged)
   assert shape.isValid()
   interfaces=[]
   for record in component.get('interfaces',[]):
    if record.get('type') in SUPPORTED:
     observed=load_interface(component,record,meta,shape,staged)
     interfaces.append({'id':record['id'],'nativeSupportIntervalsMm':observed['supportIntervalsMm'],'evidenceSha256':observed['lineage']['evidenceSha256'],'physicalFit':'UNKNOWN'})
   checks.append({'id':component['id'],'boundsMm':meta['boundsMm'],'sha256':meta['stepSha256'],'nominalInterfaces':interfaces})
print(json.dumps({'ok':True,'imports':checks}))
"""
        run = subprocess.run([str(python), '-c', code], cwd=ROOT, text=True, capture_output=True, timeout=600)
        if run.returncode:
            raise RuntimeError('Native reference imports failed: ' + run.stderr[-1500:])
        report['nativeImports'] = json.loads(run.stdout)
        (catalog / 'source-index.json').write_text(json.dumps(index, indent=2) + '\n')
        (catalog / 'model-inventory.json').write_text(json.dumps(entries, indent=2) + '\n')
        # Only promote after source SHA checks, extraction SHA checks and native imports.
        (catalog / 'manifest.json').write_bytes((catalog / 'reference-manifest.json').read_bytes())
        report['ok'] = True
    except Exception as exc:
        report['error'] = str(exc)
    receipt = catalog / 'submission-restore.json'
    if receipt.exists():
        history = catalog / 'history'
        history.mkdir(exist_ok=True)
        previous = history / ('submission-restore-' + sha(receipt)[:16] + '.json')
        if not previous.exists():
            previous.write_bytes(receipt.read_bytes())
    receipt.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
