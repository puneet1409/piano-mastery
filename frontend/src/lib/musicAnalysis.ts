/**
 * Music Analysis Utilities
 *
 * Contains:
 * - Score-aware detection bias
 * - Chord name recognition
 * - Timing accuracy scoring
 * - Velocity/dynamics detection
 * - Repeated note detection
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// MIDI note 69 = A4 = 440Hz
const A4_MIDI = 69;
const A4_FREQ = 440;

// ─────────────────────────────────────────────────────────────────────────────
// SCORE-AWARE DETECTION BIAS
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreContext {
  expectedNotes: string[];        // Notes expected at current time (e.g., ['C4', 'E4', 'G4'])
  keySignature?: string;          // Key signature (e.g., 'G major', 'A minor')
  toleranceCents?: number;        // How close detection must be to snap (default: 50 cents)
}

export interface BiasedDetection {
  originalNote: string;
  originalFreq: number;
  biasedNote: string;
  biasedFreq: number;
  wasSnapped: boolean;
  centsOffset: number;            // How far off the original was
  confidence: number;
}

/**
 * Convert MIDI note number to frequency
 */
export function midiToFreq(midi: number): number {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/**
 * Convert frequency to MIDI note number
 */
export function freqToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / A4_FREQ) + A4_MIDI);
}

/**
 * Convert note name to MIDI number
 */
export function noteToMidi(note: string): number {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60; // Default to C4

  const [, noteName, octaveStr] = match;
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };

  const octave = parseInt(octaveStr);
  return (octave + 1) * 12 + (noteMap[noteName] ?? 0);
}

/**
 * Convert MIDI number to note name
 */
export function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

/**
 * Calculate cents difference between two frequencies
 * Positive = detected is sharp, Negative = detected is flat
 */
export function centsDifference(detectedFreq: number, expectedFreq: number): number {
  return 1200 * Math.log2(detectedFreq / expectedFreq);
}

/**
 * Apply score-aware bias to a detection.
 * If detected note is close to an expected note, snap to it.
 */
export function applyScoreBias(
  detectedNote: string,
  detectedFreq: number,
  detectedConfidence: number,
  context: ScoreContext
): BiasedDetection {
  const tolerance = context.toleranceCents ?? 50; // Default 50 cents (half semitone)

  let bestMatch: { note: string; freq: number; cents: number } | null = null;
  let smallestCents = Infinity;

  // Check each expected note
  for (const expectedNote of context.expectedNotes) {
    const expectedMidi = noteToMidi(expectedNote);
    const expectedFreq = midiToFreq(expectedMidi);
    const cents = Math.abs(centsDifference(detectedFreq, expectedFreq));

    if (cents <= tolerance && cents < smallestCents) {
      smallestCents = cents;
      bestMatch = {
        note: expectedNote,
        freq: expectedFreq,
        cents: centsDifference(detectedFreq, expectedFreq)
      };
    }
  }

  if (bestMatch) {
    // Snap to expected note, boost confidence
    return {
      originalNote: detectedNote,
      originalFreq: detectedFreq,
      biasedNote: bestMatch.note,
      biasedFreq: bestMatch.freq,
      wasSnapped: true,
      centsOffset: bestMatch.cents,
      confidence: Math.min(1, detectedConfidence * 1.2) // Boost confidence when matched
    };
  }

  // No match - return original
  return {
    originalNote: detectedNote,
    originalFreq: detectedFreq,
    biasedNote: detectedNote,
    biasedFreq: detectedFreq,
    wasSnapped: false,
    centsOffset: 0,
    confidence: detectedConfidence
  };
}

/**
 * Get notes in a key signature for broader bias
 */
