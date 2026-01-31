/**
 * Score Follower - Automatic Song Position Detection
 *
 * Listens to notes being played and automatically syncs to the song position.
 * Can detect where in the song the user is, even if starting from the middle.
 *
 * Algorithm:
 * 1. Maintain a buffer of recently detected notes
 * 2. Slide this buffer across the song's note sequence
 * 3. Find the best matching position using pitch-class matching
 * 4. Track confidence and adjust position dynamically
 */

export interface SongNote {
  note: string;        // e.g., "C4", "E5"
  startTime: number;   // Start time in seconds
  duration: number;    // Duration in seconds
  index: number;       // Position in song (0-based)
}

export interface SongData {
  title: string;
  notes: SongNote[];
  bpm: number;
}

export interface FollowerState {
  currentPosition: number;       // Current estimated position in song (note index)
  confidence: number;            // 0-1, how confident we are about position
  matchedNotes: number;          // How many recent notes matched
  isLocked: boolean;             // True if we're confident about position
  detectedNotes: string[];       // Recent detected notes buffer
  possiblePositions: Array<{     // All candidate positions with scores
    position: number;
    score: number;
  }>;
}

export interface FollowerConfig {
  bufferSize: number;            // How many notes to keep in buffer (default: 5)
  lockThreshold: number;         // Confidence needed to lock position (default: 0.7)
  minMatchesForLock: number;     // Minimum matches to consider locking (default: 3)
}

