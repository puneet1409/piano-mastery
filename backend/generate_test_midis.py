#!/usr/bin/env python3
"""
Generate MIDI test files for diverse piano practice scenarios.

Creates beginner and advanced versions of classical and Bollywood songs
with varying time signatures, tempos, and complexity.
"""

import os
import mido
from mido import MidiFile, MidiTrack, Message, MetaMessage

OUT_DIR = os.path.join(os.path.dirname(__file__), "test_songs")

NOTE_MAP = {
    "C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3,
    "E": 4, "F": 5, "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8,
    "A": 9, "A#": 10, "Bb": 10, "B": 11,
}


def n(name: str) -> int:
    """Convert note name like 'C4' to MIDI number."""
    if len(name) >= 2 and name[1] in "#b":
        pitch = name[:2]
        octave = int(name[2:])
    else:
        pitch = name[0]
        octave = int(name[1:])
    return (octave + 1) * 12 + NOTE_MAP[pitch]


def make_midi(
    filename: str,
    bpm: int,
    time_sig: tuple,
    ticks_per_beat: int,
    tracks_data: list,
    subdir: str = "",
):
    """Create a MIDI file with the given tracks.

    tracks_data: list of lists of (midi_note, start_tick, duration_ticks, velocity)
    """
    mid = MidiFile(ticks_per_beat=ticks_per_beat)

    # Track 0: tempo + time signature
    meta_track = MidiTrack()
    mid.tracks.append(meta_track)
    meta_track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    meta_track.append(MetaMessage(
        "time_signature",
        numerator=time_sig[0],
        denominator=time_sig[1],
        clocks_per_click=24,
        notated_32nd_notes_per_beat=8,
        time=0,
    ))
    meta_track.append(MetaMessage("end_of_track", time=0))

    for track_notes in tracks_data:
        track = MidiTrack()
        mid.tracks.append(track)

        # Sort events by start tick
        events = []
        for note, start, dur, vel in track_notes:
            events.append((start, "note_on", note, vel))
            events.append((start + dur, "note_off", note, 0))
        events.sort(key=lambda e: (e[0], 0 if e[1] == "note_off" else 1))

        current_tick = 0
        for tick, msg_type, note_val, vel in events:
            delta = tick - current_tick
            track.append(Message(msg_type, note=note_val, velocity=vel, time=delta))
            current_tick = tick

        track.append(MetaMessage("end_of_track", time=0))

    path = os.path.join(OUT_DIR, subdir, filename)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mid.save(path)
    return path


# ═══════════════════════════════════════════════════════════════════
# 1. TWINKLE TWINKLE LITTLE STAR (4/4, 120 BPM)
# ═══════════════════════════════════════════════════════════════════

