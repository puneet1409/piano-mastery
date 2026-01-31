#!/usr/bin/env python3
"""
Simple test server for Piano Mastery note detection.
This is a minimal implementation that simulates note detection for testing the UI.
"""

import json
import asyncio
import random
import math
import os
from typing import Dict, Optional
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
import sys
import numpy as np

try:
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("ERROR: FastAPI or uvicorn not installed.")
    print("Install with: pip3 install fastapi uvicorn --break-system-packages")
    print("Or: sudo apt install python3-fastapi python3-uvicorn")
    sys.exit(1)

# Import optimized pitch detection
try:
    from optimized_yin import detect_piano_note
    PITCH_DETECTION_METHOD = "optimized_yin"
    print("[OK] Using OPTIMIZED YIN algorithm for professional piano pitch detection")
except ImportError as e:
    print(f"[!] Warning: Could not import optimized YIN pitch detection: {e}")
    print("  Falling back to basic YIN")
    try:
        from yin_pitch_detection import detect_note as yin_detect_note
        PITCH_DETECTION_METHOD = "yin"
        print("[OK] Using basic YIN algorithm")
    except ImportError:
        print("  Falling back to basic method (not recommended)")
        PITCH_DETECTION_METHOD = "basic"

# Import score follower
try:
    from score_follower import ScoreFollower, create_c_major_scale, create_simple_melody
    SCORE_FOLLOWER_AVAILABLE = True
    print("[OK] Score-aware detection (cheat code) available")
except ImportError as e:
    SCORE_FOLLOWER_AVAILABLE = False
    print(f"[!] Score follower not available: {e}")

# Import chord detection
try:
    from polyphonic_detector import PolyphonicDetector
    from chord_score_follower import ChordScoreFollower, create_basic_chords_exercise, create_c_major_intervals
    CHORD_DETECTION_AVAILABLE = True
    print("[OK] Polyphonic chord detection available")
except ImportError as e:
    CHORD_DETECTION_AVAILABLE = False
    print(f"[!] Chord detection not available: {e}")

# Import beat-aware score following (MIDI)
try:
    from beat_score_follower import BeatAwareScoreFollower
    from midi_exercise import load_midi_exercise, MIDO_AVAILABLE
    from finger_assignment import assign_fingers_to_groups
    BEAT_SCORE_AVAILABLE = bool(MIDO_AVAILABLE)
    if BEAT_SCORE_AVAILABLE:
        print("[OK] Beat-aware score following available")
    else:
        print("[!] Beat-aware score following unavailable (mido not installed)")
except ImportError as e:
    BEAT_SCORE_AVAILABLE = False
    def assign_fingers_to_groups(groups, hands="both"):
        return groups  # No-op fallback
    print(f"[!] Beat-aware score following not available: {e}")

# Import velocity_to_dynamic separately - pure Python, no ML dependency
try:
    from nuance_analyzer import velocity_to_dynamic
except ImportError:
    def velocity_to_dynamic(velocity: float) -> str:
        """Inline fallback when nuance_analyzer is unavailable."""
        if velocity < 0.25: return "pp"
        if velocity < 0.45: return "p"
        if velocity < 0.65: return "mf"
        if velocity < 0.85: return "f"
        return "ff"

# Import new pipeline components
try:
    from onset_detector import OnsetDetector, OnsetEvent
    from audio_buffer_manager import AudioBufferManager
    from nuance_analyzer import NuanceAnalyzer, ExpressionReport
    from onsets_frames_tflite import OnsetsFramesTFLite
    PIPELINE_AVAILABLE = True
    print("[OK] Full detection pipeline available (onset + ML + nuance)")
except ImportError as e:
    PIPELINE_AVAILABLE = False
    print(f"[!] Detection pipeline not fully available: {e}")


@dataclass
class SessionState:
    """Per-session state for the detection pipeline."""
    onset_detector: Optional[object] = None
    buffer_manager: Optional[object] = None
    nuance_analyzer: Optional[object] = None
    ml_model: Optional[object] = None
    window_count: int = 0


# Thread pool for non-blocking ML inference
ml_executor = ThreadPoolExecutor(max_workers=2)

app = FastAPI(title="Piano Mastery Test Server")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store active connections and score followers
connections: Dict[str, WebSocket] = {}
score_followers: Dict[str, ScoreFollower] = {}  # session_id -> ScoreFollower (single notes)
chord_followers: Dict[str, ChordScoreFollower] = {}  # session_id -> ChordScoreFollower (chords)
beat_followers: Dict[str, BeatAwareScoreFollower] = {}  # session_id -> BeatAwareScoreFollower
session_states: Dict[str, SessionState] = {}  # session_id -> pipeline state
count_in_timeouts: Dict[str, asyncio.Task] = {}  # session_id -> timeout task
polyphonic_detector = PolyphonicDetector(sample_rate=44100) if CHORD_DETECTION_AVAILABLE else None

# Shared ML model (loaded once, thread-safe for inference)
_shared_ml_model = None  # Type: Optional[OnsetsFramesTFLite] when available


def _get_ml_model():
    """Lazy-load the shared ML model."""
    global _shared_ml_model
    if _shared_ml_model is None and PIPELINE_AVAILABLE:
        try:
            _shared_ml_model = OnsetsFramesTFLite("onsets_frames_wavinput.tflite")
            print("[OK] Loaded shared Onsets & Frames ML model")
        except Exception as e:
            print(f"[X] Failed to load ML model: {e}")
    return _shared_ml_model


def _resolve_perfect_midi_path() -> str:
    default_path = os.path.join(
        os.path.dirname(__file__),
        "test_songs",
        "perfect",
        "ed-sheeran---perfect-easy-for-beginners.mid",
    )
    return os.environ.get("PERFECT_MIDI_PATH", default_path)


def _scan_downloaded_songs() -> list:
    """Scan test_songs directory for all available MIDI files.

    Returns a list of exercise dicts for each discovered song.
    """
    exercises = []
    test_songs_dir = os.path.join(os.path.dirname(__file__), "test_songs")

    if not os.path.exists(test_songs_dir):
        return exercises

    # Song metadata (display names, polyphony requirements)
    SONG_META = {
        "ajeeb_daastaan": {"name": "Ajeeb Daastaan Hai Yeh", "polyphony": False},
        "canon_in_d": {"name": "Canon in D - Pachelbel", "polyphony": True},
        "fur_elise": {"name": "Fur Elise - Beethoven", "polyphony": True},
        "moonlight_sonata": {"name": "Moonlight Sonata - Beethoven", "polyphony": True},
        "ode_to_joy": {"name": "Ode to Joy - Beethoven", "polyphony": False},
        "pal_pal_dil_ke_paas": {"name": "Pal Pal Dil Ke Paas", "polyphony": False},
        "perfect": {"name": "Perfect - Ed Sheeran", "polyphony": True},
        "twinkle": {"name": "Twinkle Twinkle Little Star", "polyphony": False},
        "yeh_shaam_mastani": {"name": "Yeh Shaam Mastani", "polyphony": False},
    }

    # Difficulty mapping from filename patterns
    def get_difficulty(filename: str) -> str:
        lower = filename.lower()
        if "beginner" in lower or "easy" in lower:
            return "beginner"
        elif "advanced" in lower:
            return "advanced"
        elif "musescore" in lower:
            return "intermediate"
        return "intermediate"

    def get_display_name(song_folder: str, filename: str, difficulty: str) -> str:
        base_name = SONG_META.get(song_folder, {}).get("name", song_folder.replace("_", " ").title())
        diff_label = difficulty.title()
        return f"{base_name} ({diff_label})"

    # Scan each song folder
    for folder_name in sorted(os.listdir(test_songs_dir)):
        folder_path = os.path.join(test_songs_dir, folder_name)
        if not os.path.isdir(folder_path):
            continue

        # Find MIDI files in this folder
        for filename in sorted(os.listdir(folder_path)):
            if not filename.endswith(".mid"):
                continue

            midi_path = os.path.join(folder_path, filename)
            difficulty = get_difficulty(filename)
            display_name = get_display_name(folder_name, filename, difficulty)
            requires_polyphony = SONG_META.get(folder_name, {}).get("polyphony", True)

            # Create unique ID from folder and filename
            exercise_id = f"{folder_name}_{filename.replace('.mid', '')}"

            exercises.append({
                "id": exercise_id,
                "name": display_name,
                "description": f"MIDI: {folder_name}/{filename}",
                "difficulty": difficulty,
                "type": "beat_score",
                "requiresPolyphony": requires_polyphony,
                "expectedVoices": 2 if requires_polyphony else 1,
                "available": True,
                "midi_path": midi_path,
                "folder": folder_name,
            })

    return exercises


