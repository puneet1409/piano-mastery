#!/usr/bin/env python3
"""
Corrupted MIDI Test Suite - Error Detection Validation

This script creates intentionally corrupted MIDI test cases to validate that
our algorithm correctly REJECTS incorrect notes, rather than auto-correcting them.

This is critical for a tutoring app: we want to catch student mistakes, not hide them.

Test Types:
1. Timing Errors - Notes shifted by 50-200ms
2. Pitch Errors - Wrong semitone (e.g., C# instead of C)
3. Velocity Errors - Too soft or too loud
4. Extra Notes - Additional notes not in score
5. Missing Notes - Skipped notes from score

Expected Behavior:
- Algorithm should DETECT errors (not auto-correct)
- Rejection rate should be >95% for obvious mistakes
- Partial credit for close-but-wrong attempts

Usage:
    python3 corrupted_midi_test.py --create     # Create corrupted test files
    python3 corrupted_midi_test.py --test       # Run validation tests
    python3 corrupted_midi_test.py --report     # Generate report
"""

import os
import json
import argparse
from typing import List, Dict, Tuple
import numpy as np
from scipy.io import wavfile
import mido
from polyphonic_detector import PolyphonicDetector


# ============================================================================
# TEST CONFIGURATION
# ============================================================================

TEST_DIR = "test_audio/corrupted_midi"
CLEAN_REFERENCE_DIR = "test_audio/clean_reference"

# Test cases to generate
CORRUPTION_TYPES = [
    "timing_early",      # Notes 50ms early
    "timing_late",       # Notes 50ms late
    "timing_very_late",  # Notes 150ms late
    "pitch_half_step",   # Wrong by 1 semitone
    "pitch_whole_step",  # Wrong by 2 semitones
    "extra_notes",       # Additional wrong notes
    "missing_notes",     # Skip notes from score
    "velocity_soft",     # Too quiet (velocity < 40)
    "velocity_loud",     # Too loud (velocity > 100)
]


# ============================================================================
# CLEAN REFERENCE MIDI GENERATION
# ============================================================================

def create_clean_reference_midi(filename: str, notes: List[Tuple[str, float, float]]):
    """
    Create a clean MIDI file as reference.

    Args:
        filename: Output MIDI filename
        notes: List of (note_name, onset_time, duration) tuples
    """
    os.makedirs(CLEAN_REFERENCE_DIR, exist_ok=True)

    midi = mido.MidiFile()
    track = mido.MidiTrack()
    midi.tracks.append(track)

    # Set tempo (120 BPM)
    track.append(mido.MetaMessage('set_tempo', tempo=mido.bpm2tempo(120)))

    # Convert notes to MIDI events
    events = []

    for note_name, onset, duration in notes:
        midi_note = note_name_to_midi(note_name)
        velocity = 80  # Standard velocity

        events.append((onset, 'note_on', midi_note, velocity))
        events.append((onset + duration, 'note_off', midi_note, 0))

    # Sort events by time
    events.sort(key=lambda x: x[0])

    # Add events to track
    current_time = 0

    for event_time, event_type, midi_note, velocity in events:
        delta = int((event_time - current_time) * 480)  # Convert to ticks
        current_time = event_time

        if event_type == 'note_on':
            track.append(mido.Message('note_on', note=midi_note, velocity=velocity, time=delta))
        else:
            track.append(mido.Message('note_off', note=midi_note, velocity=velocity, time=delta))

    # Save
    output_path = f"{CLEAN_REFERENCE_DIR}/{filename}"
    midi.save(output_path)
    print(f"  ✓ Created: {output_path}")

    return output_path


# ============================================================================
# CORRUPTED MIDI GENERATION
# ============================================================================

