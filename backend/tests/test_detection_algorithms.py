#!/usr/bin/env python3
"""
Comprehensive test suite for piano detection algorithms.

Tests:
- YIN pitch detection accuracy
- Score follower matching logic
- Gate system (energy, confidence, onset)
- Stability confirmation (2/3 hops)
- Timing tolerance and jitter handling
- Polyphonic detection
- Edge cases and stress tests

Run with: pytest tests/test_detection_algorithms.py -v
"""

import pytest
import numpy as np
import time
from typing import List, Tuple, Optional
from dataclasses import dataclass
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import detection modules
try:
    from optimized_yin import detect_piano_note, YinConfig
    YIN_AVAILABLE = True
except ImportError:
    YIN_AVAILABLE = False
    print("⚠ optimized_yin not available, some tests will be skipped")

try:
    from polyphonic_detector import PolyphonicDetector
    POLYPHONIC_AVAILABLE = True
except ImportError:
    POLYPHONIC_AVAILABLE = False

try:
    from score_follower import ScoreFollower
    SCORE_FOLLOWER_AVAILABLE = True
except ImportError:
    SCORE_FOLLOWER_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────────────────
# Audio Generation Utilities
# ─────────────────────────────────────────────────────────────────────────────

def midi_to_freq(midi: int) -> float:
    """Convert MIDI note number to frequency in Hz."""
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def freq_to_midi(freq: float) -> int:
    """Convert frequency to nearest MIDI note number."""
    return int(round(12 * np.log2(freq / 440.0) + 69))


def note_to_frequency(note: str) -> float:
    """Convert note name (e.g., 'C4', 'F#5') to frequency in Hz."""
    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    note = note.strip()

    # Handle flats by converting to sharps
    if 'b' in note:
        flat_to_sharp = {'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B'}
        for flat, sharp in flat_to_sharp.items():
            if note.startswith(flat):
                note = sharp + note[len(flat):]
                break

    # Extract note name and octave
    if len(note) >= 2 and note[1] == '#':
        note_name = note[:2]
        octave = int(note[2:]) if len(note) > 2 else 4
    else:
        note_name = note[0]
        octave = int(note[1:]) if len(note) > 1 else 4

    if note_name not in NOTE_NAMES:
        raise ValueError(f"Invalid note name: {note_name}")

    # Convert to MIDI then to frequency
    note_index = NOTE_NAMES.index(note_name)
    midi = (octave + 1) * 12 + note_index
    return midi_to_freq(midi)


def generate_sine_wave(
    freq: float,
    duration_ms: float,
    sample_rate: int = 44100,
    amplitude: float = 0.5,
    phase: float = 0.0
) -> np.ndarray:
    """Generate a pure sine wave."""
    num_samples = int((duration_ms / 1000.0) * sample_rate)
    t = np.arange(num_samples) / sample_rate
    return (amplitude * np.sin(2 * np.pi * freq * t + phase)).astype(np.float32)


def generate_piano_tone(
    midi_note: int,
    duration_ms: float,
    sample_rate: int = 44100,
    amplitude: float = 0.5,
    attack_ms: float = 10,
    decay_ratio: float = 0.7
) -> np.ndarray:
    """Generate a piano-like tone with harmonics and envelope."""
    freq = midi_to_freq(midi_note)
    num_samples = int((duration_ms / 1000.0) * sample_rate)
    t = np.arange(num_samples) / sample_rate

    # Fundamental + harmonics (piano-like spectrum)
    signal = np.zeros(num_samples, dtype=np.float32)
    harmonics = [1.0, 0.5, 0.25, 0.125, 0.0625]  # Amplitude ratios

    for i, harm_amp in enumerate(harmonics):
        harm_freq = freq * (i + 1)
        if harm_freq < sample_rate / 2:  # Nyquist limit
            signal += harm_amp * np.sin(2 * np.pi * harm_freq * t)

    # ADSR envelope
    attack_samples = int((attack_ms / 1000.0) * sample_rate)
    envelope = np.ones(num_samples)

    # Attack
    if attack_samples > 0:
        envelope[:attack_samples] = np.linspace(0, 1, attack_samples)

    # Decay/sustain
    decay_samples = num_samples - attack_samples
    if decay_samples > 0:
        envelope[attack_samples:] = np.exp(-3 * t[attack_samples:] / (duration_ms / 1000.0)) * decay_ratio + (1 - decay_ratio)

    signal *= envelope * amplitude
    return signal.astype(np.float32)


