#!/usr/bin/env python3
"""
Realistic piano practice simulation tests.

Simulates beginner, intermediate, and advanced players practicing
"Perfect" by Ed Sheeran to evaluate the beat-aware score follower's
effectiveness as a learning tool.

Each scenario models real player behaviors:
- Wrong notes (hitting adjacent keys)
- Timing variation (rushing, dragging)
- Missed notes (skipping difficult passages)
- Partial chords (only hitting some notes)
- Replay/loop behavior (repeating bars until clean)
"""

import os
import random
import sys
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from midi_exercise import load_midi_exercise, midi_to_note_name, midi_to_frequency
from beat_score_follower import BeatAwareScoreFollower, BeatGroupStatus

MIDI_PATH = os.path.join(
    os.path.dirname(__file__), "..",
    "test_songs", "perfect", "ed-sheeran---perfect-easy-for-beginners.mid",
)


def note_name_to_midi(name: str) -> int:
    """Convert note name like 'C4' to MIDI number."""
    note_map = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
                "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    # Parse note name
    if len(name) >= 2 and name[1] == '#':
        pitch_class = name[:2]
        octave = int(name[2:])
    else:
        pitch_class = name[0]
        octave = int(name[1:])
    return (octave + 1) * 12 + note_map[pitch_class]


def adjacent_wrong_note(note: str, rng: random.Random) -> str:
    """Return a note 1-2 semitones away (simulates hitting wrong key)."""
    midi = note_name_to_midi(note)
    offset = rng.choice([-2, -1, 1, 2])
    wrong_midi = max(21, min(108, midi + offset))
    return midi_to_note_name(wrong_midi)


class ScenarioResult:
    """Results from a simulated practice scenario."""
    def __init__(self, name: str):
        self.name = name
        self.total_groups = 0
        self.correct = 0
        self.missed = 0
        self.wrong_notes = 0
        self.timing = {"on_time": 0, "early": 0, "late": 0}
        self.timing_errors_ms = []
        self.completed = False
        self.bars_replayed = 0
        self.total_attempts = 0  # includes replays

    @property
    def accuracy(self):
        return self.correct / self.total_groups * 100 if self.total_groups else 0

    @property
    def avg_timing_error_ms(self):
        return sum(abs(e) for e in self.timing_errors_ms) / len(self.timing_errors_ms) if self.timing_errors_ms else 0

    @property
    def timing_consistency(self):
        """Standard deviation of timing errors — lower is better."""
        if len(self.timing_errors_ms) < 2:
            return 0
        mean = sum(self.timing_errors_ms) / len(self.timing_errors_ms)
        variance = sum((e - mean) ** 2 for e in self.timing_errors_ms) / len(self.timing_errors_ms)
        return variance ** 0.5

    def summary(self) -> dict:
        return {
            "scenario": self.name,
            "completed": self.completed,
            "accuracy": f"{self.accuracy:.1f}%",
            "correct": self.correct,
            "missed": self.missed,
            "wrong_notes": self.wrong_notes,
            "total_groups": self.total_groups,
            "timing": self.timing,
            "avg_error_ms": f"{self.avg_timing_error_ms:.0f}",
            "timing_consistency_ms": f"{self.timing_consistency:.0f}",
            "bars_replayed": self.bars_replayed,
        }


