#!/usr/bin/env python3
"""Create an allowlisted, deterministic source ZIP. Never upload it."""
import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('submission_check', ROOT / 'scripts/check-submission.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def collect(root, publication_approved=False):
    if type(publication_approved) is not bool:
        raise ValueError('Publication approval must be an explicit boolean.')
    paths = set(check.ROOT_FILES | check.SERVER_FILES | check.EXACT)
    paths -= {'catalog/manifest.json',
              'catalog/reference-manifest.json', 'catalog/reference-source-index.json'}
    paths |= {'docs/submission/' + name for name in check.DOCS}
    for folder, pattern in [('src', '**/*'), ('engineering', '*.mjs'), ('tests', '*.test.mjs'), ('firmware/sound-car', '*')]:
        for file in (root / folder).glob(pattern):
            name = file.relative_to(root).as_posix()
            if file.is_file() and check.allowed_name(name):
                paths.add(name)
    contents = {}
    for name in sorted(paths):
        file = root / name
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise ValueError('Missing/unsafe required source: ' + name)
        # Canonical text matches Git's LF policy across Windows and Linux, so
        # source ZIP hashes also match a clean repository checkout.
        contents[name] = file.read_bytes().replace(b'\r\n', b'\n')
    # Keep operational evidence paths in the private workspace, not source staging.
    for private_guide in ['docs/portable-car-layout.md', 'docs/coop4-integration.md']:
        contents[private_guide] = re.sub(rb'/home/[A-Za-z0-9._-]+/DGX_SPARK_AUTOCAD_Hackathon', b'<M4KE_ROOT>', contents[private_guide])
    # Projection is confined to the source artifact; the working .gitignore is untouched.
    if b'# Submission setup artifacts:' not in contents['.gitignore']:
        contents['.gitignore'] += b'''\n# Submission setup artifacts: private or third-party, not source release inputs.\n.setup/\n.venv-cad/\n__pycache__/\n*.pyc\n/catalog/sources/\n/catalog/models/\n/catalog/previews/\n/catalog/history/\n/catalog/source-index.json\n/catalog/model-inventory.json\n/catalog/submission-restore.json\n/catalog/offline-replay.json\n/catalog/verification.json\n/database/\n/procurement/incoming/\n/procurement/snapshots/\n/procurement/evidence/\n/procurement/research/\n/printing/dgx/tools/\n/printing/dgx/flatpak/\n/printing/dgx/evidence/\n/printing/dgx/jobs/\n/printing/dgx/verification-fixture/\n/printing/dgx/setup-lock.json\n/docs/submission/artifacts/\n/docs/submission/clean-*/\n'''
    # Also support repacking an older staged checkout; only this reviewed
    # metadata exclusion is removed, never the supplier asset exclusions.
    contents['.gitignore']=contents['.gitignore'].replace(b'/catalog/interface-surface-inventory.json\r\n',b'').replace(b'/catalog/interface-surface-inventory.json\n',b'')
    historical = root / 'catalog/reference-manifest.json'
    if not historical.exists():
        historical = root / 'catalog/manifest.json'
    contents['catalog/reference-manifest.json'] = historical.read_bytes().replace(b'\r\n', b'\n')
    problems=check.validate_interface_inventory(contents['catalog/interface-surface-inventory.json'],json.loads(contents['catalog/reference-manifest.json']))
    if problems:raise ValueError('Rejected reviewed interface metadata: '+', '.join(problems))
    index = root / 'catalog/reference-source-index.json'
    if not index.exists():
        index = root / 'catalog/source-index.json'
    sources = json.loads(index.read_text(encoding='utf-8'))['sources']
    allowed_fields = {'name', 'path', 'url', 'finalUrl', 'role', 'bytes', 'sha256', 'capturedAt'}
    contents['catalog/reference-source-index.json'] = (json.dumps({'schemaVersion': 1,
        'scope': 'Historical official-source hashes; asset bytes deliberately excluded.',
        'sources': [{k: v for k, v in source.items() if k in allowed_fields} for source in sources]}, indent=2) + '\n').encode()
    contents['catalog/manifest.json'] = (json.dumps({'schemaVersion': 1,
        'catalogRevision': 'submission-empty-requires-explicit-source-restore',
        'components': [], 'materials': [], 'kits': [], 'runtimeNetworkRequired': False,
        'limitations': ['Third-party source CAD is not redistributed. Run the reviewed setup acquisition/verification before selecting source kits.']}, indent=2) + '\n').encode()
    for name, data in contents.items():
        problems = check.scan_bytes(name, data)
        if not check.allowed_name(name) or problems:
            raise ValueError('Rejected source ' + name + ': ' + ', '.join(problems))
    manifest = {'schemaVersion': 1, 'publicationApproved': publication_approved, 'licenseApproved': True, 'originalCodeLicense': 'MIT',
                'scope': ('Owner-approved public source release; ' if publication_approved else 'Private source-review staging; ') + 'includes hash-pinned numerical interface metadata, not model weights, native supplier CAD, user data or deployed settings. No third-party redistribution rights or physical-fit claim.',
                'projections': ['UTF-8 source text is canonicalized to LF to match Git; private working history is excluded.', 'Staged .gitignore adds private setup/source-asset exclusions without changing working .gitignore.', 'Active catalog is empty; historical component metadata is separate.', 'Reviewed numerical interface inventory retains its pinned original SHA256; it does not replace separately restored STEP sources.', 'Portable and coop4 guide deployment prefixes are projected to M4KE_ROOT only inside this archive.'],
                'files': {name: {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)} for name, data in sorted(contents.items())}}
    contents['SUBMISSION-MANIFEST.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    return contents


def package(root, output, publication_approved=False):
    if output.exists():
        raise ValueError('Refusing to overwrite an existing review artifact; choose a new output path.')
    contents = collect(root, publication_approved=publication_approved)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    result = check.check_archive(output)
    if not result['ok']:
        raise ValueError('Created artifact failed validation: ' + json.dumps(result['errors']))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--public', action='store_true', help='Record explicit owner approval for public source release; does not upload anything.')
    args = parser.parse_args()
    print(json.dumps(package(ROOT, args.output.resolve(), publication_approved=args.public), indent=2))


if __name__ == '__main__':
    main()
