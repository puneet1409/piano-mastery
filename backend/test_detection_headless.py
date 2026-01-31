#!/usr/bin/env python3
"""
Headless algorithm testing script for piano pitch detection.
Tests YIN algorithm accuracy without the UI.

Usage:
    python3 test_detection_headless.py <audio_file.wav> [expected_notes]

Examples:
    # Test single note
    python3 test_detection_headless.py middle_c.wav C4

    # Test sequence
    python3 test_detection_headless.py scale.wav "C4 D4 E4 F4 G4 A4 B4 C5"

    # Test without ground truth (just show detections)
    python3 test_detection_headless.py recording.wav
"""

import sys
import numpy as np
import wave
from typing import List, Dict, Optional
from optimized_yin import detect_piano_note, frequency_to_note


def load_wav_file(filepath: str) -> tuple[np.ndarray, int]:
    """Load WAV file and return audio samples + sample rate."""
    try:
        with wave.open(filepath, 'rb') as wav:
            sample_rate = wav.getframerate()
            num_channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            num_frames = wav.getnframes()

            print(f"📁 Loading: {filepath}")
            print(f"   Sample rate: {sample_rate} Hz")
            print(f"   Channels: {num_channels}")
            print(f"   Duration: {num_frames / sample_rate:.2f}s")
            print(f"   Samples: {num_frames:,}")

            # Read audio data
            audio_data = wav.readframes(num_frames)

            # Convert to numpy array
            if sample_width == 1:
                audio = np.frombuffer(audio_data, dtype=np.uint8)
                audio = (audio - 128) / 128.0  # Convert to [-1, 1]
            elif sample_width == 2:
                audio = np.frombuffer(audio_data, dtype=np.int16)
                audio = audio / 32768.0  # Convert to [-1, 1]
            else:
                raise ValueError(f"Unsupported sample width: {sample_width}")

            # Convert stereo to mono by averaging channels
            if num_channels == 2:
                audio = audio.reshape(-1, 2).mean(axis=1)
                print(f"   Converted stereo to mono")

            return audio.astype(np.float32), sample_rate

    except FileNotFoundError:
        print(f"❌ Error: File not found: {filepath}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error loading audio: {e}")
        sys.exit(1)


def analyze_full_audio(samples: np.ndarray, sample_rate: int) -> List[Dict]:
    """
    Analyze complete audio buffer and return detected notes with timing.
    Same logic as WebSocket handler.
    """
    chunk_size = 4096
    hop_size = 2048
    detected_notes = []

    total_samples = len(samples)
    duration_sec = total_samples / sample_rate

    current_note = None
    note_start_time = 0.0
    note_frequency = 0.0
    note_confidence = 0.0
    consecutive_frames = 0
    min_consecutive_frames = 3

    print(f"\n🎯 Analyzing audio with YIN algorithm...")
    print(f"   Chunk size: {chunk_size}, Hop size: {hop_size}")

    total_chunks = (total_samples - chunk_size) // hop_size
    chunks_processed = 0

    for i in range(0, total_samples - chunk_size, hop_size):
        chunk = samples[i:i + chunk_size]
        current_time = i / sample_rate

        # Use optimized YIN for each chunk
        detection = detect_piano_note(chunk.tolist(), sample_rate)

        chunks_processed += 1
        if chunks_processed % 50 == 0:
            progress = (chunks_processed / total_chunks) * 100
            print(f"   Progress: {progress:.0f}% ({chunks_processed}/{total_chunks} chunks)")

        if detection:
            note = detection['note']
            frequency = detection['frequency']
            confidence = detection['confidence']

            if note == current_note:
                consecutive_frames += 1
            else:
                # Save previous note if it was stable
                if current_note and consecutive_frames >= min_consecutive_frames:
                    duration_ms = (current_time - note_start_time) * 1000
                    if duration_ms > 50:  # Minimum 50ms duration
                        detected_notes.append({
                            "note": current_note,
                            "frequency": note_frequency,
                            "startTime": note_start_time,
                            "duration": duration_ms,
                            "confidence": note_confidence
                        })

                # Start tracking new note
                current_note = note
                note_start_time = current_time
                note_frequency = frequency
                note_confidence = confidence
                consecutive_frames = 1

    # Add final note
    if current_note and consecutive_frames >= min_consecutive_frames:
        duration_ms = (duration_sec - note_start_time) * 1000
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
        # Filter very short detections (likely noise)
        if note_data['duration'] < 100:
            print(f"   🗑️  Filtering spurious {note_data['note']} ({note_data['duration']:.0f}ms)")
            continue

        # Merge with previous if same note and close in time
        if merged_notes:
            prev = merged_notes[-1]
            time_gap = note_data['startTime'] - (prev['startTime'] + prev['duration'] / 1000)

            if prev['note'] == note_data['note'] and time_gap < 0.3:
                print(f"   🔗 Merging consecutive {note_data['note']} ({time_gap:.2f}s gap)")
                prev['duration'] = (note_data['startTime'] - prev['startTime']) * 1000 + note_data['duration']
                continue

        merged_notes.append(note_data)

    print(f"\n✅ Analysis complete: {len(merged_notes)} notes detected ({len(detected_notes)} raw → {len(merged_notes)} merged)")

    return merged_notes


def get_note_frequency(note: str) -> float:
    """Convert note name to frequency in Hz."""
    note_offsets = {
        "C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4,
        "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2
    }

    note_name = note[:-1]
    octave = int(note[-1])

    # A4 is octave 4
    semitones_from_a4 = note_offsets.get(note_name, 0) + (octave - 4) * 12
    frequency = 440 * (2 ** (semitones_from_a4 / 12))

    return round(frequency, 2)