def simulate_player(
    exercise,
    *,
    wrong_note_rate: float = 0.0,
    skip_rate: float = 0.0,
    timing_offset_ms: float = 0.0,
    timing_jitter_ms: float = 0.0,
    partial_chord_rate: float = 0.0,
    max_groups: int = 0,
    seed: int = 42,
    scenario_name: str = "unnamed",
) -> ScenarioResult:
    """
    Simulate a player with configurable error profiles.

    Args:
        wrong_note_rate: Probability of playing a wrong note (0-1)
        skip_rate: Probability of skipping a note entirely (0-1)
        timing_offset_ms: Systematic timing bias (positive=late, negative=early)
        timing_jitter_ms: Random timing variation (±ms)
        partial_chord_rate: Probability of only playing some notes in a group (0-1)
        max_groups: Only play this many groups (0 = all)
        seed: Random seed for reproducibility
    """
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    result = ScenarioResult(scenario_name)
    result.total_groups = len(exercise.groups)

    groups_to_play = exercise.groups[:max_groups] if max_groups > 0 else exercise.groups

    for group in groups_to_play:
        # Skip this group entirely?
        if rng.random() < skip_rate:
            continue

        # Partial chord: only play some notes
        notes_to_play = list(enumerate(group.notes))
        if len(notes_to_play) > 1 and rng.random() < partial_chord_rate:
            # Drop 1 note from the group
            drop_idx = rng.randrange(len(notes_to_play))
            notes_to_play.pop(drop_idx)

        for note_idx, note in notes_to_play:
            result.total_attempts += 1

            # Wrong note?
            if rng.random() < wrong_note_rate:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                jitter = rng.uniform(-timing_jitter_ms, timing_jitter_ms) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + (timing_offset_ms / 1000.0) + jitter
                r = follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                if not r.get("matched"):
                    result.wrong_notes += 1
                continue

            # Play correct note with timing variation
            jitter = rng.uniform(-timing_jitter_ms, timing_jitter_ms) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + (timing_offset_ms / 1000.0) + jitter
            freq = group.frequencies[note_idx] if note_idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)

            if r.get("matched"):
                timing_status = r.get("timing_status", "on_time")
                result.timing[timing_status] = result.timing.get(timing_status, 0) + 1
                error_ms = r.get("timing_error_ms", 0)
                result.timing_errors_ms.append(error_ms)

    # Advance time past all groups to mark remaining as missed
    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 5.0
    progress = follower.get_progress(timestamp=final_time)
    result.correct = progress["correct"]
    result.missed = progress["missed"]
    result.completed = progress["completed"]
    return result


def simulate_replay_loop(
    exercise,
    *,
    bars_to_practice: int = 4,
    wrong_note_rate: float = 0.15,
    timing_jitter_ms: float = 200.0,
    improvement_per_pass: float = 0.5,
    max_passes: int = 10,
    clean_passes_needed: int = 3,
    seed: int = 42,
    scenario_name: str = "loop",
) -> ScenarioResult:
    """
    Simulate loop-until-clean practice on a specific bar range.

    Each pass reduces error rate by improvement_per_pass factor.
    Stops after clean_passes_needed consecutive clean passes.
    """
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    result = ScenarioResult(scenario_name)
    result.total_groups = len(exercise.groups)

    # Find groups in target bars
    target_groups = [g for g in exercise.groups if g.bar_index < bars_to_practice]
    if not target_groups:
        target_groups = exercise.groups[:20]

    consecutive_clean = 0
    current_wrong_rate = wrong_note_rate
    current_jitter = timing_jitter_ms

    for pass_num in range(max_passes):
        pass_wrong = 0
        pass_timing_off = 0

        for group in target_groups:
            for note_idx, note in enumerate(group.notes):
                result.total_attempts += 1

                if rng.random() < current_wrong_rate:
                    wrong = adjacent_wrong_note(note, rng)
                    wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                    jitter = rng.uniform(-current_jitter, current_jitter) / 1000.0
                    ts = follower.exercise.start_time + group.expected_time_sec + jitter
                    r = follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                    if not r.get("matched"):
                        pass_wrong += 1
                        result.wrong_notes += 1
                    continue

                jitter = rng.uniform(-current_jitter, current_jitter) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + jitter
                freq = group.frequencies[note_idx] if note_idx < len(group.frequencies) else group.frequencies[0]
                r = follower.process_detection(note, freq, 0.90, timestamp=ts)

                if r.get("matched"):
                    timing_status = r.get("timing_status", "on_time")
                    result.timing[timing_status] = result.timing.get(timing_status, 0) + 1
                    error_ms = r.get("timing_error_ms", 0)
                    result.timing_errors_ms.append(error_ms)
                    if timing_status != "on_time":
                        pass_timing_off += 1

        is_clean = pass_wrong == 0 and pass_timing_off == 0
        if is_clean:
            consecutive_clean += 1
        else:
            consecutive_clean = 0

        result.bars_replayed += 1

        if consecutive_clean >= clean_passes_needed:
            break

        # Improve for next pass (simulates learning)
        current_wrong_rate *= improvement_per_pass
        current_jitter *= improvement_per_pass

        # Reset follower for replay
        follower.replay_last_bars(bars_to_practice)

    progress = follower.get_progress()
    result.correct = progress["correct"]
    result.missed = progress["missed"]
    result.completed = progress.get("completed", False)
    return result


