/**
 * Realistic Wrong Note Detection Test
 *
 * Simulates REAL practice scenario:
 * - Backing track plays (complex song with bass/accompaniment)
 * - User plays a note on their piano (correct or wrong)
 * - Microphone picks up BOTH mixed together
 * - Algorithm must detect if user played the correct note
 *
 * This is much more realistic than pitch-shifting the entire audio!
 *
 * Run with: node testRealisticWrongNotes.mjs
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
// SYNTHETIC PIANO TONE GENERATOR
// ============================================================================

/**
 * Generate a realistic piano-like tone
 */
function generatePianoTone(midi, numSamples, sampleRate = 44100) {
  const frequency = midiToFreq(midi);
  const samples = new Float32Array(numSamples);

  // Piano-like harmonic structure
  const harmonics = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let value = 0;

    for (let h = 0; h < harmonics.length; h++) {
      const harmFreq = frequency * (h + 1);
      if (harmFreq < sampleRate / 2) { // Nyquist limit
        value += harmonics[h] * Math.sin(2 * Math.PI * harmFreq * t);
      }
    }

    // Envelope: quick attack, slow decay
    const attackTime = 0.01;
    const decayTime = numSamples / sampleRate;
    let envelope = 1;

    if (t < attackTime) {
      envelope = t / attackTime;
    } else {
      const decayProgress = (t - attackTime) / decayTime;
      envelope = Math.exp(-3 * decayProgress);
    }

    samples[i] = value * envelope * 0.6;
  }

  return samples;
}

// ============================================================================
// AUDIO MIXING
// ============================================================================

/**
 * Mix user's piano note with backing track
 * @param backingTrack - The song audio (Float32Array)
 * @param userNote - The user's piano note (Float32Array)
 * @param userVolume - Volume of user's note relative to backing (0.5 = half, 2.0 = double)
 */
function mixAudio(backingTrack, userNote, userVolume = 1.0) {
  const length = Math.min(backingTrack.length, userNote.length);
  const mixed = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    // Mix with proper gain staging
    const backing = backingTrack[i] * 0.5;  // Reduce backing a bit
    const user = userNote[i] * userVolume;
    mixed[i] = backing + user;

    // Soft clip to prevent distortion
    if (mixed[i] > 1) mixed[i] = 1;
    if (mixed[i] < -1) mixed[i] = -1;
  }

  return mixed;
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

