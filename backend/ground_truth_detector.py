#!/usr/bin/env python3
"""
Ground Truth Pitch Detection using Librosa's pYIN algorithm.
High-accuracy, high-latency detection for establishing reference truth.

pYIN is a state-of-the-art pitch tracking algorithm that combines:
- YIN algorithm (robust fundamental frequency estimation)
- Hidden Markov Model for temporal smoothing
- Probabilistic voicing detection

This is MUCH slower but more accurate than our real-time YIN.
"""

import librosa
import numpy as np
import wave
import math
from typing import List, Dict


def frequency_to_note(frequency: float) -> str:
    """Convert frequency to note name."""
    if frequency <= 0 or np.isnan(frequency):
        return None

    semitones_from_a4 = 12 * math.log2(frequency / 440.0)
    semitone = round(semitones_from_a4)
    note_in_octave = semitone % 12
    octave = 4 + (semitone + 9) // 12

    note_names = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"]
    note_name = note_names[note_in_octave]

    if 0 <= octave <= 8:
        return f"{note_name}{octave}"
    return None


def detect_ground_truth(wav_file: str) -> List[Dict]:
    """
    High-accuracy pitch detection using librosa's pYIN algorithm.

    Returns list of detected notes with timing, similar to our YIN output.
    """
    print(f"🔬 GROUND TRUTH DETECTION (High-Accuracy Mode)")
    print(f"   Using: Librosa pYIN algorithm (research-grade)")
    print(f"   Expected latency: 5-10x slower than real-time YIN\n")

    # Load audio with librosa
    audio, sr = librosa.load(wav_file, sr=None, mono=True)
    duration = len(audio) / sr

    print(f"📁 Loaded: {wav_file}")
    print(f"   Sample rate: {sr} Hz")
    print(f"   Duration: {duration:.2f}s")
    print(f"   Samples: {len(audio):,}\n")

    print("🎯 Running pYIN pitch tracking...")
    print("   (This may take 10-30 seconds for long audio)\n")

    # Run pYIN algorithm with high-quality parameters
    # frame_length: larger = more accurate but slower
    # hop_length: smaller = better time resolution but slower
    f0, voiced_flag, voiced_probs = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz('C2'),  # 65 Hz (lowest piano note we care about)
        fmax=librosa.note_to_hz('C7'),  # 2093 Hz (highest piano note we care about)
        sr=sr,
        frame_length=2048,  # Larger for better accuracy
        hop_length=512,     # Smaller for better time resolution
        fill_na=None        # Don't fill missing values
    )

    # Convert frame indices to time
    times = librosa.frames_to_time(
        np.arange(len(f0)),
        sr=sr,
        hop_length=512
    )

    print(f"✅ pYIN complete: {len(f0)} frames analyzed\n")

    # Convert frame-by-frame detections to note events
    detected_notes = []
    current_note = None
    note_start_time = 0.0
    note_frequencies = []
    consecutive_frames = 0
    min_consecutive_frames = 5  # Require stable detection (more frames than our YIN)

    for i, (time, freq, voiced) in enumerate(zip(times, f0, voiced_flag)):
        if voiced and not np.isnan(freq):
            note = frequency_to_note(freq)

            if note == current_note:
                consecutive_frames += 1
                note_frequencies.append(freq)
            else:
                # Save previous note
                if current_note and consecutive_frames >= min_consecutive_frames:
                    duration_ms = (time - note_start_time) * 1000
                    avg_freq = np.median(note_frequencies)  # Use median to avoid outliers

                    if duration_ms > 50:
                        detected_notes.append({
                            'note': current_note,
                            'frequency': float(avg_freq),
                            'startTime': note_start_time,
                            'duration': duration_ms,
                            'confidence': 0.98  # pYIN is highly confident
                        })

                # Start new note
                current_note = note
                note_start_time = time
                note_frequencies = [freq]
                consecutive_frames = 1

    # Add final note
    if current_note and consecutive_frames >= min_consecutive_frames:
        duration_ms = (duration - note_start_time) * 1000
        avg_freq = np.median(note_frequencies)

        if duration_ms > 50:
            detected_notes.append({
                'note': current_note,
                'frequency': float(avg_freq),
                'startTime': note_start_time,
                'duration': duration_ms,
                'confidence': 0.98
            })

    # Merge consecutive same notes (post-processing)
    merged_notes = []
    for note_data in detected_notes:
        if note_data['duration'] < 100:  # Filter very short
            continue

        if merged_notes:
            prev = merged_notes[-1]
            time_gap = note_data['startTime'] - (prev['startTime'] + prev['duration'] / 1000)

            if prev['note'] == note_data['note'] and time_gap < 0.3:
                # Merge
                prev['duration'] = (note_data['startTime'] - prev['startTime']) * 1000 + note_data['duration']
                # Update frequency to average
                prev['frequency'] = (prev['frequency'] + note_data['frequency']) / 2
                continue

        merged_notes.append(note_data)

    print(f"📊 Ground truth: {len(merged_notes)} notes detected ({len(detected_notes)} raw → {len(merged_notes)} merged)")
    print(f"   Sequence: {' → '.join([n['note'] for n in merged_notes])}\n")

    return merged_notes