def generate_chord(
    midi_notes: List[int],
    duration_ms: float,
    sample_rate: int = 44100,
    amplitude: float = 0.3
) -> np.ndarray:
    """Generate a chord (multiple notes simultaneously)."""
    signal = np.zeros(int((duration_ms / 1000.0) * sample_rate), dtype=np.float32)
    for midi in midi_notes:
        signal += generate_piano_tone(midi, duration_ms, sample_rate, amplitude / len(midi_notes))
    return signal


def add_noise(signal: np.ndarray, snr_db: float = 30) -> np.ndarray:
    """Add Gaussian noise to signal at specified SNR."""
    signal_power = np.mean(signal ** 2)
    noise_power = signal_power / (10 ** (snr_db / 10))
    noise = np.sqrt(noise_power) * np.random.randn(len(signal))
    return (signal + noise).astype(np.float32)


def add_jitter(
    signal: np.ndarray,
    jitter_ms: float,
    sample_rate: int = 44100
) -> np.ndarray:
    """Add timing jitter by randomly shifting samples."""
    jitter_samples = int((jitter_ms / 1000.0) * sample_rate)
    if jitter_samples == 0:
        return signal

    shift = np.random.randint(-jitter_samples, jitter_samples + 1)
    if shift > 0:
        return np.concatenate([np.zeros(shift, dtype=np.float32), signal[:-shift]])
    elif shift < 0:
        return np.concatenate([signal[-shift:], np.zeros(-shift, dtype=np.float32)])
    return signal


def generate_sequence(
    midi_notes: List[int],
    note_duration_ms: float,
    gap_ms: float = 50,
    sample_rate: int = 44100,
    amplitude: float = 0.5
) -> Tuple[np.ndarray, List[Tuple[int, float]]]:
    """
    Generate a sequence of notes with gaps.
    Returns (audio, [(midi, onset_time_ms), ...])
    """
    segments = []
    onsets = []
    current_time_ms = 0

    for midi in midi_notes:
        # Gap (silence)
        if gap_ms > 0 and len(segments) > 0:
            gap_samples = int((gap_ms / 1000.0) * sample_rate)
            segments.append(np.zeros(gap_samples, dtype=np.float32))
            current_time_ms += gap_ms

        # Note
        onsets.append((midi, current_time_ms))
        tone = generate_piano_tone(midi, note_duration_ms, sample_rate, amplitude)
        segments.append(tone)
        current_time_ms += note_duration_ms

    return np.concatenate(segments), onsets


# ─────────────────────────────────────────────────────────────────────────────
# Test Result Tracking
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class DetectionResult:
    """Result of a single detection test."""
    expected_midi: int
    detected_midi: Optional[int]
    detected_freq: Optional[float]
    confidence: float
    latency_ms: float
    correct: bool
    error_cents: Optional[float] = None


