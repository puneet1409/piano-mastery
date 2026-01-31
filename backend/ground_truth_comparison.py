#!/usr/bin/env python3
"""
Ground Truth Comparison for Piano Detection

Our model IS Google's Onsets & Frames (trained on MAESTRO dataset) — the SOTA
for piano transcription. We compare two modes of the SAME model:

1. "DEEP" mode: Full MAESTRO model with LOW thresholds (0.15/0.10), NO harmonic
   filtering, 75% overlap → ground truth (everything SOTA can detect)

2. "FAST" mode: Same model with PRODUCTION thresholds (0.30/0.20), harmonic
   filtering, 50% overlap + dedup → our real-time pipeline

This reveals: of the notes the SOTA model CAN detect, how many does our
production pipeline preserve?
"""

import os
import time
import numpy as np
import soundfile as sf
import mir_eval

from onsets_frames_tflite import OnsetsFramesTFLite, NoteEvent
from audio_buffer_manager import AudioBufferManager

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def hz_to_midi(freq):
    if freq <= 0 or np.isnan(freq):
        return 0
    return int(round(69 + 12 * np.log2(freq / 440.0)))


def midi_to_name(midi):
    octave = (midi - 12) // 12
    return f"{NOTE_NAMES[midi % 12]}{octave}"


def midi_to_notename(midi):
    return NOTE_NAMES[midi % 12]


def midi_to_hz(midi):
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


# ── 1. DEEP MODE: Full MAESTRO model, low thresholds, no filtering ──

def deep_transcribe(model, audio, sr):
    """
    Run the MAESTRO model exhaustively with low thresholds and NO
    harmonic filtering. This captures every note the SOTA model can see.
    """
    buf_mgr = AudioBufferManager(
        sample_rate=sr,
        window_samples=int(17920 * sr / 16000),
        hop_ratio=0.25,  # 75% overlap for maximum coverage
        dedup_window_ms=300.0,
    )

    all_notes = []
    chunk_size = int(sr * 0.25)  # smaller chunks, more windows

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i : i + chunk_size]
        window = buf_mgr.add_chunk(chunk)
        if window is not None:
            # Low thresholds = high sensitivity
            notes = model.transcribe(
                window, sample_rate=sr,
                onset_threshold=0.15,
                frame_threshold=0.10,
            )
            window_offset = buf_mgr.last_window_start_s
            deduped = buf_mgr.deduplicate_notes(notes, window_offset)
            all_notes.extend(deduped)

    final_window = buf_mgr.flush()
    if final_window is not None:
        notes = model.transcribe(
            final_window, sample_rate=sr,
            onset_threshold=0.15,
            frame_threshold=0.10,
        )
        window_offset = buf_mgr.last_window_start_s
        deduped = buf_mgr.deduplicate_notes(notes, window_offset)
        all_notes.extend(deduped)

    return [{'pitch': n.pitch, 'onset': n.onset_time, 'offset': n.offset_time,
             'confidence': n.confidence}
            for n in all_notes]


# ── 2. FAST MODE: Production pipeline ──

def fast_transcribe(model, audio, sr, mode="single_note"):
    """Run our production pipeline: consensus merge + harmonic filter."""
    buf_mgr = AudioBufferManager(
        sample_rate=sr,
        window_samples=int(17920 * sr / 16000),
        hop_ratio=0.50,   # 50% overlap
    )

    all_notes = []
    chunk_size = int(sr * 0.5)

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i : i + chunk_size]
        window = buf_mgr.add_chunk(chunk)
        if window is not None:
            notes = model.transcribe(window, sample_rate=sr, mode=mode)
            window_offset = buf_mgr.last_window_start_s
            confirmed = buf_mgr.consensus_notes(notes, window_offset)
            all_notes.extend(confirmed)

    final_window = buf_mgr.flush()
    if final_window is not None:
        notes = model.transcribe(final_window, sample_rate=sr, mode=mode)
        window_offset = buf_mgr.last_window_start_s
        confirmed = buf_mgr.consensus_notes(notes, window_offset)
        all_notes.extend(confirmed)

    # Emit any remaining pending notes
    all_notes.extend(buf_mgr.flush_pending())

    return [{'pitch': n.pitch, 'onset': n.onset_time, 'offset': n.offset_time,
             'confidence': n.confidence}
            for n in all_notes]


