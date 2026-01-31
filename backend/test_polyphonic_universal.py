#!/usr/bin/env python3
"""
Test if polyphonic FFT detector can handle BOTH:
1. Single notes (monophonic)
2. Chords (polyphonic)
"""

from polyphonic_detector import PolyphonicDetector
import numpy as np
import wave
from ground_truth_simple import detect_ground_truth


def test_polyphonic_on_audio(wav_file: str, ground_truth: list) -> list:
    """Test polyphonic detector and return results."""
    # Load audio
    with wave.open(wav_file, 'rb') as wav:
        sample_rate = wav.getframerate()
        audio_data = wav.readframes(wav.getnframes())
        audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0
        if wav.getnchannels() == 2:
            audio = audio.reshape(-1, 2).mean(axis=1)

    detector = PolyphonicDetector(sample_rate=sample_rate)

    chunk_size = 4096
    hop_size = 2048
    detected_notes = []

    current_notes_str = None
    note_start_time = 0
    consecutive_frames = 0
    min_consecutive_frames = 3

    for i in range(0, len(audio) - chunk_size, hop_size):
        chunk = audio[i:i + chunk_size]
        current_time = i / sample_rate

        # Detect with polyphonic
        result = detector.detect_from_samples(chunk.tolist())

        if result and result.notes and len(result.notes) > 0:
            # Create string representation of chord/note
            notes_str = '+'.join(sorted([n.note for n in result.notes]))
            avg_freq = sum(n.frequency for n in result.notes) / len(result.notes)
            avg_conf = sum(n.confidence for n in result.notes) / len(result.notes)

            if notes_str == current_notes_str:
                consecutive_frames += 1
            else:
                # Save previous
                if current_notes_str and consecutive_frames >= min_consecutive_frames:
                    duration_ms = (current_time - note_start_time) * 1000
                    if duration_ms > 50:
                        detected_notes.append({
                            "note": current_notes_str,
                            "frequency": prev_freq,
                            "startTime": note_start_time,
                            "duration": duration_ms,
                            "confidence": prev_conf
                        })

                current_notes_str = notes_str
                note_start_time = current_time
                prev_freq = avg_freq
                prev_conf = avg_conf
                consecutive_frames = 1

    # Final note
    if current_notes_str and consecutive_frames >= min_consecutive_frames:
        duration_ms = (len(audio) / sample_rate - note_start_time) * 1000
        if duration_ms > 50:
            detected_notes.append({
                "note": current_notes_str,
                "frequency": prev_freq,
                "startTime": note_start_time,
                "duration": duration_ms,
                "confidence": prev_conf
            })

    # Merge consecutive
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

    return merged_notes


def compare_single_vs_chord(gt: list, poly_result: list):
    """Compare polyphonic detector results to ground truth."""
    
    # Expand ground truth chords if needed
    gt_notes = []
    for n in gt:
        # Ground truth is single notes, polyphonic might detect as "C4" or "C3+E4" etc
        gt_notes.append(n['note'])

    poly_notes = [n['note'] for n in poly_result]

    print(f"\n📋 Ground Truth:   {' → '.join(gt_notes)}")
    print(f"🔬 Polyphonic FFT: {' → '.join(poly_notes)}")

    # For monophonic case: exact match expected
    # For polyphonic case: may detect chords properly
    
    if len(gt_notes) == 1 and len(poly_notes) == 1 and gt_notes[0] == poly_notes[0]:
        print(f"\n✅ PERFECT: Single note detected correctly")
        return True
    
    # Count how many notes match (ignoring chord structure for now)
    matches = 0
    for i, (g, p) in enumerate(zip(gt_notes, poly_notes[:len(gt_notes)])):
        # If poly detected chord, check if ground truth note is in it
        poly_note_parts = p.split('+')
        if g in poly_note_parts or g == p:
            matches += 1

    accuracy = (matches / len(gt_notes)) * 100 if len(gt_notes) > 0 else 0

    print(f"\n📊 Accuracy: {accuracy:.0f}% ({matches}/{len(gt_notes)} notes)")

    if accuracy >= 95:
        print(f"✅ EXCELLENT")
        return True
    elif accuracy >= 80:
        print(f"⚠️  GOOD")
        return False
    else:
        print(f"❌ POOR")
        return False


print("🧪 TESTING POLYPHONIC FFT AS UNIVERSAL DETECTOR")
print("=" * 80)

# Test 1: Single note
print("\n\nTEST 1: Single Middle C Note (Monophonic)")
print("-" * 80)
gt1 = detect_ground_truth("youtube_piano.wav")
poly1 = test_polyphonic_on_audio("youtube_piano.wav", gt1)
result1 = compare_single_vs_chord(gt1, poly1)

# Test 2: Complex (scales + chords)
print("\n\nTEST 2: Scales + Polyphonic (Mixed Content)")
print("-" * 80)
gt2 = detect_ground_truth("youtube_octaves.wav")
poly2 = test_polyphonic_on_audio("youtube_octaves.wav", gt2)
result2 = compare_single_vs_chord(gt2, poly2)

# Summary
print("\n\n" + "=" * 80)
print("FINAL VERDICT")
print("=" * 80)

if result1 and result2:
    print("\n✅ POLYPHONIC FFT CAN BE UNIVERSAL DETECTOR")
    print("   Works for both single notes AND chords")
elif result1:
    print("\n⚠️  POLYPHONIC FFT: Good for single notes, struggles with complex audio")
else:
    print("\n❌ POLYPHONIC FFT: Cannot replace YIN for single notes")

print("\n")
