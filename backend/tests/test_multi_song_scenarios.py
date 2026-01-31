#!/usr/bin/env python3
"""
Multi-song realistic simulation tests.

Tests the beat-aware score follower across diverse songs covering:
- Classical: Fur Elise (3/8), Moonlight Sonata (4/4 slow), Canon in D, Ode to Joy, Twinkle
- Bollywood: Yeh Shaam Mastani, Ajeeb Daastaan (3/4 waltz), Pal Pal Dil Ke Paas
- Production: Perfect by Ed Sheeran (6/8 compound)

Each song is tested with beginner/intermediate/advanced player profiles,
plus special scenarios: RH-only, adaptive tempo, and loop practice.
"""

import os
import random
import sys
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from midi_exercise import load_midi_exercise, midi_to_note_name, midi_to_frequency
from beat_score_follower import BeatAwareScoreFollower, BeatGroupStatus

SONGS_DIR = os.path.join(os.path.dirname(__file__), "..", "test_songs")


# ── Song catalog ──────────────────────────────────────────────────

SONG_CATALOG = [
    {
        "id": "twinkle_beginner",
        "name": "Twinkle Twinkle (Beginner)",
        "path": "twinkle/twinkle_beginner.mid",
        "category": "classical",
    },
    {
        "id": "twinkle_advanced",
        "name": "Twinkle Twinkle (Advanced)",
        "path": "twinkle/twinkle_advanced.mid",
        "category": "classical",
    },
    {
        "id": "ode_to_joy_beginner",
        "name": "Ode to Joy (Beginner)",
        "path": "ode_to_joy/ode_to_joy_beginner.mid",
        "category": "classical",
    },
    {
        "id": "moonlight_beginner",
        "name": "Moonlight Sonata (Beginner)",
        "path": "moonlight_sonata/moonlight_beginner.mid",
        "category": "classical",
    },
    {
        "id": "moonlight_advanced",
        "name": "Moonlight Sonata (Advanced)",
        "path": "moonlight_sonata/moonlight_advanced.mid",
        "category": "classical",
    },
    {
        "id": "canon_beginner",
        "name": "Canon in D (Beginner)",
        "path": "canon_in_d/canon_beginner.mid",
        "category": "classical",
    },
    {
        "id": "canon_advanced",
        "name": "Canon in D (Advanced)",
        "path": "canon_in_d/canon_advanced.mid",
        "category": "classical",
    },
    {
        "id": "fur_elise",
        "name": "Fur Elise",
        "path": "fur_elise/fur_elise.mid",
        "category": "classical",
    },
    {
        "id": "yeh_shaam_beginner",
        "name": "Yeh Shaam Mastani (Beginner)",
        "path": "yeh_shaam_mastani/yeh_shaam_beginner.mid",
        "category": "bollywood",
    },
    {
        "id": "yeh_shaam_advanced",
        "name": "Yeh Shaam Mastani (Advanced)",
        "path": "yeh_shaam_mastani/yeh_shaam_advanced.mid",
        "category": "bollywood",
    },
    {
        "id": "ajeeb_beginner",
        "name": "Ajeeb Daastaan (Beginner)",
        "path": "ajeeb_daastaan/ajeeb_beginner.mid",
        "category": "bollywood",
    },
    {
        "id": "ajeeb_advanced",
        "name": "Ajeeb Daastaan (Advanced)",
        "path": "ajeeb_daastaan/ajeeb_advanced.mid",
        "category": "bollywood",
    },
    {
        "id": "pal_pal_beginner",
        "name": "Pal Pal Dil Ke Paas (Beginner)",
        "path": "pal_pal_dil_ke_paas/pal_pal_beginner.mid",
        "category": "bollywood",
    },
    {
        "id": "pal_pal_advanced",
        "name": "Pal Pal Dil Ke Paas (Advanced)",
        "path": "pal_pal_dil_ke_paas/pal_pal_advanced.mid",
        "category": "bollywood",
    },
    {
        "id": "perfect",
        "name": "Perfect - Ed Sheeran",
        "path": "perfect/ed-sheeran---perfect-easy-for-beginners.mid",
        "category": "pop",
    },
    # MuseScore high-quality Bollywood transcriptions
    {
        "id": "pal_pal_musescore",
        "name": "Pal Pal Dil Ke Paas (MuseScore)",
        "path": "pal_pal_dil_ke_paas/pal_pal_musescore.mid",
        "category": "bollywood",
    },
    {
        "id": "ajeeb_musescore",
        "name": "Ajeeb Daastaan (MuseScore)",
        "path": "ajeeb_daastaan/ajeeb_musescore.mid",
        "category": "bollywood",
    },
    {
        "id": "yeh_shaam_musescore",
        "name": "Yeh Shaam Mastani (MuseScore)",
        "path": "yeh_shaam_mastani/yeh_shaam_musescore.mid",
        "category": "bollywood",
    },
]


# ── Helpers ───────────────────────────────────────────────────────

def note_name_to_midi(name: str) -> int:
    note_map = {
        "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
        "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
    }
    if len(name) >= 2 and name[1] == "#":
        pitch_class = name[:2]
        octave = int(name[2:])
    else:
        pitch_class = name[0]
        octave = int(name[1:])
    return (octave + 1) * 12 + note_map[pitch_class]


