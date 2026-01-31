#!/usr/bin/env python3
"""
Onsets and Frames TFLite Model Wrapper

Google Magenta's polyphonic piano transcription model.
Trained on MAESTRO dataset, achieves ~95% F1 score on piano.

Model: onsets_frames_wavinput.tflite
Source: https://storage.googleapis.com/magentadata/models/onsets_frames_transcription/tflite/onsets_frames_wavinput.tflite
"""

import numpy as np
from typing import List, Tuple, Optional, Set
from dataclasses import dataclass
from math import gcd
from scipy.signal import resample_poly

# Use new LiteRT API instead of deprecated tf.lite.Interpreter
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    # Fallback to deprecated tf.lite.Interpreter if ai_edge_litert not installed
    import warnings
    warnings.filterwarnings('ignore', message='.*tf.lite.Interpreter is deprecated.*')
    import tensorflow as tf
    Interpreter = tf.lite.Interpreter


@dataclass
class NoteEvent:
    """Detected note with timing information"""
    note: str
    pitch: int  # MIDI note number (0-127)
    onset_time: float  # seconds
    offset_time: float  # seconds
    velocity: float  # 0.0-1.0
    confidence: float  # 0.0-1.0
    onset_strength: float = 0.0  # raw onset probability at the onset frame


class OnsetsFramesTFLite:
    """
    Wrapper for Onsets and Frames TFLite model.

    Model expects:
    - Input: Raw audio waveform (16kHz, mono)
    - Output: Onsets (note attacks) + Frames (sustained notes)
    """

    def __init__(self, model_path: str = "onsets_frames_wavinput.tflite"):
        """
        Initialize TFLite interpreter.

        Args:
            model_path: Path to .tflite model file
        """
        self.model_path = model_path
        self.interpreter = Interpreter(model_path=model_path)
        self.interpreter.allocate_tensors()

        # Get input/output tensor details
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()

        # Print model info
        print(f"🎹 Loaded Onsets and Frames TFLite model")
        print(f"   Input shape: {self.input_details[0]['shape']}")
        print(f"   Input dtype: {self.input_details[0]['dtype']}")
        print(f"   Num outputs: {len(self.output_details)}")

        # Store input requirements
        self.input_shape = self.input_details[0]['shape']
        self.sample_rate = 16000  # Model expects 16kHz audio

    def preprocess_audio(self, audio: np.ndarray, original_sr: int = 44100) -> np.ndarray:
        """
        Preprocess audio for model input.

        Args:
            audio: Audio samples (mono, float32, -1.0 to 1.0)
            original_sr: Original sample rate

        Returns:
            Preprocessed audio ready for model
        """
        # Ensure float32
        audio = audio.astype(np.float32)

        # Resample to 16kHz if needed (anti-aliased)
        if original_sr != self.sample_rate:
            g = gcd(original_sr, self.sample_rate)
            audio = resample_poly(audio, self.sample_rate // g, original_sr // g).astype(np.float32)

        # Normalize to [-1, 1]
        max_val = np.abs(audio).max()
        if max_val > 0:
            audio = audio / max_val

        # Pad or truncate to model input size
        # Input shape is [N] not [batch, N]
        expected_length = self.input_shape[0] if len(self.input_shape) == 1 else self.input_shape[1]

        if len(audio) < expected_length:
            # Pad with zeros
            audio = np.pad(audio, (0, expected_length - len(audio)), mode='constant')
        elif len(audio) > expected_length:
            # Truncate
            audio = audio[:expected_length]

        # Model expects shape [N] not [1, N]
        audio = audio.reshape(-1)

        return audio

    def predict(self, audio: np.ndarray, sample_rate: int = 44100) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Run inference on audio chunk.

        Args:
            audio: Audio samples (mono, float32)
            sample_rate: Sample rate of input audio

        Returns:
            (frames, onsets, offsets, velocities) - all numpy arrays with pitch predictions
        """
        # Preprocess audio
        audio_input = self.preprocess_audio(audio, sample_rate)

        # Run inference
        self.interpreter.set_tensor(self.input_details[0]['index'], audio_input)
        self.interpreter.invoke()

        # Get outputs (4 outputs based on model inspection)
        # Output 0: frame_logits [1, 32, 88]
        # Output 1: onset_logits [1, 32, 88]
        # Output 2: offset_logits [1, 32, 88]
        # Output 3: velocity_values [1, 32, 88]
        frame_logits = self.interpreter.get_tensor(self.output_details[0]['index'])
        onset_logits = self.interpreter.get_tensor(self.output_details[1]['index'])
        offset_logits = self.interpreter.get_tensor(self.output_details[2]['index'])
        velocity_values = self.interpreter.get_tensor(self.output_details[3]['index'])

        # Apply sigmoid to logits to get probabilities
        frames = self.sigmoid(frame_logits)
        onsets = self.sigmoid(onset_logits)
        offsets = self.sigmoid(offset_logits)
        velocities = velocity_values  # Already scaled

        return frames, onsets, offsets, velocities

    @staticmethod
    def sigmoid(x):
        """Apply sigmoid function to convert logits to probabilities"""
        return 1.0 / (1.0 + np.exp(-x))

    def decode_predictions(
        self,
        frames: np.ndarray,
        onsets: np.ndarray,
        offsets: np.ndarray,
        velocities: np.ndarray,
        onset_threshold: float = 0.3,
        frame_threshold: float = 0.2,
        min_duration_ms: float = 30.0,
        max_duration_ms: float = 2000.0,
        nms_window_ms: float = 100.0,
        expected_pitches: Optional[Set[int]] = None,
    ) -> List[NoteEvent]:
        """
        Decode model outputs into note events.

        Args:
            frames: Frame predictions (time x pitch)
            onsets: Onset predictions (time x pitch)
            offsets: Offset predictions (time x pitch)
            velocities: Velocity predictions (time x pitch)
            onset_threshold: Minimum onset probability
            frame_threshold: Minimum frame probability
            min_duration_ms: Minimum note duration in milliseconds
            max_duration_ms: Maximum note duration in milliseconds (cap artifacts)
            nms_window_ms: Temporal NMS window — suppress duplicate onsets within this window per pitch
            expected_pitches: Optional set of MIDI pitch numbers that the score expects.
                When provided, these pitches get lower thresholds for better recall.

        Returns:
            List of NoteEvent objects
        """
        # Remove batch dimension if present
        if len(onsets.shape) == 3:
            frames = frames[0]
            onsets = onsets[0]
            offsets = offsets[0]
            velocities = velocities[0]

        # Dimensions: (time_steps, num_pitches)
        num_time_steps, num_pitches = onsets.shape

        # Frame time in seconds
        # Model has 32 frames for 17920 samples @ 16kHz = 1.12 seconds
        # So frame_time = 1.12 / 32 = 0.035 seconds per frame
        frame_time = 0.035  # seconds
        nms_frames = max(1, int(nms_window_ms / (frame_time * 1000)))
        max_duration_frames = int(max_duration_ms / (frame_time * 1000))

        notes = []

        # Piano range: MIDI 21-108 (A0-C8, 88 keys)
        midi_offset = 21  # First MIDI note is A0 (21)

        # Build expected pitch index set for score-aware thresholds
        expected_pitch_indices: Set[int] = set()
        if expected_pitches:
            for midi_p in expected_pitches:
                idx = midi_p - midi_offset
                if 0 <= idx < num_pitches:
                    expected_pitch_indices.add(idx)

        # For each pitch
        for pitch_idx in range(num_pitches):
            onset_curve = onsets[:, pitch_idx]
            frame_curve = frames[:, pitch_idx]
            offset_curve = offsets[:, pitch_idx]
            velocity_curve = velocities[:, pitch_idx]

            # Use standard thresholds for main pass (score-aware rescue
            # is handled separately in transcribe() after this method)
            pitch_onset_threshold = onset_threshold
            pitch_frame_threshold = frame_threshold

            # Find onset peaks (note attacks)
            onset_times = np.where(onset_curve > pitch_onset_threshold)[0]

            if len(onset_times) == 0:
                continue

            # Temporal NMS: keep only the strongest onset within each window
            suppressed = set()
            for j in range(len(onset_times)):
                if j in suppressed:
                    continue
                best_idx = j
                best_val = onset_curve[onset_times[j]]
                for k in range(j + 1, len(onset_times)):
                    if onset_times[k] - onset_times[j] > nms_frames:
                        break
                    if onset_curve[onset_times[k]] > best_val:
                        suppressed.add(best_idx)
                        best_idx = k
                        best_val = onset_curve[onset_times[k]]
                    else:
                        suppressed.add(k)

            onset_times = np.array([onset_times[j] for j in range(len(onset_times)) if j not in suppressed])

            if len(onset_times) == 0:
                continue

            # Process each onset
            i = 0
            while i < len(onset_times):
                onset_idx = onset_times[i]
                onset_time = onset_idx * frame_time

                # Find offset using either:
                # 1. Explicit offset prediction OR
                # 2. When frame probability drops below threshold
                offset_idx = onset_idx + 1

                # Look for explicit offset peak
                offset_peaks = np.where(offset_curve[onset_idx:] > pitch_onset_threshold)[0]
                if len(offset_peaks) > 0:
                    offset_idx = onset_idx + offset_peaks[0]
                else:
                    # Use frame probability drop
                    while offset_idx < num_time_steps and frame_curve[offset_idx] > pitch_frame_threshold:
                        offset_idx += 1

                # Cap max duration to prevent runaway artifacts
                if offset_idx - onset_idx > max_duration_frames:
                    offset_idx = onset_idx + max_duration_frames

                offset_time = offset_idx * frame_time
                duration_ms = (offset_time - onset_time) * 1000

                # Filter very short notes
                if duration_ms >= min_duration_ms:
                    # Get velocity from velocity curve
                    velocity = float(velocity_curve[onset_idx])

                    # Get confidence from average frame probability
                    if offset_idx > onset_idx:
                        confidence = float(frame_curve[onset_idx:offset_idx].mean())
                    else:
                        confidence = float(frame_curve[onset_idx])

                    # Convert pitch index to MIDI number
                    midi_pitch = pitch_idx + midi_offset

                    # Filter out notes below C3 (MIDI 48, ~130Hz) to reduce false positives
                    # Low notes are often sub-harmonic artifacts from ML model confusion
                    if midi_pitch < 48:  # C3
                        continue

                    # Convert MIDI to note name
                    note_name = self.midi_to_note(midi_pitch)

                    notes.append(NoteEvent(
                        note=note_name,
                        pitch=midi_pitch,
                        onset_time=onset_time,
                        offset_time=offset_time,
                        velocity=velocity,
                        confidence=confidence,
                        onset_strength=float(onset_curve[onset_idx]),
                    ))

                # Skip to next onset after this note ends
                i += 1
                while i < len(onset_times) and onset_times[i] < offset_idx:
                    i += 1

        # --- Two-pass chord expansion ---
        # At strong onset frames, scan nearby pitches with lower thresholds
        # to catch chord tones the main pass missed.
        # Disabled in score-aware mode — lower thresholds + harmonic protection
        # already handle recall; expansion causes too many false positives
        # when the expected set is large.
        detected_pitch_indices = set(n.pitch - midi_offset for n in notes)
        chord_expansion_notes: List[NoteEvent] = []

        for anchor_note in notes:
            if anchor_note.onset_strength <= 0.3:
                continue

            # Find the frame index for this note's onset
            anchor_frame = int(round(anchor_note.onset_time / frame_time))
            if anchor_frame >= num_time_steps:
                continue

            anchor_freq = 440.0 * (2.0 ** ((anchor_note.pitch - 69) / 12.0))
            anchor_pitch_idx = anchor_note.pitch - midi_offset

            # Scan ±12 semitones around the anchor (one octave)
            scan_lo = max(0, anchor_pitch_idx - 12)
            scan_hi = min(num_pitches, anchor_pitch_idx + 13)

            for candidate_idx in range(scan_lo, scan_hi):
                if candidate_idx == anchor_pitch_idx:
                    continue
                if candidate_idx in detected_pitch_indices:
                    continue

                candidate_midi = candidate_idx + midi_offset
                candidate_is_expected = candidate_idx in expected_pitch_indices

                # Check frame and onset probabilities at the anchor's onset frame
                candidate_frame_prob = float(frames[anchor_frame, candidate_idx])
                candidate_onset_prob = float(onsets[anchor_frame, candidate_idx])

                if expected_pitch_indices:
                    # Score-aware: only expand into expected pitches, with strict thresholds
                    if not candidate_is_expected:
                        continue
                    if candidate_frame_prob <= 0.30 and candidate_onset_prob <= 0.25:
                        continue
                else:
                    # Free mode: expand into any pitch with strong evidence
                    if candidate_frame_prob <= 0.50 and candidate_onset_prob <= 0.25:
                        continue

                # Reject if harmonic (2x-6x) of anchor — unless expected
                if not candidate_is_expected:
                    candidate_freq = 440.0 * (2.0 ** ((candidate_midi - 69) / 12.0))
                    ratio = candidate_freq / anchor_freq if anchor_freq > 0 else 0
                    is_harmonic = False
                    for h in (2, 3, 4, 5, 6):
                        tol = 0.08 if h == 2 else 0.15
                        if abs(ratio - h) < tol:
                            is_harmonic = True
                            break
                    # Also check if anchor is harmonic of candidate (lower pitch)
                    if not is_harmonic and candidate_freq > 0:
                        ratio_inv = anchor_freq / candidate_freq
                        for h in (2, 3, 4, 5, 6):
                            tol = 0.08 if h == 2 else 0.15
                            if abs(ratio_inv - h) < tol:
                                is_harmonic = True
                                break
                    if is_harmonic:
                        continue

                # Find offset: scan forward until frame drops
                eff_frame_th = min(0.15, frame_threshold) if candidate_is_expected else frame_threshold
                off_idx = anchor_frame + 1
                while off_idx < num_time_steps and frames[off_idx, candidate_idx] > eff_frame_th:
                    off_idx += 1

                onset_t = anchor_frame * frame_time
                offset_t = off_idx * frame_time
                dur_ms = (offset_t - onset_t) * 1000
                if dur_ms < 30.0:
                    continue

                # Filter out notes below C3 (MIDI 48) to reduce false positives
                if candidate_midi < 48:
                    continue

                conf = float(frames[anchor_frame:off_idx, candidate_idx].mean()) if off_idx > anchor_frame else candidate_frame_prob
                vel = float(velocities[anchor_frame, candidate_idx])

                chord_expansion_notes.append(NoteEvent(
                    note=self.midi_to_note(candidate_midi),
                    pitch=candidate_midi,
                    onset_time=onset_t,
                    offset_time=offset_t,
                    velocity=vel,
                    confidence=conf,
                    onset_strength=candidate_onset_prob,
                ))
                detected_pitch_indices.add(candidate_idx)

        notes.extend(chord_expansion_notes)

        # --- Frame-based fallback for chord notes ---
        # When multiple notes strike simultaneously (chords), some notes may have
        # weak onset activations but strong sustained frame presence. Add these
        # only if they are NOT harmonics of any pitch with meaningful onset
        # activity (not just detected notes, but any pitch the model responds to).

        # Collect ALL pitches with any meaningful onset or frame activity as
        # candidate fundamentals for the harmonic filter. This prevents adding
        # harmonics of notes that weren't detected (e.g., F#4 has onset=0.2,
        # below threshold, but its harmonic C#6 has strong frames).
        candidate_fundamental_freqs: list = []
        for p_idx in range(num_pitches):
            if onsets[:, p_idx].max() > 0.15 or frames[:, p_idx].max() > 0.5:
                midi_p = p_idx + midi_offset
                candidate_fundamental_freqs.append(
                    440.0 * (2.0 ** ((midi_p - 69) / 12.0))
                )

        frame_fallback_threshold = 0.4
        min_sustained_frames = 1

        for pitch_idx in range(num_pitches):
            if pitch_idx in detected_pitch_indices:
                continue

            is_expected = pitch_idx in expected_pitch_indices

            frame_curve = frames[:, pitch_idx]
            velocity_curve = velocities[:, pitch_idx]

            # Use same frame fallback threshold for all pitches
            # (expected pitches benefit from harmonic protection instead)
            eff_fallback = frame_fallback_threshold

            # Require strong sustained frame presence
            above = frame_curve > eff_fallback
            if not above.any():
                continue

            # Find the first run of min_sustained_frames consecutive frames
            run_start = None
            run_len = 0
            for t_idx in range(num_time_steps):
                if above[t_idx]:
                    if run_start is None:
                        run_start = t_idx
                    run_len += 1
                else:
                    if run_len >= min_sustained_frames:
                        break
                    run_start = None
                    run_len = 0

            if run_start is None or run_len < min_sustained_frames:
                continue

            # Expected pitches with strong frame evidence skip harmonic check
            midi_pitch = pitch_idx + midi_offset

            # Filter out notes below C3 (MIDI 48) to reduce false positives
            if midi_pitch < 48:
                continue

            if not (is_expected and float(frame_curve.max()) > 0.5):
                # Skip if this pitch is a harmonic (2x-6x) of any candidate fundamental
                candidate_freq = 440.0 * (2.0 ** ((midi_pitch - 69) / 12.0))
                is_harmonic = False
                for fund_freq in candidate_fundamental_freqs:
                    if fund_freq >= candidate_freq:
                        continue  # harmonics are always higher
                    ratio = candidate_freq / fund_freq
                    for h in (2, 3, 4, 5, 6):
                        tol = 0.08 if h == 2 else 0.15
                        if abs(ratio - h) < tol:
                            is_harmonic = True
                            break
                    if is_harmonic:
                        break
                if is_harmonic:
                    continue

            onset_time = run_start * frame_time
            offset_idx = run_start + run_len
            while offset_idx < num_time_steps and frame_curve[offset_idx] > frame_threshold:
                offset_idx += 1
            offset_time = offset_idx * frame_time

            confidence = float(frame_curve[run_start:offset_idx].mean())
            velocity = float(velocity_curve[run_start])
            # Frame-fallback notes have weak/no onset peaks by definition.
            # Use only first 1-2 frames to avoid noise spikes inflating the value.
            span = min(offset_idx, run_start + 2)
            onset_str = float(onsets[run_start:span, pitch_idx].max()) if span > run_start else 0.0

            notes.append(NoteEvent(
                note=self.midi_to_note(midi_pitch),
                pitch=midi_pitch,
                onset_time=onset_time,
                offset_time=offset_time,
                velocity=velocity,
                confidence=confidence,
                onset_strength=onset_str,
            ))

        return notes

    def midi_to_note(self, midi_pitch: int) -> str:
        """Convert MIDI pitch number to note name (e.g., 60 -> C4)"""
        note_names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
        octave = (midi_pitch // 12) - 1
        note = note_names[midi_pitch % 12]
        return f"{note}{octave}"

    @staticmethod
    def note_to_midi(note_name: str) -> int:
        """Convert note name to MIDI pitch number (e.g., 'C4' -> 60, 'C#5' -> 73)"""
        note_map = {
            'C': 0, 'C#': 1, 'Db': 1,
            'D': 2, 'D#': 3, 'Eb': 3,
            'E': 4, 'Fb': 4,
            'F': 5, 'F#': 6, 'Gb': 6,
            'G': 7, 'G#': 8, 'Ab': 8,
            'A': 9, 'A#': 10, 'Bb': 10,
            'B': 11, 'Cb': 11,
        }
        # Parse note name and octave
        if len(note_name) >= 2 and note_name[1] in ('#', 'b'):
            pitch_class = note_name[:2]
            octave = int(note_name[2:])
        else:
            pitch_class = note_name[0]
            octave = int(note_name[1:])
        return (octave + 1) * 12 + note_map[pitch_class]

    @staticmethod
    def _filter_harmonics(
        notes: List[NoteEvent],
        time_tolerance: float = 0.5,
        anchor_freqs: Optional[List[float]] = None,
        mode: str = "single_note",
        expected_pitches: Optional[Set[int]] = None,
    ) -> List[NoteEvent]:
        """
        Remove notes that are likely harmonic overtones of lower fundamentals.

        Groups notes within time_tolerance seconds and removes any note whose
        frequency is ~Nx (N=2..6) of a lower note in the group, OR of an
        anchor frequency (e.g. a strong-onset pitch at a window edge that
        wasn't decoded as a full note).

        Args:
            mode: "single_note" (aggressive, default) or "chord_or_song"
                  (onset-aware: keep octave/fifth if the note has strong onset).
            expected_pitches: MIDI pitches from the score — never remove these.
        """
        if len(notes) <= 1 and not anchor_freqs:
            return notes

        anchor_freqs = anchor_freqs or []
        expected_pitches = expected_pitches or set()

        sorted_notes = sorted(notes, key=lambda n: n.onset_time)

        # Group notes that start within time_tolerance of each other
        groups: List[List[NoteEvent]] = []
        current_group = [sorted_notes[0]]
        for note in sorted_notes[1:]:
            if note.onset_time - current_group[0].onset_time < time_tolerance:
                current_group.append(note)
            else:
                groups.append(current_group)
                current_group = [note]
        groups.append(current_group)

        filtered: List[NoteEvent] = []
        for group in groups:
            if len(group) == 1:
                note = group[0]
                # Protect expected pitches with strong evidence from removal
                if (note.pitch in expected_pitches
                        and note.onset_strength > 0.15
                        and note.confidence >= 0.25):
                    filtered.append(note)
                    continue
                # Check against anchor frequencies.
                # In chord_or_song mode, skip octave (h=2) — real octave
                # doublings are common in songs and shouldn't be suppressed.
                note_freq = 440.0 * (2.0 ** ((note.pitch - 69) / 12.0))
                anchor_harmonics = (4, 5, 6) if mode == "chord_or_song" else (2, 3, 4, 5, 6)
                is_anchor_harmonic = False
                for af in anchor_freqs:
                    if af >= note_freq:
                        continue
                    ratio = note_freq / af
                    for h in anchor_harmonics:
                        tol = 0.08 if h == 2 else 0.15
                        if abs(ratio - h) < tol:
                            is_anchor_harmonic = True
                            break
                    if is_anchor_harmonic:
                        break
                if not is_anchor_harmonic:
                    filtered.append(note)
                continue

            # Sort by pitch (lowest first — most likely fundamental)
            by_pitch = sorted(group, key=lambda n: n.pitch)
            kept: List[NoteEvent] = []
            for note in by_pitch:
                # Protect expected pitches with strong evidence
                if (note.pitch in expected_pitches
                        and note.onset_strength > 0.15
                        and note.confidence >= 0.25):
                    kept.append(note)
                    continue

                note_freq = 440.0 * (2.0 ** ((note.pitch - 69) / 12.0))

                # Scan ALL kept notes: separate high-confidence harmonic matches
                # from low-confidence phantom candidates.  Track the harmonic
                # ratio (h) and matching note for octave-specific logic.
                harmonic_of_strong = False
                phantom_candidate = None
                phantom_h = None
                for kept_note in kept:
                    kept_freq = 440.0 * (2.0 ** ((kept_note.pitch - 69) / 12.0))
                    ratio = note_freq / kept_freq
                    for h in (2, 3, 4, 5, 6):
                        # Tighter tolerance for octave (h=2): 0.08 prevents
                        # matching notes 11 semitones apart (ratio 1.89) as
                        # octave harmonics.  Higher harmonics use wider tolerance.
                        tol = 0.08 if h == 2 else 0.15
                        if abs(ratio - h) < tol:
                            if kept_note.confidence >= 0.5:
                                harmonic_of_strong = True
                            elif phantom_candidate is None:
                                phantom_candidate = kept_note
                                phantom_h = h
                            break
                    if harmonic_of_strong:
                        break

                if harmonic_of_strong:
                    pass  # genuinely a harmonic — remove
                elif phantom_candidate is not None:
                    # The note matches a low-confidence "fundamental" as its harmonic.
                    # Check if the fundamental is likely a phantom subharmonic.
                    fundamental_is_phantom = (
                        (phantom_candidate.confidence < 0.15 and note.confidence > 0.3) or
                        (note.confidence > phantom_candidate.confidence * 2 and note.confidence > 0.5)
                    )
                    if fundamental_is_phantom:
                        kept.remove(phantom_candidate)
                        kept.append(note)
                    elif (phantom_h == 2 and
                          note.confidence >= 0.3 and
                          note.confidence >= phantom_candidate.confidence * 0.7):
                        # Genuine octave doubling — both notes are real
                        kept.append(note)
                    # else: treat as normal harmonic — remove
                else:
                    # Not a harmonic of any kept note. Check anchors.
                    # In chord_or_song mode, skip octave/fifth (h=2,3) anchors.
                    anchor_harmonics = (4, 5, 6) if mode == "chord_or_song" else (2, 3, 4, 5, 6)
                    is_anchor_harmonic = False
                    for af in anchor_freqs:
                        if af >= note_freq:
                            continue
                        ratio = note_freq / af
                        for h in anchor_harmonics:
                            tol = 0.08 if h == 2 else 0.15
                            if abs(ratio - h) < tol:
                                is_anchor_harmonic = True
                                break
                        if is_anchor_harmonic:
                            break
                    if not is_anchor_harmonic:
                        kept.append(note)
            filtered.extend(kept if kept else [by_pitch[0]])

        return filtered

    def transcribe(
        self,
        audio: np.ndarray,
        sample_rate: int = 44100,
        onset_threshold: float = 0.3,
        frame_threshold: float = 0.2,
        mode: str = "single_note",
        expected_pitches: Optional[Set[int]] = None,
    ) -> List[NoteEvent]:
        """
        High-level API: transcribe audio to notes.

        Args:
            audio: Audio samples (mono, float32)
            sample_rate: Sample rate of input
            onset_threshold: Onset detection sensitivity (0-1)
            frame_threshold: Frame detection sensitivity (0-1)
            mode: "single_note" (aggressive harmonic filter, default) or
                  "chord_or_song" (onset-aware, keeps octave/fifth with strong onset)
            expected_pitches: Optional set of MIDI pitch numbers from the score.
                When provided, expected pitches are protected from harmonic
                filtering and a rescue pass uses likelihood ratio gating to
                find missed expected notes with high precision.

        Returns:
            List of detected notes with timing (harmonics filtered)
        """
        # Run inference
        frames, onsets, offsets, velocities = self.predict(audio, sample_rate)

        # --- Adaptive threshold adjustment based on signal characteristics ---
        rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))

        # Onset strength distribution: ratio of 90th percentile to median
        onset_data_raw = onsets[0] if len(onsets.shape) == 3 else onsets
        onset_maxes = onset_data_raw.max(axis=1)  # max onset per frame
        onset_median = float(np.median(onset_maxes)) if len(onset_maxes) > 0 else 0.0
        onset_p90 = float(np.percentile(onset_maxes, 90)) if len(onset_maxes) > 0 else 0.0
        onset_ratio = onset_p90 / onset_median if onset_median > 1e-6 else 10.0

        adapted_onset = onset_threshold
        adapted_frame = frame_threshold

        if rms < 0.05:
            # Quiet audio: lower thresholds by 15% to catch soft notes
            adapted_onset *= 0.85
            adapted_frame *= 0.85
        elif rms > 0.3 and onset_ratio < 2.0:
            # Loud but flat onsets: slightly raise to reduce false positives
            adapted_onset *= 1.05
            adapted_frame *= 1.05

        # Clamp to safe ranges
        adapted_onset = max(0.10, min(0.50, adapted_onset))
        adapted_frame = max(0.08, min(0.35, adapted_frame))

        # Decode to note events
        notes = self.decode_predictions(
            frames,
            onsets,
            offsets,
            velocities,
            onset_threshold=adapted_onset,
            frame_threshold=adapted_frame,
            expected_pitches=expected_pitches,
        )

        # --- Score-aware rescue pass (expected-note gating) ---
        # For each expected pitch NOT found by the main pass, check model
        # outputs using likelihood ratio: p_target / (p_other + ε) > threshold.
        # This finds missed notes with high precision (no threshold lowering).
        midi_offset = 21
        onset_data = onsets[0] if len(onsets.shape) == 3 else onsets
        frame_data = frames[0] if len(frames.shape) == 3 else frames

        if expected_pitches:
            detected_midi = set(n.pitch for n in notes)
            missed_expected = expected_pitches - detected_midi
            num_time_steps = frame_data.shape[0]
            num_pitches = frame_data.shape[1]
            frame_time = (17920.0 / 16000.0) / num_time_steps

            for midi_p in missed_expected:
                pitch_idx = midi_p - midi_offset
                if pitch_idx < 0 or pitch_idx >= num_pitches:
                    continue

                # Find best onset frame for this pitch
                onset_curve = onset_data[:, pitch_idx]
                frame_curve = frame_data[:, pitch_idx]

                # Need at least some onset evidence
                best_frame = int(np.argmax(onset_curve))
                p_onset = float(onset_curve[best_frame])
                p_frame = float(frame_curve[best_frame])

                # Minimum evidence bar: need meaningful model activation
                if p_onset < 0.20 and p_frame < 0.25:
                    continue

                # Likelihood ratio: target vs max of non-expected pitches
                # Exclude expected pitches and ±1 semitone from comparison
                exclude = set()
                for ep in expected_pitches:
                    ep_idx = ep - midi_offset
                    for d in (-1, 0, 1):
                        if 0 <= ep_idx + d < num_pitches:
                            exclude.add(ep_idx + d)

                p_other_onset = 0.0
                p_other_frame = 0.0
                for p_idx in range(num_pitches):
                    if p_idx in exclude:
                        continue
                    p_other_onset = max(p_other_onset, float(onset_data[best_frame, p_idx]))
                    p_other_frame = max(p_other_frame, float(frame_data[best_frame, p_idx]))

                # Combined evidence score
                p_target = max(p_onset, p_frame)
                p_other = max(p_other_onset, p_other_frame)
                ratio = p_target / (p_other + 0.01)

                # Accept if strong ratio AND reasonable absolute probability
                if ratio < 2.0 or p_target < 0.20:
                    continue

                # Find offset: scan forward from best_frame
                off_idx = best_frame + 1
                while off_idx < num_time_steps and frame_curve[off_idx] > adapted_frame:
                    off_idx += 1

                onset_t = best_frame * frame_time
                offset_t = off_idx * frame_time
                dur_ms = (offset_t - onset_t) * 1000
                if dur_ms < 30.0:
                    offset_t = onset_t + 0.05  # minimum 50ms

                vel_data = velocities[0] if len(velocities.shape) == 3 else velocities
                conf = float(frame_curve[best_frame:off_idx].mean()) if off_idx > best_frame else p_frame
                vel = float(vel_data[best_frame, pitch_idx])

                notes.append(NoteEvent(
                    note=self.midi_to_note(midi_p),
                    pitch=midi_p,
                    onset_time=onset_t,
                    offset_time=offset_t,
                    velocity=vel,
                    confidence=conf,
                    onset_strength=p_onset,
                ))

        # Compute anchor frequencies: pitches with strong onset AND frame activation
        # (even if not decoded as full notes due to short duration at window edges).
        # Require both onset and frame evidence to avoid phantom subharmonics
        # (which have strong onsets but negligible frame support) acting as anchors.
        anchor_freqs = []
        for p_idx in range(onset_data.shape[1]):
            if onset_data[:, p_idx].max() > adapted_onset and frame_data[:, p_idx].max() > 0.3:
                midi_p = p_idx + midi_offset
                anchor_freqs.append(440.0 * (2.0 ** ((midi_p - 69) / 12.0)))

        # Filter harmonic overtones
        notes = self._filter_harmonics(
            notes, anchor_freqs=anchor_freqs, mode=mode,
            expected_pitches=expected_pitches,
        )

        # Remove noise detections with very low confidence
        # Expected pitches rescued by the gating pass may have lower
        # confidence but were already validated by likelihood ratio.
        if expected_pitches:
            notes = [n for n in notes
                     if n.confidence >= (0.08 if n.pitch in expected_pitches else 0.10)]
        else:
            notes = [n for n in notes if n.confidence >= 0.1]

        return notes


if __name__ == "__main__":
    """Test the model on synthetic audio"""
    print("🧪 Testing Onsets and Frames TFLite Model\n")

    # Create test audio: C major chord (C4 + E4 + G4)
    sample_rate = 16000
    duration = 2.0
    t = np.linspace(0, duration, int(sample_rate * duration))

    # Generate chord
    audio = 0.3 * np.sin(2 * np.pi * 261.6 * t)  # C4
    audio += 0.3 * np.sin(2 * np.pi * 329.6 * t)  # E4
    audio += 0.3 * np.sin(2 * np.pi * 392.0 * t)  # G4

    # Initialize model
    model = OnsetsFramesTFLite("onsets_frames_wavinput.tflite")

    # Transcribe
    print("\n🎵 Transcribing C major chord (C4 + E4 + G4)...\n")
    notes = model.transcribe(audio, sample_rate=sample_rate)

    # Display results
    if notes:
        print(f"✅ Detected {len(notes)} notes:\n")
        for note in notes:
            print(f"   {note.note:<4} | "
                  f"Start: {note.onset_time:>5.2f}s | "
                  f"Duration: {(note.offset_time - note.onset_time)*1000:>6.1f}ms | "
                  f"Confidence: {note.confidence:.2f}")
    else:
        print("❌ No notes detected")

    print("\n" + "=" * 60)
    print("Model ready for integration!")
