import test from 'node:test';
import assert from 'node:assert/strict';
import {changeVisibility, geometryKey, hasWireRoute, isPreviewShape, pickPart, viewportShortcut, wireIsVisible} from '../src/viewport/interaction.mjs';

const part = (id, shape = {type: 'box', size: [40, 25, 8]}) => ({id, name: id, kind: 'printed', color: '#aabbcc', material: 'PLA', shape, position: [0, 0, 0], rotation: [0, 0, 0]});
const wire = () => ({id: 'wire-a', from: {partId: 'a', terminal: 'VCC'}, to: {partId: 'b', terminal: 'VM'}, kind: 'power', color: '#ff0000', routingStatus: 'MODEL_ASSUMED', fromAnchorMm: [1, 2, 3], toAnchorMm: [5, 6, 7], polylineMm: [[1, 2, 3], [1, 6, 3], [5, 6, 7]]});

test('viewport selection replaces, Shift toggles, and removing the active part selects a remaining part', () => {
  const original = ['a', 'b'];
  assert.deepEqual(pickPart(original, 'b', 'c'), {ids: ['c'], activeId: 'c'});
  assert.deepEqual(pickPart(original, 'b', null), {ids: [], activeId: null});
  assert.deepEqual(pickPart(original, 'b', 'c', true), {ids: ['a', 'b', 'c'], activeId: 'c'});
  assert.deepEqual(pickPart(original, 'b', 'b', true), {ids: ['a'], activeId: 'a'});
  assert.deepEqual(pickPart(original, 'b', 'a', true), {ids: ['b'], activeId: 'b'});
  assert.deepEqual(pickPart(['a'], 'a', 'a', true), {ids: [], activeId: null});
  assert.deepEqual(pickPart(original, 'b', null, true), {ids: original, activeId: 'b'});
  assert.deepEqual(original, ['a', 'b']);
});

test('viewport visibility is independent non-mutating state and empty selection never hides everything', () => {
  const all = ['a', 'b', 'shell'], hidden = ['b'];
  assert.deepEqual(changeVisibility(all, hidden, ['shell'], 'selected'), ['b', 'shell']);
  assert.deepEqual(changeVisibility(all, [], ['shell'], 'others'), ['a', 'b']);
  assert.deepEqual(changeVisibility(all, hidden, [], 'others'), ['b']);
  assert.deepEqual(changeVisibility(all, hidden, ['unknown'], 'others'), ['b']);
  assert.deepEqual(changeVisibility(all, hidden, [], 'all'), []);
  assert.deepEqual(hidden, ['b']);
  assert.deepEqual(all, ['a', 'b', 'shell']);
});

test('native geometry key ignores selection, visibility, metadata and asynchronous catalog arrivals', () => {
  const model = {parts: [part('shell'), part('motor', {type: 'catalog', catalogId: 'motor-1'})], cadParts: [{id: 'shell', stlUrl: '/s.stl', sha256: {stl: 'a'.repeat(64)}}, {id: 'motor', stlUrl: '/m.stl', sha256: {stl: 'b'.repeat(64)}}]};
  const copy = structuredClone(model);
  copy.parts[0].name = '改名不重新下载';
  copy.parts[0].explanation = {whyHere: 'New explanation'};
  copy.components = [{id: 'motor-1', geometry: {boundsMm: [10, 20, 30]}}];
  copy.selectedIds = ['shell']; copy.hiddenIds = ['motor']; copy.projection = 'orthographic';
  assert.equal(geometryKey(model), geometryKey(copy));
  assert.equal(geometryKey(model), geometryKey(structuredClone(model)));
  copy.cadParts[0].sha256.stl = 'c'.repeat(64);
  assert.notEqual(geometryKey(model), geometryKey(copy));
});

test('geometry key changes for geometry, placement, native/concept mode and preview bounds', () => {
  const model = {parts: [part('shell'), part('motor', {type: 'catalog', catalogId: 'm'})], components: [{id: 'm', geometry: {boundsMm: [10, 20, 30]}}]};
  for (const mutate of [copy => {copy.parts[0].position[0] = 5;}, copy => {copy.parts[0].shape.size[0] = 50;}, copy => {copy.components[0].geometry.boundsMm[2] = 31;}, copy => {copy.cadParts = [];}]) {
    const changed = structuredClone(model); mutate(changed);
    assert.notEqual(geometryKey(model), geometryKey(changed));
  }
});

