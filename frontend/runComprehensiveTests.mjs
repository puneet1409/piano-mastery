/**
 * Comprehensive YIN Algorithm Test Suite
 *
 * Run with: node runComprehensiveTests.mjs [audio-dir]
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// YIN V3 ALGORITHM (copied for standalone execution)
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

  // Difference function
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

  // CMND
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

  // First-minimum search
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

  // Fallback: global minimum
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

  // Parabolic interpolation
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

  // Octave-UP disambiguation
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

  // 130Hz floor
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
  const velocity = Math.min(1, rms * 10);
  const midiPitch = frequencyToMidi(frequency);
  const note = midiToNote(midiPitch);

  return { note, frequency, midiPitch, confidence, velocity, cmndMin: finalCmnd, rms };
}

// ============================================================================
// AUDIO GENERATORS
// ============================================================================

function generatePianoTone(frequency, sampleRate, durationMs, amplitude = 0.4) {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Float32Array(numSamples);
  const harmonics = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1];

  for (let i = 0; i < numSamples; i++) {
    let sample = 0;
    for (let h = 0; h < harmonics.length; h++) {
      const freq = frequency * (h + 1);
      if (freq < sampleRate / 2) {
        sample += harmonics[h] * Math.sin(2 * Math.PI * freq * i / sampleRate);
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

function generateDelayedNote(frequency, sampleRate, delayMs, noteDurationMs, amplitude = 0.4) {
  const delaySamples = Math.floor(sampleRate * delayMs / 1000);
  const noteSamples = generatePianoTone(frequency, sampleRate, noteDurationMs, amplitude);
  const samples = new Float32Array(delaySamples + noteSamples.length);
  samples.set(noteSamples, delaySamples);
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

function generateChord(frequencies, sampleRate, durationMs, amplitude = 0.3) {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Float32Array(numSamples);
  for (const freq of frequencies) {
    const noteSamples = generatePianoTone(freq, sampleRate, durationMs, amplitude / frequencies.length);
    for (let i = 0; i < numSamples; i++) samples[i] += noteSamples[i];
  }
  return samples;
}

function generateSequence(notes, sampleRate, gapMs = 50) {
  const chunks = [];
  for (const { note, durationMs } of notes) {
    const midi = noteToMidi(note);
    const freq = midiToFreq(midi);
    chunks.push(generatePianoTone(freq, sampleRate, durationMs));
    if (gapMs > 0) chunks.push(new Float32Array(Math.floor(sampleRate * gapMs / 1000)));
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

// ============================================================================
// WAV READER
// ============================================================================

function readWavFile(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Parse header
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

const SAMPLE_RATE = 44100;
const WINDOW_STANDARD = 3072;
const WINDOW_LOW = 6144;

function runDetection(samples, sampleRate, lowNoteMode = false) {
  const windowSize = lowNoteMode ? WINDOW_LOW : WINDOW_STANDARD;
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
  return detections;
}

function evaluateTest(detections, expectedNotes, toleranceSemitones = 1, allowOctaveErrors = true) {
  const expectedMidis = new Set(expectedNotes.map(noteToMidi));
  const detectedNotes = [...new Set(detections.map(d => d.note))];
  const detectedMidis = new Set(detections.map(d => d.midiPitch));

  let truePositives = 0;
  let octaveErrors = 0;

  for (const detMidi of detectedMidis) {
    for (const expMidi of expectedMidis) {
      const diff = Math.abs(detMidi - expMidi);
      if (diff <= toleranceSemitones) {
        truePositives++;
        break;
      } else if (allowOctaveErrors && (diff === 12 || diff === 24)) {
        octaveErrors++;
        truePositives += 0.5;
        break;
      }
    }
  }

  const precision = detectedMidis.size > 0 ? truePositives / detectedMidis.size : 0;
  const recall = expectedMidis.size > 0 ? Math.min(truePositives, expectedMidis.size) / expectedMidis.size : 0;
  const accuracy = (precision + recall) / 2;
  const avgConfidence = detections.length > 0
    ? detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length
    : 0;

  return { accuracy, precision, recall, octaveErrors, avgConfidence, detectedNotes };
}

// ============================================================================
// TEST DEFINITIONS
// ============================================================================

function createSyntheticTests() {
  const tests = [];

  // 1. Single notes (C4-B4)
  for (const note of ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']) {
    tests.push({
      name: `Single: ${note}`,
      category: 'Single Notes',
      samples: generatePianoTone(midiToFreq(noteToMidi(note)), SAMPLE_RATE, 500),
      expectedNotes: [note],
      lowNoteMode: false,
    });
  }

  // 2. Delayed attacks
  for (const delayMs of [50, 100, 200, 300]) {
    tests.push({
      name: `Delay: ${delayMs}ms`,
      category: 'Delayed Attacks',
      samples: generateDelayedNote(midiToFreq(noteToMidi('C4')), SAMPLE_RATE, delayMs, 400),
      expectedNotes: ['C4'],
      lowNoteMode: false,
    });
  }

  // 3. Low notes
  for (const note of ['C2', 'E2', 'G2', 'B2', 'C3']) {
    tests.push({
      name: `Low: ${note}`,
      category: 'Low Notes',
      samples: generatePianoTone(midiToFreq(noteToMidi(note)), SAMPLE_RATE, 800),
      expectedNotes: [note],
      lowNoteMode: true,
    });
  }

  // 4. High notes
  for (const note of ['C6', 'E6', 'G6', 'C7']) {
    tests.push({
      name: `High: ${note}`,
      category: 'High Notes',
      samples: generatePianoTone(midiToFreq(noteToMidi(note)), SAMPLE_RATE, 300),
      expectedNotes: [note],
      lowNoteMode: false,
    });
  }

  // 5. Dynamics
  for (const [label, amp] of [['soft', 0.1], ['medium', 0.4], ['loud', 0.8]]) {
    tests.push({
      name: `Dynamics: ${label}`,
      category: 'Dynamics',
      samples: generatePianoTone(midiToFreq(noteToMidi('G4')), SAMPLE_RATE, 500, amp),
      expectedNotes: ['G4'],
      lowNoteMode: false,
    });
  }

  // 6. Noise levels
  for (const [label, level] of [['low', 0.01], ['medium', 0.05], ['high', 0.1], ['extreme', 0.2]]) {
    const clean = generatePianoTone(midiToFreq(noteToMidi('E4')), SAMPLE_RATE, 500);
    tests.push({
      name: `Noise: ${label}`,
      category: 'Noisy Audio',
      samples: addNoise(clean, level),
      expectedNotes: ['E4'],
      lowNoteMode: false,
    });
  }

  // 7. Chords
  const chords = [
    { name: 'C Maj', notes: ['C4', 'E4', 'G4'] },
    { name: 'A min', notes: ['A3', 'C4', 'E4'] },
    { name: 'G7', notes: ['G3', 'B3', 'D4', 'F4'] },
    { name: 'F Maj', notes: ['F3', 'A3', 'C4'] },
    { name: 'D min', notes: ['D4', 'F4', 'A4'] },
  ];
  for (const chord of chords) {
    const freqs = chord.notes.map(n => midiToFreq(noteToMidi(n)));
    tests.push({
      name: `Chord: ${chord.name}`,
      category: 'Chords',
      samples: generateChord(freqs, SAMPLE_RATE, 700),
      expectedNotes: chord.notes,
      lowNoteMode: false,
    });
  }

  // 8. Scales
  const cMajor = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  tests.push({
    name: 'C Major Scale',
    category: 'Sequences',
    samples: generateSequence(cMajor.map(n => ({ note: n, durationMs: 300 })), SAMPLE_RATE),
    expectedNotes: cMajor,
    lowNoteMode: false,
  });

  // 9. Octave jumps
  const octaveJumps = ['C3', 'C4', 'C5', 'C4', 'C3'];
  tests.push({
    name: 'Octave Jumps',
    category: 'Sequences',
    samples: generateSequence(octaveJumps.map(n => ({ note: n, durationMs: 400 })), SAMPLE_RATE),
    expectedNotes: octaveJumps,
    lowNoteMode: true,
  });

  // 10. Wrong note simulation (play D4 when expecting C4)
  tests.push({
    name: 'Wrong Note (D4 for C4)',
    category: 'Wrong Notes',
    samples: generatePianoTone(midiToFreq(noteToMidi('D4')), SAMPLE_RATE, 500),
    expectedNotes: ['C4'], // Expect C4 but playing D4
    lowNoteMode: false,
    expectFail: true,
  });

  tests.push({
    name: 'Wrong Note (F#4 for G4)',
    category: 'Wrong Notes',
    samples: generatePianoTone(midiToFreq(noteToMidi('F#4')), SAMPLE_RATE, 500),
    expectedNotes: ['G4'],
    lowNoteMode: false,
    expectFail: true,
  });

  // 11. Staccato (very short notes)
  tests.push({
    name: 'Staccato 50ms',
    category: 'Staccato',
    samples: generatePianoTone(midiToFreq(noteToMidi('C4')), SAMPLE_RATE, 50),
    expectedNotes: ['C4'],
    lowNoteMode: false,
  });

  tests.push({
    name: 'Staccato 100ms',
    category: 'Staccato',
    samples: generatePianoTone(midiToFreq(noteToMidi('E4')), SAMPLE_RATE, 100),
    expectedNotes: ['E4'],
    lowNoteMode: false,
  });

  return tests;
}

function createRealAudioTests(audioDir) {
  const tests = [];
  const expectations = {
    'test_c_major_scale.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'], cat: 'Real: Scales' },
    'test_c4_sustained.wav': { notes: ['C4'], cat: 'Real: Single' },
    'test_chromatic.wav': { notes: ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4'], cat: 'Real: Scales' },
    'test_low_notes.wav': { notes: ['C2', 'E2', 'G2'], cat: 'Real: Low Notes', lowNoteMode: true },
    'test_high_notes.wav': { notes: ['C6', 'E6', 'G6'], cat: 'Real: High Notes' },
    'test_staccato.wav': { notes: ['C4', 'E4', 'G4'], cat: 'Real: Staccato' },
    'piano_scale.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4'], cat: 'Real: Scales' },
    'c_scale_realistic.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4'], cat: 'Real: Realistic' },
    'c_scale_heavy_room.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4'], cat: 'Real: Room Noise' },
    'kaise_hua.wav': { notes: ['E4', 'B4', 'G4', 'F#4'], cat: 'Real: Bollywood' },
    'tum_hi_ho.wav': { notes: ['D4', 'A4', 'F#4', 'E4'], cat: 'Real: Bollywood' },
    'perfect.wav': { notes: ['G4', 'A4', 'B4', 'D5'], cat: 'Real: Pop' },
    'fur_elise_real.wav': { notes: ['E5', 'D#5', 'B4', 'C5', 'A4'], cat: 'Real: Classical' },
    'moonlight_sonata_real.wav': { notes: ['C#4', 'E4', 'G#4'], cat: 'Real: Classical' },
  };

  for (const [filename, exp] of Object.entries(expectations)) {
    // Try multiple directories
    const dirs = [
      path.join(audioDir, filename),
      path.join(__dirname, 'test-audio', filename),
      path.join(__dirname, '..', 'backend', filename),
      path.join(__dirname, '..', 'backend', 'test_songs', filename),
    ];

    let found = null;
    for (const filePath of dirs) {
      if (fs.existsSync(filePath)) {
        found = filePath;
        break;
      }
    }

    if (found) {
      try {
        const { samples, sampleRate } = readWavFile(found);
        tests.push({
          name: filename.replace('.wav', ''),
          category: exp.cat,
          samples,
          sampleRate,
          expectedNotes: exp.notes,
          lowNoteMode: exp.lowNoteMode || false,
        });
      } catch (e) {
        console.error(`Failed to read ${filename}: ${e.message}`);
      }
    }
  }

  return tests;
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('COMPREHENSIVE YIN V3 ALGORITHM TEST SUITE');
console.log('='.repeat(80));
console.log();

const audioDir = process.argv[2] || path.join(__dirname, 'test-audio');
console.log(`Audio directory: ${audioDir}`);
console.log();

const syntheticTests = createSyntheticTests();
const realAudioTests = createRealAudioTests(audioDir);
const allTests = [...syntheticTests, ...realAudioTests];

console.log(`Synthetic tests: ${syntheticTests.length}`);
console.log(`Real audio tests: ${realAudioTests.length}`);
console.log(`Total: ${allTests.length}`);
console.log();

// Run tests
const results = [];
const categorySummary = new Map();

for (const test of allTests) {
  const sr = test.sampleRate || SAMPLE_RATE;
  const detections = runDetection(test.samples, sr, test.lowNoteMode);
  const metrics = evaluateTest(detections, test.expectedNotes);

  // For "wrong note" tests, we expect failure
  const passed = test.expectFail
    ? metrics.accuracy < 0.5  // Wrong note should have low accuracy
    : metrics.accuracy >= 0.6;

  results.push({ test, detections, metrics, passed });

  // Update category summary
  let cat = categorySummary.get(test.category) || { total: 0, passed: 0, accSum: 0, confSum: 0 };
  cat.total++;
  if (passed) cat.passed++;
  cat.accSum += metrics.accuracy;
  cat.confSum += metrics.avgConfidence;
  categorySummary.set(test.category, cat);

  // Print result
  const status = passed ? '✓' : '✗';
  const acc = (metrics.accuracy * 100).toFixed(0).padStart(3);
  const conf = (metrics.avgConfidence * 100).toFixed(0).padStart(3);
  const det = detections.length.toString().padStart(4);

  console.log(`${status} ${test.name.padEnd(30)} Acc: ${acc}%  Conf: ${conf}%  Det: ${det}`);

  if (!passed && !test.expectFail) {
    console.log(`    Expected: ${test.expectedNotes.join(', ')}`);
    console.log(`    Detected: ${metrics.detectedNotes.slice(0, 6).join(', ')}`);
    if (metrics.octaveErrors > 0) {
      console.log(`    Octave errors: ${metrics.octaveErrors}`);
    }
  }
}

// Category summary
console.log();
console.log('='.repeat(80));
console.log('CATEGORY SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('Category'.padEnd(25) + 'Passed'.padStart(10) + 'Avg Acc'.padStart(12) + 'Avg Conf'.padStart(12));
console.log('-'.repeat(59));

for (const [cat, stats] of categorySummary) {
  const passRate = `${stats.passed}/${stats.total}`;
  const avgAcc = ((stats.accSum / stats.total) * 100).toFixed(1) + '%';
  const avgConf = ((stats.confSum / stats.total) * 100).toFixed(1) + '%';
  console.log(`${cat.padEnd(25)}${passRate.padStart(10)}${avgAcc.padStart(12)}${avgConf.padStart(12)}`);
}

// Overall
const totalPassed = results.filter(r => r.passed).length;
const overallAcc = results.reduce((s, r) => s + r.metrics.accuracy, 0) / results.length;
const overallConf = results.reduce((s, r) => s + r.metrics.avgConfidence, 0) / results.length;

console.log();
console.log('='.repeat(80));
console.log('OVERALL RESULTS');
console.log('='.repeat(80));
console.log();
console.log(`Tests passed: ${totalPassed}/${results.length} (${(totalPassed / results.length * 100).toFixed(1)}%)`);
console.log(`Average accuracy: ${(overallAcc * 100).toFixed(1)}%`);
console.log(`Average confidence: ${(overallConf * 100).toFixed(1)}%`);
console.log();

// Failed tests summary
const failed = results.filter(r => !r.passed && !r.test.expectFail);
if (failed.length > 0) {
  console.log('Failed tests:');
  for (const f of failed) {
    console.log(`  - ${f.test.name} (${f.test.category}): ${(f.metrics.accuracy * 100).toFixed(0)}% acc`);
  }
} else {
  console.log('🎉 All tests passed!');
}
