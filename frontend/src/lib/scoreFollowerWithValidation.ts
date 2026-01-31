/**
 * Score Follower with Note Validation
 *
 * Combined system that:
 * 1. SYNCING mode: Find position in song (tolerant)
 * 2. LOCKED mode: Track position AND validate right/wrong notes (strict)
 * 3. LOST mode: Re-sync if too many errors
 *
 * State Machine:
 *   SYNCING ---(3+ matches)---> LOCKED
 *   LOCKED ---(correct note)---> LOCKED (advance position)
 *   LOCKED ---(wrong note)---> LOCKED (stay, report error)
 *   LOCKED ---(5+ consecutive wrong)---> LOST
 *   LOST ---(3+ matches)---> LOCKED
 */

export type FollowerMode = 'syncing' | 'locked' | 'lost';

export interface NoteResult {
  detected: string;           // What was detected
  expected: string;           // What was expected
  isCorrect: boolean;         // Did they match?
  position: number;           // Current position in song
  mode: FollowerMode;         // Current mode
  confidence: number;         // 0-1
  consecutiveErrors: number;  // How many wrong in a row
  message: string;            // Human-readable status
}

export interface SongNote {
  note: string;
  index: number;
}

export interface SongData {
  title: string;
  notes: string[];
}

export interface FollowerConfig {
  bufferSize: number;              // Notes to buffer for sync (default: 5)
  lockThreshold: number;           // Confidence to lock (default: 0.7)
  minMatchesForLock: number;       // Min matches to lock (default: 3)
  maxConsecutiveErrors: number;    // Errors before going LOST (default: 5)
  allowOctaveEquivalence: boolean; // C4 = C5 for matching (default: true)
  strictMode: boolean;             // STRICT: retry on wrong, FORGIVING: advance anyway (default: true)
}

const DEFAULT_CONFIG: FollowerConfig = {
  bufferSize: 5,
  lockThreshold: 0.7,
  minMatchesForLock: 3,
  maxConsecutiveErrors: 5,
  allowOctaveEquivalence: true,
  strictMode: true,
};

// Note utilities
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(note: string): number {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const [, noteName, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[noteName] ?? 0);
}

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function getPitchClass(note: string): number {
  return noteToMidi(note) % 12;
}

function notesMatch(note1: string, note2: string, allowOctave: boolean): boolean {
  if (allowOctave) {
    return getPitchClass(note1) === getPitchClass(note2);
  }
  return noteToMidi(note1) === noteToMidi(note2);
}

/**
 * Score Follower with Note Validation
 */
export class ScoreFollowerWithValidation {
  private song: SongData;
  private config: FollowerConfig;

  // State
  private mode: FollowerMode = 'syncing';
  private currentPosition: number = -1;
  private confidence: number = 0;
  private consecutiveErrors: number = 0;
  private noteBuffer: string[] = [];

  constructor(song: SongData, config: Partial<FollowerConfig> = {}) {
    this.song = song;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Reset to initial state
   */
  reset(): void {
    this.mode = 'syncing';
    this.currentPosition = -1;
    this.confidence = 0;
    this.consecutiveErrors = 0;
    this.noteBuffer = [];
  }

  /**
   * Process a detected note
   * Returns validation result with right/wrong status
   */
  processNote(detectedNote: string): NoteResult {
    // Add to buffer
    this.noteBuffer.push(detectedNote);
    if (this.noteBuffer.length > this.config.bufferSize) {
      this.noteBuffer.shift();
    }

    switch (this.mode) {
      case 'syncing':
        return this.processSyncing(detectedNote);
      case 'locked':
        return this.processLocked(detectedNote);
      case 'lost':
        return this.processLost(detectedNote);
    }
  }

  /**
   * SYNCING mode: Try to find position in song
   */
  private processSyncing(detectedNote: string): NoteResult {
    const matches = this.findMatchingPositions();

    if (matches.length > 0 && matches[0].score >= this.config.lockThreshold) {
      // Found a good match - lock on
      this.currentPosition = matches[0].position;
      this.confidence = matches[0].score;

      if (this.noteBuffer.length >= this.config.minMatchesForLock) {
        this.mode = 'locked';
        this.consecutiveErrors = 0;

        return {
          detected: detectedNote,
          expected: this.song.notes[this.currentPosition] || '?',
          isCorrect: true, // We just synced, consider it correct
          position: this.currentPosition,
          mode: 'locked',
          confidence: this.confidence,
          consecutiveErrors: 0,
          message: `Synced! Position ${this.currentPosition}`,
        };
      }
    }

    return {
      detected: detectedNote,
      expected: '?',
      isCorrect: false,
      position: this.currentPosition,
      mode: 'syncing',
      confidence: matches.length > 0 ? matches[0].score : 0,
      consecutiveErrors: 0,
      message: 'Syncing...',
    };
  }

  /**
   * LOCKED mode: Validate notes as correct/wrong
   */
  private processLocked(detectedNote: string): NoteResult {
    // Expected note is NEXT position
    const expectedPosition = this.currentPosition + 1;

    if (expectedPosition >= this.song.notes.length) {
      // Song complete
      return {
        detected: detectedNote,
        expected: 'END',
        isCorrect: false,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: this.consecutiveErrors,
        message: 'Song complete!',
      };
    }

    const expectedNote = this.song.notes[expectedPosition];
    const isCorrect = notesMatch(detectedNote, expectedNote, this.config.allowOctaveEquivalence);

    if (isCorrect) {
      // Correct note - advance position
      this.currentPosition = expectedPosition;
      this.consecutiveErrors = 0;
      this.confidence = Math.min(1, this.confidence + 0.1);

      return {
        detected: detectedNote,
        expected: expectedNote,
        isCorrect: true,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: 0,
        message: `✓ Correct! Position ${this.currentPosition}`,
      };
    } else {
      // Wrong note - count error
      this.consecutiveErrors++;
      this.confidence = Math.max(0, this.confidence - 0.15);

      // In FORGIVING mode, advance position anyway
      if (!this.config.strictMode) {
        this.currentPosition = expectedPosition;
      }

      // Check if we should go to LOST mode
      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        this.mode = 'lost';
        return {
          detected: detectedNote,
          expected: expectedNote,
          isCorrect: false,
          position: this.currentPosition,
          mode: 'lost',
          confidence: this.confidence,
          consecutiveErrors: this.consecutiveErrors,
          message: `Lost sync after ${this.consecutiveErrors} errors. Re-syncing...`,
        };
      }

      const tryAgain = this.config.strictMode ? ' (try again)' : '';
      return {
        detected: detectedNote,
        expected: expectedNote,
        isCorrect: false,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: this.consecutiveErrors,
        message: `✗ Wrong! Expected ${expectedNote}${tryAgain}`,
      };
    }
  }

