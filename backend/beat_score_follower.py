#!/usr/bin/env python3
"""
Beat-aware score follower for real-time timing feedback.

Supports groups of simultaneous notes (chords) and beat-based timing windows.
"""

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple


class BeatGroupStatus(Enum):
    WAITING = "waiting"
    PARTIAL = "partial"
    CORRECT = "correct"
    MISSED = "missed"


class TimingStatus(Enum):
    ON_TIME = "on_time"
    EARLY = "early"
    LATE = "late"


@dataclass
class ExpectedGroup:
    """A group of notes expected at the same beat position."""
    notes: List[str]
    frequencies: List[float]
    position: int
    beat_position: float
    expected_time_sec: float
    bar_index: int
    timing_tolerance_sec: float
    timing_max_sec: float
    hand: Optional[str] = None  # "left", "right", or None (mixed/unknown)
    fingers: List[int] = field(default_factory=list)  # Finger numbers 1-5 for each note

    status: BeatGroupStatus = BeatGroupStatus.WAITING
    matched_notes: List[str] = field(default_factory=list)
    detected_at: Optional[float] = None
    detected_confidence: Optional[float] = None


@dataclass
class BeatExercise:
    """Beat-based exercise consisting of expected groups of notes."""
    name: str
    groups: List[ExpectedGroup]
    bpm: float
    time_signature: Tuple[int, int]
    beat_unit: float
    beats_per_bar: float

    def __post_init__(self) -> None:
        self.current_group_index = 0
        self.start_time = None
        self.completed = False


