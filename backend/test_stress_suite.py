#!/usr/bin/env python3
"""
Comprehensive stress test suite for the piano detection pipeline.

Tests the full chain: audio generation -> ML inference -> onset detection ->
nuance analysis, across 10 scenarios covering single notes, scales, chords,
dynamics, fast passages, and real audio files.
"""

import os
import sys
import time
import traceback
from typing import Dict, List, Optional, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Imports from the piano detection pipeline
# ---------------------------------------------------------------------------
from onsets_frames_tflite import OnsetsFramesTFLite, NoteEvent
from onset_detector import OnsetDetector
from audio_buffer_manager import AudioBufferManager
from nuance_analyzer import NuanceAnalyzer


# ===================================================================
# Helper functions
# ===================================================================

def midi_to_freq(midi: int) -> float:
    """Convert a MIDI note number to frequency in Hz."""
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def note_name_to_midi(name: str) -> int:
    """
    Convert a note name like 'C4', 'F#5', 'Bb3' to a MIDI note number.

    Uses the convention where C4 = MIDI 60.
    """
    note_map = {
        'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
    }
    accidental = 0
    idx = 1
    if len(name) > 1 and name[1] == '#':
        accidental = 1
        idx = 2
    elif len(name) > 1 and name[1] == 'b':
        accidental = -1
        idx = 2

    base = note_map[name[0].upper()]
    octave = int(name[idx:])
    return (octave + 1) * 12 + base + accidental


def generate_piano_tone(
    frequency: float,
    duration_s: float,
    sample_rate: int = 44100,
    velocity: float = 0.8,
) -> np.ndarray:
    """
    Generate a realistic piano timbre with inharmonicity, per-partial decay,
    and a hammer noise burst.

    Uses piano string inharmonicity (partials are slightly sharp of exact
    harmonics) and per-harmonic exponential decay to better match the spectral
    profile that the ML model was trained on (MAESTRO dataset).

    Parameters
    ----------
    frequency : float
        Fundamental frequency in Hz.
    duration_s : float
        Duration in seconds.
    sample_rate : int
        Audio sample rate.
    velocity : float
        Overall amplitude (0.0 - 1.0).

    Returns
    -------
    np.ndarray
        Audio samples as float32 in roughly [-1, 1].
    """
    num_samples = int(duration_s * sample_rate)
    t = np.linspace(0, duration_s, num_samples, endpoint=False).astype(np.float64)

    # Piano string inharmonicity coefficient (typical range 0.0001-0.001)
    B = 0.0005

    signal = np.zeros(num_samples, dtype=np.float64)
    for harmonic in range(1, 7):
        # Real piano partials are slightly sharp: f_h = h * f0 * sqrt(1 + B*h^2)
        freq_h = harmonic * frequency * np.sqrt(1 + B * harmonic ** 2)
        if freq_h >= sample_rate / 2.0:
            break
        amplitude = velocity * (0.6 ** (harmonic - 1))
        # Per-harmonic exponential decay (higher harmonics decay faster)
        decay = np.exp(-t * (1.0 + harmonic * 0.8))
        signal += amplitude * np.sin(2.0 * np.pi * freq_h * t) * decay

    # Hammer noise burst (~5ms attack transient)
    noise_samples = min(int(0.005 * sample_rate), num_samples)
    noise = np.random.default_rng(42).standard_normal(noise_samples) * 0.15 * velocity
    signal[:noise_samples] += noise

    # Short attack ramp (5ms)
    attack_samples = min(int(0.005 * sample_rate), num_samples)
    if attack_samples > 0:
        signal[:attack_samples] *= np.linspace(0, 1, attack_samples)

    # Normalize to [-1, 1]
    peak = np.abs(signal).max()
    if peak > 0:
        signal /= peak

    return signal.astype(np.float32)


def generate_chord(
    notes_midi: List[int],
    duration_s: float,
    sample_rate: int = 44100,
) -> np.ndarray:
    """
    Generate a chord by summing individual piano tones.

    Parameters
    ----------
    notes_midi : list of int
        MIDI note numbers to sound simultaneously.
    duration_s : float
        Duration in seconds.
    sample_rate : int
        Audio sample rate.

    Returns
    -------
    np.ndarray
        Mixed audio as float32.
    """
    num_samples = int(duration_s * sample_rate)
    mixed = np.zeros(num_samples, dtype=np.float32)
    for midi_note in notes_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, duration_s, sample_rate)
        # Ensure same length (rounding can differ by 1 sample)
        length = min(len(tone), num_samples)
        mixed[:length] += tone[:length]

    # Normalise to avoid clipping
    peak = np.abs(mixed).max()
    if peak > 1.0:
        mixed /= peak
    return mixed


