#!/usr/bin/env python3
"""
Debug: See raw ML model output without filtering
"""

import numpy as np
import wave
from onsets_frames_tflite import OnsetsFramesTFLite


def load_wav(filename):
    with wave.open(filename, 'rb') as wav:
        sample_rate = wav.getframerate()
        audio_data = wav.readframes(wav.getnframes())
        audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0
        if wav.getnchannels() == 2:
            audio = audio.reshape(-1, 2).mean(axis=1)
    return audio.astype(np.float32), sample_rate


print("🔍 DEBUG: Raw ML Model Output\n")
print("=" * 80)

model = OnsetsFramesTFLite("onsets_frames_wavinput.tflite")

# Load single C4 note
audio, sr = load_wav("youtube_piano.wav")
chunk = audio[int(0.2*sr):int(0.2*sr)+17920]  # Skip attack

print(f"Audio: {len(chunk)} samples @ {sr}Hz")
print(f"Testing on single C4 note (expected: ~261 Hz)\n")

# Get ALL detected notes (no filtering)
notes = model.transcribe(chunk, sample_rate=sr, onset_threshold=0.2, frame_threshold=0.15)

print(f"Detected {len(notes)} notes (thresholds: onset=0.2, frame=0.15)\n")

# Sort by confidence
notes_sorted = sorted(notes, key=lambda n: n.confidence, reverse=True)

print("Top 15 detections by confidence:")
print("-" * 80)
print(f"{'Note':<6} {'MIDI':<5} {'Freq (Hz)':<10} {'Velocity':<9} {'Confidence':<11} {'Duration':<10}")
print("-" * 80)

for i, note in enumerate(notes_sorted[:15]):
    duration_ms = (note.offset_time - note.onset_time) * 1000
    print(f"{note.note:<6} {note.pitch:<5} {note.frequency:<10.1f} {note.velocity:<9.2f} {note.confidence:<11.2f} {duration_ms:<10.0f}ms")

print("-" * 80)

# Check if C4 (MIDI 60, ~261 Hz) is in the detections
c4_notes = [n for n in notes if n.note == 'C4']
if c4_notes:
    print(f"\n✅ C4 IS detected:")
    for n in c4_notes:
        print(f"   C4: conf={n.confidence:.2f}, vel={n.velocity:.2f}, dur={(n.offset_time-n.onset_time)*1000:.0f}ms")
else:
    print(f"\n❌ C4 NOT detected in top detections")

# Check nearby notes (C3, C5)
nearby = [n for n in notes if n.note in ['C3', 'C4', 'C5', 'G3', 'G4']]
if nearby:
    print(f"\nNearby C notes and harmonics:")
    for n in nearby:
        print(f"   {n.note}: conf={n.confidence:.2f}, vel={n.velocity:.2f}")

print("\n" + "=" * 80)
print("🎯 ANALYSIS:")
print("=" * 80)
print("""
The model is trained on piano recordings, but YouTube audio has:
- Background noise
- Compression artifacts
- Different recording quality

Possible issues:
1. Model confidence is too low for actual fundamental
2. Noise/artifacts create spurious high-confidence detections
3. Need lower thresholds or different scoring

SOLUTION:
- Lower detection thresholds (onset=0.1, frame=0.1)
- Use temporal consistency (notes sustained over time)
- Combine with spectral analysis
""")
