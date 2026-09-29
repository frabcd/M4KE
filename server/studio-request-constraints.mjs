/** User intent guards, not engineering evidence or a replacement designer. */
export function requestConstraints(request) {
  const text = String(request || '');
  const threshold = text.match(/(\d+(?:\.\d+)?)\s*(?:分贝|dB(?:\s*SPL)?(?![A-Za-z]))/i);
  return { esp32: /\besp32\b/i.test(text), targetDbSpl: threshold ? Number(threshold[1]) : null };
}
export function requestConstraintIssues(request, spec) {
  if (!spec?.parts?.length || spec.questions?.length) return [];
  const wanted = requestConstraints(request), issues = [];
  if (wanted.esp32 && !spec.electrical?.components?.some(c => c.partId === spec.electrical?.control?.controllerPartId && c.profileId === 'esp32-devkitc-v4-wroom32e'))
    issues.push('The user explicitly requires ESP32. Use esp32-devkitc-v4-wroom32e and esp32-max4466-drv8833-sound-v1, with IO terminal names, or ask an essential compatibility question. Never silently substitute Raspberry Pi Pico.');
  if (wanted.targetDbSpl !== null && spec.electrical?.control?.targetDbSpl !== wanted.targetDbSpl)
    issues.push(`Preserve the requested ${wanted.targetDbSpl} dB SPL as electrical.control.targetDbSpl. Relative thresholdDbfs is only a commissioning placeholder, not a conversion. Calibration is unresolved and motor outputs remain disabled until measured; never invent an offset or substitute relative loudness.`);
  return issues;
}
export const REQUEST_GUIDANCE = `Preserve explicit controller, currency/budget, shell material and styling requirements before choosing familiar examples. ESP32 is not Pico. Numeric dB/分贝 means a sound-pressure target, not dBFS: preserve control.targetDbSpl, keep calibration UNKNOWN, and never fabricate a calibration offset. Proposed F1-inspired PLA body panels must be actual printed geometry with walls, cavity and mounting access, not merely an F1 title. Budget is a maximum constraint, not a verified quote. Keep wiring terminals, part IDs, buildItems and assembly references consistent; list every referenced part before using it. Choose compatible battery maximum/motor/driver ratings before detailing geometry, not afterward. For full drafts preserve only used anchors and concise explanations so mandatory electrical connections fit the output budget.`;
