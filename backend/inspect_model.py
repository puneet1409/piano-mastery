#!/usr/bin/env python3
"""
Inspect Onsets and Frames TFLite model structure
"""

import numpy as np
import tensorflow as tf

model_path = "onsets_frames_wavinput.tflite"

# Load model
interpreter = tf.lite.Interpreter(model_path=model_path)
interpreter.allocate_tensors()

# Get input/output details
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

print("=" * 80)
print("MODEL STRUCTURE")
print("=" * 80)

print("\n📥 INPUT DETAILS:")
for i, detail in enumerate(input_details):
    print(f"\nInput {i}:")
    print(f"  Name: {detail['name']}")
    print(f"  Shape: {detail['shape']}")
    print(f"  Type: {detail['dtype']}")
    print(f"  Index: {detail['index']}")

print("\n📤 OUTPUT DETAILS:")
for i, detail in enumerate(output_details):
    print(f"\nOutput {i}:")
    print(f"  Name: {detail['name']}")
    print(f"  Shape: {detail['shape']}")
    print(f"  Type: {detail['dtype']}")
    print(f"  Index: {detail['index']}")

# Test with synthetic audio
print("\n" + "=" * 80)
print("TEST INFERENCE")
print("=" * 80)

# Create test audio
sample_rate = 16000
duration = 1.12  # 17920 samples / 16000 Hz = 1.12 seconds
t = np.linspace(0, duration, 17920)

# C major chord
audio = 0.3 * np.sin(2 * np.pi * 261.6 * t)  # C4
audio += 0.3 * np.sin(2 * np.pi * 329.6 * t)  # E4
audio += 0.3 * np.sin(2 * np.pi * 392.0 * t)  # G4

# Normalize
audio = audio.astype(np.float32)

print(f"\nInput audio:")
print(f"  Shape: {audio.shape}")
print(f"  Min: {audio.min():.4f}")
print(f"  Max: {audio.max():.4f}")
print(f"  Mean: {audio.mean():.4f}")
print(f"  RMS: {np.sqrt(np.mean(audio**2)):.4f}")

# Run inference
interpreter.set_tensor(input_details[0]['index'], audio)
interpreter.invoke()

print(f"\nOutput tensors:")
for i, detail in enumerate(output_details):
    output = interpreter.get_tensor(detail['index'])
    print(f"\nOutput {i} ({detail['name']}):")
    print(f"  Shape: {output.shape}")
    print(f"  Type: {output.dtype}")
    print(f"  Min: {output.min():.6f}")
    print(f"  Max: {output.max():.6f}")
    print(f"  Mean: {output.mean():.6f}")
    print(f"  Non-zero values: {np.count_nonzero(output)}")

    # Show distribution
    if output.size < 1000:
        print(f"  Values > 0.1: {np.sum(output > 0.1)}")
        print(f"  Values > 0.5: {np.sum(output > 0.5)}")
        print(f"  Values > 0.9: {np.sum(output > 0.9)}")

print("\n" + "=" * 80)
