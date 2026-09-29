#!/usr/bin/env python3
"""Fresh manufacturer reconstruction candidate; never activates a runtime catalog.

The exact historical replay installer is deliberately unchanged. This command
fetches a new observation for each fixed source; it has no private-cache fallback,
no supplier login, no model/printer action and no publication operation.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

from catalog_claims import extract, VERSION, MAX_HTML_BYTES

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SHA = '50660774b3d0d45143fd09257647b698b165bf6946d7d56bc83fd952cc8e52f3'
INDEX_FIELDS_SHA = '18f97ca21ed10449975d16896ab3791cf08e8e02510136fc06d4e1645b8a1aa7'
MAX_TOTAL_BYTES = 200 * 1024 * 1024
ALLOWED_HOSTS = {'www.pololu.com', 'a.pololu-files.com', 'pip.raspberrypi.com',
                 'pip-assets.raspberrypi.com', 'raw.githubusercontent.com', 'api.github.com', 'www.adafruit.com'}
ADAFRUIT_COMMIT = '04f6f23f995a4a0c8b944c07b2d74d602898c528'
ADAFRUIT_FILES = {'adafruit-1063-license.txt': 'license.txt', 'adafruit-1063-readme.md': 'README.md',
                 'adafruit-1063.brd': 'Adafruit MAX4466 Mic Amp.brd', 'adafruit-1063.sch': 'Adafruit MAX4466 Mic Amp.sch'}


def fallback_url(record):
    filename = ADAFRUIT_FILES.get(record['name'])
    if filename is None:
        return None
    suffix = urllib.parse.quote(filename, safe='')
    expected = 'https://raw.githubusercontent.com/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/' + ADAFRUIT_COMMIT + '/' + suffix
    if record['url'] != expected:
        raise ValueError('Unreviewed commit/path fallback request')
    return 'https://api.github.com/repos/adafruit/Adafruit-MAX4466-Electret-Mic-Amplifier-PCBs/contents/' + suffix + '?ref=' + ADAFRUIT_COMMIT


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def save(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write('\n')


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in ALLOWED_HOSTS or parsed.port not in {None, 443} or parsed.username or parsed.password or parsed.fragment:
        raise ValueError('Non-allowlisted manufacturer HTTPS URL')
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        safe_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def references(folder):
    manifest_path = folder / 'reference-manifest.json'
    index_path = folder / 'reference-source-index.json'
    if not manifest_path.exists():
        manifest_path, index_path = folder / 'manifest.json', folder / 'source-index.json'
    for p in (manifest_path, index_path):
        if p.is_symlink() or not p.is_file() or p.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Invalid reference metadata file')
    raw = manifest_path.read_bytes()
    if digest(raw) != MANIFEST_SHA:
        raise ValueError('Historical manifest does not match reviewed baseline')
    original = json.loads(raw)
    source_index = json.loads(index_path.read_text(encoding='utf-8'))
    records = [{k: x[k] for k in ('name', 'path', 'url', 'sha256', 'bytes', 'role')}
               for x in sorted(source_index['sources'], key=lambda x: x['name'])]
    # ASCII escaped canonicalization matches the published setup reference index.
    if len(records) != 25 or hashlib.sha256(json.dumps(records, sort_keys=True, separators=(',', ':')).encode()).hexdigest() != INDEX_FIELDS_SHA:
        raise ValueError('Source plan differs from reviewed URL/hash/role inventory')
    for record in records:
        if record['path'] != 'sources/' + record['name'] or any(x in record['name'] for x in '/\\:'):
            raise ValueError('Unsafe source name/path')
        safe_url(record['url'])
    return original, records, raw, index_path.read_bytes()


def fresh_output(path, reference_root, code_root=None):
    path = path.absolute()
    if path.exists() or path.is_symlink():
        raise ValueError('Output must be a new directory; no resume or overwrite')
    for parent in path.parents:
        if parent.is_symlink():
            raise ValueError('Output parent symlink forbidden')
    resolved = path.resolve()
    reference = reference_root.resolve()
    if resolved == reference or resolved.is_relative_to(reference) or reference.is_relative_to(resolved):
        raise ValueError('Candidate must be separate from reference catalog')
    active = ((code_root or ROOT) / 'catalog').resolve()
    if resolved == active or resolved.is_relative_to(active) or active.is_relative_to(resolved):
        raise ValueError('Candidate must not target the installed active catalog')
    resolved.mkdir(parents=True, exist_ok=False)
    for folder in ('sources', 'observations', 'attempts', 'historical'):
        (resolved / folder).mkdir()
    return resolved


class Fetcher:
    def __init__(self, output, seconds=600):
        self.output, self.deadline = output, time.monotonic() + seconds
        self.locks = {host: threading.Lock() for host in ALLOWED_HOSTS}
        self.last, self.bytes, self.lock = {}, 0, threading.Lock()

    def fetch(self, record):
        name, url = record['name'], record['url']
        maximum = MAX_HTML_BYTES if name.endswith('.html') else min(90 * 1024 * 1024, record['bytes'] + 1024)
        attempts = []
        fallback = fallback_url(record)
        urls = [url, url] + ([fallback] if fallback else [])
        for number, acquisition_url in enumerate(urls, 1):
            started = now()
            attempt_path = self.output / 'attempts' / (name + '.attempt-' + str(number) + '.bin')
            headers = {'User-Agent': 'M4KE-reviewed-source-reconstruction/1.0',
                       'Accept': 'application/vnd.github.raw+json' if acquisition_url == fallback else '*/*'}
            row = {'attempt': number, 'startedAt': started, 'status': 'ERROR',
                   'requestedUrl': acquisition_url, 'requestHeaders': headers}
            try:
                if time.monotonic() >= self.deadline:
                    raise TimeoutError('Acquisition total time budget exhausted')
                host = urllib.parse.urlsplit(acquisition_url).hostname
                with self.locks[host]:
                    time.sleep(max(0, 1 - (time.monotonic() - self.last.get(host, 0))))
                    self.last[host] = time.monotonic()
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Redirects())
                request = urllib.request.Request(safe_url(acquisition_url), headers=headers)
                with opener.open(request, timeout=min(45, max(1, self.deadline - time.monotonic()))) as response, attempt_path.open('xb') as stream:
                    final_url = safe_url(response.url)
                    total = 0
                    while True:
                        if time.monotonic() >= self.deadline:
                            raise TimeoutError('Acquisition total time budget exhausted')
                        block = response.read(256 * 1024)
                        if not block:
                            break
                        total += len(block)
                        with self.lock:
                            self.bytes += len(block)
                            if self.bytes > MAX_TOTAL_BYTES:
                                raise ValueError('Acquisition total byte bound')
                        if total > maximum:
                            raise ValueError('Source byte bound exceeded')
                        stream.write(block)
                raw = attempt_path.read_bytes()
                if not raw:
                    raise ValueError('Empty response')
                actual = digest(raw)
                exact = actual == record['sha256']
                if not name.endswith('.html') and not exact:
                    raise ValueError('Exact asset/attribution hash changed; review separate revision')
                row.update(status='FETCHED', bytes=len(raw), sha256=actual, finalUrl=final_url, finishedAt=now())
                attempts.append(row)
                (self.output / record['path']).write_bytes(raw)
                if name.endswith('.html'):
                    (self.output / 'observations' / (actual + '.html')).write_bytes(raw)
                return {**record, 'historicalSha256': record['sha256'], 'sha256': actual,
                        'bytes': len(raw), 'capturedAt': now(), 'finalUrl': final_url, 'acquisitionUrl': acquisition_url,
                        'roleClass': 'mutable-observation' if name.endswith('.html') else 'exact-asset-or-attribution',
                        'historicalBytesMatched': exact, 'freshDownload': True, 'attempts': attempts,
                        'status': 'PASS'}
            except Exception as exc:
                row['error'] = (type(exc).__name__ + ': ' + str(exc))[:500]
                row['finishedAt'] = now()
                if attempt_path.exists():
                    raw = attempt_path.read_bytes()
                    row.update(observedBytes=len(raw), observedSha256=digest(raw))
                attempts.append(row)
                # Deterministic semantic drift is not repaired by repeatedly fetching.
                if isinstance(exc, ValueError):
                    break
        return {**record, 'freshDownload': False, 'status': 'FAIL', 'attempts': attempts}


def claim_nodes(manifest):
    found = []
    for i, component in enumerate(manifest['components']):
        for key, value in component.get('ratings', {}).items():
            if isinstance(value, dict) and value.get('sourceArtifact', '').endswith('.html'):
                found.append((component, value, key, f'/components/{i}/ratings/{key}', value.get('value'), value.get('unit')))
        for n, interface in enumerate(component.get('interfaces', [])):
            if interface.get('sourceArtifact', '').endswith('.html'):
                found.append((component, interface, interface['id'], f'/components/{i}/interfaces/{n}', interface['dimensions'], 'fastener-specification'))
    if len(found) != 17:
        raise ValueError('Unexpected reviewed HTML-dependent claim inventory')
    return found


def reconstruct_manifest(original, records, output):
    candidate = copy.deepcopy(original)
    current = {r['name']: r for r in records if r['status'] == 'PASS'}
    observations, identity_failures = {}, []
    for name, record in current.items():
        if name.endswith('.html'):
            try:
                observations[name] = extract(name, (output / record['path']).read_bytes())
            except (ValueError, UnicodeError) as exc:
                identity_failures.append({'source': name, 'status': 'REVIEW_REQUIRED', 'reason': str(exc)})
    extractor_sha = digest(Path(__file__).with_name('catalog_claims.py').read_bytes())
    reviews = []
    for component, node, key, pointer, expected, unit in claim_nodes(candidate):
        name = Path(node['sourceArtifact']).name
        observed = observations.get(name, {}).get('claims', {}).get(key)
        matched = observed is not None and observed['value'] == expected and observed['unit'] == unit
        review = {'componentId': component['id'], 'claimPointer': pointer, 'claimId': key,
                  'historicalClaimSha256': digest(encoded(node)), 'expectedValue': expected, 'expectedUnit': unit,
                  'source': name, 'status': 'REESTABLISHED' if matched else 'REVIEW_REQUIRED',
                  'observationSha256': current.get(name, {}).get('sha256'),
                  'extractorVersion': VERSION, 'extractorSha256': extractor_sha, 'observed': observed}
        reviews.append(review)
        if matched:
            node['reconstructionEvidence'] = {k: review[k] for k in ('historicalClaimSha256', 'observationSha256', 'extractorVersion', 'extractorSha256')}
            node['reconstructionEvidence'].update(section=observed['section'], sectionSha256=observed['sectionSha256'], conditions=observed['conditions'])
        else:
            node['reconstructionStatus'] = 'REVIEW_REQUIRED'
    for component in candidate['components']:
        for artifact in component.get('sourceArtifacts', []):
            record = current.get(Path(artifact['path']).name)
            if record:
                artifact.update(historicalSha256=artifact['sha256'], sha256=record['sha256'],
                                bytes=record['bytes'], capturedAt=record['capturedAt'], historicalReplay=False)
        component['priceSnapshot'] = None
        component['availabilitySnapshot'] = None
        component['supplierObservationStatus'] = 'NOT_REESTABLISHED_PRICE_STOCK_UNKNOWN'
    candidate['catalogRevision'] = 'fresh-reconstruction-candidate-' + digest(encoded([{k: r.get(k) for k in ('name', 'sha256', 'capturedAt')} for r in records]))[:16]
    candidate['createdAt'] = now()
    candidate['reconstruction'] = {'schemaVersion': 1, 'historicalManifestSha256': MANIFEST_SHA,
        'historicalReplay': False, 'freshSourcesOnly': True, 'activation': 'NOT_REQUESTED',
        'extractorVersion': VERSION, 'extractorSha256': extractor_sha,
        'physicalValidation': 'UNKNOWN', 'redistributionApproved': False,
        'claimReviewFile': 'claim-reviews.json', 'sourceIndexFile': 'source-index.json',
        'notes': 'Exact geometry/frame bytes unchanged; publication rights not granted; price/stock invalidated.'}
    return candidate, observations, reviews, identity_failures


def native_imports(candidate_dir, code_root, python):
    script = """import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from catalog_geometry import load_catalog_component
