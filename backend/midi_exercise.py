#!/usr/bin/env python3
"""
Utilities for loading MIDI files into beat-aware exercises.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import os

try:
    import mido
except Exception:  # pragma: no cover - optional dependency
    mido = None

MIDO_AVAILABLE = mido is not None

from beat_score_follower import BeatExercise, ExpectedGroup

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_to_note_name(midi_note: int) -> str:
    octave = (midi_note // 12) - 1
    name = NOTE_NAMES[midi_note % 12]
    return f"{name}{octave}"


def midi_to_frequency(midi_note: int) -> float:
    return 440.0 * (2.0 ** ((midi_note - 69) / 12.0))


@dataclass
class MidiNoteEvent:
    note_name: str
    midi_note: int
    start_tick: int
    start_time_sec: float
    track_index: int = 0  # 0 = right hand, 1 = left hand (standard MIDI piano convention)


def _detect_time_signature(messages) -> Tuple[int, int]:
    """Return the primary time signature from a MIDI message stream.

    Collects ALL time_signature events and returns the last one found.
    This handles pickup bars (e.g. 3/8 before 6/8 in "Perfect") by
    preferring the main body signature.
    """
    signatures: List[Tuple[int, int]] = []
    for msg in messages:
        if msg.type == "time_signature":
            signatures.append((msg.numerator, msg.denominator))
    if not signatures:
        return (4, 4)
    return signatures[-1]


def _detect_tempo(messages) -> Optional[int]:
    for msg in messages:
        if msg.type == "set_tempo":
            return msg.tempo
    return None


def _beat_unit_for_signature(signature: Tuple[int, int]) -> float:
    numerator, denominator = signature
    if denominator == 8 and numerator % 3 == 0 and numerator >= 6:
        # Compound meter: dotted quarter as beat
        return 1.5
    return 1.0


def _timing_windows(bpm: float, beat_unit: float) -> Tuple[float, float]:
    beat_duration = (60.0 / bpm) * beat_unit
    tolerance = max(0.12, min(0.45, beat_duration * 0.35))
    max_window = max(0.2, min(0.8, beat_duration * 0.7))
    return tolerance, max_window


def _beats_per_bar(time_signature: Tuple[int, int], beat_unit: float) -> float:
    numerator, denominator = time_signature
    if denominator == 8 and numerator % 3 == 0 and numerator >= 6:
        return numerator / 3
    return float(numerator)


def _hand_for_track(track_index: int) -> str:
    """Map track index to hand label using standard MIDI piano convention."""
    return "right" if track_index == 0 else "left"


def _hand_for_group(events: List[MidiNoteEvent]) -> Optional[str]:
    """Determine hand for a group of simultaneous events.

    Returns "right" or "left" if all notes are from the same track,
    or None if notes span both tracks.
    """
    tracks = set(e.track_index for e in events)
    if len(tracks) == 1:
        return _hand_for_track(tracks.pop())
    return None


def _parse_tracks_with_hands(
    midi_file,
    ticks_per_beat: int,
    initial_tempo: int,
) -> List[MidiNoteEvent]:
    """Parse MIDI tracks individually, tagging each note with its source track.

    Tracks containing note events are numbered sequentially (0, 1, ...).
    Track 0 → right hand, Track 1 → left hand.
    """
    note_events: List[MidiNoteEvent] = []
    note_track_idx = 0  # index among tracks that contain notes

    for track in midi_file.tracks:
        absolute_ticks = 0
        absolute_seconds = 0.0
        current_tempo = initial_tempo
        track_has_notes = False

        for msg in track:
            absolute_ticks += msg.time
            if msg.time:
                absolute_seconds += mido.tick2second(msg.time, ticks_per_beat, current_tempo)
            if msg.type == "set_tempo":
                current_tempo = msg.tempo
                continue
            if msg.type == "note_on" and msg.velocity > 0:
                track_has_notes = True
                note_events.append(
                    MidiNoteEvent(
                        note_name=midi_to_note_name(msg.note),
                        midi_note=msg.note,
                        start_tick=absolute_ticks,
                        start_time_sec=absolute_seconds,
                        track_index=note_track_idx,
                    )
                )

        if track_has_notes:
            note_track_idx += 1

    return note_events


def load_midi_exercise(
    midi_path: str,
    name: str,
    bpm_override: Optional[float] = None,
    hands: str = "both",
) -> BeatExercise:
    """Load a MIDI file into a BeatExercise with hand tagging.

    Args:
        hands: "both" (default), "right", or "left" to filter groups.
    """
    if mido is None:
        raise RuntimeError("mido is not installed - cannot parse MIDI")
    if not os.path.exists(midi_path):
        raise FileNotFoundError(midi_path)

    midi = mido.MidiFile(midi_path)
    merged = mido.merge_tracks(midi.tracks)
    ticks_per_beat = midi.ticks_per_beat

    time_signature = _detect_time_signature(merged)
    tempo = _detect_tempo(merged) or mido.bpm2tempo(120)
    bpm = bpm_override or mido.tempo2bpm(tempo)
    beat_unit = _beat_unit_for_signature(time_signature)
    beats_per_bar = _beats_per_bar(time_signature, beat_unit)
    timing_tolerance_sec, timing_max_sec = _timing_windows(bpm, beat_unit)

    # Parse tracks individually to tag each note with its source hand
    note_events = _parse_tracks_with_hands(midi, ticks_per_beat, tempo)

    if not note_events:
        raise ValueError("No note events found in MIDI")

    # Compute timing reference from ALL notes (both hands) to preserve
    # bar boundaries and timing alignment regardless of hand filter.
    all_grouped: Dict[int, List[MidiNoteEvent]] = {}
    for event in note_events:
        all_grouped.setdefault(event.start_tick, []).append(event)

    all_sorted_ticks = sorted(all_grouped.keys())
    base_tick = all_sorted_ticks[0]
    base_time = all_grouped[base_tick][0].start_time_sec

    # Filter by hand AFTER establishing the timing reference
    if hands == "right":
        note_events = [e for e in note_events if e.track_index == 0]
    elif hands == "left":
        note_events = [e for e in note_events if e.track_index == 1]

    if not note_events:
        raise ValueError(f"No note events for hands={hands!r}")

    # Group filtered notes by tick
    grouped: Dict[int, List[MidiNoteEvent]] = {}
    for event in note_events:
        grouped.setdefault(event.start_tick, []).append(event)

    sorted_ticks = sorted(grouped.keys())

    groups: List[ExpectedGroup] = []
    for idx, tick in enumerate(sorted_ticks):
        events = grouped[tick]
        notes = [e.note_name for e in events]
        freqs = [midi_to_frequency(e.midi_note) for e in events]
        # Use base_tick from full event list so timing is preserved
        beat_position = (tick - base_tick) / (ticks_per_beat * beat_unit)
        bar_index = int(beat_position // beats_per_bar) if beats_per_bar > 0 else 0
        expected_time_sec = grouped[tick][0].start_time_sec - base_time
        groups.append(
            ExpectedGroup(
                notes=notes,
                frequencies=freqs,
                position=idx,
                beat_position=beat_position,
                expected_time_sec=expected_time_sec,
                bar_index=bar_index,
                timing_tolerance_sec=timing_tolerance_sec,
                timing_max_sec=timing_max_sec,
                hand=_hand_for_group(events),
            )
        )

    return BeatExercise(
        name=name,
        groups=groups,
        bpm=float(bpm),
        time_signature=time_signature,
        beat_unit=beat_unit,
        beats_per_bar=beats_per_bar,
    )
