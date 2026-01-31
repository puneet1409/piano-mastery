/**
 * Real Audio Precision Test
 *
 * Tests detection precision on real recorded audio files.
 * Measures:
 * - Note detection stability (consistency across frames)
 * - Frequency accuracy (cents deviation from expected)
 * - Confidence distribution
 *
 * Run with: node testRealAudioPrecision.mjs
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
// ANALYSIS
// ============================================================================

function analyzeFile(filePath, expectedNotes) {
  const { samples, sampleRate } = readWavFile(filePath);
  const windowSize = 3072;
  const hopSize = 512;
  const detections = [];

  for (let start = 0; start + windowSize < samples.length; start += hopSize) {
    const window = samples.slice(start, start + windowSize);
    const timeMs = Math.floor(start * 1000 / sampleRate);
    const result = detectPitchV3(window, sampleRate);

    if (result) {
      detections.push({ timeMs, ...result });
    }
  }

  // Calculate statistics
  const expectedMidis = new Set(expectedNotes.map(noteToMidi));

  // Count notes
  const noteCounts = {};
  for (const d of detections) {
    noteCounts[d.note] = (noteCounts[d.note] || 0) + 1;
  }

  // Calculate frequency accuracy (cents deviation)
  const centsDeviations = [];
  for (const d of detections) {
    const expectedFreq = midiToFreq(d.midiPitch);
    const cents = 1200 * Math.log2(d.frequency / expectedFreq);
    centsDeviations.push(Math.abs(cents));
  }

  // Stability: how consistent are detections?
  let transitions = 0;
  let lastMidi = null;
  for (const d of detections) {
    if (lastMidi !== null && d.midiPitch !== lastMidi) {
      transitions++;
    }
    lastMidi = d.midiPitch;
  }
  const stability = 1 - (transitions / Math.max(1, detections.length - 1));

  // Match rate
  let matchingDetections = 0;
  let octaveErrors = 0;
  for (const d of detections) {
    if (expectedMidis.has(d.midiPitch)) {
      matchingDetections++;
    } else {
      // Check for octave errors
      for (const expMidi of expectedMidis) {
        if (Math.abs(d.midiPitch - expMidi) === 12 || Math.abs(d.midiPitch - expMidi) === 24) {
          octaveErrors++;
          break;
        }
      }
    }
  }

  return {
    totalDetections: detections.length,
    uniqueNotes: Object.keys(noteCounts).length,
    topNotes: Object.entries(noteCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([note, count]) => ({ note, count, pct: (count / detections.length * 100).toFixed(1) })),
    avgConfidence: detections.length > 0 ? detections.reduce((s, d) => s + d.confidence, 0) / detections.length : 0,
    avgCentsDeviation: centsDeviations.length > 0 ? centsDeviations.reduce((a, b) => a + b, 0) / centsDeviations.length : 0,
    maxCentsDeviation: centsDeviations.length > 0 ? Math.max(...centsDeviations) : 0,
    stability,
    matchRate: detections.length > 0 ? matchingDetections / detections.length : 0,
    octaveErrorRate: detections.length > 0 ? octaveErrors / detections.length : 0,
  };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('REAL AUDIO PRECISION ANALYSIS');
console.log('='.repeat(80));
console.log();

const testFiles = [
  // Simple files
  { file: 'test_c4_sustained.wav', dir: '../backend', expected: ['C4'] },
  { file: 'test_c_major_scale.wav', dir: '../backend', expected: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] },
  { file: 'test_staccato.wav', dir: '../backend', expected: ['C4', 'E4', 'G4', 'C5'] },

  // Room noise / realistic
  { file: 'c_scale_realistic.wav', dir: 'test-audio', expected: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] },
  { file: 'c_scale_heavy_room.wav', dir: 'test-audio', expected: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'] },

  // Complex songs
  { file: 'kaise_hua.wav', dir: 'test-audio', expected: ['E4', 'B4', 'G4', 'F#4', 'A4'] },
  { file: 'tum_hi_ho.wav', dir: 'test-audio', expected: ['D4', 'A4', 'F#4', 'E4', 'G4'] },
  { file: 'fur_elise_real.wav', dir: 'test-audio', expected: ['E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4'] },
];

for (const test of testFiles) {
  const filePath = path.join(__dirname, test.dir, test.file);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠ File not found: ${test.file}`);
    continue;
  }

  console.log('='.repeat(60));
  console.log(`FILE: ${test.file}`);
  console.log('='.repeat(60));
  console.log(`Expected: ${test.expected.join(', ')}`);
  console.log();

  try {
    const stats = analyzeFile(filePath, test.expected);

    console.log('DETECTION STATS:');
    console.log(`  Total detections: ${stats.totalDetections}`);
    console.log(`  Unique notes: ${stats.uniqueNotes}`);
    console.log(`  Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`);
    console.log();

    console.log('FREQUENCY ACCURACY:');
    console.log(`  Avg cents deviation: ${stats.avgCentsDeviation.toFixed(1)} cents`);
    console.log(`  Max cents deviation: ${stats.maxCentsDeviation.toFixed(1)} cents`);
    console.log(`  (< 10 cents = excellent, < 25 cents = good, < 50 cents = acceptable)`);
    console.log();

    console.log('STABILITY:');
    console.log(`  Frame-to-frame stability: ${(stats.stability * 100).toFixed(1)}%`);
    console.log(`  (Higher = more consistent detection, less jitter)`);
    console.log();

    console.log('MATCH ANALYSIS:');
    console.log(`  Match rate: ${(stats.matchRate * 100).toFixed(1)}%`);
    console.log(`  Octave error rate: ${(stats.octaveErrorRate * 100).toFixed(1)}%`);
    console.log();

    console.log('TOP DETECTED NOTES:');
    for (const { note, count, pct } of stats.topNotes) {
      const isExpected = test.expected.some(e => noteToMidi(e) === noteToMidi(note));
      const marker = isExpected ? '✓' : (
        test.expected.some(e => Math.abs(noteToMidi(e) - noteToMidi(note)) === 12) ? '~' : '✗'
      );
      console.log(`  ${marker} ${note.padEnd(5)} ${count.toString().padStart(5)} (${pct}%)`);
    }
    console.log();

  } catch (e) {
    console.log(`Error: ${e.message}`);
    console.log();
  }
}

console.log('='.repeat(80));
console.log('LEGEND');
console.log('='.repeat(80));
console.log('  ✓ = Expected note detected');
console.log('  ~ = Octave error (same pitch class, wrong octave)');
console.log('  ✗ = Unexpected note');
console.log();
console.log('QUALITY THRESHOLDS:');
console.log('  Cents deviation: <10 excellent, <25 good, <50 acceptable, >50 poor');
console.log('  Stability: >90% excellent, >80% good, >70% acceptable, <70% unstable');
console.log('  Match rate: >80% excellent, >60% good, >40% acceptable, <40% poor');