test('wires use exact endpoint-aligned finite routes; missing or guessed coordinates are rejected', () => {
  assert.equal(hasWireRoute(wire()), true);
  for (const mutate of [w => {w.routingStatus = 'MISSING_ANCHORS';}, w => {w.polylineMm[0][0] = 99;}, w => {w.polylineMm[2][2] = NaN;}, w => {delete w.fromAnchorMm;}, w => {w.polylineMm = [[1, 2, 3]];}, w => {w.polylineMm[1][0] = 10001;}]) {
    const invalid = wire(); mutate(invalid); assert.equal(hasWireRoute(invalid), false);
  }
  assert.equal(wireIsVisible(wire(), new Set(), new Set(['a', 'b'])), true);
  assert.equal(wireIsVisible(wire(), new Set(['b']), new Set(['a', 'b'])), false);
  assert.equal(wireIsVisible(wire(), new Set(), new Set(['a'])), false);
  assert.equal(wireIsVisible(wire(), new Set(['a']), new Set(['a', 'b'])), false);
});

test('Blender navigation has opposite standard views, projection, framing and exact visibility shortcuts', () => {
  const key = (code, modifiers = {}) => viewportShortcut({code, ...modifiers});
  assert.deepEqual(key('Numpad1'), {action: 'view', direction: 'front'});
  assert.deepEqual(key('Numpad1', {ctrlKey: true}), {action: 'view', direction: 'back'});
  assert.deepEqual(key('Numpad3'), {action: 'view', direction: 'right'});
  assert.deepEqual(key('Numpad3', {ctrlKey: true}), {action: 'view', direction: 'left'});
  assert.deepEqual(key('Numpad7'), {action: 'view', direction: 'top'});
  assert.deepEqual(key('Numpad7', {ctrlKey: true}), {action: 'view', direction: 'bottom'});
  assert.deepEqual(key('Numpad5'), {action: 'projection'});
  assert.deepEqual(key('NumpadDecimal'), {action: 'frame-selected'});
  assert.deepEqual(key('Home'), {action: 'fit'});
  assert.deepEqual(key('KeyH'), {action: 'hide-selected'});
  assert.deepEqual(key('KeyH', {shiftKey: true}), {action: 'hide-others'});
  assert.deepEqual(key('KeyH', {altKey: true}), {action: 'show-all'});
  for (const code of ['KeyG', 'KeyR', 'KeyS', 'Digit1', 'Delete']) assert.equal(key(code), null);
  for (const modifiers of [{ctrlKey: true}, {metaKey: true}, {isComposing: true}, {repeat: true}]) assert.equal(key('KeyH', modifiers), null);
});

test('concept shapes reject unsupported, negative or malformed geometry', () => {
  assert.equal(isPreviewShape({type: 'box', size: [1, 2, 3]}), true);
  assert.equal(isPreviewShape({type: 'cylinder', radius: 3, height: 10}), true);
  assert.equal(isPreviewShape({type: 'catalog', catalogId: 'motor'}), true);
  assert.equal(isPreviewShape({type: 'library', sourceSha256: 'a'.repeat(64)}), true);
  assert.equal(isPreviewShape({type: 'library', sourceSha256: 'a'.repeat(16)}), false);
  const member = {type: 'box', size: [1, 2, 3], position: [0, 0, 0], rotation: [0, 90, 0]};
  assert.equal(isPreviewShape({type: 'union', solids: [member, member]}), true);
  for (const shape of [null, {}, {type: 'sphere'}, {type: 'box', size: [1, -1, 1]}, {type: 'box', size: [1, NaN, 1]}, {type: 'cylinder', radius: 0, height: 3}, {type: 'union', solids: [member]}]) assert.equal(isPreviewShape(shape), false);
});

test('library source preview signature preserves original bounds but native metadata arrival cannot reload meshes', () => {
  const sourceSha256 = 'a'.repeat(64);
  const model = {parts: [part('source', {type: 'library', sourceSha256})], librarySources: [{sourceSha256, sourceBoundsMm: [4, 5, 6, 14, 25, 36]}]};
  const changed = structuredClone(model);
  changed.librarySources[0].sourceBoundsMm[0] = 5;
  assert.notEqual(geometryKey(model), geometryKey(changed));
  model.cadParts = [{id: 'source', stlUrl: '/source.stl', sha256: {stl: sourceSha256}}];
  changed.cadParts = structuredClone(model.cadParts);
  assert.equal(geometryKey(model), geometryKey(changed));
});