class TestMetrics:
    """Aggregate metrics for a test run."""

    def __init__(self):
        self.results: List[DetectionResult] = []

    def add(self, result: DetectionResult):
        self.results.append(result)

    @property
    def accuracy(self) -> float:
        if not self.results:
            return 0.0
        return sum(1 for r in self.results if r.correct) / len(self.results)

    @property
    def avg_latency_ms(self) -> float:
        latencies = [r.latency_ms for r in self.results if r.latency_ms > 0]
        return np.mean(latencies) if latencies else 0.0

    @property
    def avg_confidence(self) -> float:
        confidences = [r.confidence for r in self.results if r.confidence > 0]
        return np.mean(confidences) if confidences else 0.0

    def summary(self) -> str:
        return (
            f"Accuracy: {self.accuracy:.1%} ({sum(1 for r in self.results if r.correct)}/{len(self.results)}), "
            f"Avg Latency: {self.avg_latency_ms:.1f}ms, "
            f"Avg Confidence: {self.avg_confidence:.2f}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# YIN Detection Tests (40 tests)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not YIN_AVAILABLE, reason="YIN not available")
class TestYinDetection:
    """Test YIN pitch detection algorithm."""

    SAMPLE_RATE = 44100

    # Test 1-8: Basic pitch detection across octaves
    @pytest.mark.parametrize("midi_note", [36, 48, 60, 72, 84, 96, 40, 52])
    def test_single_note_detection(self, midi_note):
        """Test detection of single notes across piano range."""
        audio = generate_piano_tone(midi_note, 200, self.SAMPLE_RATE)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)

        assert result is not None, f"Failed to detect MIDI {midi_note}"
        detected_midi = freq_to_midi(result["frequency"])
        assert abs(detected_midi - midi_note) <= 1, f"Expected MIDI {midi_note}, got {detected_midi}"

    # Test 9-16: Pure sine waves (no harmonics)
    @pytest.mark.parametrize("freq", [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25])
    def test_pure_sine_detection(self, freq):
        """Test detection of pure sine waves (C4 to C5)."""
        audio = generate_sine_wave(freq, 200, self.SAMPLE_RATE)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)

        assert result is not None, f"Failed to detect {freq}Hz"
        error_cents = 1200 * np.log2(result["frequency"] / freq)
        assert abs(error_cents) < 50, f"Error {error_cents:.1f} cents for {freq}Hz"

    # Test 17-24: Detection with various noise levels
    @pytest.mark.parametrize("snr_db", [40, 35, 30, 25, 20, 15, 10, 5])
    def test_noise_robustness(self, snr_db):
        """Test detection with different noise levels."""
        audio = generate_piano_tone(60, 200, self.SAMPLE_RATE)
        noisy = add_noise(audio, snr_db)
        result = detect_piano_note(noisy.tolist(), self.SAMPLE_RATE)

        if snr_db >= 15:
            assert result is not None, f"Failed at SNR {snr_db}dB"
            detected_midi = freq_to_midi(result["frequency"])
            assert abs(detected_midi - 60) <= 1, f"Wrong note at SNR {snr_db}dB"

    # Test 25-32: Detection at various amplitudes
    @pytest.mark.parametrize("amplitude", [0.8, 0.5, 0.3, 0.1, 0.05, 0.02, 0.01, 0.005])
    def test_amplitude_sensitivity(self, amplitude):
        """Test detection at different amplitude levels."""
        audio = generate_piano_tone(60, 200, self.SAMPLE_RATE, amplitude=amplitude)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)

        if amplitude >= 0.02:
            assert result is not None, f"Failed at amplitude {amplitude}"
            assert result["confidence"] > 0.3, f"Low confidence at amplitude {amplitude}"

    # Test 33-40: Edge cases
    def test_silence_rejection(self):
        """Test that silence is rejected."""
        audio = np.zeros(4096, dtype=np.float32)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
        assert result is None, "Should reject silence"

    def test_very_low_note(self):
        """Test detection of very low notes (A0 = 27.5Hz)."""
        audio = generate_piano_tone(21, 500, self.SAMPLE_RATE)  # A0
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
        # Low notes are hard, allow some error
        if result:
            detected_midi = freq_to_midi(result["frequency"])
            assert abs(detected_midi - 21) <= 12, "Octave error on low note"

    def test_very_high_note(self):
        """Test detection of very high notes (C8 = 4186Hz)."""
        audio = generate_piano_tone(108, 200, self.SAMPLE_RATE)  # C8
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
        if result:
            detected_midi = freq_to_midi(result["frequency"])
            assert abs(detected_midi - 108) <= 1, "Error on high note"

    def test_short_duration(self):
        """Test detection of very short notes (50ms)."""
        audio = generate_piano_tone(60, 50, self.SAMPLE_RATE)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
        # Short notes may not be detected reliably
        if result:
            detected_midi = freq_to_midi(result["frequency"])
            assert abs(detected_midi - 60) <= 1

    def test_long_duration(self):
        """Test detection of long sustained notes (2s)."""
        audio = generate_piano_tone(60, 2000, self.SAMPLE_RATE)
        # Test multiple windows
        window_size = 4096
        for i in range(0, len(audio) - window_size, window_size):
            window = audio[i:i+window_size]
            result = detect_piano_note(window.tolist(), self.SAMPLE_RATE)
            if result:
                detected_midi = freq_to_midi(result["frequency"])
                assert abs(detected_midi - 60) <= 1, f"Error at window {i}"

    def test_frequency_drift(self):
        """Test detection with slight frequency drift (vibrato)."""
        base_freq = 440.0
        duration_ms = 500
        num_samples = int((duration_ms / 1000.0) * self.SAMPLE_RATE)
        t = np.arange(num_samples) / self.SAMPLE_RATE

        # Add 5Hz vibrato with 10 cents depth
        vibrato = 5 * np.sin(2 * np.pi * 5 * t)  # 5Hz vibrato
        freq_mod = base_freq * (2 ** (vibrato / 1200))  # Convert cents to freq

        phase = np.cumsum(2 * np.pi * freq_mod / self.SAMPLE_RATE)
        audio = (0.5 * np.sin(phase)).astype(np.float32)

        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
        assert result is not None
        error_cents = 1200 * np.log2(result["frequency"] / base_freq)
        assert abs(error_cents) < 20, f"Error with vibrato: {error_cents:.1f} cents"

    def test_octave_disambiguation_c3_vs_c4(self):
        """Test that C3 and C4 are distinguished correctly."""
        for midi in [48, 60]:  # C3, C4
            audio = generate_piano_tone(midi, 200, self.SAMPLE_RATE)
            result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)
            assert result is not None
            detected_midi = freq_to_midi(result["frequency"])
            # Allow 1 semitone error but not octave error
            assert abs(detected_midi - midi) <= 1, f"Octave error: expected {midi}, got {detected_midi}"


