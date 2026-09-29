"""Local-only, explicit-profile Bambu Studio handoff. No printer/network commands."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import uuid
import zipfile

EXPECTED_EXE_SHA = '76b2193b0f2af958a2799bbbb98ebe5441f640a7cdfee582956d918e8a493d8f'
EXPECTED_ARCHIVE_SHA = '3faaa194a90a2e7defa39a6a63f5a654b8cdb762c6a98556cf771fba582229f5'
HOME = pathlib.Path(os.environ.get('LOCALAPPDATA', pathlib.Path.home())) / 'M4KE'
INSTALL = HOME / 'tools' / 'BambuStudio-2.8.2.61' / 'installation.json'

def read(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))

def write(path, value):
    pathlib.Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')

def installed():
    record = read(INSTALL)
    if record.get('sha256') != EXPECTED_ARCHIVE_SHA:
        raise ValueError('Portable archive does not match the recorded official release digest.')
    root = pathlib.Path(record['directory']).resolve()
    exe = root / 'bambu-studio.exe'
    if not exe.is_file() or hashlib.sha256(exe.read_bytes()).hexdigest() != EXPECTED_EXE_SHA:
        raise ValueError('Portable executable hash mismatch. Do not run this slicer.')
    return root, exe

class Profiles:
    def __init__(self, root):
        self.root = pathlib.Path(root) / 'resources' / 'profiles' / 'BBL'
        self.catalog = {}
    def index(self, kind):
        if kind not in self.catalog:
            index = {}
            for file in (self.root / kind).glob('*.json'):
                item = read(file)
                name = item.get('name', file.stem)
                if name in index:
                    raise ValueError('Ambiguous profile: ' + name)
                index[name] = (item, file)
            self.catalog[kind] = index
        return self.catalog[kind]

    def resolve(self, kind, name, stack=None, lineage=None):
        stack = list(stack or [])
        if name in stack or len(stack) > 24:
            raise ValueError('Profile inheritance cycle/depth violation: ' + name)
        if name not in self.index(kind):
            raise ValueError('Unknown exact profile: ' + name)
        item, file = self.index(kind)[name]
        lineage = lineage if lineage is not None else []
        stack.append(name)
        result = {}
        if item.get('inherits'):
            result.update(self.resolve(kind, item['inherits'], stack, lineage))
        for include in item.get('include', []):
            result.update(self.resolve(kind, include, stack, lineage))
        result.update({key: value for key, value in item.items() if key not in ('inherits', 'include')})
        lineage.append({'name': name, 'file': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
        return result

    def list(self, kind, machine=None, query=''):
        result = []
        for name, (item, _) in self.index(kind).items():
            if str(item.get('instantiation', '')).lower() != 'true' or query.lower() not in name.lower():
                continue
            resolved = self.resolve(kind, name)
            compatible = resolved.get('compatible_printers', [])
            if machine and (not compatible or machine not in compatible):
                continue
            result.append({'name': name, 'nozzle': resolved.get('nozzle_diameter'), 'material': resolved.get('filament_type'), 'compatiblePrinters': compatible})
        return sorted(result, key=lambda item: item['name'])

def contained(root, name):
    relative = pathlib.PurePosixPath(name.replace('\\', '/'))
    if relative.is_absolute() or '..' in relative.parts or any(':' in p for p in relative.parts):
        raise ValueError('Unsafe package path: ' + name)
    target = (root / pathlib.Path(*relative.parts)).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('Package path escapes extraction directory.')
    return target

def inputs(source, destination):
    source = pathlib.Path(source).resolve(strict=True)
    if source.suffix.lower() == '.stl':
        return [source]
    if source.suffix.lower() != '.zip':
        raise ValueError('Select a per-part STL or a M4KE build-package ZIP. Import other CAD manually in Bambu Studio.')
    extracted = destination / 'package'
    extracted.mkdir()
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(i.file_size for i in entries) > 200 * 1024 * 1024:
            raise ValueError('Package exceeds bounded extraction limits.')
        seen = set()
        for item in entries:
            target = contained(extracted, item.filename)
            key = str(target).lower()
            if key in seen or ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError('Duplicate path or symlink in package.')
            seen.add(key)
        archive.extractall(extracted)
    spec = read(extracted / 'design.json')
    cad = read(extracted / 'cad' / 'result.json')
    printed = {part['id'] for part in spec.get('parts', []) if part.get('kind') == 'printed'}
    paths = []
    for part in cad.get('parts', []):
        if part.get('id') in printed:
            name = part.get('stl')
            if not isinstance(name, str):
                raise ValueError('Printed part has no STL artifact.')
            target = contained(extracted / 'cad', name)
            if not target.is_file() or target.suffix.lower() != '.stl':
                raise ValueError('Missing printed-part STL.')
            paths.append(target)
    if not paths or len(paths) != len(printed):
        raise ValueError('Package did not resolve every printed part. Purchased envelopes are never substituted.')
    return paths

def prepare(source, machine, process, filament, bed, output=None):
    root, exe = installed()
    profiles = Profiles(root)
    selection = {'machine': machine, 'process': process, 'filament': filament, 'bed': bed}
    if not all(isinstance(value, str) and value.strip() for value in selection.values()):
        raise ValueError('Select machine/nozzle, process, filament and bed explicitly. There is no default printer.')
    resolved, lineage = {}, {}
    for kind, name in (('machine', machine), ('process', process), ('filament', filament)):
        lineage[kind] = []
        resolved[kind] = profiles.resolve(kind, name, lineage=lineage[kind])
        if str(resolved[kind].get('instantiation', '')).lower() != 'true':
            raise ValueError('Select an instantiated, not base/template profile: ' + name)
    for kind in ('process', 'filament'):
        if machine not in resolved[kind].get('compatible_printers', []):
            raise ValueError(f'{kind} profile does not explicitly declare compatibility with the selected machine/nozzle.')
    model_name = resolved['machine'].get('printer_model')
    model_record = profiles.catalog['machine'].get(model_name, ({}, None))[0]
    if bed in model_record.get('not_support_bed_type', '').split(';'):
        raise ValueError('The selected build plate is listed as unsupported by the machine model.')
    destination = pathlib.Path(output).resolve() if output else HOME / 'handoffs' / str(uuid.uuid4())
    destination.mkdir(parents=True, exist_ok=False)
    models = inputs(source, destination)
    for kind in resolved:
        write(destination / f'{kind}.json', resolved[kind])
    data_dir = HOME / 'bambu-isolated-profile'
    data_dir.mkdir(parents=True, exist_ok=True)
    record = {'status': 'prepared-not-sliced', 'selection': selection, 'directory': str(destination), 'executable': str(exe), 'executableSha256': EXPECTED_EXE_SHA, 'dataDirectory': str(data_dir), 'inputFiles': [{'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()} for file in models], 'profileLineage': lineage, 'printerConnected': False, 'printSent': False, 'physicalValidation': 'UNKNOWN'}
    write(destination / 'handoff.json', record)
    return record

def export_project(record, sliced=False):
    destination = pathlib.Path(record['directory'])
    result = destination / ('LOCAL-SLICE-REVIEW-REQUIRED.3mf' if sliced else 'M4KE-UNSLICED.3mf')
    command = [record['executable'], '--datadir', record['dataDirectory'], '--load-settings', str(destination / 'machine.json') + ';' + str(destination / 'process.json'), '--load-filaments', str(destination / 'filament.json'), '--curr-bed-type', record['selection']['bed'], '--check-preset', '--orient', '1', '--arrange', '1', '--outputdir', str(destination), '--export-3mf', result.name]
    if sliced:
        command += ['--slice', '0', '--mstpp', '120']
    command += [item['path'] for item in record['inputFiles']]
    write(destination / 'cli-command.json', {'arguments': command, 'hasPrinterOperations': False, 'sliceRequested': sliced})
    run = subprocess.run(command, cwd=str(pathlib.Path(record['executable']).parent), capture_output=True, timeout=240, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    (destination / 'cli-stdout.txt').write_bytes(run.stdout)
    (destination / 'cli-stderr.txt').write_bytes(run.stderr)
    record['cliExitCode'] = run.returncode
    if run.returncode != 0 or not result.is_file() or result.stat().st_size < 100:
        record['status'] = 'slicer-export-failed'
        write(destination / 'handoff.json', record)
        raise ValueError(f'Studio export failed (exit {run.returncode}); inspect {destination}. No printer was contacted.')
    with zipfile.ZipFile(result) as archive:
        names = archive.namelist()
        has_gcode = any(name.lower().endswith('.gcode') for name in names)
        if not any(name.endswith('.model') for name in names) or (sliced and not has_gcode) or (not sliced and has_gcode):
            raise ValueError('3MF readback did not match the requested artifact type.')
        settings = json.loads(archive.read('Metadata/project_settings.config'))
        if settings.get('printer_settings_id') != record['selection']['machine'] or settings.get('print_settings_id') != record['selection']['process'] or settings.get('filament_settings_id') != [record['selection']['filament']] or settings.get('curr_bed_type') != record['selection']['bed']:
            raise ValueError('3MF profile readback does not match every explicit selection.')
        nozzle = read(destination / 'machine.json').get('nozzle_diameter')
        if settings.get('nozzle_diameter') != nozzle:
            raise ValueError('3MF nozzle readback mismatch.')
        record['readback'] = {key: settings.get(key) for key in ('printer_model','printer_settings_id','print_settings_id','filament_settings_id','nozzle_diameter','filament_type','curr_bed_type','layer_height')}
        record['readback']['modelPresent'] = True
        record['readback']['gcodePresent'] = has_gcode
        if sliced:
            gcode_hashes = {}
            for name in names:
                if name.lower().endswith('.gcode'):
                    digest = hashlib.md5(archive.read(name)).hexdigest()
                    if name + '.md5' not in names or archive.read(name + '.md5').decode('ascii').strip().lower() != digest:
                        raise ValueError('Sliced G-code does not match its stored integrity digest.')
                    gcode_hashes[name] = digest
            record['readback']['gcodeMd5'] = gcode_hashes
    record.update(status='sliced-for-review-only' if sliced else 'unsliced-project-created', project=str(result), projectSha256=hashlib.sha256(result.read_bytes()).hexdigest(), gcodePresent=has_gcode, reviewRequired=True)
    if sliced and (destination / 'result.json').is_file():
        native = read(destination / 'result.json')
        record['slicerReport'] = {'returnCode':native.get('return_code'),'plates':native.get('sliced_plates',[]),'estimatesNotMeasurements':True}
    write(destination / 'handoff.json', record)
    return record

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('profiles');listing.add_argument('--kind', choices=['machine', 'process', 'filament'], required=True);listing.add_argument('--machine');listing.add_argument('--query', default='')
    for action in ('prepare', 'project', 'slice'):
        item = sub.add_parser(action)
        item.add_argument('input');item.add_argument('--machine', required=True);item.add_argument('--process', required=True);item.add_argument('--filament', required=True);item.add_argument('--bed', required=True);item.add_argument('--output')
        if action == 'slice':item.add_argument('--confirm-local-slice', action='store_true', required=True)
    args = parser.parse_args()
    if args.command == 'profiles':
        print(json.dumps(Profiles(installed()[0]).list(args.kind, args.machine, args.query), ensure_ascii=False));return
    record = prepare(args.input, args.machine, args.process, args.filament, args.bed, args.output)
    if args.command in ('project', 'slice'):record = export_project(record, args.command == 'slice')
    print(json.dumps(record, ensure_ascii=False))

if __name__ == '__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'error': str(error), 'printerConnected': False, 'printSent': False}), file=sys.stderr)
        sys.exit(1)

