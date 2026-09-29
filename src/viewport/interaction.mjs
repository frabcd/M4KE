/** Pure interaction rules shared by the Three.js controller and regression tests. */

/** @param {string[]} ids @param {string|null} activeId @param {string|null} hitId @param {boolean} extend */
export function pickPart(ids, activeId, hitId, extend = false) {
  if (!extend) return {ids: hitId ? [hitId] : [], activeId: hitId};
  const next = [...new Set(ids)];
  if (!hitId) return {ids: next, activeId};
  const index = next.indexOf(hitId);
  if (index < 0) return {ids: [...next, hitId], activeId: hitId};
  next.splice(index, 1);
  return {ids: next, activeId: activeId === hitId ? next.at(-1) || null : activeId};
}

/** @param {string[]} allIds @param {string[]} hiddenIds @param {string[]} selectedIds @param {'selected'|'others'|'all'} mode */
export function changeVisibility(allIds, hiddenIds, selectedIds, mode) {
  if (mode === 'all') return [];
  const selected = new Set(selectedIds.filter(id => allIds.includes(id)));
  const hidden = new Set(hiddenIds.filter(id => allIds.includes(id)));
  if (!selected.size) return [...hidden];
  for (const id of allIds) if (mode === 'selected' ? selected.has(id) : !selected.has(id)) hidden.add(id);
  return allIds.filter(id => hidden.has(id));
}

const isPoint = value => Array.isArray(value) && value.length === 3
  && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000);

/** Only recorded terminal-to-terminal polylines may be drawn. @param {import('./types').ElectricalConnection} connection */
export function hasWireRoute(connection) {
  const p = connection.polylineMm;
  return connection.routingStatus === 'MODEL_ASSUMED' && isPoint(connection.fromAnchorMm)
    && isPoint(connection.toAnchorMm) && Array.isArray(p) && p.length >= 2 && p.length <= 64
    && p.every(isPoint) && p[0].every((n, i) => Math.abs(n - connection.fromAnchorMm[i]) < 1e-6)
    && p[p.length - 1].every((n, i) => Math.abs(n - connection.toAnchorMm[i]) < 1e-6);
}

/** @param {import('./types').ElectricalConnection} connection @param {Set<string>} hidden @param {Set<string>} loaded */
export function wireIsVisible(connection, hidden, loaded) {
  return hasWireRoute(connection) && !hidden.has(connection.from.partId) && !hidden.has(connection.to.partId)
    && loaded.has(connection.from.partId) && loaded.has(connection.to.partId);
}

/** Keep display-only state out of geometry invalidation, including parent poll object identity. @param {import('./types').ViewportModel} model */
export function geometryKey(model) {
  return JSON.stringify({
    parts: model.parts.map(p => ({id: p.id, kind: p.kind, color: p.color, shape: p.shape, position: p.position, rotation: p.rotation})),
    native: model.cadParts !== undefined,
    artifacts: model.cadParts?.map(p => ({id: p.id, stlUrl: p.stlUrl, sha256: p.sha256?.stl, bounds: p.bounds})),
    catalog: model.cadParts ? undefined : model.parts.filter(p => p.shape.type === 'catalog').map(p => ({
      id: p.id, bounds: model.components?.find(c => p.shape.type === 'catalog' && c.id === p.shape.catalogId)?.geometry?.boundsMm,
    })),
    library: model.cadParts ? undefined : model.parts.filter(p => p.shape.type === 'library').map(p => ({
      id: p.id, bounds: model.librarySources?.find(source => p.shape.type === 'library' && source.sourceSha256 === p.shape.sourceSha256)?.sourceBoundsMm,
    })),
  });
}

/** @param {{code:string;ctrlKey?:boolean;metaKey?:boolean;shiftKey?:boolean;altKey?:boolean;isComposing?:boolean;repeat?:boolean}} event */
export function viewportShortcut(event) {
  if (event.isComposing || event.repeat || event.metaKey) return null;
  const opposite = event.ctrlKey;
  if (['Numpad1', 'Numpad3', 'Numpad7'].includes(event.code) && !event.altKey && !event.shiftKey) {
    const directions = {Numpad1: ['front', 'back'], Numpad3: ['right', 'left'], Numpad7: ['top', 'bottom']};
    return {action: 'view', direction: directions[event.code][opposite ? 1 : 0]};
  }
  if (event.ctrlKey) return null;
  if (event.code === 'KeyH') return {action: event.altKey ? 'show-all' : event.shiftKey ? 'hide-others' : 'hide-selected'};
  if (event.altKey || event.shiftKey) return null;
  if (event.code === 'Numpad5') return {action: 'projection'};
  if (event.code === 'NumpadDecimal') return {action: 'frame-selected'};
  if (event.code === 'Home') return {action: 'fit'};
  return null;
}

/** @param {unknown} value */
export function isPreviewShape(value) {
  if (!value || typeof value !== 'object') return false;
  const s = /** @type {import('./types').ToyShape} */ (value);
  const basic = p => p.type === 'box' ? isPoint(p.size) && p.size.every(n => n > 0)
    : p.type === 'cylinder' && Number.isFinite(p.radius) && p.radius > 0 && Number.isFinite(p.height) && p.height > 0;
  return s.type === 'library' ? typeof s.sourceSha256 === 'string' && /^[a-f0-9]{64}$/.test(s.sourceSha256)
    : s.type === 'catalog' ? typeof s.catalogId === 'string'
    : s.type === 'union' ? Array.isArray(s.solids) && s.solids.length >= 2 && s.solids.length <= 8
      && s.solids.every(p => p && basic(p) && isPoint(p.position) && isPoint(p.rotation)) : basic(s);
}
