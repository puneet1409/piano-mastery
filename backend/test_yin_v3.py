#!/usr/bin/env python3
"""
Quick test of YIN v3 on YouTube audio to check octave disambiguation.
"""
import wave
import numpy as np
from optimized_yin_v3 import detect_piano_note

print("🧪 Testing YIN v3 with octave disambiguation on YouTube audio\n")

# Load audio
with wave.open('youtube_piano.wav', 'rb') as wav:
    sample_rate = wav.getframerate()
    audio_data = wav.readframes(wav.getnframes())
    audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0

print(f"📁 Audio: {len(audio)/sample_rate:.2f}s")

chunk_size = 4096
hop_size = 2048
detected_notes = []

current_note = None
note_start_time = 0
note_frequency = 0.0
note_confidence = 0.0
consecutive_frames = 0
min_consecutive_frames = 3

print(f"\n🔍 Analyzing with YIN v3 (octave disambiguation enabled)...\n")

for i in range(0, len(audio) - chunk_size, hop_size):
    chunk = audio[i:i + chunk_size]
    current_time = i / sample_rate
    
    detection = detect_piano_note(chunk.tolist(), sample_rate)
    
    if detection:
        note = detection['note']
        frequency = detection['frequency']
        confidence = detection['confidence']
        
        if note == current_note:
            consecutive_frames += 1
        else:
            # Save previous note
            if current_note and consecutive_frames >= min_consecutive_frames:
                duration_ms = (current_time - note_start_time) * 1000
                if duration_ms > 50:
                    detected_notes.append({
                        "note": current_note,
                        "frequency": note_frequency,
                        "startTime": note_start_time,
                        "duration": duration_ms,
                        "confidence": note_confidence
                    })
            
            # Start new note
            current_note = note
            note_start_time = current_time
            note_frequency = frequency
            note_confidence = confidence
            consecutive_frames = 1

# Add final note
if current_note and consecutive_frames >= min_consecutive_frames:
    duration_ms = (len(audio) / sample_rate - note_start_time) * 1000
    if duration_ms > 50:
        detected_notes.append({
            "note": current_note,
            "frequency": note_frequency,
            "startTime": note_start_time,
            "duration": duration_ms,
            "confidence": note_confidence
        })

# Merge consecutive same notes
merged_notes = []
for note_data in detected_notes:
    if note_data['duration'] < 100:
        continue
    
    if merged_notes:
        prev = merged_notes[-1]
        time_gap = note_data['startTime'] - (prev['startTime'] + prev['duration'] / 1000)
        
        if prev['note'] == note_data['note'] and time_gap < 0.3:
            prev['duration'] = (note_data['startTime'] - prev['startTime']) * 1000 + note_data['duration']
            continue
    
    merged_notes.append(note_data)

print(f"✅ Detection complete: {len(merged_notes)} notes\n")

print("=" * 70)
print("RESULTS")
print("=" * 70)
print(f"\n📝 Detected sequence: {' → '.join([n['note'] for n in merged_notes])}")
print(f"\n📊 Details:")
for idx, n in enumerate(merged_notes, 1):
    print(f"   {idx}. {n['note']}: {n['frequency']:.1f} Hz, {n['duration']/1000:.2f}s, {n['confidence']:.0%}")

print("\n" + "=" * 70)

if len(merged_notes) == 1 and merged_notes[0]['note'] == 'C4':
    print("✅ SUCCESS: Octave disambiguation fixed the issue!")
    print("   Expected: 1 note (C4)")
    print(f"   Detected: 1 note (C4)")
elif len(merged_notes) == 1:
    print(f"✅ GOOD: Detected as single sustained note ({merged_notes[0]['note']})")
    print("   (Might be correct octave depending on actual video content)")
else:
    print("❌ Still has octave jumping:")
    print("   Expected: 1 sustained note")
    print(f"   Detected: {len(merged_notes)} notes: {' → '.join([n['note'] for n in merged_notes])}")
