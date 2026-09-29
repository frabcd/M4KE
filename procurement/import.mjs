#!/usr/bin/env node
/** Local-only snapshot admission. Never logs credentials, contacts suppliers or orders. */
import { mkdir, lstat, readFile, writeFile, rename, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonicalJson, LIMITS, sha256, validateSnapshot, verifyBundle, quoteLine } from './snapshot.mjs';

export const PROCUREMENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const HASH = /^[a-f0-9]{64}$/;
const fail = message => { throw new Error(`Supplier import: ${message}`); };
async function realDirectory(directory) {
  await mkdir(directory, { recursive: true });
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink() || await realpath(directory) !== path.resolve(directory)) fail('directory links are forbidden');
}
async function readJson(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.jsonBytes || await realpath(file) !== path.resolve(file)) fail('JSON must be a bounded ordinary file');
  const bytes = await readFile(file);
  if (bytes.length > LIMITS.jsonBytes) fail('JSON too large');
  return JSON.parse(bytes.toString('utf8'));
}
function contained(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function readImportedSnapshot(digest, { root = PROCUREMENT_ROOT, now = Date.now() } = {}) {
  if (!HASH.test(digest)) fail('snapshot id must be SHA256');
  root = path.resolve(root);
  const directory = path.join(root, 'snapshots', digest);
  if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) fail('stored directory link forbidden');
  const snapshot = await readJson(path.join(directory, 'snapshot.json'));
  const verification = await verifyBundle(snapshot, directory, { now });
  if (verification.snapshotSha256 !== digest) fail('stored manifest hash mismatch');
  return { snapshot, verification };
}

export async function importSnapshot(bundleName, { root = PROCUREMENT_ROOT, now = Date.now() } = {}) {
  if (typeof bundleName !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(bundleName)) fail('bundle name invalid; use a direct incoming subdirectory');
  root = path.resolve(root);
  const incoming = path.join(root, 'incoming'); const bundle = path.join(incoming, bundleName);
  if (!contained(incoming, bundle) || await realpath(bundle) !== bundle || (await lstat(bundle)).isSymbolicLink()) fail('input bundle must be an ordinary incoming directory');
  const snapshot = validateSnapshot(await readJson(path.join(bundle, 'snapshot.json')), { now });
  const verified = await verifyBundle(snapshot, bundle, { now }); const digest = verified.snapshotSha256;
  const store = path.join(root, 'snapshots'); await realDirectory(store);
  const destination = path.join(store, digest);
  try {
    await lstat(destination);
    const existing = await readImportedSnapshot(digest, { root, now });
    return { ...existing.verification, imported: false, snapshotId: digest, directory: path.relative(root, destination).replaceAll('\\', '/'), printerContacted: false, purchaseMade: false };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = path.join(store, `.incoming-${randomUUID()}`);
  await mkdir(temporary); await mkdir(path.join(temporary, 'evidence'));
  try {
    const copied = new Set();
    for (const e of snapshot.evidence) {
      if (copied.has(e.file)) continue;
      const bytes = await readFile(path.join(bundle, e.file));
      if (bytes.length > LIMITS.evidenceBytes || sha256(bytes) !== e.sha256) fail('source changed during import');
      await writeFile(path.join(temporary, e.file), bytes, { flag: 'wx' });
      copied.add(e.file);
    }
    await writeFile(path.join(temporary, 'snapshot.json'), `${canonicalJson(snapshot)}\n`, { flag: 'wx' });
    const finalVerification = await verifyBundle(snapshot, temporary, { now });
    await writeFile(path.join(temporary, 'import-receipt.json'), JSON.stringify({ ...finalVerification, importedAt: new Date(now).toISOString(), immutableByConvention: true, purchaseMade: false }, null, 2), { flag: 'wx' });
    await rename(temporary, destination);
    await readImportedSnapshot(digest, { root, now });
    return { ...finalVerification, imported: true, snapshotId: digest, directory: path.relative(root, destination).replaceAll('\\', '/'), printerContacted: false, purchaseMade: false };
  } finally {
    // Only the fresh UUID staging directory created above; never remove existing snapshots.
    if (path.dirname(temporary) === store && path.basename(temporary).startsWith('.incoming-')) await rm(temporary, { recursive: true, force: true });
  }
}

/** Safe integration entrypoint: reads and verifies stored hashes before calculating. */
export async function quoteImportedSnapshot(digest, request, options = {}) {
  const { snapshot, verification } = await readImportedSnapshot(digest, options);
  return { snapshotSha256: verification.snapshotSha256, networkUsed: false, ...quoteLine(snapshot, request, options) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, argument, ...extra] = process.argv.slice(2);
  try {
    if (extra.length || !argument) fail('usage: node procurement/import.mjs import BUNDLE_NAME | verify SHA256');
    const result = command === 'import' ? await importSnapshot(argument) : command === 'verify' ? (await readImportedSnapshot(argument)).verification : fail('unknown command');
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