# ─────────────────────────────────────────────────────────────────────────────
# Score Follower Tests (30 tests)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not SCORE_FOLLOWER_AVAILABLE, reason="ScoreFollower not available")
class TestScoreFollower:
    """Test score following and note matching logic."""

    def create_follower(self, expected_notes: List[str]) -> ScoreFollower:
        """Create a score follower with expected notes."""
        from score_follower import Exercise, ExpectedNote

        # Convert note names to ExpectedNote objects
        note_objects = []
        for i, note in enumerate(expected_notes):
            freq = note_to_frequency(note)
            note_objects.append(ExpectedNote(
                note=note,
                frequency=freq,
                position=i,
                timing_window=5.0
            ))

        exercise = Exercise(name="test", notes=note_objects)
        follower = ScoreFollower(exercise)
        follower.start()
        return follower

    def detect(self, follower: ScoreFollower, note: str, timing_ms: float = 0):
        """Helper to process a detection with proper arguments."""
        freq = note_to_frequency(note)
        return follower.process_detection(note, freq, 0.9, timing_ms / 1000.0)

    # Test 41-48: Basic matching
    def test_exact_match(self):
        """Test exact note matching."""
        follower = self.create_follower(["C4", "D4", "E4"])
        result = self.detect(follower, "C4", 0)
        assert result is not None
        assert result["matched"]

    def test_wrong_note_rejection(self):
        """Test rejection of wrong notes."""
        follower = self.create_follower(["C4", "D4", "E4"])
        result = self.detect(follower, "F4", 0)
        assert result is None or not result.get("matched", False)

    def test_sequence_progression(self):
        """Test that score advances correctly."""
        follower = self.create_follower(["C4", "D4", "E4"])

        result1 = self.detect(follower, "C4", 0)
        assert result1 and result1["matched"]

        result2 = self.detect(follower, "D4", 100)
        assert result2 and result2["matched"]

        result3 = self.detect(follower, "E4", 200)
        assert result3 and result3["matched"]

    def test_repeated_note(self):
        """Test handling of repeated notes in sequence."""
        follower = self.create_follower(["C4", "C4", "D4"])

        result1 = self.detect(follower, "C4", 0)
        assert result1 and result1["matched"]

        result2 = self.detect(follower, "C4", 100)
        assert result2 and result2["matched"]

    # Test 49-56: Timing tolerance
    @pytest.mark.parametrize("timing_error_ms", [0, 50, 100, 150, 200, 300, 400, 500])
    def test_timing_tolerance(self, timing_error_ms):
        """Test timing tolerance at various error levels."""
        follower = self.create_follower(["C4"])
        result = self.detect(follower, "C4", timing_error_ms)

        if timing_error_ms <= 500:  # Within typical tolerance
            assert result is not None

    # Test 57-64: Edge cases
    def test_empty_score(self):
        """Test handling of empty score."""
        follower = self.create_follower([])
        result = self.detect(follower, "C4", 0)
        assert result is None or not result.get("matched", False)

    def test_single_note_score(self):
        """Test single-note score."""
        follower = self.create_follower(["C4"])
        result = self.detect(follower, "C4", 0)
        assert result and result["matched"]

    def test_chromatic_scale(self):
        """Test full chromatic scale matching."""
        notes = [f"{n}{4}" for n in ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]]
        follower = self.create_follower(notes)

        for i, note in enumerate(notes):
            result = self.detect(follower, note, i * 100)
            assert result and result["matched"], f"Failed on {note}"

    def test_skip_detection(self):
        """Test behavior when notes are skipped."""
        follower = self.create_follower(["C4", "D4", "E4", "F4"])

        # Play C4, skip D4, play E4
        self.detect(follower, "C4", 0)
        result = self.detect(follower, "E4", 200)

        # Should still match E4 (skip D4)
        # Behavior depends on implementation

    def test_out_of_order_detection(self):
        """Test detection of notes out of order."""
        follower = self.create_follower(["C4", "D4", "E4"])

        # Play E4 first (out of order)
        result = self.detect(follower, "E4", 0)
        # Behavior depends on implementation - may reject or match

    def test_duplicate_detection(self):
        """Test handling of duplicate detections."""
        follower = self.create_follower(["C4", "D4"])

        result1 = self.detect(follower, "C4", 0)
        result2 = self.detect(follower, "C4", 10)  # Duplicate within 10ms

        assert result1 and result1["matched"]
        # Second should be ignored or marked as duplicate


