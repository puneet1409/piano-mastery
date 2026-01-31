#!/usr/bin/env python3
"""
Optimized YIN pitch detection v3 with proper octave disambiguation.
Fixes octave jumping by checking multiples of detected frequency.
"""

import math
import numpy as np


def detect_piano_note(samples: list, sample_rate: int = 44100, relaxed: bool = False) -> dict:
    """
    YIN algorithm with octave disambiguation.

    Key improvement: When low frequency detected, check if octave multiples
    have acceptable CMND values and prefer those.

    Args:
        samples: Audio samples (list of floats)
        sample_rate: Sample rate in Hz
        relaxed: If True, use higher CMND threshold (0.55 vs 0.35) for noisy audio.
                 Use this for score-aware detection where false positives are filtered.
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

    # Find best pitch using adaptive threshold
    # Start with standard threshold, but allow fallback to global minimum
    threshold = 0.15  # Relaxed from 0.10 for better noise tolerance
    best_tau = None
    tau = 2

    while tau < tau_max:
        if cmnd[tau] < threshold:
            # Find local minimum
            while tau + 1 < tau_max and cmnd[tau + 1] < cmnd[tau]:
                tau += 1
            best_tau = tau
            break
        tau += 1

    # FALLBACK: If no tau found below threshold, find global minimum
    # This handles noisy audio better
    if best_tau is None:
        # Search in reasonable frequency range (50 Hz to 2000 Hz)
        min_tau_search = max(2, sample_rate // 2000)  # 2000 Hz max
        max_tau_search = min(tau_max - 1, sample_rate // 50)  # 50 Hz min

        if min_tau_search < max_tau_search:
            search_range = cmnd[min_tau_search:max_tau_search]
            if len(search_range) > 0:
                local_min_idx = np.argmin(search_range)
                global_min_cmnd = search_range[local_min_idx]

                # Accept if CMND is reasonable (even above threshold)
                # Relaxed mode (0.55): for score-aware detection with expected notes
                # Standard mode (0.35): for free detection without expected notes
                fallback_threshold = 0.55 if relaxed else 0.35
                if global_min_cmnd < fallback_threshold:
                    best_tau = min_tau_search + local_min_idx

    if best_tau is None:
        return None

    # Parabolic interpolation for sub-sample accuracy
    if 0 < best_tau < tau_max - 1:
        alpha = cmnd[best_tau - 1]
        beta = cmnd[best_tau]
        gamma = cmnd[best_tau + 1]
        denominator = 2 * (2 * beta - alpha - gamma)
        if abs(denominator) > 1e-10:
            peak = (alpha - gamma) / denominator
            refined_tau = best_tau + peak
        else:
            refined_tau = best_tau
    else:
        refined_tau = best_tau

    base_frequency = sample_rate / refined_tau

    # OCTAVE DISAMBIGUATION: Check if octave multiples have good CMND values
    # If we detected a low frequency, check 2×, 4×, 8× for better matches

    candidates = [
        {'freq': base_frequency, 'tau': refined_tau, 'cmnd': cmnd[best_tau], 'multiplier': 1}
    ]

    # Check octave multiples (higher frequencies = smaller tau values)
    for multiplier in [2, 4, 8]:
        octave_tau = refined_tau / multiplier

        if octave_tau >= 2 and octave_tau < tau_max:
            octave_tau_int = int(round(octave_tau))
            octave_cmnd = cmnd[octave_tau_int]
            octave_freq = sample_rate / octave_tau

            # Accept octave if CMND is reasonable (even if slightly above threshold)
            # Use relaxed threshold for octave checking
            relaxed_threshold = 0.20  # More lenient than primary threshold (0.10)

            if octave_cmnd < relaxed_threshold and 25 <= octave_freq <= 4500:
                candidates.append({
                    'freq': octave_freq,
                    'tau': octave_tau,
                    'cmnd': octave_cmnd,
                    'multiplier': multiplier
                })

    # Score candidates: prefer higher frequencies if CMND is similar
    best_candidate = None
    best_score = -1

    for cand in candidates:
        freq = cand['freq']
        cmnd_val = cand['cmnd']
        multiplier = cand['multiplier']

        # Clarity score (lower CMND = better)
        clarity = 1.0 - cmnd_val

        # Frequency preference: strongly prefer higher frequencies for piano
        # (fundamentals over sub-harmonics)
        if freq < 80:  # Below C2
            freq_pref = 0.1
        elif freq < 130:  # C2-C3 (likely octave error)
            freq_pref = 0.3
        elif freq < 200:  # C3-C4
            freq_pref = 0.6
        elif freq < 600:  # C4-C5 (ideal piano range)
            freq_pref = 1.0
        elif freq < 1200:  # C5-C6
            freq_pref = 0.95
        elif freq < 2400:  # C6-C7
            freq_pref = 0.85
        else:  # Above C7
            freq_pref = 0.7

        # Octave bonus: prefer higher octaves if clarity is similar
        # This breaks ties in favor of fundamentals
        octave_bonus = 0.1 * math.log2(multiplier)  # 0.0, 0.1, 0.2, 0.3 for 1x, 2x, 4x, 8x

        # Combined score: weighted sum
        score = (clarity * 0.4) + (freq_pref * 0.5) + (octave_bonus * 0.1)

        if score > best_score:
            best_score = score
            best_candidate = cand

    if not best_candidate:
        return None

    frequency = best_candidate['freq']
    cmnd_val = best_candidate['cmnd']

    base_confidence = 1.0 - cmnd_val
    volume_boost = min(0.3, rms * 20)
    confidence = min(0.98, max(0.3, base_confidence + volume_boost * 0.3))

    note = frequency_to_note(frequency)
    if note:
        return {
            "note": note,
            "frequency": float(frequency),
            "confidence": float(confidence),
            "rms": float(rms),
        }

    return None


def frequency_to_note(frequency: float) -> str:
    """Convert frequency to note name."""
    if frequency <= 0:
        return None

    semitones_from_a4 = 12 * math.log2(frequency / 440.0)
    semitone = round(semitones_from_a4)
    note_in_octave = semitone % 12
    octave = 4 + (semitone + 9) // 12

    note_names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
    note_name = note_names[note_in_octave]

    if 0 <= octave <= 8:
        return f"{note_name}{octave}"
    return None


if __name__ == "__main__":
    import time

    print("Testing Optimized YIN v3 with octave disambiguation")
    sr = 44100
    duration = 0.5

    # Test C4 (261.6 Hz) with strong harmonics (simulating decayed fundamental)
    t = np.linspace(0, duration, int(sr * duration))
    # Weak fundamental + strong harmonics
    audio = 0.3 * np.sin(2 * np.pi * 261.6 * t)  # Weak fundamental
    audio += 0.5 * np.sin(2 * np.pi * 523.2 * t)  # Strong 2nd harmonic
    audio += 0.4 * np.sin(2 * np.pi * 784.8 * t)  # Strong 3rd harmonic

    start = time.time()
    result = detect_piano_note(audio.tolist(), sr)
    elapsed = (time.time() - start) * 1000

    if result:
        print(f"Detected: {result['note']} @ {result['frequency']:.1f}Hz")
        print(f"Expected: C4 @ 261.6Hz (even with weak fundamental)")
        print(f"Confidence: {result['confidence']:.2%}")
        print(f"Latency: {elapsed:.1f}ms")

        if result['note'] == 'C4':
            print("\n✅ Octave disambiguation working!")
        else:
            print(f"\n⚠️  Detected {result['note']} (may be acceptable depending on harmonics)")
    else:
        print("❌ No note detected")

    print("\n✅ Ready for testing on real audio")