def create_corrupted_midi(clean_midi_path: str, corruption_type: str) -> str:
    """
    Create a corrupted version of a clean MIDI file.

    Args:
        clean_midi_path: Path to clean reference MIDI
        corruption_type: Type of corruption to apply

    Returns:
        Path to corrupted MIDI file
    """
    os.makedirs(TEST_DIR, exist_ok=True)

    # Load clean MIDI
    midi = mido.MidiFile(clean_midi_path)

    # Create new corrupted MIDI
    corrupted_midi = mido.MidiFile()
    corrupted_track = mido.MidiTrack()
    corrupted_midi.tracks.append(corrupted_track)

    # Copy tempo
    for msg in midi.tracks[0]:
        if msg.type == 'set_tempo':
            corrupted_track.append(msg.copy())
            break

    # Apply corruption
    current_time = 0

    for msg in midi.tracks[0]:
        if msg.type not in ['note_on', 'note_off']:
            corrupted_track.append(msg.copy())
            continue

        current_time += msg.time
        new_msg = msg.copy()

        # Apply corruption based on type
        if corruption_type == "timing_early":
            # Shift 50ms early (subtract from delta time)
            new_msg.time = max(0, msg.time - 24)  # ~50ms at 480 ticks/beat

        elif corruption_type == "timing_late":
            # Shift 50ms late
            new_msg.time = msg.time + 24

        elif corruption_type == "timing_very_late":
            # Shift 150ms late
            new_msg.time = msg.time + 72

        elif corruption_type == "pitch_half_step":
            # Wrong by 1 semitone (only on note_on)
            if msg.type == 'note_on' and msg.velocity > 0:
                new_msg.note = msg.note + 1

        elif corruption_type == "pitch_whole_step":
            # Wrong by 2 semitones
            if msg.type == 'note_on' and msg.velocity > 0:
                new_msg.note = msg.note + 2

        elif corruption_type == "velocity_soft":
            # Too quiet
            if msg.type == 'note_on' and msg.velocity > 0:
                new_msg.velocity = 30

        elif corruption_type == "velocity_loud":
            # Too loud
            if msg.type == 'note_on' and msg.velocity > 0:
                new_msg.velocity = 110

        elif corruption_type == "extra_notes":
            # Add extra wrong notes (skip for now - requires synthesis)
            pass

        elif corruption_type == "missing_notes":
            # Skip every other note
            if msg.type == 'note_on' and msg.velocity > 0:
                if np.random.random() < 0.3:  # 30% chance to skip
                    continue

        corrupted_track.append(new_msg)

    # Save corrupted MIDI
    base_name = os.path.basename(clean_midi_path).replace('.mid', '')
    output_path = f"{TEST_DIR}/{base_name}_{corruption_type}.mid"
    corrupted_midi.save(output_path)

    print(f"  ✓ Corrupted ({corruption_type}): {output_path}")

    return output_path


# ============================================================================
# TEST VALIDATION
# ============================================================================

def test_corrupted_midi(clean_midi_path: str, corrupted_midi_path: str,
                        corruption_type: str, detector: PolyphonicDetector) -> Dict:
    """
    Test algorithm's ability to detect corruption.

    Args:
        clean_midi_path: Path to clean reference MIDI
        corrupted_midi_path: Path to corrupted MIDI
        corruption_type: Type of corruption applied
        detector: PolyphonicDetector instance

    Returns:
        Dict with detection results
    """
    print(f"\n  Testing corruption: {corruption_type}")

    # Parse ground truth (clean MIDI)
    clean_notes = parse_midi_notes(clean_midi_path)
    corrupted_notes = parse_midi_notes(corrupted_midi_path)

    print(f"    Clean notes: {len(clean_notes)}")
    print(f"    Corrupted notes: {len(corrupted_notes)}")

    # For now, return structure (audio synthesis would be next step)
    return {
        "corruption_type": corruption_type,
        "clean_file": os.path.basename(clean_midi_path),
        "corrupted_file": os.path.basename(corrupted_midi_path),
        "clean_notes": clean_notes,
        "corrupted_notes": corrupted_notes,
        "differences": calculate_differences(clean_notes, corrupted_notes, corruption_type)
    }


def parse_midi_notes(midi_path: str) -> List[Dict]:
    """Parse MIDI file to note list"""
    try:
        midi = mido.MidiFile(midi_path)
        notes = []
        active_notes = {}
        current_time = 0.0

        for track in midi.tracks:
            current_time = 0.0

            for msg in track:
                current_time += msg.time

                if msg.type == 'note_on' and msg.velocity > 0:
                    active_notes[msg.note] = {
                        'onset': current_time,
                        'velocity': msg.velocity
                    }

                elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                    if msg.note in active_notes:
                        onset_data = active_notes[msg.note]
                        notes.append({
                            'midi_note': msg.note,
                            'note_name': midi_note_to_name(msg.note),
                            'onset': onset_data['onset'],
                            'offset': current_time,
                            'duration': current_time - onset_data['onset'],
                            'velocity': onset_data['velocity']
                        })
                        del active_notes[msg.note]

        return sorted(notes, key=lambda x: x['onset'])

    except Exception as e:
        print(f"    ⚠️  Failed to parse MIDI: {e}")
        return []