def _load_perfect_exercise(hands: str = "both"):
    midi_path = _resolve_perfect_midi_path()
    exercise = load_midi_exercise(
        midi_path=midi_path,
        name="Perfect - Ed Sheeran (Easy, 6/8)",
        bpm_override=None,
        hands=hands,
    )
    # Assign finger numbers to each group
    assign_fingers_to_groups(exercise.groups, hands=hands)
    return exercise


def _load_midi_exercise_by_path(midi_path: str, name: str, hands: str = "both"):
    """Load any MIDI exercise by path."""
    exercise = load_midi_exercise(
        midi_path=midi_path,
        name=name,
        bpm_override=None,
        hands=hands,
    )
    # Assign finger numbers to each group
    assign_fingers_to_groups(exercise.groups, hands=hands)
    return exercise


# Cache for scanned songs (avoid rescanning on each request)
_scanned_songs_cache: Optional[list] = None


def _get_scanned_songs() -> list:
    """Get cached list of scanned songs."""
    global _scanned_songs_cache
    if _scanned_songs_cache is None:
        _scanned_songs_cache = _scan_downloaded_songs()
    return _scanned_songs_cache


def _find_exercise_by_id(exercise_id: str) -> Optional[dict]:
    """Find a scanned exercise by its ID."""
    for exercise in _get_scanned_songs():
        if exercise["id"] == exercise_id:
            return exercise
    return None


COUNT_IN_TIMEOUT_SEC = 6.0  # Auto-start timing if count_in_complete never arrives


async def _count_in_timeout(session_id: str, websocket: WebSocket):
    """Auto-start timing clock after COUNT_IN_TIMEOUT_SEC if count_in_complete never arrives."""
    try:
        await asyncio.sleep(COUNT_IN_TIMEOUT_SEC)
        follower = beat_followers.get(session_id)
        if follower and follower.exercise.start_time is None:
            follower.start()
            print(f"[!] Count-in timeout ({COUNT_IN_TIMEOUT_SEC}s) - auto-started timing for session {session_id}")
            try:
                await websocket.send_json({
                    "type": "timing_started",
                    "data": {"message": "GO! (auto-start)"},
                    "timestamp": "2025-01-24T00:00:00Z"
                })
            except Exception:
                pass  # WebSocket may have closed
    except asyncio.CancelledError:
        pass  # Normal: count_in_complete arrived and cancelled us
    finally:
        count_in_timeouts.pop(session_id, None)


def _run_ml_inference(ml_model, audio_window: np.ndarray, sample_rate: int, expected_pitches=None):
    """Run ML inference in a thread (called from ThreadPoolExecutor)."""
    return ml_model.transcribe(audio_window, sample_rate=sample_rate, expected_pitches=expected_pitches)


def analyze_audio_chunk(samples: list, sample_rate: int = 44100) -> dict:
    """
    Analyze audio chunk and detect musical notes.
    Uses OPTIMIZED YIN algorithm - specifically tuned for piano detection.
    """
    if not samples or len(samples) < 100:
        return None

    # Use OPTIMIZED YIN algorithm (professional piano pitch detection)
    if PITCH_DETECTION_METHOD == "optimized_yin":
        try:
            result = detect_piano_note(samples, sample_rate)
            if result:
                print(f"# OPTIMIZED YIN DETECTED: {result['note']} @ {result['frequency']:.1f}Hz "
                      f"(confidence: {result['confidence']:.2%}, RMS: {result['rms']:.4f})")
            return result
        except Exception as e:
            print(f"Optimized YIN detection error: {e}")
            import traceback
            traceback.print_exc()
            return None

    # Fallback to basic YIN
    elif PITCH_DETECTION_METHOD == "yin":
        try:
            result = yin_detect_note(samples, sample_rate)
            if result:
                print(f"# BASIC YIN DETECTED: {result['note']} @ {result['frequency']:.1f}Hz "
                      f"(confidence: {result['confidence']:.2%}, RMS: {result['rms']:.4f})")
            return result
        except Exception as e:
            print(f"YIN detection error: {e}")
            import traceback
            traceback.print_exc()
            return None

    else:
        # Fallback to old method (not recommended)
        print("[!] Using fallback detection method - not accurate!")
        return analyze_audio_chunk_old(samples, sample_rate)

# Simulated note detection - detect random notes from incoming audio
NOTES = ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4",
         "C5", "C#5", "D5", "D#5", "E5", "F5", "F#5", "G5", "G#5", "A5", "A#5", "B5"]


def analyze_audio_chunk_old(samples: list, sample_rate: int = 44100) -> dict:
    """
    Basic audio analysis with simple pitch detection.

    Uses autocorrelation for pitch detection - more accurate than random.
    For production, use librosa or aubio for better results.
    """
    # Check if audio has sufficient energy (volume)
    if not samples or len(samples) < 100:
        return None

    # Calculate RMS (volume level)
    rms = sum(abs(s) for s in samples) / len(samples)

    # Debug: Print volume level
    if rms > 0.001:  # Log if there's any audio activity
        print(f"Audio received: RMS={rms:.6f}, samples={len(samples)}")

    # If volume is too low, no note detected
    if rms < 0.01:  # Threshold for noise
        if rms > 0.001:
            print(f"  -> Too quiet (threshold: 0.01)")
        return None

    # Simple autocorrelation-based pitch detection
    try:
        # Convert to numpy-like operations (without numpy)
        # Find peaks in autocorrelation

        # Estimate fundamental frequency using zero-crossing rate
        # This is a simplified approach
        zero_crossings = sum(1 for i in range(1, len(samples))
                           if samples[i] * samples[i-1] < 0)

        print(f"  -> Zero crossings: {zero_crossings}")

        if zero_crossings == 0:
            print(f"  -> No zero crossings detected")
            return None

        # Estimate frequency from zero crossings
        estimated_freq = (zero_crossings * sample_rate) / (2 * len(samples))
        print(f"  -> Estimated frequency: {estimated_freq:.2f} Hz")

        # Only detect frequencies in piano range (27.5 Hz to 4186 Hz)
        if estimated_freq < 27.5 or estimated_freq > 4186:
            print(f"  -> Out of piano range (27.5-4186 Hz)")
            return None

        # Find closest note to the detected frequency
        note = frequency_to_note(estimated_freq)
        print(f"  -> Mapped to note: {note}")

        if note:
            # Calculate confidence based on volume and frequency stability
            confidence = min(0.95, 0.5 + (rms * 10))  # Volume-based confidence

            print(f"  [OK] DETECTED: {note} @ {estimated_freq:.1f}Hz (confidence: {confidence:.2f})")

            return {
                "note": note,
                "frequency": estimated_freq,
                "confidence": confidence,
                "rms": rms
            }
    except Exception as e:
        print(f"Pitch detection error: {e}")
        import traceback
        traceback.print_exc()

    return None


def frequency_to_note(frequency: float) -> str:
    """
    Convert frequency in Hz to the nearest note name.
    Uses A4 = 440 Hz as reference.
    """
    if frequency <= 0:
        return None

    # Calculate semitones from A4 (440 Hz)
    semitones_from_a4 = 12 * (math.log2(frequency / 440.0))

    # Round to nearest semitone
    semitone = round(semitones_from_a4)

    # Calculate octave and note
    note_in_octave = semitone % 12
    octave = 4 + (semitone + 9) // 12  # A4 is our reference

    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    note_name = note_names[note_in_octave]

    # Ensure octave is in valid piano range (0-8)
    if octave < 0 or octave > 8:
        return None

    return f"{note_name}{octave}"


