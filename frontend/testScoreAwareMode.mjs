/**
 * Score-Aware Detection Test
 *
 * Tests the algorithm WITH expected notes passed in (score-aware mode).
 * This should dramatically improve accuracy on complex songs by:
 * - Snapping to expected octaves
 * - Rejecting detections that don't match score
 *
 * Run with: node testScoreAwareMode.mjs
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
// SCORE-AWARE YIN DETECTOR
// ============================================================================

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

      if (octaveCmnd < 0.30 && octaveFreq >= 80 && octaveFreq <= 4500) {
        candidates.push({ freq: octaveFreq, cmndVal: octaveCmnd, multiplier });
      }
    }
  }

  // Return all candidates for score-aware filtering
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

/**
 * Score-aware detection: uses expected notes to pick the best candidate
 */
function detectWithScoreAwareness(samples, sampleRate, expectedNotes, centsTolerance = 50) {
  const rawResult = detectPitchV3(samples, sampleRate);
  if (!rawResult || rawResult.candidates.length === 0) return null;

  const expectedMidis = new Set(expectedNotes.map(noteToMidi));

  // Find best matching candidate
  let bestMatch = null;
  let bestScore = -Infinity;

  for (const candidate of rawResult.candidates) {
    const detectedMidi = candidate.midiPitch;

    // Check for exact match or octave match
    for (const expMidi of expectedMidis) {
      const semitoneDiff = Math.abs(detectedMidi - expMidi);
      const pitchClassMatch = (detectedMidi % 12) === (expMidi % 12);

      let matchScore = 0;

      if (semitoneDiff === 0) {
        // Exact match
        matchScore = 100 + candidate.confidence * 10;
      } else if (pitchClassMatch && (semitoneDiff === 12 || semitoneDiff === 24)) {
        // Octave error - accept but lower score
        matchScore = 80 + candidate.confidence * 10;
        // Prefer higher octave (melody usually higher than bass)
        if (detectedMidi > expMidi) matchScore += 5;
      } else if (semitoneDiff <= 1) {
        // Within 1 semitone
        matchScore = 50 + candidate.confidence * 10;
      }

      if (matchScore > bestScore) {
        bestScore = matchScore;
        bestMatch = {
          ...candidate,
          expectedMidi: expMidi,
          expectedNote: midiToNote(expMidi),
          matchType: semitoneDiff === 0 ? 'exact' : (pitchClassMatch ? 'octave' : 'semitone'),
          snappedToExpected: true,
        };
      }
    }
  }

  // If no match found, return raw detection with flag
  if (!bestMatch) {
    const best = rawResult.candidates.sort((a, b) => b.confidence - a.confidence)[0];
    return {
      ...best,
      matchType: 'none',
      snappedToExpected: false,
    };
  }

  // Snap to expected note for output
  return {
    ...bestMatch,
    // Use expected note/midi for the "detected" values
    note: bestMatch.expectedNote,
    midiPitch: bestMatch.expectedMidi,
    frequency: midiToFreq(bestMatch.expectedMidi),
    rawDetectedNote: bestMatch.note,
    rawDetectedMidi: bestMatch.midiPitch,
  };
}

// ============================================================================
// AUDIO READER (supports MP3, WAV, WebM via ffmpeg)
// ============================================================================

import { execSync } from 'child_process';
import { tmpdir } from 'os';

