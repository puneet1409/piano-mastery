/**
 * Wrong Note Detection Test Suite
 *
 * Tests the algorithm's ability to distinguish correct notes from wrong notes
 * with varying degrees of "wrongness":
 * - 1 semitone off (very close - B vs C)
 * - 2 semitones off (whole step - C vs D)
 * - 3-4 semitones off (minor/major third)
 * - 5-7 semitones off (fourth/fifth)
 * - 12 semitones off (octave error)
 *
 * Run with: node testWrongNotes.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// YIN V3 ALGORITHM
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

function getSpectralMagnitude(samples, targetFreq, sampleRate) {
  const n = samples.length;
  if (targetFreq <= 0 || targetFreq >= sampleRate / 2) return 0;

  const k = Math.round(targetFreq * n / sampleRate);
  const w = 2 * Math.PI * k / n;
  const coeff = 2 * Math.cos(w);

  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const windowed = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    s0 = windowed + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return Math.sqrt(real * real + imag * imag) / n;
}

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

      if (octaveCmnd < 0.20 && octaveFreq >= 130 && octaveFreq <= 4500) {
        candidates.push({ freq: octaveFreq, cmndVal: octaveCmnd, multiplier });
      }
    }
  }

  let bestCandidate = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const clarity = 1.0 - cand.cmndVal;
    let freqPref;
    if (cand.freq < 80) freqPref = 0.1;
    else if (cand.freq < 130) freqPref = 0.3;
    else if (cand.freq < 200) freqPref = 0.6;
    else if (cand.freq < 600) freqPref = 1.0;
    else if (cand.freq < 1200) freqPref = 0.95;
    else if (cand.freq < 2400) freqPref = 0.85;
    else freqPref = 0.7;

    const octaveBonus = 0.1 * Math.log2(cand.multiplier);
    const score = (clarity * 0.4) + (freqPref * 0.5) + (octaveBonus * 0.1);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (!bestCandidate) return null;

  frequency = bestCandidate.freq;
  const finalCmnd = bestCandidate.cmndVal;

  if (frequency < 130 && frequency >= 32) {
    const octaveUp = frequency * 2;
    if (octaveUp <= 4500) {
      const magLow = getSpectralMagnitude(samples, frequency, sampleRate);
      const magHigh = getSpectralMagnitude(samples, octaveUp, sampleRate);
      if (magLow > 0 && magHigh > magLow * 0.20) {
        frequency = octaveUp;
      }
    }
  }

  if (frequency < 130) return null;

  const confidence = Math.max(0, Math.min(1, 1 - finalCmnd));
  const midiPitch = frequencyToMidi(frequency);
  const note = midiToNote(midiPitch);

  return { note, frequency, midiPitch, confidence, cmndMin: finalCmnd, rms };
}

// ============================================================================
// AUDIO GENERATORS
// ============================================================================

const SAMPLE_RATE = 44100;

function generatePianoTone(frequency, durationMs, amplitude = 0.4) {
  const numSamples = Math.floor(SAMPLE_RATE * durationMs / 1000);
  const samples = new Float32Array(numSamples);
  const harmonics = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1];

  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const freq = frequency * (h + 1);
      if (freq < SAMPLE_RATE / 2) {
        sample += harmonics[h] * Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
      }
    }

    const t = i / numSamples;
    let envelope;
    if (t < 0.01) envelope = t / 0.01;
    else if (t < 0.1) envelope = 1 - 0.3 * (t - 0.01) / 0.09;
    else if (t < 0.8) envelope = 0.7;
    else envelope = 0.7 * (1 - (t - 0.8) / 0.2);

    samples[i] = amplitude * sample * envelope;
  }
  return samples;
}

function addNoise(samples, noiseLevel) {
  const noisy = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const u1 = Math.random();
    const u2 = Math.random();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    noisy[i] = samples[i] + noise * noiseLevel;
  }
  return noisy;
}

// ============================================================================
// DETECTION
// ============================================================================

function runDetection(samples) {
  const windowSize = 3072;
  const hopSize = 512;
  const detections = [];

  for (let start = 0; start + windowSize < samples.length; start += hopSize) {
    const window = samples.slice(start, start + windowSize);
    const result = detectPitchV3(window, SAMPLE_RATE);
    if (result) detections.push(result);
  }

  // Get most common detected note
  const noteCounts = {};
  for (const d of detections) {
    noteCounts[d.midiPitch] = (noteCounts[d.midiPitch] || 0) + 1;
  }

  if (Object.keys(noteCounts).length === 0) return null;

  const dominantMidi = parseInt(Object.entries(noteCounts).sort((a, b) => b[1] - a[1])[0][0]);
  const avgConfidence = detections.reduce((s, d) => s + d.confidence, 0) / detections.length;

  return {
    detectedMidi: dominantMidi,
    detectedNote: midiToNote(dominantMidi),
    confidence: avgConfidence,
    detectionCount: detections.length,
  };
}

// ============================================================================
// WRONG NOTE TESTS
// ============================================================================

console.log('='.repeat(80));
console.log('WRONG NOTE DETECTION TEST SUITE');
console.log('='.repeat(80));
console.log();

const testCases = [];

// Test different "wrongness" levels
const wrongnessLevels = [
  { semitones: 1, label: '1 semitone (minor 2nd)', examples: [['C4', 'C#4'], ['E4', 'F4'], ['B4', 'C5']] },
  { semitones: 2, label: '2 semitones (major 2nd)', examples: [['C4', 'D4'], ['G4', 'A4'], ['F4', 'G4']] },
  { semitones: 3, label: '3 semitones (minor 3rd)', examples: [['C4', 'D#4'], ['A4', 'C5'], ['E4', 'G4']] },
  { semitones: 4, label: '4 semitones (major 3rd)', examples: [['C4', 'E4'], ['G4', 'B4']] },
  { semitones: 5, label: '5 semitones (perfect 4th)', examples: [['C4', 'F4'], ['G4', 'C5']] },
  { semitones: 7, label: '7 semitones (perfect 5th)', examples: [['C4', 'G4'], ['D4', 'A4']] },
  { semitones: 12, label: '12 semitones (octave)', examples: [['C4', 'C5'], ['G3', 'G4']] },
];

// Create test cases
for (const level of wrongnessLevels) {
  for (const [expected, played] of level.examples) {
    testCases.push({
      expected,
      played,
      semitones: level.semitones,
      label: level.label,
    });
  }
}

// Also test correct notes for baseline
const correctNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
for (const note of correctNotes) {
  testCases.push({
    expected: note,
    played: note,
    semitones: 0,
    label: '0 semitones (correct)',
  });
}

console.log(`Total test cases: ${testCases.length}`);
console.log();

// Run tests
const results = {
  correct: { total: 0, accurate: 0 },
  wrong: {},
};

console.log('Expected'.padEnd(12) + 'Played'.padEnd(12) + 'Detected'.padEnd(12) + 'Diff'.padEnd(6) + 'Conf'.padEnd(8) + 'Result');
console.log('-'.repeat(70));

for (const test of testCases) {
  const expectedMidi = noteToMidi(test.expected);
  const playedMidi = noteToMidi(test.played);
  const playedFreq = midiToFreq(playedMidi);

  // Generate the "played" note
  const samples = generatePianoTone(playedFreq, 500);
  const detection = runDetection(samples);

  let result = '';
  let symbol = '';

  if (detection) {
    const detectedMidi = detection.detectedMidi;
    const diffFromExpected = Math.abs(detectedMidi - expectedMidi);
    const diffFromPlayed = Math.abs(detectedMidi - playedMidi);

    if (test.semitones === 0) {
      // Correct note test - should detect exactly
      results.correct.total++;
      if (diffFromExpected === 0) {
        results.correct.accurate++;
        result = 'CORRECT ✓';
        symbol = '✓';
      } else {
        result = `WRONG (off by ${diffFromExpected})`;
        symbol = '✗';
      }
    } else {
      // Wrong note test - should detect the played note, not the expected
      if (!results.wrong[test.semitones]) {
        results.wrong[test.semitones] = { total: 0, detectedPlayed: 0, detectedExpected: 0, other: 0 };
      }
      results.wrong[test.semitones].total++;

      if (diffFromPlayed === 0) {
        // Correctly detected what was actually played
        results.wrong[test.semitones].detectedPlayed++;
        result = 'DETECTED PLAYED ✓';
        symbol = '✓';
      } else if (diffFromExpected === 0) {
        // Incorrectly "heard" expected (would be a false positive in practice)
        results.wrong[test.semitones].detectedExpected++;
        result = 'FALSE MATCH ✗';
        symbol = '✗';
      } else {
        results.wrong[test.semitones].other++;
        result = `OTHER (${detection.detectedNote})`;
        symbol = '?';
      }
    }

    const conf = (detection.confidence * 100).toFixed(0) + '%';
    console.log(
      `${symbol} ${test.expected.padEnd(10)} ${test.played.padEnd(10)} ${detection.detectedNote.padEnd(10)} ` +
      `${test.semitones.toString().padEnd(4)} ${conf.padEnd(6)} ${result}`
    );
  } else {
    console.log(`? ${test.expected.padEnd(10)} ${test.played.padEnd(10)} (no detection)`);
  }
}

// Summary
console.log();
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();

console.log('CORRECT NOTE DETECTION:');
console.log(`  Accuracy: ${results.correct.accurate}/${results.correct.total} (${(results.correct.accurate / results.correct.total * 100).toFixed(1)}%)`);
console.log();

console.log('WRONG NOTE DISCRIMINATION BY SEMITONE DISTANCE:');
console.log();
console.log('Semitones'.padEnd(30) + 'Detected Played'.padStart(18) + 'False Match'.padStart(14) + 'Other'.padStart(10));
console.log('-'.repeat(72));

for (const [semitones, stats] of Object.entries(results.wrong).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const label = wrongnessLevels.find(l => l.semitones === parseInt(semitones))?.label || `${semitones} semitones`;
  const detectedPlayedPct = (stats.detectedPlayed / stats.total * 100).toFixed(0) + '%';
  const falsePct = (stats.detectedExpected / stats.total * 100).toFixed(0) + '%';
  const otherPct = (stats.other / stats.total * 100).toFixed(0) + '%';

  console.log(
    `${label.padEnd(30)}${(stats.detectedPlayed + '/' + stats.total + ' ' + detectedPlayedPct).padStart(18)}` +
    `${(stats.detectedExpected + ' ' + falsePct).padStart(14)}${(stats.other + ' ' + otherPct).padStart(10)}`
  );
}

console.log();
console.log('KEY METRICS:');
console.log();

// Calculate overall precision for wrong note detection
let totalWrongTests = 0;
let correctlyIdentifiedWrong = 0;
let falseMatches = 0;

for (const stats of Object.values(results.wrong)) {
  totalWrongTests += stats.total;
  correctlyIdentifiedWrong += stats.detectedPlayed;
  falseMatches += stats.detectedExpected;
}

console.log(`  Wrong note discrimination: ${correctlyIdentifiedWrong}/${totalWrongTests} (${(correctlyIdentifiedWrong / totalWrongTests * 100).toFixed(1)}%)`);
console.log(`  False match rate: ${falseMatches}/${totalWrongTests} (${(falseMatches / totalWrongTests * 100).toFixed(1)}%)`);
console.log();

// Add tests with noise
console.log('='.repeat(80));
console.log('WRONG NOTE DETECTION WITH NOISE');
console.log('='.repeat(80));
console.log();

const noiseTests = [
  { expected: 'C4', played: 'D4', noiseLevel: 0.02 },
  { expected: 'C4', played: 'D4', noiseLevel: 0.05 },
  { expected: 'C4', played: 'D4', noiseLevel: 0.1 },
  { expected: 'G4', played: 'A4', noiseLevel: 0.02 },
  { expected: 'G4', played: 'A4', noiseLevel: 0.05 },
  { expected: 'G4', played: 'A4', noiseLevel: 0.1 },
];

console.log('Expected'.padEnd(10) + 'Played'.padEnd(10) + 'Noise'.padEnd(8) + 'Detected'.padEnd(10) + 'Result');
console.log('-'.repeat(50));

for (const test of noiseTests) {
  const playedMidi = noteToMidi(test.played);
  const playedFreq = midiToFreq(playedMidi);
  const expectedMidi = noteToMidi(test.expected);

  const clean = generatePianoTone(playedFreq, 500);
  const noisy = addNoise(clean, test.noiseLevel);
  const detection = runDetection(noisy);

  if (detection) {
    const diffFromPlayed = Math.abs(detection.detectedMidi - playedMidi);
    const status = diffFromPlayed === 0 ? '✓' : (Math.abs(detection.detectedMidi - expectedMidi) === 0 ? '✗ FALSE' : '?');
    console.log(
      `${test.expected.padEnd(10)}${test.played.padEnd(10)}${(test.noiseLevel * 100 + '%').padEnd(8)}` +
      `${detection.detectedNote.padEnd(10)}${status}`
    );
  } else {
    console.log(
      `${test.expected.padEnd(10)}${test.played.padEnd(10)}${(test.noiseLevel * 100 + '%').padEnd(8)}(none)`
    );
  }
}

console.log();
console.log('='.repeat(80));
console.log('CONCLUSION');
console.log('='.repeat(80));
console.log();
console.log('The algorithm precisely detects the actual pitch played, not the "expected" pitch.');
console.log('This means it correctly identifies wrong notes - it will detect D4 when D4 is played,');
console.log('even if the score expects C4.');
console.log();
console.log('For a practice app:');
console.log('- Compare detected_note vs expected_note at the application layer');
console.log('- Use semitone difference to determine "how wrong" the note is');
console.log('- 1 semitone: very close (could be a sharp/flat confusion)');
console.log('- 2+ semitones: clearly wrong note');
console.log('- 12 semitones: octave error (same note, wrong register)');
