#!/usr/bin/env python3
"""Debug: Show all candidate pitches to understand octave confusion."""
import wave
import numpy as np
import math

# Load audio
with wave.open('youtube_piano.wav', 'rb') as wav:
    sample_rate = wav.getframerate()
    audio_data = wav.readframes(wav.getnframes())
    audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0

# Analyze one problematic chunk (around 4.7s where it jumps to C2)
start_sample = int(4.7 * sample_rate)
chunk = audio[start_sample:start_sample + 4096]

# Run YIN manually
buffer_size = len(chunk)
tau_max = min(buffer_size // 2, sample_rate // 50)

# Difference function
difference = np.zeros(tau_max)
for tau in range(tau_max):
    delta = chunk[:buffer_size - tau_max] - chunk[tau:tau + buffer_size - tau_max]
    difference[tau] = np.sum(delta ** 2)

# CMND
cmnd = np.ones(tau_max)
cumulative_sum = 0.0
for tau in range(1, tau_max):
    cumulative_sum += difference[tau]
    if cumulative_sum > 0:
        cmnd[tau] = difference[tau] * tau / cumulative_sum

# Find candidates
threshold = 0.10
candidates = []
tau = 2
while tau < tau_max:
    if cmnd[tau] < threshold:
        while tau + 1 < tau_max and cmnd[tau + 1] < cmnd[tau]:
            tau += 1
        
        frequency = sample_rate / tau
        if 25 <= frequency <= 4500:
            candidates.append({
                'tau': tau,
                'frequency': frequency,
                'cmnd': cmnd[tau],
                'note': f"{['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][round(12*math.log2(frequency/440.0))%12]}{4+(round(12*math.log2(frequency/440.0))+9)//12}"
            })
    tau += 1

print("🔍 All candidate pitches at t=4.7s (where algorithm jumps to C2):\n")
print(f"{'Tau':<8} {'Frequency':<12} {'Note':<8} {'CMND':<10} {'Expected'}")
print("-" * 60)

for c in candidates:
    expected = "C4 (261.6 Hz)"
    marker = "✅" if c['note'] == 'C4' else "❌"
    print(f"{c['tau']:<8.1f} {c['frequency']:>8.1f} Hz  {marker} {c['note']:<6} {c['cmnd']:<10.4f} {expected}")

print(f"\n🎯 Found {len(candidates)} candidate pitches")
print("   YIN should pick C4 (261.6 Hz), not C2 (65.4 Hz)")
