/**
 * Score-Aware Wrong Note Detection Test
 *
 * Critical test: Verifies score-aware mode CORRECTLY REJECTS wrong notes
 * and doesn't falsely snap them to expected notes.
 *
 * Tests:
 * 1. Original audio → should match expected notes
 * 2. Pitch-shifted audio (1-12 semitones) → should be rejected as wrong
 *
 * Run with: node testScoreAwareWrongNotes.mjs
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
// PITCH SHIFTING (Resample-based)
// ============================================================================

/**
 * Pitch shift audio by resampling
 * @param samples - Original audio samples
 * @param semitones - Number of semitones to shift (positive = higher pitch)
 * @returns Pitch-shifted samples
 */
function pitchShift(samples, semitones) {
  if (semitones === 0) return samples;

  // Ratio for pitch shift: 2^(semitones/12)
  const ratio = Math.pow(2, semitones / 12);

  // New length (shorter for higher pitch, longer for lower)
  const newLength = Math.floor(samples.length / ratio);
  const shifted = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const frac = srcIndex - srcIndexFloor;

    // Linear interpolation
    shifted[i] = samples[srcIndexFloor] * (1 - frac) + samples[srcIndexCeil] * frac;
  }

  return shifted;
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

  let frequency = sampleRate / refinedTau;

  const candidates = [{ freq: frequency, cmndVal: cmnd[bestTau], multiplier: 1 }];

  for (const multiplier of [2, 4, 8]) {
    const octaveTau = refinedTau / multiplier;
    if (octaveTau >= 2 && octaveTau < tauMax) {
      const octaveTauInt = Math.round(octaveTau);
      const octaveCmnd = cmnd[octaveTauInt];
      const octaveFreq = sampleRate / octaveTau;

      if (octaveCmnd < 0.30 && octaveFreq >= 80 && octaveFreq <= 4500) {
        candidates.push({ freq: octaveFreq, cmndVal: octaveCmnd, multiplier });
      }
    }
  }

  return {
    candidates: candidates.map(c => ({
      frequency: c.freq,
      midiPitch: frequencyToMidi(c.freq),
      note: midiToNote(frequencyToMidi(c.freq)),
      confidence: Math.max(0, Math.min(1, 1 - c.cmndVal)),
      cmndVal: c.cmndVal,
    })),
    rms,
  };
}

// ============================================================================
// SCORE-AWARE DETECTION (with strict wrong-note rejection)
// ============================================================================

/**
 * Score-aware detection that:
 * - Snaps octave errors to expected notes (good)
 * - REJECTS notes that don't match expected (even within semitones)
 *
 * Key: Only accept if pitch class matches an expected note!
 */
function detectWithScoreAwareness(samples, sampleRate, expectedNotes) {
  const rawResult = detectPitchV3(samples, sampleRate);
  if (!rawResult || rawResult.candidates.length === 0) return null;

  const expectedMidis = expectedNotes.map(noteToMidi);
  const expectedPitchClasses = new Set(expectedMidis.map(m => m % 12));

  // Find best matching candidate
  let bestMatch = null;
  let bestScore = -Infinity;

  for (const candidate of rawResult.candidates) {
    const detectedMidi = candidate.midiPitch;
    const detectedPitchClass = detectedMidi % 12;

    // Check for pitch class match (same note name, any octave)
    if (!expectedPitchClasses.has(detectedPitchClass)) {
      continue; // This candidate doesn't match any expected note
    }

    // Find the expected note with matching pitch class
    for (const expMidi of expectedMidis) {
      if ((expMidi % 12) === detectedPitchClass) {
        const semitoneDiff = Math.abs(detectedMidi - expMidi);
        let matchScore = candidate.confidence * 100;

        if (semitoneDiff === 0) {
          matchScore += 50; // Exact octave match bonus
        } else if (semitoneDiff === 12 || semitoneDiff === 24) {
          matchScore += 30; // Octave match (will snap)
        }

        if (matchScore > bestScore) {
          bestScore = matchScore;
          bestMatch = {
            ...candidate,
            expectedMidi: expMidi,
            expectedNote: midiToNote(expMidi),
            matchType: semitoneDiff === 0 ? 'exact' : 'octave',
            snappedToExpected: true,
            rawDetectedMidi: detectedMidi,
            rawDetectedNote: candidate.note,
          };
        }
      }
    }
  }

  // If no pitch-class match found, return as WRONG NOTE
  if (!bestMatch) {
    const best = rawResult.candidates.sort((a, b) => b.confidence - a.confidence)[0];
    return {
      ...best,
      matchType: 'wrong',
      snappedToExpected: false,
      isWrongNote: true,
    };
  }

  // Snap to expected note
  return {
    ...bestMatch,
    note: bestMatch.expectedNote,
    midiPitch: bestMatch.expectedMidi,
    frequency: midiToFreq(bestMatch.expectedMidi),
    isWrongNote: false,
  };
}

// ============================================================================
// AUDIO READER (supports MP3, WAV, WebM via ffmpeg)
// ============================================================================

import { execSync } from 'child_process';
import { tmpdir } from 'os';

function readAudioFile(filePath) {
  const tempFile = path.join(tmpdir(), `wrong_note_${Date.now()}.raw`);
  const sampleRate = 44100;

  try {
    execSync(`ffmpeg -y -i "${filePath}" -f f32le -acodec pcm_f32le -ac 1 -ar ${sampleRate} "${tempFile}"`, {
      stdio: 'pipe'
    });
  } catch (err) {
    throw new Error(`ffmpeg failed: ${err.message}`);
  }

  const buffer = fs.readFileSync(tempFile);
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  fs.unlinkSync(tempFile);

  return { samples, sampleRate };
}

