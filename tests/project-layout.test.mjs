import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectImport, inspectSource, literalImports } from '../scripts/check-source.mjs';
import { catalogDependentSuites, sourceTestSelection } from '../scripts/test-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('runtime entry and shared browser contract have one canonical location', () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.start, 'node server/index.mjs');
  assert(existsSync(join(root, 'server/index.mjs')));
  assert(existsSync(join(root, 'shared/car-contract.mjs')));
  assert.equal(existsSync(join(root, 'server.mjs')), false);
  assert.equal(existsSync(join(root, 'car-contract.mjs')), false);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts['test:e2e'], 'node tests/studio-shell-e2e.mjs && node tests/studio-electrical-e2e.mjs && node tests/vue-viewport-e2e.mjs');
  assert(existsSync(join(root, 'tests/studio-shell-e2e.mjs')));
});

test('repository local imports resolve with exact casing and preserve browser boundaries', () => {
  const result = inspectSource(root, { syntax: false });
  assert.deepEqual(result.errors, []);
  assert(result.filesChecked > 30);
});

test('AST import scan ignores comments and prose but includes reexports and literal dynamic imports', () => {
  const found = literalImports(`// import 'not-a-module';\nconst prose = "from 'fake'";\nimport {x} from './a.mjs';\nexport {y} from './b.mjs';\nawait import('./c.mjs');\nawait import(variable);`);
  assert.deepEqual(found.map(item => item.specifier), ['./a.mjs', './b.mjs', './c.mjs']);
  const browser = literalImports("await page.evaluate(async () => import('/src/App.tsx')); await import('/absolute-node-path.mjs');");
  assert.equal(browser[0].browserEvaluation, true);
  assert.equal(browser[1].browserEvaluation, false);
});

test('Vue single-file component imports include script setup and external blocks', () => {
  const source = '<script setup lang="ts">\nimport {ref} from "vue";\nimport Child from "./nested/Child.vue";\n</script>\n<template><Child /></template>\n<style src="./surface.css"></style>';
  assert.deepEqual(literalImports(source, 'App.vue').map(item => item.specifier), ['vue', './nested/Child.vue', './surface.css']);
  assert.throws(() => literalImports('<template><div></template>', 'Broken.vue'), /end tag|Element/i);
});

test('source checker rejects missing, wrong-case, traversal and layer-crossing imports', () => {
  const base = mkdtempSync(join(tmpdir(), 'm4ke-layout-'));
  try {
    for (const directory of ['src', 'shared', 'server']) mkdirSync(join(base, directory));
    writeFileSync(join(base, 'shared', 'Contract.mjs'), 'export const value = 1;');
    writeFileSync(join(base, 'server', 'index.mjs'), 'export const value = 1;');
    const frontend = join(base, 'src', 'App.tsx');
    assert.equal(inspectImport(base, frontend, '../shared/Contract.mjs'), null);
    assert.match(inspectImport(base, frontend, '../shared/contract.mjs'), /case-mismatched/);
    assert.match(inspectImport(base, frontend, '../server/index.mjs'), /frontend/);
    assert.match(inspectImport(base, frontend, 'node:fs'), /Node built-ins/);
    assert.equal(inspectImport(base, join(base, 'tests/example.test.mjs'), 'node:test'), null);
    assert.match(inspectImport(base, frontend, '../../outside.mjs'), /unsafe/);
    assert.match(inspectImport(base, frontend, 'https://example.invalid/code.js'), /URL/);
    assert.match(inspectImport(base, frontend, 'undeclared'), /undeclared dependency/);
    assert.match(inspectImport(base, join(base, 'shared/Contract.mjs'), '../server/index.mjs'), /shared/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('source-only tests explicitly defer supplier suites only when catalog is empty', () => {
  const names = ['project-layout.test.mjs', ...catalogDependentSuites];
  const empty = sourceTestSelection(names, { components: [] });
  assert.deepEqual(empty.tests, ['project-layout.test.mjs']);
  assert.equal(empty.deferred.length, 9);
  const restored = sourceTestSelection(names, { components: [{ id: 'example' }] });
  assert.equal(restored.tests.length, 10);
  assert.deepEqual(restored.deferred, []);
  assert.throws(() => sourceTestSelection(names, {}), /components array/);
});
