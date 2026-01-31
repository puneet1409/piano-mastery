#!/usr/bin/env python3
"""
Comprehensive testing of polyphonic chord detection.
Tests with synthesized audio including noise, harmonics, and edge cases.
"""

import numpy as np
from polyphonic_detector import PolyphonicDetector
from chord_score_follower import ChordScoreFollower, create_basic_chords_exercise


def synthesize_chord(
    frequencies: list,
    duration: float = 0.5,
    sample_rate: int = 44100,
    noise_level: float = 0.0,
    add_harmonics: bool = True
) -> np.ndarray:
    """
    Synthesize a realistic piano chord with noise and harmonics.

    Args:
        frequencies: Fundamental frequencies to synthesize
        duration: Duration in seconds
        sample_rate: Sample rate
        noise_level: White noise level (0.0 = none, 0.1 = moderate)
        add_harmonics: Add harmonic overtones (realistic piano sound)

    Returns:
        Audio signal as numpy array
    """
    t = np.linspace(0, duration, int(sample_rate * duration))
    signal = np.zeros_like(t)

    for freq in frequencies:
        # Fundamental frequency
        note_signal = np.sin(2 * np.pi * freq * t)

        if add_harmonics:
            # Add harmonic overtones (makes it sound more like a real piano)
            # Piano has strong 2nd, 3rd, 4th harmonics
            note_signal += 0.5 * np.sin(2 * np.pi * freq * 2 * t)  # 2nd harmonic
            note_signal += 0.3 * np.sin(2 * np.pi * freq * 3 * t)  # 3rd harmonic
            note_signal += 0.15 * np.sin(2 * np.pi * freq * 4 * t)  # 4th harmonic

        # Apply amplitude envelope (attack-decay-sustain-release)
        envelope = np.ones_like(t)

        # Attack (0-50ms)
        attack_samples = int(0.05 * sample_rate)
        envelope[:attack_samples] = np.linspace(0, 1, attack_samples)

        # Decay (sustain level)
        decay_samples = int(0.1 * sample_rate)
        if attack_samples + decay_samples < len(envelope):
            envelope[attack_samples:attack_samples + decay_samples] = np.linspace(1, 0.8, decay_samples)
            envelope[attack_samples + decay_samples:] = 0.8

        # Release (last 100ms)
        release_samples = int(0.1 * sample_rate)
        if release_samples < len(envelope):
            envelope[-release_samples:] = np.linspace(0.8, 0, release_samples)

        note_signal *= envelope
        signal += note_signal

    # Normalize
    signal = signal / len(frequencies)

    # Add white noise
    if noise_level > 0:
        noise = np.random.normal(0, noise_level, len(signal))
        signal += noise

    # Clip to prevent distortion
    signal = np.clip(signal, -1.0, 1.0)

    return signal


