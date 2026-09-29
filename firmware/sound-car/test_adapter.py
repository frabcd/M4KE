"""Mock-only adapter tests. They do not execute MicroPython or physical GPIO."""
import importlib.util
import math
import os
import sys
import time
import types
import unittest
from unittest.mock import patch
import config


class AdapterTests(unittest.TestCase):
    def run_adapter(self, enabled=False, held_arm=False, break_stop=False, adc_fails=False,
                    max_loops=5, continuous=False, quiet_after=None, stop_after=None,
                    fault_after=None, stale_after=None, invalid_profile=False):
        state = {'us': 0, 'readings': 0, 'loops': 0, 'duties': [], 'pwm': [], 'pins': {}, 'feeds': 0, 'drive_by_loop': []}

        class Pin:
            OUT, IN, PULL_UP = 1, 0, 2

            def __init__(self, gp, mode=None, pull=None, value=None):
                self.gp = gp
                state['pins'].setdefault(gp, 0)
                if value is not None:
                    state['pins'][gp] = value

            def value(self, value=None):
                if value is not None:
                    state['pins'][self.gp] = value
                elif self.gp == config.ARM_GP:
                    return 0 if held_arm or state['us'] > 50000 else 1
                elif self.gp == config.STOP_GP:
                    return int(break_stop or (stop_after is not None and state['loops'] >= stop_after))
                elif self.gp == config.FAULT_GP:
                    return 0 if fault_after is not None and state['loops'] >= fault_after else 1
                return state['pins'][self.gp]

        class PWM:
            def __init__(self, pin):
                self.pin, self.duty = pin, 0
                state['pwm'].append(self)

            def freq(self, value):
                self.frequency = value

            def duty_u16(self, value):
                self.duty = value
                state['duties'].append(value)

            def deinit(self):
                self.duty = 0

        class ADC:
            def __init__(self, pin):
                self.pin = pin

            def read_u16(self):
                state['readings'] += 1
                if adc_fails and state['readings'] > 300:
                    raise OSError('mock ADC failure')
                if quiet_after is not None and state['loops'] >= quiet_after:
                    return 32768
                return int(32767 + 6000 * math.sin(2 * math.pi * state['readings'] / 32))

        class WDT:
            def __init__(self, timeout):
                self.timeout = timeout

            def feed(self):
                state['feeds'] += 1

        def sleep_us(value):
            state['us'] += 3000 if stale_after is not None and state['loops'] >= stale_after else value

        def sleep_ms(value):
            state['us'] += value * 1000
            state['loops'] += 1
            state['drive_by_loop'].append(bool(state['pins'][config.SLEEP_GP]))
            if state['loops'] >= max_loops:
                raise KeyboardInterrupt('mock test exit')

        machine = types.SimpleNamespace(Pin=Pin, PWM=PWM, ADC=ADC, WDT=WDT)
        location = os.path.join(os.path.dirname(__file__), 'main.py')
        spec = importlib.util.spec_from_file_location('sound_car_mock_adapter', location)
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'machine': machine}), \
                patch.object(time, 'ticks_ms', lambda: state['us'] // 1000, create=True), \
                patch.object(time, 'ticks_diff', lambda a, b: a - b, create=True), \
                patch.object(time, 'sleep_us', sleep_us, create=True), \
                patch.object(time, 'sleep_ms', sleep_ms, create=True), \
                patch.object(config, 'MOTOR_OUTPUT_ENABLED', enabled), \
                patch.object(config, 'BEHAVIOR_PROFILE', 'invalid' if invalid_profile else 'continuous_while_loud' if continuous else 'commissioning'), \
                patch.object(config, 'CONTINUOUS_PROFILE_REVIEWED', continuous), \
                patch.object(config, 'MAX_CONTINUOUS_MS', 0 if continuous else 2000), patch('builtins.print'):
            spec.loader.exec_module(module)
            with self.assertRaises((KeyboardInterrupt, OSError, ValueError)):
                module.main()
        self.assertEqual(state['pins'][config.SLEEP_GP], 0)
        self.assertTrue(all(output.duty == 0 for output in state['pwm']))
        return state

    def test_commissioning_lock_never_drives_even_after_arm(self):
        self.assertFalse(any(self.run_adapter()['duties']))

    def test_held_arm_on_boot_never_drives(self):
        self.assertFalse(any(self.run_adapter(enabled=True, held_arm=True)['duties']))

    def test_open_stop_loop_never_drives(self):
        self.assertFalse(any(self.run_adapter(enabled=True, break_stop=True)['duties']))

    def test_runtime_exception_disables_an_active_output(self):
        state = self.run_adapter(enabled=True, adc_fails=True)
        self.assertTrue(any(state['duties']))  # reached mock drive before failure
        self.assertGreater(state['feeds'], 0)

    def test_bench_run_cap_latches_stop_with_arm_still_held(self):
        state = self.run_adapter(enabled=True, max_loops=80)
        self.assertTrue(any(state['drive_by_loop']))
        self.assertFalse(any(state['drive_by_loop'][-10:]))

    def test_continuous_profile_keeps_drive_beyond_commissioning_cap(self):
        state = self.run_adapter(enabled=True, continuous=True, max_loops=100)
        self.assertGreater(state['us'], 3000000)
        self.assertTrue(all(state['drive_by_loop'][-10:]))

    def test_continuous_profile_still_needs_enable_and_release_arm(self):
        self.assertFalse(any(self.run_adapter(continuous=True)['duties']))
        self.assertFalse(any(self.run_adapter(enabled=True, held_arm=True, continuous=True)['duties']))

    def test_continuous_profile_quiet_stop_fault_and_stale_stop_after_drive(self):
        for event in ('quiet_after', 'stop_after', 'fault_after', 'stale_after'):
            state = self.run_adapter(enabled=True, continuous=True, max_loops=100, **{event: 80})
            self.assertTrue(all(state['drive_by_loop'][70:80]))
            self.assertFalse(any(state['drive_by_loop'][80:]))

    def test_invalid_profile_never_creates_pwm_or_drives(self):
        state = self.run_adapter(enabled=True, invalid_profile=True)
        self.assertEqual(state['pwm'], [])
        self.assertFalse(any(state['duties']))


if __name__ == '__main__':
    unittest.main()
