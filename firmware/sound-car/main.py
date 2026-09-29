"""MicroPython RP2040 / ESP32 adapter: hardware UNTESTED; see README before copying.

No networking, model calls, remote control or automatic movement on boot.
Default commissioning lock disables all motor output. Stop means COAST,
not instantaneous physical braking. A separate motor power disconnect is needed.
"""
from machine import Pin, ADC, PWM, WDT
from time import ticks_ms, ticks_diff, sleep_ms, sleep_us
from controller import ArmLatch, decision, rms_dbfs, finite_number, validate_profile, sound_decision
import config


def main():
    # Disable SLP before creating PWM; inputs are also driven low immediately.
    sleep_pin = Pin(config.SLEEP_GP, Pin.OUT, value=0)
    input_pins = [Pin(gp, Pin.OUT, value=0) for gp in (
        config.LEFT_IN1_GP, config.LEFT_IN2_GP, config.RIGHT_IN1_GP, config.RIGHT_IN2_GP)]
    outputs = []

    def stop_outputs():
        sleep_pin.value(0)
        for output in outputs:
            output.duty_u16(0)
        for pin in input_pins:
            # PWM mux may own these pins; duty zero above is the active stop.
            pin.value(0)

    try:
        if config.MOTOR_OUTPUT_ENABLED is not True and config.MOTOR_OUTPUT_ENABLED is not False:
            raise ValueError('MOTOR_OUTPUT_ENABLED must be boolean')
        if not finite_number(config.THRESHOLD_DBFS) or not -60 <= config.THRESHOLD_DBFS <= -5:
            raise ValueError('Invalid relative threshold')
        run_cap_ms = validate_profile(config.BEHAVIOR_PROFILE,
            config.CONTINUOUS_PROFILE_REVIEWED, config.PWM_DUTY, config.MAX_CONTINUOUS_MS)
        if config.LEFT_POLARITY not in (-1, 1) or config.RIGHT_POLARITY not in (-1, 1):
            raise ValueError('Motor polarities must be +1 or -1')
        if not isinstance(config.SAMPLE_COUNT, int) or not 16 <= config.SAMPLE_COUNT <= 256:
            raise ValueError('Sample count outside adapter limit')
        if not isinstance(config.SAMPLE_INTERVAL_US, int) or not 100 <= config.SAMPLE_INTERVAL_US <= 500:
            raise ValueError('Sample interval outside adapter limit')
        for pin in input_pins:
            pwm = PWM(pin)
            pwm.freq(config.PWM_HZ)
            pwm.duty_u16(0)
            outputs.append(pwm)
        arm_pin = Pin(config.ARM_GP, Pin.IN, Pin.PULL_UP)
        stop_pin = Pin(config.STOP_GP, Pin.IN, Pin.PULL_UP)
        fault_pin = Pin(config.FAULT_GP, Pin.IN, Pin.PULL_UP)
        adc = ADC(Pin(config.MIC_GP))
        if getattr(config, "BOARD_PROFILE", "rp2040") == "esp32":
            adc.atten(ADC.ATTN_11DB)
        latch = ArmLatch()
        wdt = WDT(timeout=config.WDT_TIMEOUT_MS)
        samples = [0] * config.SAMPLE_COUNT
        run_started = None
        last_print = ticks_ms()
        duty = int(config.PWM_DUTY * 65535)
        print('M4KE: boot DISARMED; relative dBFS only; output enabled:', config.MOTOR_OUTPUT_ENABLED)
        print('profile=', config.BEHAVIOR_PROFILE, 'run_cap_ms=', run_cap_ms)
        while True:
            started = ticks_ms()
            interrupted = False
            for index in range(config.SAMPLE_COUNT):
                # Poll physical controls within the observation window.
                if stop_pin.value() or not fault_pin.value():
                    stop_outputs()
                    latch.disarm()
                    interrupted = True
                    break
                samples[index] = adc.read_u16()
                sleep_us(config.SAMPLE_INTERVAL_US)
            now = ticks_ms()
            level = None if interrupted else rms_dbfs(samples)
            age = ticks_diff(now, started)  # includes entire collection latency
            invalid = level is None or age < 0 or age > 250
            stop_active = bool(stop_pin.value())
            fault_active = not bool(fault_pin.value())
            armed = latch.update(not bool(arm_pin.value()), stop_active, fault_active or invalid)
            moving, reason = sound_decision(level, config.THRESHOLD_DBFS, getattr(config, 'TARGET_DB_SPL', None),
                getattr(config, 'SPL_CALIBRATION_OFFSET_DB', None), getattr(config, 'SPL_CALIBRATION_REVIEWED', False),
                armed, stop_active or fault_active, age)
            if not config.MOTOR_OUTPUT_ENABLED:
                moving, reason = False, 'commissioning lock: motor output disabled'
            if moving:
                if run_started is None:
                    run_started = now
                if run_cap_ms and ticks_diff(now, run_started) >= run_cap_ms:
                    latch.disarm()
                    moving, reason = False, 'bench run cap: release then press ARM to rearm'
            else:
                run_started = None
            if moving:
                # Set direction/duty while sleeping, then enable carrier.
                sleep_pin.value(0)
                for output in outputs:
                    output.duty_u16(0)
                outputs[0 if config.LEFT_POLARITY == 1 else 1].duty_u16(duty)
                outputs[2 if config.RIGHT_POLARITY == 1 else 3].duty_u16(duty)
                sleep_pin.value(1)
            else:
                stop_outputs()
            # Feed only after sampling, checking and applying outputs succeeded.
            wdt.feed()
            if ticks_diff(now, last_print) >= 500:
                print('level_dbfs=', level, 'armed=', latch.armed, 'drive=', moving, 'reason=', reason)
                last_print = now
            sleep_ms(5)
    except BaseException as error:
        # Ctrl-C and runtime exceptions disable drive. WDT, if running, will reset
        # into disarmed state; do not feed it from this error path.
        stop_outputs()
        print('M4KE STOPPED:', repr(error))
        raise
    finally:
        stop_outputs()
        for output in outputs:
            output.deinit()


if __name__ == '__main__':
    main()