  /**
   * LOST mode: Try to re-sync
   */
  private processLost(detectedNote: string): NoteResult {
    // Clear buffer and try to sync again
    this.noteBuffer = [detectedNote];
    this.consecutiveErrors = 0;

    const matches = this.findMatchingPositions();

    if (matches.length > 0 && matches[0].score >= this.config.lockThreshold) {
      this.currentPosition = matches[0].position;
      this.confidence = matches[0].score;

      if (this.noteBuffer.length >= 2) { // Faster re-lock
        this.mode = 'locked';
        return {
          detected: detectedNote,
          expected: this.song.notes[this.currentPosition] || '?',
          isCorrect: true,
          position: this.currentPosition,
          mode: 'locked',
          confidence: this.confidence,
          consecutiveErrors: 0,
          message: `Re-synced at position ${this.currentPosition}`,
        };
      }
    }

    // Still trying to sync
    this.mode = 'syncing';
    return {
      detected: detectedNote,
      expected: '?',
      isCorrect: false,
      position: -1,
      mode: 'syncing',
      confidence: 0,
      consecutiveErrors: 0,
      message: 'Re-syncing...',
    };
  }

  /**
   * Find matching positions in song for current buffer
   */
  private findMatchingPositions(): Array<{ position: number; score: number }> {
    const buffer = this.noteBuffer;
    if (buffer.length === 0) return [];

    const songNotes = this.song.notes;
    const positions: Array<{ position: number; score: number }> = [];

    for (let startPos = 0; startPos <= songNotes.length - buffer.length; startPos++) {
      let matches = 0;
      let totalWeight = 0;

      for (let i = 0; i < buffer.length; i++) {
        const weight = (i + 1) / buffer.length; // Recent notes weighted higher
        totalWeight += weight;

        if (notesMatch(buffer[i], songNotes[startPos + i], this.config.allowOctaveEquivalence)) {
          matches += weight;
        }
      }

      const score = totalWeight > 0 ? matches / totalWeight : 0;

      if (score > 0.4) {
        positions.push({
          position: startPos + buffer.length - 1,
          score,
        });
      }
    }

    positions.sort((a, b) => b.score - a.score);
    return positions.slice(0, 5);
  }

  /**
   * Get current state
   */
  getState() {
    return {
      mode: this.mode,
      position: this.currentPosition,
      confidence: this.confidence,
      consecutiveErrors: this.consecutiveErrors,
      expectedNext: this.getExpectedNext(),
    };
  }

  /**
   * Get expected next note
   */
  getExpectedNext(): string | null {
    if (this.mode !== 'locked' || this.currentPosition < 0) {
      return null;
    }
    const nextPos = this.currentPosition + 1;
    if (nextPos >= this.song.notes.length) {
      return null;
    }
    return this.song.notes[nextPos];
  }

  /**
   * Get progress (0-1)
   */
  getProgress(): number {
    if (this.currentPosition < 0) return 0;
    return (this.currentPosition + 1) / this.song.notes.length;
  }
}