function checkMatch(candidates, expectedNote) {
  const expectedMidi = noteToMidi(expectedNote);
  const expectedPitchClass = expectedMidi % 12;

  for (const candidate of candidates) {
    const detectedPitchClass = candidate.midiPitch % 12;
    if (detectedPitchClass === expectedPitchClass) {
      return { match: true, candidate };
    }
  }

  return { match: false };
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

function testRealisticScenario(backingPath, expectedNote, playedMidi, userVolume) {
  const { samples: backing, sampleRate } = readWavFile(backingPath);
  const expectedMidi = noteToMidi(expectedNote);

  // Use first 2 seconds of backing track
  const testDuration = Math.min(backing.length, sampleRate * 2);

  // Generate user's piano note
  const userNote = generatePianoTone(playedMidi, testDuration, sampleRate);

  // Mix user's note with backing track
  const mixed = mixAudio(backing.slice(0, testDuration), userNote, userVolume);

  const windowSize = 3072;
  const hopSize = 512;

  let totalFrames = 0;
  let matchedExpected = 0;  // Detected the expected note (correct or octave)
  let matchedPlayed = 0;    // Detected what user actually played

  for (let start = 0; start + windowSize < mixed.length; start += hopSize) {
    const window = mixed.slice(start, start + windowSize);
    const result = detectPitchV3(window, sampleRate);

    if (!result || result.candidates.length === 0) continue;
    totalFrames++;

    // Check if we detect the expected note
    const matchExp = checkMatch(result.candidates, expectedNote);
    if (matchExp.match) matchedExpected++;

    // Check if we detect what was actually played
    const matchPlay = checkMatch(result.candidates, midiToNote(playedMidi));
    if (matchPlay.match) matchedPlayed++;
  }

  const isCorrectNote = (playedMidi % 12) === (expectedMidi % 12);

  return {
    totalFrames,
    expectedNote,
    playedNote: midiToNote(playedMidi),
    isCorrectNote,
    matchedExpected,
    matchedPlayed,
    expectedMatchRate: totalFrames > 0 ? matchedExpected / totalFrames : 0,
    playedMatchRate: totalFrames > 0 ? matchedPlayed / totalFrames : 0,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('REALISTIC WRONG NOTE DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('Simulates REAL practice scenario:');
console.log('  1. Backing track plays (complex song with bass/accompaniment)');
console.log('  2. User plays a note on their piano');
console.log('  3. Microphone picks up BOTH mixed together');
console.log('  4. Algorithm detects if user played correctly');
console.log();

const testFiles = [
  { file: 'perfect.wav', dir: 'test-audio', expected: 'G4', label: 'Perfect' },
  { file: 'kaise_hua.wav', dir: 'test-audio', expected: 'E4', label: 'Kaise Hua' },
  { file: 'tum_hi_ho.wav', dir: 'test-audio', expected: 'D4', label: 'Tum Hi Ho' },
  { file: 'fur_elise_real.wav', dir: 'test-audio', expected: 'E5', label: 'Fur Elise' },
];

// Test scenarios: user plays correct note, or wrong by 1-6 semitones
const scenarios = [
  { offset: 0, label: 'Correct Note' },
  { offset: 1, label: '+1 semitone (Minor 2nd)' },
  { offset: 2, label: '+2 semitones (Major 2nd)' },
  { offset: 3, label: '+3 semitones (Minor 3rd)' },
  { offset: 5, label: '+5 semitones (Perfect 4th)' },
  { offset: 7, label: '+7 semitones (Perfect 5th)' },
];

// Test with different user volume levels
const volumeLevels = [
  { vol: 0.5, label: 'Soft (0.5x)' },
  { vol: 1.0, label: 'Normal (1.0x)' },
  { vol: 1.5, label: 'Loud (1.5x)' },
];

console.log('Testing with user playing at different volumes relative to backing track');
console.log();

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${test.label} - file not found`);
    continue;
  }

  const expectedMidi = noteToMidi(test.expected);

  console.log('═'.repeat(80));
  console.log(`📁 ${test.label} | Expected: ${test.expected}`);
  console.log('═'.repeat(80));

  for (const volLevel of volumeLevels) {
    console.log();
    console.log(`  Volume: ${volLevel.label}`);
    console.log('  ' + '─'.repeat(70));
    console.log('  Scenario                    Played    Exp Match   Play Match   Result');
    console.log('  ' + '─'.repeat(70));

    let correctAccepted = 0;
    let wrongRejected = 0;
    let totalTests = 0;

    for (const scenario of scenarios) {
      const playedMidi = expectedMidi + scenario.offset;
      const playedNote = midiToNote(playedMidi);

      try {
        const results = testRealisticScenario(filePath, test.expected, playedMidi, volLevel.vol);

        const expPct = (results.expectedMatchRate * 100).toFixed(0) + '%';
        const playPct = (results.playedMatchRate * 100).toFixed(0) + '%';

        // Success criteria:
        // - If correct note: we should detect the expected/played note
        // - If wrong note: we should detect the played note, NOT the expected note
        let isSuccess = false;
        let resultStr = '';

        if (scenario.offset === 0) {
          // Correct note - should detect it
          isSuccess = results.expectedMatchRate > 0.5;
          resultStr = isSuccess ? '✓ Detected' : '✗ Missed';
          if (isSuccess) correctAccepted++;
        } else {
          // Wrong note - should NOT falsely match expected
          // Key: playedMatchRate should be > expectedMatchRate
          isSuccess = results.playedMatchRate > results.expectedMatchRate || results.expectedMatchRate < 0.3;
          resultStr = isSuccess ? '✓ Rejected' : '✗ False Accept';
          if (isSuccess) wrongRejected++;
        }

        totalTests++;

        console.log(
          `  ${scenario.label.padEnd(28)}${playedNote.padEnd(10)}${expPct.padEnd(12)}${playPct.padEnd(13)}${resultStr}`
        );

      } catch (e) {
        console.log(`  ${scenario.label.padEnd(28)}ERROR: ${e.message}`);
      }
    }

    const accuracy = totalTests > 0 ? ((correctAccepted + wrongRejected) / totalTests * 100).toFixed(0) : 0;
    console.log('  ' + '─'.repeat(70));
    console.log(`  Accuracy: ${accuracy}% (${correctAccepted + wrongRejected}/${totalTests})`);
  }

  console.log();
}

console.log('═'.repeat(80));
console.log('INTERPRETATION');
console.log('═'.repeat(80));
console.log();
console.log('This test simulates a user playing their piano note OVER the backing track.');
console.log();
console.log('Key insights:');
console.log('  • Correct note: Algorithm should detect it (Exp Match high)');
console.log('  • Wrong note: Algorithm should detect the PLAYED note, not expected');
console.log('  • Higher user volume = easier to detect user\'s note');
console.log('  • In real practice, user\'s piano is usually loudest (close to mic)');
console.log();
console.log('Success criteria:');
console.log('  • Correct notes detected at >50% rate');
console.log('  • Wrong notes: played note detected more than expected note');
console.log();
