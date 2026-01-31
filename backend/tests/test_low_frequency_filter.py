#!/usr/bin/env python3
"""
Test cases for low frequency filtering fix.

Tests that:
1. Notes below C2 (65Hz) are filtered out (sub-bass)
2. Notes C2-C3 (65-130Hz) are filtered for clean detection
3. Normal range notes (C3+) work correctly with high accuracy
4. No false positives from noise

Note: Default min_frequency is now C3 (130Hz) for cleaner detection.
Use min_frequency=65Hz explicitly if bass notes are needed.
"""

import sys
import os
import numpy as np

# Add parent to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from optimized_yin import detect_piano_note

SAMPLE_RATE = 44100

def generate_sine(freq: float, duration_ms: float = 500, amplitude: float = 0.5) -> list:
    """Generate pure sine wave at given frequency."""
    num_samples = int((duration_ms / 1000.0) * SAMPLE_RATE)
    t = np.arange(num_samples) / SAMPLE_RATE
    audio = amplitude * np.sin(2 * np.pi * freq * t)
    return audio.astype(np.float32).tolist()

def generate_piano_tone(freq: float, duration_ms: float = 500, amplitude: float = 0.5) -> list:
    """Generate piano-like tone with harmonics."""
    num_samples = int((duration_ms / 1000.0) * SAMPLE_RATE)
    t = np.arange(num_samples) / SAMPLE_RATE

    # Fundamental + harmonics with decay
    audio = np.zeros(num_samples, dtype=np.float32)
    harmonics = [1.0, 0.5, 0.25, 0.125, 0.0625]  # Decreasing amplitude

    for i, h_amp in enumerate(harmonics):
        h_freq = freq * (i + 1)
        if h_freq < SAMPLE_RATE / 2:  # Below Nyquist
            audio += h_amp * np.sin(2 * np.pi * h_freq * t)

    # Normalize and apply envelope
    audio = audio / np.max(np.abs(audio)) * amplitude
    envelope = np.exp(-3 * t / (duration_ms / 1000.0))
    audio = audio * envelope

    return audio.astype(np.float32).tolist()

# Test frequencies
FREQUENCIES = {
    'A0': 27.5,     # Should be filtered (below 65Hz)
    'C1': 32.7,     # Should be filtered (below 65Hz)
    'E1': 41.2,     # Should be filtered (below 65Hz)
    'A1': 55.0,     # Should be filtered (below 65Hz)
    'C2': 65.4,     # Edge case - should pass if high confidence
    'E2': 82.4,     # Low note - needs high confidence
    'A2': 110.0,    # Low note - needs high confidence
    'C3': 130.8,    # Should pass normally
    'E3': 164.8,    # Should pass normally
    'A3': 220.0,    # Should pass normally
    'C4': 261.6,    # Should pass normally
    'A4': 440.0,    # Should pass normally
    'C5': 523.3,    # Should pass normally
    'C6': 1046.5,   # Should pass normally
}

def test_filter_below_c2():
    """Test that frequencies below C2 (65Hz) are filtered out."""
    print("\n" + "="*60)
    print("TEST: Filter frequencies below C2 (65Hz)")
    print("="*60)

    below_c2 = ['A0', 'C1', 'E1', 'A1']
    passed = 0

    for note_name in below_c2:
        freq = FREQUENCIES[note_name]
        audio = generate_piano_tone(freq, 500, 0.5)
        result = detect_piano_note(audio, SAMPLE_RATE)

        if result is None:
            print(f"✓ {note_name} ({freq:.1f}Hz): Correctly filtered (no detection)")
            passed += 1
        else:
            detected_freq = result['frequency']
            # Check if it was corrected to a higher octave (which is acceptable)
            if detected_freq >= 65:
                print(f"✓ {note_name} ({freq:.1f}Hz): Corrected to {result['note']} ({detected_freq:.1f}Hz)")
                passed += 1
            else:
                print(f"✗ {note_name} ({freq:.1f}Hz): FAILED - detected as {result['note']} ({detected_freq:.1f}Hz)")

    print(f"\nPassed: {passed}/{len(below_c2)}")
    return passed == len(below_c2)

def test_low_notes_high_confidence():
    """Test that low notes (C2-C3) require higher confidence."""
    print("\n" + "="*60)
    print("TEST: Low notes require higher confidence")
    print("="*60)

    low_notes = ['C2', 'E2', 'A2']

    for note_name in low_notes:
        freq = FREQUENCIES[note_name]

        # Test with weak signal (should be filtered)
        weak_audio = generate_piano_tone(freq, 500, 0.1)  # Low amplitude
        weak_result = detect_piano_note(weak_audio, SAMPLE_RATE)

        # Test with strong signal (should pass)
        strong_audio = generate_piano_tone(freq, 500, 0.5)  # Normal amplitude
        strong_result = detect_piano_note(strong_audio, SAMPLE_RATE)

        print(f"\n{note_name} ({freq:.1f}Hz):")
        if weak_result is None:
            print(f"  ✓ Weak signal: Filtered (no detection)")
        else:
            print(f"  ? Weak signal: {weak_result['note']} (conf: {weak_result['confidence']:.2f})")

        if strong_result:
            print(f"  ✓ Strong signal: {strong_result['note']} (conf: {strong_result['confidence']:.2f})")
        else:
            print(f"  ? Strong signal: No detection")