def evaluate_detection(
    detected_notes: List[NoteEvent],
    expected_midi_list: List[int],
    tolerance_semitones: int = 1,
) -> Dict:
    """
    Evaluate detected notes against expected MIDI pitches.

    A detected note 'matches' an expected note if its MIDI pitch is
    within *tolerance_semitones* of any unmatched expected note.

    Returns
    -------
    dict
        Keys: precision, recall, f1, matched, missed, extra
    """
    detected_pitches = [n.pitch for n in detected_notes]

    # Greedy matching: each expected note can match at most one detected note
    expected_remaining = list(expected_midi_list)
    matched_count = 0
    unmatched_detected = []

    for dp in detected_pitches:
        found = False
        for i, ep in enumerate(expected_remaining):
            if abs(dp - ep) <= tolerance_semitones:
                matched_count += 1
                expected_remaining.pop(i)
                found = True
                break
        if not found:
            unmatched_detected.append(dp)

    missed = expected_remaining
    extra = unmatched_detected

    precision = matched_count / len(detected_pitches) if detected_pitches else 0.0
    recall = matched_count / len(expected_midi_list) if expected_midi_list else 0.0

    if precision + recall > 0:
        f1 = 2.0 * precision * recall / (precision + recall)
    else:
        f1 = 0.0

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "matched": matched_count,
        "missed": missed,
        "extra": extra,
    }


# ===================================================================
# ML model loader (shared across tests)
# ===================================================================

_model: Optional[OnsetsFramesTFLite] = None
_model_load_error: Optional[str] = None


def _get_model() -> Optional[OnsetsFramesTFLite]:
    """Lazy-load the ML model once for the entire suite."""
    global _model, _model_load_error
    if _model is not None:
        return _model
    if _model_load_error is not None:
        return None

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(backend_dir, "onsets_frames_wavinput.tflite")

    if not os.path.exists(model_path):
        _model_load_error = f"Model file not found: {model_path}"
        return None

    try:
        _model = OnsetsFramesTFLite(model_path)
        return _model
    except Exception as exc:
        _model_load_error = f"Failed to load model: {exc}"
        return None


def _require_model() -> Tuple[Optional[OnsetsFramesTFLite], Optional[str]]:
    """Return (model, None) or (None, skip_reason)."""
    model = _get_model()
    if model is None:
        return None, _model_load_error or "ML model unavailable"
    return model, None


# ===================================================================
# Test cases (10 scenarios)
# ===================================================================

def test_single_notes_chromatic() -> Tuple[bool, str]:
    """
    1. Single notes chromatic: every octave A0-A7 plus C8.
    Generate each note for 1.12s, run ML, expect 100% match within 1 semitone.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    # A0=21, A1=33, A2=45, A3=57, A4=69, A5=81, A6=93, A7=105, C8=108
    test_notes = list(range(21, 108, 12)) + [108]
    matched_count = 0
    details_parts = []

    for midi_note in test_notes:
        freq = midi_to_freq(midi_note)
        audio = generate_piano_tone(freq, 1.12, sample_rate=44100, velocity=0.8)
        notes = model.transcribe(audio, sample_rate=44100)

        detected_pitches = [n.pitch for n in notes]
        hit = any(abs(dp - midi_note) <= 1 for dp in detected_pitches)
        if hit:
            matched_count += 1
        else:
            details_parts.append(
                f"MIDI {midi_note} missed (detected: {detected_pitches})"
            )

    total = len(test_notes)
    passed = matched_count == total
    detail = f"{matched_count}/{total} matched"
    if details_parts:
        detail += " | " + "; ".join(details_parts[:3])
    return passed, detail


def test_c_major_scale() -> Tuple[bool, str]:
    """
    2. C major scale C4-C5.
    Notes: C4 D4 E4 F4 G4 A4 B4 C5 (MIDI 60,62,64,65,67,69,71,72).
    Each note 0.5s with 0.1s silence gap. Concatenate, run ML. Pass: F1 > 0.95.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    scale_midi = [60, 62, 64, 65, 67, 69, 71, 72]
    sr = 44100
    note_dur = 0.5
    gap_dur = 0.1

    segments = []
    for midi_note in scale_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)

    # Transcribe in windows (model takes 1.12s chunks)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, scale_midi)
    passed = result["f1"] > 0.95
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_chromatic_scale() -> Tuple[bool, str]:
    """
    3. Chromatic scale C4-C5 (MIDI 60-72), each 0.4s, 0.05s gap.
    Pass: F1 > 0.90.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    chromatic_midi = list(range(60, 73))
    sr = 44100
    note_dur = 0.4
    gap_dur = 0.05

    segments = []
    for midi_note in chromatic_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, chromatic_midi)
    passed = result["f1"] > 0.90
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    return passed, detail


def test_arpeggios() -> Tuple[bool, str]:
    """
    4. C major arpeggio: C4 E4 G4 C5 (MIDI 60,64,67,72).
    Each 0.3s, 0.05s gap. Pass: F1 > 0.85.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    arpeggio_midi = [60, 64, 67, 72]
    sr = 44100
    note_dur = 0.3
    gap_dur = 0.05

    segments = []
    for midi_note in arpeggio_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, arpeggio_midi)
    passed = result["f1"] > 0.85
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    return passed, detail


