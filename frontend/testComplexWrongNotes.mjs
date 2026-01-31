/**
 * Complex Song Wrong Note Detection Test
 *
 * Tests wrong note detection on COMPLEX songs (with bass accompaniment)
 * by pitch-shifting and checking if the algorithm correctly rejects wrong notes.
 *
 * Key scenario: In practice mode, we expect ONE specific note.
 * If user plays wrong note, it should be rejected even with complex audio.
 *
 * Run with: node testComplexWrongNotes.mjs
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
// PITCH SHIFTING
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
// YIN PITCH DETECTOR (V3) with Octave Candidates
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

  // Generate octave candidates
  const candidates = [{ freq: frequency, cmndVal: cmndMin }];

  for (const multiplier of [2, 4]) {
    const octaveTau = refinedTau / multiplier;
    if (octaveTau >= 2 && octaveTau < tauMax) {
      const octaveTauInt = Math.round(octaveTau);
      if (octaveTauInt < cmnd.length) {
        const octaveCmnd = cmnd[octaveTauInt];
        const octaveFreq = sampleRate / octaveTau;
        if (octaveCmnd < 0.35 && octaveFreq >= 80 && octaveFreq <= 4500) {
          candidates.push({ freq: octaveFreq, cmndVal: octaveCmnd });
        }
      }
    }
  }

  return {
    candidates: candidates.map(c => ({
      frequency: c.freq,
      midiPitch: frequencyToMidi(c.freq),
      note: midiToNote(frequencyToMidi(c.freq)),
      confidence: Math.max(0, Math.min(1, 1 - c.cmndVal)),
    })),
    rms,
  };
}

// ============================================================================
// SCORE-AWARE MATCHING
// ============================================================================

/**
 * Check if ANY candidate matches the expected note (including octave variants)
 */