root=Path(sys.argv[2]);m=json.loads((root/'manifest.json').read_text());checks=[]
for c in m['components']:
 if c.get('geometry'):
  shape,meta=load_catalog_component(c['id'],root)
  assert shape.isValid()
  checks.append({'id':c['id'],'boundsMm':meta['boundsMm'],'stepSha256':meta['stepSha256']})
print(json.dumps({'ok':True,'imports':checks}))
"""
    run = subprocess.run([str(python), '-I', '-c', script, str(code_root / 'cad'), str(candidate_dir)],
                         capture_output=True, text=True, timeout=600)
    (candidate_dir / 'native.stdout.txt').write_text(run.stdout, encoding='utf-8')
    (candidate_dir / 'native.stderr.txt').write_text(run.stderr, encoding='utf-8')
    if run.returncode:
        raise ValueError('Native imports failed; retained bounded process diagnostics')
    result = json.loads(run.stdout)
    if result.get('ok') is not True or len(result.get('imports', [])) != 8:
        raise ValueError('Native import coverage mismatch')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--accept-source-downloads', action='store_true', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--reference-root', type=Path, default=ROOT / 'catalog')
    parser.add_argument('--code-root', type=Path, default=ROOT, help='Trusted installed source root containing existing acquisition and native helpers.')
    parser.add_argument('--python', type=Path, default=ROOT / '.venv-cad/bin/python')
    args = parser.parse_args()
    original, plan, raw_manifest, raw_index = references(args.reference_root)
    # Resolving a venv's bin/python symlink launches the system interpreter and
    # loses pyvenv.cfg discovery. Preserve the executable path, check it separately.
    python = args.python.expanduser().absolute()
    code_root = args.code_root.resolve(strict=True)
    if not python.is_file() or not (code_root / 'cad/catalog_geometry.py').is_file():
        raise SystemExit('Install native CAD dependencies and reviewed helper first')
    output = fresh_output(args.output, args.reference_root, code_root)
    (output / 'historical/manifest.json').write_bytes(raw_manifest)
    (output / 'historical/source-index.json').write_bytes(raw_index)
    save(output / 'acquisition-plan.json', {'schemaVersion': 1, 'historicalManifestSha256': MANIFEST_SHA,
        'planFieldsSha256': INDEX_FIELDS_SHA, 'sources': plan})
    report = {'schemaVersion': 2, 'mode': 'fresh-reconstruction-candidate', 'startedAt': now(),
        'historicalManifestSha256': MANIFEST_SHA, 'historicalReplay': False, 'cacheUsed': False,
        'activation': 'NOT_REQUESTED', 'physicalValidation': 'UNKNOWN', 'redistributionApproved': False,
        'scriptSha256': digest(Path(__file__).read_bytes()), 'gates': {}, 'candidateEligibleForReview': False}
    report['trustedHelperSha256'] = {name: digest((code_root / name).read_bytes())
        for name in ('scripts/catalog_acquire.py', 'cad/catalog_geometry.py')}
    records = []
    try:
        fetcher = Fetcher(output)
        with ThreadPoolExecutor(max_workers=2) as pool:
            work = {pool.submit(fetcher.fetch, item): item for item in plan}
            for task in as_completed(work):
                record = task.result()
                records.append(record)
                print(json.dumps({'source': record['name'], 'status': record['status']}), flush=True)
                save(output / ('acquisition-checkpoint-' + str(len(records)).zfill(2) + '.json'), sorted(records, key=lambda x: x['name']))
        records.sort(key=lambda x: x['name'])
        save(output / 'source-index.json', {'schemaVersion': 2, 'historicalReplay': False, 'sources': records})
        report['gates']['freshAcquisition'] = len(records) == 25 and all(r['status'] == 'PASS' for r in records)
        report['gates']['exactAssetsAndAttributionHashes'] = all(r['status'] == 'PASS' and r.get('historicalBytesMatched') for r in records if not r['name'].endswith('.html'))
        candidate, observations, reviews, failures = reconstruct_manifest(original, records, output)
        save(output / 'observations.json', observations)
        save(output / 'claim-reviews.json', reviews)
        report['identityFailures'] = failures
        report['gates']['manufacturerIdentityAndContext'] = len(observations) == 8 and not failures
        report['gates']['technicalClaims'] = len(reviews) == 17 and all(x['status'] == 'REESTABLISHED' for x in reviews)
        # Attribution completeness is preservation, not a new legal permission assertion.
        attribution = [r for r in records if r['name'] in {'adafruit-1063-license.txt', 'adafruit-1063-readme.md'}]
        report['gates']['attributionRetained'] = len(attribution) == 2 and all(r['status'] == 'PASS' and r.get('historicalBytesMatched') for r in attribution)
        report['licenseBoundary'] = {'upstreamLicenseAndReadmeRetained': report['gates']['attributionRetained'],
            'manufacturerRightsRemainAsHistoricallyRecorded': True, 'unknownRightsNotPromoted': True, 'redistributionApproved': False}
        # A standalone candidate manifest is not the app's active catalog.
        save(output / 'manifest.json', candidate)
        report['candidateManifestSha256'] = digest((output / 'manifest.json').read_bytes())
        report['gates']['nativeGeometry'] = False
        if report['gates']['exactAssetsAndAttributionHashes']:
            spec = importlib.util.spec_from_file_location('catalog_acquire', code_root / 'scripts/catalog_acquire.py')
            acquire = importlib.util.module_from_spec(spec); spec.loader.exec_module(acquire)
            entries = acquire.extract_step_archives(output, records)
            save(output / 'model-inventory.json', entries)
            for component in candidate['components']:
                geometry = component.get('geometry')
                if geometry and digest((output / geometry['step']).read_bytes()) != geometry['sha256']:
                    raise ValueError('Derived geometry bytes changed')
            native = native_imports(output, code_root, python)
            save(output / 'native-imports.json', native)
            report['nativeImports'] = native
            report['gates']['nativeGeometry'] = True
        report['candidateEligibleForReview'] = all(report['gates'].values())
        report['status'] = 'CANDIDATE_GATES_PASS_REVIEW_REQUIRED' if report['candidateEligibleForReview'] else 'REVIEW_REQUIRED_NOT_ELIGIBLE'
    except Exception as exc:
        report['error'] = (type(exc).__name__ + ': ' + str(exc))[:1000]
        report['status'] = 'ERROR_NOT_ELIGIBLE'
    report['finishedAt'] = now()
    report['freshDownloads'] = sum(r['status'] == 'PASS' for r in records)
    report['exactNonHtmlSources'] = sum(r['status'] == 'PASS' and r.get('historicalBytesMatched', False) for r in records if not r['name'].endswith('.html'))
    report['mutableHtmlObservations'] = sum(r['status'] == 'PASS' for r in records if r['name'].endswith('.html'))
    save(output / 'reconstruction-report.json', report)
    print(json.dumps(report, indent=2))
    return 0 if report['candidateEligibleForReview'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
