import pytest
import numpy as np
from app.tools.pitch_detection import detect_pitch, frequency_to_note

def test_frequency_to_note():
    # Middle C (C4) = 261.63 Hz
    note = frequency_to_note(261.63)
    assert note == "C4"

    # A4 = 440 Hz
    note = frequency_to_note(440.0)
    assert note == "A4"

def test_detect_pitch_silence():
    # All zeros = silence
    samples = np.zeros(4096)
    pitch, confidence = detect_pitch(samples, sample_rate=44100)

    assert pitch == 0.0
    assert confidence < 0.5

def test_detect_pitch_sine_wave():
    # Generate pure 440 Hz sine wave (A4)
    sample_rate = 44100
    duration = 0.1  # 100ms
    frequency = 440.0

    t = np.linspace(0, duration, int(sample_rate * duration))
    samples = np.sin(2 * np.pi * frequency * t)

    pitch, confidence = detect_pitch(samples, sample_rate)

    # Should detect around 440 Hz
    assert 430 < pitch < 450
    assert confidence > 0.8