# ── 3. SCORE-AWARE MODE: Production pipeline + expected pitches ──

def score_aware_transcribe(model, audio, sr, ground_truth_notes, mode="single_note"):
    """
    Run production pipeline with score-aware detection.
    Uses ground truth pitches as expected_pitches to simulate what happens
    when the tutor app knows what the student should play.
    """
    # Extract expected MIDI pitches from ground truth
    expected_pitches = set(n['pitch'] for n in ground_truth_notes if 21 <= n['pitch'] <= 108)

    buf_mgr = AudioBufferManager(
        sample_rate=sr,
        window_samples=int(17920 * sr / 16000),
        hop_ratio=0.50,
    )

    all_notes = []
    chunk_size = int(sr * 0.5)

    for i in range(0, len(audio), chunk_size):
        chunk = audio[i : i + chunk_size]
        window = buf_mgr.add_chunk(chunk)
        if window is not None:
            notes = model.transcribe(
                window, sample_rate=sr, mode=mode,
                expected_pitches=expected_pitches,
            )
            window_offset = buf_mgr.last_window_start_s
            confirmed = buf_mgr.consensus_notes(notes, window_offset)
            all_notes.extend(confirmed)

    final_window = buf_mgr.flush()
    if final_window is not None:
        notes = model.transcribe(
            final_window, sample_rate=sr, mode=mode,
            expected_pitches=expected_pitches,
        )
        window_offset = buf_mgr.last_window_start_s
        confirmed = buf_mgr.consensus_notes(notes, window_offset)
        all_notes.extend(confirmed)

    all_notes.extend(buf_mgr.flush_pending())

    return [{'pitch': n.pitch, 'onset': n.onset_time, 'offset': n.offset_time,
             'confidence': n.confidence}
            for n in all_notes]


# ── Evaluation ──

def evaluate(ref_notes, est_notes, onset_tol=0.15):
    """mir_eval transcription precision/recall/F1."""
    if not ref_notes or not est_notes:
        return {'p': 0, 'r': 0, 'f1': 0, 'pitch_match': 0}

    ref_intervals = np.array([[n['onset'], max(n['offset'], n['onset'] + 0.01)]
                              for n in ref_notes])
    ref_pitches = np.array([midi_to_hz(n['pitch']) for n in ref_notes])

    est_intervals = np.array([[n['onset'], max(n['offset'], n['onset'] + 0.01)]
                              for n in est_notes])
    est_pitches = np.array([midi_to_hz(n['pitch']) for n in est_notes])

    p, r, f1, _ = mir_eval.transcription.precision_recall_f1_overlap(
        ref_intervals, ref_pitches,
        est_intervals, est_pitches,
        onset_tolerance=onset_tol,
        pitch_tolerance=50.0,
        offset_ratio=None,
    )

    ref_set = set(n['pitch'] for n in ref_notes if 48 <= n['pitch'] <= 84)
    est_set = set(n['pitch'] for n in est_notes if 48 <= n['pitch'] <= 84)
    pitch_match = len(ref_set & est_set) / len(ref_set) if ref_set else 0

    return {'p': p, 'r': r, 'f1': f1, 'pitch_match': pitch_match}


def note_dist(notes, top_n=10):
    """Note name distribution in C3-C6 range."""
    d = {}
    for n in notes:
        if 48 <= n['pitch'] <= 84:
            name = midi_to_notename(n['pitch'])
            d[name] = d.get(name, 0) + 1
    return sorted(d.items(), key=lambda x: -x[1])[:top_n]


# ── Main ──