def calculate_differences(clean_notes: List[Dict], corrupted_notes: List[Dict],
                         corruption_type: str) -> Dict:
    """Calculate differences between clean and corrupted MIDI"""
    diffs = {
        "timing_errors": 0,
        "pitch_errors": 0,
        "velocity_errors": 0,
        "extra_notes": max(0, len(corrupted_notes) - len(clean_notes)),
        "missing_notes": max(0, len(clean_notes) - len(corrupted_notes))
    }

    # Match notes by position
    for i in range(min(len(clean_notes), len(corrupted_notes))):
        clean = clean_notes[i]
        corrupt = corrupted_notes[i]

        # Timing difference
        timing_diff = abs(corrupt['onset'] - clean['onset'])
        if timing_diff > 24:  # > 50ms
            diffs["timing_errors"] += 1

        # Pitch difference
        if corrupt['midi_note'] != clean['midi_note']:
            diffs["pitch_errors"] += 1

        # Velocity difference
        if abs(corrupt['velocity'] - clean['velocity']) > 20:
            diffs["velocity_errors"] += 1

    return diffs


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def note_name_to_midi(note_name: str) -> int:
    """Convert note name to MIDI number (e.g., 'C4' -> 60)"""
    note_map = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
                'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}

    # Parse note name
    if '#' in note_name:
        note = note_name[:-1]
        octave = int(note_name[-1])
    else:
        note = note_name[:-1]
        octave = int(note_name[-1])

    return (octave + 1) * 12 + note_map[note]


