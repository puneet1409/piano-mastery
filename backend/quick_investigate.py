#!/usr/bin/env python3
"""Quick investigation of failures without ML detector."""

import numpy as np
import wave
import os

# Use single mode to avoid ML loading
from production_detector import ProductionDetector


def investigate_noise():
    """Test noise tolerance."""
    print("=" * 60)
    print("BACKGROUND NOISE INVESTIGATION")
    print("=" * 60)

    detector = ProductionDetector(mode="single")  # Avoid ML
    sr = 44100
    duration = 0.2
    t = np.linspace(0, duration, int(sr * duration))

    # Generate C4
    freq = 261.63
    signal = np.zeros_like(t)
    for h in range(1, 6):
        signal += (1.0 / h) * np.sin(2 * np.pi * freq * h * t)
    signal = signal / np.max(np.abs(signal)) * 0.8

    print(f"\n{'Noise':>8} {'SNR dB':>8} {'Detected':>10} {'Match':>6}")
    print("-" * 40)

    for noise_pct in [15, 18, 20, 22, 25, 30]:
        noise = np.random.randn(len(signal)) * (noise_pct / 100)
        noisy = (signal + noise).astype(np.float32)

        snr = 10 * np.log10(np.mean(signal**2) / np.mean(noise**2))

        result = detector.detect(noisy, sr, expected_notes=['C4'])
        detected = result.notes[0] if result.notes else "NONE"
        match = "✓" if result.is_match else "✗"

        print(f"{noise_pct:>7}% {snr:>8.1f} {detected:>10} {match:>6}")

    # Analyze YIN at 20% noise
    print("\n--- YIN Analysis at 20% noise ---")
    noise = np.random.randn(len(signal)) * 0.20
    noisy = (signal + noise).astype(np.float32)

    from optimized_yin_v3 import detect_piano_note
    yin = detect_piano_note(noisy.tolist(), sr)
    print(f"YIN result: {yin}")

    # Check CMND values
    audio = noisy
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

    min_tau = 2 + np.argmin(cmnd[2:])
    print(f"Min CMND: {cmnd[min_tau]:.4f} at tau={min_tau} (freq={sr/min_tau:.1f} Hz)")
    print(f"C4 tau would be: {sr/261.63:.0f}, CMND at C4 tau: {cmnd[int(sr/261.63)]:.4f}")


def investigate_songs():
    """Check song failure patterns."""
    print("\n" + "=" * 60)
    print("SONG FAILURE INVESTIGATION")
    print("=" * 60)

    detector = ProductionDetector(mode="single")
    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"

    songs = [
        ('perfect_musescore.wav', ['G#1', 'G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                                   'C#2', 'C#3', 'C#5', 'C5', 'D#2', 'D#3', 'D#4',
                                   'F2', 'F#2', 'F3', 'F#3', 'F4']),
        ('tumhiho_slow.wav', ['G#2', 'G#3', 'G#4', 'A#1', 'A#4',
                              'C#3', 'C#5', 'C2', 'C5', 'D#2', 'D2', 'D3', 'D4', 'D#5',
                              'F2', 'F3', 'F4', 'F#4', 'G2', 'G4', 'A4']),
    ]

    for wav_name, expected in songs:
        wav_path = os.path.join(base_path, wav_name)
        if not os.path.exists(wav_path):
            continue

        print(f"\n--- {wav_name} ---")

        with wave.open(wav_path, 'rb') as wav:
            sr = wav.getframerate()
            n_frames = wav.getnframes()
            raw = wav.readframes(n_frames)
            samples = np.frombuffer(raw, dtype=np.int16)
            if wav.getnchannels() == 2:
                samples = samples[::2]
            samples = samples.astype(np.float32) / 32768.0

        samples = samples[:int(30 * sr)]

        window_size = int(0.15 * sr)
        step = int(0.08 * sr)

        total = 0
        matches = 0
        none_count = 0
        wrong_notes = []

        for i in range(0, len(samples) - window_size, step):
            chunk = samples[i:i + window_size]
            rms = np.sqrt(np.mean(chunk ** 2))
            if rms < 0.015:
                continue

            total += 1
            result = detector.detect(chunk, sr, expected_notes=expected)

            if result.is_match:
                matches += 1
            elif not result.notes:
                none_count += 1
            else:
                wrong_notes.append(result.notes[0])

        wrong_count = total - matches - none_count
        print(f"Total windows: {total}")
        print(f"Matches: {matches} ({100*matches/total:.1f}%)")
        print(f"No detection: {none_count} ({100*none_count/total:.1f}%)")
        print(f"Wrong note: {wrong_count} ({100*wrong_count/total:.1f}%)")

        if wrong_notes:
            from collections import Counter
            print(f"Wrong notes: {Counter(wrong_notes).most_common(5)}")


if __name__ == "__main__":
    investigate_noise()
    investigate_songs()
