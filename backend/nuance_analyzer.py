"""
Nuance analyzer that post-processes ML note events for musical feedback.

Analyzes dynamics, timing accuracy, and articulation from detected piano notes
to produce an ExpressionReport with per-note detail and aggregate metrics.
"""

from dataclasses import dataclass, field
from typing import List

from onsets_frames_tflite import NoteEvent


@dataclass
class NoteDynamic:
    """Per-note dynamic marking derived from velocity."""
    note: str
    pitch: int
    velocity: float
    dynamic: str  # pp/p/mf/f/ff


@dataclass
class NoteTiming:
    """Per-note timing deviation from the expected beat grid."""
    note: str
    pitch: int
    onset_time: float
    expected_time: float
    deviation_ms: float
    rating: str  # early/on_time/late


@dataclass
class NoteArticulation:
    """Per-note articulation derived from gap between consecutive notes."""
    note: str
    pitch: int
    duration_ms: float
    gap_after_ms: float
    articulation: str  # staccato/normal/legato


@dataclass
class ExpressionReport:
    """Aggregate expression analysis of a note sequence."""
    dynamics: List[NoteDynamic]
    timing: List[NoteTiming]
    articulation: List[NoteArticulation]
    overall_evenness: float  # 0-1, how even the dynamics are
    dynamic_range: str  # "narrow", "moderate", "wide"
    timing_accuracy: float  # 0-1, overall timing accuracy
    summary: str  # human-readable one-line summary


def velocity_to_dynamic(velocity: float) -> str:
    """Map a 0-1 velocity to a dynamic marking (pp/p/mf/f/ff).

    Public API for use outside NuanceAnalyzer (e.g., in the WebSocket server).
    """
    if velocity < 0.25:
        return "pp"
    if velocity < 0.45:
        return "p"
    if velocity < 0.65:
        return "mf"
    if velocity < 0.85:
        return "f"
    return "ff"