def calculate_cents(detected_freq: float, expected_freq: float) -> float:
    """Calculate cents deviation (1200 cents = 1 octave)."""
    if expected_freq == 0:
        return 0
    return 1200 * np.log2(detected_freq / expected_freq)


def print_results(detected_notes: List[Dict], expected_notes: Optional[List[str]] = None):
    """Print detection results with detailed analysis."""

    print("\n" + "=" * 80)
    print("DETECTION RESULTS")
    print("=" * 80)

    if not detected_notes:
        print("❌ No notes detected")
        return

    # Print detected notes sequence
    detected_sequence = " → ".join([n['note'] for n in detected_notes])
    print(f"\n📝 Detected sequence: {detected_sequence}")

    # Detailed per-note analysis
    print(f"\n📊 Detailed Analysis:")
    print(f"{'#':<4} {'Note':<6} {'Freq (Hz)':<12} {'Expected':<12} {'Deviation':<15} {'Duration':<12} {'Conf':<8} {'Status'}")
    print("-" * 100)

    for idx, note_data in enumerate(detected_notes, 1):
        note = note_data['note']
        detected_freq = note_data['frequency']
        expected_freq = get_note_frequency(note)
        cents = calculate_cents(detected_freq, expected_freq)
        deviation = abs(cents)

        # Status: ✅ < 20 cents, ⚠️ < 50 cents, ❌ >= 50 cents
        if deviation < 20:
            status = "✅ Accurate"
        elif deviation < 50:
            status = "⚠️  Slightly off"
        else:
            status = "❌ Wrong note?"

        print(f"{idx:<4} {note:<6} {detected_freq:>8.1f} Hz  {expected_freq:>8.1f} Hz  "
              f"{cents:>+6.0f} cents      {note_data['duration']:>7.0f} ms   "
              f"{note_data['confidence']:>5.0%}   {status}")

    # Summary statistics
    total_duration = sum(n['duration'] for n in detected_notes) / 1000
    avg_confidence = sum(n['confidence'] for n in detected_notes) / len(detected_notes)
    avg_cents = sum(abs(calculate_cents(n['frequency'], get_note_frequency(n['note'])))
                    for n in detected_notes) / len(detected_notes)

    print("\n" + "-" * 100)
    print(f"📈 Summary:")
    print(f"   Total notes: {len(detected_notes)}")
    print(f"   Total duration: {total_duration:.2f}s")
    print(f"   Average confidence: {avg_confidence:.1%}")
    print(f"   Average pitch deviation: {avg_cents:.0f} cents")

    # Calibration check
    signed_cents = [calculate_cents(n['frequency'], get_note_frequency(n['note']))
                    for n in detected_notes]
    avg_signed_cents = sum(signed_cents) / len(signed_cents)

    if abs(avg_signed_cents) > 10:
        print(f"\n🔧 CALIBRATION WARNING:")
        print(f"   Average deviation: {avg_signed_cents:+.0f} cents")
        print(f"   All notes are {'SHARP' if avg_signed_cents > 0 else 'FLAT'}")
        print(f"   Possible causes: sample rate mismatch, playback speed wrong")

    # Compare with expected notes
    if expected_notes:
        print("\n" + "=" * 80)
        print("ACCURACY VALIDATION")
        print("=" * 80)

        detected_sequence = [n['note'] for n in detected_notes]

        print(f"\n📋 Expected: {' → '.join(expected_notes)}")
        print(f"🎵 Detected: {' → '.join(detected_sequence)}")

        # Calculate metrics
        true_positives = sum(1 for n in detected_sequence if n in expected_notes)
        false_positives = sum(1 for n in detected_sequence if n not in expected_notes)
        false_negatives = sum(1 for n in expected_notes if n not in detected_sequence)

        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0
        f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

        print(f"\n📊 Metrics:")
        print(f"   Precision: {precision:.1%} (detected notes that were correct)")
        print(f"   Recall: {recall:.1%} (expected notes that were detected)")
        print(f"   F1 Score: {f1_score:.1%} (harmonic mean of precision and recall)")

        # Show mismatches
        missing = [n for n in expected_notes if n not in detected_sequence]
        extra = [n for n in detected_sequence if n not in expected_notes]

        if missing:
            print(f"\n❌ Missed notes: {', '.join(missing)}")
        if extra:
            print(f"⚠️  Extra notes: {', '.join(extra)}")

        # Overall result
        if f1_score >= 0.95:
            print(f"\n✅ EXCELLENT: Algorithm performed very well (F1 = {f1_score:.1%})")
        elif f1_score >= 0.80:
            print(f"\n✅ GOOD: Algorithm performed well (F1 = {f1_score:.1%})")
        elif f1_score >= 0.60:
            print(f"\n⚠️  FAIR: Algorithm needs improvement (F1 = {f1_score:.1%})")
        else:
            print(f"\n❌ POOR: Algorithm has significant issues (F1 = {f1_score:.1%})")

    print("\n" + "=" * 80 + "\n")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    audio_file = sys.argv[1]
    expected_notes = sys.argv[2].split() if len(sys.argv) > 2 else None

    # Load audio
    samples, sample_rate = load_wav_file(audio_file)

    # Analyze
    detected_notes = analyze_full_audio(samples, sample_rate)

    # Print results
    print_results(detected_notes, expected_notes)


if __name__ == "__main__":
    main()
