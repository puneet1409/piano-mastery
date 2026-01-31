/**
 * Deep diagnosis of Kaise Hua detection
 * Why is A and D missing while F# is strongly detected?
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Reference frequencies for expected notes
const EXPECTED_NOTES = {
  'A3': midiToFreq(57),  // 220 Hz
  'E4': midiToFreq(64),  // 330 Hz
  'D4': midiToFreq(62),  // 294 Hz
  'G3': midiToFreq(55),  // 196 Hz
  'B3': midiToFreq(59),  // 247 Hz
  'F#3': midiToFreq(54), // 185 Hz (detected but not expected)
};

console.log('Expected note frequencies:');
for (const [note, freq] of Object.entries(EXPECTED_NOTES)) {
  console.log(`  ${note}: ${freq.toFixed(1)} Hz`);
}

function getSpectralMagnitude(samples, targetFreq, sampleRate) {
  const n = samples.length;
  if (targetFreq <= 0 || targetFreq >= sampleRate / 2) return 0;

  let real = 0, imag = 0;
  for (let t = 0; t < n; t++) {
    const angle = -2 * Math.PI * targetFreq * t / sampleRate;
    const windowed = samples[t] * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / (n - 1)));
    real += windowed * Math.cos(angle);
    imag += windowed * Math.sin(angle);
  }
  return Math.sqrt(real * real + imag * imag) / n;
}

// Full YIN with detailed logging
function analyzeWindow(samples, sampleRate, windowIndex) {
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
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // Find ALL local minima (not just first)
  const allMinima = [];
  for (let tau = 2; tau < tauMax - 1; tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] <= cmnd[tau + 1]) {
      const freq = sampleRate / tau;
      if (freq >= 80 && freq <= 1000) {
        allMinima.push({
          tau,
          cmnd: cmnd[tau],
          freq,
          note: midiToNote(frequencyToMidi(freq))
        });
      }
    }
  }

  // Sort by CMND value (best first)
  allMinima.sort((a, b) => a.cmnd - b.cmnd);

  return {
    minima: allMinima.slice(0, 10), // Top 10 candidates
    cmnd
  };
}

// WAV parsing
function parseWavFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);
    if (buffer.toString('utf8', 0, 4) !== 'RIFF') return null;

    let offset = 12;
    let sampleRate = 44100;
    let bitsPerSample = 16;
    let numChannels = 1;

    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('utf8', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);

      if (chunkId === 'fmt ') {
        numChannels = buffer.readUInt16LE(offset + 10);
        sampleRate = buffer.readUInt32LE(offset + 12);
        bitsPerSample = buffer.readUInt16LE(offset + 22);
      } else if (chunkId === 'data') {
        const dataOffset = offset + 8;
        const bytesPerSample = bitsPerSample / 8;
        const numSamples = Math.floor(chunkSize / bytesPerSample / numChannels);
        const samples = new Float32Array(numSamples);

        for (let i = 0; i < numSamples; i++) {
          samples[i] = buffer.readInt16LE(dataOffset + i * bytesPerSample * numChannels) / 32768;
        }

        return { samples, sampleRate, duration: numSamples / sampleRate };
      }
      offset += 8 + chunkSize;
    }
    return null;
  } catch {
    return null;
  }
}

function findAudioStart(wavData) {
  const chunkSize = Math.floor(wavData.sampleRate / 10);
  for (let start = 0; start + chunkSize < wavData.samples.length; start += chunkSize) {
    const chunk = wavData.samples.slice(start, start + chunkSize);
    const rms = Math.sqrt(chunk.reduce((s, x) => s + x * x, 0) / chunk.length);
    if (rms > 0.01) return start / wavData.sampleRate;
  }
  return 0;
}

// Main analysis
const TEST_AUDIO_DIR = path.join(__dirname, 'test-audio');
const wavPath = path.join(TEST_AUDIO_DIR, 'kaise_hua.wav');
const wavData = parseWavFile(wavPath);

if (!wavData) {
  console.log('Could not load kaise_hua.wav');
  process.exit(1);
}

console.log(`\nLoaded: ${wavData.duration.toFixed(1)}s at ${wavData.sampleRate}Hz`);

const audioStart = findAudioStart(wavData);
const WINDOW = 3072, HOP = 2048; // Larger hop for fewer samples
const duration = 10; // First 10 seconds

const startSample = Math.floor(audioStart * wavData.sampleRate);
const endSample = Math.min(
  Math.floor((audioStart + duration) * wavData.sampleRate),
  wavData.samples.length - WINDOW
);

console.log('\n' + '='.repeat(70));
console.log('ANALYZING CMND MINIMA IN KAISE HUA');
console.log('Looking for why A and D are missing while F# is detected');
console.log('='.repeat(70));

// Collect statistics on what frequencies appear as candidates
const freqBins = new Map(); // frequency -> count of appearances as candidate
const noteWins = new Map(); // note -> count of times it was the best candidate

let windowCount = 0;
for (let start = startSample; start < endSample; start += HOP) {
  const window = wavData.samples.slice(start, start + WINDOW);

  // Check RMS
  let rmsSum = 0;
  for (let i = 0; i < window.length; i++) {
    rmsSum += window[i] * window[i];
  }
  const rms = Math.sqrt(rmsSum / window.length);
  if (rms < 0.002) continue;

  const analysis = analyzeWindow(window, wavData.sampleRate, windowCount);
  windowCount++;

  // Track all candidates
  for (const m of analysis.minima) {
    if (m.cmnd < 0.25) { // Good candidates only
      const binFreq = Math.round(m.freq / 5) * 5; // 5Hz bins
      freqBins.set(binFreq, (freqBins.get(binFreq) || 0) + 1);
    }
  }

  // Track winners
  if (analysis.minima.length > 0 && analysis.minima[0].cmnd < 0.25) {
    const winner = analysis.minima[0];
    noteWins.set(winner.note, (noteWins.get(winner.note) || 0) + 1);
  }
}

console.log(`\nAnalyzed ${windowCount} windows`);

// Show frequency distribution
console.log('\n--- Frequency Candidates (5Hz bins, >5 occurrences) ---');
const sortedFreqs = [...freqBins.entries()]
  .filter(([_, count]) => count > 5)
  .sort((a, b) => b[1] - a[1]);

for (const [freq, count] of sortedFreqs.slice(0, 20)) {
  const note = midiToNote(frequencyToMidi(freq));
  const isExpected = ['A', 'E', 'D', 'G', 'B'].includes(note.replace(/\d+/, ''));
  const marker = isExpected ? '✓' : (note.includes('F#') ? '⚠️' : '');
  console.log(`  ${freq}Hz (${note}): ${count} times ${marker}`);
}

// Show winning notes
console.log('\n--- Notes that WIN (best CMND) ---');
const sortedWins = [...noteWins.entries()].sort((a, b) => b[1] - a[1]);
for (const [note, count] of sortedWins) {
  const pitchClass = note.replace(/\d+/, '');
  const isExpected = ['A', 'E', 'D', 'G', 'B'].includes(pitchClass);
  const marker = isExpected ? '✓ EXPECTED' : '';
  console.log(`  ${note}: ${count} wins ${marker}`);
}

// Analyze specific windows where A should be detected
console.log('\n--- Spectral Analysis at Expected Frequencies ---');
let windowsWithStrongA = 0;
let windowsWithStrongD = 0;
let windowsWithStrongFsharp = 0;

for (let start = startSample; start < endSample; start += HOP) {
  const window = wavData.samples.slice(start, start + WINDOW);

  const magA = getSpectralMagnitude(window, EXPECTED_NOTES['A3'], wavData.sampleRate);
  const magD = getSpectralMagnitude(window, EXPECTED_NOTES['D4'], wavData.sampleRate);
  const magFsharp = getSpectralMagnitude(window, EXPECTED_NOTES['F#3'], wavData.sampleRate);
  const magG = getSpectralMagnitude(window, EXPECTED_NOTES['G3'], wavData.sampleRate);

  if (magA > 0.001) windowsWithStrongA++;
  if (magD > 0.001) windowsWithStrongD++;
  if (magFsharp > 0.001) windowsWithStrongFsharp++;
}

const totalWindows = Math.floor((endSample - startSample) / HOP);
console.log(`  A3 (220Hz) has strong energy in: ${windowsWithStrongA}/${totalWindows} windows (${(windowsWithStrongA/totalWindows*100).toFixed(1)}%)`);
console.log(`  D4 (294Hz) has strong energy in: ${windowsWithStrongD}/${totalWindows} windows (${(windowsWithStrongD/totalWindows*100).toFixed(1)}%)`);
console.log(`  F#3 (185Hz) has strong energy in: ${windowsWithStrongFsharp}/${totalWindows} windows (${(windowsWithStrongFsharp/totalWindows*100).toFixed(1)}%)`);

// Sample a few windows and show detailed CMND
console.log('\n--- Sample Window Analysis (first 3 with good signal) ---');
let samplesShown = 0;
for (let start = startSample; start < endSample && samplesShown < 3; start += HOP * 5) {
  const window = wavData.samples.slice(start, start + WINDOW);

  let rmsSum = 0;
  for (let i = 0; i < window.length; i++) {
    rmsSum += window[i] * window[i];
  }
  const rms = Math.sqrt(rmsSum / window.length);
  if (rms < 0.01) continue;

  const timeMs = Math.floor(start * 1000 / wavData.sampleRate);
  const analysis = analyzeWindow(window, wavData.sampleRate, 0);

  console.log(`\nWindow at ${timeMs}ms (RMS: ${rms.toFixed(4)}):`);
  console.log('  Top CMND minima:');
  for (const m of analysis.minima.slice(0, 5)) {
    const isExpected = ['A', 'E', 'D', 'G', 'B'].includes(m.note.replace(/\d+/, ''));
    console.log(`    ${m.note} (${m.freq.toFixed(1)}Hz): CMND=${m.cmnd.toFixed(4)} ${isExpected ? '✓' : ''}`);
  }

  // Check CMND at expected note taus
  console.log('  CMND at expected note frequencies:');
  for (const [note, freq] of Object.entries(EXPECTED_NOTES)) {
    const tau = Math.round(wavData.sampleRate / freq);
    if (tau < analysis.cmnd.length) {
      const cmndVal = analysis.cmnd[tau];
      console.log(`    ${note} (tau=${tau}): CMND=${cmndVal.toFixed(4)} ${cmndVal < 0.25 ? '✓ good' : '✗ too high'}`);
    }
  }

  samplesShown++;
}