function readAudioFile(filePath) {
  const tempFile = path.join(tmpdir(), `score_aware_${Date.now()}.raw`);
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

function runComparison(filePath, expectedNotes) {
  const { samples, sampleRate } = readAudioFile(filePath);
  const windowSize = 3072;
  const hopSize = 512;

  const rawDetections = [];
  const scoreAwareDetections = [];

  for (let start = 0; start + windowSize < samples.length; start += hopSize) {
    const window = samples.slice(start, start + windowSize);

    // Raw detection (no score awareness)
    const rawResult = detectPitchV3(window, sampleRate);
    if (rawResult && rawResult.candidates.length > 0) {
      const best = rawResult.candidates.sort((a, b) => b.confidence - a.confidence)[0];
      rawDetections.push(best);
    }

    // Score-aware detection
    const scoreResult = detectWithScoreAwareness(window, sampleRate, expectedNotes);
    if (scoreResult) {
      scoreAwareDetections.push(scoreResult);
    }
  }

  // Calculate match rates
  const expectedMidis = new Set(expectedNotes.map(noteToMidi));

  let rawMatches = 0;
  let rawOctaveErrors = 0;
  for (const d of rawDetections) {
    if (expectedMidis.has(d.midiPitch)) {
      rawMatches++;
    } else {
      for (const expMidi of expectedMidis) {
        if ((d.midiPitch % 12) === (expMidi % 12)) {
          rawOctaveErrors++;
          break;
        }
      }
    }
  }

  let scoreMatches = 0;
  let scoreOctaveCorrections = 0;
  for (const d of scoreAwareDetections) {
    if (d.snappedToExpected) {
      scoreMatches++;
      if (d.matchType === 'octave') {
        scoreOctaveCorrections++;
      }
    }
  }

  return {
    raw: {
      total: rawDetections.length,
      matches: rawMatches,
      matchRate: rawDetections.length > 0 ? rawMatches / rawDetections.length : 0,
      octaveErrors: rawOctaveErrors,
      octaveErrorRate: rawDetections.length > 0 ? rawOctaveErrors / rawDetections.length : 0,
    },
    scoreAware: {
      total: scoreAwareDetections.length,
      matches: scoreMatches,
      matchRate: scoreAwareDetections.length > 0 ? scoreMatches / scoreAwareDetections.length : 0,
      octaveCorrections: scoreOctaveCorrections,
      octaveCorrectionRate: scoreAwareDetections.length > 0 ? scoreOctaveCorrections / scoreAwareDetections.length : 0,
    },
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('SCORE-AWARE MODE COMPARISON TEST');
console.log('='.repeat(80));
console.log();
console.log('Comparing RAW detection vs SCORE-AWARE detection');
console.log('Score-aware mode passes expected notes to help resolve octave ambiguity');
console.log();

const testFiles = [
  // Simple files (should be similar)
  { file: 'test_c4_sustained.mp3', dir: '../.worktrees/piano-academy/backend', expected: ['C4'] },
  { file: 'test_c_major_scale.mp3', dir: '../.worktrees/piano-academy/backend', expected: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'] },

  // Complex songs (score-aware should help significantly)
  { file: 'kaisehua_cover.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['E4', 'B4', 'G4', 'F#4', 'A4'] },
  { file: 'tumhiho_slow.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['D4', 'A4', 'F#4', 'E4', 'G4'] },
  { file: 'lagjagale_cover.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['G4', 'C4', 'D4', 'E4', 'F4'] },
  { file: 'perfect_easy_tutorial.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['G4', 'A4', 'B4', 'C5', 'D5', 'E5'] },
  { file: 'kalhonaho_easy.mp3', dir: '../.worktrees/piano-academy/backend/test_songs', expected: ['Eb4', 'Bb4', 'Ab4', 'G4', 'C4'] },
];

console.log('File'.padEnd(30) + 'Mode'.padEnd(15) + 'Match Rate'.padEnd(15) + 'Octave Fix');
console.log('-'.repeat(75));

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ ${test.file} - not found`);
    continue;
  }

  try {
    const results = runComparison(filePath, test.expected);

    const rawMatchPct = (results.raw.matchRate * 100).toFixed(1) + '%';
    const rawOctavePct = (results.raw.octaveErrorRate * 100).toFixed(1) + '%';
    const scoreMatchPct = (results.scoreAware.matchRate * 100).toFixed(1) + '%';
    const scoreOctavePct = (results.scoreAware.octaveCorrectionRate * 100).toFixed(1) + '%';

    const improvement = results.scoreAware.matchRate - results.raw.matchRate;
    const improvementStr = improvement > 0 ? `+${(improvement * 100).toFixed(0)}%` : '';

    console.log(`${test.file.padEnd(30)}${'RAW'.padEnd(15)}${rawMatchPct.padEnd(15)}${rawOctavePct} errors`);
    console.log(`${''.padEnd(30)}${'SCORE-AWARE'.padEnd(15)}${scoreMatchPct.padEnd(15)}${scoreOctavePct} fixed  ${improvementStr}`);
    console.log();

  } catch (e) {
    console.log(`✗ ${test.file} - ${e.message}`);
  }
}

console.log('='.repeat(80));
console.log('INTERPRETATION');
console.log('='.repeat(80));
console.log();
console.log('RAW mode: Detects pitch without knowing what notes to expect');
console.log('SCORE-AWARE mode: Uses expected notes to resolve octave ambiguity');
console.log();
console.log('For complex songs with bass accompaniment, score-aware mode should');
console.log('dramatically improve accuracy by snapping octave errors to expected notes.');
console.log();
console.log('In practice mode, always pass expected notes for best accuracy!');
