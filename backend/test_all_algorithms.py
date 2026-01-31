#!/usr/bin/env python3
"""
Comprehensive algorithm testing:
1. Establish ground truth (high-accuracy YIN)
2. Test YIN v3 (octave-corrected)
3. Test YIN v1 (original)
4. Compare all results
"""

import sys
from ground_truth_simple import detect_ground_truth
from optimized_yin_v3 import detect_piano_note as detect_v3
from optimized_yin import detect_piano_note as detect_v1
import wave
import numpy as np


def run_algorithm_test(audio: np.ndarray, sample_rate: int, algorithm_name: str, detect_func) -> list:
    """Run algorithm on audio and return detected notes."""
    chunk_size = 4096
    hop_size = 2048
    detected_notes = []

    current_note = None
    note_start_time = 0
    note_frequency = 0.0
    note_confidence = 0.0
    consecutive_frames = 0
    min_consecutive_frames = 3

    for i in range(0, len(audio) - chunk_size, hop_size):
        chunk = audio[i:i + chunk_size]
        current_time = i / sample_rate

        detection = detect_func(chunk.tolist(), sample_rate)

        if detection:
            note = detection['note']
            frequency = detection['frequency']
            confidence = detection['confidence']

            if note == current_note:
                consecutive_frames += 1
            else:
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

                current_note = note
                note_start_time = current_time
                note_frequency = frequency
                note_confidence = confidence
                consecutive_frames = 1

    # Final note
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

    return merged_notes


def compare_results(ground_truth: list, test_result: list, algorithm_name: str):
    """Compare algorithm results to ground truth."""
    gt_seq = [n['note'] for n in ground_truth]
    test_seq = [n['note'] for n in test_result]

    print(f"\n{'='*80}")
    print(f"ALGORITHM: {algorithm_name}")
    print(f"{'='*80}")

    print(f"\n📋 Ground Truth:  {' → '.join(gt_seq)}")
    print(f"🧪 {algorithm_name}:  {' → '.join(test_seq)}")

    # Metrics
    if len(gt_seq) == 0:
        print("\n⚠️  No ground truth - cannot validate")
        return

    # Exact match
    if gt_seq == test_seq:
        print(f"\n✅ PERFECT MATCH: {algorithm_name} is 100% accurate!")
    else:
        # Calculate note-level accuracy
        correct = sum(1 for i, (g, t) in enumerate(zip(gt_seq, test_seq[:len(gt_seq)])) if g == t)
        accuracy = (correct / len(gt_seq)) * 100 if len(gt_seq) > 0 else 0

        print(f"\n📊 RESULTS:")
        print(f"   Expected notes: {len(gt_seq)}")
        print(f"   Detected notes: {len(test_seq)}")
        print(f"   Correct notes: {correct}")
        print(f"   Accuracy: {accuracy:.1f}%")

        # Missing/Extra
        missing = [n for n in gt_seq if n not in test_seq]
        extra = [n for n in test_seq if n not in gt_seq]

        if missing:
            print(f"   ❌ Missed: {', '.join(set(missing))}")
        if extra:
            print(f"   ⚠️  Extra: {', '.join(set(extra))}")

        # Verdict
        if accuracy >= 95:
            print(f"\n✅ EXCELLENT: {algorithm_name} passed ({accuracy:.0f}% accurate)")
        elif accuracy >= 80:
            print(f"\n⚠️  GOOD: {algorithm_name} is acceptable ({accuracy:.0f}% accurate)")
        else:
            print(f"\n❌ POOR: {algorithm_name} needs improvement ({accuracy:.0f}% accurate)")

    print(f"{'='*80}\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 test_all_algorithms.py <audio.wav>")
        sys.exit(1)

    wav_file = sys.argv[1]

    print(f"\n🧪 COMPREHENSIVE ALGORITHM TEST")
    print(f"{'='*80}\n")
    print(f"Testing: {wav_file}\n")

    # 1. Ground truth
    print("STEP 1: Establishing Ground Truth (High-Accuracy YIN)")
    print("-" * 80)
    ground_truth = detect_ground_truth(wav_file)

    # Load audio for algorithm tests
    with wave.open(wav_file, 'rb') as wav:
        sample_rate = wav.getframerate()
        audio_data = wav.readframes(wav.getnframes())
        audio = np.frombuffer(audio_data, dtype=np.int16) / 32768.0
        if wav.getnchannels() == 2:
            audio = audio.reshape(-1, 2).mean(axis=1)

    # 2. Test YIN v3
    print("\nSTEP 2: Testing YIN v3 (Octave-Corrected)")
    print("-" * 80)
    yin_v3_result = run_algorithm_test(audio, sample_rate, "YIN v3", detect_v3)
    print(f"✅ YIN v3 complete: {len(yin_v3_result)} notes\n")

    # 3. Test YIN v1
    print("STEP 3: Testing YIN v1 (Original)")
    print("-" * 80)
    yin_v1_result = run_algorithm_test(audio, sample_rate, "YIN v1", detect_v1)
    print(f"✅ YIN v1 complete: {len(yin_v1_result)} notes\n")

    # 4. Compare results
    print(f"\n{'='*80}")
    print("COMPARISON RESULTS")
    print(f"{'='*80}\n")

    compare_results(ground_truth, yin_v3_result, "YIN v3 (Octave-Corrected)")
    compare_results(ground_truth, yin_v1_result, "YIN v1 (Original)")

    # Summary
    print(f"\n{'='*80}")
    print("SUMMARY")
    print(f"{'='*80}\n")

    gt_len = len(ground_truth)
    v3_len = len(yin_v3_result)
    v1_len = len(yin_v1_result)

    v3_accuracy = (sum(1 for i, (g, t) in enumerate(zip([n['note'] for n in ground_truth],
                                                          [n['note'] for n in yin_v3_result[:gt_len]])) if g == t) / gt_len * 100) if gt_len > 0 else 0
    v1_accuracy = (sum(1 for i, (g, t) in enumerate(zip([n['note'] for n in ground_truth],
                                                          [n['note'] for n in yin_v1_result[:gt_len]])) if g == t) / gt_len * 100) if gt_len > 0 else 0

    print(f"Ground Truth:  {gt_len} notes")
    print(f"YIN v3:        {v3_len} notes ({v3_accuracy:.0f}% accurate)")
    print(f"YIN v1:        {v1_len} notes ({v1_accuracy:.0f}% accurate)")

    if v3_accuracy > v1_accuracy:
        print(f"\n🏆 WINNER: YIN v3 (octave correction improved accuracy by {v3_accuracy - v1_accuracy:.0f}%)")
    elif v3_accuracy == v1_accuracy and v3_accuracy >= 95:
        print(f"\n✅ BOTH ALGORITHMS PERFECT: No difference detected")
    else:
        print(f"\n⚠️  YIN v1 performed better (or equally well)")

    print(f"{'='*80}\n")


if __name__ == "__main__":
    main()
