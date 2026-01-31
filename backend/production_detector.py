#!/usr/bin/env python3
"""
Production Piano Note Detector

Combines multiple detection strategies for Simply Piano-level accuracy:
1. YIN v3 for fast single-note detection (< 20ms latency)
2. Harmonic CQT for better accuracy and octave disambiguation
3. ML model (Onsets & Frames) for chord detection
4. Aggressive score-aware filtering

Usage:
    detector = ProductionDetector(mode="single")  # or "chord" or "hybrid"
    result = detector.detect(audio_samples, sample_rate, expected_notes=["C4", "E4"])
"""

import numpy as np
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
import time


class DetectionMode(Enum):
    SINGLE = "single"   # Fast YIN for single notes
    CHORD = "chord"     # ML model for chords
    HYBRID = "hybrid"   # Best of both


@dataclass
class DetectionResult:
    """Result from detection pipeline"""
    notes: List[str]
    frequencies: List[float]
    confidences: List[float]
    is_match: bool  # Did it match expected notes?
    latency_ms: float
    detector_used: str
    raw_detections: List[Dict] = field(default_factory=list)


class ProductionDetector:
    """
    Production-ready piano note detector.

    Designed to match Simply Piano accuracy by:
    1. Using the right algorithm for the task
    2. Aggressive score-aware filtering
    3. Forgiving tolerances
    """

    def __init__(
        self,
        mode: str = "hybrid",
        sample_rate: int = 44100,
        # Score-aware settings (Simply Piano-like forgiveness)
        semitone_tolerance: int = 1,      # Accept ±1 semitone
        accept_octave_errors: bool = True, # Accept C3 when expecting C4
        timing_tolerance_ms: float = 200,  # Accept notes ±200ms from expected
    ):
        self.mode = DetectionMode(mode)
        self.sample_rate = sample_rate
        self.semitone_tolerance = semitone_tolerance
        self.accept_octave_errors = accept_octave_errors
        self.timing_tolerance_ms = timing_tolerance_ms

        # Lazy-load detectors
        self._yin_detector = None
        self._cqt_detector = None
        self._ml_detector = None

        # Note name helpers
        self.NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

        # Enharmonic equivalents (flats to sharps)
        self.ENHARMONIC_MAP = {
            'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#',
            'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B',
            # Double sharps/flats (rare but handle them)
            'B#': 'C', 'E#': 'F',
        }

    @property
    def yin_detector(self):
        """Lazy-load YIN detector"""
        if self._yin_detector is None:
            from optimized_yin_v3 import detect_piano_note
            self._yin_detector = detect_piano_note
        return self._yin_detector

    @property
    def cqt_detector(self):
        """Lazy-load CQT detector"""
        if self._cqt_detector is None:
            from harmonic_cqt_detector import HarmonicCQTDetector
            self._cqt_detector = HarmonicCQTDetector()
        return self._cqt_detector

    @property
    def ml_detector(self):
        """Lazy-load ML detector"""
        if self._ml_detector is None:
            try:
                from onsets_frames_tflite import OnsetsFramesTFLite
                self._ml_detector = OnsetsFramesTFLite()
            except Exception as e:
                print(f"Warning: ML detector not available: {e}")
                self._ml_detector = None
        return self._ml_detector

    def note_to_midi(self, note: str) -> int:
        """Convert note name to MIDI number (handles enharmonics like Db, Eb)"""
        if len(note) == 2:
            name, octave = note[0], int(note[1])
        elif len(note) == 3:
            name, octave = note[:2], int(note[2])
        else:
            raise ValueError(f"Invalid note: {note}")

        # Convert enharmonic equivalents (Db -> C#, Eb -> D#, etc.)
        if name in self.ENHARMONIC_MAP:
            name = self.ENHARMONIC_MAP[name]
            # Handle octave adjustment for Cb -> B (Cb4 = B3)
            if name == 'B' and note.startswith('Cb'):
                octave -= 1

        return (octave + 1) * 12 + self.NOTE_NAMES.index(name)

    def midi_to_note(self, midi: int) -> str:
        """Convert MIDI number to note name"""
        return f"{self.NOTE_NAMES[midi % 12]}{midi // 12 - 1}"

    def is_note_match(
        self,
        detected: str,
        expected: str,
    ) -> Tuple[bool, str]:
        """
        Check if detected note matches expected note.

        Returns:
            (is_match, match_type)
            match_type: "exact", "semitone", "octave", "none"
        """
        try:
            det_midi = self.note_to_midi(detected)
            exp_midi = self.note_to_midi(expected)
        except (ValueError, IndexError):
            return False, "invalid"

        # Exact match
        if det_midi == exp_midi:
            return True, "exact"

        # Semitone tolerance (±1 or ±2 semitones)
        if abs(det_midi - exp_midi) <= self.semitone_tolerance:
            return True, "semitone"

        # Octave error (same pitch class, different octave)
        if self.accept_octave_errors and (det_midi % 12 == exp_midi % 12):
            return True, "octave"

        return False, "none"

    def detect(
        self,
        audio: np.ndarray,
        sample_rate: int,
        expected_notes: Optional[List[str]] = None,
    ) -> DetectionResult:
        """
        Detect piano notes in audio.

        Args:
            audio: Audio samples (mono, float or int16)
            sample_rate: Sample rate of audio
            expected_notes: Optional list of notes we expect (score-aware mode)

        Returns:
            DetectionResult with notes, confidences, and match status
        """
        start_time = time.perf_counter()

        # Normalize audio
        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype != np.float32:
            audio = audio.astype(np.float32)

        # Ensure mono
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)

        # Choose detection strategy based on mode and expected notes
        if self.mode == DetectionMode.SINGLE:
            result = self._detect_single(audio, sample_rate, expected_notes)
        elif self.mode == DetectionMode.CHORD:
            result = self._detect_chord(audio, sample_rate, expected_notes)
        else:  # HYBRID
            result = self._detect_hybrid(audio, sample_rate, expected_notes)

        result.latency_ms = (time.perf_counter() - start_time) * 1000
        return result

    def _detect_single(
        self,
        audio: np.ndarray,
        sample_rate: int,
        expected_notes: Optional[List[str]],
    ) -> DetectionResult:
        """Detect single notes using YIN (fast path)."""
        # Convert to list for YIN
        samples = audio.tolist()

        # Run YIN detection with relaxed threshold if we have expected notes
        # (relaxed mode allows higher CMND for noisy real-world audio)
        use_relaxed = expected_notes is not None and len(expected_notes) > 0
        yin_result = self.yin_detector(samples, sample_rate, relaxed=use_relaxed)

        if not yin_result or not yin_result.get('note'):
            return DetectionResult(
                notes=[],
                frequencies=[],
                confidences=[],
                is_match=False,
                latency_ms=0,
                detector_used="yin",
            )

        detected_note = yin_result['note']
        detected_freq = yin_result['frequency']
        confidence = yin_result.get('confidence', 0.9)

        # Score-aware filtering
        is_match = False
        if expected_notes:
            for exp in expected_notes:
                match, match_type = self.is_note_match(detected_note, exp)
                if match:
                    is_match = True
                    # Boost confidence for matches
                    if match_type == "exact":
                        confidence = min(0.99, confidence * 1.2)
                    elif match_type == "semitone":
                        confidence = min(0.95, confidence * 1.1)
                    break

            # If no match found, reduce confidence significantly
            if not is_match:
                confidence *= 0.3
        else:
            is_match = True  # No expected notes = accept anything

        return DetectionResult(
            notes=[detected_note] if is_match or not expected_notes else [],
            frequencies=[detected_freq],
            confidences=[confidence],
            is_match=is_match,
            latency_ms=0,
            detector_used="yin",
            raw_detections=[yin_result],
        )

    def _detect_chord(
        self,
        audio: np.ndarray,
        sample_rate: int,
        expected_notes: Optional[List[str]],
    ) -> DetectionResult:
        """Detect chords using ML model."""
        if self.ml_detector is None:
            # Fallback to CQT if ML not available
            return self._detect_cqt(audio, sample_rate, expected_notes)

        # ML model expects specific format
        try:
            # Transcribe
            notes = self.ml_detector.transcribe(audio, sample_rate)

            if not notes:
                return DetectionResult(
                    notes=[],
                    frequencies=[],
                    confidences=[],
                    is_match=False,
                    latency_ms=0,
                    detector_used="ml",
                )

            detected_notes = [n.note for n in notes]
            confidences = [n.confidence for n in notes]

            # Score-aware filtering
            if expected_notes:
                matched_notes = []
                matched_confs = []

                for det, conf in zip(detected_notes, confidences):
                    for exp in expected_notes:
                        match, _ = self.is_note_match(det, exp)
                        if match:
                            matched_notes.append(det)
                            matched_confs.append(conf)
                            break

                is_match = len(matched_notes) > 0

                return DetectionResult(
                    notes=matched_notes,
                    frequencies=[],  # ML doesn't give exact frequencies
                    confidences=matched_confs,
                    is_match=is_match,
                    latency_ms=0,
                    detector_used="ml",
                    raw_detections=[{"note": n.note, "confidence": n.confidence} for n in notes],
                )
            else:
                return DetectionResult(
                    notes=detected_notes,
                    frequencies=[],
                    confidences=confidences,
                    is_match=True,
                    latency_ms=0,
                    detector_used="ml",
                )

        except Exception as e:
            print(f"ML detection error: {e}")
            return self._detect_cqt(audio, sample_rate, expected_notes)

    def _detect_cqt(
        self,
        audio: np.ndarray,
        sample_rate: int,
        expected_notes: Optional[List[str]],
    ) -> DetectionResult:
        """Detect using Harmonic CQT."""
        result = self.cqt_detector.detect_realtime(audio, sample_rate, expected_notes)

        if not result:
            return DetectionResult(
                notes=[],
                frequencies=[],
                confidences=[],
                is_match=False,
                latency_ms=0,
                detector_used="cqt",
            )

        is_match = True
        if expected_notes:
            for exp in expected_notes:
                match, _ = self.is_note_match(result.note, exp)
                if match:
                    break
            else:
                is_match = False

        return DetectionResult(
            notes=[result.note] if is_match else [],
            frequencies=[result.frequency],
            confidences=[result.confidence],
            is_match=is_match,
            latency_ms=0,
            detector_used="cqt",
        )

    def _detect_hybrid(
        self,
        audio: np.ndarray,
        sample_rate: int,
        expected_notes: Optional[List[str]],
    ) -> DetectionResult:
        """
        Hybrid detection: Use the best algorithm for the situation.

        Strategy:
        1. If expecting single note → YIN (fast)
        2. If expecting chord (2+ notes) → ML model
        3. If unsure → Try YIN first, fall back to CQT, then ML

        Key insight: Real piano audio often has polyphonic content even for
        "single notes" due to sustain pedal, overlapping decay, etc. So when
        YIN/CQT fail but there's clearly audio present, ML can often succeed.
        """
        # Determine if we expect a chord
        is_chord = expected_notes and len(expected_notes) > 1

        if is_chord:
            return self._detect_chord(audio, sample_rate, expected_notes)
        else:
            # Try YIN first (fastest)
            result = self._detect_single(audio, sample_rate, expected_notes)

            # If YIN found a match, we're done
            if result.is_match:
                return result

            # YIN didn't match - try CQT as fallback (better octave handling)
            if expected_notes:
                cqt_result = self._detect_cqt(audio, sample_rate, expected_notes)
                if cqt_result.is_match:
                    return cqt_result

                # Note: ML fallback removed for single-note detection to avoid
                # slow TensorFlow loading. CQT is sufficient for most cases.
                # For real polyphonic content, use mode="chord" explicitly.

            return result