def get_note_frequency(note: str) -> float:
    """Convert note name to frequency in Hz"""
    # A4 = 440 Hz
    note_offsets = {
        "C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4,
        "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2
    }

    note_name = note[:-1]
    octave = int(note[-1])

    # A4 is octave 4
    semitones_from_a4 = note_offsets.get(note_name, 0) + (octave - 4) * 12
    frequency = 440 * (2 ** (semitones_from_a4 / 12))

    return round(frequency, 2)


def analyze_audio_chunk_polyphonic(samples: list, sample_rate: int = 44100) -> dict:
    """
    Analyze audio chunk for polyphonic detection (multiple simultaneous notes).
    Used for chord recognition.
    """
    if not samples or len(samples) < 2048:
        return None

    if not CHORD_DETECTION_AVAILABLE or not polyphonic_detector:
        return None

    try:
        # Use polyphonic detector
        result = polyphonic_detector.detect_from_samples(samples)

        if result.notes and len(result.notes) > 0:
            # Return chord detection result
            chord_data = {
                "notes": [n.note for n in result.notes],
                "frequencies": [n.frequency for n in result.notes],
                "confidences": [n.confidence for n in result.notes],
                "avg_confidence": sum(n.confidence for n in result.notes) / len(result.notes),
                "is_chord": result.is_chord,
                "num_notes": len(result.notes)
            }

            print(f"# POLYPHONIC DETECTED: {' + '.join(chord_data['notes'])} "
                  f"(avg confidence: {chord_data['avg_confidence']:.2%})")

            return chord_data

    except Exception as e:
        print(f"Polyphonic detection error: {e}")
        import traceback
        traceback.print_exc()

    return None


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "server": "Piano Mastery Test Server",
        "active_sessions": len(connections),
        "active_single_note_exercises": len(score_followers),
        "active_chord_exercises": len(chord_followers),
        "active_beat_exercises": len(beat_followers),
        "score_follower_available": SCORE_FOLLOWER_AVAILABLE,
        "beat_score_available": BEAT_SCORE_AVAILABLE,
        "chord_detection_available": CHORD_DETECTION_AVAILABLE
    }


