import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LIMITS, PARTS, STEPS, validateParameters, signature, calculate, newProject, applyChanges, evidenceCurrent, canComplete, loadProject, restoreLocal, csvBOM, mountDXF } from '../src/domain.ts';

const byId = (e, id) => e.checks.find(c => c.id === id);

test('parameter validation accepts inclusive limits and rejects missing, nonnumeric, nonfinite and outside values', () => {
  assert.equal(validateParameters(DEFAULTS), true);
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    for (const n of [lo, hi]) assert.equal(validateParameters({...DEFAULTS, [key]: n}), true);
    for (const n of [lo - .01, hi + .01, NaN, Infinity, -Infinity, undefined, null, String(lo)]) {
      assert.equal(validateParameters({...DEFAULTS, [key]: n}), false, `${key}: ${String(n)}`);
    }
  }
  for (const value of [null, undefined, false, 1, '', {}, []]) assert.equal(validateParameters(value), false);
  assert.throws(() => calculate({...DEFAULTS, rpm: NaN}, 1));
});

test('calculation matches independent known ideal equations and is deterministic apart from timestamp', () => {
  const p = {...DEFAULTS, wheelRadius: 50, rpm: 1200, angle: 45};
  const a = calculate(p, 7), b = calculate(p, 7);
  const speed = .7 * 2 * Math.PI * .05 * 1200 / 60;
  assert.equal(byId(a, 'velocity').actual, `${speed.toFixed(2)} m/s`);
  assert.equal(byId(a, 'trajectory').actual, `${(speed ** 2 / 9.81).toFixed(2)} m`);
  assert.equal(a.version, 7);
  assert.equal(a.signature, signature(p));
  assert.equal(Number.isNaN(Date.parse(a.createdAt)), false);
  assert.deepEqual(a.checks, b.checks);
  assert.equal(a.checks.length, 8);
  for (const id of ['velocity', 'torque', 'print', 'safety']) assert.equal(byId(a, id).status, 'UNKNOWN');
});

test('trajectory and clearance have reproducible FAIL and threshold results', () => {
  assert.equal(byId(calculate({...DEFAULTS, rpm: 300}, 1), 'trajectory').status, 'FAIL');
  assert.equal(byId(calculate({...DEFAULTS, rpm: 2000}, 1), 'trajectory').status, 'PASS');
  assert.equal(byId(calculate({...DEFAULTS, clearance: 1.49}, 1), 'clearance').status, 'FAIL');
  assert.equal(byId(calculate({...DEFAULTS, clearance: 1.5}, 1), 'clearance').status, 'PASS');
});

test('packaging and envelope are independent checks with inclusive thresholds', () => {
  const p = {...DEFAULTS, wheelRadius: 50};
  assert.equal(byId(calculate({...p, width: 279}, 1), 'packaging').status, 'FAIL');
  assert.equal(byId(calculate({...p, width: 280}, 1), 'packaging').status, 'PASS');
  assert.equal(byId(calculate({...p, width: 300}, 1), 'volume').status, 'PASS');
  assert.equal(byId(calculate({...p, width: 301}, 1), 'volume').status, 'FAIL');
});

test('changes invalidate evidence and progress without mutating old revision', () => {
  const p = newProject();
  p.evidence = calculate(p.parameters, p.version);
  p.completed = ['prepare'];
  assert.equal(evidenceCurrent(p), true);
  const updated = applyChanges(p, {width: 290}, 'Wider');
  assert.equal(updated.version, 2);
  assert.equal(updated.history.length, 2);
  assert.equal(evidenceCurrent(updated), false);
  assert.deepEqual(updated.completed, []);
  assert.equal(p.parameters.width, DEFAULTS.width);
  assert.deepEqual(p.completed, ['prepare']);
  assert.equal(evidenceCurrent({...p, evidence: {...p.evidence, version: 999}}), false);
  assert.equal(evidenceCurrent({...p, parameters: {...p.parameters, rpm: 1000}}), false);
});

test('no-op changes preserve identity and unsupported or invalid edits throw', () => {
  const p = newProject();
  assert.equal(applyChanges(p, {}, 'No-op'), p);
  assert.equal(applyChanges(p, {width: p.parameters.width}, 'No-op'), p);
  assert.throws(() => applyChanges(p, {notAParameter: 1}, 'Invalid'));
  assert.throws(() => applyChanges(p, {rpm: NaN}, 'Invalid'));
  assert.throws(() => applyChanges(p, {width: 10000}, 'Invalid'));
});

test('inherited object keys cannot bypass supported-parameter validation', () => {
  for (const key of ['constructor', 'toString', '__proto__']) {
    const edits = Object.fromEntries([[key, 42], ['width', 281]]);
    assert.throws(() => applyChanges(newProject(), edits, 'Invalid'), /Unsupported parameter/);
  }
});

