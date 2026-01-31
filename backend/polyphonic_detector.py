"""
Polyphonic Pitch Detection using FFT-based multi-peak detection
Detects 2-3 simultaneous notes for chord recognition
"""

import numpy as np
from typing import List, Tuple, Optional
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
    is_chord: bool  # True if 2+ notes detected


class PolyphonicDetector:
    """
    Detects multiple simultaneous pitches using FFT peak detection.
    Optimized for 2-3 note piano chords.
    """

    # Piano frequency range (raised minimum to C3=130Hz for clean detection)
    # Use 65Hz (C2) only if bass notes are explicitly needed
    MIN_FREQUENCY = 130.0  # C3 - cleaner detection, fewer false positives
    MAX_FREQUENCY = 4186.0  # C8

    # Detection thresholds
    PEAK_THRESHOLD = 0.20  # Minimum magnitude relative to max peak (raised from 0.15)
    MIN_PEAK_DISTANCE_HZ = 30  # Minimum frequency separation between peaks
    MAX_NOTES = 3  # Maximum simultaneous notes to detect

    # Note names
    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate

    def frequency_to_note(self, freq: float) -> Tuple[str, int]:
        """Convert frequency to note name and octave"""
        if freq <= 0:
            return "?", 0

        # A4 = 440 Hz is our reference (MIDI note 69)
        midi_note = 12 * np.log2(freq / 440.0) + 69
        midi_note_rounded = int(round(midi_note))

        note_index = midi_note_rounded % 12
        octave = (midi_note_rounded // 12) - 1

        note_name = self.NOTE_NAMES[note_index]
        return note_name, octave

    def detect_peaks(self, fft_magnitudes: np.ndarray, fft_freqs: np.ndarray) -> List[Tuple[float, float]]:
        """
        Find peaks in FFT spectrum that likely correspond to musical notes.
        Returns list of (frequency, magnitude) tuples.
        """
        # Only consider piano range
        valid_range = (fft_freqs >= self.MIN_FREQUENCY) & (fft_freqs <= self.MAX_FREQUENCY)
        valid_magnitudes = fft_magnitudes[valid_range]
        valid_freqs = fft_freqs[valid_range]

        if len(valid_magnitudes) == 0:
            return []

        # Find peaks (local maxima)
        peaks = []
        max_magnitude = np.max(valid_magnitudes)
        threshold = max_magnitude * self.PEAK_THRESHOLD

        # Simple peak detection: compare each point with neighbors
        for i in range(1, len(valid_magnitudes) - 1):
            magnitude = valid_magnitudes[i]

            # Check if local maximum and above threshold
            if (magnitude > valid_magnitudes[i - 1] and
                magnitude > valid_magnitudes[i + 1] and
                magnitude >= threshold):

                frequency = valid_freqs[i]
                peaks.append((frequency, magnitude))

        # Sort by magnitude (descending)
        peaks.sort(key=lambda x: x[1], reverse=True)

        # Filter out harmonics and close frequencies
        filtered_peaks = []
        for freq, mag in peaks:
            # Check if this peak is too close to any already accepted peak
            too_close = False
            for accepted_freq, _ in filtered_peaks:
                # Check for harmonic relationship or proximity
                ratio = freq / accepted_freq if freq > accepted_freq else accepted_freq / freq

                # Skip if harmonic (2x, 3x, etc.) or too close in frequency
                if (abs(ratio - round(ratio)) < 0.05 or  # Harmonic
                    abs(freq - accepted_freq) < self.MIN_PEAK_DISTANCE_HZ):  # Too close
                    too_close = True
                    break

            if not too_close:
                filtered_peaks.append((freq, mag))

            # Stop after finding enough peaks
            if len(filtered_peaks) >= self.MAX_NOTES:
                break

        return filtered_peaks

    def detect_from_fft(self, audio_buffer: np.ndarray) -> ChordDetection:
        """
        Detect multiple pitches from audio buffer using FFT.

        Args:
            audio_buffer: Audio samples (mono)

        Returns:
            ChordDetection with all detected notes
        """
        # Apply windowing to reduce spectral leakage
        window = np.hanning(len(audio_buffer))
        windowed_buffer = audio_buffer * window

        # Compute FFT
        fft = np.fft.rfft(windowed_buffer)
        fft_magnitudes = np.abs(fft)
        fft_freqs = np.fft.rfftfreq(len(windowed_buffer), 1 / self.sample_rate)

        # Find peaks
        peaks = self.detect_peaks(fft_magnitudes, fft_freqs)

        # Convert peaks to notes
        detected_notes = []
        for freq, magnitude in peaks:
            note_name, octave = self.frequency_to_note(freq)
            full_note = f"{note_name}{octave}"

            # Estimate confidence based on magnitude
            max_magnitude = fft_magnitudes.max()
            confidence = min(magnitude / max_magnitude, 1.0)

            detected_notes.append(DetectedNote(
                note=full_note,
                frequency=freq,
                magnitude=magnitude,
                confidence=confidence
            ))

        # Sort by frequency (lowest to highest)
        detected_notes.sort(key=lambda x: x.frequency)

        return ChordDetection(
            notes=detected_notes,
            timestamp=0.0,  # Will be set by caller
            is_chord=len(detected_notes) >= 2
        )

    def detect_from_samples(self, samples: List[float]) -> ChordDetection:
        """
        Convenience method to detect from sample list.

        Args:
            samples: Audio samples as list

        Returns:
            ChordDetection result
        """
        audio_buffer = np.array(samples, dtype=np.float32)

        # Need minimum buffer size for FFT
        if len(audio_buffer) < 2048:
            return ChordDetection(notes=[], timestamp=0.0, is_chord=False)

        return self.detect_from_fft(audio_buffer)


# Example usage and testing
if __name__ == "__main__":
    import time

    # Test with synthesized chord (C4 + E4 + G4 = C major)
    sample_rate = 44100
    duration = 0.5
    t = np.linspace(0, duration, int(sample_rate * duration))

    # Frequencies for C major chord
    c4_freq = 261.63
    e4_freq = 329.63
    g4_freq = 392.00

    # Synthesize chord
    signal = (np.sin(2 * np.pi * c4_freq * t) +
              np.sin(2 * np.pi * e4_freq * t) +
              np.sin(2 * np.pi * g4_freq * t)) / 3.0

    # Detect
    detector = PolyphonicDetector(sample_rate)
    result = detector.detect_from_fft(signal)

    print(f"Detected {len(result.notes)} notes:")
    for note in result.notes:
        print(f"  {note.note} @ {note.frequency:.1f} Hz (confidence: {note.confidence:.2f})")

    print(f"Is chord: {result.is_chord}")
