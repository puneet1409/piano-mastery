export type NoteName =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type Octave = 3 | 4 | 5 | 6;

export interface PianoKey {
  note: string;        // e.g., "C4"
  noteName: NoteName;
  octave: Octave;
  isBlack: boolean;
  whiteKeyIndex: number; // For positioning (0-based)
}

export type KeyBaseState = 'idle' | 'expected' | 'disabled';
export type KeyOverlay = null | 'pressed' | 'hitCorrect' | 'hitWrong';

export const OVERLAY_DURATIONS = {
  pressed: 80,
  hitCorrect: 300,
  hitWrong: 250,
} as const;
