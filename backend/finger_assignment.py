#!/usr/bin/env python3
"""
Heuristic finger assignment for piano notes.

Assigns finger numbers (1-5) based on:
- Hand (left/right)
- Note pitch
- Hand position (5-note span)
- Adjacent note transitions
"""

from typing import List, Optional, Dict, Tuple

# MIDI note numbers
NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_to_midi(note_name: str) -> int:
    """Convert note name like 'C4' to MIDI number (C4 = 60)."""
    for i, name in enumerate(NOTE_NAMES):
        if note_name.startswith(name):
            rest = note_name[len(name):]
            if rest.isdigit() or (rest.startswith('-') and rest[1:].isdigit()):
                octave = int(rest)
                return (octave + 1) * 12 + i
    return 60  # Default to middle C


def midi_to_finger_position(midi_note: int, hand: str) -> int:
    """
    Map a MIDI note to a finger (1-5) based on a simple positional heuristic.

    For right hand: lower notes = thumb (1), higher = pinky (5)
    For left hand: higher notes = thumb (1), lower = pinky (5)
    """
    # Normalize to position within a 5-note span (pentatonic-like)
    # This is a simplified model - real fingering depends on context

    # Use white key position for simplicity
    white_keys = [0, 2, 4, 5, 7, 9, 11]  # C, D, E, F, G, A, B semitones
    semitone = midi_note % 12

    # Find closest white key
    closest_white = min(white_keys, key=lambda w: abs(w - semitone))
    white_index = white_keys.index(closest_white)

    # Map to finger 1-5 based on position in octave
    finger_map_right = {0: 1, 1: 2, 2: 3, 3: 1, 4: 2, 5: 3, 6: 4}  # C=1, D=2, E=3, F=1, G=2, A=3, B=4
    finger_map_left = {0: 5, 1: 4, 2: 3, 3: 2, 4: 1, 5: 3, 6: 2}   # Mirror for left hand

    if hand == "left":
        return finger_map_left.get(white_index, 3)
    return finger_map_right.get(white_index, 3)


def assign_fingers_for_sequence(
    notes: List[Dict],
    default_hand: str = "right"
) -> List[Dict]:
    """
    Assign finger numbers to a sequence of note events.

    Each note dict should have:
    - 'note' or 'notes': note name(s) like "C4"
    - 'hand': "left", "right", or None

    Returns the same list with 'finger' or 'fingers' added.
    """
    result = []

    # Track hand position (the MIDI note where thumb would be)
    right_hand_position = 60  # Middle C
    left_hand_position = 48   # C3

    for item in notes:
        item_copy = dict(item)
        hand = item.get('hand') or default_hand

        # Handle single note or chord
        note_list = item.get('notes', [item.get('note')]) if 'notes' in item else [item.get('note')]
        note_list = [n for n in note_list if n]  # Filter None

        if not note_list:
            result.append(item_copy)
            continue

        # Convert to MIDI
        midi_notes = [note_to_midi(n) for n in note_list]

        # Sort by pitch
        sorted_pairs = sorted(zip(midi_notes, note_list))

        fingers = []
        for midi_note, note_name in sorted_pairs:
            finger = midi_to_finger_position(midi_note, hand)
            fingers.append(finger)

        # For chords, ensure fingers don't repeat (simple deduplication)
        if len(fingers) > 1:
            used = set()
            for i, f in enumerate(fingers):
                while f in used and f < 5:
                    f += 1
                while f in used and f > 1:
                    f -= 1
                fingers[i] = f
                used.add(f)

        if len(note_list) == 1:
            item_copy['finger'] = fingers[0]
        else:
            # Reorder fingers to match original note order
            finger_map = {n: f for (_, n), f in zip(sorted_pairs, fingers)}
            item_copy['fingers'] = [finger_map.get(n, 3) for n in note_list]

        result.append(item_copy)

    return result


def assign_fingers_to_groups(groups: List, hands: str = "both") -> List:
    """
    Assign finger numbers to ExpectedGroup objects.

    Modifies groups in-place, adding 'fingers' list to each group.
    """
    # Build a list of note dicts for the algorithm
    note_dicts = []
    for g in groups:
        note_dicts.append({
            'notes': g.notes,
            'hand': g.hand,
        })

    # Run finger assignment
    assigned = assign_fingers_for_sequence(note_dicts, default_hand="right" if hands != "left" else "left")

    # Copy fingers back to groups
    for g, a in zip(groups, assigned):
        if 'fingers' in a:
            g.fingers = a['fingers']
        elif 'finger' in a:
            g.fingers = [a['finger']]
        else:
            g.fingers = [3] * len(g.notes)  # Default to middle finger

    return groups
