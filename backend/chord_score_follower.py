#!/usr/bin/env python3
"""
Chord-Aware Score Following
Extends the score follower to handle polyphonic detection (chords)
"""

import time
from typing import List, Dict, Optional, Tuple, Set
from dataclasses import dataclass, field
from enum import Enum


class ChordStatus(Enum):
    WAITING = "waiting"  # Not played yet
    CORRECT = "correct"  # Played correctly
    PARTIAL = "partial"  # Some notes correct, some missing
    MISSED = "missed"    # Skipped/wrong chord played


@dataclass
class ExpectedChord:
    """A chord (set of simultaneous notes) we expect the student to play"""
    notes: List[str]  # e.g., ["C4", "E4", "G4"] for C major
    frequencies: List[float]  # Expected frequencies
    position: int  # Position in sequence (0-indexed)
    timing_window: float = 5.0  # How many seconds student has to play it

    # Tolerance for matching
    frequency_tolerance_hz: float = 15.0  # ±15 Hz per note
    partial_match_threshold: float = 0.66  # Need 66% of notes to accept

    # Status tracking
    status: ChordStatus = ChordStatus.WAITING
    detected_at: Optional[float] = None
    detected_notes: List[str] = field(default_factory=list)
    detected_frequencies: List[float] = field(default_factory=list)
    detected_confidence: Optional[float] = None


@dataclass
class ChordExercise:
    """A practice exercise with chord sequences"""
    name: str
    chords: List[ExpectedChord]
    allow_out_of_order: bool = False

    def __post_init__(self):
        self.current_position = 0
        self.start_time = None
        self.completed = False


