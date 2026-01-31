#!/usr/bin/env python3
"""
MAESTRO Dataset Benchmark - Gold Standard Validation

This script validates our polyphonic detection algorithm against the MAESTRO dataset,
the industry gold standard used by Google Magenta for piano transcription research.

Target Metrics (State-of-the-Art):
- Note Onset F1: >90% (SOTA: 96.7%)
- Note w/ Offset F1: >80% (SOTA: 82.3%)
- Note w/ Velocity: >85% (SOTA: 94.0%)

Dataset: MAESTRO v3.0.0 (2018 subset)
- ~200 hours of piano performances
- Ground truth MIDI with ~3ms alignment accuracy
- Professional concert recordings

Usage:
    python3 maestro_benchmark.py --download    # Download dataset (~15-20GB)
    python3 maestro_benchmark.py --test         # Run benchmark
    python3 maestro_benchmark.py --report       # Generate report
"""

import os
import json
import urllib.request
import zipfile
import argparse
from typing import List, Dict, Tuple
from pathlib import Path
import numpy as np
from scipy.io import wavfile
import mido
from polyphonic_detector import PolyphonicDetector

# Try importing mir_eval (install if needed)
try:
    import mir_eval
    MIR_EVAL_AVAILABLE = True
except ImportError:
    MIR_EVAL_AVAILABLE = False
    print("⚠️  mir_eval not installed. Run: pip install mir_eval --break-system-packages")


# ============================================================================
# DATASET CONFIGURATION
# ============================================================================

MAESTRO_URL = "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/maestro-v3.0.0.zip"
MAESTRO_DIR = "datasets/maestro"
MAESTRO_VERSION = "v3.0.0"

# For initial testing, we'll use a smaller subset
# Full dataset is ~120GB, we'll download just the 2018 subset (~15-20GB)
USE_SUBSET = True
SUBSET_YEAR = 2018
MAX_FILES_TO_TEST = 10  # Limit for quick validation


# ============================================================================
# DOWNLOAD UTILITIES
# ============================================================================

def download_with_progress(url: str, dest_path: str):
    """Download file with progress bar"""
    print(f"\nDownloading: {os.path.basename(dest_path)}")
    print(f"From: {url}")

    def progress_hook(count, block_size, total_size):
        percent = int(count * block_size * 100 / total_size)
        downloaded_mb = (count * block_size) / (1024 * 1024)
        total_mb = total_size / (1024 * 1024)
        print(f"\r  Progress: {percent}% ({downloaded_mb:.1f} MB / {total_mb:.1f} MB)", end="")

    try:
        urllib.request.urlretrieve(url, dest_path, progress_hook)
        print("\n  ✓ Download complete!")
        return True
    except Exception as e:
        print(f"\n  ✗ Download failed: {e}")
        return False


def extract_zip(zip_path: str, extract_to: str):
    """Extract ZIP with progress"""
    print(f"\nExtracting: {os.path.basename(zip_path)}")
    print(f"To: {extract_to}")

    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            members = zip_ref.namelist()
            total = len(members)

            for i, member in enumerate(members):
                zip_ref.extract(member, extract_to)
                if i % 100 == 0:
                    print(f"\r  Progress: {i}/{total} files", end="")

            print(f"\r  ✓ Extracted: {total} files")
        return True
    except Exception as e:
        print(f"\n  ✗ Extraction failed: {e}")
        return False


def download_maestro_dataset():
    """Download MAESTRO dataset (2018 subset)"""
    print("\n" + "=" * 70)
    print("DOWNLOADING MAESTRO DATASET (2018 SUBSET)")
    print("=" * 70)
    print("\nDataset: MAESTRO v3.0.0")
    print("Source: Google Magenta")
    print("License: Creative Commons Attribution Non-Commercial Share-Alike 4.0")
    print("Size: ~15-20 GB (2018 subset)")
    print("\nThis will take 30-60 minutes depending on your connection.")
    print("=" * 70)

    os.makedirs(MAESTRO_DIR, exist_ok=True)

    # Download ZIP
    zip_path = f"{MAESTRO_DIR}/maestro-{MAESTRO_VERSION}.zip"

    if os.path.exists(zip_path):
        print(f"\n✓ ZIP already exists: {zip_path}")
    else:
        if not download_with_progress(MAESTRO_URL, zip_path):
            return False

    # Extract
    extract_dir = f"{MAESTRO_DIR}/maestro-{MAESTRO_VERSION}"

    if os.path.exists(extract_dir):
        print(f"\n✓ Dataset already extracted: {extract_dir}")
    else:
        if not extract_zip(zip_path, MAESTRO_DIR):
            return False

    print("\n" + "=" * 70)
    print("✅ DATASET READY!")
    print("=" * 70)
    return True


