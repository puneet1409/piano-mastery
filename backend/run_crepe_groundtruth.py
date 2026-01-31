#!/usr/bin/env python3
"""
Run CREPE (Google's deep CNN) on audio files to produce ground truth note lists.
Saves results as JSON so they can be loaded by the comparison script without
loading CREPE and TFLite in the same process (avoids LLVM crash).
"""

import os
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import json
import sys
import time
import numpy as np
import soundfile as sf

# Import CREPE after env vars are set
import crepe

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def hz_to_midi(freq):
    if freq <= 0:
        return 0
    return int(round(69 + 12 * np.log2(freq / 440.0)))

def midi_to_name(midi):
    octave = (midi - 12) // 12
    return f"{NOTE_NAMES[midi % 12]}{octave}"


def crepe_transcribe(audio, sr, model_capacity='small', confidence_threshold=0.6, min_note_frames=3):
    """
    Use CREPE to detect pitches frame-by-frame, then segment into note events.

    CREPE is monophonic — detects one dominant pitch per frame.
    For polyphonic audio, this captures the melody/loudest voice.
    """
    # Process in chunks to avoid LLVM crashes with large tensors
    chunk_duration = 5  # seconds per chunk
    chunk_samples = int(sr * chunk_duration)

    all_timestamps = []
    all_frequencies = []
    all_confidences = []

    for start in range(0, len(audio), chunk_samples):
        chunk = audio[start:start + chunk_samples]
        if len(chunk) < sr * 0.1:  # skip very short tail
            break

        t, f, c, _ = crepe.predict(
            chunk, sr,
            model_capacity=model_capacity,
            viterbi=True,
            step_size=10,
            verbose=0,
        )

        # Shift timestamps by chunk offset
        offset = start / sr
        all_timestamps.extend(t + offset)
        all_frequencies.extend(f)
        all_confidences.extend(c)

    timestamp = np.array(all_timestamps)
    frequency = np.array(all_frequencies)
    confidence = np.array(all_confidences)

    # Convert to MIDI and filter by confidence
    midi_notes = np.array([hz_to_midi(f) if c >= confidence_threshold else 0
                           for f, c in zip(frequency, confidence)])

    # Segment into note events
    notes = []
    current_pitch = 0
    start_idx = 0

    for i in range(len(midi_notes)):
        if midi_notes[i] != current_pitch:
            if current_pitch > 0 and (i - start_idx) >= min_note_frames:
                notes.append({
                    'pitch': int(current_pitch),
                    'onset': float(timestamp[start_idx]),
                    'offset': float(timestamp[i - 1]),
                })
            current_pitch = midi_notes[i]
            start_idx = i

    if current_pitch > 0 and (len(midi_notes) - start_idx) >= min_note_frames:
        notes.append({
            'pitch': int(current_pitch),
            'onset': float(timestamp[start_idx]),
            'offset': float(timestamp[-1]),
        })

    return notes


SONGS = [
    ("test_songs/perfect_musescore.wav", "Perfect - Ed Sheeran (MuseScore Cover)", 30),
    ("test_songs/kaisehua_cover.wav", "Kaise Hua - Kabir Singh (Piano Cover)", 30),
    ("test_songs/kalhonaho_easy.wav", "Kal Ho Naa Ho (Easy Piano)", 30),
    ("test_songs/lagjagale_cover.wav", "Lag Ja Gale (Piano Cover)", 30),
]


def main():
    model_cap = sys.argv[1] if len(sys.argv) > 1 else 'small'
    print(f"CREPE Ground Truth Generator (model: {model_cap})")
    print("=" * 60)

    results = {}

    for filepath, title, clip_s in SONGS:
        if not os.path.exists(filepath):
            print(f"  SKIP: {title} (not found)")
            continue

        print(f"\n  Processing: {title}")
        audio, sr = sf.read(filepath)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        if len(audio) / sr > clip_s:
            audio = audio[:int(sr * clip_s)]
        duration = len(audio) / sr

        t0 = time.time()
        notes = crepe_transcribe(audio, sr, model_capacity=model_cap)
        elapsed = time.time() - t0

        mid_notes = [n for n in notes if 48 <= n['pitch'] <= 84]

        # Note distribution
        dist = {}
        for n in mid_notes:
            name = NOTE_NAMES[n['pitch'] % 12]
            dist[name] = dist.get(name, 0) + 1
        top = sorted(dist.items(), key=lambda x: -x[1])[:10]

        print(f"  Duration: {duration:.1f}s | Time: {elapsed:.1f}s ({duration/elapsed:.1f}x realtime)")
        print(f"  Notes: {len(notes)} total, {len(mid_notes)} in C3-C6")
        print(f"  Top notes: {', '.join(f'{n}({c})' for n, c in top)}")

        results[filepath] = {
            'title': title,
            'notes': notes,
            'duration': duration,
            'elapsed': elapsed,
            'model': model_cap,
        }

    # Save results
    outfile = "test_songs/crepe_ground_truth.json"
    with open(outfile, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n  Saved to {outfile}")
    print("=" * 60)


if __name__ == "__main__":
    main()