class NuanceAnalyzer:
    """Post-processes ML note events to produce musical expression feedback."""

    def __init__(self, bpm: float = 120.0, beats_per_measure: int = 4):
        self.bpm = bpm
        self.beats_per_measure = beats_per_measure
        self._beat_duration = 60.0 / bpm

    def set_tempo(self, bpm: float) -> None:
        """Update the tempo used for timing analysis."""
        self.bpm = bpm
        self._beat_duration = 60.0 / bpm

    def analyze(self, notes: List[NoteEvent]) -> ExpressionReport:
        """Post-process a list of NoteEvent objects and return an ExpressionReport."""
        dynamics = self._analyze_dynamics(notes)
        timing = self._analyze_timing(notes)
        articulation = self._analyze_articulation(notes)

        overall_evenness = self._compute_evenness(dynamics)
        dynamic_range = self._compute_dynamic_range(dynamics)
        timing_accuracy = self._compute_timing_accuracy(timing)
        summary = self._build_summary(
            overall_evenness, dynamic_range, timing_accuracy, len(notes)
        )

        return ExpressionReport(
            dynamics=dynamics,
            timing=timing,
            articulation=articulation,
            overall_evenness=overall_evenness,
            dynamic_range=dynamic_range,
            timing_accuracy=timing_accuracy,
            summary=summary,
        )

    # ── Dynamics ────────────────────────────────────────────────────────

    @staticmethod
    def _velocity_to_dynamic(velocity: float) -> str:
        """Map a 0-1 velocity to a dynamic marking.

        Delegates to the public module-level ``velocity_to_dynamic`` function.
        """
        return velocity_to_dynamic(velocity)

    def _analyze_dynamics(self, notes: List[NoteEvent]) -> List[NoteDynamic]:
        return [
            NoteDynamic(
                note=n.note,
                pitch=n.pitch,
                velocity=n.velocity,
                dynamic=self._velocity_to_dynamic(n.velocity),
            )
            for n in notes
        ]

    @staticmethod
    def _compute_evenness(dynamics: List[NoteDynamic]) -> float:
        """Return 0-1 score indicating how even the velocities are.

        Uses 1 - normalised standard deviation so that perfectly uniform
        velocity yields 1.0 and maximum spread yields close to 0.0.
        """
        if len(dynamics) < 2:
            return 1.0
        velocities = [d.velocity for d in dynamics]
        mean_v = sum(velocities) / len(velocities)
        variance = sum((v - mean_v) ** 2 for v in velocities) / len(velocities)
        std_dev = variance ** 0.5
        # Normalise: max possible std_dev for 0-1 range is 0.5
        evenness = 1.0 - min(std_dev / 0.5, 1.0)
        return round(evenness, 3)

    @staticmethod
    def _compute_dynamic_range(dynamics: List[NoteDynamic]) -> str:
        """Classify the spread of velocities as narrow/moderate/wide."""
        if not dynamics:
            return "narrow"
        velocities = [d.velocity for d in dynamics]
        spread = max(velocities) - min(velocities)
        if spread < 0.25:
            return "narrow"
        if spread < 0.55:
            return "moderate"
        return "wide"

    # ── Timing ──────────────────────────────────────────────────────────

    def _snap_to_beat(self, onset: float) -> float:
        """Return the nearest beat-grid time for a given onset."""
        beat_index = round(onset / self._beat_duration)
        return beat_index * self._beat_duration

    def _analyze_timing(self, notes: List[NoteEvent]) -> List[NoteTiming]:
        result: List[NoteTiming] = []
        for n in notes:
            expected = self._snap_to_beat(n.onset_time)
            deviation_s = n.onset_time - expected
            deviation_ms = deviation_s * 1000.0

            if abs(deviation_ms) < 30.0:
                rating = "on_time"
            elif deviation_ms < 0:
                rating = "early"
            else:
                rating = "late"

            result.append(
                NoteTiming(
                    note=n.note,
                    pitch=n.pitch,
                    onset_time=n.onset_time,
                    expected_time=round(expected, 6),
                    deviation_ms=round(deviation_ms, 2),
                    rating=rating,
                )
            )
        return result

    @staticmethod
    def _compute_timing_accuracy(timing: List[NoteTiming]) -> float:
        """Return 0-1 score: fraction of notes rated on_time."""
        if not timing:
            return 1.0
        on_time_count = sum(1 for t in timing if t.rating == "on_time")
        return round(on_time_count / len(timing), 3)

    # ── Articulation ────────────────────────────────────────────────────

    @staticmethod
    def _analyze_articulation(notes: List[NoteEvent]) -> List[NoteArticulation]:
        result: List[NoteArticulation] = []
        for i, n in enumerate(notes):
            duration_ms = (n.offset_time - n.onset_time) * 1000.0

            if i < len(notes) - 1:
                gap_s = notes[i + 1].onset_time - n.offset_time
                gap_after_ms = gap_s * 1000.0
            else:
                gap_after_ms = 0.0

            if gap_after_ms > 100.0:
                articulation = "staccato"
            elif gap_after_ms < 50.0:
                articulation = "legato"
            else:
                articulation = "normal"

            result.append(
                NoteArticulation(
                    note=n.note,
                    pitch=n.pitch,
                    duration_ms=round(duration_ms, 2),
                    gap_after_ms=round(gap_after_ms, 2),
                    articulation=articulation,
                )
            )
        return result

    # ── Summary ─────────────────────────────────────────────────────────

    @staticmethod
    def _build_summary(
        evenness: float,
        dynamic_range: str,
        timing_accuracy: float,
        note_count: int,
    ) -> str:
        """Build a human-readable one-line summary of the expression analysis."""
        if note_count == 0:
            return "No notes detected."

        parts: List[str] = []

        # Timing feedback
        if timing_accuracy >= 0.9:
            parts.append("excellent timing")
        elif timing_accuracy >= 0.7:
            parts.append("good timing")
        elif timing_accuracy >= 0.5:
            parts.append("uneven timing")
        else:
            parts.append("poor timing")

        # Dynamics feedback
        if evenness >= 0.9:
            parts.append("very even dynamics")
        elif evenness >= 0.7:
            parts.append("mostly even dynamics")
        else:
            parts.append("uneven dynamics")

        # Range feedback
        parts.append(f"{dynamic_range} dynamic range")

        return (
            f"{note_count} notes analyzed: "
            + ", ".join(parts)
            + "."
        )