test('import sanitizes parameter keys and discards malformed or impossible revision entries', () => {
  const p = newProject();
  const valid = p.history[0];
  p.parameters.extraField = 'not a parameter';
  p.history = [valid, ...[
    {version: -8}, {version: 0}, {version: 2}, {version: 1.5},
    {version: Number.MAX_SAFE_INTEGER + 1}, {createdAt: 'not a date'},
    {label: 'x'.repeat(201)}, {parameters: {...DEFAULTS, rpm: null}},
  ].map(change => ({...valid, ...change}))];
  const clean = loadProject(JSON.stringify(p));
  assert.equal(clean.history.length, 1);
  assert.equal(Object.hasOwn(clean.parameters, 'extraField'), false);
  assert.equal(Object.hasOwn(clean.history[0].parameters, 'extraField'), false);
  assert.throws(() => loadProject('null'));
  assert.throws(() => loadProject(JSON.stringify({...p, version: Number.MAX_SAFE_INTEGER + 1})));
});

test('step dependencies gate sequential completion and all part references resolve', () => {
  const completed = [], ids = new Set(PARTS.map(p => p.id));
  assert.equal(new Set(STEPS.map(s => s.id)).size, STEPS.length);
  assert.equal(new Set(PARTS.map(p => p.id)).size, PARTS.length);
  for (const step of STEPS) {
    if (step.dependsOn.length) assert.equal(canComplete(step, []), false);
    assert.equal(canComplete(step, completed), true);
    for (const id of step.partIds) assert.equal(ids.has(id), true, id);
    completed.push(step.id);
  }
  for (const check of calculate(DEFAULTS, 1).checks) for (const id of check.partIds) assert.equal(ids.has(id), true, id);
});

test('import discards forged evidence and progress, validates parameters and schema', () => {
  const p = newProject();
  p.completed = STEPS.map(s => s.id);
  p.evidence = {...calculate(DEFAULTS, 1), checks: [{id: 'fake', status: 'PASS'}]};
  const imported = loadProject(JSON.stringify(p));
  assert.equal(imported.evidence, null);
  assert.deepEqual(imported.completed, []);
  assert.deepEqual(imported.parameters, DEFAULTS);
  for (const change of [{schemaVersion: 2}, {version: 0}, {version: 1.5}, {name: 'x'.repeat(121)}, {history: null}, {parameters: {...DEFAULTS, rpm: null}}]) {
    assert.throws(() => loadProject(JSON.stringify({...p, ...change})));
  }
  assert.throws(() => loadProject('not json'));
});

test('local restore recomputes evidence and rejects progress with missing prerequisites', () => {
  const p = newProject();
  p.evidence = {...calculate(DEFAULTS, 1), checks: [{id: 'fake', status: 'PASS'}]};
  p.completed = ['base', 'motor-step', 'unrecognized'];
  const restored = restoreLocal(JSON.stringify(p));
  assert.deepEqual(restored.completed, []);
  assert.equal(restored.evidence.checks.length, 8);
  assert.equal(byId(restored.evidence, 'safety').status, 'UNKNOWN');
  const stale = restoreLocal(JSON.stringify({...p, evidence: {...p.evidence, version: 99}}));
  assert.equal(stale.evidence, null);
});

test('revision history is bounded to thirty', () => {
  let p = newProject();
  for (let i = 0; i < 40; i++) p = applyChanges(p, {width: 280 + (i % 2)}, 'Iteration');
  assert.equal(p.history.length, 30);
  assert.equal(p.history.at(-1).version, p.version);
});

test('BOM CSV contains canonical parts and explicitly marks concept status', () => {
  const lines = csvBOM().split('\r\n');
  assert.equal(lines.length, PARTS.length + 1);
  assert.equal(lines[0], 'Part ID,Part,Quantity,Material,Method,Status');
  for (const [i, p] of PARTS.entries()) {
    assert.ok(lines[i + 1].startsWith(`"${p.id}",`));
    assert.ok(lines[i + 1].endsWith('"CONCEPT - NOT RELEASED"'));
  }
});

test('DXF is paired group-code text with millimetres, four edges, four holes and concept warning', () => {
  const dxf = mountDXF({...DEFAULTS, thickness: 6});
  const lines = dxf.split('\n');
  assert.equal(lines.length % 2, 0);
  assert.equal(lines.at(-1), 'EOF');
  assert.ok(dxf.includes('9\n$INSUNITS\n70\n4'));
  assert.equal(lines.filter(s => s === 'LINE').length, 4);
  assert.equal(lines.filter(s => s === 'CIRCLE').length, 4);
  assert.ok(dxf.includes('CONCEPT ONLY - thickness 6 mm - confirm motor hole pattern'));
  assert.equal(/NaN|undefined/.test(dxf), false);
});