SONGS = [
    {
        "file": "test_songs/perfect_musescore.wav",
        "title": "Perfect - Ed Sheeran (MuseScore)",
        "clip_seconds": 30,
    },
    {
        "file": "test_songs/kaisehua_cover.wav",
        "title": "Kaise Hua - Kabir Singh (Cover)",
        "clip_seconds": 30,
    },
    {
        "file": "test_songs/kalhonaho_easy.wav",
        "title": "Kal Ho Naa Ho (Easy Piano)",
        "clip_seconds": 30,
    },
    {
        "file": "test_songs/lagjagale_cover.wav",
        "title": "Lag Ja Gale (Piano Cover)",
        "clip_seconds": 30,
    },
]


def main():
    print("=" * 80)
    print("  GROUND TRUTH COMPARISON: Google MAESTRO SOTA Model")
    print("=" * 80)
    print()
    print("  All three use the SAME Google Onsets & Frames (MAESTRO) model.")
    print("  The difference is post-processing and sensitivity:")
    print()
    print("  DEEP:       Low thresholds (0.15/0.10), 75% overlap, no harmonic filter")
    print("              → Everything the SOTA model can detect (ground truth)")
    print("  FAST:       Prod thresholds (0.30/0.20), 50% overlap, harmonic filter + dedup")
    print("              → Our real-time production pipeline (free mode)")
    print("  SCORE-AWARE: Prod pipeline + expected pitches from ground truth")
    print("              → Simulates exercise mode (tutor knows what to expect)")
    print()

    model = OnsetsFramesTFLite()
    results = []

    for song in SONGS:
        if not os.path.exists(song["file"]):
            print(f"\n  SKIP: {song['title']} (not found)")
            continue

        print(f"\n{'━' * 80}")
        print(f"  {song['title']}")
        print(f"{'━' * 80}")

        audio, sr = sf.read(song["file"])
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = audio.astype(np.float32)

        clip_s = song["clip_seconds"]
        if len(audio) / sr > clip_s:
            audio = audio[:int(sr * clip_s)]
        duration = len(audio) / sr
        print(f"  {duration:.0f}s @ {sr}Hz")

        # ── Run all three modes ──
        print(f"\n  [DEEP]  MAESTRO model (high sensitivity, no filtering)...", end=" ", flush=True)
        t0 = time.time()
        deep_notes = deep_transcribe(model, audio, sr)
        deep_time = time.time() - t0
        deep_mid = [n for n in deep_notes if 48 <= n['pitch'] <= 84]
        print(f"{len(deep_mid)} notes in {deep_time:.1f}s")

        print(f"  [FAST]  Production pipeline (filtered, deduped)...", end=" ", flush=True)
        t0 = time.time()
        fast_notes = fast_transcribe(model, audio, sr)
        fast_time = time.time() - t0
        fast_mid = [n for n in fast_notes if 48 <= n['pitch'] <= 84]
        print(f"{len(fast_mid)} notes in {fast_time:.1f}s")

        print(f"  [SCORE] Score-aware (expected pitches from DEEP)...", end=" ", flush=True)
        t0 = time.time()
        score_notes = score_aware_transcribe(model, audio, sr, deep_notes)
        score_time = time.time() - t0
        score_mid = [n for n in score_notes if 48 <= n['pitch'] <= 84]
        print(f"{len(score_mid)} notes in {score_time:.1f}s")

        # ── Note distributions ──
        print(f"\n  Note distributions (C3-C6):")
        dd = note_dist(deep_notes)
        fd = note_dist(fast_notes)
        sd = note_dist(score_notes)
        print(f"    DEEP:  {', '.join(f'{n}({c})' for n, c in dd)}")
        print(f"    FAST:  {', '.join(f'{n}({c})' for n, c in fd)}")
        print(f"    SCORE: {', '.join(f'{n}({c})' for n, c in sd)}")

        # ── Evaluate FAST vs DEEP ──
        print(f"\n  FAST vs DEEP ground truth:")
        if deep_mid and fast_mid:
            mf = evaluate(deep_mid, fast_mid, onset_tol=0.30)
            print(f"    @300ms: P={mf['p']:.0%} R={mf['r']:.0%} F1={mf['f1']:.0%} Pitch={mf['pitch_match']:.0%}")
        else:
            mf = {'p': 0, 'r': 0, 'f1': 0, 'pitch_match': 0}

        # ── Evaluate SCORE-AWARE vs DEEP ──
        print(f"  SCORE-AWARE vs DEEP ground truth:")
        if deep_mid and score_mid:
            ms = evaluate(deep_mid, score_mid, onset_tol=0.30)
            print(f"    @300ms: P={ms['p']:.0%} R={ms['r']:.0%} F1={ms['f1']:.0%} Pitch={ms['pitch_match']:.0%}")
        else:
            ms = {'p': 0, 'r': 0, 'f1': 0, 'pitch_match': 0}

        # ── Recall improvement ──
        r_delta = ms['r'] - mf['r']
        f1_delta = ms['f1'] - mf['f1']
        print(f"  Score-aware gain: R +{r_delta:.0%}, F1 +{f1_delta:.0%}")

        results.append({
            'title': song['title'],
            'deep': len(deep_mid), 'fast': len(fast_mid), 'score': len(score_mid),
            'deep_time': deep_time, 'fast_time': fast_time, 'score_time': score_time,
            'fast_p': mf['p'], 'fast_r': mf['r'], 'fast_f1': mf['f1'],
            'score_p': ms['p'], 'score_r': ms['r'], 'score_f1': ms['f1'],
            'fast_pitch': mf['pitch_match'], 'score_pitch': ms['pitch_match'],
        })

    # ── Final Summary ──
    print(f"\n{'=' * 100}")
    print("  FINAL SUMMARY: Three-Way Comparison vs DEEP Ground Truth")
    print(f"{'=' * 100}")
    hdr = f"  {'Song':<30} {'DEEP':>5} │ {'FAST':>5} {'P':>5} {'R':>5} {'F1':>5} │ {'SCORE':>5} {'P':>5} {'R':>5} {'F1':>5} │ {'ΔR':>5} {'ΔF1':>5}"
    print(hdr)
    sep = f"  {'─'*30} {'─'*5} │ {'─'*5} {'─'*5} {'─'*5} {'─'*5} │ {'─'*5} {'─'*5} {'─'*5} {'─'*5} │ {'─'*5} {'─'*5}"
    print(sep)
    for r in results:
        dr = r['score_r'] - r['fast_r']
        df = r['score_f1'] - r['fast_f1']
        print(f"  {r['title']:<30} {r['deep']:>5} │ "
              f"{r['fast']:>5} {r['fast_p']:>4.0%} {r['fast_r']:>4.0%} {r['fast_f1']:>4.0%} │ "
              f"{r['score']:>5} {r['score_p']:>4.0%} {r['score_r']:>4.0%} {r['score_f1']:>4.0%} │ "
              f"{dr:>+4.0%} {df:>+4.0%}")

    # Averages
    if results:
        avg_fp = np.mean([r['fast_p'] for r in results])
        avg_fr = np.mean([r['fast_r'] for r in results])
        avg_ff = np.mean([r['fast_f1'] for r in results])
        avg_sp = np.mean([r['score_p'] for r in results])
        avg_sr = np.mean([r['score_r'] for r in results])
        avg_sf = np.mean([r['score_f1'] for r in results])
        avg_dr = avg_sr - avg_fr
        avg_df = avg_sf - avg_ff
        print(sep)
        print(f"  {'AVERAGE':<30} {'':>5} │ "
              f"{'':>5} {avg_fp:>4.0%} {avg_fr:>4.0%} {avg_ff:>4.0%} │ "
              f"{'':>5} {avg_sp:>4.0%} {avg_sr:>4.0%} {avg_sf:>4.0%} │ "
              f"{avg_dr:>+4.0%} {avg_df:>+4.0%}")

    print(f"\n  Metrics (evaluated at 300ms onset tolerance):")
    print(f"    DEEP        = Same MAESTRO model, max sensitivity (ground truth)")
    print(f"    FAST        = Production pipeline, free mode (no expected pitches)")
    print(f"    SCORE-AWARE = Production pipeline + expected pitches (exercise mode)")
    print(f"    ΔR / ΔF1    = Recall / F1 improvement from score-aware detection")
    print(f"{'=' * 100}")


if __name__ == "__main__":
    main()
