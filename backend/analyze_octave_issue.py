#!/usr/bin/env python3
"""
Debug octave confusion issue.
Shows frame-by-frame detection to see where C2/C4 jumps occur.
"""

import wave
import numpy as np
from optimized_yin import detect_piano_note

# Load the YouTube audio
with wave.open('youtube_piano.wav', 'rb') as wav:
    sample_rate = wav.getframerate()
    audio_data = wav.readframes(wav.getnframes())
    audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0

print(f"📁 Audio: {len(audio)} samples, {len(audio)/sample_rate:.2f}s")
print(f"\n🔍 Frame-by-frame analysis (first 5 seconds):\n")

chunk_size = 4096
hop_size = 2048

print(f"{'Time':<8} {'Note':<6} {'Freq (Hz)':<12} {'Confidence':<12} {'Expected'}")
print("-" * 60)

for i in range(0, min(int(5 * sample_rate), len(audio) - chunk_size), hop_size):
    chunk = audio[i:i + chunk_size]
    time = i / sample_rate
    
    detection = detect_piano_note(chunk.tolist(), sample_rate)
    
    if detection and i % (hop_size * 10) == 0:  # Print every 10th frame
        note = detection['note']
        freq = detection['frequency']
        conf = detection['confidence']
        
        # Expected is C4 (261.6 Hz)
        expected = "C4 (261.6 Hz)"
        status = "✅" if note == "C4" else "❌"
        
        print(f"{time:>6.2f}s  {status} {note:<4} {freq:>8.1f} Hz  {conf:>8.1%}      {expected}")

print("\n🎯 The algorithm is jumping between C4 and C2 (octave error)")
print("   C2 period = 4 × C4 period")
print("   YIN is picking the wrong autocorrelation peak")
