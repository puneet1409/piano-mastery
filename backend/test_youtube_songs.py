#!/usr/bin/env python3
"""
Test the piano detection algorithm against real YouTube piano audio.

Songs tested:
1. Perfect (Ed Sheeran) - MuseScore cover
2. Perfect (Ed Sheeran) - Easy piano tutorial
3. Tum Hi Ho (Aashiqui 2) - Slow piano tutorial
4. Kal Ho Naa Ho - Easy piano
5. Lag Ja Gale - Piano cover
"""

import os
import time
import numpy as np
import soundfile as sf

from onsets_frames_tflite import OnsetsFramesTFLite, NoteEvent
from audio_buffer_manager import AudioBufferManager

# Expected notes for each song (approximate, for the main melody)
# Perfect (G major): G B D  - melody uses G4, A4, B4, C5, D5, E5
# Tum Hi Ho (F minor): F Ab C Eb  - melody in F minor
# Kal Ho Naa Ho (C major): C D E F G A
# Lag Ja Gale: G major area

SONG_INFO = {
    "perfect_musescore": {
        "file": "test_songs/perfect_musescore.wav",
        "title": "Perfect - Ed Sheeran (MuseScore Cover)",
        "key": "G major",
        "source": "https://youtube.com/watch?v=wQnovVhKKKs",
        "duration": 281,
    },
    "perfect_easy_tutorial": {
        "file": "test_songs/perfect_easy_tutorial.wav",
        "title": "Perfect - Ed Sheeran (Easy Tutorial + Sheets)",
        "key": "G major",
        "source": "https://youtube.com/watch?v=ddfA08DImZc",
        "duration": 276,
    },
    "tumhiho_slow": {
        "file": "test_songs/tumhiho_slow.wav",
        "title": "Tum Hi Ho - Aashiqui 2 (Slow Piano Tutorial)",
        "key": "F minor",
        "source": "https://youtube.com/watch?v=XyXx7gIJw0k",
        "duration": 262,
    },
    "kalhonaho_easy": {
        "file": "test_songs/kalhonaho_easy.wav",
        "title": "Kal Ho Naa Ho (Easy Piano)",
        "key": "C major",
        "source": "https://youtube.com/watch?v=0bwPHzoBrXE",
        "duration": 108,
    },
    "lagjagale_cover": {
        "file": "test_songs/lagjagale_cover.wav",
        "title": "Lag Ja Gale (Piano Cover)",
        "key": "G major",
        "source": "https://youtube.com/watch?v=11BNXotGaTQ",
        "duration": 255,
    },
}

MIDI_TO_NOTE = {}
for midi in range(21, 109):
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (midi - 12) // 12
    name = note_names[midi % 12]
    MIDI_TO_NOTE[midi] = f"{name}{octave}"


def transcribe_long_audio(model, audio, sample_rate):
    """Transcribe long audio using sliding window with consensus merge."""
    buf_mgr = AudioBufferManager(
        sample_rate=sample_rate,
        window_samples=int(17920 * sample_rate / 16000),
        hop_ratio=0.50,   # 50% overlap
    )

    all_notes = []
    chunk_size = int(sample_rate * 0.5)  # 500ms chunks

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i : i + chunk_size]
        window = buf_mgr.add_chunk(chunk)
        if window is not None:
            notes = model.transcribe(window, sample_rate=sample_rate)
            window_offset = buf_mgr.last_window_start_s
            confirmed = buf_mgr.consensus_notes(notes, window_offset)
            all_notes.extend(confirmed)

    # Flush remaining audio
    final_window = buf_mgr.flush()
    if final_window is not None:
        notes = model.transcribe(final_window, sample_rate=sample_rate)
        window_offset = buf_mgr.last_window_start_s
        confirmed = buf_mgr.consensus_notes(notes, window_offset)
        all_notes.extend(confirmed)

    all_notes.extend(buf_mgr.flush_pending())
    return all_notes


