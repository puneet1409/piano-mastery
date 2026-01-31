#!/usr/bin/env python3
"""
Test YIN vs Magenta Onsets & Frames on Real Piano Recordings

Compares YIN pitch detection (from frontend) with Magenta transcription
to validate detection accuracy on real-world audio.
"""

import sys
import json
import os
import numpy as np
from scipy.io import wavfile
from collections import Counter
from dataclasses import dataclass
from typing import List, Tuple, Set

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from onsets_frames_tflite import OnsetsFramesTFLite

# ============================================================================
# YIN PITCH DETECTION (SIMPLIFIED PORT FROM TYPESCRIPT)
# ============================================================================

def yin_pitch_detection(samples: np.ndarray, sample_rate: int = 44100) -> List[dict]:
    """
    Simplified YIN pitch detection matching the frontend implementation.
    """
    WINDOW_SAMPLES = 3072
    HOP_SAMPLES = 512
    YIN_THRESHOLD = 0.25
    MIN_CONFIDENCE = 0.75

    detections = []

    for start in range(0, len(samples) - WINDOW_SAMPLES, HOP_SAMPLES):
        window = samples[start:start + WINDOW_SAMPLES].astype(np.float64)
        time_ms = int(start * 1000 / sample_rate)

        # YIN algorithm
        tau_min = int(sample_rate / 1000)  # ~1000 Hz max
        tau_max = int(sample_rate / 50)    # ~50 Hz min (for piano range)

        # Difference function
        d = np.zeros(tau_max)
        for tau in range(1, tau_max):
            diff = 0.0
            for i in range(len(window) - tau):
                diff += (window[i] - window[i + tau]) ** 2
            d[tau] = diff

        # Cumulative mean normalized difference
        d_prime = np.ones(tau_max)
        d_prime[0] = 1.0
        running_sum = 0.0
        for tau in range(1, tau_max):
            running_sum += d[tau]
            if running_sum > 0:
                d_prime[tau] = d[tau] * tau / running_sum
            else:
                d_prime[tau] = 1.0

        # Find first minimum below threshold
        best_tau = 0
        best_value = 1.0
        for tau in range(tau_min, tau_max - 1):
            if d_prime[tau] < YIN_THRESHOLD:
                # Parabolic interpolation
                if tau > 0 and tau < len(d_prime) - 1:
                    s0 = d_prime[tau - 1]
                    s1 = d_prime[tau]
                    s2 = d_prime[tau + 1]
                    refined = tau + (s0 - s2) / (2 * (s0 - 2 * s1 + s2)) if abs(s0 - 2 * s1 + s2) > 1e-9 else tau
                else:
                    refined = tau
                if d_prime[tau] < best_value:
                    best_tau = refined
                    best_value = d_prime[tau]
                break

        if best_tau > 0:
            frequency = sample_rate / best_tau
            confidence = 1.0 - best_value

            if confidence >= MIN_CONFIDENCE and 50 <= frequency <= 2000:
                midi = 69 + 12 * np.log2(frequency / 440.0)
                midi_rounded = int(round(midi))

                note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
                octave = (midi_rounded // 12) - 1
                note = note_names[midi_rounded % 12]
                note_name = f"{note}{octave}"

                detections.append({
                    'time_ms': time_ms,
                    'note': note_name,
                    'midi': midi_rounded,
                    'frequency': frequency,
                    'confidence': confidence
                })

    return detections


# ============================================================================
# COMPARISON LOGIC
# ============================================================================

def compare_detections(magenta_notes: list, yin_detections: list, tolerance_ms: float = 150) -> dict:
    """Compare YIN detections against Magenta ground truth."""
    matched = set()
    matched_yin = set()
    latencies = []

    for i, mag in enumerate(magenta_notes):
        mag_start_ms = mag['onset_time'] * 1000
        mag_end_ms = mag['offset_time'] * 1000

        for j, yin in enumerate(yin_detections):
            if j in matched_yin:
                continue

            if (yin['midi'] == mag['pitch'] and
                mag_start_ms - tolerance_ms <= yin['time_ms'] <= mag_end_ms + tolerance_ms):
                matched.add(i)
                matched_yin.add(j)
                latency = yin['time_ms'] - mag_start_ms
                if latency >= 0:
                    latencies.append(latency)
                break

    missed = [magenta_notes[i] for i in range(len(magenta_notes)) if i not in matched]
    accuracy = len(matched) / len(magenta_notes) if magenta_notes else 0
    avg_latency = sum(latencies) / len(latencies) if latencies else 0

    return {
        'magenta_notes': len(magenta_notes),
        'yin_detections': len(yin_detections),
        'matched': len(matched),
        'accuracy': accuracy,
        'missed_count': len(missed),
        'avg_latency_ms': avg_latency,
        'missed_notes': missed[:10]  # First 10 missed
    }


# ============================================================================
# MAIN TEST
# ============================================================================

def test_file(wav_path: str, model: OnsetsFramesTFLite, max_duration_sec: float = 30) -> dict:
    """Test a single WAV file."""
    print(f"\n{'='*60}")
    print(f"Testing: {os.path.basename(wav_path)}")
    print('='*60)

    # Load audio
    sr, audio = wavfile.read(wav_path)

    # Normalize to float32 [-1, 1]
    if audio.dtype == np.int16:
        audio = audio.astype(np.float32) / 32768.0
    elif audio.dtype == np.int32:
        audio = audio.astype(np.float32) / 2147483648.0

    # Ensure mono
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    duration = len(audio) / sr
    print(f"Duration: {duration:.1f}s, Sample rate: {sr}Hz")

    # Limit to max duration for testing
    max_samples = int(max_duration_sec * sr)
    audio_chunk = audio[:max_samples]
    chunk_duration = len(audio_chunk) / sr

    print(f"Analyzing first {chunk_duration:.1f}s...")

    # Run Magenta transcription
    print("\n🎹 Running Magenta Onsets & Frames...")
    chunk_window = 1.12  # Model window
    chunk_samples = int(chunk_window * sr)
    hop_samples = chunk_samples // 2

    all_notes = []
    for start in range(0, len(audio_chunk) - chunk_samples + 1, hop_samples):
        chunk = audio_chunk[start:start + chunk_samples]
        chunk_offset = start / sr

        notes = model.transcribe(chunk, sample_rate=sr, mode='chord_or_song')

        for note in notes:
            all_notes.append({
                'note': note.note,
                'pitch': note.pitch,
                'onset_time': note.onset_time + chunk_offset,
                'offset_time': note.offset_time + chunk_offset,
                'confidence': note.confidence
            })

    # Deduplicate
    magenta_notes = []
    for note in sorted(all_notes, key=lambda n: (n['pitch'], n['onset_time'])):
        is_dup = False
        for existing in magenta_notes:
            if (existing['pitch'] == note['pitch'] and
                abs(existing['onset_time'] - note['onset_time']) < 0.1):
                is_dup = True
                break
        if not is_dup:
            magenta_notes.append(note)

    print(f"   Magenta detected {len(magenta_notes)} notes")

    # Summarize Magenta notes
    mag_note_counts = Counter(n['note'] for n in magenta_notes)
    top_mag = mag_note_counts.most_common(8)
    print(f"   Top notes: {', '.join(f'{n}({c})' for n, c in top_mag)}")

    # Run YIN detection
    print("\n🎵 Running YIN pitch detection...")
    yin_detections = yin_pitch_detection(audio_chunk, sr)
    print(f"   YIN made {len(yin_detections)} detections")

    # Summarize YIN detections
    yin_note_counts = Counter(d['note'] for d in yin_detections)
    top_yin = yin_note_counts.most_common(8)
    print(f"   Top notes: {', '.join(f'{n}({c})' for n, c in top_yin)}")

    # Compare
    print("\n📊 Comparison: YIN vs Magenta")
    result = compare_detections(magenta_notes, yin_detections)

    print(f"   Magenta notes: {result['magenta_notes']}")
    print(f"   YIN detections: {result['yin_detections']}")
    print(f"   Matched: {result['matched']} ({result['accuracy']*100:.1f}%)")
    print(f"   Avg latency: {result['avg_latency_ms']:.0f}ms")
    print(f"   Missed: {result['missed_count']}")

    if result['missed_notes']:
        missed_str = ', '.join(f"{n['note']}@{n['onset_time']*1000:.0f}ms"
                               for n in result['missed_notes'][:5])
        print(f"   Missed notes: {missed_str}...")

    return result


def main():
    """Run all tests."""
    print("=" * 60)
    print("YIN vs Magenta Onsets & Frames - Real Audio Test")
    print("=" * 60)

    # Check for model
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, 'onsets_frames_wavinput.tflite')

    if not os.path.exists(model_path):
        print(f"❌ Model not found at: {model_path}")
        return

    # Load model
    print("\n🔧 Loading Magenta TFLite model...")
    model = OnsetsFramesTFLite(model_path)

    # Test files
    test_audio_dir = os.path.join(script_dir, '..', 'frontend', 'test-audio')
    test_files = [
        'fur_elise_real.wav',
        'canon_in_d_real.wav',
        'river_flows_real.wav',
        'moonlight_sonata_real.wav',
        'clair_de_lune_real.wav',
    ]

    results = []
    for filename in test_files:
        wav_path = os.path.join(test_audio_dir, filename)
        if os.path.exists(wav_path):
            try:
                result = test_file(wav_path, model, max_duration_sec=30)
                results.append((filename, result))
            except Exception as e:
                print(f"\n❌ Error testing {filename}: {e}")
        else:
            print(f"\n⚠️  File not found: {filename}")

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for filename, result in results:
        print(f"\n{filename}:")
        print(f"   Accuracy: {result['accuracy']*100:.1f}%")
        print(f"   Matched: {result['matched']}/{result['magenta_notes']}")
        print(f"   Avg latency: {result['avg_latency_ms']:.0f}ms")

    # Overall stats
    if results:
        overall_matched = sum(r[1]['matched'] for r in results)
        overall_total = sum(r[1]['magenta_notes'] for r in results)
        overall_accuracy = overall_matched / overall_total if overall_total > 0 else 0

        print(f"\n{'='*60}")
        print(f"OVERALL: {overall_matched}/{overall_total} = {overall_accuracy*100:.1f}% accuracy")
        print("=" * 60)


if __name__ == '__main__':
    main()