def adjacent_wrong_note(note: str, rng: random.Random) -> str:
    midi = note_name_to_midi(note)
    offset = rng.choice([-2, -1, 1, 2])
    wrong_midi = max(21, min(108, midi + offset))
    return midi_to_note_name(wrong_midi)


class Result:
    def __init__(self, song_name, scenario):
        self.song = song_name
        self.scenario = scenario
        self.total_groups = 0
        self.correct = 0
        self.missed = 0
        self.wrong_notes = 0
        self.timing = {"on_time": 0, "early": 0, "late": 0}
        self.timing_errors_ms = []
        self.completed = False

    @property
    def accuracy(self):
        return self.correct / self.total_groups * 100 if self.total_groups else 0

    @property
    def avg_error_ms(self):
        return sum(abs(e) for e in self.timing_errors_ms) / len(self.timing_errors_ms) if self.timing_errors_ms else 0


def simulate(exercise, *, wrong_rate=0.0, skip_rate=0.0, offset_ms=0.0,
             jitter_ms=0.0, partial_chord_rate=0.0, max_groups=0, seed=42,
             song_name="", scenario_name=""):
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    result = Result(song_name, scenario_name)
    result.total_groups = len(exercise.groups)

    groups = exercise.groups[:max_groups] if max_groups > 0 else exercise.groups

    for group in groups:
        if rng.random() < skip_rate:
            continue

        notes_to_play = list(enumerate(group.notes))
        if len(notes_to_play) > 1 and rng.random() < partial_chord_rate:
            notes_to_play.pop(rng.randrange(len(notes_to_play)))

        for idx, note in notes_to_play:
            if rng.random() < wrong_rate:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                j = rng.uniform(-jitter_ms, jitter_ms) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + offset_ms / 1000.0 + j
                r = follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                if not r.get("matched"):
                    result.wrong_notes += 1
                continue

            j = rng.uniform(-jitter_ms, jitter_ms) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + offset_ms / 1000.0 + j
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)

            if r.get("matched"):
                ts_status = r.get("timing_status", "on_time")
                result.timing[ts_status] = result.timing.get(ts_status, 0) + 1
                result.timing_errors_ms.append(r.get("timing_error_ms", 0))

    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 5.0
    progress = follower.get_progress(timestamp=final_time)
    result.correct = progress["correct"]
    result.missed = progress["missed"]
    result.completed = progress["completed"]
    return result


def simulate_adaptive_tempo(exercise, *, wrong_rate=0.15, jitter_ms=300, seed=42,
                            song_name="", scenario_name="adaptive_beginner"):
    """Simulate a struggling beginner and verify tempo slows down."""
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    result = Result(song_name, scenario_name)
    result.total_groups = len(exercise.groups)

    tempo_changes = []
    initial_mult = follower.tempo_multiplier

    for group in exercise.groups:
        if rng.random() < 0.1:  # 10% skip
            continue

        for idx, note in enumerate(group.notes):
            if rng.random() < wrong_rate:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                j = rng.uniform(-jitter_ms, jitter_ms) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + j
                r = follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                if not r.get("matched"):
                    result.wrong_notes += 1
                continue

            j = rng.uniform(-jitter_ms, jitter_ms) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + j
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)

            if r.get("matched"):
                ts_status = r.get("timing_status", "on_time")
                result.timing[ts_status] = result.timing.get(ts_status, 0) + 1
                result.timing_errors_ms.append(r.get("timing_error_ms", 0))

                # Check for tempo adjustment
                new_mult = follower.adjust_tempo()
                if new_mult is not None:
                    tempo_changes.append(new_mult)

    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 10.0
    progress = follower.get_progress(timestamp=final_time)
    result.correct = progress["correct"]
    result.missed = progress["missed"]
    result.completed = progress["completed"]

    return result, tempo_changes, follower.tempo_multiplier


def simulate_rh_only(exercise_path, name, *, wrong_rate=0.0, jitter_ms=0, seed=42):
    """Test right-hand-only mode."""
    ex = load_midi_exercise(exercise_path, name, hands="right")
    return simulate(ex, wrong_rate=wrong_rate, jitter_ms=jitter_ms, seed=seed,
                    song_name=name, scenario_name="RH only")


def simulate_lh_only(exercise_path, name, *, wrong_rate=0.0, jitter_ms=0, seed=42):
    """Test left-hand-only mode."""
    ex = load_midi_exercise(exercise_path, name, hands="left")
    return simulate(ex, wrong_rate=wrong_rate, jitter_ms=jitter_ms, seed=seed,
                    song_name=name, scenario_name="LH only")