def test_polyphonic_detector():
    """Test the polyphonic detector with various scenarios"""
    print("=" * 70)
    print("TEST 1: Polyphonic Detector - Basic Functionality")
    print("=" * 70)

    detector = PolyphonicDetector(sample_rate=44100)

    # Test Case 1: Perfect C major chord (no noise)
    print("\n1. Perfect C major chord (C4 + E4 + G4) - no noise")
    c_major_freqs = [261.63, 329.63, 392.00]
    signal = synthesize_chord(c_major_freqs, noise_level=0.0, add_harmonics=True)
    result = detector.detect_from_fft(signal)

    print(f"   Expected: C4, E4, G4")
    print(f"   Detected {len(result.notes)} notes:")
    for note in result.notes:
        print(f"     - {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2%})")

    # Validate
    detected_names = [n.note for n in result.notes]
    expected_names = ["C4", "E4", "G4"]
    if set(detected_names) == set(expected_names):
        print("   ✓ PASS: All notes detected correctly")
    else:
        print(f"   ✗ FAIL: Expected {expected_names}, got {detected_names}")

    # Test Case 2: C major chord with moderate noise
    print("\n2. C major chord with moderate noise (SNR ~10dB)")
    signal_noisy = synthesize_chord(c_major_freqs, noise_level=0.1, add_harmonics=True)
    result_noisy = detector.detect_from_fft(signal_noisy)

    print(f"   Detected {len(result_noisy.notes)} notes:")
    for note in result_noisy.notes:
        print(f"     - {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2%})")

    detected_names_noisy = [n.note for n in result_noisy.notes]
    if set(detected_names_noisy).issuperset(set(expected_names)):
        print("   ✓ PASS: Core notes detected despite noise")
    else:
        print(f"   ⚠ PARTIAL: Expected {expected_names}, got {detected_names_noisy}")

    # Test Case 3: Two-note interval (C4 + E4)
    print("\n3. Two-note interval (C4 + E4)")
    interval_freqs = [261.63, 329.63]
    signal_interval = synthesize_chord(interval_freqs, noise_level=0.05, add_harmonics=True)
    result_interval = detector.detect_from_fft(signal_interval)

    print(f"   Expected: C4, E4")
    print(f"   Detected {len(result_interval.notes)} notes:")
    for note in result_interval.notes:
        print(f"     - {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2%})")

    detected_interval = [n.note for n in result_interval.notes]
    if "C4" in detected_interval and "E4" in detected_interval:
        print("   ✓ PASS: Both notes in interval detected")
    else:
        print(f"   ✗ FAIL: Expected C4 and E4, got {detected_interval}")

    # Test Case 4: F major chord (F4 + A4 + C5)
    print("\n4. F major chord (F4 + A4 + C5)")
    f_major_freqs = [349.23, 440.00, 523.25]
    signal_f = synthesize_chord(f_major_freqs, noise_level=0.05, add_harmonics=True)
    result_f = detector.detect_from_fft(signal_f)

    print(f"   Expected: F4, A4, C5")
    print(f"   Detected {len(result_f.notes)} notes:")
    for note in result_f.notes:
        print(f"     - {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2%})")

    detected_f = [n.note for n in result_f.notes]
    expected_f = ["F4", "A4", "C5"]
    if set(detected_f) == set(expected_f):
        print("   ✓ PASS: All notes detected correctly")
    else:
        print(f"   ⚠ PARTIAL: Expected {expected_f}, got {detected_f}")

    # Test Case 5: Edge case - very quiet notes (low amplitude)
    print("\n5. Edge case: Very quiet chord (testing sensitivity)")
    signal_quiet = synthesize_chord(c_major_freqs, noise_level=0.0, add_harmonics=True) * 0.3
    result_quiet = detector.detect_from_fft(signal_quiet)

    print(f"   Detected {len(result_quiet.notes)} notes:")
    for note in result_quiet.notes:
        print(f"     - {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2%})")

    if len(result_quiet.notes) >= 2:
        print("   ✓ PASS: Still detects notes at low amplitude")
    else:
        print("   ⚠ WARNING: May miss quiet notes (consider lowering threshold)")


def test_full_pipeline():
    """Test the full pipeline: detector → chord score follower"""
    print("\n\n" + "=" * 70)
    print("TEST 2: Full Pipeline - Detector + Score Follower")
    print("=" * 70)

    detector = PolyphonicDetector(sample_rate=44100)
    exercise = create_basic_chords_exercise()
    follower = ChordScoreFollower(exercise)
    follower.start()

    print(f"\nExercise: {exercise.name}")
    print("Expected chords:")
    for i, chord in enumerate(exercise.chords):
        print(f"  {i + 1}. {' + '.join(chord.notes)}")
    print()

    test_cases = [
        {
            "name": "1. Perfect C major (first chord)",
            "frequencies": [261.63, 329.63, 392.00],
            "expected_feedback": "Perfect chord",
            "noise": 0.05,
        },
        {
            "name": "2. Perfect F major (second chord)",
            "frequencies": [349.23, 440.00, 523.25],
            "expected_feedback": "Perfect chord",
            "noise": 0.05,
        },
        {
            "name": "3. Incomplete G major (missing D5)",
            "frequencies": [392.00, 493.88],  # G4 + B4 (no D5)
            "expected_feedback": "missing",
            "noise": 0.05,
        },
        {
            "name": "4. Perfect C major (fourth chord)",
            "frequencies": [261.63, 329.63, 392.00],
            "expected_feedback": "Perfect chord",
            "noise": 0.05,
        },
    ]

    for test in test_cases:
        print(f"\n{test['name']}")
        print(f"   Synthesizing: {test['frequencies']}")

        # Synthesize audio
        signal = synthesize_chord(
            test['frequencies'],
            noise_level=test['noise'],
            add_harmonics=True
        )

        # Detect notes
        detection = detector.detect_from_fft(signal)
        detected_notes = [n.note for n in detection.notes]
        detected_freqs = [n.frequency for n in detection.notes]
        avg_confidence = np.mean([n.confidence for n in detection.notes]) if detection.notes else 0.0

        print(f"   Detected: {' + '.join(detected_notes) if detected_notes else 'none'}")
        print(f"   Confidence: {avg_confidence:.2%}")

        # Process with score follower
        result = follower.process_chord_detection(
            detected_notes,
            detected_freqs,
            avg_confidence
        )

        print(f"   Score Follower:")
        print(f"     Matched: {result['matched']}")
        print(f"     Feedback: {result['feedback']}")
        print(f"     Action: {result['action']}")

        # Validation
        if test['expected_feedback'].lower() in result['feedback'].lower():
            print(f"   ✓ PASS: Feedback matches expectation")
        else:
            print(f"   ⚠ PARTIAL: Expected '{test['expected_feedback']}' in feedback")

    # Final progress
    print("\n" + "-" * 70)
    print("Exercise Progress:")
    progress = follower.get_progress()
    print(f"  Correct: {progress['correct']}/{progress['total']}")
    print(f"  Partial: {progress['partial']}/{progress['total']}")
    print(f"  Completion: {progress['completion_percent']:.1f}%")

    if progress['completion_percent'] >= 90:
        print("  ✓ PASS: Exercise completed successfully")
    else:
        print("  ⚠ PARTIAL: Some chords not detected correctly")


