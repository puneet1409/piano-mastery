/**
 * Comprehensive YIN Algorithm Test Suite
 *
 * Tests various real-world scenarios:
 * 1. Simple single notes (synthetic)
 * 2. Delayed note attacks
 * 3. Wrong notes (detection accuracy)
 * 4. Octave errors
 * 5. Chord detection
 * 6. Low notes (< C3)
 * 7. High notes (> C6)
 * 8. Varying dynamics (soft/loud)
 * 9. Noisy audio
 * 10. Real-world recordings
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectPitchWorkletV3, getRecommendedWindowSize } from './yinWorkletDetectorV3';

// ============================================================================
// TYPES
// ============================================================================

interface TestCase {
  name: string;
  category: string;
  samples: Float32Array;
  sampleRate: number;
  expectedNotes: string[];
  tolerance: {
    semitones: number;  // Allow ±N semitones
    octaveErrors: boolean;  // Accept octave errors as partial match
  };
}

interface TestResult {
  testCase: TestCase;
  detections: Detection[];
  metrics: {
    accuracy: number;  // % of expected notes detected
    precision: number; // % of detections that were correct
    recall: number;    // % of expected notes found
    octaveErrors: number;  // Count of octave mismatches
    falsePositives: number;
    falseNegatives: number;
    avgConfidence: number;
    avgLatencyMs: number;
  };
  passed: boolean;
}

interface Detection {
  timeMs: number;
  note: string;
  frequency: number;
  midiPitch: number;
  confidence: number;
}

interface WavHeader {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
}

// ============================================================================
// AUDIO UTILITIES
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(note: string): number {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const [, noteName, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[noteName] ?? 0);
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

// ============================================================================
// SYNTHETIC AUDIO GENERATORS
// ============================================================================

/**
 * Generate a pure sine wave at given frequency
 */
function generateSineWave(
  frequency: number,
  sampleRate: number,
  durationMs: number,
  amplitude: number = 0.5
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
  }

  return samples;
}

/**
 * Generate a piano-like tone with harmonics and envelope
 */
function generatePianoTone(
  frequency: number,
  sampleRate: number,
  durationMs: number,
  amplitude: number = 0.4
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Float32Array(numSamples);

  // Piano harmonic structure (decreasing amplitudes)
  const harmonics = [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1];

  for (let i = 0; i < numSamples; i++) {
    let sample = 0;

    for (let h = 0; h < harmonics.length; h++) {
      const freq = frequency * (h + 1);
      if (freq < sampleRate / 2) { // Below Nyquist
        sample += harmonics[h] * Math.sin(2 * Math.PI * freq * i / sampleRate);
      }
    }

    // ADSR envelope (attack, decay, sustain, release)
    const t = i / numSamples;
    let envelope: number;
    if (t < 0.01) {
      envelope = t / 0.01; // Attack
    } else if (t < 0.1) {
      envelope = 1 - 0.3 * (t - 0.01) / 0.09; // Decay
    } else if (t < 0.8) {
      envelope = 0.7; // Sustain
    } else {
      envelope = 0.7 * (1 - (t - 0.8) / 0.2); // Release
    }

    samples[i] = amplitude * sample * envelope;
  }

  return samples;
}

/**
 * Generate a note with delayed attack (silence before note)
 */
function generateDelayedNote(
  frequency: number,
  sampleRate: number,
  delayMs: number,
  noteDurationMs: number,
  amplitude: number = 0.4
): Float32Array {
  const delaySamples = Math.floor(sampleRate * delayMs / 1000);
  const noteSamples = generatePianoTone(frequency, sampleRate, noteDurationMs, amplitude);

  const totalSamples = delaySamples + noteSamples.length;
  const samples = new Float32Array(totalSamples);

  // Silence for delay
  for (let i = 0; i < delaySamples; i++) {
    samples[i] = 0;
  }

  // Note after delay
  for (let i = 0; i < noteSamples.length; i++) {
    samples[delaySamples + i] = noteSamples[i];
  }

  return samples;
}

/**
 * Add Gaussian noise to audio
 */
function addNoise(samples: Float32Array, noiseLevel: number): Float32Array {
  const noisy = new Float32Array(samples.length);

  for (let i = 0; i < samples.length; i++) {
    // Box-Muller transform for Gaussian noise
    const u1 = Math.random();
    const u2 = Math.random();
    const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    noisy[i] = samples[i] + noise * noiseLevel;
  }

  return noisy;
}

/**
 * Generate a chord (multiple simultaneous notes)
 */