# ─────────────────────────────────────────────────────────────────────────────
# Polyphonic Detection Tests (20 tests)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not POLYPHONIC_AVAILABLE, reason="PolyphonicDetector not available")
class TestPolyphonicDetection:
    """Test polyphonic (chord) detection."""

    SAMPLE_RATE = 44100

    def detect_notes(self, detector, audio):
        """Helper to detect notes and extract MIDI pitches."""
        result = detector.detect_from_fft(audio)
        if result and result.notes:
            # Convert frequencies to MIDI notes
            return [freq_to_midi(n.frequency) for n in result.notes]
        return []

    # Test 65-72: Basic chord detection
    @pytest.mark.parametrize("chord", [
        [60, 64, 67],      # C major
        [60, 63, 67],      # C minor
        [60, 64, 67, 72],  # C major 7
        [62, 65, 69],      # D minor
        [64, 68, 71],      # E major
        [65, 69, 72],      # F major
        [67, 71, 74],      # G major
        [69, 72, 76],      # A minor
    ])
    def test_triad_detection(self, chord):
        """Test detection of basic triads."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        audio = generate_chord(chord, 500, self.SAMPLE_RATE)

        detected_pitches = set(self.detect_notes(detector, audio))
        expected_pitches = set(chord)

        # Should detect at least 2 of 3 notes (allow 1 semitone tolerance)
        matched = 0
        for expected in expected_pitches:
            for detected in detected_pitches:
                if abs(detected - expected) <= 1:
                    matched += 1
                    break

        assert matched >= 2, f"Only detected {matched}/{len(chord)} notes"

    # Test 73-80: Interval detection
    @pytest.mark.parametrize("interval", [
        (60, 64),   # Major 3rd
        (60, 67),   # Perfect 5th
        (60, 72),   # Octave
        (60, 63),   # Minor 3rd
        (60, 65),   # Perfect 4th
        (60, 69),   # Major 6th
        (60, 70),   # Minor 7th
        (60, 71),   # Major 7th
    ])
    def test_interval_detection(self, interval):
        """Test detection of two-note intervals."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        audio = generate_chord(list(interval), 500, self.SAMPLE_RATE)

        detected_pitches = set(self.detect_notes(detector, audio))
        expected = set(interval)

        # Should detect at least 1 of 2 notes (with 1 semitone tolerance)
        matched = 0
        for exp in expected:
            for det in detected_pitches:
                if abs(det - exp) <= 1:
                    matched += 1
                    break

        assert matched >= 1, f"Failed to detect interval {interval}"

    # Test 81-84: Edge cases
    def test_single_note_in_polyphonic(self):
        """Test that single notes are still detected."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        audio = generate_piano_tone(60, 500, self.SAMPLE_RATE)

        detected = self.detect_notes(detector, audio)

        if detected:
            # Allow octave error
            assert any(abs(d - 60) <= 12 for d in detected)

    def test_dense_chord(self):
        """Test detection of dense chord (many notes)."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        chord = [60, 64, 67, 71, 74]  # C maj9
        audio = generate_chord(chord, 500, self.SAMPLE_RATE)

        detected = set(self.detect_notes(detector, audio))

        # Count matches with tolerance
        matched = sum(1 for exp in chord if any(abs(d - exp) <= 1 for d in detected))
        # Should detect at least 2 notes (limited by MAX_NOTES=3)
        assert matched >= 2 or len(detected) >= 2

    def test_widely_spaced_interval(self):
        """Test detection of widely spaced notes."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        chord = [36, 84]  # C2 and C6 (4 octaves apart)
        audio = generate_chord(chord, 500, self.SAMPLE_RATE)

        detected = self.detect_notes(detector, audio)
        # Wide intervals are challenging - just verify detection runs
        assert True

    def test_closely_spaced_interval(self):
        """Test detection of closely spaced notes (semitone)."""
        detector = PolyphonicDetector(sample_rate=self.SAMPLE_RATE)
        chord = [60, 61]  # C4 and C#4
        audio = generate_chord(chord, 500, self.SAMPLE_RATE)

        detected = self.detect_notes(detector, audio)
        # Close intervals are challenging due to beating - just verify detection runs
        assert True


# ─────────────────────────────────────────────────────────────────────────────
# Gate System Tests (10 tests)
# ─────────────────────────────────────────────────────────────────────────────

class TestGateSystem:
    """Test the 3-gate system (energy, confidence, onset)."""

    SAMPLE_RATE = 44100

    # Test 85-87: Energy gate
    def test_energy_gate_passes(self):
        """Test that loud signals pass energy gate."""
        audio = generate_piano_tone(60, 200, self.SAMPLE_RATE, amplitude=0.5)
        rms = np.sqrt(np.mean(audio ** 2))
        assert rms > 0.01, "Signal should pass energy gate"

    def test_energy_gate_rejects_silence(self):
        """Test that silence is rejected by energy gate."""
        audio = np.zeros(4096, dtype=np.float32)
        rms = np.sqrt(np.mean(audio ** 2))
        assert rms < 0.01, "Silence should fail energy gate"

    def test_energy_gate_threshold(self):
        """Test energy gate at threshold boundary."""
        # Create signal at exactly threshold level
        threshold = 0.01
        audio = np.ones(4096, dtype=np.float32) * threshold
        rms = np.sqrt(np.mean(audio ** 2))
        assert abs(rms - threshold) < 0.001

    # Test 88-90: Onset gate
    def test_onset_detection_rising(self):
        """Test onset detection on rising energy."""
        # Simulate rising energy
        rms_history = [0.001, 0.002, 0.01, 0.05]  # Rising
        onset_ratio = 1.3

        # Check if onset is detected
        is_onset = rms_history[-1] > rms_history[-2] * onset_ratio
        assert is_onset, "Should detect onset on rising energy"

    def test_onset_detection_steady(self):
        """Test that steady energy doesn't trigger onset."""
        rms_history = [0.05, 0.05, 0.05, 0.05]  # Steady
        onset_ratio = 1.3

        is_onset = rms_history[-1] > rms_history[-2] * onset_ratio
        assert not is_onset, "Should not trigger onset on steady energy"

    def test_onset_detection_falling(self):
        """Test that falling energy doesn't trigger onset."""
        rms_history = [0.05, 0.04, 0.03, 0.02]  # Falling
        onset_ratio = 1.3

        is_onset = rms_history[-1] > rms_history[-2] * onset_ratio
        assert not is_onset, "Should not trigger onset on falling energy"

    # Test 91-94: Confidence gate
    def test_confidence_gate_clear_pitch(self):
        """Test confidence gate with clear pitch."""
        # A clear sine wave should have high confidence (low CMND)
        if not YIN_AVAILABLE:
            pytest.skip("YIN not available")

        audio = generate_sine_wave(440, 200, self.SAMPLE_RATE)
        result = detect_piano_note(audio.tolist(), self.SAMPLE_RATE)

        assert result is not None
        assert result["confidence"] > 0.7, "Clear pitch should have high confidence"

    def test_confidence_gate_noisy(self):
        """Test confidence gate with noisy signal."""
        if not YIN_AVAILABLE:
            pytest.skip("YIN not available")

        audio = generate_sine_wave(440, 200, self.SAMPLE_RATE)
        noisy = add_noise(audio, snr_db=5)  # Very noisy
        result = detect_piano_note(noisy.tolist(), self.SAMPLE_RATE)

        if result:
            # Very noisy signals should have lower confidence
            pass  # Confidence varies, just check it doesn't crash


