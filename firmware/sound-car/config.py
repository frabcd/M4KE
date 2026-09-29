"""Untested hardware reference. Operator reviews these settings before upload."""
# This is an explicit commissioning lock, not an automatic start condition.
MOTOR_OUTPUT_ENABLED = False
BEHAVIOR_PROFILE = 'commissioning'  # Or explicitly reviewed 'continuous_while_loud'.
CONTINUOUS_PROFILE_REVIEWED = False  # Operator acknowledgement, NOT a physical PASS.
THRESHOLD_DBFS = -25.0  # Adjustable relative ADC loudness; NOT calibrated dB SPL.
PWM_DUTY = 0.20        # Bench trial value, NOT a validated speed or safe limit.
PWM_HZ = 1000
MAX_CONTINUOUS_MS = 2000  # Commissioning only; set exactly 0 for continuous profile.
SAMPLE_COUNT = 128
SAMPLE_INTERVAL_US = 250  # Approximate only: Python/ADC overhead adds jitter.
WDT_TIMEOUT_MS = 500

# Original non-wireless Raspberry Pi Pico / Pico H, BCM-style GP numbers.
MIC_GP = 26             # ADC0; only 0..3.3V.
LEFT_IN1_GP = 2         # Pololu #2130 AIN1
LEFT_IN2_GP = 3         # AIN2
RIGHT_IN1_GP = 4        # BIN1
RIGHT_IN2_GP = 5        # BIN2
SLEEP_GP = 6            # Carrier SLP = chip nSLEEP
FAULT_GP = 7            # Carrier FLT = chip nFAULT, input with pull-up.
ARM_GP = 14             # Normally-open momentary button to GND.
STOP_GP = 15            # Normally-closed stop-loop to GND; open = stop.
LEFT_POLARITY = 1       # +1 or -1; verify with wheels raised, power off to rewire.
RIGHT_POLARITY = 1      # Mount orientation may require -1. No direction proof yet.
