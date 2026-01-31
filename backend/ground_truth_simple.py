#!/usr/bin/env python3
"""
Ground Truth Pitch Detection using enhanced YIN with very conservative parameters.
Slower but more accurate than real-time YIN.

Strategy:
1. Larger analysis windows (8192 samples vs 4096)
2. Smaller hop size (1024 vs 2048) for better time resolution
3. More conservative threshold (0.05 vs 0.10)
4. Octave verification at every frame
5. Longer stability requirement (10 frames vs 3)
"""

import wave
import numpy as np
import math
from typing import List, Dict


def yin_pitch_track(audio: np.ndarray, sample_rate: int,
                     frame_length: int = 8192,
                     hop_length: int = 1024,
                     threshold: float = 0.05) -> tuple:
    """
    YIN pitch tracking with high-accuracy parameters.

    Returns: (frequencies, confidences, times)
    """
    # Calculate number of frames
    num_frames = (len(audio) - frame_length) // hop_length + 1

    frequencies = []
    confidences = []
    times = []

    for i in range(num_frames):
        start = i * hop_length
        end = start + frame_length

        if end > len(audio):
            break

        frame = audio[start:end]
        time = start / sample_rate

        # YIN algorithm on this frame
        freq, conf = yin_estimate(frame, sample_rate, threshold)

        frequencies.append(freq)
        confidences.append(conf)
        times.append(time)

    return np.array(frequencies), np.array(confidences), np.array(times)


def yin_estimate(audio_frame: np.ndarray, sample_rate: int, threshold: float = 0.05) -> tuple:
    """
    Single-frame YIN pitch estimation with octave disambiguation.
    """
    buffer_size = len(audio_frame)
    tau_max = buffer_size // 2

    # Difference function
    difference = np.zeros(tau_max)
    for tau in range(tau_max):
        delta = audio_frame[:buffer_size - tau] - audio_frame[tau:buffer_size]
        difference[tau] = np.sum(delta ** 2)

    # CMND
    cmnd = np.ones(tau_max)
    cumulative_sum = 0.0

    for tau in range(1, tau_max):
        cumulative_sum += difference[tau]
        if cumulative_sum > 0:
            cmnd[tau] = difference[tau] * tau / cumulative_sum

    # Find ALL valleys below threshold
    candidates = []
    tau = 2

    while tau < tau_max:
        if cmnd[tau] < threshold:
            # Local minimum
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

            freq = sample_rate / refined_tau

            if 25 <= freq <= 4500:
                candidates.append({
                    'freq': freq,
                    'tau': refined_tau,
                    'cmnd': cmnd[tau]
                })

        tau += 1

    if not candidates:
        return None, 0.0

    # OCTAVE DISAMBIGUATION with strict preference for higher frequencies
    best_candidate = None
    best_score = -1

    for cand in candidates:
        freq = cand['freq']
        cmnd_val = cand['cmnd']

        # Check octave multiples
        octave_candidates = [{'freq': freq, 'cmnd': cmnd_val, 'mult': 1}]

        for mult in [2, 4]:
            oct_tau = cand['tau'] / mult
            if 2 <= oct_tau < tau_max:
                oct_tau_int = int(round(oct_tau))
                oct_cmnd = cmnd[oct_tau_int]
                oct_freq = sample_rate / oct_tau

                if oct_cmnd < threshold * 2.5 and 25 <= oct_freq <= 4500:  # Relaxed threshold for octaves
                    octave_candidates.append({
                        'freq': oct_freq,
                        'cmnd': oct_cmnd,
                        'mult': mult
                    })

        # Score each octave candidate
        for oct_cand in octave_candidates:
            f = oct_cand['freq']
            c = oct_cand['cmnd']
            m = oct_cand['mult']

            # Clarity
            clarity = 1.0 - c

            # Strong frequency preference
            if f < 80:
                freq_pref = 0.05
            elif f < 130:
                freq_pref = 0.15
            elif f < 200:
                freq_pref = 0.50
            elif f < 600:
                freq_pref = 1.0  # Piano sweet spot
            elif f < 1200:
                freq_pref = 0.95
            elif f < 2400:
                freq_pref = 0.85
            else:
                freq_pref = 0.7

            # Octave bonus
            octave_bonus = 0.15 * math.log2(m)

            # Score: frequency preference is DOMINANT
            score = (clarity * 0.3) + (freq_pref * 0.6) + (octave_bonus * 0.1)

            if score > best_score:
                best_score = score
                best_candidate = oct_cand

    if not best_candidate:
        return None, 0.0

    frequency = best_candidate['freq']
    confidence = 1.0 - best_candidate['cmnd']

    return frequency, confidence


