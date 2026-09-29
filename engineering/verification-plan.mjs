// Requirement-to-evidence routing only. A plan is not a result and cannot promote PASS.
export function getKitVerificationPlan(kitId, spec) {
  if (kitId !== 'sound-car-v1') return null;
  const mappings = {
    R1: {
      claimIds: ['schema', 'cad-solids', 'kernel-assembly:step'],
      acceptance: ['Measure assembled length and record the actual wheel/caster contact plane.'],
    },
    R2: {
      claimIds: ['motion-operating-point', 'traction-margin', 'motor-operating-current', 'speed-and-dynamics'],
      acceptance: ['Weigh the complete car and measure driven-axle load.', 'Measure loaded speed on the declared level floor using a marked distance and elapsed time; compare with the preserved target.', 'Record startup/running current, voltage sag and motor temperature; do not use a theoretical stall rating as continuous capability.'],
    },
    R3: {
      claimIds: ['sound-controller'],
      acceptance: ['With wheels raised, test below/equal/above threshold, disarm, stale sample and sensor fault.', 'On a clear floor, remove the external sound and measure drive-disable latency and coast distance; motor self-noise must not sustain motion.'],
    },
    R4: {
      claimIds: (spec?.parts || []).filter(p => p.shape?.type === 'catalog').map(p => `kernel-${p.id}:brep`),
      acceptance: ['Match every delivered component SKU/revision to its hash-bound cached source and inspect critical shaft, hole and connector interfaces.', 'Do not treat the MAX4466 outline as a populated source STEP or claim unsourced battery geometry.'],
    },
    R5: {
      claimIds: ['cad-solids', 'kernel-assembly:overlaps', 'assembly-fit', 'manufacturing', ...(spec?.parts || []).filter(p => p.kind === 'printed').flatMap(p => [`kernel-${p.id}:step`, `kernel-${p.id}:mesh`])],
      acceptance: ['Select actual printer, nozzle, filament and process; inspect every sliced printed part.', 'Measure hole/edge-channel coupons and source-matched mounting stacks; confirm nut/washer/tool/USB/header access.', 'Inspect the complete physical assembly for shaft rotation, caster clearance, secure retention and non-wheel ground clearance.', 'Structural strength remains unknown until process-specific material allowables and actual load paths are established; a solid mesh is not a structural test.'],
    },
    R6: {
      claimIds: ['electrical-nominal', 'maximum-supply-voltage', 'sound-controller', 'physical'],
      acceptance: ['Select and document the exact battery, holder/restraint, maximum charged voltage, protection, independent power disconnect, wire gauges, connectors and final fasteners.', 'Review source-compatible wiring and maximum ADC voltage before energizing.', 'Test boot-disarmed, fault/disarm, independent power cutoff, quiet stop and self-noise with a reachable cutoff, initially wheels raised.'],
    },
  };
  return {
    kitId,
    status: 'UNKNOWN',
    scope: 'Host-claim routing and physical acceptance plan; no approval or evidence promotion.',
    requirements: (spec?.requirements || []).map(requirement => ({
      requirementId: requirement.id,
      text: requirement.text,
      status: 'UNKNOWN',
      hostClaimIds: mappings[requirement.id]?.claimIds || [],
      physicalAcceptance: (mappings[requirement.id]?.acceptance || ['Define acceptance evidence for this preserved requirement.']).map((action, index) => ({id: `${requirement.id}-physical-${index + 1}`, action, status: 'UNKNOWN'})),
    })),
  };
}
