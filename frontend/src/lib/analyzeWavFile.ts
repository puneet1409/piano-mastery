/**
 * Analyze a WAV file using YIN pitch detection
 *
 * Usage: npx ts-node --esm src/lib/analyzeWavFile.ts <path-to-wav>
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectPitchWorklet, getRecommendedWindowSize } from './yinWorkletDetector';

// Window sizes for YIN (dynamic based on expected frequency range)
const WINDOW_SAMPLES_STANDARD = 3072; // ~70ms - good for notes >= C3 (130Hz)
const WINDOW_SAMPLES_LOW = 6144;      // ~140ms - needed for notes < C3

interface WavHeader {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
}

function parseWavHeader(buffer: Buffer): WavHeader {
  // Check RIFF header
  const riff = buffer.toString('utf8', 0, 4);
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file (no RIFF header)');

  const wave = buffer.toString('utf8', 8, 12);
  if (wave !== 'WAVE') throw new Error('Not a valid WAV file (no WAVE format)');

  // Find fmt chunk
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('utf8', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(offset + 8);
      if (audioFormat !== 1) throw new Error('Only PCM WAV files are supported');

      return {
        numChannels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
        dataOffset: 0, // Will be set when we find data chunk
        dataSize: 0,
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

function readWavSamples(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buffer = fs.readFileSync(filePath);
  const header = parseWavHeader(buffer);
  const dataChunk = findDataChunk(buffer);

  const bytesPerSample = header.bitsPerSample / 8;
  const numSamples = dataChunk.size / bytesPerSample / header.numChannels;
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const sampleOffset = dataChunk.offset + i * bytesPerSample * header.numChannels;

    let sample: number;
    if (header.bitsPerSample === 16) {
      sample = buffer.readInt16LE(sampleOffset) / 32768;
    } else if (header.bitsPerSample === 32) {
      sample = buffer.readFloatLE(sampleOffset);
    } else if (header.bitsPerSample === 8) {
      sample = (buffer.readUInt8(sampleOffset) - 128) / 128;
    } else {
      throw new Error(`Unsupported bit depth: ${header.bitsPerSample}`);
    }

    samples[i] = sample;
  }

  return { samples, sampleRate: header.sampleRate };
}

interface Detection {
  timeMs: number;
  note: string;
  frequency: number;
  midiPitch: number;
  confidence: number;
}

function analyzeWithYin(samples: Float32Array, sampleRate: number, lowNoteMode: boolean = false): Detection[] {
  // Use larger window for low notes (< C3 / 130Hz)
  const WINDOW_SAMPLES = lowNoteMode ? WINDOW_SAMPLES_LOW : WINDOW_SAMPLES_STANDARD;
  const HOP_SAMPLES = 512;     // ~11.6ms
  const detections: Detection[] = [];

  console.log(`\nAnalyzing ${samples.length} samples (${(samples.length / sampleRate).toFixed(2)}s) at ${sampleRate}Hz`);
  console.log(`Window: ${WINDOW_SAMPLES} samples (${(WINDOW_SAMPLES / sampleRate * 1000).toFixed(1)}ms)${lowNoteMode ? ' [LOW NOTE MODE]' : ''}`);
  console.log(`Hop: ${HOP_SAMPLES} samples (${(HOP_SAMPLES / sampleRate * 1000).toFixed(1)}ms)\n`);

  for (let start = 0; start + WINDOW_SAMPLES < samples.length; start += HOP_SAMPLES) {
    const window = samples.slice(start, start + WINDOW_SAMPLES);
    const timeMs = Math.floor(start * 1000 / sampleRate);

    const result = detectPitchWorklet(window, sampleRate);

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

function summarizeDetections(detections: Detection[]): void {
  if (detections.length === 0) {
    console.log('No notes detected!');
    return;
  }

  // Count by note
  const noteCounts: Record<string, number> = {};
  for (const d of detections) {
    noteCounts[d.note] = (noteCounts[d.note] || 0) + 1;
  }

  // Sort by count
  const sorted = Object.entries(noteCounts).sort((a, b) => b[1] - a[1]);

  console.log('=== Detection Summary ===\n');
  console.log(`Total detections: ${detections.length}`);
  console.log(`Unique notes: ${Object.keys(noteCounts).length}\n`);

  console.log('Notes detected (by frequency):');
  for (const [note, count] of sorted.slice(0, 15)) {
    const pct = (count / detections.length * 100).toFixed(1);
    console.log(`  ${note.padEnd(5)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Timeline (first 30)
  console.log('\n=== Timeline (first 30 detections) ===\n');
  console.log('Time(ms)  Note   Freq(Hz)  Confidence');
  console.log('-'.repeat(45));
  for (const d of detections.slice(0, 30)) {
    console.log(`${d.timeMs.toString().padStart(7)}   ${d.note.padEnd(5)}  ${d.frequency.toFixed(1).padStart(7)}   ${(d.confidence * 100).toFixed(0)}%`);
  }
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: npx ts-node --esm src/lib/analyzeWavFile.ts <path-to-wav> [--low-notes]');
  console.log('');
  console.log('Options:');
  console.log('  --low-notes   Use larger window for low notes (below C3/130Hz)');
  console.log('');
  console.log('Example: npx ts-node --esm src/lib/analyzeWavFile.ts /mnt/c/temp/recording.wav');
  console.log('         npx ts-node --esm src/lib/analyzeWavFile.ts bass.wav --low-notes');
  process.exit(1);
}

// Parse arguments
const lowNoteMode = args.includes('--low-notes');
const wavPath = args.find(arg => !arg.startsWith('--')) || '';

if (!wavPath || !fs.existsSync(wavPath)) {
  console.error(`File not found: ${wavPath}`);
  process.exit(1);
}

console.log(`Analyzing: ${wavPath}${lowNoteMode ? ' (low-note mode)' : ''}\n`);

try {
  const { samples, sampleRate } = readWavSamples(wavPath);

  // Basic stats
  let maxAmp = 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    maxAmp = Math.max(maxAmp, Math.abs(samples[i]));
    sumSquares += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const maxDb = 20 * Math.log10(maxAmp || 0.0001);
  const rmsDb = 20 * Math.log10(rms || 0.0001);

  console.log('=== Audio Stats ===');
  console.log(`  Duration: ${(samples.length / sampleRate).toFixed(2)}s`);
  console.log(`  Sample rate: ${sampleRate}Hz`);
  console.log(`  Max amplitude: ${maxAmp.toFixed(4)} (${maxDb.toFixed(1)} dB)`);
  console.log(`  RMS level: ${rms.toFixed(4)} (${rmsDb.toFixed(1)} dB)`);

  if (maxAmp < 0.01) {
    console.log('\nWARNING: Very low audio level - may not get good detections\n');
  }

  // Run YIN (use low-note mode if specified)
  const detections = analyzeWithYin(samples, sampleRate, lowNoteMode);
  summarizeDetections(detections);

} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