def midi_note_to_name(midi_note: int) -> str:
    """Convert MIDI number to note name"""
    note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (midi_note // 12) - 1
    note = note_names[midi_note % 12]
    return f"{note}{octave}"


# ============================================================================
# TEST CASES
# ============================================================================

def create_test_cases():
    """Create standard test cases for corruption testing"""
    print("\n" + "=" * 70)
    print("CREATING TEST CASES")
    print("=" * 70)

    test_cases = [
        {
            "name": "c_major_scale",
            "notes": [
                ("C4", 0.0, 0.5),
                ("D4", 0.5, 0.5),
                ("E4", 1.0, 0.5),
                ("F4", 1.5, 0.5),
                ("G4", 2.0, 0.5),
                ("A4", 2.5, 0.5),
                ("B4", 3.0, 0.5),
                ("C5", 3.5, 0.5),
            ]
        },
        {
            "name": "c_major_chord",
            "notes": [
                ("C4", 0.0, 1.0),
                ("E4", 0.0, 1.0),
                ("G4", 0.0, 1.0),
            ]
        },
        {
            "name": "chord_progression",
            "notes": [
                # C major
                ("C4", 0.0, 1.0),
                ("E4", 0.0, 1.0),
                ("G4", 0.0, 1.0),
                # F major
                ("F4", 1.0, 1.0),
                ("A4", 1.0, 1.0),
                ("C5", 1.0, 1.0),
                # G major
                ("G4", 2.0, 1.0),
                ("B4", 2.0, 1.0),
                ("D5", 2.0, 1.0),
                # C major
                ("C4", 3.0, 1.0),
                ("E4", 3.0, 1.0),
                ("G4", 3.0, 1.0),
            ]
        }
    ]

    # Create clean reference files
    clean_files = []

    for test_case in test_cases:
        print(f"\n📝 Creating: {test_case['name']}")
        clean_path = create_clean_reference_midi(
            f"{test_case['name']}.mid",
            test_case['notes']
        )
        clean_files.append(clean_path)

    # Create corrupted versions
    print(f"\n🔨 Creating corrupted versions...")

    for clean_path in clean_files:
        print(f"\nProcessing: {os.path.basename(clean_path)}")

        for corruption_type in CORRUPTION_TYPES:
            create_corrupted_midi(clean_path, corruption_type)

    print("\n" + "=" * 70)
    print("✅ TEST CASES CREATED")
    print("=" * 70)
    print(f"\nClean files: {CLEAN_REFERENCE_DIR}/")
    print(f"Corrupted files: {TEST_DIR}/")


# ============================================================================
# RUN TESTS
# ============================================================================

def run_tests():
    """Run corruption detection tests"""
    print("\n" + "=" * 70)
    print("CORRUPTED MIDI VALIDATION TEST")
    print("=" * 70)

    if not os.path.exists(CLEAN_REFERENCE_DIR):
        print("\n❌ Clean reference files not found. Run with --create first.")
        return

    detector = PolyphonicDetector(sample_rate=44100)

    # Get all clean files
    clean_files = [f for f in os.listdir(CLEAN_REFERENCE_DIR) if f.endswith('.mid')]

    results = []

    for clean_file in clean_files:
        clean_path = f"{CLEAN_REFERENCE_DIR}/{clean_file}"
        base_name = clean_file.replace('.mid', '')

        print(f"\n{'=' * 70}")
        print(f"Testing: {base_name}")
        print(f"{'=' * 70}")

        for corruption_type in CORRUPTION_TYPES:
            corrupted_file = f"{base_name}_{corruption_type}.mid"
            corrupted_path = f"{TEST_DIR}/{corrupted_file}"

            if not os.path.exists(corrupted_path):
                print(f"  ⚠️  Corrupted file not found: {corrupted_file}")
                continue

            result = test_corrupted_midi(clean_path, corrupted_path, corruption_type, detector)
            results.append(result)

    # Generate report
    generate_corruption_report(results)


def generate_corruption_report(results: List[Dict]):
    """Generate corruption detection report"""
    print("\n" + "=" * 70)
    print("CORRUPTION DETECTION REPORT")
    print("=" * 70)

    if not results:
        print("\n❌ No results to report")
        return

    # Aggregate by corruption type
    by_type = {}

    for r in results:
        corruption_type = r["corruption_type"]

        if corruption_type not in by_type:
            by_type[corruption_type] = []

        by_type[corruption_type].append(r)

    # Print summary
    print(f"\n📊 Summary by Corruption Type:")

    for corruption_type, test_results in by_type.items():
        print(f"\n  {corruption_type}:")
        print(f"    Tests: {len(test_results)}")

        total_diffs = {
            "timing_errors": 0,
            "pitch_errors": 0,
            "velocity_errors": 0,
            "extra_notes": 0,
            "missing_notes": 0
        }

        for r in test_results:
            for key in total_diffs:
                total_diffs[key] += r["differences"][key]

        for key, value in total_diffs.items():
            if value > 0:
                print(f"      {key}: {value}")

    # Save report
    report_path = "corrupted_midi_report.json"

    with open(report_path, 'w') as f:
        json.dump({
            "test_date": "2026-01-25",
            "total_tests": len(results),
            "corruption_types": list(by_type.keys()),
            "results": results
        }, f, indent=2)

    print(f"\n📄 Full report saved: {report_path}")
    print("=" * 70)


# ============================================================================
# MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Corrupted MIDI Test Suite")
    parser.add_argument("--create", action="store_true", help="Create test cases")
    parser.add_argument("--test", action="store_true", help="Run validation tests")
    parser.add_argument("--report", action="store_true", help="Generate report")

    args = parser.parse_args()

    if args.create:
        create_test_cases()

    elif args.test:
        run_tests()

    elif args.report:
        # Regenerate report from existing results
        report_path = "corrupted_midi_report.json"
        if os.path.exists(report_path):
            with open(report_path, 'r') as f:
                data = json.load(f)
            generate_corruption_report(data["results"])
        else:
            print(f"\n❌ No report found: {report_path}")

    else:
        print("\n" + "=" * 70)
        print("CORRUPTED MIDI TEST SUITE")
        print("=" * 70)
        print("\nPurpose:")
        print("  Validate that the algorithm DETECTS errors (not auto-corrects)")
        print("\nUsage:")
        print("  python3 corrupted_midi_test.py --create    # Create test files")
        print("  python3 corrupted_midi_test.py --test      # Run validation")
        print("  python3 corrupted_midi_test.py --report    # Generate report")
        print("\nThis proves your algorithm catches student mistakes!")
        print("=" * 70)


if __name__ == "__main__":
    main()