function generateChord(
  frequencies: number[],
  sampleRate: number,
  durationMs: number,
  amplitude: number = 0.3
): Float32Array {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Float32Array(numSamples);

  // Generate each note and mix
  for (const freq of frequencies) {
    const noteSamples = generatePianoTone(freq, sampleRate, durationMs, amplitude / frequencies.length);
    for (let i = 0; i < numSamples; i++) {
      samples[i] += noteSamples[i];
    }
  }

  return samples;
}

/**
 * Generate a sequence of notes
 */
function generateNoteSequence(
  notes: { note: string; durationMs: number }[],
  sampleRate: number,
  gapMs: number = 50
): Float32Array {
  const chunks: Float32Array[] = [];

  for (const { note, durationMs } of notes) {
    const midi = noteToMidi(note);
    const freq = midiToFreq(midi);
    chunks.push(generatePianoTone(freq, sampleRate, durationMs));

    // Add gap between notes
    if (gapMs > 0) {
      chunks.push(new Float32Array(Math.floor(sampleRate * gapMs / 1000)));
    }
  }

  // Concatenate
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
// WAV FILE READER
// ============================================================================

function parseWavHeader(buffer: Buffer): WavHeader {
  const riff = buffer.toString('utf8', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file');

  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('utf8', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      return {
        numChannels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    }
    offset += 8 + chunkSize;
  }
  throw new Error('No fmt chunk found');
}

function findDataChunk(buffer: Buffer): { offset: number; size: number } {
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('utf8', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'data') {
      return { offset: offset + 8, size: chunkSize };
    }
    offset += 8 + chunkSize;
  }
  throw new Error('No data chunk found');
}

function readWavFile(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buffer = fs.readFileSync(filePath);
  const header = parseWavHeader(buffer);
  const dataChunk = findDataChunk(buffer);

  const bytesPerSample = header.bitsPerSample / 8;
  const numSamples = dataChunk.size / bytesPerSample / header.numChannels;
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataChunk.offset + i * bytesPerSample * header.numChannels;

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

// ============================================================================
// TEST RUNNER
// ============================================================================

function runDetection(
  samples: Float32Array,
  sampleRate: number,
  expectedNotes?: string[]
): Detection[] {
  const windowSize = getRecommendedWindowSize(expectedNotes);
  const hopSize = 512;
  const detections: Detection[] = [];

  for (let start = 0; start + windowSize < samples.length; start += hopSize) {
    const window = samples.slice(start, start + windowSize);
    const timeMs = Math.floor(start * 1000 / sampleRate);

    const result = detectPitchWorkletV3(window, sampleRate, { expectedNotes });

    if (result) {
      detections.push({
        timeMs,
        note: result.note,
        frequency: result.frequency,
        midiPitch: result.midiPitch,
        confidence: result.confidence,
      });
    }
  }

  return detections;
}

function evaluateDetections(
  detections: Detection[],
  expectedNotes: string[],
  tolerance: { semitones: number; octaveErrors: boolean }
): TestResult['metrics'] {
  const expectedMidis = new Set(expectedNotes.map(noteToMidi));
  const detectedMidis = new Set(detections.map(d => d.midiPitch));

  let truePositives = 0;
  let octaveErrors = 0;

  for (const detMidi of detectedMidis) {
    // Check exact match within tolerance
    for (const expMidi of expectedMidis) {
      const diff = Math.abs(detMidi - expMidi);

      if (diff <= tolerance.semitones) {
        truePositives++;
        break;
      } else if (tolerance.octaveErrors && (diff === 12 || diff === 24)) {
        // Octave error
        octaveErrors++;
        truePositives += 0.5; // Partial credit
        break;
      }
    }
  }

  const falsePositives = detectedMidis.size - truePositives;
  const falseNegatives = expectedMidis.size - Math.min(truePositives, expectedMidis.size);

  const precision = detectedMidis.size > 0 ? truePositives / detectedMidis.size : 0;
  const recall = expectedMidis.size > 0 ? Math.min(truePositives, expectedMidis.size) / expectedMidis.size : 0;
  const accuracy = (precision + recall) / 2;

  const avgConfidence = detections.length > 0
    ? detections.reduce((sum, d) => sum + d.confidence, 0) / detections.length
    : 0;

  return {
    accuracy,
    precision,
    recall,
    octaveErrors,
    falsePositives: Math.max(0, falsePositives),
    falseNegatives: Math.max(0, falseNegatives),
    avgConfidence,
    avgLatencyMs: 0, // Would need timing to measure
  };
}

function runTestCase(testCase: TestCase): TestResult {
  const startTime = performance.now();
  const detections = runDetection(testCase.samples, testCase.sampleRate, testCase.expectedNotes);
  const latencyMs = performance.now() - startTime;

  const metrics = evaluateDetections(detections, testCase.expectedNotes, testCase.tolerance);
  metrics.avgLatencyMs = latencyMs;

  // Pass if accuracy >= 70% (adjustable threshold)
  const passed = metrics.accuracy >= 0.7;

  return {
    testCase,
    detections,
    metrics,
    passed,
  };
}

// ============================================================================
// TEST CASE DEFINITIONS
// ============================================================================

const SAMPLE_RATE = 44100;

function createSyntheticTestCases(): TestCase[] {
  const testCases: TestCase[] = [];

  // 1. Simple single notes (octave 4)
  const singleNotes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
  for (const note of singleNotes) {
    const midi = noteToMidi(note);
    const freq = midiToFreq(midi);
    testCases.push({
      name: `Single note: ${note}`,
      category: 'Single Notes',
      samples: generatePianoTone(freq, SAMPLE_RATE, 500),
      sampleRate: SAMPLE_RATE,
      expectedNotes: [note],
      tolerance: { semitones: 1, octaveErrors: false },
    });
  }

  // 2. Delayed note attacks (50ms, 100ms, 200ms delays)
  for (const delayMs of [50, 100, 200]) {
    const freq = midiToFreq(noteToMidi('C4'));
    testCases.push({
      name: `Delayed attack: ${delayMs}ms`,
      category: 'Delayed Notes',
      samples: generateDelayedNote(freq, SAMPLE_RATE, delayMs, 400),
      sampleRate: SAMPLE_RATE,
      expectedNotes: ['C4'],
      tolerance: { semitones: 1, octaveErrors: false },
    });
  }

  // 3. Low notes (C2-B2, below C3 threshold)
  const lowNotes = ['C2', 'E2', 'G2', 'B2'];
  for (const note of lowNotes) {
    const midi = noteToMidi(note);
    const freq = midiToFreq(midi);
    testCases.push({
      name: `Low note: ${note}`,
      category: 'Low Notes',
      samples: generatePianoTone(freq, SAMPLE_RATE, 700), // Longer duration for low notes
      sampleRate: SAMPLE_RATE,
      expectedNotes: [note],
      tolerance: { semitones: 1, octaveErrors: true }, // Allow octave errors for low notes
    });
  }

  // 4. High notes (C6-C7)
  const highNotes = ['C6', 'E6', 'G6', 'C7'];
  for (const note of highNotes) {
    const midi = noteToMidi(note);
    const freq = midiToFreq(midi);
    testCases.push({
      name: `High note: ${note}`,
      category: 'High Notes',
      samples: generatePianoTone(freq, SAMPLE_RATE, 300),
      sampleRate: SAMPLE_RATE,
      expectedNotes: [note],
      tolerance: { semitones: 1, octaveErrors: false },
    });
  }

  // 5. Varying dynamics (soft, medium, loud)
  for (const [label, amplitude] of [['soft', 0.1], ['medium', 0.4], ['loud', 0.8]] as const) {
    const freq = midiToFreq(noteToMidi('G4'));
    testCases.push({
      name: `Dynamics: ${label}`,
      category: 'Dynamics',
      samples: generatePianoTone(freq, SAMPLE_RATE, 500, amplitude),
      sampleRate: SAMPLE_RATE,
      expectedNotes: ['G4'],
      tolerance: { semitones: 1, octaveErrors: false },
    });
  }

  // 6. Noisy audio (low, medium, high noise)
  for (const [label, noiseLevel] of [['low noise', 0.01], ['medium noise', 0.05], ['high noise', 0.1]] as const) {
    const freq = midiToFreq(noteToMidi('E4'));
    const cleanSamples = generatePianoTone(freq, SAMPLE_RATE, 500);
    testCases.push({
      name: `Noise: ${label}`,
      category: 'Noisy Audio',
      samples: addNoise(cleanSamples, noiseLevel),
      sampleRate: SAMPLE_RATE,
      expectedNotes: ['E4'],
      tolerance: { semitones: 1, octaveErrors: false },
    });
  }

  // 7. Chords
  const chords: { name: string; notes: string[] }[] = [
    { name: 'C Major', notes: ['C4', 'E4', 'G4'] },
    { name: 'A Minor', notes: ['A3', 'C4', 'E4'] },
    { name: 'G7', notes: ['G3', 'B3', 'D4', 'F4'] },
    { name: 'F Major', notes: ['F3', 'A3', 'C4'] },
  ];

  for (const chord of chords) {
    const frequencies = chord.notes.map(n => midiToFreq(noteToMidi(n)));
    testCases.push({
      name: `Chord: ${chord.name}`,
      category: 'Chords',
      samples: generateChord(frequencies, SAMPLE_RATE, 600),
      sampleRate: SAMPLE_RATE,
      expectedNotes: chord.notes,
      tolerance: { semitones: 1, octaveErrors: true },
    });
  }

  // 8. C Major Scale (sequence)
  const cMajorScale = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
  testCases.push({
    name: 'C Major Scale',
    category: 'Sequences',
    samples: generateNoteSequence(cMajorScale.map(n => ({ note: n, durationMs: 300 })), SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    expectedNotes: cMajorScale,
    tolerance: { semitones: 1, octaveErrors: false },
  });

  // 9. Chromatic scale segment
  const chromaticNotes = ['C4', 'C#4', 'D4', 'D#4', 'E4'];
  testCases.push({
    name: 'Chromatic segment',
    category: 'Sequences',
    samples: generateNoteSequence(chromaticNotes.map(n => ({ note: n, durationMs: 250 })), SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    expectedNotes: chromaticNotes,
    tolerance: { semitones: 0, octaveErrors: false }, // Strict - must detect exact semitones
  });

  // 10. Octave jumps
  const octaveJumps = ['C3', 'C4', 'C5', 'C4', 'C3'];
  testCases.push({
    name: 'Octave jumps',
    category: 'Sequences',
    samples: generateNoteSequence(octaveJumps.map(n => ({ note: n, durationMs: 400 })), SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    expectedNotes: octaveJumps,
    tolerance: { semitones: 1, octaveErrors: true },
  });

  return testCases;
}

function createRealAudioTestCases(audioDir: string): TestCase[] {
  const testCases: TestCase[] = [];

  // Map of known audio files to their expected notes
  const audioExpectations: Record<string, { notes: string[]; category: string }> = {
    'test_c_major_scale.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], category: 'Real Audio - Simple' },
    'test_c4_sustained.wav': { notes: ['C4'], category: 'Real Audio - Simple' },
    'test_chromatic.wav': { notes: ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4'], category: 'Real Audio - Simple' },
    'test_octaves_c.wav': { notes: ['C2', 'C3', 'C4', 'C5', 'C6'], category: 'Real Audio - Octaves' },
    'test_low_notes.wav': { notes: ['C2', 'E2', 'G2', 'C3'], category: 'Real Audio - Low Notes' },
    'test_high_notes.wav': { notes: ['C6', 'E6', 'G6', 'C7'], category: 'Real Audio - High Notes' },
    'test_staccato.wav': { notes: ['C4', 'E4', 'G4', 'C5'], category: 'Real Audio - Staccato' },
    'piano_scale.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'], category: 'Real Audio - Simple' },
    'c_scale_realistic.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'], category: 'Real Audio - Realistic' },
    'c_scale_heavy_room.wav': { notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'], category: 'Real Audio - Room Noise' },
    'fur_elise_real.wav': { notes: ['E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4'], category: 'Real Audio - Classical' },
    'moonlight_sonata_real.wav': { notes: ['C#4', 'E4', 'G#4'], category: 'Real Audio - Classical' },
    'kaise_hua.wav': { notes: ['E4', 'B4', 'G4', 'F#4', 'A4'], category: 'Real Audio - Bollywood' },
    'tum_hi_ho.wav': { notes: ['D4', 'A4', 'F#4', 'E4', 'G4'], category: 'Real Audio - Bollywood' },
    'perfect.wav': { notes: ['G4', 'A4', 'B4', 'C5', 'D5', 'E5'], category: 'Real Audio - Pop' },
    'all_of_me.wav': { notes: ['F4', 'G4', 'A4', 'Bb4', 'C5'], category: 'Real Audio - Pop' },
  };

  for (const [filename, expectations] of Object.entries(audioExpectations)) {
    const filePath = path.join(audioDir, filename);

    if (fs.existsSync(filePath)) {
      try {
        const { samples, sampleRate } = readWavFile(filePath);
        testCases.push({
          name: filename.replace('.wav', ''),
          category: expectations.category,
          samples,
          sampleRate,
          expectedNotes: expectations.notes,
          tolerance: { semitones: 1, octaveErrors: true },
        });
      } catch (e) {
        console.error(`Failed to read ${filename}: ${e}`);
      }
    }
  }

  return testCases;
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

interface CategorySummary {
  total: number;
  passed: number;
  avgAccuracy: number;
  avgConfidence: number;
}

function runAllTests(audioDir?: string): void {
  console.log('=' .repeat(80));
  console.log('COMPREHENSIVE YIN ALGORITHM TEST SUITE');
  console.log('=' .repeat(80));
  console.log();

  // Collect all test cases
  const syntheticTests = createSyntheticTestCases();
  const realAudioTests = audioDir ? createRealAudioTestCases(audioDir) : [];
  const allTests = [...syntheticTests, ...realAudioTests];

  console.log(`Total test cases: ${allTests.length}`);
  console.log(`  Synthetic: ${syntheticTests.length}`);
  console.log(`  Real audio: ${realAudioTests.length}`);
  console.log();

  // Run tests and collect results
  const results: TestResult[] = [];
  const categorySummaries: Map<string, CategorySummary> = new Map();

  for (const testCase of allTests) {
    const result = runTestCase(testCase);
    results.push(result);

    // Update category summary
    const summary = categorySummaries.get(testCase.category) || {
      total: 0,
      passed: 0,
      avgAccuracy: 0,
      avgConfidence: 0,
    };

    summary.total++;
    if (result.passed) summary.passed++;
    summary.avgAccuracy = (summary.avgAccuracy * (summary.total - 1) + result.metrics.accuracy) / summary.total;
    summary.avgConfidence = (summary.avgConfidence * (summary.total - 1) + result.metrics.avgConfidence) / summary.total;

    categorySummaries.set(testCase.category, summary);

    // Print individual result
    const status = result.passed ? '✓' : '✗';
    const acc = (result.metrics.accuracy * 100).toFixed(0);
    const conf = (result.metrics.avgConfidence * 100).toFixed(0);
    const detCount = result.detections.length;

    console.log(`${status} ${testCase.name.padEnd(35)} Acc: ${acc.padStart(3)}%  Conf: ${conf.padStart(3)}%  Detections: ${detCount}`);

    if (!result.passed) {
      // Show details for failed tests
      const topNotes = [...new Set(result.detections.map(d => d.note))].slice(0, 5);
      console.log(`    Expected: ${testCase.expectedNotes.join(', ')}`);
      console.log(`    Detected: ${topNotes.join(', ')}`);
      if (result.metrics.octaveErrors > 0) {
        console.log(`    Octave errors: ${result.metrics.octaveErrors}`);
      }
    }
  }

  // Print category summaries
  console.log();
  console.log('=' .repeat(80));
  console.log('CATEGORY SUMMARY');
  console.log('=' .repeat(80));
  console.log();

  console.log('Category'.padEnd(30) + 'Passed'.padStart(10) + 'Accuracy'.padStart(12) + 'Confidence'.padStart(12));
  console.log('-'.repeat(64));

  for (const [category, summary] of categorySummaries) {
    const passRate = `${summary.passed}/${summary.total}`;
    const acc = (summary.avgAccuracy * 100).toFixed(1) + '%';
    const conf = (summary.avgConfidence * 100).toFixed(1) + '%';
    console.log(`${category.padEnd(30)}${passRate.padStart(10)}${acc.padStart(12)}${conf.padStart(12)}`);
  }

  // Overall summary
  const totalPassed = results.filter(r => r.passed).length;
  const overallAccuracy = results.reduce((sum, r) => sum + r.metrics.accuracy, 0) / results.length;
  const overallConfidence = results.reduce((sum, r) => sum + r.metrics.avgConfidence, 0) / results.length;

  console.log();
  console.log('=' .repeat(80));
  console.log('OVERALL RESULTS');
  console.log('=' .repeat(80));
  console.log();
  console.log(`Tests passed: ${totalPassed}/${results.length} (${(totalPassed / results.length * 100).toFixed(1)}%)`);
  console.log(`Average accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
  console.log(`Average confidence: ${(overallConfidence * 100).toFixed(1)}%`);
  console.log();

  // List all failed tests
  const failedTests = results.filter(r => !r.passed);
  if (failedTests.length > 0) {
    console.log('Failed tests:');
    for (const result of failedTests) {
      console.log(`  - ${result.testCase.name} (${result.testCase.category})`);
    }
  } else {
    console.log('🎉 All tests passed!');
  }
}

// CLI interface
const args = process.argv.slice(2);
const audioDir = args[0] || path.join(__dirname, '../../test-audio');

console.log(`Audio directory: ${audioDir}`);
console.log();

runAllTests(audioDir);
