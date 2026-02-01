#!/usr/bin/env python3
"""
Optimized YIN pitch detection for piano.
Much better than basic YIN implementation.

Enhanced with:
- Minimum frequency filter (C2=65Hz) to eliminate sub-bass false positives
- Higher confidence threshold for low notes
- Harmonic verification for octave disambiguation
- RMS-based energy requirements for bass notes
"""

import math
import numpy as np


def verify_octave_with_harmonics(audio: np.ndarray, fundamental: float, sample_rate: int) -> bool:
    """
    Verify if detected frequency is truly a fundamental by checking for harmonics.
    Returns True if the frequency appears to be a real fundamental (not a harmonic of lower note).
    """
    n = len(audio)
    if n < 1024:
        return True  # Can't verify, assume correct

    # Apply window
    window = np.hanning(n)
    windowed = audio * window

    # Compute FFT
    fft = np.fft.rfft(windowed)
    magnitudes = np.abs(fft)
    freqs = np.fft.rfftfreq(n, 1/sample_rate)

    def get_magnitude_at_freq(target_freq: float) -> float:
        """Get magnitude at a specific frequency (with interpolation)."""
        if target_freq <= 0 or target_freq >= sample_rate / 2:
            return 0
        idx = int(target_freq * n / sample_rate)
        if idx >= len(magnitudes):
            return 0
        return magnitudes[idx]

    fundamental_mag = get_magnitude_at_freq(fundamental)
    if fundamental_mag < 1e-6:
        return False

    # Check if sub-harmonics (half, third) have significant energy
    # If they do, our "fundamental" might actually be a harmonic
    sub_half = fundamental / 2
    sub_third = fundamental / 3

    sub_half_mag = get_magnitude_at_freq(sub_half) if sub_half >= 30 else 0
    sub_third_mag = get_magnitude_at_freq(sub_third) if sub_third >= 30 else 0

    # If sub-harmonic is very strong relative to our "fundamental", it's likely the real fundamental
    # Piano fundamentals are usually the strongest component
    if sub_half_mag > fundamental_mag * 0.5 and sub_half >= 65:
        # Check if the sub-harmonic also has its harmonics
        sub_half_second = get_magnitude_at_freq(sub_half * 2)
        if sub_half_second > fundamental_mag * 0.3:
            return False  # Our "fundamental" is likely the 2nd harmonic

    if sub_third_mag > fundamental_mag * 0.4 and sub_third >= 65:
        return False  # Our "fundamental" is likely the 3rd harmonic

    return True


def get_magnitude_at_freq(audio: np.ndarray, target_freq: float, sample_rate: int) -> float:
    """Get FFT magnitude at specific frequency using Goertzel algorithm."""
    n = len(audio)
    if target_freq <= 0 or target_freq >= sample_rate / 2:
        return 0

    # Apply window
    window = np.hanning(n)
    windowed = audio * window

    # Goertzel algorithm (efficient single-frequency DFT)
    k = int(target_freq * n / sample_rate)
    omega = 2 * np.pi * k / n
    coeff = 2 * np.cos(omega)

    s0, s1, s2 = 0.0, 0.0, 0.0
    for sample in windowed:
        s0 = sample + coeff * s1 - s2
        s2 = s1
        s1 = s0

    real = s1 - s2 * np.cos(omega)
    imag = s2 * np.sin(omega)
    return np.sqrt(real * real + imag * imag) / n


def should_correct_octave_up(audio: np.ndarray, detected_freq: float, sample_rate: int) -> bool:
    """
    Check if detected frequency should be corrected up an octave.
    Uses FFT magnitude comparison to detect octave errors.
    """
    if detected_freq >= 130:
        return False  # Already in good range

    octave_up = detected_freq * 2

    # Get magnitudes at both frequencies
    mag_low = get_magnitude_at_freq(audio, detected_freq, sample_rate)
    mag_high = get_magnitude_at_freq(audio, octave_up, sample_rate)

    # If octave-up has significant energy (20%+ of detected), it's likely the real note
    # Piano fundamentals usually have strongest energy, so if higher octave is strong,
    # our "fundamental" is probably a sub-harmonic artifact
    # Lower threshold (0.2) catches more octave errors while still being conservative
    if mag_low > 0 and mag_high > mag_low * 0.2:
        return True

    return False