def compare_algorithms(wav_file: str, ground_truth: List[Dict], test_result: List[Dict], algorithm_name: str):
    """
    Compare test algorithm results against ground truth.
    """
    print("=" * 80)
    print(f"ALGORITHM VALIDATION: {algorithm_name}")
    print("=" * 80)

    gt_sequence = [n['note'] for n in ground_truth]
    test_sequence = [n['note'] for n in test_result]

    print(f"\n📋 Ground Truth (pYIN):     {' → '.join(gt_sequence)}")
    print(f"🧪 Test Algorithm ({algorithm_name}): {' → '.join(test_sequence)}")

    # Calculate metrics
    if len(gt_sequence) == 0:
        print("\n⚠️  No ground truth notes detected - cannot validate")
        return

    # Sequence match
    if gt_sequence == test_sequence:
        print(f"\n✅ PERFECT MATCH: Sequences are identical!")
    else:
        print(f"\n❌ MISMATCH:")
        print(f"   Expected: {len(gt_sequence)} notes")
        print(f"   Detected: {len(test_sequence)} notes")

        # Show differences
        missing = [n for n in gt_sequence if n not in test_sequence]
        extra = [n for n in test_sequence if n not in gt_sequence]

        if missing:
            print(f"   Missing notes: {', '.join(set(missing))}")
        if extra:
            print(f"   Extra notes: {', '.join(set(extra))}")

    # Detailed comparison (if sequences are similar length)
    if abs(len(gt_sequence) - len(test_sequence)) <= 2:
        print(f"\n📊 Note-by-Note Comparison:")
        print(f"{'#':<4} {'Ground Truth':<15} {'Test Result':<15} {'Freq Diff':<15} {'Status'}")
        print("-" * 80)

        for i in range(max(len(ground_truth), len(test_result))):
            if i < len(ground_truth) and i < len(test_result):
                gt_note = ground_truth[i]
                test_note = test_result[i]

                freq_diff = abs(gt_note['frequency'] - test_note['frequency'])
                match = "✅" if gt_note['note'] == test_note['note'] else "❌"

                print(f"{i+1:<4} {gt_note['note']:<6} ({gt_note['frequency']:>6.1f}Hz)  "
                      f"{test_note['note']:<6} ({test_note['frequency']:>6.1f}Hz)  "
                      f"{freq_diff:>6.1f} Hz       {match}")
            elif i < len(ground_truth):
                print(f"{i+1:<4} {ground_truth[i]['note']:<15} {'(missing)':<15} {'N/A':<15} ❌")
            else:
                print(f"{i+1:<4} {'(missing)':<15} {test_result[i]['note']:<15} {'N/A':<15} ❌")

    # Overall verdict
    if gt_sequence == test_sequence:
        print(f"\n🎯 VERDICT: {algorithm_name} is ACCURATE (matches ground truth)")
    elif len(gt_sequence) == len(test_sequence) and len(gt_sequence) > 0:
        accuracy = sum(1 for g, t in zip(gt_sequence, test_sequence) if g == t) / len(gt_sequence)
        print(f"\n⚠️  VERDICT: {algorithm_name} has {accuracy:.0%} note accuracy")
    else:
        print(f"\n❌ VERDICT: {algorithm_name} has significant errors")

    print("=" * 80 + "\n")


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 ground_truth_detector.py <audio.wav>")
        sys.exit(1)

    wav_file = sys.argv[1]
    ground_truth = detect_ground_truth(wav_file)

    # Print detailed results
    print("=" * 80)
    print("GROUND TRUTH RESULTS (pYIN Algorithm)")
    print("=" * 80)
    print(f"\n📝 Detected sequence: {' → '.join([n['note'] for n in ground_truth])}")
    print(f"\n📊 Detailed breakdown:")
    print(f"{'#':<4} {'Note':<6} {'Frequency':<12} {'Duration':<12} {'Start Time'}")
    print("-" * 60)

    for idx, note in enumerate(ground_truth, 1):
        print(f"{idx:<4} {note['note']:<6} {note['frequency']:>8.1f} Hz  "
              f"{note['duration']/1000:>7.2f}s      {note['startTime']:>7.2f}s")

    total_duration = sum(n['duration'] for n in ground_truth) / 1000
    print(f"\n📈 Summary:")
    print(f"   Total notes: {len(ground_truth)}")
    print(f"   Total duration: {total_duration:.2f}s")
    print("=" * 80)
