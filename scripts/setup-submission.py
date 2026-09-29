#!/usr/bin/env python3
"""Clean source installation on Linux aarch64; explicit setup networking, no model pull."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Use prepopulated npm cache and --wheelhouse; never contact registries.')
    parser.add_argument('--wheelhouse', type=Path)
    parser.add_argument('--npm-cache', type=Path)
    parser.add_argument('--frontend-only', action='store_true', help='Explicitly skip native CAD installation/verification.')
    parser.add_argument('--verify-only', action='store_true', help='Use already installed dependencies; install nothing.')
    parser.add_argument('--smoke', action='store_true', help='Start and stop an isolated loopback server with blank inference settings.')
    args = parser.parse_args()
    if platform.system() != 'Linux' or platform.machine() != 'aarch64':
        raise SystemExit('This clean install targets Linux aarch64 (DGX). No emulation/system modification is attempted.')
    if sys.version_info[:2] != (3, 12):
        raise SystemExit('Use Python 3.12 for the recorded native dependency lock.')
    if not shutil.which('node') or not shutil.which('npm'):
        raise SystemExit('Install a reviewed Node 22.12+ runtime separately; this script never installs system packages.')
    node = subprocess.check_output(['node', '--version'], text=True).strip()
    if tuple(int(part) for part in node.removeprefix('v').split('.')[:3]) < (22, 12, 0):
        raise SystemExit('Node 22.12.0 or newer is required.')
    if args.offline and not args.frontend_only and not args.verify_only and not args.wheelhouse:
        raise SystemExit('Offline native installation needs an explicitly populated --wheelhouse.')
    setup = ROOT / '.setup'
    setup.mkdir(exist_ok=True)
    report = {'schemaVersion': 1, 'at': datetime.now(timezone.utc).isoformat(), 'arch': platform.machine(),
              'node': node, 'python': platform.python_version(), 'offlineInstallRequested': args.offline,
              'frontendOnly': args.frontend_only, 'verifyOnly': args.verify_only, 'steps': [],
              'modelPulled': False, 'modelInferenceTested': False, 'catalogRestored': False,
              'printerContacted': False, 'physicalValidation': 'UNKNOWN', 'ok': False}
    env = dict(os.environ)
    env.pop('OLLAMA_URL', None)
    env.pop('QWEN_MODEL', None)
    python = ROOT / '.venv-cad/bin/python'

    def run(name, command, timeout=900):
        print(name, flush=True)
        with (setup / (name + '.stdout.txt')).open('w') as stdout, (setup / (name + '.stderr.txt')).open('w') as stderr:
            completed = subprocess.run([str(x) for x in command], cwd=ROOT, env=env, text=True,
                                       stdout=stdout, stderr=stderr, timeout=timeout)
        report['steps'].append({'name': name, 'exitCode': completed.returncode})
        if completed.returncode:
            raise RuntimeError(name + ' failed; inspect its private .setup stdout/stderr.')

    try:
        if not args.verify_only:
            command = ['npm', 'ci', '--no-audit', '--no-fund']
            if args.offline:
                command.append('--offline')
            if args.npm_cache:
                command += ['--cache', str(args.npm_cache.resolve())]
            run('npm-ci', command)
            if not args.frontend_only:
                if not python.exists():
                    run('python-venv', [sys.executable, '-m', 'venv', ROOT / '.venv-cad'])
                command = [python, '-m', 'pip', '--isolated', 'install', '--only-binary=:all:',
                           '--report', setup / 'pip-report.json', '-r', ROOT / 'cad/requirements-lock-dgx.txt']
                if args.offline:
                    command += ['--no-index', '--find-links', args.wheelhouse.resolve()]
                else:
                    command += ['--index-url', 'https://pypi.org/simple']
                run('python-dependencies', command, 1800)
        run('frontend-build', ['npm', 'run', 'build'])
        # Source-kit suites require the separately restored manufacturer catalog.
        catalog = json.loads((ROOT / 'catalog/manifest.json').read_text())
        deferred = [] if catalog.get('components') else ['kit.test.mjs', 'hardware-reference.test.mjs', 'hardware-power.test.mjs', 'portable-kit.test.mjs', 'kit-registry.test.mjs', 'portable-package.test.mjs', 'portable-service.test.mjs', 'portable-fasteners.test.mjs', 'portable-kit-v2.test.mjs']
        report['deferredSourceSuites'] = deferred
        tests = [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'tests').glob('*.test.mjs'))
                 if p.name not in deferred]
        run('node-regression', ['node', '--test', *tests])
        if not args.frontend_only:
            if not python.is_file():
                raise RuntimeError('Native virtual environment is missing.')
            run('native-cad-tests', [python, 'tests/cad_worker_test.py', '--kernel'], 900)
            run('native-catalog-mates', [python, '-B', 'tests/catalog_mates_test.py', '--kernel'], 300)
            run('illustration-contract-tests', [python, '-B', 'tests/illustrate_test.py'], 120)
            output = setup / ('native-smoke-' + str(uuid.uuid4()))
            run('native-cad-smoke', [python, 'cad/worker.py', '--input', 'cad/smoke-spec.json', '--output', output], 300)
            native = json.loads((output / 'result.json').read_text())
            if native.get('ok') is not True:
                raise RuntimeError('Native smoke did not produce an OK receipt.')
            report['nativeCad'] = {'ok': True, 'parts': len(native.get('parts', [])), 'physicalValidation': 'UNKNOWN'}
        if args.smoke:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            env.update(PORT=str(port), OLLAMA_URL='', QWEN_MODEL='', M4KE_CAD_PYTHON=str(python))
            with (setup / 'server-smoke.txt').open('w') as log:
                process = subprocess.Popen(['node', 'server/index.mjs'], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
                try:
                    for _ in range(40):
                        if process.poll() is not None:
                            raise RuntimeError('Isolated server exited during readiness.')
                        try:
                            with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=2) as response:
                                health = json.load(response)
                            break
                        except OSError:
                            time.sleep(.25)
                    else:
                        raise RuntimeError('Isolated server readiness timed out.')
                    if health.get('cloudFallback') is not False or health.get('endpointConfigured') is not False:
                        raise RuntimeError('Clean server did not preserve blank local-inference configuration.')
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/studio/capabilities', timeout=40) as response:
                        capability = json.load(response)
                    if not args.frontend_only and capability.get('cad', {}).get('available') is not True:
                        raise RuntimeError('Clean server native CAD capability is unavailable.')
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=5) as response:
                        if b'<html' not in response.read().lower():
                            raise RuntimeError('Built frontend was not served.')
                    report['serverSmoke'] = {'health': health, 'cad': capability.get('cad'), 'frontendServed': True}
                finally:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
        report['ok'] = True
    except Exception as exc:
        report['error'] = str(exc)
    receipt = setup / 'clean-install.json'
    if receipt.exists():
        previous = setup / ('clean-install-' + hashlib.sha256(receipt.read_bytes()).hexdigest()[:16] + '.json')
        if not previous.exists():
            previous.write_bytes(receipt.read_bytes())
    receipt.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