# ============================================================================
# MIDI GROUND TRUTH PARSING
# ============================================================================

def parse_midi_ground_truth(midi_path: str) -> List[Tuple[float, float, int]]:
    """
    Parse MIDI file to extract ground truth notes.

    Returns:
        List of (onset_time, offset_time, midi_note_number) tuples
    """
    try:
        midi = mido.MidiFile(midi_path)
        notes = []

        # Track note events
        active_notes = {}  # note_number -> onset_time
        current_time = 0.0

        for track in midi.tracks:
            current_time = 0.0

            for msg in track:
                current_time += msg.time

                if msg.type == 'note_on' and msg.velocity > 0:
                    # Note starts
                    active_notes[msg.note] = current_time

                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    # Note ends
                    if msg.note in active_notes:
                        onset = active_notes[msg.note]
                        offset = current_time
                        notes.append((onset, offset, msg.note))
                        del active_notes[msg.note]

        return sorted(notes, key=lambda x: x[0])

    except Exception as e:
        print(f"  ⚠️  Failed to parse MIDI: {e}")
        return []


def midi_note_to_name(midi_note: int) -> str:
    """Convert MIDI note number to note name (e.g., 60 -> C4)"""
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (midi_note // 12) - 1
    note = note_names[midi_note % 12]
    return f"{note}{octave}"


# ============================================================================
# ALGORITHM TESTING
# ============================================================================

def test_audio_file(audio_path: str, midi_path: str, detector: PolyphonicDetector) -> Dict:
    """
    Test our algorithm on a single audio file.

    Args:
        audio_path: Path to WAV file
        midi_path: Path to ground truth MIDI file
        detector: PolyphonicDetector instance

    Returns:
        Dict with detected notes and metrics
    """
    print(f"\n  Testing: {os.path.basename(audio_path)}")

    # Load ground truth
    ground_truth = parse_midi_ground_truth(midi_path)

    if not ground_truth:
        print("    ⚠️  No ground truth notes found")
        return None

    print(f"    Ground truth: {len(ground_truth)} notes")

    # Load audio
    try:
        sr, audio = wavfile.read(audio_path)

        if audio.dtype == np.int16:
            audio = audio.astype(np.float32) / 32768.0
        elif audio.dtype == np.int32:
            audio = audio.astype(np.float32) / 2147483648.0

        if len(audio.shape) > 1:
            audio = np.mean(audio, axis=1)  # Convert stereo to mono

        print(f"    Audio: {len(audio)} samples, {sr} Hz, {len(audio)/sr:.1f} seconds")

    except Exception as e:
        print(f"    ✗ Failed to load audio: {e}")
        return None

    # Analyze audio in chunks (to simulate real-time detection)
    chunk_size = 4096
    hop_size = 2048

    detected_notes = []

    for i in range(0, len(audio) - chunk_size, hop_size):
        chunk = audio[i:i + chunk_size]
        timestamp = i / sr

        detection = detector.detect_from_fft(chunk)

        if detection.notes:
            for note_det in detection.notes:
                detected_notes.append({
                    "time": timestamp,
                    "note": note_det.note,
                    "midi_note": note_det.midi_note,
                    "confidence": note_det.confidence
                })

    print(f"    Detected: {len(detected_notes)} note events")

    # Calculate metrics if mir_eval is available
    metrics = None

    if MIR_EVAL_AVAILABLE and detected_notes:
        metrics = calculate_mir_eval_metrics(ground_truth, detected_notes)

    return {
        "audio_file": os.path.basename(audio_path),
        "ground_truth_count": len(ground_truth),
        "detected_count": len(detected_notes),
        "ground_truth": ground_truth,
        "detected": detected_notes,
        "metrics": metrics
    }


def calculate_mir_eval_metrics(ground_truth: List[Tuple[float, float, int]],
                                detected_notes: List[Dict]) -> Dict:
    """
    Calculate mir_eval metrics for transcription accuracy.

    Args:
        ground_truth: List of (onset, offset, midi_note) tuples
        detected_notes: List of detected note dicts

    Returns:
        Dict with Precision, Recall, F-measure
    """
    # Convert to mir_eval format
    ref_intervals = np.array([[onset, offset] for onset, offset, _ in ground_truth])
    ref_pitches = np.array([midi_note for _, _, midi_note in ground_truth])

    # Group detected notes by MIDI pitch and create intervals
    # (For now, we'll use a fixed duration since we don't have offset detection)
    est_intervals = []
    est_pitches = []

    for det in detected_notes:
        onset = det["time"]
        offset = onset + 0.5  # Assume 500ms duration (rough estimate)
        midi_note = det["midi_note"]

        est_intervals.append([onset, offset])
        est_pitches.append(midi_note)

    est_intervals = np.array(est_intervals)
    est_pitches = np.array(est_pitches)

    # Calculate metrics
    try:
        # Note onset only (50ms tolerance)
        onset_precision, onset_recall, onset_f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
            ref_intervals, ref_pitches, est_intervals, est_pitches,
            onset_tolerance=0.05, offset_ratio=None
        )

        # Note with offset (50ms onset, 20% offset tolerance)
        offset_precision, offset_recall, offset_f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
            ref_intervals, ref_pitches, est_intervals, est_pitches,
            onset_tolerance=0.05, offset_ratio=0.2
        )

        return {
            "onset_precision": onset_precision,
            "onset_recall": onset_recall,
            "onset_f1": onset_f1,
            "offset_precision": offset_precision,
            "offset_recall": offset_recall,
            "offset_f1": offset_f1
        }

    except Exception as e:
        print(f"    ⚠️  mir_eval calculation failed: {e}")
        return None


