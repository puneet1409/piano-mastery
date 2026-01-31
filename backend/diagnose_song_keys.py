#!/usr/bin/env python3
"""
Diagnose actual notes in audio files to determine correct expected notes.
"""

import numpy as np
import wave
import os
from collections import Counter
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


def analyze_song_notes(wav_path, detector, max_duration_sec=30):
    """Detect notes in a song without score awareness."""
    samples, sr = load_wav(wav_path)

    # Limit to max duration
    max_samples = int(max_duration_sec * sr)
    samples = samples[:max_samples]

    window_size = int(0.15 * sr)  # 150ms windows
    step = int(0.08 * sr)  # 80ms step

    detected_notes = []
    windows_analyzed = 0

    for i in range(0, len(samples) - window_size, step):
        chunk = samples[i:i + window_size]
        rms = np.sqrt(np.mean(chunk ** 2))

        # Skip quiet sections
        if rms < 0.015:
            continue

        windows_analyzed += 1

        # Free detection (no expected notes)
        result = detector.detect(chunk, sr, expected_notes=None)

        if result.notes:
            detected_notes.extend(result.notes)

    return detected_notes, windows_analyzed


def main():
    detector = ProductionDetector(mode="single")
    base_path = "/home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend/test_songs"

    songs = [
        'perfect_easy_tutorial.wav',
        'perfect_musescore.wav',
        'tumhiho_slow.wav',
        'kalhonaho_easy.wav',
        'lagjagale_cover.wav',
        'kaisehua_cover.wav',
    ]

    print("=" * 70)
    print("SONG KEY DIAGNOSTIC")
    print("Analyzing actual notes in each audio file")
    print("=" * 70)

    for song in songs:
        wav_path = os.path.join(base_path, song)
        if not os.path.exists(wav_path):
            print(f"\n⚠ {song}: File not found")
            continue

        print(f"\n{'─' * 60}")
        print(f"Song: {song}")

        notes, total_windows = analyze_song_notes(wav_path, detector)

        # Count note occurrences
        note_counts = Counter(notes)
        total_detections = len(notes)

        print(f"Total windows: {total_windows}")
        print(f"Total detections: {total_detections} ({100*total_detections/total_windows:.1f}%)")

        # Show top notes
        print(f"\nTop 15 detected notes:")
        for note, count in note_counts.most_common(15):
            pct = 100 * count / total_detections
            print(f"  {note}: {count} ({pct:.1f}%)")

        # Extract unique notes for expected list
        unique_notes = sorted(set(notes), key=lambda n: (
            int(n[-1]) if n[-1].isdigit() else 0,
            n[:-1]
        ))
        print(f"\nAll unique notes ({len(unique_notes)}): {unique_notes}")

        # Suggest expected notes list (notes with >1% occurrence)
        significant_notes = [n for n, c in note_counts.items()
                           if c / total_detections > 0.01]
        print(f"\nSuggested expected notes (>1% occurrence):")
        print(f"  {sorted(significant_notes)}")


if __name__ == "__main__":
    main()
