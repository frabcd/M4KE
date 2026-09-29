export const CAR_RANGES = { length: [140, 260], width: [100, 180], wheelDiameter: [35, 70], threshold: [-60, -5] };
export const DEFAULT_CAR = { length: 180, width: 120, wheelDiameter: 50, threshold: -25 };
export function validateCar(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Car parameters must be an object.');
  const result = {};
  for (const [key, [min, max]] of Object.entries(CAR_RANGES)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`Invalid ${key}: expected ${min} to ${max}.`);
    result[key] = value[key];
  }
  return result;
}
// Preview controller only. No physical motor output or calibrated SPL claim.
export function controllerDecision({ level, threshold, armed, emergencyStop, ageMs }) {
  if (!armed) return { moving: false, reason: 'disarmed' };
  if (emergencyStop) return { moving: false, reason: 'emergency stop' };
  if (!Number.isFinite(level) || level < -120 || level > 0 || !Number.isFinite(threshold) || threshold < -60 || threshold > -5 || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 250) return { moving: false, reason: 'missing / invalid / stale input' };
  return { moving: level > threshold, reason: level > threshold ? 'above threshold' : 'at or below threshold' };
}
export function carChecks(parameters) {
  const p = validateCar(parameters);
  const decision = (overrides) => controllerDecision({level: p.threshold - 1, threshold: p.threshold, armed: true, emergencyStop: false, ageMs: 0, ...overrides});
  return [
    ['Below threshold stops', !decision({}).moving],
    ['Above threshold moves', decision({level: p.threshold + 1}).moving],
    ['Exactly at threshold stops', !decision({level: p.threshold}).moving],
    ['Emergency stop wins', !decision({level: 0, emergencyStop: true}).moving],
    ['Missing microphone stops', !decision({level: NaN}).moving],
    ['Stale input stops', !decision({level: 0, ageMs: 251}).moving],
    ['Disarmed never moves', !decision({level: 0, armed: false}).moving],
    ['Wheel separation (concept)', p.length * 0.64 > p.wheelDiameter],
  ].map(([name, pass]) => ({name: String(name), status: pass ? 'PASS' : 'FAIL', scope: 'software / nominal geometry only'}));
}
export function carPackage(parameters, revision, origin) {
  const p = validateCar(parameters);
  return {schema: 'm4ke-sound-car-v1', revision, createdAt: new Date().toISOString(), parameters: p, origin,
    assumptions: ['Continuous forward motion while level exceeds threshold; stop otherwise. User confirmation pending.', 'Relative microphone dBFS, NOT calibrated dB SPL.', 'Dimensions are concept envelopes, NOT measured component interfaces.'],
    requirements: ['Generate a car concept', 'Respond to a sound threshold, not speech', 'Stop on missing input and explicit stop'],
    controller: {rule: 'armed && !emergencyStop && validFreshInput && level > threshold', inputTimeoutMs: 250, hardwareConnected: false},
    parts: [{name:'Chassis concept',quantity:1},{name:'Wheel envelope',quantity:4},{name:'Motor envelope',quantity:2},{name:'Controller envelope',quantity:1},{name:'Microphone envelope',quantity:1},{name:'Battery envelope',quantity:1}],
    assembly: ['Select actual low-voltage motors, controller, microphone, driver and protected battery; record datasheets.', 'Replace envelopes with measured interfaces; add mounts, shaft bores and fasteners in a real CAD backend.', 'Check tolerances and manufacture the chassis; inspect before assembly.', 'Assemble unpowered. Verify wiring, ratings and motor-driver shutdown independently.', 'Test raised wheels, then a bounded floor test; record sound, motion and stop in the same video.'],
    checks: carChecks(p), physicalValidation: 'UNKNOWN — no hardware', manufacturingReadiness: 'BLOCKED — component interfaces, wiring and tolerances not selected'};
}
export const CAR_PROMPT = 'You are M4KE, an offline DGX Spark competition design assistant. Apply a Dyson-inspired method: identify the main failure, propose a small test, show limitations. Do not impersonate James Dyson. Create a sound-threshold car concept, NOT speech recognition. Return JSON {"message":"short rationale and one falsifiable test", "parameters":{"length":180,"width":120,"wheelDiameter":50,"threshold":-25}}. Bounds in mm: length 140..260, width 100..180, wheelDiameter 35..70. threshold -60..-5 relative dBFS, not calibrated dB SPL. Baseline behavior is continuous forward while above threshold, stop below; label this unconfirmed assumption. No hardware exists. Never claim physical proof, build-ready CAD, safety or manufactured parts. User requests outside this template should be explained as unsupported; do not invent execution. No code execution.';
