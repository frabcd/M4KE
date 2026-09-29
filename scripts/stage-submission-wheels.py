#!/usr/bin/env python3
"""Recover exact platform-compatible wheel bytes from private pip HTTP cache.

Copy-only: every selected wheel is checked against official PyPI metadata before
staging. Does not copy installed environments, inspect credentials or install code.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import email
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--verify-pypi', action='store_true', help='Allow official PyPI metadata requests; no wheel downloads.')
    args = parser.parse_args()
    if not args.verify_pypi:
        raise SystemExit('Explicit --verify-pypi is required; no metadata is guessed.')
    # Bootstrap pip's vendored wheel parser is already present in the fresh venv.
    from pip._vendor.packaging.tags import sys_tags
    from pip._vendor.packaging.utils import parse_wheel_filename
    tags = set(sys_tags())
    pins = dict(line.split('==') for line in (ROOT / 'cad/requirements-lock-dgx.txt').read_text().splitlines() if '==' in line)
    pins = {name.lower().replace('_', '-'): version for name, version in pins.items()}
    cache = args.cache.resolve(strict=True)
    output = args.output.resolve()
    if not cache.is_dir() or output == cache or output.is_relative_to(cache):
        raise SystemExit('Use a separate staging output directory, never modify the cache.')
    output.mkdir(parents=True, exist_ok=True)
    candidates = {name: [] for name in pins}
    scanned = 0
    for file in cache.rglob('*.body'):
        scanned += 1
        if scanned > 10000:
            raise SystemExit('Cache inspection exceeds 10,000 file bound.')
        if file.is_symlink() or not 100 <= file.stat().st_size <= 300 * 1024 * 1024:
            continue
        try:
            with file.open('rb') as stream:
                if stream.read(4) != b'PK\x03\x04':
                    continue
            with zipfile.ZipFile(file) as archive:
                entries = [entry for entry in archive.infolist() if entry.filename.endswith('.dist-info/METADATA') and entry.file_size < 524288]
                if len(entries) != 1:
                    continue
                metadata = email.message_from_bytes(archive.read(entries[0]))
                name = str(metadata['Name']).lower().replace('_', '-')
                if pins.get(name) == metadata['Version'] and len(candidates[name]) < 16:
                    candidates[name].append(file)
        except (OSError, zipfile.BadZipFile):
            continue

    def verify(pair):
        name, version = pair
        url = f'https://pypi.org/pypi/{name}/{version}/json'
        with urllib.request.urlopen(url, timeout=45) as response:
            data = response.read(4 * 1024 * 1024 + 1)
        if len(data) > 4 * 1024 * 1024:
            raise RuntimeError('PyPI metadata exceeds limit.')
        metadata = json.loads(data)
        assets = {}
        for asset in metadata['urls']:
            if asset.get('packagetype') != 'bdist_wheel':
                continue
            filename = asset['filename']
            if '/' in filename or '\\' in filename:
                continue
            wheel_name, wheel_version, _, wheel_tags = parse_wheel_filename(filename)
            if str(wheel_name).replace('_', '-') == name and str(wheel_version) == version and wheel_tags & tags:
                assets[asset['digests']['sha256']] = filename
        for source in candidates[name]:
            digest = sha(source)
            filename = assets.get(digest)
            if filename:
                target = output / filename
                if target.exists() and sha(target) != digest:
                    raise RuntimeError('Staged wheel differs; refusing overwrite.')
                if not target.exists():
                    shutil.copyfile(source, target)
                if sha(target) != digest:
                    raise RuntimeError('Staged wheel copy mismatch.')
                return {'name': name, 'version': version, 'filename': filename, 'sha256': digest,
                        'bytes': target.stat().st_size, 'verified': True, 'origin': 'private-pip-cache', 'metadataUrl': url}
        if name == 'pip' and importlib.metadata.version('pip') == version:
            return {'name': name, 'version': version, 'verified': True,
                    'origin': 'fresh-venv-bootstrap-already-satisfies-lock', 'wheelStaged': False, 'metadataUrl': url}
        return {'name': name, 'version': version, 'verified': False, 'reason': 'No official-hash matching compatible cached wheel'}

    with ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(verify, sorted(pins.items())))
    report = {'schemaVersion': 1, 'at': datetime.now(timezone.utc).isoformat(),
              'ok': all(item['verified'] for item in records), 'records': records,
              'cacheModified': False, 'installedPackagesCopied': False, 'modelWeightsRead': False,
              'scope': 'Private cache staging verified against official PyPI; not a fresh wheel download.'}
    (output / 'wheel-stage.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
