// Deterministic, unit-explicit screening, not physical validation or a dynamics simulator.
// All source/basis strings are disclosed inputs; they are never treated as verified evidence.
const G = 9.80665;
export function engineeringChecks(inputs = {}) {
  const output=[];
  const v=(key)=>inputs[key]?.value;
  const complete=(keys)=>keys.every(key=>Number.isFinite(v(key)));
  const provenance=(keys)=>Object.fromEntries(keys.map(key=>[key,inputs[key]??{basis:'MISSING'}]));
  const add=(id,label,status,method,observed,required,details)=>output.push({id,label,status,critical:true,method,observed,required,details});
  const motionKeys=['massKg','rollingResistance','wheelRadiusMm','driveMotors','motorVoltage','batteryVoltage','motorNoLoadRpm','motorStallTorqueNm','targetSpeedMS','accelerationMS2','gradeDeg','tractionCoefficient','drivenWeightFraction','transmissionEfficiency','motorContinuousTorqueFraction'];
  const motorizedTarget=inputs.targetSpeedMS&&['driveMotors','motorVoltage','motorTorqueNm','motorStallA'].some(key=>inputs[key]);
  if(motorizedTarget||['motorNoLoadRpm','motorStallTorqueNm','accelerationMS2','gradeDeg','tractionCoefficient'].some(key=>inputs[key])) {
    if(!complete(motionKeys)) {
      const missing=motionKeys.filter(key=>!Number.isFinite(v(key)));
      add('motion-operating-point','Loaded speed, torque and traction screening','UNKNOWN','Input completeness',missing,'All motion operating-point inputs','Supply the listed inputs with explicit provenance or retain UNKNOWN. No stall-torque-only or no-load-RPM-only motion claim; omitted inputs do not disable this check.');
      add('traction-margin','Conditional traction margin','UNKNOWN','Incomplete coupled motion screening',missing,'Complete force, grade, acceleration, grip and driven-load inputs before this coupled screening','Missing motion inputs are not zeroes or defaults. No traction margin was calculated; missing manufacturer data must not be invented.');
    }
    else {
      const r=v('wheelRadiusMm')/1000,theta=v('gradeDeg')*Math.PI/180,ratio=v('batteryVoltage')/v('motorVoltage');
      const noLoadRpm=v('motorNoLoadRpm')*ratio,stallTorqueNm=v('motorStallTorqueNm')*ratio;
      const rollingForceN=v('massKg')*G*v('rollingResistance')*Math.cos(theta),gradeForceN=v('massKg')*G*Math.sin(theta),accelerationForceN=v('massKg')*v('accelerationMS2');
      const requiredForceN=rollingForceN+gradeForceN+accelerationForceN;
      const requiredTorqueNm=requiredForceN*r/(v('driveMotors')*v('transmissionEfficiency'));
      const torqueFraction=requiredTorqueNm/stallTorqueNm,loadedRpm=noLoadRpm*Math.max(0,1-torqueFraction);
      const requiredRpm=v('targetSpeedMS')*60/(2*Math.PI*r),predictedSpeedMS=loadedRpm*2*Math.PI*r/60;
      const continuousTorqueLimitNm=stallTorqueNm*v('motorContinuousTorqueFraction');
      const tractionLimitN=v('tractionCoefficient')*v('massKg')*G*Math.cos(theta)*v('drivenWeightFraction');
      const voltageWithinRating=ratio<=1,torqueOK=requiredTorqueNm<=continuousTorqueLimitNm,speedOK=predictedSpeedMS>=v('targetSpeedMS'),tractionOK=requiredForceN<=tractionLimitN;
      const assumptions=JSON.stringify(provenance(motionKeys));
      add('motion-operating-point','Conditional loaded speed / usable torque','PASS','Linear brushed-DC output-shaft torque-speed model; rpm(V)=rpm_rated*V/V_rated; rpm_load=rpm(V)*(1-tau/tau_stall(V))',{rollingForceN,gradeForceN,accelerationForceN,requiredForceN,requiredTorqueNm,continuousTorqueLimitNm,torqueFraction,noLoadRpm,loadedRpm,requiredRpm,predictedSpeedMS,targetSpeedMS:v('targetSpeedMS'),speedMarginMS:predictedSpeedMS-v('targetSpeedMS'),voltageWithinRating,torqueOK,speedOK},'Voltage <= rated, calculated usable torque margin >=0 and predicted loaded speed >= target',`Conditional screening only. Linear voltage/torque scaling neglects deadband, voltage sag, gearbox friction, PWM losses and motor variability. Rated torque must be gearbox-output torque; transmissionEfficiency is ONLY additional downstream loss. Continuous fraction is an explicit input, not a measured rating. ${assumptions}`);
      output.at(-1).status=voltageWithinRating&&torqueOK&&speedOK?'PASS':'FAIL';
      add('traction-margin','Conditional traction margin',tractionOK?'PASS':'FAIL','F_grip=mu*m*g*cos(grade)*drivenWeightFraction',{requiredForceN,tractionLimitN,marginN:tractionLimitN-requiredForceN},'Traction limit >= required longitudinal force',`Coefficient and driven axle load are assumed unless independently measured. No weight-transfer, lateral stability or tire-deformation model. ${assumptions}`);
      if(complete(['motorNoLoadA','motorStallA'])) {
        const noLoadA=v('motorNoLoadA')*ratio,stallA=v('motorStallA')*ratio;
        const perMotorA=noLoadA+(stallA-noLoadA)*Math.min(1,Math.max(0,torqueFraction));
        const totalMotorA=perMotorA*v('driveMotors');
        add('motor-operating-current','Conditional operating current estimate',v('motorStallA')>=v('motorNoLoadA')?'PASS':'FAIL','Linear current vs torque approximation at operating voltage',{perMotorA,totalMotorA,peakStallA:stallA*v('driveMotors'),mechanicalPowerW:requiredForceN*v('targetSpeedMS'),electricalMotorPowerW:totalMotorA*v('batteryVoltage')},'Finite current estimate with stall current >= no-load current','This validates the arithmetic, not driver thermal capacity or battery sag. Start-up can approach stall current; this is not a fuse-sizing rule.');
        if(complete(['batteryCapacityAh','batteryUsableFraction','logicCurrentA'])) {
          const totalA=totalMotorA+v('logicCurrentA');
          add('runtime-estimate','Conditional continuous runtime estimate',totalA>0?'PASS':'UNKNOWN','minutes=60*capacity_Ah*usable_fraction/(motor_current+logic_current)',{totalA,minutes:totalA>0?60*v('batteryCapacityAh')*v('batteryUsableFraction')/totalA:null},'Positive assumed total current; capacity and losses documented','Same voltage domain assumed for this estimate. No discharge curve, cold-temperature loss, regulator efficiency or actual duration test; not a runtime guarantee.');
        }
      }
    }
  }
  const torqueKeys=['motorTorqueNm','motorStallTorqueNm'];
  if(torqueKeys.some(key=>inputs[key])) {
    if(!complete(torqueKeys)) add('usable-torque-basis','Usable torque versus stall torque','UNKNOWN','Input completeness',torqueKeys.filter(key=>!Number.isFinite(v(key))),'Distinct usable output torque and stall torque under matching shaft/voltage conditions','A stall rating alone does not establish usable torque. Nor can a supplied usable value be screened against an absent stall value. Source prose and MANUFACTURER labels are unverified metadata; no usable torque is inferred.');
    else {
      const usable=v('motorTorqueNm'),stall=v('motorStallTorqueNm'),belowStall=usable<stall;
      add('usable-torque-basis','Usable torque versus stall torque',belowStall?'UNKNOWN':'FAIL','Compare declared usable and stall torque; no source-text classification',{motorTorqueNm:usable,motorStallTorqueNm:stall,usableFractionOfStall:usable/stall,belowStall},'Usable moving output torque must be below stall torque at the same shaft and voltage; a lower number alone is not qualification',`This is a consistency screen on declared numbers, not source authentication or a continuous torque rating. Same shaft and voltage conditions must be reconciled. Below-stall values remain UNKNOWN until usable operating conditions are independently supported; nominal rolling-force arithmetic does not resolve this gate. ${JSON.stringify(provenance(torqueKeys))}`);
    }
  }
  const voltageKeys=['batteryMaxVoltage','driverMinVoltage','driverMaxVoltage','motorVoltage'];
  if(inputs.batteryVoltage||voltageKeys.slice(0,3).some(key=>inputs[key])) {
    if(!complete(voltageKeys)) add('maximum-supply-voltage','Full-charge supply compatibility','UNKNOWN','Input completeness',voltageKeys.filter(key=>!Number.isFinite(v(key))),'Maximum charged voltage and exact motor/driver limits','Nominal pack voltage alone is insufficient.');
    else {
      const max=v('batteryMaxVoltage'),min=v('driverMinVoltage');
      add('maximum-supply-voltage','Full-charge supply compatibility',max>=min&&max<=v('driverMaxVoltage')&&max<=v('motorVoltage')&&min<=v('driverMaxVoltage')?'PASS':'FAIL','Compare full-charge voltage with motor rating and driver range',{batteryMaxVoltage:max,driverMinVoltage:min,driverMaxVoltage:v('driverMaxVoltage'),motorVoltage:v('motorVoltage')},'Maximum pack voltage is within both selected motor and driver limits',`Source verification and minimum discharged voltage/brownout remain separate. ${JSON.stringify(provenance(voltageKeys))}`);
    }
  }
  const beamKeys=['beamSpanMm','beamWidthMm','beamThicknessMm','structuralLoadN','materialModulusMPa','materialAllowableMPa','structuralSafetyFactor','maxDeflectionMm'];
  if(beamKeys.some(key=>inputs[key])) {
    if(!complete(beamKeys)) add('beam-screening','Conditional chassis beam screening','UNKNOWN','Input completeness',beamKeys.filter(key=>!Number.isFinite(v(key))),'Load, span, section, printed-process material allowables and deflection limit','No structural result can be inferred from CAD mesh validity.');
    else {
      const L=v('beamSpanMm'),b=v('beamWidthMm'),h=v('beamThicknessMm'),F=v('structuralLoadN'),I=b*h**3/12;
      const stressMPa=F*L*h/(8*I),deflectionMm=F*L**3/(48*v('materialModulusMPa')*I),designStressMPa=stressMPa*v('structuralSafetyFactor');
      add('beam-screening','Conditional chassis beam screening',designStressMPa<=v('materialAllowableMPa')&&deflectionMm<=v('maxDeflectionMm')?'PASS':'FAIL','Simply-supported rectangular beam, central point load; I=b*h^3/12; sigma=F*L*h/(8I); delta=F*L^3/(48EI)',{stressMPa,designStressMPa,deflectionMm,secondMomentMm4:I},'Factored bending stress <= process-specific allowable and deflection <= limit',`Screening approximation only; ignores holes, local mounts, print anisotropy, creep, impact, torsion and actual boundary stiffness. No FEA or test. ${JSON.stringify(provenance(beamKeys))}`);
    }
  }
  return output;
}
