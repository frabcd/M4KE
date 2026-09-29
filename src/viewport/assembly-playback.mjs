/** Display-only assembly staging. No geometry, evidence or design mutation. */
export function assemblyFrame(steps, parts, stepId, progress = 1) {
  const byId = new Map(steps.map(step => [step.id, step]));
  const partIds = new Set(parts.map(part => part.id));
  const current = byId.get(stepId);
  if (!current || byId.size !== steps.length) throw new Error('Assembly step missing or duplicated.');
  const visiting = new Set(), visited = new Set(), settled = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error('Assembly dependencies contain a cycle.');
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) throw new Error('Assembly prerequisite missing: ' + id);
    visiting.add(id);
    for (const dependency of step.requires) visit(dependency);
    for (const partId of step.partIds) {
      if (!partIds.has(partId)) throw new Error('Assembly part missing: ' + partId);
      if (id !== stepId) settled.add(partId);
    }
    visiting.delete(id); visited.add(id);
  }
  visit(stepId);
  return {stepId, settledIds: [...settled], activeIds: [...new Set(current.partIds)],
    movingIds: [...new Set(current.partIds)].filter(id => !settled.has(id)),
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1};
}

export function assemblyOffset(progress, distance) {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  return (1 - t * t * (3 - 2 * t)) * distance;
}