export function getNotesInKey(keySignature: string): string[] {
  const majorScales: Record<string, string[]> = {
    'C major': ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    'G major': ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
    'D major': ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
    'A major': ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
    'E major': ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
    'B major': ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
    'F major': ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
    'Bb major': ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
    'Eb major': ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
    'Ab major': ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  };

  const minorScales: Record<string, string[]> = {
    'A minor': ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    'E minor': ['E', 'F#', 'G', 'A', 'B', 'C', 'D'],
    'B minor': ['B', 'C#', 'D', 'E', 'F#', 'G', 'A'],
    'D minor': ['D', 'E', 'F', 'G', 'A', 'Bb', 'C'],
    'G minor': ['G', 'A', 'Bb', 'C', 'D', 'Eb', 'F'],
    'C minor': ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'],
  };

  return majorScales[keySignature] || minorScales[keySignature] || NOTE_NAMES;
}


// ─────────────────────────────────────────────────────────────────────────────
// CHORD NAME RECOGNITION
// ─────────────────────────────────────────────────────────────────────────────

export interface ChordInfo {
  name: string;           // e.g., "C major", "Am", "G7"
  root: string;           // Root note (e.g., "C")
  quality: string;        // "major", "minor", "diminished", "augmented", "7", etc.
  intervals: number[];    // Semitone intervals from root
  notes: string[];        // Actual notes in the chord
  confidence: number;     // How well the detected notes match
}

// Chord templates (intervals from root in semitones)
const CHORD_TEMPLATES: Record<string, { intervals: number[]; quality: string }> = {
  'major': { intervals: [0, 4, 7], quality: 'major' },
  'minor': { intervals: [0, 3, 7], quality: 'minor' },
  'dim': { intervals: [0, 3, 6], quality: 'diminished' },
  'aug': { intervals: [0, 4, 8], quality: 'augmented' },
  '7': { intervals: [0, 4, 7, 10], quality: 'dominant 7th' },
  'maj7': { intervals: [0, 4, 7, 11], quality: 'major 7th' },
  'm7': { intervals: [0, 3, 7, 10], quality: 'minor 7th' },
  'sus4': { intervals: [0, 5, 7], quality: 'sus4' },
  'sus2': { intervals: [0, 2, 7], quality: 'sus2' },
  'add9': { intervals: [0, 4, 7, 14], quality: 'add9' },
  '6': { intervals: [0, 4, 7, 9], quality: '6th' },
  'm6': { intervals: [0, 3, 7, 9], quality: 'minor 6th' },
};

/**
 * Identify chord from detected notes
 */
export function identifyChord(notes: string[]): ChordInfo | null {
  if (notes.length < 2) return null;

  // Convert to MIDI and sort
  const midiNotes = notes.map(noteToMidi).sort((a, b) => a - b);

  // Normalize to pitch classes (0-11)
  const pitchClasses = [...new Set(midiNotes.map(m => m % 12))].sort((a, b) => a - b);

  if (pitchClasses.length < 2) return null;

  let bestMatch: ChordInfo | null = null;
  let bestScore = 0;

  // Try each pitch class as potential root
  for (const rootPc of pitchClasses) {
    // Calculate intervals from this root
    const intervals = pitchClasses.map(pc => (pc - rootPc + 12) % 12).sort((a, b) => a - b);

    // Compare with each chord template
    for (const [chordType, template] of Object.entries(CHORD_TEMPLATES)) {
      const score = matchChordTemplate(intervals, template.intervals);

      if (score > bestScore) {
        bestScore = score;
        const rootNote = NOTE_NAMES[rootPc];
        const chordName = chordType === 'major' ? rootNote :
                         chordType === 'minor' ? `${rootNote}m` :
                         `${rootNote}${chordType}`;

        bestMatch = {
          name: chordName,
          root: rootNote,
          quality: template.quality,
          intervals: template.intervals,
          notes: notes,
          confidence: score
        };
      }
    }
  }

  // Only return if confidence is reasonable
  return bestMatch && bestMatch.confidence >= 0.6 ? bestMatch : null;
}

/**
 * Score how well detected intervals match a template
 */