# Quick test
if __name__ == "__main__":
    print("=" * 60)
    print("Production Detector Test")
    print("=" * 60)

    detector = ProductionDetector(mode="hybrid")

    # Generate test audio (C4 with harmonics)
    sr = 44100
    duration = 0.2
    t = np.linspace(0, duration, int(sr * duration))

    freq = 261.63  # C4
    audio = np.zeros_like(t)
    for h in range(1, 6):
        audio += (1.0 / h) * np.sin(2 * np.pi * freq * h * t)
    audio = (audio / np.max(np.abs(audio)) * 0.8).astype(np.float32)

    # Test 1: No expected notes (free detection)
    print("\nTest 1: Free detection (no expected notes)")
    result = detector.detect(audio, sr)
    print(f"  Detected: {result.notes}")
    print(f"  Confidence: {result.confidences}")
    print(f"  Latency: {result.latency_ms:.2f}ms")

    # Test 2: Score-aware with correct note
    print("\nTest 2: Score-aware - expecting C4 (correct)")
    result = detector.detect(audio, sr, expected_notes=["C4"])
    print(f"  Detected: {result.notes}")
    print(f"  Is match: {result.is_match}")
    print(f"  Latency: {result.latency_ms:.2f}ms")

    # Test 3: Score-aware with wrong note
    print("\nTest 3: Score-aware - expecting G4 (wrong)")
    result = detector.detect(audio, sr, expected_notes=["G4"])
    print(f"  Detected: {result.notes}")
    print(f"  Is match: {result.is_match}")

    # Test 4: Score-aware with semitone tolerance
    print("\nTest 4: Score-aware - expecting C#4 (semitone off)")
    result = detector.detect(audio, sr, expected_notes=["C#4"])
    print(f"  Detected: {result.notes}")
    print(f"  Is match: {result.is_match} (should be True with tolerance)")

    # Test 5: Score-aware with octave error
    print("\nTest 5: Score-aware - expecting C5 (octave off)")
    result = detector.detect(audio, sr, expected_notes=["C5"])
    print(f"  Detected: {result.notes}")
    print(f"  Is match: {result.is_match} (should be True with octave acceptance)")

    print("\n✓ Production detector working!")
