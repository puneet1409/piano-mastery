#!/usr/bin/env python3
"""Simple CMND analysis of failing sections - no ML."""

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


def compute_cmnd(audio, sr):
    """Compute CMND and return min value and corresponding frequency."""
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

    # Find minimum in valid range (50 Hz to 2000 Hz)
    min_tau = max(2, sr // 2000)
    max_tau = min(tau_max - 1, sr // 50)

    search_range = cmnd[min_tau:max_tau]
    if len(search_range) == 0:
        return 1.0, 0

    best_idx = np.argmin(search_range)
    best_tau = min_tau + best_idx
    return cmnd[best_tau], sr / best_tau


def analyze_cmnd_distribution():
    """Analyze CMND values in both passing and failing windows."""
    from optimized_yin_v3 import detect_piano_note

    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"
    wav_path = os.path.join(base_path, 'perfect_musescore.wav')

    expected = ['G#1', 'G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                'C#2', 'C#3', 'C#5', 'C5', 'D#2', 'D#3', 'D#4',
                'F2', 'F#2', 'F3', 'F#3', 'F4']

    samples, sr = load_wav(wav_path)
    samples = samples[:int(30 * sr)]

    window_size = int(0.15 * sr)
    step = int(0.08 * sr)

    pass_cmnds = []
    fail_cmnds = []

    for i in range(0, len(samples) - window_size, step):
        chunk = samples[i:i + window_size]
        rms = np.sqrt(np.mean(chunk ** 2))
        if rms < 0.015:
            continue

        # Try YIN detection
        yin_result = detect_piano_note(chunk.tolist(), sr)

        # Compute raw CMND
        cmnd_val, freq = compute_cmnd(chunk, sr)

        if yin_result and yin_result.get('note'):
            pass_cmnds.append(cmnd_val)
        else:
            fail_cmnds.append(cmnd_val)

    print("=== CMND Distribution Analysis ===\n")
    print(f"Passing windows: {len(pass_cmnds)}")
    print(f"Failing windows: {len(fail_cmnds)}")

    if pass_cmnds:
        print(f"\nPassing CMND stats:")
        print(f"  Min: {min(pass_cmnds):.4f}")
        print(f"  Max: {max(pass_cmnds):.4f}")
        print(f"  Mean: {np.mean(pass_cmnds):.4f}")
        print(f"  Median: {np.median(pass_cmnds):.4f}")

    if fail_cmnds:
        print(f"\nFailing CMND stats:")
        print(f"  Min: {min(fail_cmnds):.4f}")
        print(f"  Max: {max(fail_cmnds):.4f}")
        print(f"  Mean: {np.mean(fail_cmnds):.4f}")
        print(f"  Median: {np.median(fail_cmnds):.4f}")

        # Threshold analysis
        print(f"\n--- If we raised fallback threshold ---")
        for thresh in [0.40, 0.45, 0.50, 0.55, 0.60, 0.65]:
            would_recover = sum(1 for c in fail_cmnds if c < thresh)
            print(f"  Threshold {thresh}: would recover {would_recover}/{len(fail_cmnds)} ({100*would_recover/len(fail_cmnds):.0f}%)")


def analyze_cqt_on_failures():
    """Test if CQT detector can handle NONE cases."""
    from harmonic_cqt_detector import HarmonicCQTDetector
    from optimized_yin_v3 import detect_piano_note

    cqt = HarmonicCQTDetector()

    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"
    wav_path = os.path.join(base_path, 'perfect_musescore.wav')

    expected = ['G#1', 'G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                'C#2', 'C#3', 'C#5', 'C5', 'D#2', 'D#3', 'D#4',
                'F2', 'F#2', 'F3', 'F#3', 'F4']

    samples, sr = load_wav(wav_path)
    samples = samples[:int(30 * sr)]

    window_size = int(0.15 * sr)
    step = int(0.08 * sr)

    print("\n=== CQT Fallback Analysis ===\n")

    yin_only = 0
    cqt_saves = 0
    both_fail = 0
    total_yin_fails = 0

    for i in range(0, len(samples) - window_size, step):
        chunk = samples[i:i + window_size]
        rms = np.sqrt(np.mean(chunk ** 2))
        if rms < 0.015:
            continue

        # YIN detection
        yin_result = detect_piano_note(chunk.tolist(), sr)

        if yin_result and yin_result.get('note'):
            yin_only += 1
        else:
            total_yin_fails += 1
            # Try CQT fallback
            cqt_result = cqt.detect_realtime(chunk, sr, expected)

            if cqt_result and cqt_result.note:
                # Check if it matches expected
                detected = cqt_result.note
                is_match = any(detected == exp or
                              detected[:-1] == exp[:-1]  # Same pitch class
                              for exp in expected)
                if is_match:
                    cqt_saves += 1
                else:
                    both_fail += 1
            else:
                both_fail += 1

    total = yin_only + total_yin_fails
    print(f"Total windows: {total}")
    print(f"YIN succeeds: {yin_only} ({100*yin_only/total:.1f}%)")
    print(f"YIN fails, CQT saves: {cqt_saves} ({100*cqt_saves/total:.1f}%)")
    print(f"Both fail: {both_fail} ({100*both_fail/total:.1f}%)")
    print(f"\nCQT recovery rate: {100*cqt_saves/total_yin_fails:.1f}% of YIN failures")


if __name__ == "__main__":
    analyze_cmnd_distribution()
    analyze_cqt_on_failures()