def analyze_notes(notes):
    """Analyze detected notes and return summary statistics."""
    if not notes:
        return {"count": 0}

    pitches = [n.pitch for n in notes]
    velocities = [n.velocity for n in notes]
    confidences = [n.confidence for n in notes]
    durations = [n.offset_time - n.onset_time for n in notes]

    # Count note names
    note_counts = {}
    for p in pitches:
        name = MIDI_TO_NOTE.get(p, f"M{p}")
        # Group by note name without octave
        base = name[:-1]  # e.g., "C#" from "C#4"
        note_counts[base] = note_counts.get(base, 0) + 1

    # Pitch range
    min_pitch = min(pitches)
    max_pitch = max(pitches)

    return {
        "count": len(notes),
        "pitch_range": f"{MIDI_TO_NOTE.get(min_pitch, min_pitch)} - {MIDI_TO_NOTE.get(max_pitch, max_pitch)}",
        "avg_velocity": np.mean(velocities),
        "avg_confidence": np.mean(confidences),
        "avg_duration": np.mean(durations),
        "note_distribution": dict(sorted(note_counts.items(), key=lambda x: -x[1])),
        "unique_pitches": len(set(pitches)),
    }


def print_timeline(notes, max_time=None, width=80):
    """Print a simple text-based timeline of detected notes."""
    if not notes:
        print("    (no notes detected)")
        return

    if max_time is None:
        max_time = max(n.offset_time for n in notes)

    # Group by pitch
    pitch_notes = {}
    for n in notes:
        name = MIDI_TO_NOTE.get(n.pitch, f"M{n.pitch}")
        if name not in pitch_notes:
            pitch_notes[name] = []
        pitch_notes[name].append(n)

    # Sort by MIDI pitch (low to high)
    sorted_names = sorted(pitch_notes.keys(),
                          key=lambda x: min(n.pitch for n in pitch_notes[x]))

    # Show first 30s and last 10s
    sections = []
    if max_time > 45:
        sections = [("First 30s", 0, 30), ("Last 10s", max_time - 10, max_time)]
    else:
        sections = [("Full", 0, max_time)]

    for label, start, end in sections:
        print(f"\n    --- {label} ({start:.0f}s - {end:.0f}s) ---")
        section_notes = [n for n in notes if n.onset_time >= start and n.onset_time < end]
        if not section_notes:
            print("    (no notes in this section)")
            continue

        # Show top 10 unique pitches in this section
        pitch_in_section = {}
        for n in section_notes:
            name = MIDI_TO_NOTE.get(n.pitch, f"M{n.pitch}")
            if name not in pitch_in_section:
                pitch_in_section[name] = 0
            pitch_in_section[name] += 1

        top_pitches = sorted(pitch_in_section.items(), key=lambda x: -x[1])[:15]
        for name, count in top_pitches:
            print(f"    {name:>5}: {'|' * min(count, 50)} ({count})")


def main():
    print("=" * 70)
    print("  YouTube Piano Detection Test")
    print("=" * 70)

    model = OnsetsFramesTFLite()
    print(f"  Model loaded: input shape {model.input_shape}")
    print()

    for song_id, info in SONG_INFO.items():
        filepath = info["file"]
        if not os.path.exists(filepath):
            print(f"  SKIP: {info['title']} (file not found: {filepath})")
            continue

        print("-" * 70)
        print(f"  {info['title']}")
        print(f"  Key: {info['key']} | Source: {info['source']}")
        print()

        # Load audio
        audio, sr = sf.read(filepath)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)  # mono
        audio = audio.astype(np.float32)

        # Only process first 60s for speed (or full if short)
        max_seconds = 60
        if len(audio) / sr > max_seconds:
            audio_clip = audio[: int(sr * max_seconds)]
            print(f"  Processing first {max_seconds}s of {len(audio)/sr:.0f}s audio (sr={sr})")
        else:
            audio_clip = audio
            print(f"  Processing full {len(audio)/sr:.0f}s audio (sr={sr})")

        t0 = time.time()
        notes = transcribe_long_audio(model, audio_clip, sr)
        elapsed = time.time() - t0

        # Analyze
        stats = analyze_notes(notes)
        print(f"  Detected: {stats['count']} notes in {elapsed:.1f}s")
        if stats['count'] > 0:
            print(f"  Pitch range: {stats['pitch_range']}")
            print(f"  Unique pitches: {stats['unique_pitches']}")
            print(f"  Avg confidence: {stats['avg_confidence']:.3f}")
            print(f"  Avg velocity: {stats['avg_velocity']:.3f}")
            print(f"  Avg duration: {stats['avg_duration']:.2f}s")

            # Note distribution (top 10)
            dist = stats['note_distribution']
            top = list(dist.items())[:10]
            print(f"  Top notes: {', '.join(f'{n}({c})' for n, c in top)}")

            # Timeline
            print_timeline(notes, max_time=min(len(audio_clip) / sr, max_seconds))

        print()

    print("=" * 70)
    print("  Done!")
    print("=" * 70)


if __name__ == "__main__":
    main()