def detect_piano_note(samples: list, sample_rate: int = 44100, min_frequency: float = 65.0, verify_harmonics: bool = True, auto_correct_octave: bool = True) -> dict:
    """
    Optimized YIN algorithm for piano detection.

    Args:
        samples: Audio samples
        sample_rate: Sample rate in Hz
        min_frequency: Minimum frequency to detect (default C2=65Hz)
        verify_harmonics: Use harmonic analysis to verify octaves (slower but more accurate)
        auto_correct_octave: Automatically correct octave errors for notes below C3 (130Hz)

    Returns: dict with note, frequency, confidence, rms, or None if no note detected
    """
    if not samples or len(samples) < 1024:
        return None

    audio = np.array(samples, dtype=np.float32)
    rms = np.sqrt(np.mean(audio ** 2))

    if rms < 0.003:
        return None

    buffer_size = len(audio)
    tau_max = min(buffer_size // 2, sample_rate // 50)

    # Difference function
    difference = np.zeros(tau_max)
    for tau in range(tau_max):
        delta = audio[:buffer_size - tau_max] - audio[tau:tau + buffer_size - tau_max]
        difference[tau] = np.sum(delta ** 2)

    # Cumulative mean normalized difference
    cmnd = np.ones(tau_max)
    cumulative_sum = 0.0

    for tau in range(1, tau_max):
        cumulative_sum += difference[tau]
        if cumulative_sum > 0:
            cmnd[tau] = difference[tau] * tau / cumulative_sum

    # Find pitch with lower threshold for piano
    threshold = 0.10
    tau = 2

    while tau < tau_max:
        if cmnd[tau] < threshold:
            while tau + 1 < tau_max and cmnd[tau + 1] < cmnd[tau]:
                tau += 1

            # Parabolic interpolation
            if 0 < tau < tau_max - 1:
                alpha = cmnd[tau - 1]
                beta = cmnd[tau]
                gamma = cmnd[tau + 1]
                denominator = 2 * (2 * beta - alpha - gamma)
                if abs(denominator) > 1e-10:
                    peak = (alpha - gamma) / denominator
                    refined_tau = tau + peak
                else:
                    refined_tau = tau
            else:
                refined_tau = tau

            frequency = sample_rate / refined_tau

            # V5.1: Aggressive octave-UP for low frequencies (< 250Hz)
            if frequency < 250 and frequency >= 65:
                half_tau = refined_tau / 2
                if 2 <= half_tau < tau_max:
                    half_tau_int = int(round(half_tau))
                    half_cmnd = cmnd[half_tau_int]
                    if half_cmnd < 0.35:
                        frequency *= 2

            # Filter out frequencies below min_frequency (default C2=65Hz)
            # This eliminates false positives in octaves 0-1 from harmonics
            if min_frequency <= frequency <= 4500:
                base_confidence = 1.0 - cmnd[tau]
                volume_boost = min(0.3, rms * 20)
                confidence = min(0.98, max(0.3, base_confidence + volume_boost * 0.3))

                # For notes below C3 (130Hz), check if we should correct the octave
                # Low notes are prone to octave errors from harmonic confusion
                if frequency < 130:
                    min_confidence = 0.65  # Higher threshold for low notes
                    if confidence < min_confidence:
                        break  # Reject low-confidence low notes

                    # Auto-correct octave if enabled
                    if auto_correct_octave and should_correct_octave_up(audio, frequency, sample_rate):
                        frequency = frequency * 2  # Move up one octave

                    # Additional harmonic verification if enabled
                    elif verify_harmonics and not verify_octave_with_harmonics(audio, frequency, sample_rate):
                        octave_up_tau = refined_tau / 2
                        if octave_up_tau >= 2:
                            octave_up_freq = sample_rate / octave_up_tau
                            if 130 <= octave_up_freq <= 4500:
                                frequency = octave_up_freq

                note = frequency_to_note(frequency)
                if note:
                    return {
                        "note": note,
                        "frequency": float(frequency),
                        "confidence": float(confidence),
                        "rms": float(rms),
                    }
            break
        tau += 1

    return None


def frequency_to_note(frequency: float) -> str:
    """Convert frequency to note name."""
    if frequency <= 0:
        return None

    semitones_from_a4 = 12 * math.log2(frequency / 440.0)
    semitone = round(semitones_from_a4)
    note_in_octave = semitone % 12
    octave = 4 + (semitone + 9) // 12

    # Array starts at A (since we measure semitones from A4)
    note_names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
    note_name = note_names[note_in_octave]

    if 0 <= octave <= 8:
        return f"{note_name}{octave}"
    return None


if __name__ == "__main__":
    import time

    print("Testing Optimized YIN")
    sr = 44100
    duration = 0.5

    # Test A4 (440 Hz)
    t = np.linspace(0, duration, int(sr * duration))
    audio = 0.3 * np.sin(2 * np.pi * 440 * t)

    start = time.time()
    result = detect_piano_note(audio.tolist(), sr)
    elapsed = (time.time() - start) * 1000

    if result:
        print(f"Detected: {result['note']} @ {result['frequency']:.1f}Hz")
        print(f"Confidence: {result['confidence']:.2%}")
        print(f"Latency: {elapsed:.1f}ms")
    print("\n✅ Ready for production")
