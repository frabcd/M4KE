#!/usr/bin/env python3
"""Validate the source-only review ZIP; never publish or extract it."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

ROOT_FILES = {
    'README.md', 'LICENSE', '.env.example', '.gitignore', 'package.json',
    'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts',
    'CONTRIBUTING.md', 'SECURITY.md', '.editorconfig', '.gitattributes',
}
SERVER_FILES = {
    'server/index.mjs',
    'server/studio-architecture-plan.mjs',
    'server/studio-candidate-context.mjs',
    'server/studio-catalog.mjs',
    'server/studio-clarification.mjs',
    'server/studio-contract.mjs',
    'server/studio-electrical.mjs',
    'server/studio-electrical-profiles.mjs',
    'server/studio-http.mjs',
    'server/studio-inference-config.mjs',
    'server/studio-vllm.mjs',
    'server/studio-illustrations.mjs',
    'server/studio-integrations.mjs',
    'server/studio-library.mjs',
    'server/studio-model-repair.mjs',
    'server/studio-refinement.mjs',
    'server/studio-web-research.mjs',
    'server/studio-model-library.mjs',
    'server/studio-previews.mjs',
    'server/studio-printer.mjs',
    'server/studio-printing.mjs',
    'server/studio-process.mjs',
    'server/studio-procurement.mjs',
    'server/studio-projects.mjs',
    'server/studio-repair.mjs',
    'server/studio-review.mjs',
    'server/studio-schema.mjs',
    'server/studio-service.mjs',
    'server/studio-generation-diagnostics.mjs',
    'server/studio-request-constraints.mjs',
    'server/studio-skills.mjs',
    'server/studio-usability.mjs',
    'server/studio-verification-plan.mjs',
}
EXACT = {
    'scripts/codex-demo-bridge.mjs', 'docs/codex-online-demo.md', 'docs/qwen-workflow-update.md',
    'scripts/benchmark-local-models.mjs', 'tests/cad_hole_depth_test.py', 'docs/model-runtime-comparison.md', 'DESIGN.md',
    'shared/car-contract.mjs',
    'docs/architecture.md', 'docs/project-layout.md', 'docs/README.md',
    '.github/workflows/ci.yml', 'scripts/check-source.mjs', 'scripts/test-source.mjs',
    'tests/studio-shell-e2e.mjs', 'tests/vue-viewport-e2e.mjs', 'tests/vue-workspace-live.mjs', 'tests/vue-deployed-e2e.mjs',
    'cad/library_geometry.py', 'skills/prompt-to-cad/runtime-library.md', 'tests/library_geometry_test.py', 'docs/vue-workspace.md', 'docs/vue-validation.md',
    'catalog/manifest.json', 'catalog/reference-manifest.json', 'catalog/reference-source-index.json', 'catalog/interface-surface-inventory.json',
    'cad/requirements.txt', 'cad/requirements-lock-dgx.txt', 'cad/smoke-spec.json',
    'cad/worker.py', 'cad/catalog_geometry.py', 'cad/catalog_mates.py', 'tests/catalog_mates_test.py', 'cad/catalog_geometry_test.py', 'cad/illustrate.py',
    'cad/verify_install.py', 'components/car-reference.json', 'docs/car-power-and-wiring.md',
    'scripts/benchmark-general-toys.mjs', 'scripts/package-submission.py', 'scripts/check-submission.py', 'scripts/setup-submission.py',
    'scripts/restore-submission-catalog.py', 'scripts/setup-dgx-slicer.py',
    'scripts/stage-submission-wheels.py',
    'scripts/catalog_reconstruct.py', 'scripts/catalog_claims.py', 'tests/catalog_reconstruct_test.py', 'docs/source-reconstruction.md', 'docs/skill-integration-handoff.md', 'docs/coop4-integration.md', 'scripts/catalog_acquire.py', 'scripts/catalog_build_manifest.py',
    'scripts/catalog_inspect_interfaces.py', 'scripts/catalog_verify_offline.py',
    'printing/dgx/adapter.py', 'printing/dgx/profiles.py', 'printing/dgx/seccomp_offline.py',
    'printing/dgx/test_adapter.py', 'printing/dgx/make_smoke_fixture.py',
    'printing/bambu_handoff.py', 'printing/lan-monitor.mjs',
    'procurement/snapshot.mjs', 'procurement/import.mjs', 'procurement/SCHEMA.md',
    'docs/printer-lan.md', 'docs/procurement-offline.md', 'docs/portable-car-layout.md',
    'skills/prompt-to-cad/SKILL.md', 'skills/prompt-to-cad/runtime-design.md', 'skills/prompt-to-cad/runtime-refinement.md', 'skills/prompt-to-cad/runtime-architecture.md',
    'skills/engineering-verification/SKILL.md', 'skills/engineering-verification/runtime-verify.md', 'skills/engineering-verification/runtime-repair.md', 'skills/engineering-verification/runtime-plan.md', 'tests/studio-electrical-fixture.mjs', 'tests/studio-electrical-e2e.mjs', 'tests/studio-electrical-live-e2e.mjs', 'docs/electrical-workflow.md',
    'skills/james-dyson-perspective/SKILL.md',
    'skills/james-dyson-perspective/references/research/focused-engineering.md',
    'tests/cad_worker_test.py', 'tests/cad_cut_diagnostics_test.py', 'tests/illustrate_test.py', 'tests/submission_package_test.py',
}
DOCS = {'README.zh-CN.md', 'DEPLOYMENT.md', 'INVENTORY.md', 'RELEASE-DECISIONS.md',
        'LICENSE-NOTES.md', 'VALIDATION.md', 'SOURCE-DRIFT-REVIEW.md', 'competition-release-checklist.md', 'PUBLIC-RELEASE.md'}
INTERFACE_INVENTORY_SHA256 = '0dcb812bfeaef345b0edf03bb272eedd18612f1228d23d290faf485f9f4e84ca'


def validate_interface_inventory(data, reference):
    """Reviewed numerical source evidence only; no STEP, rights or fit promotion."""
    errors=[]
    digest=hashlib.sha256(data).hexdigest()
    if len(data)>2*1024*1024 or digest!=INTERFACE_INVENTORY_SHA256:
        return ['reviewed interface inventory SHA256/size mismatch']
    try:
        rows=json.loads(data)
        if not isinstance(rows,list) or len(rows)>500:raise ValueError('invalid inventory entries')
        for component in reference.get('components',[]):
            geometry=component.get('geometry') or {}
            for interface in component.get('interfaces',[]):
                if not interface.get('evidenceArtifact'):continue
                if interface['evidenceArtifact']!='interface-surface-inventory.json' or interface.get('evidenceSha256')!=digest:
                    raise ValueError('reference interface evidence path/hash mismatch')
                if interface.get('sourceSha256')!=geometry.get('sha256') or interface.get('sourceArtifact')!=geometry.get('originalPath',geometry.get('step')):
                    raise ValueError('reference interface STEP binding mismatch')
                matches=[r for r in rows if r.get('sha256')==interface['sourceSha256'] and r.get('path')==interface['sourceArtifact']]
                if len(matches)!=1:raise ValueError('reference interface source absent/ambiguous in inventory')
    except (ValueError,TypeError,KeyError,AttributeError) as error:errors.append(str(error))
    return errors


def allowed_name(name):
    p = PurePosixPath(name)
    if '\\' in name or ':' in name or p.is_absolute() or any(x in {'', '.', '..'} for x in name.split('/')):
        return False
    if name in ROOT_FILES or name in SERVER_FILES or name in EXACT or name == 'SUBMISSION-MANIFEST.json':
        return True
    if 2 <= len(p.parts) <= 6 and p.parts[0] == 'src' and p.suffix in {'.ts', '.tsx', '.mjs', '.css', '.vue'} and not any(x.startswith('.') or x in {'node_modules','dist','test-results'} for x in p.parts[1:]):
        return True
    if len(p.parts) == 2 and p.parts[0] == 'engineering' and p.suffix == '.mjs':
        return True
    if len(p.parts) == 2 and p.parts[0] == 'tests' and p.name.endswith('.test.mjs'):
        return True
    if len(p.parts) == 3 and p.parts[:2] == ('firmware', 'sound-car') and (p.suffix == '.py' or p.name == 'README.md'):
        return True
    return len(p.parts) == 3 and p.parts[:2] == ('docs', 'submission') and p.name in DOCS


def scan_bytes(name, data):
    """Bounded known-risk screen, not a claim of universal secret detection."""
    errors = []
    if len(data) > 4 * 1024 * 1024:
        errors.append('source file exceeds 4 MiB')
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        return ['non-UTF8/binary content forbidden']
    # Use generic patterns: embedding even split operational identifiers in a
    # scanner would itself disclose them in the public source.
    patterns = [
        ('tunnel deployment domain', r'(?i)\b[a-z0-9-]+\.vicp\.(?:fun|net|org|cc|io)\b'),
        ('personal Linux home path', r'/home/[A-Za-z0-9._-]+/'),
        ('personal Windows home path', r'(?i)[a-z]:[\\/]+Users[\\/]+[A-Za-z0-9._ -]+[\\/]'),
        ('GitHub credential', r'\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b'),
    ]
    # Private-address literals in test fixtures are synthetic network-policy
    # controls; deployment/configuration and documentation remain screened.
    if not name.startswith('tests/'):
        patterns.append(('private deployment IP', r'(?<![\d.])(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}(?![\d.])'))
    for label, pattern in patterns:
        if re.search(pattern, text):
            errors.append(label)
    blocked = [('SSH private key', '-----BEGIN ' + 'OPENSSH PRIVATE KEY-----'),
               ('PEM private key', '-----BEGIN ' + 'PRIVATE KEY-----'),
               ('RSA private key', '-----BEGIN ' + 'RSA PRIVATE KEY-----')]
    for label, value in blocked:
        if value.lower() in text.lower():
            errors.append(label)
    scanned = text.replace('http://user:' + 'pass@', '') if name == 'tests/server.test.mjs' else text
    if name == 'tests/studio-library.test.mjs':
        scanned = scanned.replace('https://user:' + 'password@', '')
    if name == 'tests/procurement.test.mjs':
        scanned = scanned.replace('https://user:' + 'secret@example.com/p', '')
    if name == 'tests/catalog_reconstruct_test.py':
        scanned = scanned.replace('https://user:' + 'secret@www.pololu.com/x', '')
    if re.search(r'(?i)https?://[^\s/@:]+:[^\s/@]+@', scanned):
        errors.append('credential-bearing HTTP URL')
    if name == '.env.example':
        lines = [line for line in text.splitlines() if line and not line.startswith('#')]
        if any(line not in {'OLLAMA_URL=', 'QWEN_MODEL=', 'M4KE_INFERENCE_PROVIDER=', 'PORT=4173', 'M4KE_ALLOW_WEB=', 'M4KE_SEARCH_URL=', 'M4KE_SEARCH_ENGINES='} for line in lines):
            errors.append('environment example contains nonblank runtime configuration')
    return errors


def check_archive(path):
    errors = []
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) > 500 or len(names) != len(set(names)):
            raise ValueError('Invalid entry count or duplicate archive paths')
        if sum(entry.file_size for entry in entries) > 16 * 1024 * 1024:
            raise ValueError('Unpacked source exceeds 16 MiB')
        payloads = {}
        for entry in entries:
            name = entry.filename
            file_type = stat.S_IFMT(entry.external_attr >> 16)
            if not allowed_name(name) or entry.is_dir() or file_type not in {0, stat.S_IFREG}:
                errors.append({'file': name, 'error': 'path outside source allowlist or nonregular entry'})
                continue
            if entry.file_size > 4 * 1024 * 1024:
                errors.append({'file': name, 'error': 'source file exceeds limit'})
                continue
            data = archive.read(entry)
            payloads[name] = data
            errors.extend({'file': name, 'error': problem} for problem in scan_bytes(name, data))
        if 'SUBMISSION-MANIFEST.json' not in payloads:
            raise ValueError('Missing submission manifest')
        manifest = json.loads(payloads['SUBMISSION-MANIFEST.json'])
        expected = manifest.get('files', {})
        if manifest.get('schemaVersion') != 1 or type(manifest.get('publicationApproved')) is not bool or manifest.get('licenseApproved') is not True or manifest.get('originalCodeLicense') != 'MIT':
            errors.append({'error': 'release boundary metadata missing or changed'})
        actual = {name: data for name, data in payloads.items() if name != 'SUBMISSION-MANIFEST.json'}
        if set(expected) != set(actual):
            errors.append({'error': 'manifest membership mismatch'})
        for name, data in actual.items():
            record = expected.get(name, {})
            if record.get('sha256') != hashlib.sha256(data).hexdigest() or record.get('bytes') != len(data):
                errors.append({'file': name, 'error': 'manifest hash or byte count mismatch'})
        for required in ROOT_FILES | SERVER_FILES | EXACT | {'docs/submission/' + name for name in DOCS}:
            if required not in actual:
                errors.append({'file': required, 'error': 'required source/document missing'})
        if 'catalog/manifest.json' in actual:
            c = json.loads(actual['catalog/manifest.json'])
            if c.get('components') != [] or c.get('kits') != []:
                errors.append({'error': 'runtime catalog must stay empty until separately sourced'})
        if 'catalog/interface-surface-inventory.json' in actual and 'catalog/reference-manifest.json' in actual:
            errors.extend({'file':'catalog/interface-surface-inventory.json','error':problem} for problem in validate_interface_inventory(actual['catalog/interface-surface-inventory.json'],json.loads(actual['catalog/reference-manifest.json'])))
        result = {'schemaVersion': 1, 'ok': not errors, 'files': len(actual),
                  'archiveSha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(),
                  'archiveBytes': Path(path).stat().st_size, 'errors': errors,
                  'publicationApproved': manifest.get('publicationApproved'), 'licenseApproved': True, 'originalCodeLicense': 'MIT',
                  'scope': 'Allowlist/hash/known-risk scan only; not legal approval or physical validation.'}
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = check_archive(args.archive)
    encoded = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(encoded, encoding='utf-8')
    print(encoded, end='')
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