// ============================================================================
// TEST RUNNER
// ============================================================================

function testWrongNoteDetection(filePath, expectedNotes, shiftSemitones) {
  const { samples, sampleRate } = readAudioFile(filePath);

  // Apply pitch shift
  const shiftedSamples = pitchShift(samples, shiftSemitones);

  const windowSize = 3072;
  const hopSize = 512;

  let totalFrames = 0;
  let correctDetections = 0;  // Correct = identified as wrong when wrong, or correct when correct
  let wrongAsCorrect = 0;     // False positive: wrong note accepted as correct
  let correctAsWrong = 0;     // False negative: correct note rejected as wrong

  for (let start = 0; start + windowSize < shiftedSamples.length; start += hopSize) {
    const window = shiftedSamples.slice(start, start + windowSize);

    const result = detectWithScoreAwareness(window, sampleRate, expectedNotes);
    if (!result) continue;

    totalFrames++;

    if (shiftSemitones === 0) {
      // Original audio - should match expected notes
      if (result.snappedToExpected) {
        correctDetections++;
      } else {
        correctAsWrong++;
      }
    } else {
      // Shifted audio - should be detected as wrong
      if (result.isWrongNote || !result.snappedToExpected) {
        correctDetections++;
      } else {
        wrongAsCorrect++;
      }
    }
  }

  return {
    totalFrames,
    correctDetections,
    wrongAsCorrect,
    correctAsWrong,
    accuracy: totalFrames > 0 ? correctDetections / totalFrames : 0,
    falseAcceptRate: totalFrames > 0 ? wrongAsCorrect / totalFrames : 0,
    falseRejectRate: totalFrames > 0 ? correctAsWrong / totalFrames : 0,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('SCORE-AWARE WRONG NOTE DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('Testing if score-aware mode correctly REJECTS wrong notes');
console.log('(should not falsely snap them to expected notes)');
console.log();

const testFiles = [
  // Simple files
  { file: 'test_c4_sustained.mp3', dir: '../.worktrees/piano-academy/backend', expected: ['C4'], label: 'Simple C4' },
  { file: 'test_c_major_scale.mp3', dir: '../.worktrees/piano-academy/backend', expected: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], label: 'C Major Scale' },

  // Complex songs
  { file: 'kaisehua_cover.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['E4', 'B4', 'G4', 'F#4', 'A4'], label: 'Kaise Hua' },
  { file: 'tumhiho_slow.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['D4', 'A4', 'F#4', 'E4', 'G4'], label: 'Tum Hi Ho' },
  { file: 'lagjagale_cover.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['G4', 'C4', 'D4', 'E4', 'F4'], label: 'Lag Ja Gale' },
];

// Semitone shifts to test (0 = original, others = wrong notes)
const semitoneShifts = [0, 1, 2, 3, 5, 7, 11, 12];
const shiftLabels = {
  0: 'Correct',
  1: 'Minor 2nd',
  2: 'Major 2nd',
  3: 'Minor 3rd',
  5: 'Perfect 4th',
  7: 'Perfect 5th',
  11: 'Major 7th',
  12: 'Octave'
};

console.log('Legend:');
console.log('  ✓ = Correct detection (right note accepted OR wrong note rejected)');
console.log('  ✗ = Wrong detection (wrong note falsely accepted)');
console.log();

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${test.label} - file not found`);
    continue;
  }

  console.log(`${'─'.repeat(80)}`);
  console.log(`📁 ${test.label} (${test.file})`);
  console.log(`   Expected: ${test.expected.join(', ')}`);
  console.log();
  console.log('   Shift        Interval       Accuracy    False Accept   Result');
  console.log('   ' + '─'.repeat(65));

  let allPassed = true;

  for (const shift of semitoneShifts) {
    try {
      const results = testWrongNoteDetection(filePath, test.expected, shift);

      const accuracyPct = (results.accuracy * 100).toFixed(1) + '%';
      const falsePct = (results.falseAcceptRate * 100).toFixed(1) + '%';

      // For original (shift=0): should have high accuracy, low false reject
      // For shifted: should have low false accept rate
      let passed = false;
      if (shift === 0) {
        passed = results.accuracy > 0.8;  // 80%+ of correct notes recognized
      } else if (shift === 12) {
        // Octave shift is special - might legitimately match due to octave snapping
        passed = true;  // Accept any result for octave
      } else {
        passed = results.falseAcceptRate < 0.15;  // <15% wrong notes falsely accepted
      }

      const status = passed ? '✓ PASS' : '✗ FAIL';
      if (!passed) allPassed = false;

      const shiftStr = (shift === 0 ? '0 (orig)' : `+${shift}`).padEnd(12);
      const intervalStr = shiftLabels[shift].padEnd(15);

      console.log(`   ${shiftStr}${intervalStr}${accuracyPct.padEnd(12)}${falsePct.padEnd(15)}${status}`);

    } catch (e) {
      console.log(`   ${shift.toString().padEnd(12)}${'ERROR'.padEnd(15)}${e.message}`);
    }
  }

  console.log();
  console.log(`   Overall: ${allPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  console.log();
}

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('Key insights:');
console.log('• Shift 0 (original): Should be detected as CORRECT');
console.log('• Shift 1-11 semitones: Should be detected as WRONG');
console.log('• Shift 12 (octave): May or may not match (octave snapping is intentional)');
console.log();
console.log('If False Accept rate is high for shifted audio, score-aware mode');
console.log('is incorrectly snapping wrong notes to expected notes.');
console.log();