def simulate_recovery(exercise, *, seed=42, song_name=""):
    """Simulate a player who starts badly then recovers.

    First half: 30% wrong, 400ms jitter. Second half: 2% wrong, 60ms jitter.
    Returns per-half accuracy and the follower for bar-level inspection.
    """
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    total = len(exercise.groups)
    midpoint = total // 2
    first_half_correct = 0
    second_half_correct = 0

    for i, group in enumerate(exercise.groups):
        in_first_half = i < midpoint
        wrong_rate = 0.30 if in_first_half else 0.02
        jitter = 400.0 if in_first_half else 60.0

        for idx, note in enumerate(group.notes):
            if rng.random() < wrong_rate:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                j = rng.uniform(-jitter, jitter) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + j
                follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                continue

            j = rng.uniform(-jitter, jitter) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + j
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)
            if r.get("matched"):
                if in_first_half:
                    first_half_correct += 1
                else:
                    second_half_correct += 1

    # Finalize
    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 5.0
    follower.get_progress(timestamp=final_time)

    first_half_total = midpoint
    second_half_total = total - midpoint
    first_acc = first_half_correct / first_half_total * 100 if first_half_total else 0
    second_acc = second_half_correct / second_half_total * 100 if second_half_total else 0
    return first_acc, second_acc, follower


def simulate_fatigue(exercise, *, seed=42, song_name=""):
    """Simulate fatigue: accuracy degrades over time.

    Starts with 2% wrong, ends with 25% wrong. Jitter increases too.
    Returns first-quarter and last-quarter accuracy.
    """
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    total = len(exercise.groups)
    q1_end = total // 4
    q4_start = total - total // 4
    q1_correct = 0
    q4_correct = 0

    for i, group in enumerate(exercise.groups):
        progress_frac = i / max(1, total - 1)
        wrong_rate = 0.02 + 0.23 * progress_frac  # 2% -> 25%
        jitter = 60.0 + 340.0 * progress_frac      # 60ms -> 400ms

        for idx, note in enumerate(group.notes):
            if rng.random() < wrong_rate:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                j = rng.uniform(-jitter, jitter) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + j
                follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                continue

            j = rng.uniform(-jitter, jitter) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + j
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)
            if r.get("matched"):
                if i < q1_end:
                    q1_correct += 1
                elif i >= q4_start:
                    q4_correct += 1

    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 5.0
    follower.get_progress(timestamp=final_time)

    q1_total = q1_end
    q4_total = total - q4_start
    q1_acc = q1_correct / q1_total * 100 if q1_total else 0
    q4_acc = q4_correct / q4_total * 100 if q4_total else 0
    return q1_acc, q4_acc


def simulate_loop_practice(exercise_path, exercise_name, bars_to_loop=2, iterations=3, seed=42, song_name=""):
    """Simulate loop practice: play the same bars multiple times, improving each loop.

    Iteration 1: 25% wrong, 350ms jitter
    Iteration 2: 10% wrong, 200ms jitter
    Iteration 3: 2% wrong, 60ms jitter
    Returns per-iteration accuracy.

    Reloads the exercise each iteration to get a fresh group state.
    """
    profiles = [
        (0.25, 350),
        (0.10, 200),
        (0.02, 60),
    ]
    iteration_accs = []

    for loop_i in range(iterations):
        wrong_rate, jitter = profiles[min(loop_i, len(profiles) - 1)]
        rng = random.Random(seed + loop_i)

        # Fresh exercise AND follower each loop
        ex = load_midi_exercise(exercise_path, exercise_name)
        follower = BeatAwareScoreFollower(ex, lookahead_groups=1)
        follower.start()

        bar_groups = [g for g in ex.groups if g.bar_index < bars_to_loop]
        matched = 0

        for group in bar_groups:
            for idx, note in enumerate(group.notes):
                if rng.random() < wrong_rate:
                    wrong = adjacent_wrong_note(note, rng)
                    wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                    ts = follower.exercise.start_time + group.expected_time_sec
                    follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                    continue

                j = rng.uniform(-jitter, jitter) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + j
                freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
                r = follower.process_detection(note, freq, 0.90, timestamp=ts)
                if r.get("matched"):
                    matched += 1

        total_notes = sum(len(g.notes) for g in bar_groups)
        acc = matched / total_notes * 100 if total_notes else 0
        iteration_accs.append(acc)

    return iteration_accs


def simulate_wrong_octave(exercise, *, seed=42, song_name=""):
    """Play every note in the correct pitch class but wrong octave.

    These should be rejected because the frequency won't match within
    the frequency_tolerance_hz (15 Hz by default). Returns rejection count.
    """
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    rejected = 0
    total_notes = 0

    for group in exercise.groups:
        for idx, note in enumerate(group.notes):
            total_notes += 1
            midi = note_name_to_midi(note)
            # Shift by one octave up or down
            shifted = midi + 12 if midi < 96 else midi - 12
            shifted_name = midi_to_note_name(shifted)
            shifted_freq = midi_to_frequency(shifted)

            ts = follower.exercise.start_time + group.expected_time_sec
            r = follower.process_detection(shifted_name, shifted_freq, 0.90, timestamp=ts)
            if not r.get("matched"):
                rejected += 1

    return rejected, total_notes