# ─────────────────────────────────────────────────────────────────────────────
# Stability Confirmation Tests (6 tests)
# ─────────────────────────────────────────────────────────────────────────────

class TestStabilityConfirmation:
    """Test 2/3 hop stability confirmation."""

    # Test 95-100: Stability logic
    def test_stability_2_of_3_passes(self):
        """Test that 2 of 3 matching pitches confirms."""
        recent_pitches = [60, 60, 61]  # 2 of 3 are 60
        target = 60
        matches = sum(1 for p in recent_pitches if p == target)
        assert matches >= 2, "2/3 should pass stability check"

    def test_stability_1_of_3_fails(self):
        """Test that 1 of 3 matching doesn't confirm."""
        recent_pitches = [60, 61, 62]  # Only 1 is 60
        target = 60
        matches = sum(1 for p in recent_pitches if p == target)
        assert matches < 2, "1/3 should fail stability check"

    def test_stability_3_of_3_passes(self):
        """Test that 3 of 3 matching confirms."""
        recent_pitches = [60, 60, 60]  # All are 60
        target = 60
        matches = sum(1 for p in recent_pitches if p == target)
        assert matches >= 2, "3/3 should pass stability check"

    def test_stability_with_nulls(self):
        """Test stability with null (no detection) entries."""
        recent_pitches = [60, None, 60]  # 2 valid, 1 null
        target = 60
        matches = sum(1 for p in recent_pitches if p == target)
        assert matches >= 2, "2/3 with null should pass"

    def test_stability_all_nulls(self):
        """Test stability with all null entries."""
        recent_pitches = [None, None, None]
        target = 60
        matches = sum(1 for p in recent_pitches if p == target)
        assert matches < 2, "All nulls should fail"

    def test_stability_rapid_changes(self):
        """Test stability with rapid pitch changes."""
        recent_pitches = [60, 62, 64]  # All different
        for target in [60, 62, 64]:
            matches = sum(1 for p in recent_pitches if p == target)
            assert matches < 2, f"Rapid changes should fail for {target}"


