/**
 * Test suite for YIN pitch detection
 * Tests both the original clientYinDetector and the AudioWorklet version
 * using synthetic audio (sine waves at known frequencies)
 */

import { detectPitch, noteToMidi } from './clientYinDetector';

// Generate a sine wave at a given frequency
function generateSineWave(
  frequency: number,
  sampleRate: number = 44100,
  duration: number = 0.1, // 100ms
  amplitude: number = 0.5
): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }

  return samples;
}

// Generate a piano-like tone with harmonics
function generatePianoTone(
  fundamental: number,
  sampleRate: number = 44100,
  duration: number = 0.1,
  amplitude: number = 0.3
): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  // Piano has strong fundamental and decreasing harmonics
  const harmonicAmplitudes = [1.0, 0.5, 0.25, 0.125, 0.0625];

  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    for (let h = 0; h < harmonicAmplitudes.length; h++) {
      const freq = fundamental * (h + 1);
      if (freq < sampleRate / 2) { // Below Nyquist
        sample += harmonicAmplitudes[h] * Math.sin(2 * Math.PI * freq * i / sampleRate);
      }
    }
    // Apply simple envelope (attack/decay)
    const envelope = Math.exp(-3 * i / numSamples);
    samples[i] = amplitude * sample * envelope;
  }

  return samples;
}

// Note frequencies for testing
const NOTE_FREQUENCIES: Record<string, number> = {
  'C3': 130.81,
  'D3': 146.83,
  'E3': 164.81,
  'F3': 174.61,
  'G3': 196.00,
  'A3': 220.00,
  'B3': 246.94,
  'C4': 261.63,
  'D4': 293.66,
  'E4': 329.63,
  'F4': 349.23,
  'G4': 392.00,
  'A4': 440.00,
  'B4': 493.88,
  'C5': 523.25,
  'D5': 587.33,
  'E5': 659.25,
};

function frequencyToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNoteName(midi: number): string {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

// Test results
interface TestResult {
  note: string;
  frequency: number;
  detected: string | null;
  detectedFreq: number | null;
  passed: boolean;
  error?: string;
}

function runTests(): { results: TestResult[], passed: number, failed: number } {
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log('=== YIN Pitch Detection Test Suite ===\n');

  // Test 1: Pure sine waves (C4 to C5 scale)
  console.log('Test 1: Pure Sine Waves (C4-C5)');
  console.log('-'.repeat(50));

  const scaleNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

  for (const note of scaleNotes) {
    const freq = NOTE_FREQUENCIES[note];
    const samples = generateSineWave(freq, 44100, 0.1, 0.5);
    const detection = detectPitch(samples, 44100);

    const result: TestResult = {
      note,
      frequency: freq,
      detected: detection?.note ?? null,
      detectedFreq: detection?.frequency ?? null,
      passed: false,
    };

    if (detection) {
      // Allow ±1 semitone tolerance
      const expectedMidi = noteToMidi(note);
      const detectedMidi = detection.midiPitch;
      const midiDiff = Math.abs(expectedMidi - detectedMidi);

      result.passed = midiDiff <= 1;
      if (!result.passed) {
        result.error = `Expected ${note} (MIDI ${expectedMidi}), got ${detection.note} (MIDI ${detectedMidi})`;
      }
    } else {
      result.error = 'No detection';
    }

    results.push(result);

    if (result.passed) {
      passed++;
      console.log(`✓ ${note} (${freq.toFixed(1)}Hz) → ${result.detected} (${result.detectedFreq?.toFixed(1)}Hz)`);
    } else {
      failed++;
      console.log(`✗ ${note} (${freq.toFixed(1)}Hz) → ${result.detected ?? 'NONE'} | ${result.error}`);
    }
  }

  // Test 2: Piano-like tones with harmonics
  console.log('\nTest 2: Piano Tones with Harmonics (C4-C5)');
  console.log('-'.repeat(50));

  for (const note of scaleNotes) {
    const freq = NOTE_FREQUENCIES[note];
    const samples = generatePianoTone(freq, 44100, 0.1, 0.3);
    const detection = detectPitch(samples, 44100);

    const result: TestResult = {
      note,
      frequency: freq,
      detected: detection?.note ?? null,
      detectedFreq: detection?.frequency ?? null,
      passed: false,
    };

    if (detection) {
      const expectedMidi = noteToMidi(note);
      const detectedMidi = detection.midiPitch;
      const midiDiff = Math.abs(expectedMidi - detectedMidi);

      result.passed = midiDiff <= 1;
      if (!result.passed) {
        result.error = `Expected ${note} (MIDI ${expectedMidi}), got ${detection.note} (MIDI ${detectedMidi})`;
      }
    } else {
      result.error = 'No detection';
    }

    results.push(result);

    if (result.passed) {
      passed++;
      console.log(`✓ ${note} (${freq.toFixed(1)}Hz) → ${result.detected} (${result.detectedFreq?.toFixed(1)}Hz)`);
    } else {
      failed++;
      console.log(`✗ ${note} (${freq.toFixed(1)}Hz) → ${result.detected ?? 'NONE'} | ${result.error}`);
    }
  }

  // Test 3: Lower octave (potential octave error zone)
  console.log('\nTest 3: Lower Octave C3-B3 (Octave Error Zone)');
  console.log('-'.repeat(50));

  const lowerNotes = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3'];

  for (const note of lowerNotes) {
    const freq = NOTE_FREQUENCIES[note];
    const samples = generatePianoTone(freq, 44100, 0.1, 0.3);
    const detection = detectPitch(samples, 44100);

    const result: TestResult = {
      note,
      frequency: freq,
      detected: detection?.note ?? null,
      detectedFreq: detection?.frequency ?? null,
      passed: false,
    };

    if (detection) {
      const expectedMidi = noteToMidi(note);
      const detectedMidi = detection.midiPitch;
      const midiDiff = Math.abs(expectedMidi - detectedMidi);

      // For C3 range, we expect it might be rejected or octave-corrected up
      // Count as pass if within 1 semitone OR if it detected the octave-up version
      const octaveUpMidi = expectedMidi + 12;
      result.passed = midiDiff <= 1 || Math.abs(octaveUpMidi - detectedMidi) <= 1;

      if (!result.passed) {
        result.error = `Expected ${note} or octave up, got ${detection.note}`;
      }
    } else {
      // For very low notes, no detection is acceptable
      result.passed = freq < 140; // Below ~C#3
      if (!result.passed) {
        result.error = 'No detection';
      }
    }

    results.push(result);

    if (result.passed) {
      passed++;
      console.log(`✓ ${note} (${freq.toFixed(1)}Hz) → ${result.detected ?? 'rejected'} (${result.detectedFreq?.toFixed(1) ?? 'N/A'}Hz)`);
    } else {
      failed++;
      console.log(`✗ ${note} (${freq.toFixed(1)}Hz) → ${result.detected ?? 'NONE'} | ${result.error}`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed (${(passed / (passed + failed) * 100).toFixed(1)}%)`);
  console.log('='.repeat(50));

  return { results, passed, failed };
}

// Run if called directly
if (typeof window === 'undefined') {
  // Node.js environment - but this file uses browser APIs
  console.log('Note: This test requires a browser environment or ts-node with DOM polyfills');
  console.log('Run with: npx vitest run src/lib/yinDetector.test.ts');
}

// Export for vitest
export { runTests, generateSineWave, generatePianoTone, NOTE_FREQUENCIES };

// Vitest test cases
import { describe, it, expect } from 'vitest';

describe('YIN Pitch Detection', () => {
  describe('Pure Sine Waves', () => {
    const scaleNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

    for (const note of scaleNotes) {
      it(`detects ${note} correctly`, () => {
        const freq = NOTE_FREQUENCIES[note];
        const samples = generateSineWave(freq, 44100, 0.1, 0.5);
        const detection = detectPitch(samples, 44100);

        expect(detection).not.toBeNull();
        if (detection) {
          const expectedMidi = noteToMidi(note);
          const midiDiff = Math.abs(expectedMidi - detection.midiPitch);
          expect(midiDiff).toBeLessThanOrEqual(1);
        }
      });
    }
  });

  describe('Piano Tones with Harmonics', () => {
    const scaleNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];

    for (const note of scaleNotes) {
      it(`detects ${note} piano tone correctly`, () => {
        const freq = NOTE_FREQUENCIES[note];
        const samples = generatePianoTone(freq, 44100, 0.1, 0.3);
        const detection = detectPitch(samples, 44100);

        expect(detection).not.toBeNull();
        if (detection) {
          const expectedMidi = noteToMidi(note);
          const midiDiff = Math.abs(expectedMidi - detection.midiPitch);
          expect(midiDiff).toBeLessThanOrEqual(1);
        }
      });
    }
  });

  describe('Octave Error Prevention', () => {
    it('should not detect C3 when C4 is playing', () => {
      const freq = NOTE_FREQUENCIES['C4'];
      const samples = generatePianoTone(freq, 44100, 0.1, 0.3);
      const detection = detectPitch(samples, 44100);

      expect(detection).not.toBeNull();
      if (detection) {
        // Should detect C4 (MIDI 60), not C3 (MIDI 48)
        expect(detection.midiPitch).toBeGreaterThanOrEqual(59); // C4 or close
        expect(detection.midiPitch).toBeLessThanOrEqual(61);
      }
    });

    it('should not detect E3 when E4 is playing', () => {
      const freq = NOTE_FREQUENCIES['E4'];
      const samples = generatePianoTone(freq, 44100, 0.1, 0.3);
      const detection = detectPitch(samples, 44100);

      expect(detection).not.toBeNull();
      if (detection) {
        // Should detect E4 (MIDI 64), not E3 (MIDI 52)
        expect(detection.midiPitch).toBeGreaterThanOrEqual(63);
        expect(detection.midiPitch).toBeLessThanOrEqual(65);
      }
    });
  });
});
