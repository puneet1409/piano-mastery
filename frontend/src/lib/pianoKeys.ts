import { PianoKey, NoteName, Octave } from '@/types/piano';

const NOTE_NAMES: NoteName[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function generatePianoKeys(startOctave: Octave, endOctave: Octave): PianoKey[] {
  const keys: PianoKey[] = [];
  let whiteKeyIndex = 0;

  for (let octave = startOctave; octave <= endOctave; octave++) {
    for (const noteName of NOTE_NAMES) {
      const note = `${noteName}${octave}`;
      const isBlack = noteName.includes('#');

      keys.push({
        note,
        noteName,
        octave: octave as Octave,
        isBlack,
        whiteKeyIndex: isBlack ? -1 : whiteKeyIndex,
      });

      if (!isBlack) {
        whiteKeyIndex++;
      }

      // Stop at C of next octave
      if (octave === endOctave && noteName === 'C') {
        break;
      }
    }
  }

  // Assign correct white key indices for black keys
  return keys.map((key, index) => {
    if (key.isBlack) {
      // Find previous white key's index
      const prevWhiteKey = keys.slice(0, index).reverse().find(k => !k.isBlack);
      return {
        ...key,
        whiteKeyIndex: prevWhiteKey ? prevWhiteKey.whiteKeyIndex : 0,
      };
    }
    return key;
  });
}

// Black key offset pattern (relative to white keys)
const BLACK_KEY_OFFSET_MAP: Record<NoteName, number> = {
  'C#': 0.65,
  'D#': 1.65,
  'F#': 3.65,
  'G#': 4.65,
  'A#': 5.65,
} as any;

export function calculateBlackKeyPosition(
  key: PianoKey,
  whiteKeyWidth: number,
  blackKeyWidth: number
): number {
  const baseNoteName = key.noteName.replace('#', '') as NoteName;
  const octaveOffset = key.octave - 3; // Assuming C3 is start

  // Pattern repeats every octave (7 white keys)
  const octaveWhiteKeys = 7;
  const patternOffset = BLACK_KEY_OFFSET_MAP[key.noteName] || 0;

  const totalOffset = (octaveOffset * octaveWhiteKeys) + patternOffset;

  return (totalOffset * whiteKeyWidth) - (blackKeyWidth / 2);
}

export function getWhiteKeys(keys: PianoKey[]): PianoKey[] {
  return keys.filter(k => !k.isBlack);
}

export function getBlackKeys(keys: PianoKey[]): PianoKey[] {
  return keys.filter(k => k.isBlack);
}

/**
 * Returns the X position (center) and width for a note, aligned with the keyboard layout.
 * Used by FallingNotes to align waterfall rectangles with piano keys.
 */
export function getNoteXPosition(
  noteStr: string,
  startOctave: number,
  whiteKeyWidth: number,
  blackKeyWidth: number,
): { x: number; width: number } | null {
  // Parse note string like "C4", "F#5"
  const match = noteStr.match(/^([A-G]#?)(\d+)$/);
  if (!match) return null;
  const [, name, octStr] = match;
  const octave = Number(octStr);
  const isBlack = name.includes('#');

  // White key index within octave
  const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const baseName = name.replace('#', '');
  const noteIndex = WHITE_NOTES.indexOf(baseName);
  if (noteIndex === -1) return null;

  const octaveOffset = octave - startOctave;
  const absoluteWhiteIndex = octaveOffset * 7 + noteIndex;

  if (isBlack) {
    // Black key: centered between the white key and a half-step offset
    const patternOffset = BLACK_KEY_OFFSET_MAP[name as NoteName] || 0;
    const totalOffset = (octaveOffset * 7) + patternOffset;
    const centerX = totalOffset * whiteKeyWidth;
    return { x: centerX, width: blackKeyWidth };
  }

  // White key: center of the white key
  const centerX = absoluteWhiteIndex * whiteKeyWidth + whiteKeyWidth / 2;
  return { x: centerX, width: whiteKeyWidth - 2 };
}

/**
 * Returns the Y position for a note in rail mode, where pitch maps to vertical position.
 * Higher pitches (e.g., C6) are at the top, lower pitches (e.g., C3) at the bottom.
 *
 * @param noteStr - Note string like "C4", "F#5"
 * @param startOctave - Lowest octave on keyboard
 * @param endOctave - Highest octave on keyboard
 * @param canvasHeight - Total canvas height in pixels
 * @param paddingTop - Padding from top edge
 * @param paddingBottom - Padding from bottom edge
 * @returns Y coordinate for the note center, or null if invalid
 */
export function getNoteYPosition(
  noteStr: string,
  startOctave: number,
  endOctave: number,
  canvasHeight: number,
  paddingTop: number = 20,
  paddingBottom: number = 20,
): number | null {
  // Parse note string like "C4", "F#5"
  const match = noteStr.match(/^([A-G]#?)(\d+)$/);
  if (!match) return null;
  const [, name, octStr] = match;
  const octave = Number(octStr);

  // MIDI-like note number (C4 = 60, C#4 = 61, etc.)
  const NOTE_SEMITONES: Record<string, number> = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
  };

  const semitone = NOTE_SEMITONES[name];
  if (semitone === undefined) return null;

  const noteNumber = octave * 12 + semitone;
  const minNoteNumber = startOctave * 12; // C of start octave
  const maxNoteNumber = (endOctave + 1) * 12; // C of octave after end

  // Normalize to 0-1 range (0 = lowest, 1 = highest)
  const normalizedPitch = (noteNumber - minNoteNumber) / (maxNoteNumber - minNoteNumber);

  // Map to canvas Y (invert: high pitch = low Y = top of screen)
  const usableHeight = canvasHeight - paddingTop - paddingBottom;
  const y = paddingTop + usableHeight * (1 - normalizedPitch);

  return y;
}
