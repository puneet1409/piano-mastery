/**
 * Client-side score follower - matches detected notes to expected notes.
 * Works with FallingNote[] from the exercise.
 */

import { FallingNote } from "@/components/piano/FallingNotes";

export interface MatchResult {
  matched: boolean;
  noteIndex: number;
  note: string;
  timingStatus: "on_time" | "early" | "late";
  timingErrorMs: number;
  feedback: string;
}

export interface ScoreFollowerOptions {
  /** Timing tolerance for "on_time" status (ms) */
  onTimeToleranceMs?: number;
  /** Maximum timing window to accept a note (ms) */
  maxTimingWindowMs?: number;
  /** Callback when a note is matched */
  onMatch?: (result: MatchResult) => void;
  /** Callback when a wrong note is played */
  onWrongNote?: (note: string, expectedNotes: string[]) => void;
}

export class ClientScoreFollower {
  private notes: FallingNote[];
  private currentIndex: number = 0;
  private matchedIndices: Set<number> = new Set();
  private missedIndices: Set<number> = new Set();
  private options: Required<ScoreFollowerOptions>;

  constructor(notes: FallingNote[], options: ScoreFollowerOptions = {}) {
    this.notes = notes;
    this.options = {
      onTimeToleranceMs: options.onTimeToleranceMs ?? 150,
      maxTimingWindowMs: options.maxTimingWindowMs ?? 500,
      onMatch: options.onMatch ?? (() => {}),
      onWrongNote: options.onWrongNote ?? (() => {}),
    };
  }

  /**
   * Process a detected note at the given time.
   * @param detectedNote - Note name like "C4"
   * @param timestampMs - Time since exercise start in ms
   */
  processDetection(detectedNote: string, timestampMs: number): MatchResult | null {
    // Find candidates within the timing window
    const candidates: { note: FallingNote; index: number; delta: number }[] = [];

    // Log upcoming notes for debugging (exclude both matched AND missed)
    const upcomingNotes = this.notes
      .map((n, i) => ({ n, i }))
      .filter(({ i }) => !this.matchedIndices.has(i) && !this.missedIndices.has(i))
      .slice(0, 3)
      .map(({ n }) => `${n.note}@${n.expectedTimeMs.toFixed(0)}ms`);

    const progress = this.getProgress();
    console.log(`[SCORE] Checking ${detectedNote} @ t=${timestampMs.toFixed(0)}ms | pending: ${upcomingNotes.join(", ")} | matched=${progress.matched} missed=${progress.missed} | window=±${this.options.maxTimingWindowMs}ms`);

    for (let i = 0; i < this.notes.length; i++) {
      if (this.matchedIndices.has(i)) continue;
      if (this.missedIndices.has(i)) continue;

      const note = this.notes[i];
      const delta = timestampMs - note.expectedTimeMs;

      // Check if within timing window
      if (Math.abs(delta) <= this.options.maxTimingWindowMs) {
        // Check if note matches
        if (note.note === detectedNote) {
          console.log(`[SCORE] ✓ Candidate: ${note.note}[${i}] delta=${delta.toFixed(0)}ms`);
          candidates.push({ note, index: i, delta });
        } else {
          console.log(`[SCORE] ✗ In window but wrong note: expected ${note.note}, got ${detectedNote}`);
        }
      }
    }

    if (candidates.length === 0) {
      // Wrong note - find what was expected
      const expectedNotes = this.getExpectedNotes(timestampMs);
      console.log(`[SCORE] No match found. Expected: ${expectedNotes.join(", ")}`);
      this.options.onWrongNote(detectedNote, expectedNotes);
      return null;
    }

    // Pick the closest candidate by timing
    candidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    const best = candidates[0];

    this.matchedIndices.add(best.index);
    console.log(`[SCORE] ✓ MATCHED: ${best.note.note}[${best.index}] @ expected=${best.note.expectedTimeMs}ms, played=${timestampMs.toFixed(0)}ms, delta=${best.delta.toFixed(0)}ms`);

    // Determine timing status
    let timingStatus: "on_time" | "early" | "late" = "on_time";
    if (Math.abs(best.delta) > this.options.onTimeToleranceMs) {
      timingStatus = best.delta < 0 ? "early" : "late";
    }

    const result: MatchResult = {
      matched: true,
      noteIndex: best.index,
      note: detectedNote,
      timingStatus,
      timingErrorMs: Math.round(best.delta),
      feedback: `✓ ${detectedNote} (${timingStatus}${timingStatus !== "on_time" ? ` by ${Math.abs(Math.round(best.delta))}ms` : ""})`,
    };

    this.options.onMatch(result);

    // Advance current index
    while (this.matchedIndices.has(this.currentIndex) && this.currentIndex < this.notes.length) {
      this.currentIndex++;
    }

    return result;
  }

  /**
   * Get currently expected notes based on time.
   */
  getExpectedNotes(timestampMs: number): string[] {
    const expected: string[] = [];

    for (let i = 0; i < this.notes.length; i++) {
      if (this.matchedIndices.has(i)) continue;
      if (this.missedIndices.has(i)) continue;

      const note = this.notes[i];
      const delta = timestampMs - note.expectedTimeMs;

      // Notes that are due now or coming up soon
      if (delta >= -this.options.maxTimingWindowMs && delta <= this.options.maxTimingWindowMs) {
        expected.push(note.note);
      }

      // Only look ahead a bit
      if (expected.length >= 3) break;
    }

    return expected;
  }

  /**
   * Mark notes as missed if they're past the timing window.
   * Returns indices of newly missed notes.
   */
  advanceMissedNotes(timestampMs: number): number[] {
    const missed: number[] = [];

    for (let i = 0; i < this.notes.length; i++) {
      if (this.matchedIndices.has(i)) continue;
      if (this.missedIndices.has(i)) continue;

      const note = this.notes[i];
      const delta = timestampMs - note.expectedTimeMs;

      if (delta > this.options.maxTimingWindowMs) {
        this.missedIndices.add(i);
        missed.push(i);
        console.log(`[SCORE] ✗ MISSED: ${note.note}[${i}] @ ${note.expectedTimeMs}ms (delta=${delta.toFixed(0)}ms > ${this.options.maxTimingWindowMs}ms window)`);
      }
    }

    return missed;
  }

  /**
   * Get progress stats.
   */
  getProgress(): {
    total: number;
    matched: number;
    missed: number;
    pending: number;
    percentComplete: number;
  } {
    const total = this.notes.length;
    const matched = this.matchedIndices.size;
    const missed = this.missedIndices.size;
    const pending = total - matched - missed;

    return {
      total,
      matched,
      missed,
      pending,
      percentComplete: total > 0 ? Math.round((matched / total) * 100) : 0,
    };
  }

  /**
   * Reset the follower for replay.
   */
  reset(): void {
    this.currentIndex = 0;
    this.matchedIndices.clear();
    this.missedIndices.clear();
  }
}