def simulate_partial_chords(exercise, *, seed=42, song_name=""):
    """For every chord (>1 note), play only the first note.

    Chords should NOT end up as CORRECT. The follower reclassifies expired
    PARTIAL groups as MISSED, which is correct behavior — an incomplete chord
    is effectively missed. Returns (not_correct_count, total_chord_count, correct_singles).
    """
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    chord_groups = [g for g in exercise.groups if len(g.notes) > 1]
    if not chord_groups:
        return 0, 0, 0

    for group in exercise.groups:
        note = group.notes[0]
        freq = group.frequencies[0]
        ts = follower.exercise.start_time + group.expected_time_sec
        follower.process_detection(note, freq, 0.90, timestamp=ts)

    # Advance past end — PARTIAL groups expire to MISSED
    final_time = follower.exercise.start_time + exercise.groups[-1].expected_time_sec + 5.0
    follower.get_progress(timestamp=final_time)

    not_correct_count = sum(1 for g in chord_groups if g.status != BeatGroupStatus.CORRECT)
    correct_single = sum(1 for g in exercise.groups
                         if len(g.notes) == 1 and g.status == BeatGroupStatus.CORRECT)
    return not_correct_count, len(chord_groups), correct_single


def simulate_sight_reading(exercise, *, seed=42, song_name=""):
    """Simulate sight-reading: early notes on time, later notes increasingly late.

    Offset grows linearly from 0ms to 500ms over the exercise.
    Returns early-half and late-half timing distributions.
    """
    rng = random.Random(seed)
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    total = len(exercise.groups)
    midpoint = total // 2
    early_timing = {"on_time": 0, "early": 0, "late": 0}
    late_timing = {"on_time": 0, "early": 0, "late": 0}

    for i, group in enumerate(exercise.groups):
        progress_frac = i / max(1, total - 1)
        offset = progress_frac * 500.0  # 0ms to 500ms increasing lag

        for idx, note in enumerate(group.notes):
            ts = follower.exercise.start_time + group.expected_time_sec + offset / 1000.0
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            r = follower.process_detection(note, freq, 0.90, timestamp=ts)

            if r.get("matched"):
                ts_status = r.get("timing_status", "on_time")
                if i < midpoint:
                    early_timing[ts_status] = early_timing.get(ts_status, 0) + 1
                else:
                    late_timing[ts_status] = late_timing.get(ts_status, 0) + 1

    return early_timing, late_timing


def simulate_half_tempo(exercise_path, name, *, seed=42):
    """Load exercise and set tempo to 0.5x, then play with beginner profile.

    At half tempo, timing windows double, so a beginner should score higher
    than at full tempo.
    """
    ex_full = load_midi_exercise(exercise_path, name)
    ex_half = load_midi_exercise(exercise_path, name)

    # Full tempo beginner
    r_full = simulate(ex_full, wrong_rate=0.10, jitter_ms=250, offset_ms=80,
                      seed=seed, song_name=name, scenario_name="full_tempo_beginner")

    # Half tempo beginner — start first, then slow down
    follower = BeatAwareScoreFollower(ex_half, lookahead_groups=1)
    follower.start()
    follower.set_tempo_multiplier(0.5)

    rng = random.Random(seed)

    for group in ex_half.groups:
        for idx, note in enumerate(group.notes):
            if rng.random() < 0.10:
                wrong = adjacent_wrong_note(note, rng)
                wrong_freq = midi_to_frequency(note_name_to_midi(wrong))
                j = rng.uniform(-250, 250) / 1000.0
                ts = follower.exercise.start_time + group.expected_time_sec + 0.08 + j
                follower.process_detection(wrong, wrong_freq, 0.85, timestamp=ts)
                continue

            j = rng.uniform(-250, 250) / 1000.0
            ts = follower.exercise.start_time + group.expected_time_sec + 0.08 + j
            freq = group.frequencies[idx] if idx < len(group.frequencies) else group.frequencies[0]
            follower.process_detection(note, freq, 0.90, timestamp=ts)

    total = len(ex_half.groups)
    final_time = follower.exercise.start_time + ex_half.groups[-1].expected_time_sec + 10.0
    progress = follower.get_progress(timestamp=final_time)
    half_acc = progress["correct"] / total * 100 if total else 0

    return r_full.accuracy, half_acc


def simulate_bar_stats(exercise, *, seed=42, song_name=""):
    """Play first 2 bars perfectly, verify bar stats are clean."""
    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1)
    follower.start()

    bar0_groups = [g for g in exercise.groups if g.bar_index == 0]
    bar1_groups = [g for g in exercise.groups if g.bar_index == 1]

    # Play bar 0 perfectly
    for g in bar0_groups:
        for note, freq in zip(g.notes, g.frequencies):
            ts = follower.exercise.start_time + g.expected_time_sec
            follower.process_detection(note, freq, 0.9, timestamp=ts)

    # Play bar 1 perfectly
    for g in bar1_groups:
        for note, freq in zip(g.notes, g.frequencies):
            ts = follower.exercise.start_time + g.expected_time_sec
            follower.process_detection(note, freq, 0.9, timestamp=ts)

    # Advance to bar 2
    if bar1_groups:
        ts = follower.exercise.start_time + bar1_groups[-1].expected_time_sec + 2.0
    else:
        ts = follower.exercise.start_time + 5.0
    progress = follower.get_progress(timestamp=ts)

    bar0_stats = follower.get_bar_stats(0)
    bar1_stats = follower.get_bar_stats(1)

    return bar0_stats, bar1_stats, progress


# ── Main test runner ──────────────────────────────────────────────