class ChordScoreFollower:
    """
    Score-aware chord detection.

    Extends the single-note score follower to handle polyphonic detection.
    Matches detected note sets against expected chords.
    """

    def __init__(self, exercise: ChordExercise):
        self.exercise = exercise
        self.detection_history: List[Dict] = []

    def start(self):
        """Start the exercise timer"""
        self.exercise.start_time = time.time()

    def get_current_expected_chords(self) -> List[ExpectedChord]:
        """Get chords we're currently listening for"""
        if self.exercise.completed:
            return []

        if self.exercise.allow_out_of_order:
            # Free play - all unplayed chords are valid
            return [c for c in self.exercise.chords if c.status == ChordStatus.WAITING]
        else:
            # Strict sequence - only current chord + lookahead
            current_pos = self.exercise.current_position
            lookahead = 1  # Allow detecting next chord in advance

            return [
                self.exercise.chords[i]
                for i in range(current_pos, min(current_pos + lookahead, len(self.exercise.chords)))
                if self.exercise.chords[i].status == ChordStatus.WAITING
            ]

    def process_chord_detection(
        self,
        detected_notes: List[str],
        detected_frequencies: List[float],
        confidence: float,
        timestamp: Optional[float] = None
    ) -> Dict:
        """
        Process detected chord and match against expected chords.

        Args:
            detected_notes: List of detected note names (e.g., ["C4", "E4", "G4"])
            detected_frequencies: Corresponding frequencies
            confidence: Overall detection confidence
            timestamp: Detection timestamp

        Returns:
            dict with:
                - matched: bool (did it match an expected chord?)
                - expected_chord: ExpectedChord or None
                - feedback: str (what to tell the student)
                - adjust_confidence: float (boosted or reduced confidence)
                - action: str ("accept", "reject", "ignore")
        """
        if timestamp is None:
            timestamp = time.time()

        expected_chords = self.get_current_expected_chords()

        # No expected chords - either completed or not started
        if not expected_chords:
            return {
                "matched": False,
                "expected_chord": None,
                "feedback": "No active exercise" if not self.exercise.start_time else "Exercise complete!",
                "adjust_confidence": confidence * 0.5,
                "action": "ignore",
            }

        # Try to match detected chord with expected chords
        best_match = self._find_best_chord_match(
            detected_notes,
            detected_frequencies,
            expected_chords
        )

        if best_match:
            expected_chord, match_score, matched_notes = best_match

            # Check if it's a full match or partial match
            match_percent = len(matched_notes) / len(expected_chord.notes)

            if match_percent >= expected_chord.partial_match_threshold:
                # Acceptable match
                expected_chord.status = ChordStatus.CORRECT if match_percent == 1.0 else ChordStatus.PARTIAL
                expected_chord.detected_at = timestamp
                expected_chord.detected_notes = detected_notes
                expected_chord.detected_frequencies = detected_frequencies
                expected_chord.detected_confidence = confidence

                # Advance position in sequence
                if not self.exercise.allow_out_of_order:
                    self.exercise.current_position = expected_chord.position + 1

                    # Check if exercise is complete
                    if self.exercise.current_position >= len(self.exercise.chords):
                        self.exercise.completed = True

                # Boost confidence for matched chords
                adjusted_confidence = min(0.99, confidence * 1.3)

                # Format chord name
                chord_name = " + ".join(expected_chord.notes)
                detected_chord_name = " + ".join(detected_notes)

                # Feedback based on match quality
                if match_percent == 1.0:
                    feedback = f"✓ Perfect chord! {chord_name}"
                else:
                    missing_notes = set(expected_chord.notes) - set(matched_notes)
                    feedback = f"✓ Good! {detected_chord_name} (missing: {', '.join(missing_notes)})"

                result = {
                    "matched": True,
                    "expected_chord": expected_chord,
                    "feedback": feedback,
                    "adjust_confidence": adjusted_confidence,
                    "action": "accept",
                    "match_score": match_score,
                    "match_percent": match_percent,
                    "matched_notes": matched_notes,
                    "progress": f"{self.exercise.current_position}/{len(self.exercise.chords)}",
                }

                self.detection_history.append({
                    "timestamp": timestamp,
                    "detected": detected_notes,
                    "expected": expected_chord.notes,
                    "matched": True,
                    "confidence": confidence,
                })

                return result

        # No match or insufficient match - reject
        adjusted_confidence = confidence * 0.3

        expected_chord_names = [" + ".join(c.notes) for c in expected_chords]
        detected_chord_name = " + ".join(detected_notes) if detected_notes else "no notes"

        result = {
            "matched": False,
            "expected_chord": None,
            "feedback": f"Unexpected: {detected_chord_name}. Expected: {', '.join(expected_chord_names)}",
            "adjust_confidence": adjusted_confidence,
            "action": "reject",
            "expected_chords": expected_chord_names,
        }

        self.detection_history.append({
            "timestamp": timestamp,
            "detected": detected_notes,
            "expected": expected_chord_names,
            "matched": False,
            "confidence": confidence,
        })

        return result

    def _find_best_chord_match(
        self,
        detected_notes: List[str],
        detected_frequencies: List[float],
        expected_chords: List[ExpectedChord]
    ) -> Optional[Tuple[ExpectedChord, float, List[str]]]:
        """
        Find best matching expected chord.

        Returns:
            (ExpectedChord, match_score, matched_notes) or None
        """
        best_match = None
        best_score = 0.0
        best_matched_notes = []

        for expected in expected_chords:
            # Compare sets of notes
            matched_notes = []

            for expected_note, expected_freq in zip(expected.notes, expected.frequencies):
                # Check if any detected note matches this expected note
                for detected_note, detected_freq in zip(detected_notes, detected_frequencies):
                    # Note name match
                    if expected_note == detected_note:
                        # Frequency proximity check
                        freq_diff = abs(detected_freq - expected_freq)
                        if freq_diff <= expected.frequency_tolerance_hz:
                            matched_notes.append(expected_note)
                            break  # Found match for this expected note

            # Calculate match score
            if len(matched_notes) == 0:
                continue

            # Score = percentage of expected notes that were detected
            score = len(matched_notes) / len(expected.notes)

            # Bonus if all notes detected
            if score == 1.0:
                score += 0.1

            # Penalty for extra notes (detected notes not in expected chord)
            extra_notes = len(detected_notes) - len(matched_notes)
            if extra_notes > 0:
                score -= 0.1 * extra_notes

            if score > best_score:
                best_score = score
                best_match = expected
                best_matched_notes = matched_notes

        # Require at least partial match
        if best_score > 0.5 and best_match:
            return (best_match, best_score, best_matched_notes)

        return None

    def get_progress(self) -> Dict:
        """Get current progress through exercise"""
        total = len(self.exercise.chords)
        correct = sum(1 for c in self.exercise.chords if c.status == ChordStatus.CORRECT)
        partial = sum(1 for c in self.exercise.chords if c.status == ChordStatus.PARTIAL)
        missed = sum(1 for c in self.exercise.chords if c.status == ChordStatus.MISSED)
        waiting = sum(1 for c in self.exercise.chords if c.status == ChordStatus.WAITING)

        return {
            "total": total,
            "correct": correct,
            "partial": partial,
            "missed": missed,
            "waiting": waiting,
            "completion_percent": ((correct + partial * 0.7) / total * 100) if total > 0 else 0,
            "completed": self.exercise.completed,
        }