def test_block_chords() -> Tuple[bool, str]:
    """
    5. C major chord (MIDI 60,64,67) simultaneously for 1.12s.
    Pass: at least 2 of 3 notes detected (>= 66%).
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    chord_midi = [60, 64, 67]
    sr = 44100
    audio = generate_chord(chord_midi, 1.12, sr)

    notes = model.transcribe(audio, sample_rate=sr)
    detected_pitches = list(set(n.pitch for n in notes))

    hits = sum(
        1
        for expected in chord_midi
        if any(abs(dp - expected) <= 1 for dp in detected_pitches)
    )
    passed = hits >= 2
    detail = f"{hits}/{len(chord_midi)} chord notes detected (pitches: {detected_pitches})"
    return passed, detail


def test_two_hand() -> Tuple[bool, str]:
    """
    6. Two-hand texture: melody C5 (72) + chord C4+E4+G4 (60,64,67)
    simultaneously for 1.12s. Pass: F1 > 0.75 on all 4 notes.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    all_midi = [60, 64, 67, 72]
    sr = 44100
    audio = generate_chord(all_midi, 1.12, sr)

    notes = model.transcribe(audio, sample_rate=sr)
    result = evaluate_detection(notes, all_midi)
    passed = result["f1"] > 0.75
    detail = f"F1={result['f1']:.2f} ({result['matched']}/{len(all_midi)} matched)"
    return passed, detail


def test_staccato_legato() -> Tuple[bool, str]:
    """
    7. Onset detector test: 3 staccato notes (0.1s each, 0.2s gap) and
    3 legato notes (0.5s each, 0s gap). Pass: detect >= 4 of 6 onsets.
    """
    sr = 44100
    detector = OnsetDetector(sample_rate=sr, fft_size=2048, energy_threshold=0.005)
    chunk_size = 2048

    # Build audio: 3 staccato then 3 legato
    segments = []
    staccato_notes = [60, 64, 67]
    legato_notes = [72, 71, 69]

    for midi_note in staccato_notes:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, 0.1, sr, velocity=0.8)
        gap = np.zeros(int(0.2 * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    for midi_note in legato_notes:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, 0.5, sr, velocity=0.8)
        segments.append(tone)

    audio = np.concatenate(segments)

    # Process in chunks
    onset_count = 0
    for start in range(0, len(audio), chunk_size):
        chunk = audio[start : start + chunk_size]
        if len(chunk) < chunk_size:
            chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
        event = detector.process_chunk(chunk)
        if event is not None:
            onset_count += 1

    passed = onset_count >= 4
    detail = f"{onset_count}/6 onsets detected"
    return passed, detail


def test_dynamics() -> Tuple[bool, str]:
    """
    8. Dynamics test: same note (C4) at velocities 0.2, 0.5, 0.8.
    Run ML and nuance analyzer. Pass: velocity ordering preserved
    (soft < medium < loud) or Spearman correlation > 0.5.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    velocities_in = [0.2, 0.5, 0.8]
    detected_velocities = []

    for vel in velocities_in:
        freq = midi_to_freq(60)  # C4
        audio = generate_piano_tone(freq, 1.12, sr, velocity=vel)
        notes = model.transcribe(audio, sample_rate=sr)
        if notes:
            # Average velocity of detected notes
            avg_vel = sum(n.velocity for n in notes) / len(notes)
            detected_velocities.append(avg_vel)
        else:
            detected_velocities.append(0.0)

    # Check ordering
    ordering_preserved = (
        detected_velocities[0] < detected_velocities[1] < detected_velocities[2]
    )

    # Spearman-like rank correlation (simple version for 3 values)
    def _rank_corr(a: List[float], b: List[float]) -> float:
        """Compute Spearman rank correlation for two equal-length sequences."""
        n = len(a)
        if n < 2:
            return 0.0
        rank_a = _ranks(a)
        rank_b = _ranks(b)
        d_sq = sum((ra - rb) ** 2 for ra, rb in zip(rank_a, rank_b))
        return 1.0 - (6.0 * d_sq) / (n * (n * n - 1))

    def _ranks(values: List[float]) -> List[float]:
        indexed = sorted(enumerate(values), key=lambda x: x[1])
        ranks = [0.0] * len(values)
        for rank, (orig_idx, _) in enumerate(indexed):
            ranks[orig_idx] = float(rank)
        return ranks

    corr = _rank_corr(velocities_in, detected_velocities)

    # Also run nuance analyzer on the loudest sample
    analyzer = NuanceAnalyzer(bpm=120.0)
    loud_audio = generate_piano_tone(midi_to_freq(60), 1.12, sr, velocity=0.8)
    loud_notes = model.transcribe(loud_audio, sample_rate=sr)
    if loud_notes:
        report = analyzer.analyze(loud_notes)
        nuance_detail = f", nuance: {report.summary}"
    else:
        nuance_detail = ""

    passed = ordering_preserved or corr > 0.5
    detail = (
        f"velocities={[round(v, 3) for v in detected_velocities]}, "
        f"order={'yes' if ordering_preserved else 'no'}, "
        f"corr={corr:.2f}{nuance_detail}"
    )
    return passed, detail


def test_fast_passages() -> Tuple[bool, str]:
    """
    9. Fast passages: 16th notes at 120 BPM (~125ms each).
    Notes: C4 D4 E4 F4 (MIDI 60,62,64,65). Pass: F1 > 0.70.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    bpm = 120
    sixteenth_dur = 60.0 / bpm / 4.0  # ~0.125s
    fast_midi = [60, 62, 64, 65]

    segments = []
    for midi_note in fast_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, sixteenth_dur, sr, velocity=0.7)
        segments.append(tone)

    audio = np.concatenate(segments)

    # Pad to at least 1.12s for the model
    model_samples = int(1.12 * sr)
    if len(audio) < model_samples:
        audio = np.pad(audio, (0, model_samples - len(audio)))

    notes = model.transcribe(audio, sample_rate=sr)
    result = evaluate_detection(notes, fast_midi)

    passed = result["f1"] > 0.70
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    return passed, detail


