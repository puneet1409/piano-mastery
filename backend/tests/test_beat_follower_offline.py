#!/usr/bin/env python3
"""
Offline test harness for beat-aware score following.

Simulates playing a MIDI-derived exercise with controlled timing offsets
and validates early/late/on-time feedback plus completion.
"""

import argparse
import os
import random
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from midi_exercise import load_midi_exercise
from beat_score_follower import BeatAwareScoreFollower


def run_test(midi_path: str, name: str, offset_ms: int, jitter_ms: int, seed: int) -> int:
    exercise = load_midi_exercise(midi_path=midi_path, name=name)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    rng = random.Random(seed)
    total_groups = len(exercise.groups)
    timing_counts = {"on_time": 0, "early": 0, "late": 0}
    mismatches = 0

    for group in exercise.groups:
        for note_idx, note in enumerate(group.notes):
            jitter = rng.uniform(-jitter_ms, jitter_ms) / 1000.0 if jitter_ms > 0 else 0.0
            ts = follower.exercise.start_time + group.expected_time_sec + (offset_ms / 1000.0) + jitter
            freq = group.frequencies[note_idx] if note_idx < len(group.frequencies) else group.frequencies[0]
            result = follower.process_detection(
                detected_note=note,
                detected_frequency=freq,
                confidence=0.9,
                timestamp=ts,
            )
            if not result.get("matched"):
                mismatches += 1
                continue
            timing_status = result.get("timing_status", "on_time")
            timing_counts[timing_status] = timing_counts.get(timing_status, 0) + 1

    progress = follower.get_progress()
    completed = progress.get("completed", False)

    print("=== Beat Follower Offline Test ===")
    print(f"MIDI: {midi_path}")
    print(f"Groups: {total_groups}")
    print(f"Offset: {offset_ms} ms")
    if jitter_ms > 0:
        print(f"Jitter: ±{jitter_ms} ms (seed={seed})")
    print(f"Timing counts: {timing_counts}")
    print(f"Mismatches: {mismatches}")
    print(f"Completed: {completed}")
    print(f"Progress: {progress['correct']}/{progress['total']} correct")

    if mismatches > 0:
        print("FAIL: There were unmatched notes.")
        return 2
    if not completed:
        print("FAIL: Exercise did not complete.")
        return 3
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    _default_midi = os.path.join(
        os.path.dirname(__file__), "..",
        "test_songs", "perfect", "ed-sheeran---perfect-easy-for-beginners.mid",
    )
    parser.add_argument(
        "--midi",
        default=_default_midi,
        help="Path to MIDI file",
    )
    parser.add_argument(
        "--name",
        default="Perfect - Ed Sheeran (Easy)",
        help="Exercise name",
    )
    parser.add_argument(
        "--offset-ms",
        type=int,
        default=0,
        help="Timing offset in milliseconds (positive=late, negative=early)",
    )
    parser.add_argument(
        "--jitter-ms",
        type=int,
        default=0,
        help="Random per-note jitter in milliseconds (±range)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=1337,
        help="Random seed for jitter",
    )
    args = parser.parse_args()

    if not os.path.exists(args.midi):
        print(f"FAIL: MIDI not found at {args.midi}")
        return 1

    return run_test(args.midi, args.name, args.offset_ms, args.jitter_ms, args.seed)


if __name__ == "__main__":
    raise SystemExit(main())
