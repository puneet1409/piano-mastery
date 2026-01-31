#!/usr/bin/env python3
"""
Stress Test Suite for Piano Detection

Simulates realistic playing conditions:
1. Wrong notes (playing F when expected E)
2. Pitch drift (slightly out of tune piano)
3. Timing jitter (early/late notes)
4. Background noise (room ambience, AC hum)
5. Velocity variations (soft to loud)
6. Octave errors (playing C3 instead of C4)
7. Extra notes (accidental key presses)
8. Missed notes (gaps in playing)
9. Fast passages (rapid note sequences)
10. Chord accuracy (multiple simultaneous notes)
"""

import numpy as np
from typing import List, Tuple, Optional
from dataclasses import dataclass
from production_detector import ProductionDetector


@dataclass
class TestResult:
    name: str
    passed: int
    total: int
    details: List[str]

    @property
    def accuracy(self) -> float:
        return 100 * self.passed / self.total if self.total > 0 else 0

    @property
    def status(self) -> str:
        if self.accuracy >= 95:
            return "✓ PASS"
        elif self.accuracy >= 80:
            return "~ WARN"
        else:
            return "✗ FAIL"


class AudioGenerator:
    """Generate realistic piano-like audio for testing."""

    NOTE_FREQS = {
        # Octave 2
        'C2': 65.41, 'C#2': 69.30, 'Db2': 69.30, 'D2': 73.42, 'D#2': 77.78,
        'Eb2': 77.78, 'E2': 82.41, 'F2': 87.31, 'F#2': 92.50, 'Gb2': 92.50,
        'G2': 98.00, 'G#2': 103.83, 'Ab2': 103.83, 'A2': 110.00, 'A#2': 116.54,
        'Bb2': 116.54, 'B2': 123.47,
        # Octave 3
        'C3': 130.81, 'C#3': 138.59, 'Db3': 138.59, 'D3': 146.83, 'D#3': 155.56,
        'Eb3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'Gb3': 185.00,
        'G3': 196.00, 'G#3': 207.65, 'Ab3': 207.65, 'A3': 220.00, 'A#3': 233.08,
        'Bb3': 233.08, 'B3': 246.94,
        # Octave 4 (middle C octave)
        'C4': 261.63, 'C#4': 277.18, 'Db4': 277.18, 'D4': 293.66, 'D#4': 311.13,
        'Eb4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'Gb4': 369.99,
        'G4': 392.00, 'G#4': 415.30, 'Ab4': 415.30, 'A4': 440.00, 'A#4': 466.16,
        'Bb4': 466.16, 'B4': 493.88,
        # Octave 5
        'C5': 523.25, 'C#5': 554.37, 'Db5': 554.37, 'D5': 587.33, 'D#5': 622.25,
        'Eb5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'Gb5': 739.99,
        'G5': 783.99, 'G#5': 830.61, 'Ab5': 830.61, 'A5': 880.00, 'A#5': 932.33,
        'Bb5': 932.33, 'B5': 987.77,
        # Octave 6
        'C6': 1046.50,
    }

    def __init__(self, sample_rate: int = 44100):
        self.sr = sample_rate

    def generate_note(
        self,
        note: str,
        duration: float = 0.3,
        velocity: float = 0.8,
        pitch_drift_cents: float = 0,
        noise_level: float = 0.01,
    ) -> np.ndarray:
        """Generate a single piano-like note."""
        freq = self.NOTE_FREQS.get(note, 440.0)

        # Apply pitch drift (cents to frequency ratio)
        freq = freq * (2 ** (pitch_drift_cents / 1200))

        t = np.linspace(0, duration, int(self.sr * duration))

        # Harmonics with piano-like decay
        harmonics = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1, 0.08]
        signal = np.zeros_like(t)

        for i, amp in enumerate(harmonics):
            h_freq = freq * (i + 1)
            if h_freq < self.sr / 2:  # Nyquist
                # Slight random detuning for realism
                detune = 1.0 + (np.random.random() - 0.5) * 0.001
                signal += amp * np.sin(2 * np.pi * h_freq * detune * t)

        # ADSR envelope
        attack = int(0.01 * self.sr)
        decay = int(0.08 * self.sr)
        sustain_level = 0.6

        envelope = np.ones_like(t) * sustain_level
        if attack > 0 and attack < len(envelope):
            envelope[:attack] = np.linspace(0, 1, attack)
        if decay > 0 and attack + decay < len(envelope):
            envelope[attack:attack+decay] = np.linspace(1, sustain_level, decay)

        # Exponential decay
        envelope = envelope * np.exp(-2 * t / duration)

        signal = signal * envelope * velocity

        # Add noise
        noise = np.random.normal(0, noise_level, len(signal))
        signal = signal + noise

        # Normalize
        max_val = np.abs(signal).max()
        if max_val > 0:
            signal = signal / max_val * velocity

        return signal.astype(np.float32)

    def generate_chord(
        self,
        notes: List[str],
        duration: float = 0.3,
        velocity: float = 0.7,
    ) -> np.ndarray:
        """Generate a chord (multiple notes)."""
        chord = np.zeros(int(self.sr * duration), dtype=np.float32)

        for note in notes:
            note_audio = self.generate_note(note, duration, velocity / len(notes))
            chord[:len(note_audio)] += note_audio

        # Normalize
        max_val = np.abs(chord).max()
        if max_val > 0:
            chord = chord / max_val * velocity

        return chord


