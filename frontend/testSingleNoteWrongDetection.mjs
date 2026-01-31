/**
 * Single Note Wrong Detection Test
 *
 * Tests the REAL practice scenario: ONE expected note, user plays something else.
 * Uses synthetic tones for precise control.
 *
 * Test cases:
 * 1. Expected C4, played C4 → should ACCEPT
 * 2. Expected C4, played C#4 → should REJECT (1 semitone wrong)
 * 3. Expected C4, played D4 → should REJECT (2 semitones wrong)
 * ... up to 11 semitones
 * 4. Expected C4, played C5 → should ACCEPT (octave = same note)
 *
 * Run with: node testSingleNoteWrongDetection.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// UTILITIES
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function noteToMidi(note) {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const noteMap = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const [, noteName, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[noteName] ?? 0);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ============================================================================
// SYNTHETIC AUDIO GENERATOR
// ============================================================================

function generateTone(midi, durationSec = 0.5, sampleRate = 44100, harmonics = [1, 0.5, 0.25]) {
  const frequency = midiToFreq(midi);
  const numSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let value = 0;

    // Add harmonics for realistic piano-like tone
    for (let h = 0; h < harmonics.length; h++) {
      value += harmonics[h] * Math.sin(2 * Math.PI * frequency * (h + 1) * t);
    }

    // Apply envelope (attack-sustain-release)
    const attackEnd = 0.02;
    const releaseStart = durationSec - 0.05;
    let envelope = 1;
    if (t < attackEnd) {
      envelope = t / attackEnd;
    } else if (t > releaseStart) {
      envelope = (durationSec - t) / 0.05;
    }

    samples[i] = value * envelope * 0.5;
  }

  return samples;
}

// ============================================================================
// YIN PITCH DETECTOR (V3)
// ============================================================================

function detectPitchV3(samples, sampleRate = 44100) {
  if (!samples || samples.length < 1024) return null;

  let rmsSum = 0;
  for (let i = 0; i < samples.length; i++) {
    rmsSum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(rmsSum / samples.length);

  if (rms < 0.002) return null;

  const bufferSize = samples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));

  const difference = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    const len = bufferSize - tauMax;
    for (let i = 0; i < len; i++) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let cumulativeSum = 0;

  for (let tau = 1; tau < tauMax; tau++) {
    cumulativeSum += difference[tau];
    if (cumulativeSum > 0) {
      cmnd[tau] = (difference[tau] * tau) / cumulativeSum;
    } else {
      cmnd[tau] = 1;
    }
  }

  const threshold = 0.20;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      bestTau = tau;
      cmndMin = cmnd[tau];
      break;
    }
  }

  if (bestTau === null) {
    const minTau = Math.ceil(sampleRate / 2000);
    const maxTauSearch = Math.floor(sampleRate / 80);
    for (let tau = minTau; tau < Math.min(maxTauSearch, tauMax); tau++) {
      if (cmnd[tau] < cmndMin) {
        cmndMin = cmnd[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau === null) return null;

  let refinedTau = bestTau;
  if (bestTau > 0 && bestTau < tauMax - 1) {
    const alpha = cmnd[bestTau - 1];
    const beta = cmnd[bestTau];
    const gamma = cmnd[bestTau + 1];
    const denominator = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denominator) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denominator;
    }
  }

  const frequency = sampleRate / refinedTau;

  return {
    frequency,
    midiPitch: frequencyToMidi(frequency),
    note: midiToNote(frequencyToMidi(frequency)),
    confidence: Math.max(0, Math.min(1, 1 - cmndMin)),
  };
}

// ============================================================================
// SCORE-AWARE DETECTION
// ============================================================================

/**
 * Score-aware detection: checks if detected pitch matches expected note
 * Returns whether the played note is CORRECT or WRONG
 */
function checkNoteMatch(playedMidi, expectedMidi) {
  const semitoneDiff = Math.abs(playedMidi - expectedMidi);
  const pitchClassMatch = (playedMidi % 12) === (expectedMidi % 12);

  if (semitoneDiff === 0) {
    return { match: true, type: 'exact', semitoneError: 0 };
  } else if (pitchClassMatch) {
    // Same pitch class, different octave - ACCEPT (octave error is OK)
    return { match: true, type: 'octave', semitoneError: semitoneDiff };
  } else {
    return { match: false, type: 'wrong', semitoneError: semitoneDiff };
  }
}