def generate_twinkle():
    tpb = 480
    q = tpb       # quarter note
    h = tpb * 2   # half note

    # Melody: C C G G A A G | F F E E D D C | ...
    melody_notes = [
        "C4", "C4", "G4", "G4", "A4", "A4", "G4",
        "F4", "F4", "E4", "E4", "D4", "D4", "C4",
        "G4", "G4", "F4", "F4", "E4", "E4", "D4",
        "G4", "G4", "F4", "F4", "E4", "E4", "D4",
        "C4", "C4", "G4", "G4", "A4", "A4", "G4",
        "F4", "F4", "E4", "E4", "D4", "D4", "C4",
    ]
    melody_durs = [
        q, q, q, q, q, q, h,
        q, q, q, q, q, q, h,
        q, q, q, q, q, q, h,
        q, q, q, q, q, q, h,
        q, q, q, q, q, q, h,
        q, q, q, q, q, q, h,
    ]

    # Beginner: RH melody only
    rh = []
    tick = 0
    for note_name, dur in zip(melody_notes, melody_durs):
        rh.append((n(note_name), tick, dur, 80))
        tick += dur

    make_midi("twinkle_beginner.mid", 120, (4, 4), tpb, [rh], "twinkle")

    # Advanced: RH melody + LH chords
    lh_pattern = [
        # Bar 1-2: C major
        ("C3", 0), ("E3", 0), ("G3", 0),
        ("C3", q * 7), ("E3", q * 7), ("G3", q * 7),
        # Bar 3-4: F, C
        ("F3", q * 14), ("A3", q * 14), ("C4", q * 14),
        ("C3", q * 21), ("E3", q * 21), ("G3", q * 21),
        # Bar 5-6: G, C
        ("G2", q * 28), ("B2", q * 28), ("D3", q * 28),
        ("G2", q * 35), ("B2", q * 35), ("D3", q * 35),
    ]
    lh = [(n(name), start, h, 60) for name, start in lh_pattern]

    make_midi("twinkle_advanced.mid", 120, (4, 4), tpb, [rh, lh], "twinkle")
    print("  Twinkle Twinkle: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 2. ODE TO JOY (4/4, 108 BPM)
# ═══════════════════════════════════════════════════════════════════

def generate_ode_to_joy():
    tpb = 480
    q = tpb
    h = tpb * 2

    melody = [
        "E4", "E4", "F4", "G4", "G4", "F4", "E4", "D4",
        "C4", "C4", "D4", "E4", "E4", "D4", "D4",
        "E4", "E4", "F4", "G4", "G4", "F4", "E4", "D4",
        "C4", "C4", "D4", "E4", "D4", "C4", "C4",
    ]
    durs = [
        q, q, q, q, q, q, q, q,
        q, q, q, q, h - q//4, q + q//4, h,
        q, q, q, q, q, q, q, q,
        q, q, q, q, h - q//4, q + q//4, h,
    ]

    rh = []
    tick = 0
    for note_name, dur in zip(melody, durs):
        rh.append((n(note_name), tick, dur, 80))
        tick += dur

    make_midi("ode_to_joy_beginner.mid", 108, (4, 4), tpb, [rh], "ode_to_joy")

    # Advanced: add bass line
    bass = [
        "C3", "C3", "C3", "C3",
        "F2", "F2", "G2", "C3",
        "C3", "C3", "C3", "C3",
        "G2", "G2", "C3", "C3",
    ]
    lh = []
    tick = 0
    for note_name in bass:
        lh.append((n(note_name), tick, h, 60))
        tick += h

    make_midi("ode_to_joy_advanced.mid", 108, (4, 4), tpb, [rh, lh], "ode_to_joy")
    print("  Ode to Joy: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 3. MOONLIGHT SONATA 1st mvt (4/4, 54 BPM, C# minor → simplified C minor)
# ═══════════════════════════════════════════════════════════════════

def generate_moonlight():
    tpb = 480
    # Triplet eighth notes = tpb / 3
    trip = tpb // 3
    q = tpb
    h = tpb * 2
    w = tpb * 4

    # The famous triplet arpeggio pattern (simplified to C minor)
    # Each bar: bass octave (whole note) + triplet pattern in RH
    bars = [
        # Bar 1: Cm - bass C2, arpeggio C3-Eb3-G3 repeated
        {"bass": "C2", "pattern": ["C3", "Eb3", "G3"]},
        # Bar 2: Cm - bass G1
        {"bass": "G1", "pattern": ["C3", "Eb3", "G3"]},
        # Bar 3: Ab - bass Ab1
        {"bass": "Ab1", "pattern": ["C3", "Eb3", "Ab3"]},
        # Bar 4: G - bass G1
        {"bass": "G1", "pattern": ["B2", "D3", "G3"]},
        # Bar 5: Cm
        {"bass": "C2", "pattern": ["C3", "Eb3", "G3"]},
        # Bar 6: Fm
        {"bass": "F1", "pattern": ["C3", "F3", "Ab3"]},
        # Bar 7: G7
        {"bass": "G1", "pattern": ["B2", "D3", "G3"]},
        # Bar 8: Cm
        {"bass": "C2", "pattern": ["C3", "Eb3", "G3"]},
    ]

    # Beginner: just the triplet pattern (RH), no bass
    rh = []
    tick = 0
    for bar in bars:
        for beat in range(4):  # 4 beats per bar
            for note_name in bar["pattern"]:
                rh.append((n(note_name), tick, trip - 10, 50))
                tick += trip

    make_midi("moonlight_beginner.mid", 54, (4, 4), tpb, [rh], "moonlight_sonata")

    # Advanced: RH triplets + LH bass octaves
    lh = []
    tick = 0
    for bar in bars:
        bass_note = n(bar["bass"])
        lh.append((bass_note, tick, w, 40))
        lh.append((bass_note + 12, tick, w, 35))  # octave above
        tick += w

    make_midi("moonlight_advanced.mid", 54, (4, 4), tpb, [rh, lh], "moonlight_sonata")
    print("  Moonlight Sonata: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 4. CANON IN D (4/4, 72 BPM)
# ═══════════════════════════════════════════════════════════════════

def generate_canon():
    tpb = 480
    q = tpb
    h = tpb * 2
    w = tpb * 4

    # Famous bass progression: D-A-B-F#-G-D-G-A (each half note)
    bass_prog = ["D3", "A2", "B2", "F#2", "G2", "D3", "G2", "A2"]

    # Melody over the progression (simplified)
    melody = [
        "F#5", "E5", "D5", "C#5", "B4", "A4", "B4", "C#5",
        "D5", "C#5", "B4", "A4", "G4", "F#4", "G4", "A4",
        "F#4", "D4", "E4", "F#4", "G4", "A4", "F#4", "D4",
        "F#4", "G4", "A4", "B4", "G4", "A4", "B4", "C#5",
    ]

    rh = []
    tick = 0
    for note_name in melody:
        rh.append((n(note_name), tick, q, 75))
        tick += q

    make_midi("canon_beginner.mid", 72, (4, 4), tpb, [rh], "canon_in_d")

    # Advanced: melody + bass
    lh = []
    tick = 0
    for bass_note in bass_prog:
        # Play bass as half notes, repeat progression
        lh.append((n(bass_note), tick, h, 55))
        tick += h
    # Repeat for second half
    for bass_note in bass_prog:
        lh.append((n(bass_note), tick, h, 55))
        tick += h

    make_midi("canon_advanced.mid", 72, (4, 4), tpb, [rh, lh], "canon_in_d")
    print("  Canon in D: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 5. YEH SHAAM MASTANI (4/4, 110 BPM, key of C)
#    Film: Kati Patang (1970), Music: R.D. Burman
# ═══════════════════════════════════════════════════════════════════

def generate_yeh_shaam():
    tpb = 480
    q = tpb
    h = tpb * 2
    e = tpb // 2  # eighth note

    # Approximation of the iconic melody
    # "Yeh shaam mas-ta-ni, mad-hosh ki-ye ja-ye"
    melody_notes = [
        # Phrase 1: Yeh shaam mastani
        "G4", "A4", "G4", "E4", "D4", "C4",
        # madhosh kiye jaaye
        "E4", "G4", "A4", "G4", "E4", "D4",
        # Phrase 2: Madhosha kiye jaaye
        "C4", "D4", "E4", "G4", "A4", "G4",
        # aaja, koi raasta
        "E4", "D4", "C4", "D4", "E4", "G4",
        # Phrase 3: (repeat/variation)
        "G4", "A4", "Bb4", "A4", "G4", "E4",
        "D4", "E4", "G4", "A4", "G4", "E4",
        "D4", "C4", "D4", "E4", "D4", "C4",
    ]
    melody_durs = [
        q, q, q, q, e, h,
        q, q, q, q, e, h,
        q, q, q, q, q, h,
        q, e, e, q, q, h,
        q, q, q, q, q, h,
        q, q, q, q, q, h,
        q, q, q, q, e, h + q,
    ]

    rh = []
    tick = 0
    for note_name, dur in zip(melody_notes, melody_durs):
        rh.append((n(note_name), tick, dur - 20, 75))
        tick += dur

    make_midi("yeh_shaam_beginner.mid", 110, (4, 4), tpb, [rh], "yeh_shaam_mastani")

    # Advanced: melody + LH chord pads
    chords = [
        (["C3", "E3", "G3"], h * 3),   # C major
        (["C3", "E3", "G3"], h * 3),
        (["F3", "A3", "C4"], h * 3),   # F major
        (["G3", "B3", "D4"], h * 3),   # G major
        (["C3", "E3", "G3"], h * 3),
        (["F3", "A3", "C4"], h * 3),
        (["G3", "B3", "D4"], h * 2 + q),
    ]
    lh = []
    tick = 0
    for chord_notes, dur in chords:
        for cn in chord_notes:
            lh.append((n(cn), tick, dur - 20, 50))
        tick += dur

    make_midi("yeh_shaam_advanced.mid", 110, (4, 4), tpb, [rh, lh], "yeh_shaam_mastani")
    print("  Yeh Shaam Mastani: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 6. AJEEB DAASTAAN HAI YEH (3/4 waltz, 88 BPM)
#    Film: Dil Apna Aur Preet Parai (1960), Music: Shankar-Jaikishan
# ═══════════════════════════════════════════════════════════════════

def generate_ajeeb_daastaan():
    tpb = 480
    q = tpb
    h = tpb * 2
    dq = tpb + tpb // 2  # dotted quarter
    e = tpb // 2

    # 3/4 waltz feel — melody approximation
    # "Ajeeb daas-taan hai yeh, kahan shuru kahan khatam"
    melody_notes = [
        # Ajeeb daastaan hai yeh
        "E4", "G4", "A4", "G4", "E4", "D4",
        # kahan shuru kahan khatam
        "C4", "D4", "E4", "G4", "F4", "E4",
        # yeh mera dil, bataye kya
        "D4", "E4", "F4", "E4", "D4", "C4",
        # bujhaye koi aur jalaye koi
        "E4", "F4", "G4", "A4", "G4", "F4",
        "E4", "D4", "C4", "D4", "E4", "C4",
    ]
    melody_durs = [
        q, q, h, q, q, h,
        q, q, h, q, q, h,
        q, q, h, q, q, h,
        q, q, q, h, q, h,
        q, q, h, q, q, h,
    ]

    rh = []
    tick = 0
    for note_name, dur in zip(melody_notes, melody_durs):
        rh.append((n(note_name), tick, dur - 20, 70))
        tick += dur

    make_midi("ajeeb_beginner.mid", 88, (3, 4), tpb, [rh], "ajeeb_daastaan")

    # Advanced: waltz bass pattern (oom-pah-pah)
    waltz_bars = [
        ("C3", "E3", "G3"),   # C major
        ("C3", "E3", "G3"),
        ("F2", "A2", "C3"),   # F major
        ("G2", "B2", "D3"),   # G major
        ("Am", None, None),   # Am
        ("C3", "E3", "G3"),
        ("F2", "A2", "C3"),
        ("G2", "B2", "D3"),
        ("C3", "E3", "G3"),
        ("C3", "E3", "G3"),
    ]
    lh = []
    tick = 0
    bar_len = q * 3  # 3/4 bar
    am_chord = ["A2", "C3", "E3"]
    for bar in waltz_bars:
        if bar[0] == "Am":
            bass = n(am_chord[0])
            chord1 = n(am_chord[1])
            chord2 = n(am_chord[2])
        else:
            bass = n(bar[0])
            chord1 = n(bar[1])
            chord2 = n(bar[2])
        # oom (beat 1)
        lh.append((bass, tick, q - 20, 55))
        # pah-pah (beats 2-3)
        lh.append((chord1, tick + q, q - 20, 40))
        lh.append((chord2, tick + q, q - 20, 40))
        lh.append((chord1, tick + q * 2, q - 20, 40))
        lh.append((chord2, tick + q * 2, q - 20, 40))
        tick += bar_len

    make_midi("ajeeb_advanced.mid", 88, (3, 4), tpb, [rh, lh], "ajeeb_daastaan")
    print("  Ajeeb Daastaan Hai Yeh: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════
# 7. PAL PAL DIL KE PAAS (4/4, 96 BPM)
#    Film: Blackmail (1973), Music: Kalyanji-Anandji
# ═══════════════════════════════════════════════════════════════════

def generate_pal_pal():
    tpb = 480
    q = tpb
    h = tpb * 2
    e = tpb // 2
    dq = q + e  # dotted quarter

    # "Pal pal dil ke paas, tum rehti ho"
    melody_notes = [
        # Pal pal dil ke paas
        "G4", "G4", "A4", "B4", "A4", "G4",
        # tum rehti ho
        "E4", "F#4", "G4", "A4",
        # jeevan mein tum
        "B4", "A4", "G4", "F#4", "E4",
        # bas rehti ho
        "D4", "E4", "F#4", "G4",
        # (repeat with variation)
        "G4", "A4", "B4", "C5", "B4", "A4",
        "G4", "F#4", "E4", "D4", "E4", "G4",
    ]
    melody_durs = [
        q, e, e, q, q, h,
        q, q, q, h + q,
        q, q, q, q, h,
        q, q, q, h + q,
        q, q, q, q, q, h,
        q, q, q, q, q, h + q,
    ]

    rh = []
    tick = 0
    for note_name, dur in zip(melody_notes, melody_durs):
        rh.append((n(note_name), tick, dur - 20, 72))
        tick += dur

    make_midi("pal_pal_beginner.mid", 96, (4, 4), tpb, [rh], "pal_pal_dil_ke_paas")

    # Advanced: melody + arpeggiated LH
    chord_prog = [
        (["G3", "B3", "D4"], h * 2),    # G major
        (["C3", "E3", "G3"], h * 2),     # C major
        (["Em", None, None], h * 2),     # Em (will handle below)
        (["D3", "F#3", "A3"], h * 2),    # D major
        (["G3", "B3", "D4"], h * 2),     # G major
        (["C3", "E3", "G3"], h * 2 + q), # C major (extended)
    ]
    em_chord = ["E3", "G3", "B3"]
    lh = []
    tick = 0
    for chord_notes, dur in chord_prog:
        if chord_notes[0] == "Em":
            notes = em_chord
        else:
            notes = chord_notes
        # Arpeggiate: play each note of chord as quarter notes
        arp_tick = tick
        for cn in notes:
            lh.append((n(cn), arp_tick, q - 20, 50))
            arp_tick += q
        # Hold root for remaining duration
        lh.append((n(notes[0]), arp_tick, dur - q * len(notes), 45))
        tick += dur

    make_midi("pal_pal_advanced.mid", 96, (4, 4), tpb, [rh, lh], "pal_pal_dil_ke_paas")
    print("  Pal Pal Dil Ke Paas: beginner + advanced")


# ═══════════════════════════════════════════════════════════════════

def main():
    print("Generating test MIDI files...")
    generate_twinkle()
    generate_ode_to_joy()
    generate_moonlight()
    generate_canon()
    generate_yeh_shaam()
    generate_ajeeb_daastaan()
    generate_pal_pal()
    print(f"\nAll MIDI files generated in {OUT_DIR}/")


if __name__ == "__main__":
    main()
