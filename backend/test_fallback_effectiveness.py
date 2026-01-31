#!/usr/bin/env python3
"""Test if hybrid fallbacks improve NONE detection cases."""

import numpy as np
import wave
import os


def load_wav(filepath):
    with wave.open(filepath, 'rb') as wav:
        sr = wav.getframerate()
        n_frames = wav.getnframes()
        raw = wav.readframes(n_frames)
        samples = np.frombuffer(raw, dtype=np.int16)
        if wav.getnchannels() == 2:
            samples = samples[::2]
        return samples.astype(np.float32) / 32768.0, sr


def test_fallbacks():
    """Compare single vs hybrid mode on songs."""
    from production_detector import ProductionDetector

    single_detector = ProductionDetector(mode="single")
    hybrid_detector = ProductionDetector(mode="hybrid")

    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"

    songs = [
        ('perfect_musescore.wav', ['G#1', 'G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                                   'C#2', 'C#3', 'C#5', 'C5', 'D#2', 'D#3', 'D#4',
                                   'F2', 'F#2', 'F3', 'F#3', 'F4']),
    ]

    for wav_name, expected in songs:
        wav_path = os.path.join(base_path, wav_name)
        if not os.path.exists(wav_path):
            continue

        print(f"=== {wav_name} ===\n")

        samples, sr = load_wav(wav_path)
        samples = samples[:int(30 * sr)]

        window_size = int(0.15 * sr)
        step = int(0.08 * sr)

        single_matches = 0
        hybrid_matches = 0
        total = 0
        fallback_saves = 0  # Cases where hybrid succeeded but single failed

        for i in range(0, len(samples) - window_size, step):
            chunk = samples[i:i + window_size]
            rms = np.sqrt(np.mean(chunk ** 2))
            if rms < 0.015:
                continue

            total += 1

            single_result = single_detector.detect(chunk, sr, expected_notes=expected)
            hybrid_result = hybrid_detector.detect(chunk, sr, expected_notes=expected)

            if single_result.is_match:
                single_matches += 1
            if hybrid_result.is_match:
                hybrid_matches += 1

            # Check if hybrid saved a single failure
            if hybrid_result.is_match and not single_result.is_match:
                fallback_saves += 1
                if fallback_saves <= 5:
                    print(f"Fallback save at t={i/sr:.2f}s:")
                    print(f"  Single: {single_result.notes} (detector: {single_result.detector_used})")
                    print(f"  Hybrid: {hybrid_result.notes} (detector: {hybrid_result.detector_used})")

        print(f"\nResults for {wav_name}:")
        print(f"  Single mode: {single_matches}/{total} ({100*single_matches/total:.1f}%)")
        print(f"  Hybrid mode: {hybrid_matches}/{total} ({100*hybrid_matches/total:.1f}%)")
        print(f"  Fallback saves: {fallback_saves} additional matches")


def test_cmnd_in_failures():
    """Check CMND values in sections where detection fails."""
    from production_detector import ProductionDetector

    detector = ProductionDetector(mode="single")
    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"

    wav_path = os.path.join(base_path, 'perfect_musescore.wav')
    expected = ['G#1', 'G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                'C#2', 'C#3', 'C#5', 'C5', 'D#2', 'D#3', 'D#4',
                'F2', 'F#2', 'F3', 'F#3', 'F4']

    samples, sr = load_wav(wav_path)
    samples = samples[:int(30 * sr)]

    window_size = int(0.15 * sr)
    step = int(0.08 * sr)

    print("\n=== CMND Analysis in Failing Sections ===\n")

    failure_count = 0
    cmnd_values = []

    for i in range(0, len(samples) - window_size, step):
        chunk = samples[i:i + window_size]
        rms = np.sqrt(np.mean(chunk ** 2))
        if rms < 0.015:
            continue

        result = detector.detect(chunk, sr, expected_notes=expected)

        if not result.is_match and not result.notes:
            failure_count += 1

            # Compute CMND
            audio = np.array(chunk, dtype=np.float32)
            buffer_size = len(audio)
            tau_max = min(buffer_size // 2, sr // 50)

            difference = np.zeros(tau_max)
            for tau in range(tau_max):
                delta = audio[:buffer_size - tau_max] - audio[tau:tau + buffer_size - tau_max]
                difference[tau] = np.sum(delta ** 2)

            cmnd = np.ones(tau_max)
            cumulative_sum = 0.0
            for tau in range(1, tau_max):
                cumulative_sum += difference[tau]
                if cumulative_sum > 0:
                    cmnd[tau] = difference[tau] * tau / cumulative_sum

            min_tau = 2 + np.argmin(cmnd[2:tau_max])
            min_cmnd = cmnd[min_tau]
            cmnd_values.append(min_cmnd)

            if failure_count <= 10:
                freq = sr / min_tau
                print(f"Fail #{failure_count} at t={i/sr:.2f}s: min CMND={min_cmnd:.3f}, freq={freq:.1f}Hz, RMS={rms:.4f}")

    if cmnd_values:
        print(f"\n--- CMND Statistics for {len(cmnd_values)} failures ---")
        print(f"Min CMND: {min(cmnd_values):.3f}")
        print(f"Max CMND: {max(cmnd_values):.3f}")
        print(f"Mean CMND: {np.mean(cmnd_values):.3f}")
        print(f"Median CMND: {np.median(cmnd_values):.3f}")

        # How many would pass with higher threshold?
        for threshold in [0.40, 0.45, 0.50, 0.55, 0.60]:
            would_pass = sum(1 for c in cmnd_values if c < threshold)
            print(f"  Would pass at threshold {threshold}: {would_pass}/{len(cmnd_values)}")


if __name__ == "__main__":
    test_fallbacks()
    test_cmnd_in_failures()