// ============================================================================
// TEST RUNNER
// ============================================================================

function runSingleNoteTest(expectedNote, playedMidi, sampleRate = 44100) {
  const expectedMidi = noteToMidi(expectedNote);
  const playedNote = midiToNote(playedMidi);

  // Generate synthetic tone for the played note
  const samples = generateTone(playedMidi, 0.3, sampleRate);

  // Detect pitch
  const detection = detectPitchV3(samples, sampleRate);

  if (!detection) {
    return {
      expected: expectedNote,
      played: playedNote,
      detected: null,
      match: false,
      error: 'No detection',
    };
  }

  // Check if it matches expected
  const matchResult = checkNoteMatch(detection.midiPitch, expectedMidi);

  return {
    expected: expectedNote,
    expectedMidi,
    played: playedNote,
    playedMidi,
    detected: detection.note,
    detectedMidi: detection.midiPitch,
    confidence: detection.confidence,
    ...matchResult,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('SINGLE NOTE WRONG DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('Testing the REAL practice scenario:');
console.log('- ONE expected note at a time');
console.log('- User plays correct note OR wrong note');
console.log('- Algorithm must correctly accept/reject');
console.log();

const INTERVAL_NAMES = [
  'Unison (correct)',
  'Minor 2nd',
  'Major 2nd',
  'Minor 3rd',
  'Major 3rd',
  'Perfect 4th',
  'Tritone',
  'Perfect 5th',
  'Minor 6th',
  'Major 6th',
  'Minor 7th',
  'Major 7th',
  'Octave (OK)',
];

// Test with different base notes
const testNotes = ['C4', 'E4', 'G4', 'A3', 'D5'];

console.log('Legend:');
console.log('  ✓ = Correct (right note accepted OR wrong note rejected)');
console.log('  ✗ = Error (wrong note accepted OR right note rejected)');
console.log();

let totalTests = 0;
let passedTests = 0;

for (const expectedNote of testNotes) {
  const baseMidi = noteToMidi(expectedNote);

  console.log('─'.repeat(80));
  console.log(`Expected: ${expectedNote} (MIDI ${baseMidi})`);
  console.log('─'.repeat(80));
  console.log('Interval'.padEnd(20) + 'Played'.padEnd(10) + 'Detected'.padEnd(10) + 'Match'.padEnd(8) + 'Result');
  console.log('─'.repeat(60));

  for (let offset = 0; offset <= 12; offset++) {
    const playedMidi = baseMidi + offset;
    const result = runSingleNoteTest(expectedNote, playedMidi);

    const intervalName = INTERVAL_NAMES[offset] || `+${offset} semitones`;

    // Expected behavior:
    // - offset 0: should match (correct note)
    // - offset 1-11: should NOT match (wrong note)
    // - offset 12: should match (octave = same note, acceptable)
    const shouldMatch = (offset === 0 || offset === 12);
    const isCorrect = result.match === shouldMatch;

    totalTests++;
    if (isCorrect) passedTests++;

    const matchStr = result.match ? 'YES' : 'NO';
    const status = isCorrect ? '✓' : '✗';

    console.log(
      `${intervalName.padEnd(20)}` +
      `${result.played.padEnd(10)}` +
      `${(result.detected || 'N/A').padEnd(10)}` +
      `${matchStr.padEnd(8)}` +
      `${status}`
    );
  }

  console.log();
}

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log(`Total tests: ${totalTests}`);
console.log(`Passed: ${passedTests} (${(passedTests / totalTests * 100).toFixed(1)}%)`);
console.log(`Failed: ${totalTests - passedTests}`);
console.log();

if (passedTests === totalTests) {
  console.log('✓ ALL TESTS PASSED');
  console.log();
  console.log('The algorithm correctly:');
  console.log('  - Accepts correct notes (exact match)');
  console.log('  - Accepts octave equivalents (C4 = C5 for practice purposes)');
  console.log('  - Rejects wrong notes (1-11 semitones off)');
} else {
  console.log('✗ SOME TESTS FAILED');
  console.log();
  console.log('Review failures above to identify detection issues.');
}
console.log();