function checkScoreAwareMatch(candidates, expectedNote) {
  const expectedMidi = noteToMidi(expectedNote);
  const expectedPitchClass = expectedMidi % 12;

  for (const candidate of candidates) {
    const detectedPitchClass = candidate.midiPitch % 12;

    // Pitch class match = same note name (C, D, E, etc.) in any octave
    if (detectedPitchClass === expectedPitchClass) {
      return {
        match: true,
        matchedCandidate: candidate,
        type: candidate.midiPitch === expectedMidi ? 'exact' : 'octave',
      };
    }
  }

  return { match: false, type: 'wrong' };
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

function testComplexWrongNotes(filePath, originalExpectedNote, shiftSemitones) {
  const { samples, sampleRate } = readWavFile(filePath);

  // Pitch shift the audio
  const shiftedSamples = pitchShift(samples, shiftSemitones);

  // After shifting, the "actual" note in the audio is:
  const originalMidi = noteToMidi(originalExpectedNote);
  const shiftedMidi = originalMidi + shiftSemitones;
  const shiftedNote = midiToNote(shiftedMidi);

  // But we still EXPECT the original note (user should play original)
  // So if shift != 0, the audio is "wrong"

  const windowSize = 3072;
  const hopSize = 512;

  let totalFrames = 0;
  let matchedOriginal = 0;      // Detected pitch class matches original expected
  let matchedShifted = 0;       // Detected pitch class matches shifted note
  let matchedNeither = 0;       // Detected something else entirely

  const detectedNotes = {};

  for (let start = 0; start + windowSize < shiftedSamples.length; start += hopSize) {
    const window = shiftedSamples.slice(start, start + windowSize);
    const result = detectPitchV3(window, sampleRate);

    if (!result || result.candidates.length === 0) continue;
    totalFrames++;

    // Check what we detected
    const best = result.candidates.sort((a, b) => b.confidence - a.confidence)[0];
    const detectedPitchClass = best.midiPitch % 12;

    // Track detected notes
    const noteName = NOTE_NAMES[detectedPitchClass];
    detectedNotes[noteName] = (detectedNotes[noteName] || 0) + 1;

    const originalPitchClass = originalMidi % 12;
    const shiftedPitchClass = shiftedMidi % 12;

    // Check using score-aware matching (considers all candidates)
    const matchOriginal = checkScoreAwareMatch(result.candidates, originalExpectedNote);
    const matchShifted = checkScoreAwareMatch(result.candidates, shiftedNote);

    if (matchOriginal.match) {
      matchedOriginal++;
    } else if (matchShifted.match) {
      matchedShifted++;
    } else {
      matchedNeither++;
    }
  }

  // Calculate metrics
  const originalMatchRate = totalFrames > 0 ? matchedOriginal / totalFrames : 0;
  const shiftedMatchRate = totalFrames > 0 ? matchedShifted / totalFrames : 0;

  // For shift=0: we WANT high originalMatchRate (correct detection)
  // For shift!=0: we WANT low originalMatchRate (wrong note correctly rejected)
  //               and high shiftedMatchRate (actually detecting the shifted pitch)

  return {
    totalFrames,
    originalExpectedNote,
    shiftedNote,
    shiftSemitones,
    matchedOriginal,
    matchedShifted,
    matchedNeither,
    originalMatchRate,
    shiftedMatchRate,
    // Key metric: false accept rate (wrongly matching original when shifted)
    falseAcceptRate: shiftSemitones !== 0 && shiftSemitones !== 12 ? originalMatchRate : 0,
    detectedNotes,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('COMPLEX SONG WRONG NOTE DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('Testing pitch-shifted complex songs (with bass accompaniment)');
console.log('Verifies wrong notes are correctly rejected, not falsely accepted');
console.log();

const testFiles = [
  { file: 'perfect.wav', dir: 'test-audio', expected: 'G4', label: 'Perfect (Ed Sheeran)' },
  { file: 'kaise_hua.wav', dir: 'test-audio', expected: 'E4', label: 'Kaise Hua (Bollywood)' },
  { file: 'tum_hi_ho.wav', dir: 'test-audio', expected: 'D4', label: 'Tum Hi Ho (Bollywood)' },
  { file: 'fur_elise_real.wav', dir: 'test-audio', expected: 'E5', label: 'Fur Elise (Classical)' },
  { file: 'moonlight_sonata_real.wav', dir: 'test-audio', expected: 'C#4', label: 'Moonlight Sonata' },
];

const shifts = [0, 1, 2, 3, 5, 7, 11];

const INTERVAL_NAMES = {
  0: 'Original',
  1: 'Minor 2nd',
  2: 'Major 2nd',
  3: 'Minor 3rd',
  5: 'Perfect 4th',
  7: 'Perfect 5th',
  11: 'Major 7th',
};

console.log('Key metrics:');
console.log('  - Original Match: Rate at which we match the EXPECTED note');
console.log('  - Shifted Match: Rate at which we detect the ACTUAL shifted pitch');
console.log('  - False Accept: Wrongly accepting shifted audio as matching expected');
console.log();
console.log('For wrong note rejection: False Accept should be LOW (<15%)');
console.log();

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${test.label} - file not found`);
    continue;
  }

  console.log('─'.repeat(80));
  console.log(`📁 ${test.label}`);
  console.log(`   File: ${test.file}`);
  console.log(`   Expected note: ${test.expected}`);
  console.log();
  console.log('   Shift    Interval       Expected→   Orig Match   Shift Match   False Accept');
  console.log('   ' + '─'.repeat(72));

  let allPassed = true;

  for (const shift of shifts) {
    try {
      const results = testComplexWrongNotes(filePath, test.expected, shift);

      const origPct = (results.originalMatchRate * 100).toFixed(1) + '%';
      const shiftPct = (results.shiftedMatchRate * 100).toFixed(1) + '%';
      const falsePct = (results.falseAcceptRate * 100).toFixed(1) + '%';

      const shiftStr = (shift === 0 ? '0' : `+${shift}`).padEnd(8);
      const intervalStr = INTERVAL_NAMES[shift].padEnd(15);
      const noteChange = `${test.expected}→${results.shiftedNote}`.padEnd(12);

      // Pass criteria:
      // - shift=0: high original match (>30% due to complex audio)
      // - shift!=0: low false accept (<20%)
      let passed = shift === 0 ? results.originalMatchRate > 0.3 : results.falseAcceptRate < 0.20;
      if (!passed) allPassed = false;

      const status = passed ? '✓' : '✗';

      console.log(
        `   ${shiftStr}${intervalStr}${noteChange}${origPct.padEnd(13)}${shiftPct.padEnd(14)}${falsePct.padEnd(13)}${status}`
      );

    } catch (e) {
      console.log(`   +${shift}`.padEnd(8) + `ERROR: ${e.message}`);
    }
  }

  console.log();
  console.log(`   Result: ${allPassed ? '✓ PASSED' : '✗ NEEDS REVIEW'}`);
  console.log();
}

console.log('='.repeat(80));
console.log('INTERPRETATION');
console.log('='.repeat(80));
console.log();
console.log('Complex songs have bass accompaniment that can confuse pitch detection.');
console.log();
console.log('Key findings to look for:');
console.log('1. Original (shift=0) should have reasonable match rate (>30%)');
console.log('2. Wrong notes (shift=1-11) should have LOW false accept rate');
console.log('3. If false accept is HIGH, the algorithm might confuse bass for melody');
console.log();
console.log('In practice mode, score-aware detection uses expected notes to:');
console.log('- Fix octave errors (bass detected as melody octave)');
console.log('- Reject truly wrong notes (different pitch class)');
console.log();
