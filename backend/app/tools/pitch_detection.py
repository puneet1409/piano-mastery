"""
Pitch detection for piano notes.

This module provides the analyze_audio_chunk function used by the WebSocket API.
It now uses the ProductionDetector (YIN v3 + CQT + score-aware matching) for
improved accuracy over the original simple autocorrelation approach.

The original autocorrelation implementation is kept as a fallback.
"""

import numpy as np
from typing import Tuple, Optional, List
import sys
import os

# Add backend root to path for importing production_detector
backend_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_root not in sys.path:
    sys.path.insert(0, backend_root)

# Lazy-loaded ProductionDetector instances by mode
_detectors = {}  # mode -> ProductionDetector instance
_detector_class = None
_detector_class_loaded = False

def _get_detector(mode: str = "single"):
    """
    Get ProductionDetector instance for the given mode.

    Modes:
    - "single": Fast YIN for single notes (default)
    - "hybrid": Best of both - YIN first, fallback to CQT/ML
    - "chord": ML model for chord detection
    """
    global _detectors, _detector_class, _detector_class_loaded

    # Try to load the ProductionDetector class once
    if not _detector_class_loaded:
        try:
            from production_detector import ProductionDetector
            _detector_class = ProductionDetector
            print("[pitch_detection] ProductionDetector class loaded")
        except Exception as e:
            print(f"[pitch_detection] ProductionDetector not available: {e}")
            print("[pitch_detection] Falling back to simple autocorrelation")
            _detector_class = None
        _detector_class_loaded = True

    if _detector_class is None:
        return None

    # Create detector for this mode if not cached
    if mode not in _detectors:
        try:
            _detectors[mode] = _detector_class(mode=mode)
            print(f"[pitch_detection] Created ProductionDetector(mode='{mode}')")
        except Exception as e:
            print(f"[pitch_detection] Failed to create detector mode={mode}: {e}")
            return None

    return _detectors[mode]


def _get_mode_for_notes(expected_notes: Optional[List[str]]) -> str:
    """
    Determine the best detection mode based on expected notes.

    - 0-1 notes: "single" (fast YIN)
    - 2+ notes: "hybrid" (YIN + CQT/ML fallback for chords)
    """
    if not expected_notes or len(expected_notes) <= 1:
        return "single"
    else:
        return "hybrid"