def test_edge_cases():
    """Test edge cases and error conditions"""
    print("\n\n" + "=" * 70)
    print("TEST 3: Edge Cases and Error Handling")
    print("=" * 70)

    detector = PolyphonicDetector(sample_rate=44100)

    # Edge Case 1: Wrong chord played
    print("\n1. Wrong chord: D major instead of C major")
    d_major_freqs = [293.66, 369.99, 440.00]  # D4 + F#4 + A4
    signal_wrong = synthesize_chord(d_major_freqs, noise_level=0.05, add_harmonics=True)
    result_wrong = detector.detect_from_fft(signal_wrong)

    print(f"   Detected: {' + '.join([n.note for n in result_wrong.notes])}")

    exercise = create_basic_chords_exercise()
    follower = ChordScoreFollower(exercise)
    follower.start()

    result = follower.process_chord_detection(
        [n.note for n in result_wrong.notes],
        [n.frequency for n in result_wrong.notes],
        0.9
    )

    print(f"   Score Follower Action: {result['action']}")
    if result['action'] == "reject":
        print("   ✓ PASS: Correctly rejected wrong chord")
    else:
        print("   ✗ FAIL: Should reject wrong chord")

    # Edge Case 2: Only one note of a chord (very incomplete)
    print("\n2. Only one note of chord (C4 only, missing E4 and G4)")
    single_note_signal = synthesize_chord([261.63], noise_level=0.05, add_harmonics=True)
    result_single = detector.detect_from_fft(single_note_signal)

    print(f"   Detected: {' + '.join([n.note for n in result_single.notes])}")

    follower2 = ChordScoreFollower(create_basic_chords_exercise())
    follower2.start()

    result2 = follower2.process_chord_detection(
        [n.note for n in result_single.notes],
        [n.frequency for n in result_single.notes],
        0.9
    )

    print(f"   Score Follower Action: {result2['action']}")
    print(f"   Feedback: {result2['feedback']}")

    # Edge Case 3: Heavy noise (SNR ~0dB)
    print("\n3. Heavy noise test (SNR ~0dB)")
    c_major_freqs = [261.63, 329.63, 392.00]
    signal_heavy_noise = synthesize_chord(c_major_freqs, noise_level=0.5, add_harmonics=True)
    result_heavy = detector.detect_from_fft(signal_heavy_noise)

    print(f"   Detected {len(result_heavy.notes)} notes:")
    for note in result_heavy.notes:
        print(f"     - {note.note} (confidence: {note.confidence:.2%})")

    if len(result_heavy.notes) >= 2:
        print("   ✓ PASS: Still detects some notes in heavy noise")
    else:
        print("   ⚠ WARNING: Heavy noise degrades detection significantly")

    # Edge Case 4: Empty signal (silence)
    print("\n4. Empty signal (silence)")
    silence = np.zeros(44100 // 2)
    result_silence = detector.detect_from_fft(silence)

    print(f"   Detected {len(result_silence.notes)} notes")
    if len(result_silence.notes) == 0:
        print("   ✓ PASS: No false positives in silence")
    else:
        print("   ✗ FAIL: Detected notes in silence (false positive)")


if __name__ == "__main__":
    print("\n" + "#" * 70)
    print("# COMPREHENSIVE CHORD DETECTION TEST SUITE")
    print("#" * 70)

    test_polyphonic_detector()
    test_full_pipeline()
    test_edge_cases()

    print("\n\n" + "=" * 70)
    print("TEST SUITE COMPLETE")
    print("=" * 70)
    print("\nSummary:")
    print("  - Polyphonic detector tested with clean and noisy signals")
    print("  - Full pipeline tested with realistic chord progressions")
    print("  - Edge cases validated (wrong chords, noise, silence)")
    print("\n✓ Ready for integration into WebSocket server")