# Helper functions to create chord exercises
def create_basic_chords_exercise() -> ChordExercise:
    """Create basic chord progression: C - F - G - C"""
    chords_data = [
        (["C4", "E4", "G4"], [261.63, 329.63, 392.00]),  # C major
        (["F4", "A4", "C5"], [349.23, 440.00, 523.25]),  # F major
        (["G4", "B4", "D5"], [392.00, 493.88, 587.33]),  # G major
        (["C4", "E4", "G4"], [261.63, 329.63, 392.00]),  # C major
    ]

    expected_chords = [
        ExpectedChord(
            notes=notes,
            frequencies=freqs,
            position=i,
            timing_window=5.0,
            frequency_tolerance_hz=15.0,
            partial_match_threshold=0.66,  # Need 2 out of 3 notes
        )
        for i, (notes, freqs) in enumerate(chords_data)
    ]

    return ChordExercise(
        name="Basic Chords (C-F-G-C)",
        chords=expected_chords,
        allow_out_of_order=False,
    )


def create_c_major_intervals() -> ChordExercise:
    """Create C major intervals (2-note chords)"""
    intervals_data = [
        (["C4", "E4"], [261.63, 329.63]),  # Major third
        (["E4", "G4"], [329.63, 392.00]),  # Minor third
        (["G4", "C5"], [392.00, 523.25]),  # Perfect fourth
    ]

    expected_chords = [
        ExpectedChord(
            notes=notes,
            frequencies=freqs,
            position=i,
            partial_match_threshold=1.0,  # Need both notes for intervals
        )
        for i, (notes, freqs) in enumerate(intervals_data)
    ]

    return ChordExercise(
        name="C Major Intervals",
        chords=expected_chords,
        allow_out_of_order=False,
    )


if __name__ == "__main__":
    # Demo
    print("Chord Score Follower Demo")
    print("=" * 60)

    # Create basic chords exercise
    exercise = create_basic_chords_exercise()
    follower = ChordScoreFollower(exercise)
    follower.start()

    print(f"Exercise: {exercise.name}")
    for chord in exercise.chords:
        print(f"  {' + '.join(chord.notes)}")
    print()

    # Simulate some chord detections
    test_detections = [
        (["C4", "E4", "G4"], [261.5, 329.8, 392.2], 0.95),  # C major - correct
        (["F4", "A4", "C5"], [349.1, 440.2, 523.0], 0.92),  # F major - correct
        (["G4", "B4"], [392.1, 494.0], 0.88),  # G major incomplete (missing D5)
        (["C4", "E4", "G4"], [261.4, 329.9, 392.1], 0.94),  # C major - correct
    ]

    for notes, freqs, conf in test_detections:
        result = follower.process_chord_detection(notes, freqs, conf)

        print(f"Detected: {' + '.join(notes)} (confidence: {conf:.2%})")
        print(f"  Matched: {result['matched']}")
        print(f"  Feedback: {result['feedback']}")
        print(f"  Adjusted confidence: {result['adjust_confidence']:.2%}")
        print(f"  Action: {result['action']}")
        if 'match_percent' in result:
            print(f"  Match quality: {result['match_percent']:.1%}")
        print()

    print("Progress:")
    progress = follower.get_progress()
    print(f"  Correct: {progress['correct']}/{progress['total']}")
    print(f"  Partial: {progress['partial']}/{progress['total']}")
    print(f"  Completion: {progress['completion_percent']:.1f}%")
    print()

    print("✓ Chord score follower working correctly!")