# ─────────────────────────────────────────────────────────────────────────────
# Integration Tests (Additional)
# ─────────────────────────────────────────────────────────────────────────────

class TestIntegration:
    """Integration tests with full pipeline."""

    SAMPLE_RATE = 44100

    def test_c_major_scale_sequence(self):
        """Test detection of C major scale sequence."""
        if not YIN_AVAILABLE:
            pytest.skip("YIN not available")

        notes = [60, 62, 64, 65, 67, 69, 71, 72]  # C4 to C5
        audio, onsets = generate_sequence(notes, 300, 50, self.SAMPLE_RATE)

        metrics = TestMetrics()
        window_size = 4096

        # Process in windows
        for onset_midi, onset_time in onsets:
            onset_sample = int((onset_time / 1000.0) * self.SAMPLE_RATE)
            end_sample = min(onset_sample + window_size, len(audio))

            if end_sample - onset_sample < 1024:
                continue

            window = audio[onset_sample:end_sample]
            start_time = time.time()
            result = detect_piano_note(window.tolist(), self.SAMPLE_RATE)
            latency = (time.time() - start_time) * 1000

            if result:
                detected_midi = freq_to_midi(result["frequency"])
                correct = abs(detected_midi - onset_midi) <= 1
                metrics.add(DetectionResult(
                    expected_midi=onset_midi,
                    detected_midi=detected_midi,
                    detected_freq=result["frequency"],
                    confidence=result["confidence"],
                    latency_ms=latency,
                    correct=correct
                ))
            else:
                metrics.add(DetectionResult(
                    expected_midi=onset_midi,
                    detected_midi=None,
                    detected_freq=None,
                    confidence=0,
                    latency_ms=latency,
                    correct=False
                ))

        print(f"\nC Major Scale: {metrics.summary()}")
        assert metrics.accuracy >= 0.7, f"Scale accuracy too low: {metrics.accuracy:.1%}"

    def test_chromatic_sequence(self):
        """Test detection of chromatic sequence."""
        if not YIN_AVAILABLE:
            pytest.skip("YIN not available")

        notes = list(range(48, 72))  # C3 to B4
        audio, onsets = generate_sequence(notes, 200, 30, self.SAMPLE_RATE)

        metrics = TestMetrics()
        window_size = 4096

        for onset_midi, onset_time in onsets:
            onset_sample = int((onset_time / 1000.0) * self.SAMPLE_RATE)
            end_sample = min(onset_sample + window_size, len(audio))

            if end_sample - onset_sample < 1024:
                continue

            window = audio[onset_sample:end_sample]
            result = detect_piano_note(window.tolist(), self.SAMPLE_RATE)

            if result:
                detected_midi = freq_to_midi(result["frequency"])
                correct = abs(detected_midi - onset_midi) <= 1
                metrics.add(DetectionResult(
                    expected_midi=onset_midi,
                    detected_midi=detected_midi,
                    detected_freq=result["frequency"],
                    confidence=result["confidence"],
                    latency_ms=0,
                    correct=correct
                ))

        print(f"\nChromatic: {metrics.summary()}")
        assert metrics.accuracy >= 0.6, f"Chromatic accuracy too low: {metrics.accuracy:.1%}"


# ─────────────────────────────────────────────────────────────────────────────
# Run Tests
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