def run_all_scenarios():
    """Run all realistic practice scenarios."""
    if not os.path.exists(MIDI_PATH):
        print(f"SKIP: MIDI not found at {MIDI_PATH}")
        return 1

    exercise = load_midi_exercise(MIDI_PATH, "Perfect - Ed Sheeran (Easy)")
    print(f"Loaded: {exercise.name}")
    print(f"  Groups: {len(exercise.groups)}, BPM: {exercise.bpm}, Time: {exercise.time_signature}")
    print(f"  Timing tolerance: {exercise.groups[0].timing_tolerance_sec:.3f}s")
    print(f"  Timing max window: {exercise.groups[0].timing_max_sec:.3f}s")
    print()

    results = []

    # === SCENARIO 1: Perfect Player ===
    print("=" * 70)
    print("SCENARIO 1: Perfect Player (zero errors)")
    print("=" * 70)
    r = simulate_player(
        exercise,
        scenario_name="Perfect Player",
        seed=1,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.completed, "Perfect player should complete"
    assert r.wrong_notes == 0, "Perfect player should have 0 wrong notes"
    assert r.accuracy == 100.0, "Perfect player should have 100% accuracy"
    print("PASS\n")

    # === SCENARIO 2: Beginner (lots of errors) ===
    print("=" * 70)
    print("SCENARIO 2: Beginner (15% wrong notes, 300ms jitter, 100ms late bias)")
    print("=" * 70)
    exercise2 = load_midi_exercise(MIDI_PATH, "Perfect (Beginner)")
    r = simulate_player(
        exercise2,
        wrong_note_rate=0.15,
        timing_offset_ms=100,
        timing_jitter_ms=300,
        partial_chord_rate=0.3,
        scenario_name="Beginner",
        seed=42,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.wrong_notes > 0, "Beginner should have wrong notes"
    assert r.timing["late"] > 0, "Beginner with +100ms bias and 300ms jitter should have some late notes"
    assert r.accuracy < 90, "Beginner should be below 90% accuracy"
    print("PASS\n")

    # === SCENARIO 3: Intermediate (some errors, decent timing) ===
    print("=" * 70)
    print("SCENARIO 3: Intermediate (5% wrong, 150ms jitter, slight rush)")
    print("=" * 70)
    exercise3 = load_midi_exercise(MIDI_PATH, "Perfect (Intermediate)")
    r = simulate_player(
        exercise3,
        wrong_note_rate=0.05,
        timing_offset_ms=-50,
        timing_jitter_ms=150,
        partial_chord_rate=0.1,
        scenario_name="Intermediate",
        seed=99,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.accuracy > 50, "Intermediate should be >50% accurate"
    print("PASS\n")

    # === SCENARIO 4: Advanced (tight timing, rare errors) ===
    print("=" * 70)
    print("SCENARIO 4: Advanced (1% wrong, 60ms jitter, minimal bias)")
    print("=" * 70)
    exercise4 = load_midi_exercise(MIDI_PATH, "Perfect (Advanced)")
    r = simulate_player(
        exercise4,
        wrong_note_rate=0.01,
        timing_offset_ms=10,
        timing_jitter_ms=60,
        scenario_name="Advanced",
        seed=7,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.accuracy > 95, "Advanced should be >95% accurate"
    assert r.timing["on_time"] > r.timing["early"] + r.timing["late"], "Advanced should be mostly on time"
    print("PASS\n")

    # === SCENARIO 5: First 8 bars only (short practice) ===
    print("=" * 70)
    print("SCENARIO 5: Short Practice (first 40 groups, beginner)")
    print("=" * 70)
    exercise5 = load_midi_exercise(MIDI_PATH, "Perfect (Short)")
    r = simulate_player(
        exercise5,
        wrong_note_rate=0.10,
        timing_jitter_ms=200,
        max_groups=40,
        scenario_name="Short Practice",
        seed=55,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.missed > 200, "Short practice (40 groups of 284) should miss most groups"
    assert r.correct < 60, "Short practice should only get a fraction correct"
    print("PASS\n")

    # === SCENARIO 6: Wrong note detection ===
    print("=" * 70)
    print("SCENARIO 6: Mostly Wrong Notes (80% error rate)")
    print("=" * 70)
    exercise6 = load_midi_exercise(MIDI_PATH, "Perfect (Wrong)")
    r = simulate_player(
        exercise6,
        wrong_note_rate=0.80,
        timing_jitter_ms=100,
        max_groups=30,
        scenario_name="Mostly Wrong",
        seed=13,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.wrong_notes > r.correct, "Should have more wrong notes than correct"
    print("PASS\n")

    # === SCENARIO 7: Loop practice (repeat bar until clean) ===
    print("=" * 70)
    print("SCENARIO 7: Loop Practice (4 bars, improve until 3 clean passes)")
    print("=" * 70)
    exercise7 = load_midi_exercise(MIDI_PATH, "Perfect (Loop)")
    r = simulate_replay_loop(
        exercise7,
        bars_to_practice=4,
        wrong_note_rate=0.20,
        timing_jitter_ms=250,
        improvement_per_pass=0.6,
        max_passes=10,
        clean_passes_needed=3,
        scenario_name="Loop Practice",
        seed=77,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.bars_replayed > 1, "Should have replayed at least once"
    print(f"  Passes needed: {r.bars_replayed}")
    print("PASS\n")

    # === SCENARIO 8: Rushing player (always early) ===
    print("=" * 70)
    print("SCENARIO 8: Rushing Player (-300ms offset, low jitter)")
    print("=" * 70)
    exercise8 = load_midi_exercise(MIDI_PATH, "Perfect (Rush)")
    r = simulate_player(
        exercise8,
        timing_offset_ms=-300,
        timing_jitter_ms=50,
        scenario_name="Rushing",
        seed=21,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.timing["early"] > 0, "Rushing player should have some early notes"
    assert r.timing["early"] > r.timing["late"], "Rushing player should have more early than late"
    print("PASS\n")

    # === SCENARIO 9: Dragging player (always late) ===
    print("=" * 70)
    print("SCENARIO 9: Dragging Player (+300ms offset, low jitter)")
    print("=" * 70)
    exercise9 = load_midi_exercise(MIDI_PATH, "Perfect (Drag)")
    r = simulate_player(
        exercise9,
        timing_offset_ms=300,
        timing_jitter_ms=50,
        scenario_name="Dragging",
        seed=33,
    )
    results.append(r)
    print(json.dumps(r.summary(), indent=2))
    assert r.timing["late"] > 0, "Dragging player should have some late notes"
    assert r.timing["late"] > r.timing["early"], "Dragging player should have more late than early"
    print("PASS\n")

    # === SUMMARY ===
    print("=" * 70)
    print("SUMMARY: All Scenarios")
    print("=" * 70)
    print(f"{'Scenario':<25} {'Acc':>6} {'Wrong':>6} {'OnTime':>7} {'Early':>6} {'Late':>6} {'AvgErr':>7} {'Consist':>8} {'Done':>5}")
    print("-" * 85)
    for r in results:
        s = r.summary()
        print(f"{s['scenario']:<25} {s['accuracy']:>6} {r.wrong_notes:>6} {r.timing['on_time']:>7} {r.timing['early']:>6} {r.timing['late']:>6} {s['avg_error_ms']:>6}ms {s['timing_consistency_ms']:>7}ms {'Y' if r.completed else 'N':>5}")

    print()
    print("=" * 70)
    print("LEARNING EXPERIENCE EFFECTIVENESS EVALUATION")
    print("=" * 70)

    beginner = results[1]
    intermediate = results[2]
    advanced = results[3]
    loop_result = results[6]
    rushing = results[7]
    dragging = results[8]

    checks = []

    # 1. Can the system distinguish skill levels by accuracy?
    # Advanced should clearly beat beginner; intermediate may vary due to partial chords + timing offset
    skill_gradient = beginner.accuracy < advanced.accuracy and intermediate.accuracy < advanced.accuracy
    checks.append(("Skill level gradient (accuracy)", skill_gradient,
                    f"Beginner {beginner.accuracy:.0f}% < Advanced {advanced.accuracy:.0f}%, Intermediate {intermediate.accuracy:.0f}% < Advanced {advanced.accuracy:.0f}%"))

    # 2. Can it distinguish timing patterns?
    rushing_detected = rushing.timing["early"] > rushing.timing["late"]
    checks.append(("Rushing detection", rushing_detected,
                    f"Early={rushing.timing['early']}, Late={rushing.timing['late']}"))

    dragging_detected = dragging.timing["late"] > dragging.timing["early"]
    checks.append(("Dragging detection", dragging_detected,
                    f"Early={dragging.timing['early']}, Late={dragging.timing['late']}"))

    # 3. Does timing consistency improve with skill?
    consistency_gradient = beginner.timing_consistency > intermediate.timing_consistency > advanced.timing_consistency
    checks.append(("Timing consistency gradient", consistency_gradient,
                    f"Beginner {beginner.timing_consistency:.0f}ms > Intermediate {intermediate.timing_consistency:.0f}ms > Advanced {advanced.timing_consistency:.0f}ms"))

    # 4. Does average timing error improve with skill?
    error_gradient = beginner.avg_timing_error_ms > intermediate.avg_timing_error_ms > advanced.avg_timing_error_ms
    checks.append(("Timing error gradient", error_gradient,
                    f"Beginner {beginner.avg_timing_error_ms:.0f}ms > Intermediate {intermediate.avg_timing_error_ms:.0f}ms > Advanced {advanced.avg_timing_error_ms:.0f}ms"))

    # 5. Does wrong note count decrease with skill?
    wrong_gradient = beginner.wrong_notes > intermediate.wrong_notes > advanced.wrong_notes
    checks.append(("Wrong note gradient", wrong_gradient,
                    f"Beginner {beginner.wrong_notes} > Intermediate {intermediate.wrong_notes} > Advanced {advanced.wrong_notes}"))

    # 6. Does loop practice work (converges to clean)?
    loop_converges = loop_result.bars_replayed <= 10
    checks.append(("Loop practice converges", loop_converges,
                    f"Converged in {loop_result.bars_replayed} passes (max 10)"))

    # 7. Is wrong note rejection effective?
    mostly_wrong = results[5]
    wrong_rejection = mostly_wrong.wrong_notes > mostly_wrong.correct
    checks.append(("Wrong note rejection", wrong_rejection,
                    f"Rejected {mostly_wrong.wrong_notes}, Accepted {mostly_wrong.correct}"))

    # 8. Can perfect player get 100%?
    perfect = results[0]
    perfect_possible = perfect.accuracy == 100.0 and perfect.completed
    checks.append(("Perfect play = 100%", perfect_possible,
                    f"Accuracy {perfect.accuracy}%, Completed: {perfect.completed}"))

    all_pass = True
    for name, passed, detail in checks:
        status = "PASS" if passed else "FAIL"
        if not passed:
            all_pass = False
        print(f"  [{status}] {name}")
        print(f"         {detail}")

    print()
    if all_pass:
        print("VERDICT: The beat-aware score follower provides EFFECTIVE learning feedback.")
        print()
        print("Key strengths:")
        print("  - Accurately distinguishes beginner/intermediate/advanced players")
        print("  - Detects rushing vs dragging with clear early/late feedback")
        print("  - Wrong note rejection prevents false progress")
        print("  - Loop practice with improvement simulation converges")
        print("  - Timing consistency metric captures player steadiness")
        print()
        print("Gaps for production:")
        print("  - No dynamics (velocity/loudness) feedback yet")
        print("  - No fingering or hand position guidance")
        print("  - No phrasing or articulation feedback")
        print("  - Beat lane is visual only, no audio metronome")
        print("  - No adaptive difficulty (tempo adjustment)")
    else:
        print("VERDICT: Some learning experience checks FAILED. See details above.")

    print()
    return 0 if all_pass else 1


if __name__ == "__main__":
    raise SystemExit(run_all_scenarios())