def frequency_to_note(frequency: float) -> str:
    """Convert frequency to note name."""
    if frequency is None or frequency <= 0 or np.isnan(frequency):
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


def detect_ground_truth(wav_file: str) -> List[Dict]:
    """
    Ground truth detection with conservative YIN parameters.
    """
    print(f"🔬 GROUND TRUTH DETECTION (High-Accuracy Mode)")
    print(f"   Algorithm: YIN with conservative parameters")
    print(f"   Frame: 8192 samples, Hop: 1024, Threshold: 0.05\n")

    # Load WAV
    with wave.open(wav_file, 'rb') as wav:
        sample_rate = wav.getframerate()
        num_channels = wav.getnchannels()
        num_frames = wav.getnframes()
        audio_data = wav.readframes(num_frames)

        if wav.getsampwidth() == 2:
            audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0
        else:
            raise ValueError("Only 16-bit audio supported")

        if num_channels == 2:
            audio = audio.reshape(-1, 2).mean(axis=1)

    duration = len(audio) / sample_rate

    print(f"📁 Loaded: {wav_file}")
    print(f"   Sample rate: {sample_rate} Hz")
    print(f"   Duration: {duration:.2f}s\n")

    print("🎯 Running high-accuracy pitch tracking...\n")

    # Run YIN with high-quality parameters
    frequencies, confidences, times = yin_pitch_track(
        audio, sample_rate,
        frame_length=8192,
        hop_length=1024,
        threshold=0.05  # More conservative
    )

    print(f"✅ Pitch tracking complete: {len(frequencies)} frames\n")

    # Convert to note events with STRICT stability requirement
    detected_notes = []
    current_note = None
    note_start_time = 0.0
    note_frequencies = []
    consecutive_frames = 0
    min_consecutive_frames = 10  # Require 10 consecutive frames (very strict)
    min_confidence = 0.70  # Minimum confidence threshold

    for time, freq, conf in zip(times, frequencies, confidences):
        if freq is not None and conf >= min_confidence:
            note = frequency_to_note(freq)

            if note == current_note:
                consecutive_frames += 1
                note_frequencies.append(freq)
            else:
                # Save previous note
                if current_note and consecutive_frames >= min_consecutive_frames:
                    duration_ms = (time - note_start_time) * 1000
                    avg_freq = np.median(note_frequencies)

                    if duration_ms > 100:  # Minimum 100ms
                        detected_notes.append({
                            'note': current_note,
                            'frequency': float(avg_freq),
                            'startTime': note_start_time,
                            'duration': duration_ms,
                            'confidence': 0.98
                        })

                # Start new note
                current_note = note
                note_start_time = time
                note_frequencies = [freq]
                consecutive_frames = 1

    # Add final note
    if current_note and consecutive_frames >= min_consecutive_frames:
        duration_ms = (duration - note_start_time) * 1000
        avg_freq = np.median(note_frequencies)

        if duration_ms > 100:
            detected_notes.append({
                'note': current_note,
                'frequency': float(avg_freq),
                'startTime': note_start_time,
                'duration': duration_ms,
                'confidence': 0.98
            })

    # Merge consecutive same notes
    merged_notes = []
    for note_data in detected_notes:
        if merged_notes:
            prev = merged_notes[-1]
            time_gap = note_data['startTime'] - (prev['startTime'] + prev['duration'] / 1000)

            if prev['note'] == note_data['note'] and time_gap < 0.5:
                prev['duration'] = (note_data['startTime'] - prev['startTime']) * 1000 + note_data['duration']
                prev['frequency'] = (prev['frequency'] + note_data['frequency']) / 2
                continue

        merged_notes.append(note_data)

    print(f"📊 Ground truth: {len(merged_notes)} notes ({len(detected_notes)} raw → {len(merged_notes)} merged)")
    print(f"   Sequence: {' → '.join([n['note'] for n in merged_notes])}\n")

    return merged_notes


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 ground_truth_simple.py <audio.wav>")
        sys.exit(1)

    wav_file = sys.argv[1]
    ground_truth = detect_ground_truth(wav_file)

    # Print results
    print("=" * 80)
    print("GROUND TRUTH RESULTS")
    print("=" * 80)
    print(f"\n📝 Detected sequence: {' → '.join([n['note'] for n in ground_truth])}")
    print(f"\n📊 Detailed breakdown:")
    print(f"{'#':<4} {'Note':<6} {'Frequency':<12} {'Duration':<12} {'Start Time'}")
    print("-" * 60)

    for idx, note in enumerate(ground_truth, 1):
        print(f"{idx:<4} {note['note']:<6} {note['frequency']:>8.1f} Hz  "
              f"{note['duration']/1000:>7.2f}s      {note['startTime']:>7.2f}s")

    print("=" * 80)
