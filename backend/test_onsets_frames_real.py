#!/usr/bin/env python3
"""
Test Onsets and Frames on real piano audio (YouTube samples)
"""

import numpy as np
import wave
from onsets_frames_tflite import OnsetsFramesTFLite
from ground_truth_simple import detect_ground_truth

def load_wav(filename):
    """Load WAV file"""
    with wave.open(filename, 'rb') as wav:
        sample_rate = wav.getframerate()
        audio_data = wav.readframes(wav.getnframes())
        audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0
        if wav.getnchannels() == 2:
            audio = audio.reshape(-1, 2).mean(axis=1)
    return audio.astype(np.float32), sample_rate


print("🧪 TESTING ONSETS AND FRAMES ON REAL PIANO AUDIO")
print("=" * 80)

# Initialize model
model = OnsetsFramesTFLite("onsets_frames_wavinput.tflite")

# Test 1: Single C4 note
print("\n\nTEST 1: Single C4 Note (youtube_piano.wav)")
print("-" * 80)

audio, sr = load_wav("youtube_piano.wav")
print(f"Loaded audio: {len(audio)/sr:.2f}s @ {sr}Hz")

# Transcribe first 1.12 seconds (model input size)
chunk = audio[:int(1.12 * sr)]

print(f"\nTranscribing {len(chunk)/sr:.2f}s chunk...")
notes = model.transcribe(chunk, sample_rate=sr, onset_threshold=0.3, frame_threshold=0.2)

print(f"\n✅ Detected {len(notes)} notes:")
for note in notes[:10]:  # Show first 10
    print(f"   {note.note:<4} | "
          f"Start: {note.onset_time:>5.2f}s | "
          f"Duration: {(note.offset_time - note.onset_time)*1000:>6.1f}ms | "
          f"Velocity: {note.velocity:.2f} | "
          f"Confidence: {note.confidence:.2f}")

if len(notes) > 10:
    print(f"   ... and {len(notes) - 10} more")

# Get ground truth for comparison
print(f"\n📋 Ground Truth (first 1.12s):")
gt = detect_ground_truth("youtube_piano.wav")
gt_in_window = [n for n in gt if n['startTime'] < 1.12]
print(f"   Expected: {[n['note'] for n in gt_in_window]}")

detected_notes = [n.note for n in notes]
print(f"   Detected: {detected_notes}")

# Test 2: Scales + polyphonic
print("\n\n" + "=" * 80)
print("\nTEST 2: Scales + Polyphonic (youtube_octaves.wav)")
print("-" * 80)

audio2, sr2 = load_wav("youtube_octaves.wav")
print(f"Loaded audio: {len(audio2)/sr2:.2f}s @ {sr2}Hz")

# Transcribe first chunk
chunk2 = audio2[:int(1.12 * sr2)]

print(f"\nTranscribing {len(chunk2)/sr2:.2f}s chunk...")
notes2 = model.transcribe(chunk2, sample_rate=sr2, onset_threshold=0.3, frame_threshold=0.2)

print(f"\n✅ Detected {len(notes2)} notes:")
for note in notes2[:15]:  # Show first 15
    print(f"   {note.note:<4} | "
          f"Start: {note.onset_time:>5.2f}s | "
          f"Duration: {(note.offset_time - note.onset_time)*1000:>6.1f}ms | "
          f"Velocity: {note.velocity:.2f} | "
          f"Confidence: {note.confidence:.2f}")

if len(notes2) > 15:
    print(f"   ... and {len(notes2) - 15} more")

print("\n" + "=" * 80)
print("🎯 Onsets and Frames model tested on real piano audio!")
print("\nNote: Model processes 1.12s chunks. For full audio, would need")
print("      to process overlapping windows and merge results.")