class StressTestSuite:
    """Comprehensive stress tests for piano detection."""

    def __init__(self):
        self.detector = ProductionDetector(mode="single")
        self.audio = AudioGenerator()
        self.sr = 44100
        self.results: List[TestResult] = []

    def run_all(self):
        """Run all stress tests."""
        print("=" * 70)
        print("PIANO DETECTION STRESS TEST SUITE")
        print("=" * 70)

        tests = [
            self.test_correct_notes,
            self.test_wrong_notes,
            self.test_pitch_drift,
            self.test_timing_jitter,
            self.test_background_noise,
            self.test_velocity_variations,
            self.test_octave_errors,
            self.test_extra_notes,
            self.test_fast_passages,
            self.test_semitone_neighbors,
            self.test_enharmonic_equivalents,
            self.test_extreme_registers,
        ]

        for test in tests:
            result = test()
            self.results.append(result)
            print(f"\n{result.status} {result.name}: {result.passed}/{result.total} ({result.accuracy:.1f}%)")
            if result.details and result.accuracy < 95:
                for detail in result.details[:3]:
                    print(f"      {detail}")

        self.print_summary()

    def print_summary(self):
        """Print test summary."""
        print("\n" + "=" * 70)
        print("SUMMARY")
        print("=" * 70)

        total_passed = sum(r.passed for r in self.results)
        total_tests = sum(r.total for r in self.results)
        overall = 100 * total_passed / total_tests if total_tests > 0 else 0

        print(f"\nOverall accuracy: {total_passed}/{total_tests} ({overall:.1f}%)")

        passed = sum(1 for r in self.results if r.accuracy >= 95)
        warned = sum(1 for r in self.results if 80 <= r.accuracy < 95)
        failed = sum(1 for r in self.results if r.accuracy < 80)

        print(f"Tests passed (≥95%): {passed}/{len(self.results)}")
        print(f"Tests warned (80-95%): {warned}/{len(self.results)}")
        print(f"Tests failed (<80%): {failed}/{len(self.results)}")

        if overall >= 95:
            print("\n✓ STRESS TEST PASSED - Production ready!")
        elif overall >= 85:
            print("\n~ STRESS TEST WARNING - Minor issues")
        else:
            print("\n✗ STRESS TEST FAILED - Needs improvement")

    def test_correct_notes(self) -> TestResult:
        """Test: Correct notes should always be detected."""
        name = "Correct Notes"
        passed = 0
        total = 0
        details = []

        test_notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]

        for note in test_notes:
            audio = self.audio.generate_note(note)
            result = self.detector.detect(audio, self.sr, expected_notes=[note])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed: {note}")

        return TestResult(name, passed, total, details)

    def test_wrong_notes(self) -> TestResult:
        """Test: Wrong notes should be rejected."""
        name = "Wrong Note Rejection"
        passed = 0
        total = 0
        details = []

        # Play C4, expect G4 (should reject)
        wrong_pairs = [
            ("C4", "G4"),
            ("D4", "A4"),
            ("E4", "B4"),
            ("F4", "C5"),
            ("G4", "D5"),
        ]

        for played, expected in wrong_pairs:
            audio = self.audio.generate_note(played)
            result = self.detector.detect(audio, self.sr, expected_notes=[expected])

            total += 1
            # Should NOT match (wrong note)
            if not result.is_match:
                passed += 1
            else:
                details.append(f"False positive: played {played}, accepted as {expected}")

        return TestResult(name, passed, total, details)

    def test_pitch_drift(self) -> TestResult:
        """Test: Slightly out-of-tune notes should still match."""
        name = "Pitch Drift Tolerance"
        passed = 0
        total = 0
        details = []

        # Test various amounts of pitch drift (in cents)
        # 100 cents = 1 semitone
        drifts = [-40, -25, -10, 0, 10, 25, 40]  # Within half semitone

        for drift in drifts:
            audio = self.audio.generate_note("A4", pitch_drift_cents=drift)
            result = self.detector.detect(audio, self.sr, expected_notes=["A4"])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed at {drift} cents drift")

        return TestResult(name, passed, total, details)

    def test_timing_jitter(self) -> TestResult:
        """Test: Notes with timing variations should be detected."""
        name = "Timing Jitter"
        passed = 0
        total = 0
        details = []

        # Different note durations (simulating timing variations)
        durations = [0.05, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5]

        for dur in durations:
            audio = self.audio.generate_note("C4", duration=dur)
            result = self.detector.detect(audio, self.sr, expected_notes=["C4"])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed at {dur*1000:.0f}ms duration")

        return TestResult(name, passed, total, details)

    def test_background_noise(self) -> TestResult:
        """Test: Notes with background noise should be detected."""
        name = "Background Noise"
        passed = 0
        total = 0
        details = []

        noise_levels = [0.01, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2]

        for noise in noise_levels:
            audio = self.audio.generate_note("E4", noise_level=noise)
            result = self.detector.detect(audio, self.sr, expected_notes=["E4"])

            total += 1
            if result.is_match:
                passed += 1
            else:
                snr = 20 * np.log10(0.8 / (noise + 1e-6))
                details.append(f"Failed at noise={noise:.2f} (SNR ~{snr:.0f}dB)")

        return TestResult(name, passed, total, details)

    def test_velocity_variations(self) -> TestResult:
        """Test: Soft and loud notes should be detected."""
        name = "Velocity Variations"
        passed = 0
        total = 0
        details = []

        velocities = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0]

        for vel in velocities:
            audio = self.audio.generate_note("G4", velocity=vel)
            result = self.detector.detect(audio, self.sr, expected_notes=["G4"])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed at velocity={vel:.0%}")

        return TestResult(name, passed, total, details)

    def test_octave_errors(self) -> TestResult:
        """Test: Playing wrong octave should be accepted (configurable)."""
        name = "Octave Error Tolerance"
        passed = 0
        total = 0
        details = []

        # Play C3, expect C4 (common beginner mistake)
        octave_pairs = [
            ("C3", "C4"),
            ("C5", "C4"),
            ("G3", "G4"),
            ("A3", "A4"),
            ("E5", "E4"),
        ]

        for played, expected in octave_pairs:
            audio = self.audio.generate_note(played)
            result = self.detector.detect(audio, self.sr, expected_notes=[expected])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Rejected octave error: {played} vs {expected}")

        return TestResult(name, passed, total, details)

    def test_extra_notes(self) -> TestResult:
        """Test: Extra notes mixed with correct notes."""
        name = "Extra Notes Filtering"
        passed = 0
        total = 0
        details = []

        expected_scale = ["C4", "D4", "E4", "F4", "G4"]

        # Sequence with some extra wrong notes
        played_sequence = ["C4", "D4", "X", "E4", "F4", "X", "G4"]

        for note in played_sequence:
            if note == "X":
                # Random wrong note
                audio = self.audio.generate_note("B4")
                result = self.detector.detect(audio, self.sr, expected_notes=expected_scale)
                total += 1
                if not result.is_match:  # Should reject
                    passed += 1
                else:
                    details.append(f"False positive: accepted wrong note B4")
            else:
                audio = self.audio.generate_note(note)
                result = self.detector.detect(audio, self.sr, expected_notes=expected_scale)
                total += 1
                if result.is_match:
                    passed += 1
                else:
                    details.append(f"Missed correct note: {note}")

        return TestResult(name, passed, total, details)

    def test_fast_passages(self) -> TestResult:
        """Test: Very short notes (fast playing)."""
        name = "Fast Passages"
        passed = 0
        total = 0
        details = []

        # Very short durations (fast playing)
        durations = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08]
        notes = ["C4", "D4", "E4", "F4", "G4", "A4"]

        for note, dur in zip(notes, durations):
            audio = self.audio.generate_note(note, duration=dur)
            result = self.detector.detect(audio, self.sr, expected_notes=[note])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed {note} at {dur*1000:.0f}ms")

        return TestResult(name, passed, total, details)

    def test_semitone_neighbors(self) -> TestResult:
        """Test: Semitone tolerance (±1 semitone accepted)."""
        name = "Semitone Tolerance"
        passed = 0
        total = 0
        details = []

        # Play C4, expect C#4 (should accept with tolerance)
        semitone_pairs = [
            ("C4", "C#4"),   # +1 semitone
            ("D4", "C#4"),   # -1 semitone
            ("F4", "F#4"),   # +1 semitone
            ("G#4", "G4"),   # -1 semitone
        ]

        for played, expected in semitone_pairs:
            audio = self.audio.generate_note(played)
            result = self.detector.detect(audio, self.sr, expected_notes=[expected])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Rejected semitone: {played} vs {expected}")

        return TestResult(name, passed, total, details)

    def test_enharmonic_equivalents(self) -> TestResult:
        """Test: C# should match Db, etc."""
        name = "Enharmonic Equivalents"
        passed = 0
        total = 0
        details = []

        # Note: This tests if the detector handles enharmonics
        # Since we generate audio by frequency, C#4 and Db4 are identical
        enharmonics = [
            ("C#4", "Db4"),
            ("D#4", "Eb4"),
            ("F#4", "Gb4"),
            ("G#4", "Ab4"),
            ("A#4", "Bb4"),
        ]

        for note1, note2 in enharmonics:
            # Generate C#4, expect Db4 (same pitch)
            if note1 in self.audio.NOTE_FREQS:
                audio = self.audio.generate_note(note1)
            else:
                # Use the enharmonic equivalent
                audio = self.audio.generate_note(note2)

            result = self.detector.detect(audio, self.sr, expected_notes=[note2])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Rejected enharmonic: {note1} vs {note2}")

        return TestResult(name, passed, total, details)

    def test_extreme_registers(self) -> TestResult:
        """Test: Very low and very high notes."""
        name = "Extreme Registers"
        passed = 0
        total = 0
        details = []

        # Low notes
        low_notes = ["C3", "D3", "E3"]
        for note in low_notes:
            audio = self.audio.generate_note(note)
            result = self.detector.detect(audio, self.sr, expected_notes=[note])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed low note: {note}")

        # High notes
        high_notes = ["C5", "D5", "E5", "C6"]
        for note in high_notes:
            audio = self.audio.generate_note(note)
            result = self.detector.detect(audio, self.sr, expected_notes=[note])

            total += 1
            if result.is_match:
                passed += 1
            else:
                details.append(f"Failed high note: {note}")

        return TestResult(name, passed, total, details)


if __name__ == "__main__":
    suite = StressTestSuite()
    suite.run_all()
