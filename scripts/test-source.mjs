/** Run source-distributable tests without claiming absent supplier CAD was verified. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const catalogDependentSuites = [
  'kit.test.mjs', 'hardware-reference.test.mjs', 'hardware-power.test.mjs',
  'portable-kit.test.mjs', 'kit-registry.test.mjs', 'portable-package.test.mjs',
  'portable-service.test.mjs', 'portable-fasteners.test.mjs', 'portable-kit-v2.test.mjs',
];

export function sourceTestSelection(names, catalog) {
  if (!Array.isArray(catalog?.components)) throw new Error('Catalog manifest must declare its components array.');
  const deferred = catalog.components.length ? [] : names.filter(name => catalogDependentSuites.includes(name));
  return { tests: names.filter(name => !deferred.includes(name)).sort(), deferred: deferred.sort() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const catalog = JSON.parse(readFileSync(resolve(root, 'catalog/manifest.json'), 'utf8'));
  const names = readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.mjs'));
  const { tests, deferred } = sourceTestSelection(names, catalog);
  if (!tests.length) throw new Error('No source regression tests found.');
  if (deferred.length) {
    console.log(`Catalog is explicitly empty; ${deferred.length} supplier-CAD suites DEFERRED (not passed):\n${deferred.join('\n')}`);
    console.log('Restore the separately licensed catalog, then use npm test for the complete suite.');
  }
  const result = spawnSync(process.execPath, ['--test', ...tests.map(name => `tests/${name}`)], { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}
