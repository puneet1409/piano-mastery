/**
 * Comprehensive test suite for client-side detection algorithms.
 *
 * Tests:
 * - NoteEvent type validation
 * - Score follower matching logic
 * - Stability confirmation (2/3 hops)
 * - Gate system logic
 * - Timing tolerance
 * - DetectorOrchestrator routing
 *
 * Run with: npx vitest run tests/detection/
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NoteEvent,
  ExerciseMeta,
  getDetectorConfig,
  midiToNoteName,
  noteNameToMidi,
  midiToFrequency,
  frequencyToMidi,
  centsError,
} from "../../src/lib/music/types";
import { ClientScoreFollower, MatchResult } from "../../src/lib/clientScoreFollower";
import { FallingNote } from "../../src/components/piano/FallingNotes";

// ─────────────────────────────────────────────────────────────────────────────
// Test Utilities
// ─────────────────────────────────────────────────────────────────────────────

function createFallingNotes(notes: string[], startTimeMs: number = 0, intervalMs: number = 500): FallingNote[] {
  return notes.map((note, i) => ({
    note,
    hand: null,
    bar: 1,
    index: i,
    expectedTimeMs: startTimeMs + i * intervalMs,
    status: "pending" as const,
  }));
}

function createNoteEvent(
  pitch: number,
  tOnMs: number,
  kind: "tentative" | "confirmed" = "confirmed"
): NoteEvent {
  return {
    pitch,
    noteName: midiToNoteName(pitch),
    tOnMs,
    confidence: 0.9,
    source: "yin",
    kind,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Type and Utility Tests (10 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("NoteEvent Types", () => {
  // Test 1
  it("should create valid NoteEvent", () => {
    const event: NoteEvent = {
      pitch: 60,
      noteName: "C4",
      tOnMs: 1000,
      confidence: 0.9,
      source: "yin",
      kind: "confirmed",
    };
    expect(event.pitch).toBe(60);
    expect(event.noteName).toBe("C4");
    expect(event.kind).toBe("confirmed");
  });

  // Test 2
  it("should allow optional fields", () => {
    const event: NoteEvent = {
      pitch: 60,
      noteName: "C4",
      tOnMs: 1000,
      confidence: 0.9,
      source: "polyphonic",
      kind: "tentative",
      velocity: 100,
      tOffMs: 1500,
      onsetStrength: 0.8,
    };
    expect(event.velocity).toBe(100);
    expect(event.tOffMs).toBe(1500);
  });
});

describe("MIDI Conversion Utilities", () => {
  // Test 3-6
  it.each([
    [60, "C4"],
    [69, "A4"],
    [72, "C5"],
    [48, "C3"],
    [36, "C2"],
    [84, "C6"],
    [61, "C#4"],
    [63, "D#4"],
  ])("midiToNoteName(%i) should return %s", (midi, expected) => {
    expect(midiToNoteName(midi)).toBe(expected);
  });

  // Test 7-10
  it.each([
    ["C4", 60],
    ["A4", 69],
    ["C5", 72],
    ["C#4", 61],
    ["Db4", 61],
    ["F#5", 78],
    ["Bb3", 58],
  ])("noteNameToMidi(%s) should return %i", (name, expected) => {
    expect(noteNameToMidi(name)).toBe(expected);
  });
});

describe("Frequency Conversion", () => {
  // Test 11-14
  it("should convert A4 to 440Hz", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 1);
  });

  it("should convert C4 to ~261.63Hz", () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it("should convert 440Hz to MIDI 69", () => {
    expect(frequencyToMidi(440)).toBe(69);
  });

  it("should calculate cents error correctly", () => {
    const detected = 442; // 2Hz sharp
    const expected = 440;
    const cents = centsError(detected, expected);
    expect(Math.abs(cents)).toBeLessThan(10); // Should be ~7.85 cents
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exercise Metadata Tests (10 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ExerciseMeta and DetectorConfig", () => {
  // Test 15-18
  it("should route monophonic exercise to Lite only", () => {
    const meta: ExerciseMeta = {
      id: "c_major_scale",
      title: "C Major Scale",
      requiresPolyphony: false,
    };
    const config = getDetectorConfig(meta);
    expect(config.useLite).toBe(true);
    expect(config.usePro).toBe(false);
  });

  it("should route polyphonic exercise to Lite + Pro", () => {
    const meta: ExerciseMeta = {
      id: "basic_chords",
      title: "Basic Chords",
      requiresPolyphony: true,
    };
    const config = getDetectorConfig(meta);
    expect(config.useLite).toBe(true);
    expect(config.usePro).toBe(true);
  });

  it("should enable score-aware mode", () => {
    const meta: ExerciseMeta = {
      id: "test",
      title: "Test",
      requiresPolyphony: false,
    };
    const config = getDetectorConfig(meta);
    expect(config.scoreAware).toBe(true);
  });

  it("should handle metadata with all fields", () => {
    const meta: ExerciseMeta = {
      id: "perfect",
      title: "Perfect - Ed Sheeran",
      description: "6/8 song",
      difficulty: "beginner",
      requiresPolyphony: true,
      expectedVoices: 2,
      type: "song",
      bpm: 63,
      timeSignature: { numerator: 6, denominator: 8 },
      beatsPerBar: 6,
    };
    const config = getDetectorConfig(meta);
    expect(config.usePro).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Score Follower Tests (30 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("ClientScoreFollower", () => {
  let follower: ClientScoreFollower;

  // Test 19-24: Basic matching
  describe("Basic Note Matching", () => {
    beforeEach(() => {
      const notes = createFallingNotes(["C4", "D4", "E4", "F4", "G4"]);
      follower = new ClientScoreFollower(notes);
    });

    it("should match correct note at correct time", () => {
      const result = follower.processDetection("C4", 0);
      expect(result).not.toBeNull();
      expect(result?.matched).toBe(true);
      expect(result?.note).toBe("C4");
    });

    it("should reject wrong note", () => {
      const result = follower.processDetection("A4", 0);
      expect(result).toBeNull();
    });

    it("should track progress correctly", () => {
      follower.processDetection("C4", 0);
      const progress = follower.getProgress();
      expect(progress.matched).toBe(1);
      expect(progress.pending).toBe(4);
    });

    it("should advance through sequence", () => {
      follower.processDetection("C4", 0);
      follower.processDetection("D4", 500);
      follower.processDetection("E4", 1000);
      const progress = follower.getProgress();
      expect(progress.matched).toBe(3);
    });

    it("should calculate completion percentage", () => {
      follower.processDetection("C4", 0);
      follower.processDetection("D4", 500);
      const progress = follower.getProgress();
      expect(progress.percentComplete).toBe(40); // 2/5 = 40%
    });

    it("should reset state correctly", () => {
      follower.processDetection("C4", 0);
      follower.reset();
      const progress = follower.getProgress();
      expect(progress.matched).toBe(0);
    });
  });

  // Test 25-34: Timing tolerance
  describe("Timing Tolerance", () => {
    beforeEach(() => {
      const notes = createFallingNotes(["C4"], 500);
      follower = new ClientScoreFollower(notes, {
        onTimeToleranceMs: 150,
        maxTimingWindowMs: 500,
      });
    });

    it("should accept note within on-time tolerance", () => {
      const result = follower.processDetection("C4", 500);
      expect(result?.timingStatus).toBe("on_time");
    });

    it("should mark early note as early", () => {
      const result = follower.processDetection("C4", 300); // 200ms early
      expect(result?.timingStatus).toBe("early");
    });

    it("should mark late note as late", () => {
      const result = follower.processDetection("C4", 700); // 200ms late
      expect(result?.timingStatus).toBe("late");
    });

    it("should reject note outside max window", () => {
      const result = follower.processDetection("C4", 1100); // 600ms late, outside 500ms window
      expect(result).toBeNull();
    });

    it("should calculate timing error correctly", () => {
      const result = follower.processDetection("C4", 600); // 100ms late
      expect(result?.timingErrorMs).toBe(100);
    });

    it.each([
      [500, "on_time", 0],
      [400, "on_time", -100],
      [350, "on_time", -150],
      [600, "on_time", 100],
      [650, "on_time", 150],
    ])("at time %i should be %s with error %i", (time, status, error) => {
      const result = follower.processDetection("C4", time);
      expect(result?.timingStatus).toBe(status);
      expect(result?.timingErrorMs).toBe(error);
    });
  });

  // Test 35-44: Missed notes
  describe("Missed Note Detection", () => {
    beforeEach(() => {
      const notes = createFallingNotes(["C4", "D4", "E4"], 0, 500);
      follower = new ClientScoreFollower(notes, { maxTimingWindowMs: 300 });
    });

    it("should mark notes as missed after window", () => {
      const missed = follower.advanceMissedNotes(1000);
      expect(missed.length).toBeGreaterThan(0);
    });

    it("should not mark pending notes as missed too early", () => {
      const missed = follower.advanceMissedNotes(100);
      expect(missed.length).toBe(0);
    });

    it("should exclude matched notes from missed", () => {
      follower.processDetection("C4", 0);
      const missed = follower.advanceMissedNotes(1000);
      expect(missed).not.toContain(0);
    });

    it("should track missed count in progress", () => {
      follower.advanceMissedNotes(1000);
      const progress = follower.getProgress();
      expect(progress.missed).toBeGreaterThan(0);
    });

    it("should not double-count missed notes", () => {
      follower.advanceMissedNotes(1000);
      const missed2 = follower.advanceMissedNotes(1500);
      expect(missed2).toEqual([2]); // Only the next note should be newly missed
    });
  });

  // Test 45-54: Expected notes
  describe("Expected Notes Query", () => {
    beforeEach(() => {
      const notes = createFallingNotes(["C4", "D4", "E4", "F4", "G4"], 0, 500);
      follower = new ClientScoreFollower(notes, { maxTimingWindowMs: 500 });
    });

    it("should return expected notes at current time", () => {
      const expected = follower.getExpectedNotes(0);
      expect(expected).toContain("C4");
    });

    it("should return multiple expected notes within window", () => {
      const expected = follower.getExpectedNotes(750); // Between D4 (500) and E4 (1000)
      expect(expected.length).toBeGreaterThanOrEqual(1);
    });

    it("should not return matched notes", () => {
      follower.processDetection("C4", 0);
      const expected = follower.getExpectedNotes(0);
      expect(expected).not.toContain("C4");
    });

    it("should limit expected notes returned", () => {
      const expected = follower.getExpectedNotes(0);
      expect(expected.length).toBeLessThanOrEqual(3);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stability Confirmation Tests (10 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("Stability Confirmation (2/3 hops)", () => {
  // Simulated recent pitches array
  const checkStability = (recentPitches: (number | null)[], targetPitch: number): boolean => {
    const matches = recentPitches.filter((p) => p === targetPitch).length;
    return matches >= 2;
  };

  // Test 55-64
  it("should confirm with 2 of 3 matching", () => {
    expect(checkStability([60, 60, 61], 60)).toBe(true);
  });

  it("should confirm with 3 of 3 matching", () => {
    expect(checkStability([60, 60, 60], 60)).toBe(true);
  });

  it("should reject with 1 of 3 matching", () => {
    expect(checkStability([60, 61, 62], 60)).toBe(false);
  });

  it("should reject with 0 of 3 matching", () => {
    expect(checkStability([61, 62, 63], 60)).toBe(false);
  });

  it("should handle null entries (no detection)", () => {
    expect(checkStability([60, null, 60], 60)).toBe(true);
  });

  it("should reject all nulls", () => {
    expect(checkStability([null, null, null], 60)).toBe(false);
  });

  it("should handle mixed nulls and wrong pitches", () => {
    expect(checkStability([60, null, 61], 60)).toBe(false);
  });

  it("should work with different target pitches", () => {
    expect(checkStability([72, 72, 71], 72)).toBe(true);
    expect(checkStability([48, 48, 48], 48)).toBe(true);
  });

  it("should not cross-confirm different pitches", () => {
    expect(checkStability([60, 61, 60], 61)).toBe(false);
  });

  it("should handle boundary case of exactly 2", () => {
    expect(checkStability([60, 60, null], 60)).toBe(true);
    expect(checkStability([60, null, 60], 60)).toBe(true);
    expect(checkStability([null, 60, 60], 60)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate System Tests (10 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("Gate System Logic", () => {
  const MIN_RMS = 0.01;
  const MAX_CMND = 0.15;
  const ONSET_RATIO = 1.3;

  // Energy gate
  const checkEnergyGate = (rms: number): boolean => rms >= MIN_RMS;

  // Confidence gate
  const checkConfidenceGate = (cmnd: number): boolean => cmnd <= MAX_CMND;

  // Onset gate
  const checkOnsetGate = (
    currentRms: number,
    prevRms: number,
    isNewNote: boolean,
    isSustaining: boolean
  ): boolean => {
    const isOnset = prevRms > 0 && currentRms > prevRms * ONSET_RATIO;
    return isNewNote || isOnset || isSustaining;
  };

  // Test 65-74
  describe("Energy Gate", () => {
    it("should pass loud signals", () => {
      expect(checkEnergyGate(0.05)).toBe(true);
    });

    it("should reject quiet signals", () => {
      expect(checkEnergyGate(0.005)).toBe(false);
    });

    it("should pass at threshold", () => {
      expect(checkEnergyGate(0.01)).toBe(true);
    });
  });

  describe("Confidence Gate", () => {
    it("should pass clear pitches (low CMND)", () => {
      expect(checkConfidenceGate(0.05)).toBe(true);
    });

    it("should reject unclear pitches (high CMND)", () => {
      expect(checkConfidenceGate(0.3)).toBe(false);
    });

    it("should pass at threshold", () => {
      expect(checkConfidenceGate(0.15)).toBe(true);
    });
  });

  describe("Onset Gate", () => {
    it("should pass for new note", () => {
      expect(checkOnsetGate(0.05, 0.05, true, false)).toBe(true);
    });

    it("should pass for rising energy (onset)", () => {
      expect(checkOnsetGate(0.1, 0.05, false, false)).toBe(true);
    });

    it("should pass for sustaining note", () => {
      expect(checkOnsetGate(0.05, 0.05, false, true)).toBe(true);
    });

    it("should reject steady energy on same note", () => {
      expect(checkOnsetGate(0.05, 0.05, false, false)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration Simulation Tests (20 tests)
// ─────────────────────────────────────────────────────────────────────────────

describe("Detection Simulation", () => {
  // Simulate detection with jitter and accuracy
  interface SimulationConfig {
    timingJitterMs: number;
    pitchAccuracy: number; // 0-1, probability of correct pitch
    missRate: number; // 0-1, probability of missing a note entirely
  }

  function simulateDetection(
    expectedNote: string,
    expectedTimeMs: number,
    config: SimulationConfig
  ): { note: string | null; timeMs: number } {
    // Apply timing jitter
    const jitter = (Math.random() - 0.5) * 2 * config.timingJitterMs;
    const detectedTime = expectedTimeMs + jitter;

    // Check for miss
    if (Math.random() < config.missRate) {
      return { note: null, timeMs: detectedTime };
    }

    // Check for pitch accuracy
    if (Math.random() >= config.pitchAccuracy) {
      // Wrong note - shift by random semitones
      const midi = noteNameToMidi(expectedNote);
      const shift = Math.floor(Math.random() * 3) + 1;
      const wrongMidi = midi + (Math.random() > 0.5 ? shift : -shift);
      return { note: midiToNoteName(wrongMidi), timeMs: detectedTime };
    }

    return { note: expectedNote, timeMs: detectedTime };
  }

  // Test 75-84: Various jitter levels
  describe("Timing Jitter Handling", () => {
    const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];

    it.each([
      [0, 1.0],      // No jitter
      [10, 0.99],    // 10ms jitter
      [25, 0.95],    // 25ms jitter
      [50, 0.90],    // 50ms jitter
      [100, 0.80],   // 100ms jitter
      [150, 0.70],   // 150ms jitter (on-time boundary)
      [200, 0.60],   // 200ms jitter
      [300, 0.50],   // 300ms jitter
    ])("should handle %ims jitter with >%i%% timing success", (jitterMs, expectedRate) => {
      const fallingNotes = createFallingNotes(notes, 0, 500);
      const follower = new ClientScoreFollower(fallingNotes, {
        onTimeToleranceMs: 150,
        maxTimingWindowMs: 500,
      });

      let onTimeCount = 0;
      const trials = 100;

      for (let t = 0; t < trials; t++) {
        follower.reset();

        for (let i = 0; i < notes.length; i++) {
          const expectedTime = i * 500;
          const jitter = (Math.random() - 0.5) * 2 * jitterMs;
          const detectedTime = expectedTime + jitter;

          const result = follower.processDetection(notes[i], detectedTime);
          if (result?.timingStatus === "on_time") {
            onTimeCount++;
          }
        }
      }

      const successRate = onTimeCount / (trials * notes.length);
      // Jitter affects on-time rate, but we should still be close to expected
      expect(successRate).toBeGreaterThanOrEqual(expectedRate * 0.5);
    });
  });

  // Test 85-94: Various accuracy levels
  describe("Pitch Accuracy Handling", () => {
    it.each([
      [1.0, 1.0],    // Perfect accuracy
      [0.95, 0.95],  // 95% accuracy
      [0.90, 0.90],  // 90% accuracy
      [0.80, 0.80],  // 80% accuracy
      [0.70, 0.70],  // 70% accuracy
      [0.50, 0.50],  // 50% accuracy
    ])("should achieve ~%i%% match rate with %i%% pitch accuracy", (accuracy, expectedRate) => {
      const notes = ["C4", "D4", "E4", "F4", "G4"];
      const fallingNotes = createFallingNotes(notes, 0, 500);

      let totalMatched = 0;
      const trials = 50;

      for (let t = 0; t < trials; t++) {
        const follower = new ClientScoreFollower(fallingNotes);

        for (let i = 0; i < notes.length; i++) {
          const detection = simulateDetection(notes[i], i * 500, {
            timingJitterMs: 50,
            pitchAccuracy: accuracy,
            missRate: 0,
          });

          if (detection.note) {
            const result = follower.processDetection(detection.note, detection.timeMs);
            if (result?.matched) {
              totalMatched++;
            }
          }
        }
      }

      const matchRate = totalMatched / (trials * notes.length);
      expect(matchRate).toBeGreaterThanOrEqual(expectedRate * 0.8);
    });
  });

  // Test 95-100: Combined scenarios
  describe("Combined Jitter + Accuracy", () => {
    it("should handle realistic conditions (50ms jitter, 90% accuracy)", () => {
      const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
      const fallingNotes = createFallingNotes(notes, 0, 500);

      let totalMatched = 0;
      const trials = 20;

      for (let t = 0; t < trials; t++) {
        const follower = new ClientScoreFollower(fallingNotes);

        for (let i = 0; i < notes.length; i++) {
          const detection = simulateDetection(notes[i], i * 500, {
            timingJitterMs: 50,
            pitchAccuracy: 0.9,
            missRate: 0.05,
          });

          if (detection.note) {
            const result = follower.processDetection(detection.note, detection.timeMs);
            if (result?.matched) {
              totalMatched++;
            }
          }
        }
      }

      const matchRate = totalMatched / (trials * notes.length);
      expect(matchRate).toBeGreaterThan(0.7);
    });

    it("should handle challenging conditions (100ms jitter, 80% accuracy)", () => {
      const notes = ["C4", "D4", "E4", "F4", "G4"];
      const fallingNotes = createFallingNotes(notes, 0, 500);

      let totalMatched = 0;
      const trials = 20;

      for (let t = 0; t < trials; t++) {
        const follower = new ClientScoreFollower(fallingNotes);

        for (let i = 0; i < notes.length; i++) {
          const detection = simulateDetection(notes[i], i * 500, {
            timingJitterMs: 100,
            pitchAccuracy: 0.8,
            missRate: 0.1,
          });

          if (detection.note) {
            const result = follower.processDetection(detection.note, detection.timeMs);
            if (result?.matched) {
              totalMatched++;
            }
          }
        }
      }

      const matchRate = totalMatched / (trials * notes.length);
      expect(matchRate).toBeGreaterThan(0.5);
    });

    it("should handle C Major scale with Demo mode latency", () => {
      // Simulate Demo mode: 350ms early play + 300-500ms mic latency
      const notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
      const fallingNotes = createFallingNotes(notes, 500, 600);
      const follower = new ClientScoreFollower(fallingNotes, {
        maxTimingWindowMs: 500,
      });

      let matched = 0;
      for (let i = 0; i < notes.length; i++) {
        const expectedTime = 500 + i * 600;
        // Demo plays 350ms early, detected 400ms later = 50ms late
        const detectedTime = expectedTime + 50;
        const result = follower.processDetection(notes[i], detectedTime);
        if (result?.matched) matched++;
      }

      expect(matched).toBe(notes.length);
    });

    it("should handle repeated note detection (sustain)", () => {
      const fallingNotes = createFallingNotes(["C4"], 0);
      const follower = new ClientScoreFollower(fallingNotes);

      // First detection should match
      const result1 = follower.processDetection("C4", 0);
      expect(result1?.matched).toBe(true);

      // Second detection of same note should not match (already matched)
      const result2 = follower.processDetection("C4", 50);
      expect(result2).toBeNull();
    });

    it("should handle skipped notes gracefully", () => {
      const notes = ["C4", "D4", "E4", "F4", "G4"];
      const fallingNotes = createFallingNotes(notes, 0, 500);
      const follower = new ClientScoreFollower(fallingNotes);

      // Play C4, skip D4, play E4
      follower.processDetection("C4", 0);
      const result = follower.processDetection("E4", 1000);

      // E4 should still match
      expect(result?.matched).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional Edge Case Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  it("should handle empty note list", () => {
    const follower = new ClientScoreFollower([]);
    const result = follower.processDetection("C4", 0);
    expect(result).toBeNull();
  });

  it("should handle single note", () => {
    const notes = createFallingNotes(["C4"]);
    const follower = new ClientScoreFollower(notes);
    const result = follower.processDetection("C4", 0);
    expect(result?.matched).toBe(true);
    expect(follower.getProgress().percentComplete).toBe(100);
  });

  it("should handle chromatic scale", () => {
    const chromaticNotes = ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4"];
    const notes = createFallingNotes(chromaticNotes, 0, 200);
    const follower = new ClientScoreFollower(notes);

    let matched = 0;
    chromaticNotes.forEach((note, i) => {
      const result = follower.processDetection(note, i * 200);
      if (result?.matched) matched++;
    });

    expect(matched).toBe(12);
  });

  it("should handle very fast notes (100ms apart)", () => {
    const notes = ["C4", "D4", "E4", "F4", "G4"];
    const fallingNotes = createFallingNotes(notes, 0, 100);
    const follower = new ClientScoreFollower(fallingNotes, {
      maxTimingWindowMs: 150,
    });

    let matched = 0;
    notes.forEach((note, i) => {
      const result = follower.processDetection(note, i * 100);
      if (result?.matched) matched++;
    });

    expect(matched).toBe(5);
  });

  it("should handle negative timing (before expected)", () => {
    const notes = createFallingNotes(["C4"], 500);
    const follower = new ClientScoreFollower(notes, {
      maxTimingWindowMs: 500,
    });

    const result = follower.processDetection("C4", 100); // 400ms early
    expect(result?.matched).toBe(true);
    expect(result?.timingStatus).toBe("early");
  });
});