def test_normal_range():
    """Test that normal range notes (C3+) work correctly."""
    print("\n" + "="*60)
    print("TEST: Normal range notes (C3 and above)")
    print("="*60)

    normal_notes = ['C3', 'E3', 'A3', 'C4', 'A4', 'C5', 'C6']
    passed = 0

    for note_name in normal_notes:
        freq = FREQUENCIES[note_name]
        audio = generate_piano_tone(freq, 500, 0.3)
        result = detect_piano_note(audio, SAMPLE_RATE)

        if result:
            detected_note = result['note']
            detected_freq = result['frequency']
            confidence = result['confidence']

            # Check if detected frequency is close (within 5% or 1 semitone)
            freq_error = abs(detected_freq - freq) / freq * 100

            if freq_error < 6:  # Within ~1 semitone
                print(f"✓ {note_name} ({freq:.1f}Hz): Detected as {detected_note} ({detected_freq:.1f}Hz, {freq_error:.1f}% error, conf: {confidence:.2f})")
                passed += 1
            else:
                print(f"✗ {note_name} ({freq:.1f}Hz): WRONG - {detected_note} ({detected_freq:.1f}Hz, {freq_error:.1f}% error)")
        else:
            print(f"✗ {note_name} ({freq:.1f}Hz): No detection")

    print(f"\nPassed: {passed}/{len(normal_notes)}")
    return passed >= len(normal_notes) - 1  # Allow 1 failure

def test_octave_accuracy():
    """Test octave accuracy - ensure no octave errors."""
    print("\n" + "="*60)
    print("TEST: Octave accuracy (no octave errors)")
    print("="*60)

    test_notes = [
        ('C3', 130.8),
        ('C4', 261.6),
        ('C5', 523.3),
        ('A3', 220.0),
        ('A4', 440.0),
    ]

    passed = 0
    for note_name, freq in test_notes:
        audio = generate_piano_tone(freq, 500, 0.4)
        result = detect_piano_note(audio, SAMPLE_RATE)

        if result:
            detected_note = result['note']
            expected_octave = int(note_name[-1])
            detected_octave = int(detected_note[-1]) if detected_note[-1].isdigit() else -1

            if detected_octave == expected_octave:
                print(f"✓ {note_name}: Correct octave (detected {detected_note})")
                passed += 1
            elif abs(detected_octave - expected_octave) == 1:
                print(f"? {note_name}: Off by 1 octave (detected {detected_note})")
            else:
                print(f"✗ {note_name}: WRONG octave (detected {detected_note})")
        else:
            print(f"✗ {note_name}: No detection")

    print(f"\nPassed: {passed}/{len(test_notes)}")
    return passed >= len(test_notes) - 1

def test_false_positive_resistance():
    """Test that noise doesn't produce false positives in low octaves."""
    print("\n" + "="*60)
    print("TEST: False positive resistance (noise rejection)")
    print("="*60)

    # Generate various noise types
    num_samples = int(0.5 * SAMPLE_RATE)

    noises = {
        'White noise': np.random.randn(num_samples).astype(np.float32) * 0.1,
        'Pink noise (low freq bias)': np.cumsum(np.random.randn(num_samples)).astype(np.float32) * 0.001,
        'Silence': np.zeros(num_samples, dtype=np.float32),
        'Very quiet sine': 0.002 * np.sin(2 * np.pi * 100 * np.arange(num_samples) / SAMPLE_RATE).astype(np.float32),
    }

    low_octave_detections = 0

    for noise_type, audio in noises.items():
        result = detect_piano_note(audio.tolist(), SAMPLE_RATE)

        if result is None:
            print(f"✓ {noise_type}: No detection (correct)")
        else:
            freq = result['frequency']
            note = result['note']
            octave = int(note[-1]) if note[-1].isdigit() else 4

            if octave <= 2:
                print(f"✗ {noise_type}: FALSE POSITIVE - {note} ({freq:.1f}Hz)")
                low_octave_detections += 1
            else:
                print(f"? {noise_type}: Detected {note} ({freq:.1f}Hz)")

    print(f"\nLow octave false positives: {low_octave_detections}")
    return low_octave_detections == 0

def main():
    print("\n" + "#"*60)
    print("# LOW FREQUENCY FILTER TEST SUITE")
    print("#"*60)

    results = []

    results.append(("Filter below C2", test_filter_below_c2()))
    test_low_notes_high_confidence()  # Info only
    results.append(("Normal range", test_normal_range()))
    results.append(("Octave accuracy", test_octave_accuracy()))
    results.append(("False positive resistance", test_false_positive_resistance()))

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)

    passed = sum(1 for _, r in results if r)
    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status}: {name}")

    print(f"\nOverall: {passed}/{len(results)} tests passed")

    return passed == len(results)

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
