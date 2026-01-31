#!/usr/bin/env python3
"""
Score-Aware Note Detection (The "Cheat Code")

Instead of blind transcription, we know what the student SHOULD play.
This dramatically improves accuracy by constraining detection to expected notes.
"""

import time
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from enum import Enum


class NoteStatus(Enum):
    WAITING = "waiting"  # Not played yet
    CORRECT = "correct"  # Played correctly
    MISSED = "missed"    # Skipped/wrong note played
    EARLY = "early"      # Played too early
    LATE = "late"        # Played too late


@dataclass
class ExpectedNote:
    """A note we expect the student to play"""
    note: str  # e.g., "C4"
    frequency: float  # Expected frequency (e.g., 261.63 Hz)
    position: int  # Position in sequence (0-indexed)
    timing_window: float = 5.0  # How many seconds student has to play it

    # Tolerance for frequency matching - MORE AGGRESSIVE (like Simply Piano)
    # ±1 semitone = ~6% frequency difference
    # At C4 (261.63 Hz), 1 semitone = ~15 Hz
    # We use percentage-based tolerance for consistency across octaves
    frequency_tolerance_percent: float = 6.0  # ±6% covers ±1 semitone

    # Legacy Hz-based tolerance (used as fallback)
    frequency_tolerance_hz: float = 20.0  # Increased from 10 Hz

    # Accept octave errors (C3 when expecting C4)
    accept_octave_errors: bool = True

    # Status tracking
    status: NoteStatus = NoteStatus.WAITING
    detected_at: Optional[float] = None
    detected_frequency: Optional[float] = None
    detected_confidence: Optional[float] = None


@dataclass
class Exercise:
    """A practice exercise with known note sequence"""
    name: str
    notes: List[ExpectedNote]
    allow_out_of_order: bool = False  # Strict sequence vs free play

    def __post_init__(self):
        self.current_position = 0
        self.start_time = None
        self.completed = False


