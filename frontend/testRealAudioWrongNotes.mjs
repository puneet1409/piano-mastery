/**
 * Real Audio Wrong Note Detection Test
 *
 * Takes REAL audio files, pitch-shifts them, and verifies:
 * - Original audio is detected as CORRECT
 * - Pitch-shifted audio is detected as WRONG
 *
 * Uses simple single-note files for accurate testing.
 *
 * Run with: node testRealAudioWrongNotes.mjs
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

// ============================================================================
// PITCH SHIFTING (Resample-based)
// ============================================================================

function pitchShift(samples, semitones) {
  if (semitones === 0) return samples;

  const ratio = Math.pow(2, semitones / 12);
  const newLength = Math.floor(samples.length / ratio);
  const shifted = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, samples.length - 1);
    const frac = srcIndex - srcIndexFloor;
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

  const frequency = sampleRate / refinedTau;

  return {
    frequency,
    midiPitch: frequencyToMidi(frequency),
    note: midiToNote(frequencyToMidi(frequency)),
    confidence: Math.max(0, Math.min(1, 1 - cmndMin)),
  };
}

// ============================================================================
// WAV READER
// ============================================================================

function readWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  let offset = 12;
  let header = null;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('utf8', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      header = {
        numChannels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    }
    if (chunkId === 'data' && header) {
      const dataOffset = offset + 8;
      const bytesPerSample = header.bitsPerSample / 8;
      const numSamples = chunkSize / bytesPerSample / header.numChannels;
      const samples = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        const sampleOffset = dataOffset + i * bytesPerSample * header.numChannels;
        if (header.bitsPerSample === 16) {
          samples[i] = buffer.readInt16LE(sampleOffset) / 32768;
        } else if (header.bitsPerSample === 32) {
          samples[i] = buffer.readFloatLE(sampleOffset);
        } else if (header.bitsPerSample === 8) {
          samples[i] = (buffer.readUInt8(sampleOffset) - 128) / 128;
        }
      }
      return { samples, sampleRate: header.sampleRate };
    }
    offset += 8 + chunkSize;
  }
  throw new Error('Invalid WAV file');
}

// ============================================================================
// TEST RUNNER
// ============================================================================

function testWithPitchShift(filePath, expectedNote, shiftSemitones) {
  const { samples, sampleRate } = readWavFile(filePath);
  const expectedMidi = noteToMidi(expectedNote);

  // Apply pitch shift
  const shiftedSamples = pitchShift(samples, shiftSemitones);

  const windowSize = 3072;
  const hopSize = 512;

  let totalFrames = 0;
  let correctDecisions = 0;
  let wrongNoteAccepted = 0;
  let rightNoteRejected = 0;

  for (let start = 0; start + windowSize < shiftedSamples.length; start += hopSize) {
    const window = shiftedSamples.slice(start, start + windowSize);
    const detection = detectPitchV3(window, sampleRate);

    if (!detection) continue;
    totalFrames++;

    const detectedMidi = detection.midiPitch;
    const pitchClassMatch = (detectedMidi % 12) === (expectedMidi % 12);

    // After shifting by N semitones, the actual pitch class is expectedMidi + N
    // We check if that matches the expected pitch class
    const actualPitchClass = (expectedMidi + shiftSemitones) % 12;
    const detectedPitchClass = detectedMidi % 12;

    // Detection is "correct for the shifted audio" if it detects the shifted pitch
    const detectedShiftedNote = Math.abs(detectedPitchClass - actualPitchClass) <= 0 ||
                                 Math.abs(detectedPitchClass - actualPitchClass) === 12;

    // Now check if algorithm would accept/reject based on expected note
    const matchesExpected = pitchClassMatch;

    if (shiftSemitones === 0 || shiftSemitones % 12 === 0) {
      // Should ACCEPT (correct note or octave)
      if (matchesExpected) {
        correctDecisions++;
      } else {
        rightNoteRejected++;
      }
    } else {
      // Should REJECT (wrong note)
      if (!matchesExpected) {
        correctDecisions++;
      } else {
        wrongNoteAccepted++;
      }
    }
  }

  return {
    totalFrames,
    correctDecisions,
    wrongNoteAccepted,
    rightNoteRejected,
    accuracy: totalFrames > 0 ? correctDecisions / totalFrames : 0,
    falseAcceptRate: totalFrames > 0 ? wrongNoteAccepted / totalFrames : 0,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('REAL AUDIO WRONG NOTE DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('Using real audio files with pitch shifting to test wrong note detection');
console.log();

const INTERVAL_NAMES = {
  0: 'Correct',
  1: 'Minor 2nd',
  2: 'Major 2nd',
  3: 'Minor 3rd',
  4: 'Major 3rd',
  5: 'Perfect 4th',
  6: 'Tritone',
  7: 'Perfect 5th',
  11: 'Major 7th',
  12: 'Octave',
};

const testFiles = [
  { file: 'test_c4_sustained.wav', dir: '../backend', expected: 'C4', label: 'Sustained C4' },
];

const shifts = [0, 1, 2, 3, 5, 7, 11, 12];

console.log('Legend:');
console.log('  ✓ PASS = Algorithm correctly accepts right notes / rejects wrong notes');
console.log('  ✗ FAIL = Algorithm incorrectly accepts wrong notes');
console.log();

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${test.label} - file not found`);
    continue;
  }

  console.log('─'.repeat(80));
  console.log(`📁 ${test.label} (${test.file})`);
  console.log(`   Expected note: ${test.expected}`);
  console.log();
  console.log('   Shift        Interval       Accuracy    False Accept   Result');
  console.log('   ' + '─'.repeat(65));

  for (const shift of shifts) {
    try {
      const results = testWithPitchShift(filePath, test.expected, shift);

      const accuracyPct = (results.accuracy * 100).toFixed(1) + '%';
      const falsePct = (results.falseAcceptRate * 100).toFixed(1) + '%';

      // For correct notes (shift=0, 12): high accuracy = pass
      // For wrong notes (shift=1-11): low false accept = pass
      let passed = false;
      if (shift === 0 || shift === 12) {
        passed = results.accuracy > 0.8;
      } else {
        passed = results.falseAcceptRate < 0.15;
      }

      const status = passed ? '✓ PASS' : '✗ FAIL';
      const shiftStr = (shift === 0 ? '0 (orig)' : `+${shift}`).padEnd(12);
      const intervalStr = (INTERVAL_NAMES[shift] || `+${shift}`).padEnd(15);

      console.log(`   ${shiftStr}${intervalStr}${accuracyPct.padEnd(12)}${falsePct.padEnd(15)}${status}`);

    } catch (e) {
      console.log(`   +${shift}`.padEnd(12) + 'ERROR'.padEnd(15) + e.message);
    }
  }

  console.log();
}

console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('If all tests PASS:');
console.log('  - Original audio correctly identified as matching expected note');
console.log('  - Pitch-shifted audio correctly identified as WRONG');
console.log('  - Score-aware mode will not falsely accept wrong notes');
console.log();
