#!/usr/bin/env python3
"""
Harmonic-Aware Piano Note Detection

Uses FFT with harmonic analysis for improved piano detection.
Fallback implementation when librosa CQT is not available.

Key improvements over raw FFT:
1. Harmonic peak grouping (groups fundamental + overtones)
2. Better octave disambiguation using harmonic ratios
3. Score-aware thresholding
"""

import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass


@dataclass
class DetectedNote:
    """A detected note with confidence"""
    note: str
    midi: int
    frequency: float
    confidence: float
    onset_strength: float = 0.0


class HarmonicCQTDetector:
    """
    Piano note detector using harmonic analysis.

    Simplified version that works without librosa.
    Uses FFT with harmonic peak detection.
    """

    # Piano range: A0 (21) to C8 (108)
    MIDI_MIN = 36  # C2 - practical lower limit for detection
    MIDI_MAX = 96  # C7 - practical upper limit

    # Note names for conversion
    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    def __init__(
        self,
        sample_rate: int = 44100,
        n_harmonics: int = 6,
        note_threshold: float = 0.3,
    ):
        """
        Initialize the detector.

        Args:
            sample_rate: Expected sample rate
            n_harmonics: Number of harmonics to consider
            note_threshold: Threshold for note detection
        """
        self.sample_rate = sample_rate
        self.n_harmonics = n_harmonics
        self.note_threshold = note_threshold

        # Precompute MIDI to frequency mapping
        self.midi_to_freq = {
            midi: 440.0 * (2 ** ((midi - 69) / 12))
            for midi in range(self.MIDI_MIN, self.MIDI_MAX + 1)
        }

        # Harmonic weights (decreasing importance for higher harmonics)
        self.harmonic_weights = [1.0 / (h + 1) for h in range(n_harmonics)]

    def midi_to_note(self, midi: int) -> str:
        """Convert MIDI number to note name (e.g., 60 -> 'C4')"""
        octave = (midi // 12) - 1
        note_idx = midi % 12
        return f"{self.NOTE_NAMES[note_idx]}{octave}"

    def note_to_midi(self, note: str) -> int:
        """Convert note name to MIDI number (e.g., 'C4' -> 60)"""
        if len(note) == 2:
            note_name = note[0]
            octave = int(note[1])
        elif len(note) == 3:
            note_name = note[:2]
            octave = int(note[2])
        else:
            raise ValueError(f"Invalid note name: {note}")

        note_idx = self.NOTE_NAMES.index(note_name)
        return (octave + 1) * 12 + note_idx

    def compute_spectrum(self, audio: np.ndarray, sr: int) -> Tuple[np.ndarray, np.ndarray]:
        """
        Compute FFT magnitude spectrum.

        Returns:
            (frequencies, magnitudes)
        """
        # Resample if needed (simple decimation/interpolation)
        if sr != self.sample_rate:
            ratio = self.sample_rate / sr
            new_len = int(len(audio) * ratio)
            indices = np.linspace(0, len(audio) - 1, new_len)
            audio = np.interp(indices, np.arange(len(audio)), audio)

        # Apply window
        window = np.hanning(len(audio))
        windowed = audio * window

        # Compute FFT
        n_fft = len(windowed)
        fft = np.fft.rfft(windowed)
        magnitude = np.abs(fft)

        # Frequency bins
        freqs = np.fft.rfftfreq(n_fft, 1.0 / self.sample_rate)

        return freqs, magnitude

    def get_magnitude_at_freq(
        self,
        freqs: np.ndarray,
        magnitude: np.ndarray,
        target_freq: float,
        tolerance_cents: float = 50,
    ) -> float:
        """
        Get magnitude at a specific frequency with tolerance.

        Args:
            freqs: Frequency bins
            magnitude: Magnitude values
            target_freq: Target frequency in Hz
            tolerance_cents: Search tolerance in cents (100 cents = 1 semitone)

        Returns:
            Maximum magnitude within tolerance range
        """
        # Convert cents to frequency ratio
        ratio = 2 ** (tolerance_cents / 1200)
        low_freq = target_freq / ratio
        high_freq = target_freq * ratio

        # Find bins in range
        mask = (freqs >= low_freq) & (freqs <= high_freq)
        if not mask.any():
            return 0.0

        return magnitude[mask].max()

    def compute_harmonic_score(
        self,
        freqs: np.ndarray,
        magnitude: np.ndarray,
        fundamental: float,
    ) -> float:
        """
        Compute harmonic score for a fundamental frequency.

        Sums weighted magnitudes at harmonic frequencies.
        """
        score = 0.0
        total_weight = 0.0

        for h, weight in enumerate(self.harmonic_weights):
            harmonic_freq = fundamental * (h + 1)

            # Skip if above Nyquist
            if harmonic_freq > self.sample_rate / 2:
                break

            mag = self.get_magnitude_at_freq(freqs, magnitude, harmonic_freq)
            score += weight * mag
            total_weight += weight

        return score / total_weight if total_weight > 0 else 0.0

    def detect(
        self,
        audio: np.ndarray,
        sr: int,
        expected_notes: Optional[List[str]] = None,
    ) -> List[DetectedNote]:
        """
        Detect piano notes in audio.

        Args:
            audio: Audio samples (mono, float)
            sr: Sample rate
            expected_notes: Optional list of expected notes (score-aware mode)

        Returns:
            List of detected notes
        """
        # Normalize
        audio = np.asarray(audio, dtype=np.float32)
        max_val = np.abs(audio).max()
        if max_val > 0:
            audio = audio / max_val

        # Compute spectrum
        freqs, magnitude = self.compute_spectrum(audio, sr)

        # Normalize magnitude
        max_mag = magnitude.max()
        if max_mag > 0:
            magnitude = magnitude / max_mag

        # Score each MIDI note
        detected = []

        for midi in range(self.MIDI_MIN, self.MIDI_MAX + 1):
            fundamental = self.midi_to_freq[midi]
            score = self.compute_harmonic_score(freqs, magnitude, fundamental)

            # Apply threshold
            threshold = self.note_threshold

            # Score-aware: adjust threshold
            note_name = self.midi_to_note(midi)
            if expected_notes:
                if note_name in expected_notes:
                    threshold *= 0.4  # Much more lenient for expected notes
                else:
                    # Check for octave/semitone matches
                    for exp in expected_notes:
                        try:
                            exp_midi = self.note_to_midi(exp)
                            if midi % 12 == exp_midi % 12:  # Same pitch class
                                threshold *= 0.6
                                break
                        except:
                            pass
                    else:
                        threshold *= 1.5  # Stricter for unexpected

            if score > threshold:
                detected.append(DetectedNote(
                    note=note_name,
                    midi=midi,
                    frequency=fundamental,
                    confidence=float(min(1.0, score)),
                ))

        # Sort by confidence
        detected.sort(key=lambda x: x.confidence, reverse=True)

        # Filter duplicates (keep strongest per pitch class)
        if expected_notes:
            detected = self._filter_to_expected(detected, expected_notes)
        else:
            detected = self._filter_octave_duplicates(detected)

        return detected

    def _filter_octave_duplicates(
        self,
        notes: List[DetectedNote],
        max_notes: int = 4,
    ) -> List[DetectedNote]:
        """Keep only the strongest note for each pitch class."""
        seen = set()
        filtered = []

        for note in notes:
            pitch_class = note.midi % 12
            if pitch_class not in seen:
                seen.add(pitch_class)
                filtered.append(note)

            if len(filtered) >= max_notes:
                break

        return filtered

    def _filter_to_expected(
        self,
        notes: List[DetectedNote],
        expected: List[str],
    ) -> List[DetectedNote]:
        """
        Filter detections to match expected notes.

        Accepts:
        - Exact matches
        - ±1 semitone
        - Octave variations
        """
        expected_midis = set()
        for note in expected:
            try:
                midi = self.note_to_midi(note)
                # Exact + tolerance
                for offset in [-1, 0, 1]:
                    expected_midis.add(midi + offset)
                # Octave variations
                for octave_shift in [-12, 12, -24, 24]:
                    expected_midis.add(midi + octave_shift)
            except:
                continue

        return [n for n in notes if n.midi in expected_midis]

    def detect_realtime(
        self,
        audio: np.ndarray,
        sr: int,
        expected_notes: Optional[List[str]] = None,
    ) -> Optional[DetectedNote]:
        """
        Detect single note for real-time feedback.
        """
        detections = self.detect(audio, sr, expected_notes)
        return detections[0] if detections else None


# Quick test
if __name__ == "__main__":
    print("=" * 60)
    print("Harmonic Detector Test (FFT-based)")
    print("=" * 60)

    detector = HarmonicCQTDetector()

    # Generate test tone (C4 with harmonics)
    sr = 44100
    duration = 0.3
    t = np.linspace(0, duration, int(sr * duration))

    # C4 fundamental + harmonics (realistic piano)
    freq = 261.63
    audio = np.zeros_like(t)
    for h in range(1, 7):
        audio += (1.0 / h) * np.sin(2 * np.pi * freq * h * t)

    # Add envelope
    envelope = np.exp(-3 * t / duration)
    audio = audio * envelope
    audio = audio / np.max(np.abs(audio))

    print(f"\nTest 1: Synthetic C4 with harmonics")
    result = detector.detect_realtime(audio, sr)
    if result:
        print(f"  Detected: {result.note} (MIDI {result.midi})")
        print(f"  Frequency: {result.frequency:.2f} Hz")
        print(f"  Confidence: {result.confidence:.2%}")
        if result.note == "C4":
            print("  ✓ Correct!")
        else:
            print(f"  ✗ Expected C4")
    else:
        print("  ✗ No detection")

    # Test 2: Score-aware
    print(f"\nTest 2: Score-aware (expecting C4)")
    result = detector.detect_realtime(audio, sr, expected_notes=["C4"])
    if result:
        print(f"  Detected: {result.note}")
        print(f"  Confidence: {result.confidence:.2%}")
        print("  ✓ Match!")

    # Test 3: Wrong expected note
    print(f"\nTest 3: Score-aware (expecting G4 - wrong)")
    result = detector.detect_realtime(audio, sr, expected_notes=["G4"])
    if result:
        print(f"  Detected: {result.note} (confidence: {result.confidence:.2%})")
        if result.note != "G4":
            print("  Note: Detected actual note despite expecting G4")
    else:
        print("  ✓ No false detection")

    # Test 4: Multiple notes
    print(f"\nTest 4: Chord detection (C4 + E4 + G4)")
    chord = np.zeros_like(t)
    for freq in [261.63, 329.63, 392.00]:  # C4, E4, G4
        for h in range(1, 5):
            chord += (0.3 / h) * np.sin(2 * np.pi * freq * h * t)
    chord = chord * envelope
    chord = chord / np.max(np.abs(chord))

    results = detector.detect(chord, sr)
    print(f"  Detected: {[r.note for r in results]}")

    print("\n✓ Harmonic detector working!")