@app.get("/exercises")
async def list_exercises():
    """List available exercises"""
    if not SCORE_FOLLOWER_AVAILABLE and not CHORD_DETECTION_AVAILABLE:
        return {"error": "No exercises available"}

    exercises = [
        {
            "id": "c_major_scale",
            "name": "C Major Scale (One Octave)",
            "description": "Play C4 through C5 (single notes)",
            "notes": ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"],
            "difficulty": "beginner",
            "type": "single_note",
            "requiresPolyphony": False,  # YIN is sufficient
            "expectedVoices": 1,
            "available": True,
        },
        {
            "id": "twinkle_twinkle",
            "name": "Twinkle Twinkle Little Star",
            "description": "First line of the melody (single notes)",
            "notes": ["C4", "C4", "G4", "G4", "A4", "A4", "G4"],
            "difficulty": "beginner",
            "type": "single_note",
            "requiresPolyphony": False,  # YIN is sufficient
            "expectedVoices": 1,
            "available": True,
        }
    ]

    # Add all downloaded songs from test_songs directory
    if BEAT_SCORE_AVAILABLE:
        downloaded_songs = _get_scanned_songs()
        exercises.extend(downloaded_songs)

    # Add chord exercises if available
    if CHORD_DETECTION_AVAILABLE:
        exercises.extend([
            {
                "id": "basic_chords",
                "name": "Basic Chords (C-F-G-C)",
                "description": "Play chord progression: C major, F major, G major, C major",
                "chords": [
                    ["C4", "E4", "G4"],
                    ["F4", "A4", "C5"],
                    ["G4", "B4", "D5"],
                    ["C4", "E4", "G4"]
                ],
                "difficulty": "intermediate",
                "type": "chord",
                "requiresPolyphony": True,  # Chords = need polyphonic detection
                "expectedVoices": 1,
                "available": True,
            },
            {
                "id": "c_major_intervals",
                "name": "C Major Intervals",
                "description": "Play 2-note intervals in C major",
                "chords": [
                    ["C4", "E4"],
                    ["E4", "G4"],
                    ["G4", "C5"]
                ],
                "difficulty": "beginner",
                "type": "chord",
                "requiresPolyphony": True,  # Intervals = need polyphonic detection
                "expectedVoices": 1,
                "available": True,
            }
        ])

    return {"exercises": exercises}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time audio streaming and note detection"""
    await websocket.accept()
    connections[session_id] = websocket

    # Initialize per-session detection pipeline
    if PIPELINE_AVAILABLE:
        state = SessionState(
            onset_detector=OnsetDetector(sample_rate=44100),
            buffer_manager=AudioBufferManager(sample_rate=44100),
            nuance_analyzer=NuanceAnalyzer(bpm=120.0),
            ml_model=_get_ml_model(),
        )
        session_states[session_id] = state
        print(f"[OK] Session {session_id} connected (full pipeline)")
    else:
        print(f"[OK] Session {session_id} connected (legacy mode)")

    try:
        # Send session started event
        await websocket.send_json({
            "type": "session_started",
            "data": {
                "session_id": session_id,
                "message": "Connected to Piano Mastery Test Server",
                "pipeline_available": PIPELINE_AVAILABLE
            },
            "timestamp": "2025-01-24T00:00:00Z"
        })

        # Process incoming audio chunks
        while True:
            data = await websocket.receive_text()
            event = json.loads(data)

            if event.get("type") == "audio_chunk":
                # Extract audio samples
                samples = event.get("data", {}).get("samples", [])
                sample_rate = event.get("data", {}).get("sample_rate", 44100)

                # Check if this session is in chord mode or single-note mode
                chord_follower = chord_followers.get(session_id)
                beat_follower = beat_followers.get(session_id)
                single_note_follower = score_followers.get(session_id)

                if chord_follower:
                    # CHORD MODE - Use polyphonic detection
                    chord_detection = analyze_audio_chunk_polyphonic(samples, sample_rate)

                    if chord_detection and chord_detection['num_notes'] > 0:
                        # Process chord with chord score follower
                        result = chord_follower.process_chord_detection(
                            chord_detection['notes'],
                            chord_detection['frequencies'],
                            chord_detection['avg_confidence']
                        )

                        # Send chord detected event
                        await websocket.send_json({
                            "type": "chord_detected",
                            "data": {
                                "notes": chord_detection['notes'],
                                "frequencies": chord_detection['frequencies'],
                                "confidence": chord_detection['avg_confidence'],
                                "matched_expected": result['matched'],
                                "feedback": result['feedback'],
                                "action": result['action'],
                                "is_chord": chord_detection['is_chord']
                            },
                            "timestamp": "2025-01-24T00:00:00Z"
                        })

                        print(f"# {result['feedback']} (action: {result['action']})")

                        # Send progress update if chord was accepted
                        if result['matched']:
                            progress = chord_follower.get_progress()
                            await websocket.send_json({
                                "type": "exercise_progress",
                                "data": progress,
                                "timestamp": "2025-01-24T00:00:00Z"
                            })

                            # Check if exercise completed
                            if progress['completed']:
                                await websocket.send_json({
                                    "type": "exercise_complete",
                                    "data": {
                                        "message": " Chord exercise completed!",
                                        "correct": progress['correct'],
                                        "partial": progress['partial'],
                                        "total": progress['total'],
                                        "accuracy": progress['completion_percent']
                                    },
                                    "timestamp": "2025-01-24T00:00:00Z"
                                })

                elif beat_follower:
                    # BEAT-AWARE MODE - Prefer ML polyphonic detection
                    follower = beat_follower
                    state = session_states.get(session_id)

                    if state and state.buffer_manager and state.ml_model:
                        audio_arr = np.array(samples, dtype=np.float32)
                        window = state.buffer_manager.add_chunk(audio_arr)
                        if window is not None:
                            expected_midi_set = set()
                            for note_name in follower.get_current_expected_notes():
                                try:
                                    expected_midi_set.add(OnsetsFramesTFLite.note_to_midi(note_name))
                                except (KeyError, ValueError):
                                    pass

                            loop = asyncio.get_event_loop()
                            try:
                                note_events = await loop.run_in_executor(
                                    ml_executor,
                                    _run_ml_inference,
                                    state.ml_model,
                                    window,
                                    sample_rate,
                                    expected_midi_set or None,
                                )
                                window_offset = state.buffer_manager.last_window_start_s
                                unique_notes = state.buffer_manager.consensus_notes(
                                    note_events, window_offset
                                )

                                for n in unique_notes:
                                    freq = 440.0 * (2.0 ** ((n.pitch - 69) / 12.0))
                                    result = follower.process_detection(
                                        n.note, freq, n.confidence
                                    )
                                    # Resolve hand from matched group
                                    group_hand = None
                                    if result["matched"] and "group_position" in result:
                                        gpos = result["group_position"] - 1
                                        if 0 <= gpos < len(follower.exercise.groups):
                                            group_hand = getattr(follower.exercise.groups[gpos], "hand", None)
                                    # Resolve dynamic from velocity
                                    note_dynamic = velocity_to_dynamic(n.velocity)
                                    await websocket.send_json({
                                        "type": "note_detected",
                                        "data": {
                                            "note": n.note,
                                            "frequency": freq,
                                            "confidence": n.confidence,
                                            "matched_expected": result["matched"],
                                            "feedback": result["feedback"],
                                            "action": result["action"],
                                            "timing_status": result.get("timing_status"),
                                            "timing_error_ms": result.get("timing_error_ms"),
                                            "velocity": n.velocity,
                                            "dynamic": note_dynamic,
                                            "hand": group_hand,
                                            "group_position": result.get("group_position"),
                                        },
                                        "timestamp": "2025-01-24T00:00:00Z"
                                    })

                                    if result["matched"]:
                                        progress = follower.get_progress()
                                        await websocket.send_json({
                                            "type": "exercise_progress",
                                            "data": progress,
                                            "timestamp": "2025-01-24T00:00:00Z"
                                        })

                                        # Gap 5: adaptive tempo at bar boundaries
                                        new_mult = follower.adjust_tempo()
                                        if new_mult is not None:
                                            await websocket.send_json({
                                                "type": "tempo_change",
                                                "data": {
                                                    "bpm": follower.current_tempo_bpm,
                                                    "tempo_multiplier": new_mult,
                                                },
                                                "timestamp": "2025-01-24T00:00:00Z"
                                            })

                                        if progress["completed"]:
                                            await websocket.send_json({
                                                "type": "exercise_complete",
                                                "data": {
                                                    "message": " Exercise completed!",
                                                    "correct": progress["correct"],
                                                    "total": progress["total"],
                                                    "accuracy": progress["completion_percent"]
                                                },
                                                "timestamp": "2025-01-24T00:00:00Z"
                                            })
                            except Exception as e:
                                print(f"ML beat-exercise inference error: {e}")
                    else:
                        # Fallback to monophonic detection (lower quality)
                        detection = analyze_audio_chunk(samples, sample_rate)
                        if detection:
                            result = follower.process_detection(
                                detection["note"],
                                detection["frequency"],
                                detection["confidence"]
                            )
                            detection["matched_expected"] = result["matched"]
                            detection["feedback"] = result["feedback"]
                            detection["action"] = result["action"]
                            detection["timing_status"] = result.get("timing_status")
                            detection["timing_error_ms"] = result.get("timing_error_ms")
                            # Add hand from matched group
                            if result["matched"] and "group_position" in result:
                                gpos = result["group_position"] - 1
                                if 0 <= gpos < len(follower.exercise.groups):
                                    detection["hand"] = getattr(follower.exercise.groups[gpos], "hand", None)

                            await websocket.send_json({
                                "type": "note_detected",
                                "data": detection,
                                "timestamp": "2025-01-24T00:00:00Z"
                            })

                            if result["matched"]:
                                progress = follower.get_progress()
                                await websocket.send_json({
                                    "type": "exercise_progress",
                                    "data": progress,
                                    "timestamp": "2025-01-24T00:00:00Z"
                                })
                                if progress["completed"]:
                                    await websocket.send_json({
                                        "type": "exercise_complete",
                                        "data": {
                                            "message": " Exercise completed!",
                                            "correct": progress["correct"],
                                            "total": progress["total"],
                                            "accuracy": progress["completion_percent"]
                                        },
                                        "timestamp": "2025-01-24T00:00:00Z"
                                    })

                elif single_note_follower:
                    # SINGLE NOTE MODE - Use monophonic detection
                    detection = analyze_audio_chunk(samples, sample_rate)
                    follower = single_note_follower

                    if detection and SCORE_FOLLOWER_AVAILABLE:
                        # Use score-aware detection ("cheat code")
                        result = follower.process_detection(
                            detection['note'],
                            detection['frequency'],
                            detection['confidence']
                        )

                        # Adjust confidence based on score matching
                        detection['confidence'] = result['adjust_confidence']
                        detection['matched_expected'] = result['matched']
                        detection['feedback'] = result['feedback']
                        detection['action'] = result['action']

                        # Add progress if available
                        if 'progress' in result:
                            detection['progress'] = result['progress']

                        # Send note detected event with score awareness
                        await websocket.send_json({
                            "type": "note_detected",
                            "data": detection,
                            "timestamp": "2025-01-24T00:00:00Z"
                        })

                        print(f"# {result['feedback']} @ {detection['frequency']:.1f}Hz "
                              f"(confidence: {detection['confidence']:.2%}, action: {result['action']})")

                        # Send progress update
                        if result['matched']:
                            progress = follower.get_progress()
                            await websocket.send_json({
                                "type": "exercise_progress",
                                "data": progress,
                                "timestamp": "2025-01-24T00:00:00Z"
                            })

                            # Check if exercise completed
                            if progress['completed']:
                                await websocket.send_json({
                                    "type": "exercise_complete",
                                    "data": {
                                        "message": " Exercise completed!",
                                        "correct": progress['correct'],
                                        "total": progress['total'],
                                        "accuracy": progress['completion_percent']
                                    },
                                    "timestamp": "2025-01-24T00:00:00Z"
                                })

                    # ML-augmented exercise path: feed buffer and run ML
                    # with expected pitches when a window fills up
                    state = session_states.get(session_id)
                    if state and state.buffer_manager and state.ml_model and SCORE_FOLLOWER_AVAILABLE:
                        audio_arr = np.array(samples, dtype=np.float32)
                        window = state.buffer_manager.add_chunk(audio_arr)
                        if window is not None:
                            # Extract expected MIDI pitches from score follower
                            expected_midi_set = set()
                            for en in follower.get_current_expected_notes():
                                try:
                                    expected_midi_set.add(OnsetsFramesTFLite.note_to_midi(en.note))
                                except (KeyError, ValueError):
                                    pass

                            if expected_midi_set:
                                loop = asyncio.get_event_loop()
                                try:
                                    note_events = await loop.run_in_executor(
                                        ml_executor,
                                        _run_ml_inference,
                                        state.ml_model,
                                        window,
                                        sample_rate,
                                        expected_midi_set,
                                    )
                                    window_offset = state.buffer_manager.last_window_start_s
                                    unique_notes = state.buffer_manager.consensus_notes(
                                        note_events, window_offset
                                    )

                                    # Process ML-detected notes through score follower
                                    for n in unique_notes:
                                        freq = 440.0 * (2.0 ** ((n.pitch - 69) / 12.0))
                                        ml_result = follower.process_detection(
                                            n.note, freq, n.confidence
                                        )
                                        if ml_result['matched']:
                                            print(f"# ML-EXERCISE: {ml_result['feedback']}")
                                            progress = follower.get_progress()
                                            await websocket.send_json({
                                                "type": "exercise_progress",
                                                "data": progress,
                                                "timestamp": "2025-01-24T00:00:00Z"
                                            })
                                            if progress['completed']:
                                                await websocket.send_json({
                                                    "type": "exercise_complete",
                                                    "data": {
                                                        "message": " Exercise completed!",
                                                        "correct": progress['correct'],
                                                        "total": progress['total'],
                                                        "accuracy": progress['completion_percent']
                                                    },
                                                    "timestamp": "2025-01-24T00:00:00Z"
                                                })
                                except Exception as e:
                                    print(f"ML exercise inference error: {e}")

                    elif detection and not SCORE_FOLLOWER_AVAILABLE:
                        # No active exercise - blind detection (old way)
                        await websocket.send_json({
                            "type": "note_detected",
                            "data": detection,
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                        print(f"# Detected: {detection['note']} ({detection['confidence']:.2%} confidence)")

                else:
                    # RAW DETECTION MODE - Dual-path pipeline for calibration/free play
                    state = session_states.get(session_id)
                    audio_arr = np.array(samples, dtype=np.float32)

                    if state and state.onset_detector and state.buffer_manager:
                        # === FAST PATH: Onset detection (<20ms) ===
                        onset_event = state.onset_detector.process_chunk(audio_arr)
                        if onset_event:
                            await websocket.send_json({
                                "type": "note_onset",
                                "data": {
                                    "timestamp": onset_event.timestamp,
                                    "strength": onset_event.strength,
                                    "register": onset_event.register
                                },
                                "timestamp": "2025-01-24T00:00:00Z"
                            })

                        # === ACCURATE PATH: ML inference when buffer full ===
                        window = state.buffer_manager.add_chunk(audio_arr)
                        if window is not None and state.ml_model:
                            window_offset = state.buffer_manager.last_window_start_s
                            state.window_count += 1

                            # Run ML inference in thread pool (non-blocking)
                            loop = asyncio.get_event_loop()
                            try:
                                note_events = await loop.run_in_executor(
                                    ml_executor,
                                    _run_ml_inference,
                                    state.ml_model,
                                    window,
                                    sample_rate
                                )

                                # Consensus merge across overlapping windows
                                unique_notes = state.buffer_manager.consensus_notes(
                                    note_events, window_offset
                                )

                                if unique_notes:
                                    # Send accurate note detections
                                    await websocket.send_json({
                                        "type": "note_detected",
                                        "data": {
                                            "notes": [n.note for n in unique_notes],
                                            "pitches": [n.pitch for n in unique_notes],
                                            "onsets": [n.onset_time for n in unique_notes],
                                            "velocities": [n.velocity for n in unique_notes],
                                            "confidences": [n.confidence for n in unique_notes],
                                            "window": state.window_count
                                        },
                                        "timestamp": "2025-01-24T00:00:00Z"
                                    })

                                    notes_str = ' + '.join(n.note for n in unique_notes)
                                    print(f"# ML DETECTED: {notes_str} (window {state.window_count})")

                                    # === EXPRESSION PATH: Nuance analysis ===
                                    if state.nuance_analyzer and len(unique_notes) >= 2:
                                        report = state.nuance_analyzer.analyze(unique_notes)
                                        await websocket.send_json({
                                            "type": "expression_feedback",
                                            "data": {
                                                "summary": report.summary,
                                                "timing_accuracy": report.timing_accuracy,
                                                "overall_evenness": report.overall_evenness,
                                                "dynamic_range": report.dynamic_range,
                                                "dynamics": [
                                                    {"note": d.note, "dynamic": d.dynamic}
                                                    for d in report.dynamics
                                                ],
                                                "timing": [
                                                    {"note": t.note, "deviation_ms": t.deviation_ms, "rating": t.rating}
                                                    for t in report.timing
                                                ],
                                                "articulation": [
                                                    {"note": a.note, "articulation": a.articulation}
                                                    for a in report.articulation
                                                ]
                                            },
                                            "timestamp": "2025-01-24T00:00:00Z"
                                        })

                            except Exception as e:
                                print(f"ML inference error: {e}")

                    else:
                        # Legacy fallback: polyphonic or monophonic detection
                        chord_detection = analyze_audio_chunk_polyphonic(samples, sample_rate)

                        if chord_detection and chord_detection['num_notes'] > 0:
                            await websocket.send_json({
                                "type": "detection",
                                "notes": chord_detection['notes'],
                                "frequencies": chord_detection['frequencies'],
                                "confidences": chord_detection['confidences'],
                                "confidence": chord_detection['avg_confidence'],
                                "is_chord": chord_detection['is_chord'],
                                "num_notes": chord_detection['num_notes'],
                                "timestamp": "2025-01-24T00:00:00Z"
                            })
                        else:
                            detection = analyze_audio_chunk(samples, sample_rate)
                            if detection:
                                await websocket.send_json({
                                    "type": "detection",
                                    "notes": [detection['note']],
                                    "frequencies": [detection['frequency']],
                                    "confidences": [detection['confidence']],
                                    "confidence": detection['confidence'],
                                    "is_chord": False,
                                    "num_notes": 1,
                                    "timestamp": "2025-01-24T00:00:00Z"
                                })

            elif event.get("type") == "analyze_full_audio":
                # GROUND TRUTH ANALYSIS - Uses ML model when available, YIN fallback
                print(f"\n🎯 Ground truth analysis requested")

                samples = event.get("data", {}).get("samples", [])
                sample_rate = event.get("data", {}).get("sample_rate", 44100)

                if not samples or len(samples) < 2048:
                    await websocket.send_json({
                        "type": "ground_truth_error",
                        "error": "Audio buffer too short for analysis",
                        "timestamp": "2025-01-24T00:00:00Z"
                    })
                    continue

                total_samples = len(samples)
                duration_sec = total_samples / sample_rate
                audio_arr = np.array(samples, dtype=np.float32)

                ml_model = _get_ml_model()
                state = session_states.get(session_id)

                if ml_model and PIPELINE_AVAILABLE:
                    # === ML PIPELINE: Process in 1.12s windows with overlap ===
                    print(f"   ML analysis: {total_samples} samples ({duration_sec:.2f}s)")
                    window_samples = 49392  # 1.12s at 44.1kHz
                    all_notes = []
                    buf = AudioBufferManager(
                        sample_rate=sample_rate,
                        window_samples=window_samples,
                        hop_ratio=0.50,
                    )

                    try:
                        # Feed entire audio through buffer manager in large chunks
                        chunk_size = 4096
                        for i in range(0, len(audio_arr), chunk_size):
                            chunk = audio_arr[i:i + chunk_size]
                            window = buf.add_chunk(chunk)
                            if window is not None:
                                offset = buf.last_window_start_s
                                note_events = ml_model.transcribe(window, sample_rate=sample_rate)
                                confirmed = buf.consensus_notes(note_events, offset)
                                all_notes.extend(confirmed)

                        # Emit remaining pending notes
                        all_notes.extend(buf.flush_pending())

                        # Convert to ground truth format
                        merged_notes = []
                        for n in all_notes:
                            duration_ms = (n.offset_time - n.onset_time) * 1000
                            if duration_ms < 50:
                                continue
                            merged_notes.append({
                                "note": n.note,
                                "frequency": 440.0 * (2.0 ** ((n.pitch - 69) / 12.0)),
                                "startTime": n.onset_time,
                                "duration": duration_ms,
                                "confidence": n.confidence,
                                "velocity": n.velocity
                            })

                        # Sort by onset time
                        merged_notes.sort(key=lambda x: x['startTime'])

                        print(f"[OK] ML analysis complete: {len(merged_notes)} notes")
                        print(f"   Notes: {' -> '.join(n['note'] for n in merged_notes[:20])}")

                        # Run nuance analysis if enough notes
                        expression_data = None
                        if state and state.nuance_analyzer and len(all_notes) >= 2:
                            report = state.nuance_analyzer.analyze(all_notes)
                            expression_data = {
                                "summary": report.summary,
                                "timing_accuracy": report.timing_accuracy,
                                "overall_evenness": report.overall_evenness,
                                "dynamic_range": report.dynamic_range
                            }

                        await websocket.send_json({
                            "type": "ground_truth_result",
                            "data": {
                                "notes": merged_notes,
                                "totalDuration": duration_sec,
                                "algorithm": "onsets_frames_ml",
                                "rawCount": len(all_notes),
                                "mergedCount": len(merged_notes),
                                "expression": expression_data
                            },
                            "timestamp": "2025-01-24T00:00:00Z"
                        })

                    except Exception as e:
                        print(f"[X] ML analysis failed: {e}")
                        import traceback
                        traceback.print_exc()
                        await websocket.send_json({
                            "type": "ground_truth_error",
                            "error": f"ML analysis failed: {str(e)}",
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                        continue

                else:
                    # === YIN FALLBACK: chunk-by-chunk analysis ===
                    print(f"   YIN analysis: {total_samples} samples ({duration_sec:.2f}s)")
                    chunk_size = 4096
                    hop_size = 2048
                    detected_notes = []
                    current_note = None
                    note_start_time = 0
                    note_frequency = 0.0
                    note_confidence = 0.0
                    consecutive_frames = 0
                    min_consecutive_frames = 3

                    try:
                        for i in range(0, total_samples - chunk_size, hop_size):
                            chunk = samples[i:i + chunk_size]
                            current_time = i / sample_rate
                            detection = analyze_audio_chunk(chunk, sample_rate)

                            if detection:
                                note = detection['note']
                                frequency = detection['frequency']
                                confidence = detection['confidence']

                                if note == current_note:
                                    consecutive_frames += 1
                                else:
                                    if current_note and consecutive_frames >= min_consecutive_frames:
                                        duration_ms = (current_time - note_start_time) * 1000
                                        if duration_ms > 50:
                                            detected_notes.append({
                                                "note": current_note,
                                                "frequency": note_frequency,
                                                "startTime": note_start_time,
                                                "duration": duration_ms,
                                                "confidence": note_confidence
                                            })
                                    current_note = note
                                    note_start_time = current_time
                                    note_frequency = frequency
                                    note_confidence = confidence
                                    consecutive_frames = 1

                    except Exception as e:
                        print(f"[X] YIN analysis error: {e}")
                        await websocket.send_json({
                            "type": "ground_truth_error",
                            "error": f"Analysis failed: {str(e)}",
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                        continue

                    # Add final note
                    if current_note and consecutive_frames >= min_consecutive_frames:
                        duration_ms = (duration_sec - note_start_time) * 1000
                        if duration_ms > 50:
                            detected_notes.append({
                                "note": current_note,
                                "frequency": note_frequency,
                                "startTime": note_start_time,
                                "duration": duration_ms,
                                "confidence": note_confidence
                            })

                    # Merge consecutive same notes
                    merged_notes = []
                    for note_data in detected_notes:
                        if note_data['duration'] < 100:
                            continue
                        if merged_notes:
                            prev = merged_notes[-1]
                            time_gap = note_data['startTime'] - (prev['startTime'] + prev['duration'] / 1000)
                            if prev['note'] == note_data['note'] and time_gap < 0.3:
                                prev['duration'] = (note_data['startTime'] - prev['startTime']) * 1000 + note_data['duration']
                                continue
                        merged_notes.append(note_data)

                    print(f"[OK] YIN analysis: {len(merged_notes)} notes ({len(detected_notes)} raw)")

                    await websocket.send_json({
                        "type": "ground_truth_result",
                        "data": {
                            "notes": merged_notes,
                            "totalDuration": duration_sec,
                            "algorithm": "yin",
                            "rawCount": len(detected_notes),
                            "mergedCount": len(merged_notes)
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "start_exercise":
                # Start a new exercise with score following
                exercise_name = event.get("data", {}).get("exercise", "c_major_scale")

                # Check if this is a chord exercise
                is_chord_exercise = exercise_name in ["basic_chords", "c_major_intervals"]

                # Check if this is a scanned MIDI exercise
                scanned_exercise = _find_exercise_by_id(exercise_name)
                is_scanned_midi = scanned_exercise is not None and scanned_exercise.get("type") == "beat_score"

                if is_scanned_midi and BEAT_SCORE_AVAILABLE:
                    # Load scanned MIDI exercise
                    hands = event.get("data", {}).get("hands", "both")
                    practice_mode = event.get("data", {}).get("practice_mode", False)
                    midi_path = scanned_exercise["midi_path"]
                    display_name = scanned_exercise["name"]
                    try:
                        exercise = _load_midi_exercise_by_path(midi_path, display_name, hands=hands)
                    except Exception as e:
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": f"Failed to load MIDI exercise: {e}"},
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                        continue

                    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1, practice_mode=practice_mode)
                    print(f"[OK] Practice mode: {practice_mode}")
                    beat_followers[session_id] = follower

                    # Start count-in timeout
                    old_timeout = count_in_timeouts.pop(session_id, None)
                    if old_timeout:
                        old_timeout.cancel()
                    count_in_timeouts[session_id] = asyncio.create_task(
                        _count_in_timeout(session_id, websocket)
                    )

                    print(f"[OK] Loaded MIDI exercise: {exercise.name} from {midi_path} (hands={hands})")

                    await websocket.send_json({
                        "type": "exercise_started",
                        "data": {
                            "exercise_name": exercise.name,
                            "total_groups": len(exercise.groups),
                            "next_expected_notes": follower.get_current_expected_notes(),
                            "mode": "beat_score_aware",
                            "bpm": exercise.bpm,
                            "time_signature": {
                                "numerator": exercise.time_signature[0],
                                "denominator": exercise.time_signature[1],
                                "beat_unit": exercise.beat_unit,
                            },
                            "beats_per_bar": exercise.beats_per_bar,
                            "hands": hands,
                            "all_notes": [
                                {
                                    "notes": list(g.notes),
                                    "hand": g.hand,
                                    "bar": g.bar_index,
                                    "fingers": list(g.fingers) if g.fingers else [],
                                }
                                for g in exercise.groups
                            ],
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

                elif exercise_name == "perfect_easy" and BEAT_SCORE_AVAILABLE:
                    hands = event.get("data", {}).get("hands", "both")
                    practice_mode = event.get("data", {}).get("practice_mode", False)
                    try:
                        exercise = _load_perfect_exercise(hands=hands)
                    except Exception as e:
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": f"Failed to load MIDI exercise: {e}"},
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                        continue

                    follower = BeatAwareScoreFollower(exercise, lookahead_groups=1, practice_mode=practice_mode)
                    # Don't start timing clock yet - wait for count_in_complete
                    beat_followers[session_id] = follower
                    print(f"[OK] Practice mode: {practice_mode}")

                    # Start count-in timeout: auto-start if frontend never sends count_in_complete
                    old_timeout = count_in_timeouts.pop(session_id, None)
                    if old_timeout:
                        old_timeout.cancel()
                    count_in_timeouts[session_id] = asyncio.create_task(
                        _count_in_timeout(session_id, websocket)
                    )

                    print(f"[OK] Loaded BEAT exercise: {exercise.name} for session {session_id} (hands={hands})")

                    await websocket.send_json({
                        "type": "exercise_started",
                        "data": {
                            "exercise_name": exercise.name,
                            "total_groups": len(exercise.groups),
                            "next_expected_notes": follower.get_current_expected_notes(),
                            "mode": "beat_score_aware",
                            "bpm": exercise.bpm,
                            "time_signature": {
                                "numerator": exercise.time_signature[0],
                                "denominator": exercise.time_signature[1],
                                "beat_unit": exercise.beat_unit,
                            },
                            "beats_per_bar": exercise.beats_per_bar,
                            "hands": hands,
                            "all_notes": [
                                {
                                    "notes": list(g.notes),
                                    "hand": g.hand,
                                    "bar": g.bar_index,
                                    "fingers": list(g.fingers) if g.fingers else [],
                                }
                                for g in exercise.groups
                            ],
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

                elif is_chord_exercise and CHORD_DETECTION_AVAILABLE:
                    # Create chord exercise
                    if exercise_name == "basic_chords":
                        exercise = create_basic_chords_exercise()
                    elif exercise_name == "c_major_intervals":
                        exercise = create_c_major_intervals()
                    else:
                        exercise = create_basic_chords_exercise()  # Default

                    # Create and start chord follower
                    follower = ChordScoreFollower(exercise)
                    follower.start()
                    chord_followers[session_id] = follower

                    print(f"[OK] Started CHORD exercise: {exercise.name} for session {session_id}")

                    # Send exercise info to client
                    await websocket.send_json({
                        "type": "exercise_started",
                        "data": {
                            "exercise_name": exercise.name,
                            "expected_chords": [[n for n in chord.notes] for chord in exercise.chords],
                            "total_chords": len(exercise.chords),
                            "mode": "chord_aware"
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

                elif SCORE_FOLLOWER_AVAILABLE:
                    # Create single-note exercise
                    if exercise_name == "c_major_scale":
                        exercise = create_c_major_scale()
                    elif exercise_name == "twinkle_twinkle":
                        exercise = create_simple_melody()
                    else:
                        exercise = create_c_major_scale()  # Default

                    # Create and start follower
                    follower = ScoreFollower(exercise)
                    follower.start()
                    score_followers[session_id] = follower

                    print(f"[OK] Started exercise: {exercise.name} for session {session_id}")

                    # Build all_notes with timing for single-note exercises
                    # Use 60 BPM, 1 note per beat for beginner-friendly pacing
                    simple_bpm = 60
                    beat_duration_ms = 60000 / simple_bpm
                    all_notes_with_timing = []
                    for idx, n in enumerate(exercise.notes):
                        all_notes_with_timing.append({
                            "notes": [n.note],
                            "hand": "right",
                            "bar": (idx // 4) + 1,  # 4 notes per bar, 1-based
                            "fingers": [],
                        })

                    # Send exercise info to client
                    await websocket.send_json({
                        "type": "exercise_started",
                        "data": {
                            "exercise_name": exercise.name,
                            "expected_notes": [n.note for n in exercise.notes],
                            "total_notes": len(exercise.notes),
                            "mode": "score_aware",
                            "bpm": simple_bpm,
                            "beats_per_bar": 4,
                            "all_notes": all_notes_with_timing,
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })
                else:
                    await websocket.send_json({
                        "type": "error",
                        "data": {"message": "Score follower not available"},
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "stop_exercise":
                # Stop current exercise
                if session_id in chord_followers:
                    follower = chord_followers[session_id]
                    progress = follower.get_progress()

                    del chord_followers[session_id]

                    print(f"[OK] Stopped CHORD exercise for session {session_id}")

                    await websocket.send_json({
                        "type": "exercise_stopped",
                        "data": progress,
                        "timestamp": "2025-01-24T00:00:00Z"
                    })
                elif session_id in beat_followers:
                    follower = beat_followers[session_id]
                    progress = follower.get_progress()
                    del beat_followers[session_id]

                    print(f"[OK] Stopped BEAT exercise for session {session_id}")

                    await websocket.send_json({
                        "type": "exercise_stopped",
                        "data": progress,
                        "timestamp": "2025-01-24T00:00:00Z"
                    })
                elif session_id in score_followers:
                    follower = score_followers[session_id]
                    progress = follower.get_progress()

                    del score_followers[session_id]

                    print(f"[OK] Stopped exercise for session {session_id}")

                    await websocket.send_json({
                        "type": "exercise_stopped",
                        "data": progress,
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "replay_last_bar":
                follower = beat_followers.get(session_id)
                if follower:
                    bars = event.get("data", {}).get("bars", 1)
                    bar_index = follower.replay_last_bars(bars)
                    progress = follower.get_progress()
                    await websocket.send_json({
                        "type": "exercise_restarted",
                        "data": {
                            "message": f"Replaying bar {bar_index + 1}",
                            "current_bar": bar_index + 1,
                            "next_expected_notes": progress.get("next_expected_notes", []),
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "set_tempo_multiplier":
                # Gap 5: manual tempo override from frontend
                follower = beat_followers.get(session_id)
                if follower:
                    mult = event.get("data", {}).get("multiplier", 1.0)
                    follower.set_tempo_multiplier(float(mult))
                    await websocket.send_json({
                        "type": "tempo_change",
                        "data": {
                            "bpm": follower.current_tempo_bpm,
                            "tempo_multiplier": follower.tempo_multiplier,
                        },
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "count_in_complete":
                # Frontend finished the count-in - start the timing clock
                # Cancel the auto-start timeout
                timeout_task = count_in_timeouts.pop(session_id, None)
                if timeout_task:
                    timeout_task.cancel()
                follower = beat_followers.get(session_id)
                if follower:
                    follower.start()
                    print(f"[OK] Count-in complete, timing clock started for session {session_id}")
                    await websocket.send_json({
                        "type": "timing_started",
                        "data": {"message": "GO!"},
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "test_note":
                # TEST MODE: Directly inject a note for testing without audio
                note = event.get("data", {}).get("note", "C4")
                print(f"[TEST] Injecting note: {note}")

                beat_follower = beat_followers.get(session_id)
                single_follower = score_followers.get(session_id)
                print(f"[TEST] beat_follower={beat_follower is not None}, single_follower={single_follower is not None}")

                # Convert note to frequency using standard formula
                def note_to_freq(note_name):
                    """Convert note name to frequency using A4=440Hz standard"""
                    note_map = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
                                'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
                                'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11}
                    try:
                        # Parse note name (e.g., "F#5" -> "F#", "5")
                        if len(note_name) >= 2 and note_name[-1].isdigit():
                            if len(note_name) >= 3 and note_name[-2].isdigit():
                                # Handle negative octave like C-1
                                octave = int(note_name[-2:])
                                base = note_name[:-2]
                            else:
                                octave = int(note_name[-1])
                                base = note_name[:-1]
                        else:
                            return 440.0  # Default
                        semitone = note_map.get(base, 9)  # A if unknown
                        # A4 = 440Hz is MIDI 69, each semitone is 2^(1/12)
                        midi_num = (octave + 1) * 12 + semitone
                        return 440.0 * (2.0 ** ((midi_num - 69) / 12.0))
                    except:
                        return 440.0  # Default for parse errors
                freq = note_to_freq(note)

                try:
                    if beat_follower:
                        # Process through beat-aware follower
                        result = beat_follower.process_detection(note, freq, 0.95, timestamp=None)
                        progress = beat_follower.get_progress()

                        # beat_score uses current_group, single_note uses current_index
                        current_pos = progress.get("current_group", progress.get("current_index", 0))

                        await websocket.send_json({
                            "type": "note_detected",
                            "data": {
                                "note": note,
                                "result": result,
                                "matched": result.get("matched", False),
                                "feedback": result.get("feedback", ""),
                                "action": result.get("action", ""),
                                "current_index": current_pos,
                                "total_groups": progress.get("total", 0),
                                "next_expected_notes": beat_follower.get_current_expected_notes(),
                                "completed": progress.get("completed", False),
                                "correct": progress.get("correct", 0),
                                "wrong": progress.get("missed", 0) + progress.get("partial", 0),
                            },
                            "timestamp": "2025-01-24T00:00:00Z"
                        })

                        print(f"[TEST] Result: matched={result.get('matched')}, action={result.get('action')}, pos={current_pos}/{progress.get('total')}")

                        if progress.get("completed"):
                            await websocket.send_json({
                                "type": "exercise_complete",
                                "data": {
                                    "message": "Exercise completed!",
                                    "correct": progress.get("correct", 0),
                                    "wrong": progress.get("wrong", 0),
                                    "total": progress.get("total", 0),
                                },
                                "timestamp": "2025-01-24T00:00:00Z"
                            })

                    elif single_follower:
                        # Process through single-note follower
                        result = single_follower.process_detection(note, freq, 0.95)
                        progress = single_follower.get_progress()

                        # Get next expected notes
                        next_expected = single_follower.get_current_expected_notes()
                        next_note_names = [n.note for n in next_expected[:2]] if next_expected else []

                        await websocket.send_json({
                            "type": "note_detected",
                            "data": {
                                "note": note,
                                "matched": result.get("matched", False),
                                "feedback": result.get("feedback", ""),
                                "action": result.get("action", ""),
                                "current_index": progress.get("correct", 0),
                                "total_groups": progress.get("total", 0),
                                "next_expected_notes": next_note_names,
                                "completed": progress.get("completed", False),
                                "correct": progress.get("correct", 0),
                                "wrong": progress.get("missed", 0),
                            },
                            "timestamp": "2025-01-24T00:00:00Z"
                        })

                        print(f"[TEST] Result: matched={result.get('matched')}, action={result.get('action')}, pos={progress.get('correct')}/{progress.get('total')}")
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "data": {"message": "No active exercise to inject note into"},
                            "timestamp": "2025-01-24T00:00:00Z"
                        })
                except Exception as e:
                    print(f"[TEST ERROR] {type(e).__name__}: {e}")
                    import traceback
                    traceback.print_exc()
                    await websocket.send_json({
                        "type": "error",
                        "data": {"message": f"test_note error: {e}"},
                        "timestamp": "2025-01-24T00:00:00Z"
                    })

            elif event.get("type") == "attempt_complete":
                # Handle attempt completion
                print(f"[OK] Attempt completed for session {session_id}")

                # Send mock agent feedback
                await websocket.send_json({
                    "type": "agent_decision",
                    "data": {
                        "tier": random.choice([1, 2, 3]),
                        "message": "Good progress! Keep practicing the chord transitions.",
                        "reasoning": "Your timing improved by 15% compared to last session."
                    },
                    "timestamp": "2025-01-24T00:00:00Z"
                })

    except WebSocketDisconnect:
        print(f"[X] Session {session_id} disconnected")
    except Exception as e:
        print(f"[X] Error in session {session_id}: {e}")
    finally:
        if session_id in connections:
            del connections[session_id]
        if session_id in score_followers:
            del score_followers[session_id]
        if session_id in chord_followers:
            del chord_followers[session_id]
        if session_id in beat_followers:
            del beat_followers[session_id]
        timeout_task = count_in_timeouts.pop(session_id, None)
        if timeout_task:
            timeout_task.cancel()
        if session_id in session_states:
            state = session_states.pop(session_id)
            if state.onset_detector:
                state.onset_detector.reset()
            if state.buffer_manager:
                state.buffer_manager.reset()


# ─────────────────────────────────────────────────────────────────────────────
# PRO STREAMING ENDPOINT (Polyphonic Detection)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ProSessionState:
    """Per-session state for Pro streaming polyphonic detection."""
    sample_rate: int = 16000
    frame_size: int = 320  # 20ms at 16kHz
    ring_buffer: np.ndarray = field(default_factory=lambda: np.zeros(0, dtype=np.float32))
    buffer_size: int = 16000  # 1 second buffer
    expected_pitches: list = field(default_factory=list)
    last_inference_time: float = 0
    hop_ms: int = 200  # Run inference every 200ms
    window_ms: int = 1120  # 1.12s window for ML model
    last_emitted_onsets: dict = field(default_factory=dict)  # pitch -> timestamp for dedup


pro_sessions: Dict[str, ProSessionState] = {}


def _midi_to_note_name(pitch: int) -> str:
    """Convert MIDI pitch to note name."""
    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    octave = (pitch // 12) - 1
    note_idx = pitch % 12
    return f"{NOTE_NAMES[note_idx]}{octave}"


@app.websocket("/ws/pro/{session_id}")
async def pro_websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket endpoint for Pro streaming polyphonic detection.

    Protocol:
    - Client -> Server (binary): [uint32 timestamp_ms][int16 pcm samples...]
    - Client -> Server (JSON): {type: "start"|"stop"|"expected", ...}
    - Server -> Client (JSON): {type: "note_events", events: [...]}
    """
    await websocket.accept()
    print(f" Pro session {session_id} connected")

    # Initialize session state
    state = ProSessionState()
    state.ring_buffer = np.zeros(state.buffer_size, dtype=np.float32)
    pro_sessions[session_id] = state

    # Get ML model
    ml_model = _get_ml_model()
    if not ml_model:
        await websocket.send_json({
            "type": "error",
            "message": "ML model not available"
        })
        await websocket.close()
        return

    try:
        while True:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            # Handle JSON messages
            if "text" in message:
                try:
                    msg = json.loads(message["text"])
                    msg_type = msg.get("type")

                    if msg_type == "start":
                        state.sample_rate = msg.get("sampleRate", 16000)
                        state.frame_size = msg.get("frameSize", 320)
                        print(f" Pro session {session_id} started: {state.sample_rate}Hz, {state.frame_size} samples/frame")

                    elif msg_type == "stop":
                        print(f" Pro session {session_id} stopped")
                        break

                    elif msg_type == "expected":
                        state.expected_pitches = msg.get("pitches", [])
                        print(f" Pro session {session_id} expected pitches: {state.expected_pitches}")

                except json.JSONDecodeError:
                    pass

            # Handle binary audio frames
            elif "bytes" in message:
                data = message["bytes"]
                if len(data) < 4:
                    continue

                # Parse header: uint32 timestamp
                timestamp_ms = int.from_bytes(data[:4], byteorder='little')

                # Parse PCM16 samples
                pcm_data = np.frombuffer(data[4:], dtype=np.int16)
                samples = pcm_data.astype(np.float32) / 32768.0

                # Append to ring buffer
                buffer_len = len(state.ring_buffer)
                if len(samples) < buffer_len:
                    # Shift buffer and append new samples
                    state.ring_buffer[:-len(samples)] = state.ring_buffer[len(samples):]
                    state.ring_buffer[-len(samples):] = samples

                # Check if it's time for inference
                now_ms = timestamp_ms
                if now_ms - state.last_inference_time >= state.hop_ms:
                    state.last_inference_time = now_ms

                    # Get window for inference
                    window_samples = int((state.window_ms / 1000) * state.sample_rate)
                    if len(state.ring_buffer) >= window_samples:
                        audio_window = state.ring_buffer[-window_samples:]

                        # Run ML inference in thread pool
                        try:
                            loop = asyncio.get_event_loop()
                            result = await loop.run_in_executor(
                                ml_executor,
                                _run_ml_inference,
                                ml_model,
                                audio_window,
                                state.sample_rate,
                                state.expected_pitches if state.expected_pitches else None
                            )

                            if result and "notes" in result:
                                # Convert to NoteEvents
                                events = []
                                cooldown_ms = 120  # Per-pitch cooldown for dedup

                                for note in result["notes"]:
                                    pitch = note.get("pitch", 60)

                                    # Dedup: check cooldown
                                    last_onset = state.last_emitted_onsets.get(pitch, 0)
                                    if now_ms - last_onset < cooldown_ms:
                                        continue

                                    state.last_emitted_onsets[pitch] = now_ms

                                    events.append({
                                        "pitch": pitch,
                                        "noteName": _midi_to_note_name(pitch),
                                        "tOnMs": now_ms,
                                        "velocity": int(note.get("velocity", 0.8) * 127),
                                        "confidence": note.get("confidence", 0.9),
                                        "onsetStrength": note.get("onset_strength", 0.8),
                                    })

                                if events:
                                    await websocket.send_json({
                                        "type": "note_events",
                                        "events": events
                                    })
                                    print(f" Pro: {len(events)} notes @ {now_ms}ms: {[e['noteName'] for e in events]}")

                        except Exception as e:
                            print(f"[!] Pro inference error: {e}")

    except WebSocketDisconnect:
        print(f" Pro session {session_id} disconnected")
    except Exception as e:
        print(f"[!] Pro session {session_id} error: {e}")
    finally:
        pro_sessions.pop(session_id, None)


if __name__ == "__main__":
    print("=" * 60)
    print(" Piano Mastery - Detection Server")
    print("=" * 60)
    print("Server: http://localhost:8000")
    print("WebSocket: ws://localhost:8000/ws/{session_id}")
    print("Pro WebSocket: ws://localhost:8000/ws/pro/{session_id}")
    print("Health: http://localhost:8000/health")
    print("=" * 60)
    print(f"\nPitch Detection: {PITCH_DETECTION_METHOD.upper()}")
    print(f"ML Pipeline: {'AVAILABLE' if PIPELINE_AVAILABLE else 'NOT AVAILABLE'}")
    if PIPELINE_AVAILABLE:
        print("  Fast path:     OnsetDetector (spectral flux, <20ms)")
        print("  Accurate path: Onsets & Frames ML (anti-aliased, 1.12s windows)")
        print("  Expression:    NuanceAnalyzer (dynamics, timing, articulation)")
    print("=" * 60 + "\n")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
