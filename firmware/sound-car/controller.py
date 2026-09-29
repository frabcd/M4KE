"""Portable reference logic. No hardware imports. Relative dBFS, never dB SPL."""
import math


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and value == value and -float('inf') < value < float('inf')


def validate_profile(profile, reviewed, duty, run_cap_ms):
    """Return the allowed cap; 0 means no artificial while-loud time limit.

    A review flag is an explicit configuration choice, never evidence of hardware
    safety. Both profiles still require the output lock, ARM and all stop checks.
    """
    if not isinstance(reviewed, bool):
        raise ValueError('CONTINUOUS_PROFILE_REVIEWED must be boolean')
    if not finite_number(duty) or not 0 < duty <= 1:
        raise ValueError('PWM duty must be >0 and <=1')
    if not isinstance(run_cap_ms, int) or isinstance(run_cap_ms, bool):
        raise ValueError('Run cap must be an integer')
    if profile == 'commissioning':
        if duty > 0.5 or not 100 <= run_cap_ms <= 10000:
            raise ValueError('Commissioning requires duty <=0.5 and cap 100..10000 ms')
    elif profile == 'continuous_while_loud':
        if reviewed is not True or run_cap_ms != 0:
            raise ValueError('Continuous profile requires explicit review and cap exactly 0')
    else:
        raise ValueError('Unknown behavior profile')
    return run_cap_ms


def rms_dbfs(samples):
    """AC RMS / ADC half-range, with conservative rails/DC rejection.

    None means an invalid observation, not a diagnosed disconnected microphone.
    Constant midscale silence is -120 dBFS. No SPL/frequency calibration exists.
    """
    if not isinstance(samples, (list, tuple)) or not 16 <= len(samples) <= 1024:
        return None
    if any(not finite_number(x) or x < 0 or x > 65535 for x in samples):
        return None
    if min(samples) <= 0 or max(samples) >= 65535:
        return None
    mean = sum(samples) / len(samples)
    if not 6553.5 < mean < 58981.5:
        return None
    rms = math.sqrt(sum((x - mean) ** 2 for x in samples) / len(samples))
    if rms <= 0:
        return -120.0
    return max(-120.0, min(0.0, 20.0 * math.log10(rms / 32767.5)))


def decision(level, threshold, armed, stop, age_ms):
    """Fresh loud input requests drive; equality and every invalid case stop."""
    if armed is not True:
        return False, 'disarmed'
    if stop is not False:
        return False, 'stop'
    if not finite_number(level) or not -120 <= level <= 0:
        return False, 'invalid level'
    if not finite_number(threshold) or not -60 <= threshold <= -5:
        return False, 'invalid threshold'
    if not finite_number(age_ms) or not 0 <= age_ms <= 250:
        return False, 'stale or invalid sample age'
    return (True, 'above threshold') if level > threshold else (False, 'at or below threshold')


class ArmLatch:
    """Release then press ARM after boot and every stop/fault. Never auto-rearm."""
    def __init__(self):
        self.armed = False
        self._released = False
        self._last_pressed = False

    def disarm(self):
        self.armed = False
        self._released = False
        self._last_pressed = False

    def update(self, arm_pressed, stop_active=False, fault=False):
        if stop_active or fault:
            self.disarm()
            return False
        if not arm_pressed:
            self._released = True
        elif self._released and not self._last_pressed:
            self.armed = True
        self._last_pressed = bool(arm_pressed)
        return self.armed


def sound_decision(level_dbfs, relative_threshold, target_db_spl, offset_db, calibration_reviewed, armed, stop, age_ms):
    """Preserve SPL targets; an unset calibration can never command motion.

    Offset is an operator-measured commissioning input, not certification or
    frequency weighting. Existing relative mode is unchanged for old projects.
    """
    if target_db_spl is None:
        return decision(level_dbfs, relative_threshold, armed, stop, age_ms)
    if calibration_reviewed is not True or not finite_number(offset_db):
        return False, 'SPL calibration required'
    if not finite_number(target_db_spl) or not 20 <= target_db_spl <= 140:
        return False, 'invalid SPL target'
    return decision(level_dbfs, target_db_spl - offset_db, armed, stop, age_ms)