const DEFAULT_CONFIG: FollowerConfig = {
  bufferSize: 5,
  lockThreshold: 0.7,
  minMatchesForLock: 3,
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

function getPitchClass(note: string): number {
  return noteToMidi(note) % 12;
}

function pitchClassesMatch(note1: string, note2: string): boolean {
  return getPitchClass(note1) === getPitchClass(note2);
}

/**
 * Score Follower class - tracks user's position in a song
 */
export class ScoreFollower {
  private song: SongData;
  private config: FollowerConfig;
  private state: FollowerState;

  constructor(song: SongData, config: Partial<FollowerConfig> = {}) {
    this.song = song;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.state = this.createInitialState();
  }

  private createInitialState(): FollowerState {
    return {
      currentPosition: -1,
      confidence: 0,
      matchedNotes: 0,
      isLocked: false,
      detectedNotes: [],
      possiblePositions: [],
    };
  }

  /**
   * Reset the follower state
   */
  reset(): void {
    this.state = this.createInitialState();
  }

  /**
   * Process a newly detected note
   * Returns the updated state with estimated position
   */
  processNote(detectedNote: string): FollowerState {
    // Add to buffer (keep last N notes)
    this.state.detectedNotes.push(detectedNote);
    if (this.state.detectedNotes.length > this.config.bufferSize) {
      this.state.detectedNotes.shift();
    }

    // Find best matching positions
    this.state.possiblePositions = this.findMatchingPositions();

    // Update position estimate
    this.updatePosition();

    return { ...this.state };
  }

  /**
   * Find all positions where the detected note buffer could match
   */
  private findMatchingPositions(): Array<{ position: number; score: number }> {
    const buffer = this.state.detectedNotes;
    if (buffer.length === 0) return [];

    const songNotes = this.song.notes.map(n => n.note);
    const positions: Array<{ position: number; score: number }> = [];

    // Slide buffer across song
    for (let startPos = 0; startPos <= songNotes.length - buffer.length; startPos++) {
      let matches = 0;
      let totalWeight = 0;

      for (let i = 0; i < buffer.length; i++) {
        // More recent notes have higher weight
        const weight = (i + 1) / buffer.length;
        totalWeight += weight;

        if (pitchClassesMatch(buffer[i], songNotes[startPos + i])) {
          matches += weight;
        }
      }

      const score = totalWeight > 0 ? matches / totalWeight : 0;

      if (score > 0.3) { // Only consider positions with >30% match
        positions.push({
          position: startPos + buffer.length - 1, // Position after matching buffer
          score,
        });
      }
    }

    // Sort by score descending
    positions.sort((a, b) => b.score - a.score);

    return positions.slice(0, 5); // Keep top 5 candidates
  }

  /**
   * Update current position based on matching positions
   */
  private updatePosition(): void {
    const candidates = this.state.possiblePositions;

    if (candidates.length === 0) {
      // No matches - reduce confidence
      this.state.confidence *= 0.8;
      if (this.state.confidence < 0.3) {
        this.state.isLocked = false;
      }
      return;
    }

    const best = candidates[0];

    // If we're already locked, prefer positions near current
    if (this.state.isLocked && this.state.currentPosition >= 0) {
      const nearbyCandidate = candidates.find(c =>
        Math.abs(c.position - this.state.currentPosition) <= 2 && c.score > 0.5
      );

      if (nearbyCandidate) {
        // Continue from nearby position
        this.state.currentPosition = nearbyCandidate.position;
        this.state.confidence = nearbyCandidate.score;
        this.state.matchedNotes++;
        return;
      }
    }

    // Check if best match is significantly better than others
    const secondBest = candidates[1];
    const isUnambiguous = !secondBest || (best.score - secondBest.score) > 0.2;

    // Update position
    this.state.currentPosition = best.position;
    this.state.confidence = best.score * (isUnambiguous ? 1 : 0.7);

    // Check if we should lock
    if (this.state.detectedNotes.length >= this.config.minMatchesForLock &&
        this.state.confidence >= this.config.lockThreshold) {
      this.state.isLocked = true;
      this.state.matchedNotes = this.state.detectedNotes.length;
    }
  }

  /**
   * Get expected next note based on current position
   */
  getExpectedNote(): SongNote | null {
    if (this.state.currentPosition < 0 || !this.state.isLocked) {
      return null;
    }

    const nextIndex = this.state.currentPosition + 1;
    if (nextIndex >= this.song.notes.length) {
      return null;
    }

    return this.song.notes[nextIndex];
  }

  /**
   * Get current state
   */
  getState(): FollowerState {
    return { ...this.state };
  }

  /**
   * Get song info
   */
  getSong(): SongData {
    return this.song;
  }

  /**
   * Get the note at a specific position
   */
  getNoteAt(position: number): SongNote | null {
    if (position < 0 || position >= this.song.notes.length) {
      return null;
    }
    return this.song.notes[position];
  }

  /**
   * Get progress through the song (0-1)
   */
  getProgress(): number {
    if (this.state.currentPosition < 0) return 0;
    return this.state.currentPosition / (this.song.notes.length - 1);
  }
}

/**
 * Create a simple song from a note sequence
 */
export function createSongFromNotes(
  title: string,
  notes: string[],
  bpm: number = 120
): SongData {
  const beatDuration = 60 / bpm; // seconds per beat

  return {
    title,
    bpm,
    notes: notes.map((note, index) => ({
      note,
      startTime: index * beatDuration,
      duration: beatDuration * 0.9, // 90% of beat
      index,
    })),
  };
}

// Example songs for testing
export const EXAMPLE_SONGS: Record<string, SongData> = {
  'fur_elise': createSongFromNotes('Für Elise', [
    'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',
    'C4', 'E4', 'A4', 'B4', 'E4', 'G#4', 'B4', 'C5',
    'E4', 'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',
  ], 80),

  'twinkle': createSongFromNotes('Twinkle Twinkle', [
    'C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4',
    'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4',
    'G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4',
    'G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4',
  ], 100),

  'happy_birthday': createSongFromNotes('Happy Birthday', [
    'C4', 'C4', 'D4', 'C4', 'F4', 'E4',
    'C4', 'C4', 'D4', 'C4', 'G4', 'F4',
    'C4', 'C4', 'C5', 'A4', 'F4', 'E4', 'D4',
    'A#4', 'A#4', 'A4', 'F4', 'G4', 'F4',
  ], 120),
};