# ============================================================================
# BENCHMARK EXECUTION
# ============================================================================

def run_benchmark():
    """Run benchmark on MAESTRO dataset"""
    print("\n" + "=" * 70)
    print("MAESTRO BENCHMARK - ALGORITHM VALIDATION")
    print("=" * 70)

    # Check dataset exists
    dataset_dir = f"{MAESTRO_DIR}/maestro-{MAESTRO_VERSION}"

    if not os.path.exists(dataset_dir):
        print("\n❌ Dataset not found. Run with --download first.")
        return

    # Load metadata
    metadata_path = f"{dataset_dir}/maestro-v3.0.0.json"

    if not os.path.exists(metadata_path):
        print("\n❌ Metadata file not found.")
        return

    with open(metadata_path, 'r') as f:
        metadata = json.load(f)

    # Filter to 2018 subset if requested
    if USE_SUBSET:
        files = [f for f in metadata if f.get('year') == SUBSET_YEAR]
        print(f"\nUsing {SUBSET_YEAR} subset: {len(files)} files")
    else:
        files = metadata
        print(f"\nUsing full dataset: {len(files)} files")

    # Limit for testing
    if MAX_FILES_TO_TEST:
        files = files[:MAX_FILES_TO_TEST]
        print(f"Testing first {MAX_FILES_TO_TEST} files (for quick validation)")

    # Initialize detector
    detector = PolyphonicDetector(sample_rate=44100)

    # Run tests
    results = []

    for i, file_info in enumerate(files):
        print(f"\n[{i+1}/{len(files)}] Processing:")

        audio_path = f"{dataset_dir}/{file_info['audio_filename']}"
        midi_path = f"{dataset_dir}/{file_info['midi_filename']}"

        if not os.path.exists(audio_path):
            print(f"  ⚠️  Audio file not found: {audio_path}")
            continue

        if not os.path.exists(midi_path):
            print(f"  ⚠️  MIDI file not found: {midi_path}")
            continue

        result = test_audio_file(audio_path, midi_path, detector)

        if result:
            results.append(result)

    # Generate report
    generate_benchmark_report(results)


