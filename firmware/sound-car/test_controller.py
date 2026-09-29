import math
import unittest
from controller import ArmLatch, decision, rms_dbfs, validate_profile, sound_decision


class ControllerTests(unittest.TestCase):
    def test_spl_requires_explicit_calibration_and_retains_exact_threshold(self):
        self.assertFalse(sound_decision(-20, -25, 60, None, False, True, False, 0)[0])
        self.assertFalse(sound_decision(-20, -25, 60, 85, False, True, False, 0)[0])
        self.assertFalse(sound_decision(-25, -25, 60, 85, True, True, False, 0)[0])
        self.assertTrue(sound_decision(-24, -25, 60, 85, True, True, False, 0)[0])
        self.assertFalse(sound_decision(-26, -25, 60, 85, True, True, False, 0)[0])
        self.assertFalse(sound_decision(-24, -25, 60, 85, True, True, True, 0)[0])
        self.assertTrue(sound_decision(-24, -25, None, None, False, True, False, 0)[0])

    def test_profile_contract_is_explicit_and_default_conservative(self):
        self.assertEqual(validate_profile('commissioning', False, .2, 2000), 2000)
        self.assertEqual(validate_profile('continuous_while_loud', True, .2, 0), 0)
        self.assertEqual(validate_profile('continuous_while_loud', True, 1, 0), 0)
        for args in (('continuous_while_loud', False, .2, 0),
                     ('continuous_while_loud', True, .2, 2000),
                     ('commissioning', False, 1, 2000),
                     ('commissioning', False, .2, 0),
                     ('commissioning', False, .2, True),
                     ('continuous_while_loud', 1, .2, 0),
                     ('unknown', True, .2, 0),
                     ('commissioning', False, float('nan'), 2000)):
            with self.assertRaises(ValueError):
                validate_profile(*args)

    def test_threshold_cases(self):
        self.assertEqual(decision(-26, -25, True, False, 0)[0], False)
        self.assertEqual(decision(-24, -25, True, False, 0)[0], True)
        self.assertEqual(decision(-25, -25, True, False, 0)[0], False)

    def test_invalid_stale_stop_and_disarm(self):
        for level in (None, float('nan'), float('inf'), -121, 1, True, 'loud'):
            self.assertFalse(decision(level, -25, True, False, 0)[0])
        for age in (-1, 251, float('nan'), None):
            self.assertFalse(decision(-10, -25, True, False, age)[0])
        self.assertFalse(decision(-10, -25, False, False, 0)[0])
        self.assertFalse(decision(-10, -25, True, True, 0)[0])
        self.assertFalse(decision(-10, 20, True, False, 0)[0])

    def test_held_arm_at_boot_does_not_arm(self):
        latch = ArmLatch()
        self.assertFalse(latch.update(True))
        self.assertFalse(latch.update(True))
        self.assertFalse(latch.update(False))
        self.assertTrue(latch.update(True))

    def test_fault_requires_release_then_press(self):
        for key in ('stop_active', 'fault'):
            latch = ArmLatch()
            latch.update(False)
            self.assertTrue(latch.update(True))
            self.assertFalse(latch.update(True, **{key: True}))
            self.assertFalse(latch.update(True))
            self.assertFalse(latch.update(False))
            self.assertTrue(latch.update(True))

    def test_synthetic_rms_and_silence(self):
        amplitude = 32767.5 * 0.1
        samples = [32767.5 + amplitude * math.sin(2 * math.pi * i / 32) for i in range(128)]
        self.assertAlmostEqual(rms_dbfs(samples), -23.0102999566, places=6)
        self.assertEqual(rms_dbfs([32768] * 128), -120)
        self.assertTrue(decision(rms_dbfs(samples), -25, True, False, 0)[0])
        quieter = [32767.5 + amplitude * 0.01 * math.sin(2 * math.pi * i / 32) for i in range(128)]
        self.assertFalse(decision(rms_dbfs(quieter), -25, True, False, 0)[0])

    def test_invalid_adc_windows_are_not_sound_proof(self):
        for samples in ([], [32768], [0] * 128, [65535] * 128, [2000] * 128, [32768] * 15 + [float('nan')], [32768] * 1025):
            self.assertIsNone(rms_dbfs(samples))


if __name__ == '__main__':
    unittest.main()