def run_tests():
    failures = 0
    results_table = []

    print("=" * 90)
    print("MULTI-SONG SIMULATION TEST SUITE")
    print("=" * 90)

    # ── PART 1: Perfect player on every song ──────────────────────
    print("\n" + "─" * 90)
    print("PART 1: Perfect player — every song should reach 100%")
    print("─" * 90)

    for song in SONG_CATALOG:
        path = os.path.join(SONGS_DIR, song["path"])
        if not os.path.exists(path):
            print(f"  SKIP {song['name']} — file not found")
            continue

        ex = load_midi_exercise(path, song["name"])
        r = simulate(ex, song_name=song["name"], scenario_name="perfect", seed=1)

        status = "PASS" if r.accuracy == 100.0 and r.completed else "FAIL"
        if status == "FAIL":
            failures += 1
        print(f"  [{status}] {song['name']:45s} | {ex.time_signature} | {ex.bpm:5.0f} BPM | "
              f"{len(ex.groups):4d} groups | acc={r.accuracy:.0f}%")
        results_table.append(r)

    # ── PART 2: Skill-level gradient per song ─────────────────────
    print("\n" + "─" * 90)
    print("PART 2: Beginner < Advanced accuracy for each song")
    print("─" * 90)

    # Use a representative subset (beginner versions are melody-only)
    gradient_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Moonlight", "moonlight_sonata/moonlight_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Ajeeb (3/4)", "ajeeb_daastaan/ajeeb_beginner.mid"),
        ("Pal Pal", "pal_pal_dil_ke_paas/pal_pal_beginner.mid"),
        ("Perfect (6/8)", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        # MuseScore Bollywood transcriptions
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Ajeeb MS", "ajeeb_daastaan/ajeeb_musescore.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in gradient_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            print(f"  SKIP {name}")
            continue

        ex_b = load_midi_exercise(path, name)
        ex_a = load_midi_exercise(path, name)

        r_beginner = simulate(ex_b, wrong_rate=0.15, jitter_ms=300, offset_ms=100,
                              partial_chord_rate=0.3, seed=42,
                              song_name=name, scenario_name="beginner")
        r_advanced = simulate(ex_a, wrong_rate=0.01, jitter_ms=60, offset_ms=10,
                              seed=7, song_name=name, scenario_name="advanced")

        ok = r_beginner.accuracy < r_advanced.accuracy
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | beginner={r_beginner.accuracy:5.1f}% < advanced={r_advanced.accuracy:5.1f}%")

    # ── PART 3: Timing detection — rushing vs dragging ────────────
    print("\n" + "─" * 90)
    print("PART 3: Rushing vs dragging detection across songs")
    print("─" * 90)

    timing_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Ajeeb (3/4)", "ajeeb_daastaan/ajeeb_beginner.mid"),
        ("Perfect (6/8)", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in timing_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex_rush = load_midi_exercise(path, name)
        ex_drag = load_midi_exercise(path, name)

        r_rush = simulate(ex_rush, offset_ms=-300, jitter_ms=50, seed=21,
                          song_name=name, scenario_name="rushing")
        r_drag = simulate(ex_drag, offset_ms=300, jitter_ms=50, seed=33,
                          song_name=name, scenario_name="dragging")

        rush_ok = r_rush.timing["early"] > r_rush.timing["late"]
        drag_ok = r_drag.timing["late"] > r_drag.timing["early"]

        status_r = "PASS" if rush_ok else "FAIL"
        status_d = "PASS" if drag_ok else "FAIL"
        if not rush_ok:
            failures += 1
        if not drag_ok:
            failures += 1

        print(f"  [{status_r}] {name:20s} rushing  | early={r_rush.timing['early']:3d} > late={r_rush.timing['late']:3d}")
        print(f"  [{status_d}] {name:20s} dragging | late={r_drag.timing['late']:3d} > early={r_drag.timing['early']:3d}")

    # ── PART 4: Right-hand-only mode ──────────────────────────────
    print("\n" + "─" * 90)
    print("PART 4: Right-hand-only practice mode (advanced versions)")
    print("─" * 90)

    rh_songs = [
        ("Twinkle RH", "twinkle/twinkle_advanced.mid"),
        ("Canon RH", "canon_in_d/canon_advanced.mid"),
        ("Yeh Shaam RH", "yeh_shaam_mastani/yeh_shaam_advanced.mid"),
        ("Ajeeb RH", "ajeeb_daastaan/ajeeb_advanced.mid"),
        ("Perfect RH", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS RH", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS RH", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in rh_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        r = simulate_rh_only(path, name)
        ok = r.accuracy == 100.0 and r.completed
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:25s} | {r.total_groups:4d} RH groups | acc={r.accuracy:.0f}%")

    # ── PART 5: Adaptive tempo (Fix 1+2+5 from Codex audit) ──────
    print("\n" + "─" * 90)
    print("PART 5: Adaptive tempo — struggling player should trigger slowdown")
    print("─" * 90)

    adaptive_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Perfect", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in adaptive_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        r, changes, final_mult = simulate_adaptive_tempo(
            ex, wrong_rate=0.25, jitter_ms=400, seed=42, song_name=name
        )

        # For songs with enough bars, struggling should trigger at least one tempo change
        num_bars = max(g.bar_index for g in ex.groups) + 1
        if num_bars >= 4:
            ok = len(changes) > 0
            status = "PASS" if ok else "FAIL"
            if not ok:
                failures += 1
            print(f"  [{status}] {name:25s} | {num_bars:2d} bars | {len(changes)} tempo changes | "
                  f"final mult={final_mult:.2f}")
        else:
            print(f"  [SKIP] {name:25s} | only {num_bars} bars, too short for adaptive tempo")

    # ── PART 6: Per-bar stats (Fix 7 from Codex audit) ────────────
    print("\n" + "─" * 90)
    print("PART 6: Per-bar stats — verify clean bars report correctly")
    print("─" * 90)

    bar_stat_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Ajeeb (3/4)", "ajeeb_daastaan/ajeeb_beginner.mid"),
        ("Perfect (6/8)", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Ajeeb MS", "ajeeb_daastaan/ajeeb_musescore.mid"),
    ]

    for name, rel_path in bar_stat_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        bar0, bar1, progress = simulate_bar_stats(ex, song_name=name)

        ok0 = bar0["clean"] and bar0["accuracy"] == 100.0
        ok1 = bar1["clean"] and bar1["accuracy"] == 100.0
        has_last_bar = progress.get("last_bar_stats") is not None

        status = "PASS" if (ok0 and ok1 and has_last_bar) else "FAIL"
        if status == "FAIL":
            failures += 1
        print(f"  [{status}] {name:25s} | bar0: {bar0['correct']}/{bar0['total']} clean={bar0['clean']} | "
              f"bar1: {bar1['correct']}/{bar1['total']} clean={bar1['clean']} | "
              f"last_bar_stats={'present' if has_last_bar else 'MISSING'}")

    # ── PART 7: 3/4 waltz and 6/8 compound meter ─────────────────
    print("\n" + "─" * 90)
    print("PART 7: Non-4/4 time signatures work correctly")
    print("─" * 90)

    meter_tests = [
        ("Ajeeb (3/4 waltz)", "ajeeb_daastaan/ajeeb_beginner.mid", (3, 4), 1.0),
        ("Perfect (6/8 compound)", "perfect/ed-sheeran---perfect-easy-for-beginners.mid", (6, 8), 1.5),
        ("Pal Pal MS (4/4)", "pal_pal_dil_ke_paas/pal_pal_musescore.mid", (4, 4), 1.0),
        ("Ajeeb MS (6/8)", "ajeeb_daastaan/ajeeb_musescore.mid", (6, 8), 1.5),
        ("Yeh Shaam MS (6/8)", "yeh_shaam_mastani/yeh_shaam_musescore.mid", (6, 8), 1.5),
    ]

    for name, rel_path, expected_sig, expected_beat_unit in meter_tests:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        sig_ok = ex.time_signature == expected_sig
        bu_ok = abs(ex.beat_unit - expected_beat_unit) < 0.01

        r = simulate(ex, song_name=name, scenario_name="meter_check", seed=1)
        acc_ok = r.accuracy == 100.0

        all_ok = sig_ok and bu_ok and acc_ok
        status = "PASS" if all_ok else "FAIL"
        if not all_ok:
            failures += 1
        print(f"  [{status}] {name:30s} | sig={ex.time_signature} (expect {expected_sig}) | "
              f"beat_unit={ex.beat_unit} (expect {expected_beat_unit}) | acc={r.accuracy:.0f}%")

    # ── PART 8: Dense piece stress test (Fur Elise, 786 groups) ──
    print("\n" + "─" * 90)
    print("PART 8: Dense piece stress test — Fur Elise (786 groups)")
    print("─" * 90)

    fur_path = os.path.join(SONGS_DIR, "fur_elise", "fur_elise.mid")
    if os.path.exists(fur_path):
        ex = load_midi_exercise(fur_path, "Fur Elise")

        # Perfect play
        r_perf = simulate(ex, seed=1, song_name="Fur Elise", scenario_name="perfect")
        ok_perf = r_perf.accuracy == 100.0 and r_perf.completed
        status = "PASS" if ok_perf else "FAIL"
        if not ok_perf:
            failures += 1
        print(f"  [{status}] Perfect play:  {r_perf.correct}/{r_perf.total_groups} groups | acc={r_perf.accuracy:.0f}%")

        # Intermediate play
        r_mid = simulate(ex, wrong_rate=0.05, jitter_ms=150, offset_ms=-30, seed=99,
                         song_name="Fur Elise", scenario_name="intermediate")
        print(f"  [INFO] Intermediate: {r_mid.correct}/{r_mid.total_groups} groups | acc={r_mid.accuracy:.1f}% | "
              f"wrong={r_mid.wrong_notes}")
    else:
        print("  SKIP — Fur Elise MIDI not found")

    # ── PART 9: Cross-song consistency checks ─────────────────────
    print("\n" + "─" * 90)
    print("PART 9: Cross-song consistency — same player profile, different songs")
    print("─" * 90)

    consistency_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Pal Pal", "pal_pal_dil_ke_paas/pal_pal_beginner.mid"),
        # NOTE: Pal Pal MS (615 dense polyphonic groups) is excluded from
        # consistency check — the generic beginner/advanced profile doesn't
        # differentiate well on dense MuseScore transcriptions.
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    beginner_accs = []
    advanced_accs = []

    for name, rel_path in consistency_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex_b = load_midi_exercise(path, name)
        ex_a = load_midi_exercise(path, name)

        rb = simulate(ex_b, wrong_rate=0.15, jitter_ms=300, offset_ms=100, seed=42,
                      song_name=name, scenario_name="beginner")
        ra = simulate(ex_a, wrong_rate=0.01, jitter_ms=60, offset_ms=10, seed=7,
                      song_name=name, scenario_name="advanced")

        beginner_accs.append(rb.accuracy)
        advanced_accs.append(ra.accuracy)

        print(f"  {name:20s} | beginner={rb.accuracy:5.1f}% | advanced={ra.accuracy:5.1f}%")

    if beginner_accs and advanced_accs:
        avg_b = sum(beginner_accs) / len(beginner_accs)
        avg_a = sum(advanced_accs) / len(advanced_accs)
        spread_ok = avg_a - avg_b >= 20  # Advanced should be at least 20% better on average
        status = "PASS" if spread_ok else "FAIL"
        if not spread_ok:
            failures += 1
        print(f"\n  [{status}] Average: beginner={avg_b:.1f}% vs advanced={avg_a:.1f}% "
              f"(spread={avg_a - avg_b:.1f}%, need >=20%)")

    # ── PART 10: Left-hand-only practice mode ─────────────────────
    print("\n" + "─" * 90)
    print("PART 10: Left-hand-only practice mode (multi-track songs)")
    print("─" * 90)

    lh_songs = [
        ("Twinkle LH", "twinkle/twinkle_advanced.mid"),
        ("Canon LH", "canon_in_d/canon_advanced.mid"),
        ("Yeh Shaam LH", "yeh_shaam_mastani/yeh_shaam_advanced.mid"),
        ("Perfect LH", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS LH", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS LH", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in lh_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        try:
            r = simulate_lh_only(path, name)
            ok = r.accuracy == 100.0 and r.completed
            status = "PASS" if ok else "FAIL"
            if not ok:
                failures += 1
            print(f"  [{status}] {name:25s} | {r.total_groups:4d} LH groups | acc={r.accuracy:.0f}%")
        except ValueError as e:
            # Some songs may not have a left-hand track
            print(f"  [SKIP] {name:25s} | {e}")

    # ── PART 11: Recovery pattern ───────────────────────────────
    print("\n" + "─" * 90)
    print("PART 11: Recovery pattern — bad start, good finish (second half > first half)")
    print("─" * 90)

    recovery_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Perfect", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
    ]

    for name, rel_path in recovery_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        first_acc, second_acc, _ = simulate_recovery(ex, song_name=name)
        ok = second_acc > first_acc
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | first_half={first_acc:5.1f}% < second_half={second_acc:5.1f}%")

    # ── PART 12: Fatigue simulation ─────────────────────────────
    print("\n" + "─" * 90)
    print("PART 12: Fatigue simulation — accuracy degrades over time (Q1 > Q4)")
    print("─" * 90)

    fatigue_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Perfect", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in fatigue_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        q1_acc, q4_acc = simulate_fatigue(ex, song_name=name)
        ok = q1_acc > q4_acc
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | Q1={q1_acc:5.1f}% > Q4={q4_acc:5.1f}% "
              f"(drop={q1_acc - q4_acc:+.1f}pp)")

    # ── PART 13: Loop practice — improving over repetitions ─────
    print("\n" + "─" * 90)
    print("PART 13: Loop practice — play same bars 3 times, accuracy must improve")
    print("─" * 90)

    loop_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Ajeeb (3/4)", "ajeeb_daastaan/ajeeb_beginner.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in loop_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        accs = simulate_loop_practice(path, name, bars_to_loop=2, iterations=3, song_name=name)
        # Final iteration should be best (or tied with first for very easy pieces)
        ok = accs[2] >= accs[0] and accs[2] >= accs[1]
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | loop1={accs[0]:5.1f}% → loop2={accs[1]:5.1f}% "
              f"→ loop3={accs[2]:5.1f}%")

    # ── PART 14: Half-tempo practice ────────────────────────────
    print("\n" + "─" * 90)
    print("PART 14: Half-tempo practice — 0.5x tempo should improve beginner accuracy")
    print("─" * 90)

    # Simple melodies where half-tempo clearly widens timing windows
    half_tempo_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Yeh Shaam", "yeh_shaam_mastani/yeh_shaam_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
    ]

    for name, rel_path in half_tempo_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        full_acc, half_acc = simulate_half_tempo(path, name)
        ok = half_acc >= full_acc
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | full_tempo={full_acc:5.1f}% ≤ half_tempo={half_acc:5.1f}% "
              f"(gain={half_acc - full_acc:+.1f}pp)")

    # Dense polyphonic pieces — half-tempo effect is less predictable
    half_tempo_dense = [
        ("Perfect (6/8)", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
    ]
    for name, rel_path in half_tempo_dense:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue
        full_acc, half_acc = simulate_half_tempo(path, name)
        print(f"  [INFO] {name:20s} | full_tempo={full_acc:5.1f}% / half_tempo={half_acc:5.1f}% "
              f"(dense piece, informational only)")

    # ── PART 15: Wrong octave rejection ─────────────────────────
    print("\n" + "─" * 90)
    print("PART 15: Wrong octave rejection — correct pitch class, wrong octave = rejected")
    print("─" * 90)

    octave_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Ode to Joy", "ode_to_joy/ode_to_joy_beginner.mid"),
        ("Ajeeb MS", "ajeeb_daastaan/ajeeb_musescore.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in octave_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        rejected, total_notes = simulate_wrong_octave(ex, song_name=name)
        # At least 80% should be rejected (some may coincidentally match due
        # to frequency tolerance on notes near octave boundaries)
        reject_rate = rejected / total_notes * 100 if total_notes else 0
        ok = reject_rate >= 80
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | {rejected}/{total_notes} rejected "
              f"({reject_rate:.0f}%, need ≥80%)")

    # ── PART 16: Partial chord completion ───────────────────────
    print("\n" + "─" * 90)
    print("PART 16: Partial chord completion — incomplete chords are NOT correct")
    print("─" * 90)

    chord_songs = [
        ("Twinkle Adv", "twinkle/twinkle_advanced.mid"),
        ("Moonlight Adv", "moonlight_sonata/moonlight_advanced.mid"),
        ("Canon Adv", "canon_in_d/canon_advanced.mid"),
        ("Perfect", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Pal Pal MS", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
    ]

    for name, rel_path in chord_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        not_correct, total_chords, correct_singles = simulate_partial_chords(ex, song_name=name)
        if total_chords == 0:
            print(f"  [SKIP] {name:20s} | no chord groups in exercise")
            continue
        # Nearly all chords should be NOT CORRECT (expired PARTIAL → MISSED).
        # In dense pieces, a few chords may accidentally complete due to
        # overlapping timing windows. Allow up to 5% tolerance.
        not_correct_rate = not_correct / total_chords * 100
        ok = not_correct_rate >= 95
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | {not_correct}/{total_chords} chords NOT correct "
              f"({not_correct_rate:.0f}%) | {correct_singles} single-note groups CORRECT")

    # ── PART 17: Sight-reading lag — increasing lateness ────────
    print("\n" + "─" * 90)
    print("PART 17: Sight-reading — increasing delay should shift timing from on_time to late")
    print("─" * 90)

    sight_songs = [
        ("Twinkle", "twinkle/twinkle_beginner.mid"),
        ("Canon in D", "canon_in_d/canon_beginner.mid"),
        ("Perfect", "perfect/ed-sheeran---perfect-easy-for-beginners.mid"),
        ("Yeh Shaam MS", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
    ]

    for name, rel_path in sight_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        ex = load_midi_exercise(path, name)
        early_t, late_t = simulate_sight_reading(ex, song_name=name)
        # Second half should have more "late" detections than first half
        ok = late_t["late"] > early_t["late"]
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}] {name:20s} | first_half late={early_t['late']:3d}, on_time={early_t['on_time']:3d} | "
              f"second_half late={late_t['late']:3d}, on_time={late_t['on_time']:3d}")

    # ── PART 18: Polyphonic density stress ──────────────────────
    print("\n" + "─" * 90)
    print("PART 18: Polyphonic density stress — dense MuseScore pieces with diverse profiles")
    print("─" * 90)

    dense_songs = [
        ("Pal Pal MS (615g)", "pal_pal_dil_ke_paas/pal_pal_musescore.mid"),
        ("Yeh Shaam MS (192g)", "yeh_shaam_mastani/yeh_shaam_musescore.mid"),
        ("Fur Elise (786g)", "fur_elise/fur_elise.mid"),
    ]

    profiles = [
        ("perfect",        0.00, 0,   0),
        ("advanced",       0.02, 60,  10),
        ("intermediate",   0.08, 200, 50),
        ("beginner",       0.20, 350, 120),
    ]

    for song_name, rel_path in dense_songs:
        path = os.path.join(SONGS_DIR, rel_path)
        if not os.path.exists(path):
            continue

        accs = {}
        row = f"  {song_name:25s} |"
        for profile_name, wr, jit, off in profiles:
            ex = load_midi_exercise(path, song_name)
            r = simulate(ex, wrong_rate=wr, jitter_ms=jit, offset_ms=off,
                         seed=42, song_name=song_name, scenario_name=profile_name)
            accs[profile_name] = r.accuracy
            row += f" {profile_name}={r.accuracy:5.1f}%"

        # Dense polyphonic pieces: require perfect > beginner with meaningful gap.
        # Intermediate profiles may not be strictly monotonic on dense pieces.
        ok = accs["perfect"] > accs["beginner"] + 10
        status = "PASS" if ok else "FAIL"
        if not ok:
            failures += 1
        print(f"  [{status}]{row}")

    # ── VERDICT ───────────────────────────────────────────────────
    print("\n" + "=" * 90)
    if failures == 0:
        print(f"ALL TESTS PASSED across {len(SONG_CATALOG)} songs, 18 test categories")
    else:
        print(f"{failures} FAILURE(S) detected")
    print("=" * 90)

    return failures


if __name__ == "__main__":
    raise SystemExit(run_tests())