# Piano note frequencies (A0 = 27.5 Hz to C8 = 4186 Hz)
# MIDI note numbers: A0 = 21, C8 = 108
PIANO_NOTES = {
    'C': [16.35, 32.70, 65.41, 130.81, 261.63, 523.25, 1046.50, 2093.00, 4186.01],
    'C#': [17.32, 34.65, 69.30, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
    'D': [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.63],
    'D#': [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03],
    'E': [20.60, 41.20, 82.41, 164.81, 329.63, 659.25, 1318.51, 2637.02, 5274.04],
    'F': [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
    'F#': [23.12, 46.25, 92.50, 185.00, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
    'G': [24.50, 49.00, 98.00, 196.00, 392.00, 783.99, 1567.98, 3135.96, 6271.93],
    'G#': [25.96, 51.91, 103.83, 207.65, 415.30, 830.61, 1661.22, 3322.44, 6644.88],
    'A': [27.50, 55.00, 110.00, 220.00, 440.00, 880.00, 1760.00, 3520.00, 7040.00],
    'A#': [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
    'B': [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13],
}

# Minimum confidence threshold for valid pitch detection
MIN_CONFIDENCE = 0.3


def frequency_to_note(frequency: float) -> Optional[str]:
    """
    Convert a frequency (Hz) to the nearest piano note name.

    Args:
        frequency: Frequency in Hz

    Returns:
        Note name like "C4" or None if frequency is out of piano range
    """
    if frequency < 20 or frequency > 8000:  # Outside piano range
        return None

    min_diff = float('inf')
    closest_note = None

    for note_name, octave_frequencies in PIANO_NOTES.items():
        for octave, freq in enumerate(octave_frequencies):
            diff = abs(frequency - freq)
            if diff < min_diff:
                min_diff = diff
                closest_note = f"{note_name}{octave}"

    return closest_note


def autocorrelation(signal: np.ndarray) -> np.ndarray:
    """
    Compute autocorrelation of signal using FFT.

    Args:
        signal: Input signal

    Returns:
        Autocorrelation array
    """
    # Pad signal to power of 2 for efficient FFT
    n = len(signal)
    padded_size = 2 ** int(np.ceil(np.log2(2 * n - 1)))

    # FFT-based autocorrelation
    fft_signal = np.fft.fft(signal, n=padded_size)
    autocorr = np.fft.ifft(fft_signal * np.conj(fft_signal))

    # Return only the positive lags, normalized
    autocorr = np.real(autocorr[:n])
    if autocorr[0] > 0:
        autocorr = autocorr / autocorr[0]

    return autocorr


def detect_pitch(samples: np.ndarray, sample_rate: int = 44100) -> Tuple[float, float]:
    """
    Detect pitch (fundamental frequency) from audio samples using autocorrelation.

    Args:
        samples: Audio samples as numpy array (mono, float32)
        sample_rate: Sample rate in Hz

    Returns:
        Tuple of (pitch_hz, confidence)
        - pitch_hz: Detected frequency in Hz (0.0 if no pitch detected)
        - confidence: Confidence score 0.0-1.0
    """
    # Check for silence (RMS below threshold)
    rms = np.sqrt(np.mean(samples ** 2))
    if rms < 0.01:  # Silence threshold
        return 0.0, 0.0

    # Compute autocorrelation
    autocorr = autocorrelation(samples)

    # Define search range for piano notes (27.5 Hz to 4186 Hz)
    # Corresponding to periods in samples
    min_period = int(sample_rate / 4200.0)  # Highest note
    max_period = int(sample_rate / 20.0)    # Lowest note (with margin)

    # Limit search range to valid indices
    max_period = min(max_period, len(autocorr) - 1)

    if min_period >= max_period:
        return 0.0, 0.0

    # Find peaks in autocorrelation within valid range
    # Start from min_period to avoid the first peak at lag 0
    search_range = autocorr[min_period:max_period]

    if len(search_range) == 0:
        return 0.0, 0.0

    # Find the maximum peak
    peak_index = np.argmax(search_range)
    peak_value = search_range[peak_index]

    # Actual period is offset by min_period
    period = peak_index + min_period

    # Convert period to frequency
    if period > 0:
        pitch_hz = sample_rate / period
    else:
        return 0.0, 0.0

    # Confidence is the peak value (higher autocorrelation = more periodic = higher confidence)
    # Scale to 0-1 range
    confidence = float(peak_value)

    # Filter out weak detections
    if confidence < 0.3:
        return 0.0, 0.0

    return float(pitch_hz), float(confidence)


def analyze_audio_chunk(
    audio_data: bytes,
    sample_rate: int = 44100,
    dtype: str = 'float32',
    expected_notes: Optional[List[str]] = None
) -> dict:
    """
    Analyze an audio chunk and return pitch detection results.

    Uses ProductionDetector (YIN v3) when available, falls back to simple
    autocorrelation if not.

    Args:
        audio_data: Raw audio bytes
        sample_rate: Sample rate in Hz
        dtype: Data type of audio samples
        expected_notes: Optional list of expected notes for score-aware detection

    Returns:
        Dictionary with:
        - frequency: Detected frequency in Hz
        - note: Note name (e.g., "C4") or None
        - confidence: Confidence score 0.0-1.0
        - detected: Boolean indicating if valid pitch was detected
    """
    # Convert bytes to numpy array
    samples = np.frombuffer(audio_data, dtype=dtype)

    # Select detector mode based on expected notes count
    # - 1 note: "single" (fast YIN)
    # - 2+ notes: "hybrid" (YIN + CQT/ML for chords)
    mode = _get_mode_for_notes(expected_notes)
    detector = _get_detector(mode)
    if detector is not None:
        try:
            result = detector.detect(samples, sample_rate, expected_notes)
            if result.notes:
                return {
                    'frequency': round(result.frequencies[0], 2) if result.frequencies else 0.0,
                    'note': result.notes[0],
                    'confidence': round(result.confidences[0], 2) if result.confidences else 0.0,
                    'detected': True,
                    'detector': result.detector_used,
                    'latency_ms': round(result.latency_ms, 2)
                }
            else:
                return {
                    'frequency': 0.0,
                    'note': None,
                    'confidence': 0.0,
                    'detected': False,
                    'detector': result.detector_used,
                    'latency_ms': round(result.latency_ms, 2)
                }
        except Exception as e:
            # Fall through to autocorrelation fallback
            print(f"[pitch_detection] ProductionDetector error: {e}")

    # Fallback: simple autocorrelation
    pitch_hz, confidence = detect_pitch(samples, sample_rate)

    # Convert to note if confidence is high enough
    note = None
    detected = False

    if confidence >= MIN_CONFIDENCE and pitch_hz > 0:
        note = frequency_to_note(pitch_hz)
        detected = note is not None

    return {
        'frequency': round(pitch_hz, 2),
        'note': note,
        'confidence': round(confidence, 2),
        'detected': detected,
        'detector': 'autocorr'
    }