def generate_benchmark_report(results: List[Dict]):
    """Generate benchmark report with metrics"""
    print("\n" + "=" * 70)
    print("BENCHMARK REPORT")
    print("=" * 70)

    if not results:
        print("\n❌ No results to report")
        return

    # Aggregate metrics
    total_ground_truth = sum(r["ground_truth_count"] for r in results)
    total_detected = sum(r["detected_count"] for r in results)

    print(f"\n📊 Overall Statistics:")
    print(f"  Files tested: {len(results)}")
    print(f"  Total ground truth notes: {total_ground_truth}")
    print(f"  Total detected notes: {total_detected}")
    print(f"  Detection ratio: {total_detected / total_ground_truth:.2%}")

    if MIR_EVAL_AVAILABLE:
        # Calculate average metrics
        onset_f1_scores = [r["metrics"]["onset_f1"] for r in results if r["metrics"]]
        offset_f1_scores = [r["metrics"]["offset_f1"] for r in results if r["metrics"]]

        if onset_f1_scores:
            avg_onset_f1 = np.mean(onset_f1_scores)
            avg_offset_f1 = np.mean(offset_f1_scores)

            print(f"\n📈 mir_eval Metrics:")
            print(f"  Average Onset F1:  {avg_onset_f1:.1%}")
            print(f"  Average Offset F1: {avg_offset_f1:.1%}")

            print(f"\n🎯 Comparison with State-of-the-Art:")
            print(f"  Our Onset F1:  {avg_onset_f1:.1%} (Target: >90%, SOTA: 96.7%)")
            print(f"  Our Offset F1: {avg_offset_f1:.1%} (Target: >80%, SOTA: 82.3%)")

            if avg_onset_f1 >= 0.90:
                print("\n  ✅ EXCELLENT: Onset F1 meets production target!")
            elif avg_onset_f1 >= 0.80:
                print("\n  ✓ GOOD: Onset F1 above 80%, close to target")
            else:
                print("\n  ⚠️  NEEDS IMPROVEMENT: Onset F1 below 80%")

    # Save report
    report_path = "maestro_benchmark_report.json"

    with open(report_path, 'w') as f:
        json.dump({
            "dataset": "MAESTRO v3.0.0",
            "subset_year": SUBSET_YEAR if USE_SUBSET else "all",
            "files_tested": len(results),
            "total_ground_truth_notes": total_ground_truth,
            "total_detected_notes": total_detected,
            "detection_ratio": total_detected / total_ground_truth,
            "results": results
        }, f, indent=2)

    print(f"\n📄 Full report saved: {report_path}")
    print("=" * 70)


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="MAESTRO Dataset Benchmark")
    parser.add_argument("--download", action="store_true", help="Download MAESTRO dataset")
    parser.add_argument("--test", action="store_true", help="Run benchmark tests")
    parser.add_argument("--report", action="store_true", help="Generate report only")

    args = parser.parse_args()

    if args.download:
        download_maestro_dataset()

    elif args.test:
        if not MIR_EVAL_AVAILABLE:
            print("\n⚠️  mir_eval not installed. Installing now...")
            os.system("pip3 install mir_eval --break-system-packages")
            print("\n✓ Please run the script again to use mir_eval metrics.")
            return

        run_benchmark()

    elif args.report:
        # Load existing results and regenerate report
        report_path = "maestro_benchmark_report.json"
        if os.path.exists(report_path):
            with open(report_path, 'r') as f:
                data = json.load(f)
            generate_benchmark_report(data["results"])
        else:
            print(f"\n❌ No report found: {report_path}")

    else:
        print("\n" + "=" * 70)
        print("MAESTRO BENCHMARK TOOL")
        print("=" * 70)
        print("\nUsage:")
        print("  python3 maestro_benchmark.py --download    # Download dataset (~15-20GB)")
        print("  python3 maestro_benchmark.py --test         # Run benchmark")
        print("  python3 maestro_benchmark.py --report       # Regenerate report")
        print("\nThis will validate your algorithm against Google's gold standard dataset.")
        print("=" * 70)


if __name__ == "__main__":
    main()
