#!/usr/bin/env python3
"""
Investigate specific test failures to understand root causes.
"""

import numpy as np
import wave
import os
from production_detector import ProductionDetector


def load_wav(filepath):
    """Load WAV file."""
    with wave.open(filepath, 'rb') as wav:
        sr = wav.getframerate()
        n_frames = wav.getnframes()
        raw = wav.readframes(n_frames)
        samples = np.frombuffer(raw, dtype=np.int16)
        if wav.getnchannels() == 2:
            samples = samples[::2]
        return samples.astype(np.float32) / 32768.0, sr


def investigate_background_noise():
    """Investigate background noise failure at 20% level."""
    print("=" * 70)
    print("INVESTIGATING: Background Noise Failure")
    print("=" * 70)

    detector = ProductionDetector(mode="hybrid")
    sr = 44100
    duration = 0.2
    t = np.linspace(0, duration, int(sr * duration))

    # Generate C4 with harmonics
    freq = 261.63
    signal = np.zeros_like(t)
    for h in range(1, 6):
        signal += (1.0 / h) * np.sin(2 * np.pi * freq * h * t)
    signal = signal / np.max(np.abs(signal)) * 0.8

    # Test at different noise levels
    noise_levels = [0.10, 0.15, 0.18, 0.20, 0.22, 0.25]
    expected = ['C4']

    print(f"\nTesting C4 detection at various noise levels:")
    print(f"{'Noise %':>10} {'SNR (dB)':>10} {'Detected':>12} {'Match':>8} {'Conf':>8}")
    print("-" * 50)

    for noise_level in noise_levels:
        noise = np.random.randn(len(signal)) * noise_level
        noisy = (signal + noise).astype(np.float32)

        # Calculate SNR
        signal_power = np.mean(signal ** 2)
        noise_power = np.mean(noise ** 2)
        snr_db = 10 * np.log10(signal_power / noise_power) if noise_power > 0 else float('inf')

        result = detector.detect(noisy, sr, expected_notes=expected)
        detected = result.notes[0] if result.notes else "NONE"
        conf = f"{result.confidences[0]:.2f}" if result.confidences else "-"
        match = "✓" if result.is_match else "✗"

        print(f"{noise_level*100:>10.0f}% {snr_db:>10.1f} {detected:>12} {match:>8} {conf:>8}")

    # Analyze why it fails
    print("\n--- Diagnostic at 20% noise ---")
    noise_level = 0.20
    noise = np.random.randn(len(signal)) * noise_level
    noisy = (signal + noise).astype(np.float32)

    # Check RMS
    rms = np.sqrt(np.mean(noisy ** 2))
    print(f"RMS of noisy signal: {rms:.4f}")

    # Try raw YIN
    from optimized_yin_v3 import detect_piano_note
    yin_result = detect_piano_note(noisy.tolist(), sr)
    print(f"Raw YIN result: {yin_result}")


def investigate_song_failures():
    """Investigate which windows fail in real songs."""
    print("\n" + "=" * 70)
    print("INVESTIGATING: Real Song Failures")
    print("=" * 70)

    detector = ProductionDetector(mode="hybrid")
    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"

    # Test Perfect MuseScore (89.6% - significant failures)
    songs = [
        {
            'name': 'Perfect (MuseScore)',
            'wav': 'perfect_musescore.wav',
            'notes': ['G#1', 'G#2', 'G#3', 'G#4',
                      'A#1', 'A#4',
                      'C#2', 'C#3', 'C#5', 'C5',
                      'D#2', 'D#3', 'D#4',
                      'F2', 'F#2', 'F3', 'F#3', 'F4'],
        },
        {
            'name': 'Tum Hi Ho (Slow)',
            'wav': 'tumhiho_slow.wav',
            'notes': ['G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                      'C#3', 'C#5', 'C2', 'C5',
                      'D#2', 'D2', 'D3', 'D4', 'D#5',
                      'F2', 'F3', 'F4', 'F#4',
                      'G2', 'G4', 'A4'],
        },
    ]

    for song in songs:
        wav_path = os.path.join(base_path, song['wav'])
        if not os.path.exists(wav_path):
            continue

        print(f"\n--- {song['name']} ---")

        samples, sr = load_wav(wav_path)
        samples = samples[:int(30 * sr)]  # First 30 seconds

        window_size = int(0.15 * sr)
        step = int(0.08 * sr)

        failures = []

        for i in range(0, len(samples) - window_size, step):
            chunk = samples[i:i + window_size]
            rms = np.sqrt(np.mean(chunk ** 2))

            if rms < 0.015:
                continue

            time_sec = i / sr
            result = detector.detect(chunk, sr, expected_notes=song['notes'])

            if not result.is_match:
                # Record failure details
                failures.append({
                    'time': time_sec,
                    'rms': rms,
                    'detected': result.notes,
                    'detector': result.detector_used,
                    'raw': result.raw_detections,
                })

        print(f"Total failures: {len(failures)}")

        if failures:
            print(f"\nFirst 10 failures:")
            print(f"{'Time':>8} {'RMS':>8} {'Detector':>12} {'Detected':>15}")
            print("-" * 50)

            for f in failures[:10]:
                detected = f['detected'][0] if f['detected'] else 'NONE'
                print(f"{f['time']:>8.2f}s {f['rms']:>8.4f} {f['detector']:>12} {detected:>15}")

            # Analyze failure patterns
            none_count = sum(1 for f in failures if not f['detected'])
            wrong_count = len(failures) - none_count
            print(f"\nFailure breakdown:")
            print(f"  No detection (NONE): {none_count}")
            print(f"  Wrong note detected: {wrong_count}")

            if wrong_count > 0:
                wrong_notes = [f['detected'][0] for f in failures if f['detected']]
                from collections import Counter
                print(f"  Most common wrong notes: {Counter(wrong_notes).most_common(5)}")


def investigate_yin_cmnd():
    """Check CMND values in failing sections."""
    print("\n" + "=" * 70)
    print("INVESTIGATING: YIN CMND in Failing Sections")
    print("=" * 70)

    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"
    wav_path = os.path.join(base_path, 'perfect_musescore.wav')

    if not os.path.exists(wav_path):
        print("File not found")
        return

    samples, sr = load_wav(wav_path)

    # Check a specific failing time window
    # Based on previous analysis, check around t=6s
    for time_sec in [2.0, 4.0, 6.0, 8.0, 10.0]:
        start = int(time_sec * sr)
        window_size = int(0.15 * sr)
        chunk = samples[start:start + window_size]

        rms = np.sqrt(np.mean(chunk ** 2))
        if rms < 0.015:
            continue

        # Compute CMND manually
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

        # Find minimum CMND
        min_tau_search = max(2, sr // 2000)
        max_tau_search = min(tau_max - 1, sr // 50)
        search_range = cmnd[min_tau_search:max_tau_search]

        if len(search_range) > 0:
            min_idx = np.argmin(search_range)
            min_cmnd = search_range[min_idx]
            min_tau = min_tau_search + min_idx
            freq = sr / min_tau

            print(f"\nt={time_sec:.1f}s: RMS={rms:.4f}")
            print(f"  Min CMND: {min_cmnd:.4f} at tau={min_tau} (freq={freq:.1f} Hz)")
            print(f"  Below 0.35 threshold: {'Yes' if min_cmnd < 0.35 else 'No'}")
            print(f"  Below 0.15 threshold: {'Yes' if min_cmnd < 0.15 else 'No'}")


if __name__ == "__main__":
    investigate_background_noise()
    investigate_song_failures()
    investigate_yin_cmnd()
