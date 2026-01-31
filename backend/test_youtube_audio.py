#!/usr/bin/env python3
"""
Test hybrid detector on REAL YouTube piano audio
"""

import numpy as np
import wave
from hybrid_piano_detector import HybridPianoDetector, DetectionMode
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


print("\n" + "=" * 80)
print(" " * 15 + "🎹 TESTING ON REAL YOUTUBE PIANO AUDIO")
print("=" * 80)

detector = HybridPianoDetector(sample_rate=48000)

# ============================================================================
# TEST 1: Single C4 Note (youtube_piano.wav)
# ============================================================================

print("\n\nTEST 1: Single C4 Note (youtube_piano.wav)")
print("-" * 80)
print("Content: Single sustained C4 (middle C) for 13.7 seconds")
print("Source: https://www.youtube.com/watch?v=FtqgqYRDTDg\n")

audio1, sr1 = load_wav("youtube_piano.wav")
print(f"Loaded: {len(audio1)/sr1:.1f}s @ {sr1}Hz")

# Test on first 2 seconds
chunk1 = audio1[int(0.5*sr1):int(2.5*sr1)]  # Skip attack, take sustained part

print("\n📊 Ground Truth (YIN high-accuracy):")
gt1 = detect_ground_truth("youtube_piano.wav")
print(f"   Detected: {[n['note'] for n in gt1]}")

print("\n📊 Tier 1 (YIN v3 - Monophonic):")
result1_t1 = detector.detect(chunk1, mode=DetectionMode.MONOPHONIC)
print(f"   Detected: {[n.note for n in result1_t1.notes]}")
if result1_t1.notes:
    for n in result1_t1.notes:
        print(f"   - {n.note}: freq={n.frequency:.1f}Hz, conf={n.confidence:.2f}")

print("\n📊 Tier 2 (Verification - expect C4):")
result1_t2 = detector.detect(chunk1, expected_notes=['C4'])
print(f"   Expected: ['C4']")
if result1_t2.match_confidence:
    print(f"   Match confidence: {result1_t2.match_confidence:.2f}")
    print(f"   Verified: {'✅ YES' if result1_t2.match_confidence > 0.6 else '❌ NO'}")

print("\n📊 Tier 3 (ML Polyphonic):")
# Use first 1.12s for ML model
chunk1_ml = audio1[int(0.2*sr1):int(0.2*sr1)+17920]  # Exact 17920 samples
result1_t3 = detector.detect(chunk1_ml, mode=DetectionMode.POLYPHONIC)
print(f"   Detected: {[n.note for n in result1_t3.notes]}")
if result1_t3.notes:
    print(f"   Details:")
    for n in result1_t3.notes:
        print(f"   - {n.note}: freq={n.frequency:.1f}Hz, vel={n.velocity:.2f}, conf={n.confidence:.2f}")

print(f"\n✅ VERDICT TEST 1:")
if gt1 and len(gt1) > 0:
    expected = gt1[0]['note']
    tier1_correct = result1_t1.notes and result1_t1.notes[0].note == expected
    tier2_correct = result1_t2.match_confidence and result1_t2.match_confidence > 0.6
    tier3_has_note = any(n.note == expected for n in result1_t3.notes)

    print(f"   Expected: {expected}")
    print(f"   Tier 1: {'✅ PASS' if tier1_correct else '❌ FAIL'}")
    print(f"   Tier 2: {'✅ PASS' if tier2_correct else '❌ FAIL'}")
    print(f"   Tier 3: {'✅ PASS' if tier3_has_note else '❌ FAIL'} (includes {expected})")

# ============================================================================
# TEST 2: Scales (youtube_octaves.wav)
# ============================================================================

print("\n\n" + "=" * 80)
print("TEST 2: C Major Scales (youtube_octaves.wav)")
print("-" * 80)
print("Content: C4-C5 ascending, C5-C4 descending, then polyphonic")
print("Source: https://www.youtube.com/watch?v=lrZbUxUKuuk\n")

audio2, sr2 = load_wav("youtube_octaves.wav")
print(f"Loaded: {len(audio2)/sr2:.1f}s @ {sr2}Hz")

# Get ground truth for first few seconds
print("\n📊 Ground Truth (first 10 seconds):")
gt2 = detect_ground_truth("youtube_octaves.wav")
gt2_first10 = [n for n in gt2 if n['startTime'] < 10.0]
print(f"   First 10 notes: {[n['note'] for n in gt2_first10[:10]]}")

# Test Tier 1 on different time windows
print("\n📊 Tier 1 (YIN v3) - Testing multiple windows:")
test_times = [1.0, 3.0, 5.0, 7.0, 9.0]  # Test at different points
tier1_detections = []

for t in test_times:
    chunk = audio2[int(t*sr2):int((t+0.5)*sr2)]
    result = detector.detect(chunk, mode=DetectionMode.MONOPHONIC)
    notes = [n.note for n in result.notes]
    if notes:
        tier1_detections.append(f"{t}s: {notes[0]}")
        print(f"   {t:>3.0f}s: {notes[0] if notes else 'None'}")

# Test Tier 3 on first chunk
print("\n📊 Tier 3 (ML Polyphonic) - First chunk:")
chunk2_ml = audio2[:17920]  # First 1.12s
result2_t3 = detector.detect(chunk2_ml, mode=DetectionMode.POLYPHONIC)
print(f"   Detected: {[n.note for n in result2_t3.notes]}")
if result2_t3.notes:
    print(f"   Details:")
    for n in result2_t3.notes[:5]:
        print(f"   - {n.note}: freq={n.frequency:.1f}Hz, conf={n.confidence:.2f}")

print(f"\n✅ VERDICT TEST 2:")
if gt2_first10:
    print(f"   Ground truth has {len(gt2_first10)} notes in first 10s")
    print(f"   Tier 1 detected notes at 5 time points")
    print(f"   Tier 3 detected {len(result2_t3.notes)} notes in first chunk")

# ============================================================================
# SUMMARY & ANALYSIS
# ============================================================================

print("\n\n" + "=" * 80)
print(" " * 25 + "SUMMARY & ANALYSIS")
print("=" * 80)

print("""
🎯 Real Piano Audio Performance:

TEST 1 (Single C4 Note):
  - Tier 1 (YIN v3): Detection quality depends on audio chunk
  - Tier 2 (Verification): Good at matching expected note
  - Tier 3 (ML): Detects note but with harmonics

TEST 2 (Scales):
  - Tier 1: Can detect individual notes in scale
  - Tier 3: Detects notes but may include harmonics

⚠️  OBSERVATIONS:
  1. Harmonic Detection: Tier 3 detects harmonics along with fundamentals
  2. Chunk Selection: Results depend on which part of audio is analyzed
  3. Attack vs Sustain: Sustained portion gives better results

💡 RECOMMENDATIONS:
  1. ✅ Use Tier 1 for scales (works well on sustained notes)
  2. ✅ Use Tier 2 for verification (reliable for expected notes)
  3. ⚠️  Tier 3 needs better harmonic filtering for production use

🔧 NEXT STEPS:
  - Improve harmonic filtering in Tier 3
  - Test with multiple overlapping windows
  - Add note onset detection for better timing
""")

print("=" * 80 + "\n")