def test_existing_wav() -> Tuple[bool, str]:
    """
    10. Test on existing WAV files if available.
    Tries youtube_piano.wav or test_c_major_scale.wav. Pass: at least 1 note
    detected; F1 > 0.80 if expected notes are known, otherwise count > 0.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    backend_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        ("youtube_piano.wav", None),  # unknown expected notes
        ("test_c_major_scale.wav", [60, 62, 64, 65, 67, 69, 71, 72]),
    ]

    for filename, expected_midi in candidates:
        filepath = os.path.join(backend_dir, filename)
        if not os.path.exists(filepath):
            continue

        try:
            from scipy.io import wavfile

            sr_file, data = wavfile.read(filepath)

            # Convert to float32 mono
            if data.dtype == np.int16:
                audio = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                audio = data.astype(np.float32) / 2147483648.0
            elif data.dtype == np.float32 or data.dtype == np.float64:
                audio = data.astype(np.float32)
            else:
                audio = data.astype(np.float32)

            # Mix to mono if stereo
            if audio.ndim == 2:
                audio = audio.mean(axis=1)

            all_notes = _transcribe_long_audio(model, audio, sr_file)

            if expected_midi is not None:
                result = evaluate_detection(all_notes, expected_midi)
                passed = result["f1"] > 0.80 and len(all_notes) > 0
                detail = (
                    f"{filename}: {len(all_notes)} notes, "
                    f"F1={result['f1']:.2f}"
                )
            else:
                passed = len(all_notes) > 0
                detail = f"{filename}: {len(all_notes)} notes detected"

            return passed, detail

        except Exception as exc:
            return False, f"{filename}: error - {exc}"

    return False, "SKIP: no WAV files found (youtube_piano.wav, test_c_major_scale.wav)"


# ===================================================================
# Utility: transcribe long audio in overlapping windows
# ===================================================================

def _transcribe_long_audio(
    model: OnsetsFramesTFLite,
    audio: np.ndarray,
    sample_rate: int,
    expected_pitches: Optional[set] = None,
) -> List[NoteEvent]:
    """
    Transcribe audio longer than 1.12s by using the AudioBufferManager
    to produce overlapping windows with consensus merge.

    Args:
        expected_pitches: Optional set of MIDI pitches for score-aware detection.
    """
    buf_mgr = AudioBufferManager(sample_rate=sample_rate)
    all_notes: List[NoteEvent] = []

    # Feed audio in reasonable chunks (~0.25s)
    chunk_size = int(0.25 * sample_rate)

    for start in range(0, len(audio), chunk_size):
        chunk = audio[start : start + chunk_size]
        window = buf_mgr.add_chunk(chunk)

        if window is not None:
            notes = model.transcribe(
                window, sample_rate=sample_rate,
                expected_pitches=expected_pitches,
            )
            window_offset = buf_mgr.last_window_start_s
            confirmed = buf_mgr.consensus_notes(notes, window_offset)
            all_notes.extend(confirmed)

    # Flush any remaining audio that didn't fill a complete window
    final_window = buf_mgr.flush()
    if final_window is not None:
        notes = model.transcribe(
            final_window, sample_rate=sample_rate,
            expected_pitches=expected_pitches,
        )
        window_offset = buf_mgr.last_window_start_s
        confirmed = buf_mgr.consensus_notes(notes, window_offset)
        all_notes.extend(confirmed)

    # Emit remaining pending notes
    all_notes.extend(buf_mgr.flush_pending())

    return all_notes


# ===================================================================
# Real-life piano tutor scenarios (11-20)
# ===================================================================


def test_beginner_melody() -> Tuple[bool, str]:
    """
    11. Beginner melody: "Mary Had a Little Lamb" first phrase.
    E4 D4 C4 D4 E4 E4 E4 (MIDI 64,62,60,62,64,64,64).
    Each note 0.4s, 0.1s gap (typical beginner tempo ~100 BPM).
    Pass: F1 > 0.85.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    melody_midi = [64, 62, 60, 62, 64, 64, 64]
    sr = 44100
    note_dur = 0.4
    gap_dur = 0.1

    segments = []
    for midi_note in melody_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.7)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, melody_midi)
    passed = result["f1"] > 0.85
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_repeated_notes() -> Tuple[bool, str]:
    """
    12. Repeated notes: C4 played 5 times in succession.
    Each 0.3s, 0.1s gap. Tests that the system distinguishes repeated
    attacks of the same pitch (critical for exercises and rhythmic patterns).
    Pass: detect 4 or 5 of 5 C4 onsets (>= 80%).
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    midi_note = 60  # C4
    repeat_count = 5
    sr = 44100
    note_dur = 0.3
    gap_dur = 0.1

    segments = []
    for _ in range(repeat_count):
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.7)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    # Count C4 detections (within 1 semitone of MIDI 60)
    c4_count = sum(1 for n in all_notes if abs(n.pitch - midi_note) <= 1)
    passed = c4_count >= 4
    detail = f"{c4_count}/{repeat_count} C4 onsets detected"
    if all_notes:
        other = [n.pitch for n in all_notes if abs(n.pitch - midi_note) > 1]
        if other:
            detail += f" (extras: {other})"
    return passed, detail


def test_chord_progression() -> Tuple[bool, str]:
    """
    13. Chord progression I-IV-V-I in C major.
    C major (60,64,67) -> F major (60,65,69) -> G major (59,67,71) -> C major.
    Each chord 1.0s, 0.15s gap. Tests polyphonic tracking across changes.
    Pass: >= 9 of 12 total chord tones detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    chords = [
        [60, 64, 67],  # C major
        [60, 65, 69],  # F major
        [59, 67, 71],  # G major
        [60, 64, 67],  # C major
    ]
    chord_dur = 1.0
    gap_dur = 0.15

    segments = []
    expected_midi = []
    for chord in chords:
        segments.append(generate_chord(chord, chord_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(chord)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, expected_midi)
    total_expected = len(expected_midi)
    passed = result["matched"] >= 9
    detail = (
        f"{result['matched']}/{total_expected} chord tones "
        f"(F1={result['f1']:.2f} P={result['precision']:.2f} R={result['recall']:.2f})"
    )
    return passed, detail


def test_melody_over_bass() -> Tuple[bool, str]:
    """
    14. Melody over sustained bass: right hand plays C4-E4-G4 melody
    while left hand holds a C3 bass note throughout.
    Tests two-hand separation at different registers.
    Pass: F1 > 0.75 on all expected notes.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    melody_midi = [60, 64, 67]  # C4, E4, G4
    bass_midi = 48  # C3
    note_dur = 0.4
    gap_dur = 0.05
    total_dur = len(melody_midi) * (note_dur + gap_dur)

    # Generate sustained bass
    bass_tone = generate_piano_tone(midi_to_freq(bass_midi), total_dur, sr, velocity=0.6)

    # Generate melody over bass
    melody_segments = []
    for midi_note in melody_midi:
        tone = generate_piano_tone(midi_to_freq(midi_note), note_dur, sr, velocity=0.8)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        melody_segments.append(tone)
        melody_segments.append(gap)
    melody_audio = np.concatenate(melody_segments)

    # Mix (pad to same length)
    length = max(len(bass_tone), len(melody_audio))
    mixed = np.zeros(length, dtype=np.float32)
    mixed[: len(bass_tone)] += bass_tone
    mixed[: len(melody_audio)] += melody_audio
    peak = np.abs(mixed).max()
    if peak > 1.0:
        mixed /= peak

    # Pad to model length
    model_samples = int(1.12 * sr)
    if len(mixed) < model_samples:
        mixed = np.pad(mixed, (0, model_samples - len(mixed)))

    notes = model.transcribe(mixed[:model_samples], sample_rate=sr)
    expected_all = [bass_midi] + melody_midi
    result = evaluate_detection(notes, expected_all)

    passed = result["f1"] > 0.75
    detail = (
        f"F1={result['f1']:.2f} ({result['matched']}/{len(expected_all)} matched)"
    )
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_parallel_thirds() -> Tuple[bool, str]:
    """
    15. Parallel thirds: C4+E4, D4+F4, E4+G4, F4+A4 played as intervals.
    Each interval 0.5s, 0.1s gap. Common in piano pedagogy.
    Pass: >= 6 of 8 notes detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    intervals = [
        [60, 64],  # C4+E4
        [62, 65],  # D4+F4
        [64, 67],  # E4+G4
        [65, 69],  # F4+A4
    ]
    interval_dur = 0.5
    gap_dur = 0.1

    segments = []
    expected_midi = []
    for pair in intervals:
        segments.append(generate_chord(pair, interval_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(pair)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, expected_midi)
    total_expected = len(expected_midi)
    passed = result["matched"] >= 6
    detail = (
        f"{result['matched']}/{total_expected} interval notes "
        f"(F1={result['f1']:.2f})"
    )
    return passed, detail


def test_pentascale_up_down() -> Tuple[bool, str]:
    """
    16. Pentascale exercise: C4-D4-E4-F4-G4-F4-E4-D4-C4.
    The most common beginner finger exercise. 0.35s per note, 0.05s gap.
    Pass: F1 > 0.85.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    pentascale = [60, 62, 64, 65, 67, 65, 64, 62, 60]
    note_dur = 0.35
    gap_dur = 0.05

    segments = []
    for midi_note in pentascale:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.7)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, pentascale)
    passed = result["f1"] > 0.85
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_wrong_note_detection() -> Tuple[bool, str]:
    """
    17. Wrong note detection: C major scale with F# instead of F.
    C4 D4 E4 F#4 G4 (MIDI 60,62,64,66,67). The tutor must detect what was
    ACTUALLY played (including the wrong note), not what was expected.
    Pass: F#4 (MIDI 66) is detected AND F4 (MIDI 65) is NOT detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    played_midi = [60, 62, 64, 66, 67]  # F#4 instead of F4
    note_dur = 0.5
    gap_dur = 0.1

    segments = []
    for midi_note in played_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.8)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    detected_pitches = [n.pitch for n in all_notes]
    fsharp_detected = any(abs(p - 66) <= 1 for p in detected_pitches)
    fnat_detected = 65 in detected_pitches  # exact match only for wrong note

    passed = fsharp_detected and not fnat_detected
    detail = f"F#4 detected={fsharp_detected}, F4 ghost={fnat_detected}"
    detail += f" | pitches={sorted(set(detected_pitches))}"
    return passed, detail


def test_alberti_bass() -> Tuple[bool, str]:
    """
    18. Alberti bass pattern: C3-G3-E3-G3 repeated twice.
    MIDI: 48,55,52,55,48,55,52,55. Each note 0.2s, no gap (legato).
    Classic left-hand pattern in classical piano.
    Pass: F1 > 0.70 (lower bar — rapid low-register notes are harder).
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    pattern_midi = [48, 55, 52, 55, 48, 55, 52, 55]
    note_dur = 0.2

    segments = []
    for midi_note in pattern_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.6)
        segments.append(tone)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, pattern_midi)
    passed = result["f1"] > 0.70
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    return passed, detail


def test_octave_doubling() -> Tuple[bool, str]:
    """
    19. Octave doubling: C3+C4, then E3+E4, then G3+G4 played as octave pairs.
    Each pair 0.5s, 0.1s gap. Common in both hands playing same note.
    Pass: >= 4 of 6 notes detected (both octaves of most pairs).
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    pairs = [
        [48, 60],  # C3+C4
        [52, 64],  # E3+E4
        [55, 67],  # G3+G4
    ]
    pair_dur = 0.5
    gap_dur = 0.1

    segments = []
    expected_midi = []
    for pair in pairs:
        segments.append(generate_chord(pair, pair_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(pair)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, expected_midi)
    passed = result["matched"] >= 4
    detail = (
        f"{result['matched']}/{len(expected_midi)} octave notes "
        f"(F1={result['f1']:.2f})"
    )
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_slow_practice() -> Tuple[bool, str]:
    """
    20. Slow practice: C4-E4-G4-C5 at very slow tempo (1.0s per note, 0.5s gap).
    Beginners often play extremely slowly. Tests sustained note detection.
    Pass: F1 > 0.85.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    slow_midi = [60, 64, 67, 72]
    note_dur = 1.0
    gap_dur = 0.5

    segments = []
    for midi_note in slow_midi:
        freq = midi_to_freq(midi_note)
        tone = generate_piano_tone(freq, note_dur, sr, velocity=0.8)
        gap = np.zeros(int(gap_dur * sr), dtype=np.float32)
        segments.append(tone)
        segments.append(gap)

    audio = np.concatenate(segments)
    all_notes = _transcribe_long_audio(model, audio, sr)

    result = evaluate_detection(all_notes, slow_midi)
    passed = result["f1"] > 0.85
    detail = f"F1={result['f1']:.2f} (P={result['precision']:.2f} R={result['recall']:.2f})"
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


# ===================================================================
# Score-aware test variants (21-25)
# ===================================================================


def test_block_chords_score_aware() -> Tuple[bool, str]:
    """
    21. Block chords with score-aware detection.
    Same as #5 but with expected_pitches provided.
    Pass: ALL 3 of 3 notes detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    chord_midi = [60, 64, 67]
    sr = 44100
    audio = generate_chord(chord_midi, 1.12, sr)

    expected = set(chord_midi)
    notes = model.transcribe(audio, sample_rate=sr, expected_pitches=expected)
    detected_pitches = list(set(n.pitch for n in notes))

    hits = sum(
        1
        for exp in chord_midi
        if any(abs(dp - exp) <= 1 for dp in detected_pitches)
    )
    passed = hits >= 3
    detail = f"{hits}/{len(chord_midi)} chord notes (score-aware, pitches: {detected_pitches})"
    return passed, detail


def test_chord_progression_score_aware() -> Tuple[bool, str]:
    """
    22. Chord progression I-IV-V-I with score-aware detection.
    Same as #13 but with expected_pitches.
    Pass: >= 10 of 12 chord tones detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    chords = [
        [60, 64, 67],  # C major
        [60, 65, 69],  # F major
        [59, 67, 71],  # G major
        [60, 64, 67],  # C major
    ]
    chord_dur = 1.0
    gap_dur = 0.15

    segments = []
    expected_midi = []
    for chord in chords:
        segments.append(generate_chord(chord, chord_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(chord)

    audio = np.concatenate(segments)
    expected_set = set(expected_midi)
    all_notes = _transcribe_long_audio(model, audio, sr, expected_pitches=expected_set)

    result = evaluate_detection(all_notes, expected_midi)
    passed = result["matched"] >= 10
    detail = (
        f"{result['matched']}/{len(expected_midi)} chord tones (score-aware) "
        f"(F1={result['f1']:.2f} P={result['precision']:.2f} R={result['recall']:.2f})"
    )
    return passed, detail


def test_parallel_thirds_score_aware() -> Tuple[bool, str]:
    """
    23. Parallel thirds with score-aware detection.
    Same as #15 but with expected_pitches.
    Pass: >= 7 of 8 notes detected.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    intervals = [
        [60, 64],  # C4+E4
        [62, 65],  # D4+F4
        [64, 67],  # E4+G4
        [65, 69],  # F4+A4
    ]
    interval_dur = 0.5
    gap_dur = 0.1

    segments = []
    expected_midi = []
    for pair in intervals:
        segments.append(generate_chord(pair, interval_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(pair)

    audio = np.concatenate(segments)
    expected_set = set(expected_midi)
    all_notes = _transcribe_long_audio(model, audio, sr, expected_pitches=expected_set)

    result = evaluate_detection(all_notes, expected_midi)
    passed = result["matched"] >= 7
    detail = (
        f"{result['matched']}/{len(expected_midi)} interval notes (score-aware) "
        f"(F1={result['f1']:.2f})"
    )
    return passed, detail


def test_octave_doubling_score_aware() -> Tuple[bool, str]:
    """
    24. Octave doubling with score-aware detection.
    Same as #19 but with expected_pitches.
    Pass: >= 5 of 6 notes detected (both octaves of most pairs).
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    sr = 44100
    pairs = [
        [48, 60],  # C3+C4
        [52, 64],  # E3+E4
        [55, 67],  # G3+G4
    ]
    pair_dur = 0.5
    gap_dur = 0.1

    segments = []
    expected_midi = []
    for pair in pairs:
        segments.append(generate_chord(pair, pair_dur, sr))
        segments.append(np.zeros(int(gap_dur * sr), dtype=np.float32))
        expected_midi.extend(pair)

    audio = np.concatenate(segments)
    expected_set = set(expected_midi)
    all_notes = _transcribe_long_audio(model, audio, sr, expected_pitches=expected_set)

    result = evaluate_detection(all_notes, expected_midi)
    passed = result["matched"] >= 5
    detail = (
        f"{result['matched']}/{len(expected_midi)} octave notes (score-aware) "
        f"(F1={result['f1']:.2f})"
    )
    if result["missed"]:
        detail += f" missed={result['missed']}"
    return passed, detail


def test_two_hand_score_aware() -> Tuple[bool, str]:
    """
    25. Two-hand texture with score-aware detection.
    Same as #6 but with expected_pitches.
    Pass: F1 > 0.85 on all 4 notes.
    """
    model, skip = _require_model()
    if model is None:
        return False, f"SKIP: {skip}"

    all_midi = [60, 64, 67, 72]
    sr = 44100
    audio = generate_chord(all_midi, 1.12, sr)

    expected = set(all_midi)
    notes = model.transcribe(audio, sample_rate=sr, expected_pitches=expected)
    result = evaluate_detection(notes, all_midi)
    passed = result["f1"] > 0.85
    detail = f"F1={result['f1']:.2f} ({result['matched']}/{len(all_midi)} matched, score-aware)"
    return passed, detail


# ===================================================================
# Main runner
# ===================================================================

ALL_TESTS = [
    # Original stress tests (1-10)
    ("Single notes chromatic", test_single_notes_chromatic),
    ("C major scale", test_c_major_scale),
    ("Chromatic scale", test_chromatic_scale),
    ("Arpeggios", test_arpeggios),
    ("Block chords", test_block_chords),
    ("Two-hand texture", test_two_hand),
    ("Staccato / legato", test_staccato_legato),
    ("Dynamics", test_dynamics),
    ("Fast passages", test_fast_passages),
    ("Existing WAV file", test_existing_wav),
    # Real-life piano tutor scenarios (11-20)
    ("Beginner melody", test_beginner_melody),
    ("Repeated notes", test_repeated_notes),
    ("Chord progression I-IV-V", test_chord_progression),
    ("Melody over bass", test_melody_over_bass),
    ("Parallel thirds", test_parallel_thirds),
    ("Pentascale up/down", test_pentascale_up_down),
    ("Wrong note detection", test_wrong_note_detection),
    ("Alberti bass", test_alberti_bass),
    ("Octave doubling", test_octave_doubling),
    ("Slow practice", test_slow_practice),
    # Score-aware variants (21-25)
    ("Block chords (score)", test_block_chords_score_aware),
    ("Chord prog (score)", test_chord_progression_score_aware),
    ("Parallel 3rds (score)", test_parallel_thirds_score_aware),
    ("Octave doubling (score)", test_octave_doubling_score_aware),
    ("Two-hand (score)", test_two_hand_score_aware),
]


def run_all_tests() -> Tuple[int, int]:
    """
    Run all 10 stress tests and print a formatted results table.

    Returns
    -------
    tuple of (passed_count, total_count)
    """
    print("=" * 65)
    print("  Piano Detection Stress Test Suite")
    print("=" * 65)

    # Check model availability up front
    model = _get_model()
    if model is None:
        print(f"\n  WARNING: {_model_load_error}")
        print("  ML-dependent tests will be skipped.\n")

    print(f"{'#':>2} | {'Test':<25} | {'Result':<6} | Details")
    print(f"{'--':>2}-+-{'-'*25}-+-{'-'*6}-+-{'-'*30}")

    passed_count = 0
    total_count = len(ALL_TESTS)

    for idx, (name, test_fn) in enumerate(ALL_TESTS, start=1):
        try:
            t0 = time.time()
            passed, details = test_fn()
            elapsed = time.time() - t0

            if "SKIP" in details:
                status = "SKIP"
            elif passed:
                status = "PASS"
                passed_count += 1
            else:
                status = "FAIL"

            # Truncate long detail lines for readability
            if len(details) > 80:
                details = details[:77] + "..."

            print(f"{idx:>2} | {name:<25} | {status:<6} | {details} ({elapsed:.1f}s)")

        except Exception:
            print(f"{idx:>2} | {name:<25} | ERROR  | {traceback.format_exc().splitlines()[-1]}")

    print("=" * 65)
    skipped = total_count - passed_count
    print(f"  RESULT: {passed_count}/{total_count} passed")
    print("=" * 65)

    return passed_count, total_count


if __name__ == "__main__":
    run_all_tests()