class BeatAwareScoreFollower:
    """Beat-aware score follower with early/late feedback and adaptive tempo."""

    def __init__(self, exercise: BeatExercise, lookahead_groups: int = 1, frequency_tolerance_hz: float = 15.0, practice_mode: bool = False):
        self.exercise = exercise
        self.lookahead_groups = max(0, lookahead_groups)
        self.frequency_tolerance_hz = frequency_tolerance_hz
        self.practice_mode = practice_mode  # When True, timing checks are disabled
        self.detection_history: List[Dict] = []

        # Adaptive tempo state
        self._tempo_multiplier: float = 1.0
        self._original_times: List[float] = [g.expected_time_sec for g in exercise.groups]
        self._original_tolerances: List[float] = [g.timing_tolerance_sec for g in exercise.groups]
        self._original_max_windows: List[float] = [g.timing_max_sec for g in exercise.groups]
        self._consecutive_good_bars: int = 0
        self._last_bar_evaluated: int = -1

    @property
    def tempo_multiplier(self) -> float:
        return self._tempo_multiplier

    @property
    def current_tempo_bpm(self) -> float:
        return self.exercise.bpm * self._tempo_multiplier

    def set_tempo_multiplier(self, multiplier: float) -> None:
        """Set tempo multiplier and rescale all timing values.

        Re-anchors start_time so the current group keeps the same elapsed
        offset, preventing clock desync mid-session.
        """
        multiplier = max(0.5, min(1.0, multiplier))
        if multiplier == self._tempo_multiplier:
            return

        # Snapshot: what the current group's expected_time is right now
        idx = min(self.exercise.current_group_index, len(self.exercise.groups) - 1)
        old_expected = self.exercise.groups[idx].expected_time_sec if self.exercise.groups else 0.0

        self._tempo_multiplier = multiplier
        inv = 1.0 / multiplier
        for i, group in enumerate(self.exercise.groups):
            group.expected_time_sec = self._original_times[i] * inv
            group.timing_tolerance_sec = self._original_tolerances[i] * inv
            group.timing_max_sec = self._original_max_windows[i] * inv

        # Re-anchor: elapsed to old expected == elapsed to new expected
        if self.exercise.start_time is not None and self.exercise.groups:
            new_expected = self.exercise.groups[idx].expected_time_sec
            # old_elapsed = now - start_time should have equaled old_expected + delta
            # new_elapsed should equal new_expected + same delta
            # So shift start_time by (new_expected - old_expected)
            self.exercise.start_time -= (new_expected - old_expected)

    def adjust_tempo(self) -> Optional[float]:
        """Auto-adjust tempo based on current bar performance.

        Returns new tempo_multiplier if changed, or None if unchanged.
        Call this at bar boundaries.
        """
        current_bar = self._current_bar_index()
        if current_bar == self._last_bar_evaluated:
            return None
        self._last_bar_evaluated = current_bar

        # Gather stats for the bar that just completed (current_bar - 1)
        prev_bar = current_bar - 1
        if prev_bar < 0:
            return None

        bar_groups = [g for g in self.exercise.groups if g.bar_index == prev_bar]
        if not bar_groups:
            return None

        total = len(bar_groups)
        correct = sum(1 for g in bar_groups if g.status == BeatGroupStatus.CORRECT)
        missed = sum(1 for g in bar_groups if g.status == BeatGroupStatus.MISSED)

        # Count timing errors only for the completed bar
        timing_errors = 0
        for entry in self.detection_history:
            if entry.get("bar_index") != prev_bar:
                continue
            if entry.get("matched") and entry.get("timing_status") in ("early", "late"):
                timing_errors += 1

        accuracy = correct / total if total > 0 else 0
        timing_error_rate = timing_errors / total if total > 0 else 0

        old_mult = self._tempo_multiplier

        if accuracy < 0.6 or timing_error_rate > 0.5:
            # Struggling: slow down by 10%
            self._consecutive_good_bars = 0
            new_mult = max(0.5, old_mult - 0.10)
            if new_mult != old_mult:
                self.set_tempo_multiplier(new_mult)
                return new_mult
        elif accuracy > 0.9 and timing_error_rate < 0.1:
            self._consecutive_good_bars += 1
            if self._consecutive_good_bars >= 2 and old_mult < 1.0:
                # Speed up by 5%, never exceed original
                new_mult = min(1.0, old_mult + 0.05)
                self._consecutive_good_bars = 0
                self.set_tempo_multiplier(new_mult)
                return new_mult
        else:
            self._consecutive_good_bars = 0

        return None

    def start(self) -> None:
        self.exercise.start_time = time.time()

    def _elapsed(self, timestamp: Optional[float]) -> float:
        if self.exercise.start_time is None:
            self.start()
        if timestamp is None:
            timestamp = time.time()
        return max(0.0, timestamp - self.exercise.start_time)

    def _advance_missed_groups(self, elapsed_sec: float) -> None:
        if self.exercise.completed:
            return
        while self.exercise.current_group_index < len(self.exercise.groups):
            group = self.exercise.groups[self.exercise.current_group_index]
            if group.status in (BeatGroupStatus.CORRECT, BeatGroupStatus.MISSED):
                self.exercise.current_group_index += 1
                continue
            if elapsed_sec > (group.expected_time_sec + group.timing_max_sec):
                group.status = BeatGroupStatus.MISSED
                self.exercise.current_group_index += 1
                continue
            break

        if self.exercise.current_group_index >= len(self.exercise.groups):
            self.exercise.completed = True

    def _current_bar_index(self) -> int:
        if not self.exercise.groups:
            return 0
        idx = min(self.exercise.current_group_index, len(self.exercise.groups) - 1)
        return self.exercise.groups[idx].bar_index

    def _reset_from_group(self, group_index: int) -> None:
        group_index = max(0, min(group_index, len(self.exercise.groups)))
        for i, group in enumerate(self.exercise.groups):
            if i < group_index:
                group.status = BeatGroupStatus.CORRECT
                group.matched_notes = list(group.notes)
            else:
                group.status = BeatGroupStatus.WAITING
                group.matched_notes = []
                group.detected_at = None
                group.detected_confidence = None
        self.exercise.current_group_index = group_index
        self.exercise.completed = False
        if group_index < len(self.exercise.groups):
            target = self.exercise.groups[group_index]
            self.exercise.start_time = time.time() - target.expected_time_sec
        else:
            self.exercise.start_time = time.time()

    def replay_last_bars(self, bars: int = 1) -> int:
        bars = max(1, bars)
        current_bar = self._current_bar_index()
        target_bar = max(0, current_bar - bars)
        target_index = 0
        for group in self.exercise.groups:
            if group.bar_index == target_bar:
                target_index = group.position
                break
        self._reset_from_group(target_index)
        return target_bar

    def get_current_expected_groups(self, timestamp: Optional[float] = None) -> List[ExpectedGroup]:
        if self.exercise.completed:
            return []
        elapsed = self._elapsed(timestamp)
        self._advance_missed_groups(elapsed)
        start = self.exercise.current_group_index
        end = min(len(self.exercise.groups), start + 1 + self.lookahead_groups)
        return [
            group
            for group in self.exercise.groups[start:end]
            if group.status == BeatGroupStatus.WAITING or group.status == BeatGroupStatus.PARTIAL
        ]

    def get_current_expected_notes(self, timestamp: Optional[float] = None) -> List[str]:
        notes: List[str] = []
        for group in self.get_current_expected_groups(timestamp):
            for note in group.notes:
                if group.matched_notes.count(note) < group.notes.count(note):
                    notes.append(note)
        return notes

    def process_detection(
        self,
        detected_note: str,
        detected_frequency: float,
        confidence: float,
        timestamp: Optional[float] = None,
    ) -> Dict:
        elapsed = self._elapsed(timestamp)
        self._advance_missed_groups(elapsed)

        if self.exercise.completed:
            return {
                "matched": False,
                "feedback": "Exercise complete!",
                "adjust_confidence": confidence * 0.5,
                "action": "ignore",
            }

        candidates = self.get_current_expected_groups(timestamp)

        # Debug logging
        current_idx = self.exercise.current_group_index
        expected_notes = [g.notes for g in candidates[:2]]
        expected_times = [(g.expected_time_sec, g.timing_max_sec) for g in candidates[:2]]
        print(f"[FOLLOWER] detected={detected_note} @ {elapsed:.2f}s | current_idx={current_idx} | expected={expected_notes} | windows={expected_times}")

        selected_group: Optional[ExpectedGroup] = None
        for group in candidates:
            if detected_note not in group.notes:
                print(f"  [SKIP] group {group.position}: {detected_note} not in {group.notes}")
                continue
            if group.matched_notes.count(detected_note) >= group.notes.count(detected_note):
                print(f"  [SKIP] group {group.position}: already matched")
                continue
            # Frequency validation: check proximity to expected frequency
            note_idx = group.notes.index(detected_note)
            expected_freq = group.frequencies[note_idx]
            if detected_frequency > 0 and abs(detected_frequency - expected_freq) > self.frequency_tolerance_hz:
                print(f"  [SKIP] group {group.position}: freq mismatch {detected_frequency:.1f} vs {expected_freq:.1f}")
                continue
            delta = elapsed - group.expected_time_sec
            # In practice_mode, accept any correct note regardless of timing
            if self.practice_mode or abs(delta) <= group.timing_max_sec:
                if self.practice_mode:
                    print(f"  [MATCH] group {group.position}: practice_mode (timing disabled)")
                else:
                    print(f"  [MATCH] group {group.position}: delta={delta:.3f}s within window {group.timing_max_sec:.3f}s")
                selected_group = group
                break
            else:
                print(f"  [SKIP] group {group.position}: delta={delta:.3f}s OUTSIDE window {group.timing_max_sec:.3f}s")

        if not selected_group:
            expected_notes = self.get_current_expected_notes(timestamp)
            self.detection_history.append({
                "timestamp": elapsed,
                "detected": detected_note,
                "expected": expected_notes,
                "matched": False,
                "confidence": confidence,
                "bar_index": self._current_bar_index(),
            })
            return {
                "matched": False,
                "feedback": f"Unexpected note {detected_note}",
                "adjust_confidence": confidence * 0.3,
                "action": "reject",
                "expected_notes": expected_notes,
            }

        group = selected_group
        delta = elapsed - group.expected_time_sec
        timing_status = TimingStatus.ON_TIME
        if abs(delta) > group.timing_tolerance_sec:
            timing_status = TimingStatus.EARLY if delta < 0 else TimingStatus.LATE

        group.matched_notes.append(detected_note)
        group.detected_at = elapsed
        group.detected_confidence = confidence
        if len(group.matched_notes) == len(group.notes):
            group.status = BeatGroupStatus.CORRECT
            # Advance to next waiting group
            if self.exercise.current_group_index == group.position:
                self.exercise.current_group_index += 1
        else:
            group.status = BeatGroupStatus.PARTIAL

        if self.exercise.current_group_index >= len(self.exercise.groups):
            self.exercise.completed = True

        timing_ms = int(delta * 1000)
        timing_label = "on time"
        if timing_status == TimingStatus.EARLY:
            timing_label = f"early by {abs(timing_ms)}ms"
        elif timing_status == TimingStatus.LATE:
            timing_label = f"late by {abs(timing_ms)}ms"

        result = {
            "matched": True,
            "feedback": f"✓ {detected_note} ({timing_label})",
            "adjust_confidence": min(0.99, confidence * 1.2),
            "action": "accept",
            "timing_status": timing_status.value,
            "timing_error_ms": timing_ms,
            "group_position": group.position + 1,
            "group_total": len(self.exercise.groups),
            "expected_notes": list(group.notes),
        }

        self.detection_history.append({
            "timestamp": elapsed,
            "detected": detected_note,
            "expected": group.notes,
            "matched": True,
            "confidence": confidence,
            "timing_status": timing_status.value,
            "bar_index": group.bar_index,
        })

        return result

    def get_bar_stats(self, bar_index: int) -> Dict:
        """Return accuracy stats for a specific bar (0-indexed).

        Includes correct, missed, partial, and total group counts for the bar,
        enabling "loop until N clean bars" logic.
        """
        bar_groups = [g for g in self.exercise.groups if g.bar_index == bar_index]
        bar_total = len(bar_groups)
        bar_correct = sum(1 for g in bar_groups if g.status == BeatGroupStatus.CORRECT)
        bar_missed = sum(1 for g in bar_groups if g.status == BeatGroupStatus.MISSED)
        bar_partial = sum(1 for g in bar_groups if g.status == BeatGroupStatus.PARTIAL)
        bar_accuracy = (bar_correct / bar_total * 100) if bar_total > 0 else 0
        return {
            "bar_index": bar_index,
            "total": bar_total,
            "correct": bar_correct,
            "missed": bar_missed,
            "partial": bar_partial,
            "accuracy": round(bar_accuracy, 1),
            "clean": bar_missed == 0 and bar_partial == 0 and bar_correct == bar_total,
        }

    def get_progress(self, timestamp: Optional[float] = None) -> Dict:
        elapsed = self._elapsed(timestamp)
        self._advance_missed_groups(elapsed)
        total = len(self.exercise.groups)
        correct = sum(1 for g in self.exercise.groups if g.status == BeatGroupStatus.CORRECT)
        partial = sum(1 for g in self.exercise.groups if g.status == BeatGroupStatus.PARTIAL)
        missed = sum(1 for g in self.exercise.groups if g.status == BeatGroupStatus.MISSED)
        waiting = sum(1 for g in self.exercise.groups if g.status == BeatGroupStatus.WAITING)
        completion_percent = ((correct + partial * 0.6) / total * 100) if total > 0 else 0
        next_notes = self.get_current_expected_notes(timestamp)

        current_bar = self._current_bar_index()
        # Include stats for the most recently completed bar (current_bar - 1)
        prev_bar = current_bar - 1
        last_bar_stats = self.get_bar_stats(prev_bar) if prev_bar >= 0 else None

        return {
            "total": total,
            "correct": correct,
            "partial": partial,
            "missed": missed,
            "waiting": waiting,
            "completion_percent": completion_percent,
            "completed": self.exercise.completed,
            "current_group": min(self.exercise.current_group_index + 1, total) if total > 0 else 0,
            "next_expected_notes": next_notes,
            "current_bar": current_bar + 1,
            "current_bpm": self.current_tempo_bpm,
            "tempo_multiplier": self._tempo_multiplier,
            "last_bar_stats": last_bar_stats,
        }