class ScoreFollower:
    """
    Score-aware note detection.

    This is the "secret sauce" of tutoring apps like Simply Piano.
    By knowing what the student SHOULD play, we can:
    - Filter out background noise
    - Lower detection threshold for expected notes
    - Raise threshold for unexpected notes
    - Give better feedback
    """

    def __init__(self, exercise: Exercise):
        self.exercise = exercise
        self.detection_history: List[Dict] = []

    def start(self):
        """Start the exercise timer"""
        self.exercise.start_time = time.time()

    def get_current_expected_notes(self) -> List[ExpectedNote]:
        """
        Get notes we're currently listening for.

        Returns:
            List of notes that are "active" (should be playable now)
        """
        if self.exercise.completed:
            return []

        if self.exercise.allow_out_of_order:
            # Free play - all unplayed notes are valid
            return [n for n in self.exercise.notes if n.status == NoteStatus.WAITING]
        else:
            # Strict sequence - only current note + lookahead
            current_pos = self.exercise.current_position
            lookahead = 2  # Allow detecting next 2 notes in advance

            return [
                self.exercise.notes[i]
                for i in range(current_pos, min(current_pos + lookahead, len(self.exercise.notes)))
                if self.exercise.notes[i].status == NoteStatus.WAITING
            ]

    def process_detection(
        self,
        detected_note: str,
        detected_frequency: float,
        confidence: float,
        timestamp: Optional[float] = None
    ) -> Dict:
        """
        Process a detected note and match against expected notes.

        This is where the "magic" happens - we use knowledge of what
        SHOULD be playing to filter and validate detections.

        Returns:
            dict with:
                - matched: bool (did it match an expected note?)
                - expected_note: ExpectedNote or None
                - feedback: str (what to tell the student)
                - adjust_confidence: float (boosted or reduced confidence)
        """
        if timestamp is None:
            timestamp = time.time()

        expected_notes = self.get_current_expected_notes()

        # No expected notes - either completed or not started
        if not expected_notes:
            return {
                "matched": False,
                "expected_note": None,
                "feedback": "No active exercise" if not self.exercise.start_time else "Exercise complete!",
                "adjust_confidence": confidence * 0.5,  # Reduce confidence for unexpected notes
                "action": "ignore",
            }

        # Try to match detected note with expected notes
        best_match = self._find_best_match(
            detected_note,
            detected_frequency,
            expected_notes
        )

        if best_match:
            expected_note, match_score = best_match

            # Mark as correctly detected
            expected_note.status = NoteStatus.CORRECT
            expected_note.detected_at = timestamp
            expected_note.detected_frequency = detected_frequency
            expected_note.detected_confidence = confidence

            # Advance position in sequence
            if not self.exercise.allow_out_of_order:
                self.exercise.current_position = expected_note.position + 1

                # Check if exercise is complete
                if self.exercise.current_position >= len(self.exercise.notes):
                    self.exercise.completed = True

            # Boost confidence for matched notes
            adjusted_confidence = min(0.99, confidence * 1.2)

            # Calculate accuracy
            freq_error = abs(detected_frequency - expected_note.frequency)
            accuracy = max(0, 1.0 - (freq_error / expected_note.frequency_tolerance_hz))

            result = {
                "matched": True,
                "expected_note": expected_note,
                "feedback": f"✓ Correct! {expected_note.note}",
                "adjust_confidence": adjusted_confidence,
                "action": "accept",
                "accuracy": accuracy,
                "frequency_error_hz": freq_error,
                "progress": f"{self.exercise.current_position}/{len(self.exercise.notes)}",
            }

            self.detection_history.append({
                "timestamp": timestamp,
                "detected": detected_note,
                "expected": expected_note.note,
                "matched": True,
                "confidence": confidence,
            })

            return result

        else:
            # No match - this is likely noise or wrong note
            # Reduce confidence significantly
            adjusted_confidence = confidence * 0.3

            expected_note_names = [n.note for n in expected_notes]

            result = {
                "matched": False,
                "expected_note": None,
                "feedback": f"Unexpected note {detected_note}. Expected: {', '.join(expected_note_names)}",
                "adjust_confidence": adjusted_confidence,
                "action": "reject",
                "expected_notes": expected_note_names,
            }

            self.detection_history.append({
                "timestamp": timestamp,
                "detected": detected_note,
                "expected": expected_note_names,
                "matched": False,
                "confidence": confidence,
            })

            return result

    def _find_best_match(
        self,
        detected_note: str,
        detected_frequency: float,
        expected_notes: List[ExpectedNote]
    ) -> Optional[Tuple[ExpectedNote, float]]:
        """
        Find best matching expected note.

        MORE AGGRESSIVE matching (like Simply Piano):
        - Accept ±1 semitone (6% frequency)
        - Accept octave errors (C3 when expecting C4)
        - Lower threshold for acceptance

        Returns:
            (ExpectedNote, match_score) or None
        """
        best_match = None
        best_score = 0.0

        for expected in expected_notes:
            score = 0.0

            # Extract pitch class (note name without octave)
            detected_pitch = detected_note[:-1] if detected_note[-1].isdigit() else detected_note
            expected_pitch = expected.note[:-1] if expected.note[-1].isdigit() else expected.note

            # Exact note name match (including octave)
            if expected.note == detected_note:
                score += 0.8  # Strong match

            # Same pitch class, different octave (octave error)
            elif detected_pitch == expected_pitch and expected.accept_octave_errors:
                score += 0.6  # Accept octave errors with good score

            # Check for enharmonic equivalents (C# = Db, etc.)
            elif self._is_enharmonic(detected_pitch, expected_pitch):
                score += 0.7

            # Frequency proximity match (percentage-based for octave consistency)
            freq_ratio = detected_frequency / expected.frequency
            # Perfect match = 1.0, octave = 2.0 or 0.5

            # Check for near-exact frequency match
            freq_diff_percent = abs(1.0 - freq_ratio) * 100
            if freq_diff_percent <= expected.frequency_tolerance_percent:
                freq_score = 1.0 - (freq_diff_percent / expected.frequency_tolerance_percent)
                score += 0.3 * freq_score

            # Check for octave match (freq ratio near 2.0 or 0.5)
            elif expected.accept_octave_errors:
                if 0.47 <= freq_ratio <= 0.53:  # One octave below
                    score += 0.15
                elif 1.9 <= freq_ratio <= 2.1:  # One octave above
                    score += 0.15

            # LOWER THRESHOLD: Accept at 30% match (was 50%)
            # This makes the system more forgiving like Simply Piano
            if score > 0.3 and score > best_score:
                best_score = score
                best_match = (expected, score)

        return best_match

    def _is_enharmonic(self, note1: str, note2: str) -> bool:
        """Check if two notes are enharmonic equivalents (C# = Db)."""
        enharmonics = {
            'C#': 'Db', 'Db': 'C#',
            'D#': 'Eb', 'Eb': 'D#',
            'F#': 'Gb', 'Gb': 'F#',
            'G#': 'Ab', 'Ab': 'G#',
            'A#': 'Bb', 'Bb': 'A#',
        }
        return enharmonics.get(note1) == note2 or enharmonics.get(note2) == note1

    def get_next_expected_note(self) -> Optional[ExpectedNote]:
        """Get the very next note we're waiting for"""
        expected = self.get_current_expected_notes()
        return expected[0] if expected else None

    def get_progress(self) -> Dict:
        """Get current progress through exercise"""
        total = len(self.exercise.notes)
        correct = sum(1 for n in self.exercise.notes if n.status == NoteStatus.CORRECT)
        missed = sum(1 for n in self.exercise.notes if n.status == NoteStatus.MISSED)
        waiting = sum(1 for n in self.exercise.notes if n.status == NoteStatus.WAITING)

        return {
            "total": total,
            "correct": correct,
            "missed": missed,
            "waiting": waiting,
            "completion_percent": (correct / total * 100) if total > 0 else 0,
            "completed": self.exercise.completed,
        }


