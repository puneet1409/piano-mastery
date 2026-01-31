/**
 * Unified music event types for piano detection.
 *
 * Both YIN (client-side monophonic) and polyphonic (server-side ML) detectors
 * output the same NoteEvent format, so UI and score-follower don't care which
 * engine produced the events.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

/** Source of the detection */
export type DetectorSource = "yin" | "polyphonic" | "midi";

/** Event kind for two-speed feedback */
export type NoteEventKind = "tentative" | "confirmed";

/**
 * Unified note event format.
 * All detectors (YIN, polyphonic ML, MIDI) output this same format.
 */
export interface NoteEvent {
  /** MIDI pitch number (21-108 for piano, 60 = C4) */
  pitch: number;

  /** Note name with octave (e.g., "C4", "F#5") */
  noteName: string;

  /** Onset time in ms (client clock, relative to exercise start) */
  tOnMs: number;

  /** Offset time in ms (optional, for note-off events) */
  tOffMs?: number;

  /** Velocity 0-127 (optional) */
  velocity?: number;

  /** Detection confidence 0-1 */
  confidence: number;

  /** Onset strength 0-1 (if available from ML model) */
  onsetStrength?: number;

  /** Which detector produced this event */
  source: DetectorSource;

  /** Two-speed: tentative (instant UI) or confirmed (scoring) */
  kind: NoteEventKind;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exercise Metadata
// ─────────────────────────────────────────────────────────────────────────────

/** Exercise type determines which detector to use */
export type ExerciseType =
  | "single_note"      // Scales, single-hand melodies → YIN only
  | "melody"           // Single-voice melodies → YIN only
  | "chords"           // Chord exercises → Polyphonic required
  | "two_hands"        // Two-hand pieces → Polyphonic required
  | "song";            // Full songs → Polyphonic required

/**
 * Exercise metadata with polyphony flag.
 * This determines which detector(s) to activate.
 */
export interface ExerciseMeta {
  id: string;
  title: string;
  description?: string;
  difficulty?: "beginner" | "intermediate" | "advanced";

  /** Does this exercise require polyphonic detection? */
  requiresPolyphony: boolean;

  /** Expected number of voices (1 = monophonic, 2 = two hands/voices) */
  expectedVoices?: 1 | 2;

  /** Exercise type for routing */
  type?: ExerciseType;

  /** BPM for timed exercises */
  bpm?: number;

  /** Time signature */
  timeSignature?: { numerator: number; denominator: number };

  /** Beats per bar */
  beatsPerBar?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detector Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Which detectors are active */
export interface DetectorConfig {
  /** Use client-side YIN for instant feedback */
  useLite: boolean;

  /** Use server-side polyphonic ML for scoring */
  usePro: boolean;

  /** Score-aware mode: send expected notes to detector */
  scoreAware: boolean;
}

/**
 * Determine detector config based on exercise metadata.
 */
export function getDetectorConfig(meta: ExerciseMeta): DetectorConfig {
  if (meta.requiresPolyphony) {
    // Polyphonic: use both (Lite for instant UI, Pro for scoring)
    return {
      useLite: true,   // Tentative highlights
      usePro: true,    // Confirmed scoring
      scoreAware: true,
    };
  } else {
    // Monophonic: Lite only (YIN is sufficient)
    return {
      useLite: true,
      usePro: false,
      scoreAware: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert MIDI pitch to note name (e.g., 60 → "C4") */
export function midiToNoteName(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  const noteIndex = pitch % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/** Convert note name to MIDI pitch (e.g., "C4" → 60) */
export function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const match = noteName.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60; // Default to C4
  const [, note, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[note] ?? 0);
}

/** Convert MIDI pitch to frequency in Hz */
export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Convert frequency to MIDI pitch (rounded) */
export function frequencyToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

/** Calculate cents difference between two frequencies */
export function centsError(detectedFreq: number, expectedFreq: number): number {
  return 1200 * Math.log2(detectedFreq / expectedFreq);
}