function matchChordTemplate(detected: number[], template: number[]): number {
  // Check how many template intervals are present
  let matches = 0;
  for (const interval of template) {
    if (detected.includes(interval)) {
      matches++;
    }
  }

  // For 7th chords and extensions, require all template notes to be present
  const allTemplatePresent = matches === template.length;

  // Penalize extra notes (but less for extensions that fit the chord)
  const extraNotes = detected.filter(d => !template.includes(d)).length;

  // Score: prioritize templates where ALL notes match
  if (allTemplatePresent) {
    // Bonus for exact or near-exact match
    const baseScore = 1.0;
    const penalty = extraNotes * 0.05; // Small penalty for extras
    return Math.max(0, baseScore - penalty);
  }

  // Partial match
  const baseScore = matches / template.length;
  const penalty = extraNotes * 0.15;
  return Math.max(0, baseScore - penalty);
}


// ─────────────────────────────────────────────────────────────────────────────
// TIMING ACCURACY SCORING
// ─────────────────────────────────────────────────────────────────────────────

export interface TimingResult {
  offsetMs: number;           // Positive = late, Negative = early
  rating: 'perfect' | 'great' | 'good' | 'ok' | 'miss';
  score: number;              // 0-100
}

// Timing windows (in milliseconds)
const TIMING_WINDOWS = {
  perfect: 25,    // ±25ms
  great: 50,      // ±50ms
  good: 100,      // ±100ms
  ok: 200,        // ±200ms
  miss: Infinity  // Beyond ±200ms
};

/**
 * Calculate timing accuracy
 */
export function calculateTimingAccuracy(
  playedTimeMs: number,
  expectedTimeMs: number
): TimingResult {
  const offsetMs = playedTimeMs - expectedTimeMs;
  const absOffset = Math.abs(offsetMs);

  let rating: TimingResult['rating'];
  let score: number;

  if (absOffset <= TIMING_WINDOWS.perfect) {
    rating = 'perfect';
    score = 100;
  } else if (absOffset <= TIMING_WINDOWS.great) {
    rating = 'great';
    score = 90 - (absOffset - TIMING_WINDOWS.perfect) * 0.2;
  } else if (absOffset <= TIMING_WINDOWS.good) {
    rating = 'good';
    score = 80 - (absOffset - TIMING_WINDOWS.great) * 0.2;
  } else if (absOffset <= TIMING_WINDOWS.ok) {
    rating = 'ok';
    score = 60 - (absOffset - TIMING_WINDOWS.good) * 0.2;
  } else {
    rating = 'miss';
    score = Math.max(0, 40 - (absOffset - TIMING_WINDOWS.ok) * 0.1);
  }

  return { offsetMs, rating, score };
}

/**
 * Get human-readable timing feedback
 */