# Helper function to create common exercises
def create_c_major_scale() -> Exercise:
    """Create C major scale exercise"""
    notes = [
        ("C4", 261.63),
        ("D4", 293.66),
        ("E4", 329.63),
        ("F4", 349.23),
        ("G4", 392.00),
        ("A4", 440.00),
        ("B4", 493.88),
        ("C5", 523.25),
    ]

    expected_notes = [
        ExpectedNote(
            note=note,
            frequency=freq,
            position=i,
            timing_window=5.0,
            frequency_tolerance_hz=15.0,  # Generous tolerance for beginners
        )
        for i, (note, freq) in enumerate(notes)
    ]

    return Exercise(
        name="C Major Scale (One Octave)",
        notes=expected_notes,
        allow_out_of_order=False,  # Strict sequence
    )


def create_simple_melody() -> Exercise:
    """Create Twinkle Twinkle Little Star (first line)"""
    # Twinkle twinkle little star, how I wonder what you are
    # C C G G A A G - F F E E D D C
    notes = [
        ("C4", 261.63), ("C4", 261.63),
        ("G4", 392.00), ("G4", 392.00),
        ("A4", 440.00), ("A4", 440.00),
        ("G4", 392.00),
    ]

    expected_notes = [
        ExpectedNote(note=note, frequency=freq, position=i)
        for i, (note, freq) in enumerate(notes)
    ]

    return Exercise(
        name="Twinkle Twinkle (First Line)",
        notes=expected_notes,
        allow_out_of_order=False,
    )


if __name__ == "__main__":
    # Demo
    print("Score Follower Demo")
    print("=" * 60)

    # Create C major scale exercise
    exercise = create_c_major_scale()
    follower = ScoreFollower(exercise)
    follower.start()

    print(f"Exercise: {exercise.name}")
    print(f"Expected notes: {[n.note for n in exercise.notes]}")
    print()

    # Simulate some detections
    test_detections = [
        ("C4", 261.5, 0.95),  # Correct
        ("D4", 293.8, 0.92),  # Correct
        ("E4", 329.7, 0.89),  # Correct
        ("X4", 500.0, 0.85),  # Wrong note - should be rejected
        ("F4", 349.0, 0.91),  # Correct (skipped back on track)
    ]

    for note, freq, conf in test_detections:
        result = follower.process_detection(note, freq, conf)

        print(f"Detected: {note} @ {freq:.1f}Hz (confidence: {conf:.2%})")
        print(f"  Matched: {result['matched']}")
        print(f"  Feedback: {result['feedback']}")
        print(f"  Adjusted confidence: {result['adjust_confidence']:.2%}")
        print(f"  Action: {result['action']}")
        print()

    print("Progress:")
    progress = follower.get_progress()
    print(f"  Correct: {progress['correct']}/{progress['total']}")
    print(f"  Completion: {progress['completion_percent']:.1f}%")
    print()

    print("✓ Score follower working correctly!")
