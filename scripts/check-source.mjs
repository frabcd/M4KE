/** Static checks only: this script never imports application modules or starts services. */
import { isBuiltin } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse as parseVue } from '@vue/compiler-sfc';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folders = ['src', 'server', 'shared', 'engineering', 'procurement', 'printing', 'scripts', 'tests'];
const extensions = new Set(['.mjs', '.js', '.ts', '.tsx', '.vue']);
const posix = path => path.split(sep).join('/');

export function literalImports(source, filename = 'source.mjs') {
  if (filename.endsWith('.vue')) {
    const { descriptor, errors } = parseVue(source, { filename });
    if (errors.length) throw new Error(errors.map(error => typeof error === 'string' ? error : error.message).join('; '));
    const imports = [];
    for (const block of [descriptor.script, descriptor.scriptSetup, descriptor.template, ...descriptor.styles].filter(Boolean)) {
      if (block.src) imports.push({ specifier: block.src, line: block.loc.start.line, browserEvaluation: false });
      else if (block.type === 'script') imports.push(...literalImports(block.content, filename + '.ts').map(item => ({ ...item, line: item.line + block.loc.start.line - 1 })));
    }
    return imports;
  }
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? node.arguments[0]
        : undefined;
    if (specifier && ts.isStringLiteralLike(specifier)) {
      const line = file.getLineAndCharacterOfPosition(specifier.getStart(file)).line + 1;
      let browserEvaluation = false;
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
            && ['evaluate', 'evaluateHandle'].includes(parent.expression.name.text)) browserEvaluation = true;
      }
      imports.push({ specifier: specifier.text, line, browserEvaluation });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

// Checking each segment also catches Linux-only casing failures on Windows.
function exactFile(base, candidate) {
  const parts = relative(base, candidate).split(sep);
  if (parts[0] === '..' || isAbsolute(relative(base, candidate))) return false;
  let current = base;
  for (const part of parts) {
    const entry = readdirSync(current, { withFileTypes: true }).find(item => item.name === part);
    if (!entry || entry.isSymbolicLink()) return false;
    current = resolve(current, part);
  }
  return statSync(current).isFile();
}

export function inspectImport(base, filename, specifier, dependencies = {}, browserEvaluation = false) {
  const layer = posix(relative(base, filename)).split('/')[0];
  if (isBuiltin(specifier)) {
    return ['src', 'shared'].includes(layer) ? 'browser-safe code must not import Node built-ins' : null;
  }
  if (browserEvaluation && layer === 'tests' && /^\/(src|node_modules)\//.test(specifier)) {
    try { if (exactFile(base, resolve(base, `.${specifier}`))) return null; }
    catch { /* Report the unresolved browser module below. */ }
    return `missing or case-mismatched browser evaluation import: ${specifier}`;
  }
  if (!specifier.startsWith('.')) {
    if (/^(?:[a-z]+:|\/)/i.test(specifier)) return 'URL and absolute-path module imports are not supported';
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
    return dependencies[packageName] ? null : `undeclared dependency: ${packageName}`;
  }
  const requested = resolve(dirname(filename), specifier);
  const candidates = extname(requested) ? [requested]
    : /\.(?:tsx?|vue)$/.test(filename) ? ['.ts', '.tsx', '.mjs', '.js'].map(extension => requested + extension) : [];
  let target;
  for (const candidate of candidates) {
    try { if (exactFile(base, candidate)) { target = candidate; break; } }
    catch { /* A missing intermediate directory is reported below, never silently accepted. */ }
  }
  if (!target) return `missing, case-mismatched, unsafe or extensionless local import: ${specifier}`;
  const targetLayer = posix(relative(base, target)).split('/')[0];
  if (layer === 'src' && !['src', 'shared'].includes(targetLayer)) return 'frontend imports must stay in src/ or shared/';
  if (layer === 'shared' && targetLayer !== 'shared') return 'shared code must not depend on application layers';
  return null;
}

export function inspectSource(base = root, { syntax = true } = {}) {
  const errors = [];
  const files = [];
  const manifest = JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const walk = (directory, recursive) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const filename = resolve(directory, entry.name);
      if (entry.isFile() && extensions.has(extname(entry.name))) files.push(filename);
      else if (recursive && entry.isDirectory() && !['node_modules', 'dist', 'test-results', '__pycache__', '.git'].includes(entry.name)) walk(filename, true);
    }
  };
  // Procurement/printing subtrees also contain private downloaded tools and data.
  for (const folder of folders) walk(resolve(base, folder), !['procurement', 'printing'].includes(folder));
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.mjs')) errors.push(`${entry.name}: move runtime modules out of the repository root`);
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(resolve(base, entry.name));
  }
  for (const filename of files.sort()) {
    const name = posix(relative(base, filename));
    if (syntax && /\.m?js$/.test(filename)) {
      const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8', timeout: 30_000 });
      if (result.status !== 0) errors.push(`${name}: ${result.error?.message || result.stderr.trim() || 'Node syntax check failed'}`);
    }
    try {
      for (const { specifier, line, browserEvaluation } of literalImports(readFileSync(filename, 'utf8'), filename)) {
        const issue = inspectImport(base, filename, specifier, dependencies, browserEvaluation);
        if (issue) errors.push(`${name}:${line}: ${issue}`);
      }
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  return { ok: errors.length === 0, filesChecked: files.length, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectSource();
  if (result.ok) console.log(`Source checks passed: ${result.filesChecked} files (syntax, literal imports, path casing, browser boundaries).`);
  else console.error(result.errors.join('\n'));
  process.exitCode = result.ok ? 0 : 1;
}