export function getTimingFeedback(result: TimingResult): string {
  const direction = result.offsetMs > 0 ? 'late' : 'early';
  const absMs = Math.abs(result.offsetMs);

  switch (result.rating) {
    case 'perfect':
      return 'Perfect!';
    case 'great':
      return `Great! (${absMs}ms ${direction})`;
    case 'good':
      return `Good (${absMs}ms ${direction})`;
    case 'ok':
      return `OK (${absMs}ms ${direction})`;
    case 'miss':
      return `Miss (${absMs}ms ${direction})`;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// VELOCITY/DYNAMICS DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export interface VelocityAnalysis {
  velocity: number;           // 0-127 (MIDI standard)
  dynamics: 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff';
  attackStrength: number;     // 0-1, how strong the attack transient is
  rms: number;                // Raw RMS value
}

// Dynamic markings mapped to velocity ranges
const DYNAMICS_MAP: Array<{ max: number; marking: VelocityAnalysis['dynamics'] }> = [
  { max: 16, marking: 'ppp' },
  { max: 32, marking: 'pp' },
  { max: 48, marking: 'p' },
  { max: 64, marking: 'mp' },
  { max: 80, marking: 'mf' },
  { max: 96, marking: 'f' },
  { max: 112, marking: 'ff' },
  { max: 127, marking: 'fff' },
];

/**
 * Analyze velocity/dynamics from audio samples
 */
export function analyzeVelocity(
  samples: Float32Array,
  sampleRate: number = 44100
): VelocityAnalysis {
  const n = samples.length;
  if (n === 0) {
    return { velocity: 0, dynamics: 'ppp', attackStrength: 0, rms: 0 };
  }

  // Calculate RMS
  let rmsSum = 0;
  for (let i = 0; i < n; i++) {
    rmsSum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(rmsSum / n);

  // Analyze attack (first 10ms)
  const attackSamples = Math.min(Math.floor(0.01 * sampleRate), n);
  let attackPeak = 0;
  for (let i = 0; i < attackSamples; i++) {
    attackPeak = Math.max(attackPeak, Math.abs(samples[i]));
  }

  // Calculate attack strength (ratio of attack peak to RMS)
  const attackStrength = rms > 0 ? Math.min(1, attackPeak / (rms * 3)) : 0;

  // Map RMS to velocity (0-127)
  // Typical piano RMS range: 0.001 (very soft) to 0.5 (very loud)
  // Use logarithmic mapping for more natural feel
  const normalizedRms = Math.max(0, Math.min(1, (Math.log10(rms + 0.001) + 3) / 3));
  const velocity = Math.round(normalizedRms * 127);

  // Get dynamics marking
  let dynamics: VelocityAnalysis['dynamics'] = 'ppp';
  for (const { max, marking } of DYNAMICS_MAP) {
    if (velocity <= max) {
      dynamics = marking;
      break;
    }
  }

  return { velocity, dynamics, attackStrength, rms };
}

/**
 * Compare velocities for expression feedback
 */
export function compareVelocity(
  played: number,
  expected: number,
  tolerance: number = 20
): { match: boolean; feedback: string } {
  const diff = played - expected;

  if (Math.abs(diff) <= tolerance) {
    return { match: true, feedback: 'Good dynamics!' };
  } else if (diff > 0) {
    return { match: false, feedback: `Too loud (velocity ${played} vs expected ${expected})` };
  } else {
    return { match: false, feedback: `Too soft (velocity ${played} vs expected ${expected})` };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// REPEATED NOTE DETECTION
// ─────────────────────────────────────────────────────────────────────────────

export interface RepeatedNoteDetector {
  lastNote: string | null;
  lastNoteTime: number;
  lastNoteEnergy: number;
  minGapMs: number;
  energyDropThreshold: number;
}

/**
 * Create a repeated note detector
 */
export function createRepeatedNoteDetector(
  minGapMs: number = 50,
  energyDropThreshold: number = 0.3
): RepeatedNoteDetector {
  return {
    lastNote: null,
    lastNoteTime: 0,
    lastNoteEnergy: 0,
    minGapMs,
    energyDropThreshold
  };
}

/**
 * Check if this is a repeated note (same note played again)
 */
export function detectRepeatedNote(
  detector: RepeatedNoteDetector,
  currentNote: string,
  currentTime: number,
  currentEnergy: number,
  isOnset: boolean
): { isRepeated: boolean; gapMs: number } {
  const gapMs = currentTime - detector.lastNoteTime;
  const isSameNote = currentNote === detector.lastNote;
  const energyDropped = detector.lastNoteEnergy > 0 &&
    currentEnergy < detector.lastNoteEnergy * detector.energyDropThreshold;
  const energyRecovered = currentEnergy > detector.lastNoteEnergy * 0.8;

  // Conditions for repeated note:
  // 1. Same note as before
  // 2. Enough time has passed (or onset detected)
  // 3. Energy dropped and recovered (re-attack)
  const isRepeated = isSameNote &&
    gapMs >= detector.minGapMs &&
    (isOnset || (energyDropped && energyRecovered));

  // Update state
  detector.lastNote = currentNote;
  detector.lastNoteTime = currentTime;
  detector.lastNoteEnergy = currentEnergy;

  return { isRepeated, gapMs };
}

/**
 * Reset the repeated note detector
 */
export function resetRepeatedNoteDetector(detector: RepeatedNoteDetector): void {
  detector.lastNote = null;
  detector.lastNoteTime = 0;
  detector.lastNoteEnergy = 0;
}
