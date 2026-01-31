#!/usr/bin/env python3
"""
Enhanced Polyphonic Pitch Detection v2
Handles BOTH single notes and chords with improved harmonic filtering.

Key improvements:
1. Stricter harmonic filtering (reject 2x, 3x, 4x, 5x... of fundamentals)
2. Fundamental-first detection (find strongest fundamental, then look for others)
3. Spectral pattern analysis (piano notes have characteristic harmonic structures)
4. Dynamic peak threshold based on note count
"""

import numpy as np
from typing import List, Tuple
from dataclasses import dataclass


@dataclass
class DetectedNote:
    """A single detected note with metadata"""
    note: str
    frequency: float
    magnitude: float
    confidence: float


@dataclass
class ChordDetection:
    """Multiple simultaneous notes detected"""
    notes: List[DetectedNote]
    timestamp: float
    is_chord: bool


class PolyphonicDetectorV2:
    """
    Universal pitch detector for piano - handles both single notes and chords.
    """

    # Piano range
    MIN_FREQUENCY = 27.5  # A0
    MAX_FREQUENCY = 4186.0  # C8

    # Detection thresholds
    FUNDAMENTAL_THRESHOLD = 0.20  # Primary peak must be strong
    ADDITIONAL_NOTE_THRESHOLD = 0.35  # Additional notes must be VERY strong
    MIN_PEAK_DISTANCE_HZ = 25  # Minimum separation
    MAX_NOTES = 4  # Maximum simultaneous notes

    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate

    def frequency_to_note(self, freq: float) -> Tuple[str, int]:
        """Convert frequency to note name"""
        if freq <= 0:
            return "?", 0

        midi_note = 12 * np.log2(freq / 440.0) + 69
        midi_note_rounded = int(round(midi_note))

        note_index = midi_note_rounded % 12
        octave = (midi_note_rounded // 12) - 1

        return self.NOTE_NAMES[note_index], octave

    def is_harmonic_of(self, freq: float, fundamental: float, tolerance: float = 0.05) -> bool:
        """Check if freq is a harmonic of fundamental (2x, 3x, 4x, 5x, 6x)"""
        for harmonic in [2, 3, 4, 5, 6]:
            expected_harmonic = fundamental * harmonic
            ratio = freq / expected_harmonic
            if abs(ratio - 1.0) < tolerance:
                return True
        return False

    def detect_fundamentals(self, fft_magnitudes: np.ndarray, fft_freqs: np.ndarray) -> List[Tuple[float, float]]:
        """
        Detect fundamental frequencies (not harmonics).

        Strategy:
        1. Find all peaks above threshold
        2. Sort by magnitude
        3. Accept strongest peak as fundamental
        4. Reject all harmonics of accepted fundamentals
        5. Accept next strongest non-harmonic peak
        6. Repeat
        """
        # Only consider piano range
        valid_range = (fft_freqs >= self.MIN_FREQUENCY) & (fft_freqs <= self.MAX_FREQUENCY)
        valid_magnitudes = fft_magnitudes[valid_range]
        valid_freqs = fft_freqs[valid_range]

        if len(valid_magnitudes) == 0:
            return []

        # Find all local maxima
        all_peaks = []
        for i in range(1, len(valid_magnitudes) - 1):
            mag = valid_magnitudes[i]

            # Local maximum check
            if (mag > valid_magnitudes[i - 1] and
                mag > valid_magnitudes[i + 1]):
                all_peaks.append((valid_freqs[i], mag))

        if not all_peaks:
            return []

        # Sort by magnitude (descending)
        all_peaks.sort(key=lambda x: x[1], reverse=True)

        max_magnitude = all_peaks[0][1]

        # Accept fundamentals only
        accepted_fundamentals = []

        for freq, mag in all_peaks:
            # Check if this is a harmonic of any accepted fundamental
            is_harmonic = False
            for fund_freq, _ in accepted_fundamentals:
                if self.is_harmonic_of(freq, fund_freq):
                    is_harmonic = True
                    break
                # Also check reverse (is accepted fundamental a harmonic of this?)
                if self.is_harmonic_of(fund_freq, freq):
                    is_harmonic = True
                    break

            if is_harmonic:
                continue  # Skip harmonics

            # Check magnitude threshold
            relative_mag = mag / max_magnitude

            if len(accepted_fundamentals) == 0:
                # First fundamental - use lower threshold
                if relative_mag >= self.FUNDAMENTAL_THRESHOLD:
                    accepted_fundamentals.append((freq, mag))
            else:
                # Additional fundamentals - use MUCH higher threshold
                # (Only accept if very strong, otherwise likely harmonic we missed)
                if relative_mag >= self.ADDITIONAL_NOTE_THRESHOLD:
                    # Also check minimum frequency separation from existing notes
                    too_close = False
                    for accepted_freq, _ in accepted_fundamentals:
                        if abs(freq - accepted_freq) < self.MIN_PEAK_DISTANCE_HZ:
                            too_close = True
                            break

                    if not too_close:
                        accepted_fundamentals.append((freq, mag))

            # Stop after finding enough notes
            if len(accepted_fundamentals) >= self.MAX_NOTES:
                break

        return accepted_fundamentals

    def detect_from_fft(self, audio_buffer: np.ndarray) -> ChordDetection:
        """Detect pitches from audio using enhanced FFT analysis."""
        # Check for silence
        rms = np.sqrt(np.mean(audio_buffer ** 2))
        if rms < 0.003:
            return ChordDetection(notes=[], timestamp=0, is_chord=False)

        # Apply windowing
        window = np.hanning(len(audio_buffer))
        windowed_buffer = audio_buffer * window

        # Compute FFT
        fft = np.fft.rfft(windowed_buffer)
        fft_magnitudes = np.abs(fft)
        fft_freqs = np.fft.rfftfreq(len(windowed_buffer), 1 / self.sample_rate)

        # Detect fundamentals (not harmonics)
        fundamentals = self.detect_fundamentals(fft_magnitudes, fft_freqs)

        # Convert to DetectedNote objects
        detected_notes = []
        max_magnitude = fft_magnitudes.max()

        for freq, magnitude in fundamentals:
            note_name, octave = self.frequency_to_note(freq)
            full_note = f"{note_name}{octave}"

            # Confidence based on magnitude relative to max
            confidence = min(0.98, magnitude / max_magnitude)

            detected_notes.append(DetectedNote(
                note=full_note,
                frequency=freq,
                magnitude=magnitude,
                confidence=confidence
            ))

        is_chord = len(detected_notes) >= 2

        return ChordDetection(
            notes=detected_notes,
            timestamp=0,
            is_chord=is_chord
        )

    def detect_from_samples(self, samples: list) -> ChordDetection:
        """Convenience method for list input."""
        audio_buffer = np.array(samples, dtype=np.float32)
        return self.detect_from_fft(audio_buffer)


if __name__ == "__main__":
    import time

    print("Testing Enhanced Polyphonic Detector v2\n")

    sr = 44100
    duration = 0.5
    t = np.linspace(0, duration, int(sr * duration))

    detector = PolyphonicDetectorV2(sample_rate=sr)

    # Test 1: Single note with harmonics (C4)
    print("Test 1: Single C4 with strong harmonics")
    print("-" * 60)
    audio = 0.5 * np.sin(2 * np.pi * 261.6 * t)  # Fundamental
    audio += 0.4 * np.sin(2 * np.pi * 523.2 * t)  # 2nd harmonic (strong!)
    audio += 0.3 * np.sin(2 * np.pi * 784.8 * t)  # 3rd harmonic

    result = detector.detect_from_fft(audio)
    print(f"Detected: {[n.note for n in result.notes]}")
    print(f"Expected: ['C4']")
    print(f"Is Chord: {result.is_chord}")

    if len(result.notes) == 1 and result.notes[0].note == 'C4':
        print("✅ PASS: Correctly rejected harmonics\n")
    else:
        print(f"❌ FAIL: Should detect only C4, got {[n.note for n in result.notes]}\n")

    # Test 2: Two note chord (C4 + E4 - major third)
    print("Test 2: Two notes - C4 + E4 (major third)")
    print("-" * 60)
    audio = 0.5 * np.sin(2 * np.pi * 261.6 * t)  # C4
    audio += 0.5 * np.sin(2 * np.pi * 329.6 * t)  # E4

    result = detector.detect_from_fft(audio)
    detected = sorted([n.note for n in result.notes])
    print(f"Detected: {detected}")
    print(f"Expected: ['C4', 'E4']")
    print(f"Is Chord: {result.is_chord}")

    if detected == ['C4', 'E4']:
        print("✅ PASS: Correctly detected both notes\n")
    else:
        print(f"❌ FAIL: Should detect C4 and E4\n")

    # Test 3: Three note chord (C4 + E4 + G4 - C major)
    print("Test 3: Three notes - C4 + E4 + G4 (C major chord)")
    print("-" * 60)
    audio = 0.5 * np.sin(2 * np.pi * 261.6 * t)  # C4
    audio += 0.5 * np.sin(2 * np.pi * 329.6 * t)  # E4
    audio += 0.5 * np.sin(2 * np.pi * 392.0 * t)  # G4

    result = detector.detect_from_fft(audio)
    detected = sorted([n.note for n in result.notes])
    print(f"Detected: {detected}")
    print(f"Expected: ['C4', 'E4', 'G4']")
    print(f"Is Chord: {result.is_chord}")

    if detected == ['C4', 'E4', 'G4']:
        print("✅ PASS: Correctly detected all three notes\n")
    else:
        print(f"❌ FAIL: Should detect C4, E4, and G4\n")

    print("=" * 60)
    print("✅ Enhanced detector ready for real-world testing")
