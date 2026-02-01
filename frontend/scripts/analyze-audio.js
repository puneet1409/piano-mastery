#!/usr/bin/env node
/**
 * Analyze audio file for pitch detection diagnostics
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const WINDOW_SIZE = 3072;
const HOP_SIZE = 512;

// YIN detection (same as run-pitch-tests.js)
function yinDetect(samples, sampleRate) {
  const tauMax = Math.min(Math.floor(samples.length / 2), Math.floor(sampleRate / 60));
  if (tauMax < 2) return null;

  const diff = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < tauMax; i++) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? diff[tau] / (runningSum / tau) : 1.0;
  }

  const threshold = 0.20;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
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
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denom;
    }
  }

  const frequency = sampleRate / refinedTau;
  if (frequency < 60 || frequency > 5000) return null;

  return { frequency, confidence: 1.0 - cmndMin, cmndMin };
}

function frequencyToNote(freq) {
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midiNote);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return noteNames[noteIndex] + octave;
}

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// Main analysis
const audioPath = process.argv[2];
if (!audioPath) {
  console.log('Usage: node analyze-audio.js <audio.webm>');
  process.exit(1);
}

console.log('\n=== AUDIO ANALYSIS ===');
console.log('File:', audioPath);

// Convert to raw
const tempFile = path.join(process.env.TEMP || '/tmp', `analyze_${Date.now()}.raw`);
try {
  execSync(`ffmpeg -y -i "${audioPath}" -f f32le -acodec pcm_f32le -ac 1 -ar 44100 "${tempFile}"`, { stdio: 'pipe' });
} catch (err) {
  console.error('ffmpeg failed:', err.message);
  process.exit(1);
}

const buffer = fs.readFileSync(tempFile);
const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
fs.unlinkSync(tempFile);

console.log('Duration:', (samples.length / SAMPLE_RATE).toFixed(1), 'seconds');
console.log('Samples:', samples.length);

// Calculate overall stats
let maxAbs = 0;
let rmsSum = 0;
for (let i = 0; i < samples.length; i++) {
  maxAbs = Math.max(maxAbs, Math.abs(samples[i]));
  rmsSum += samples[i] * samples[i];
}
const overallRms = Math.sqrt(rmsSum / samples.length);

console.log('\n=== AUDIO LEVELS ===');
console.log('Peak amplitude:', maxAbs.toFixed(4));
console.log('Overall RMS:', overallRms.toFixed(4));

// Find active regions (where RMS > threshold)
const SILENCE_THRESHOLD = 0.003;
let activeRegions = [];
let inActive = false;
let activeStart = 0;

for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
  const window = samples.slice(i, i + WINDOW_SIZE);
  const rms = calculateRms(window);
  const timeMs = (i / SAMPLE_RATE) * 1000;

  if (rms >= SILENCE_THRESHOLD && !inActive) {
    inActive = true;
    activeStart = timeMs;
  } else if (rms < SILENCE_THRESHOLD && inActive) {
    inActive = false;
    const duration = timeMs - activeStart;
    if (duration > 50) { // Only count regions longer than 50ms
      activeRegions.push({ start: activeStart, end: timeMs, duration });
    }
  }
}

if (inActive) {
  activeRegions.push({ start: activeStart, end: (samples.length / SAMPLE_RATE) * 1000, duration: (samples.length / SAMPLE_RATE) * 1000 - activeStart });
}

console.log('\n=== ACTIVE AUDIO REGIONS ===');
console.log('Found', activeRegions.length, 'regions with audio above silence threshold');
if (activeRegions.length <= 20) {
  activeRegions.forEach((r, i) => {
    console.log(`  ${i + 1}. ${(r.start/1000).toFixed(1)}s - ${(r.end/1000).toFixed(1)}s (${(r.duration/1000).toFixed(1)}s)`);
  });
} else {
  console.log('  First 10:');
  activeRegions.slice(0, 10).forEach((r, i) => {
    console.log(`    ${i + 1}. ${(r.start/1000).toFixed(1)}s - ${(r.end/1000).toFixed(1)}s (${(r.duration/1000).toFixed(1)}s)`);
  });
  console.log('  Last 5:');
  activeRegions.slice(-5).forEach((r, i) => {
    console.log(`    ${activeRegions.length - 4 + i}. ${(r.start/1000).toFixed(1)}s - ${(r.end/1000).toFixed(1)}s (${(r.duration/1000).toFixed(1)}s)`);
  });
}

// Run full pitch detection
console.log('\n=== PITCH DETECTION (frame by frame) ===');

const CONFIDENCE_THRESHOLD = 0.65;
let detections = [];
let lowConfidenceCount = 0;
let silenceCount = 0;
let validDetections = 0;

for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
  const window = samples.slice(i, i + WINDOW_SIZE);
  const timeMs = (i / SAMPLE_RATE) * 1000;
  const rms = calculateRms(window);

  if (rms < SILENCE_THRESHOLD) {
    silenceCount++;
    continue;
  }

  const result = yinDetect(window, SAMPLE_RATE);
  if (!result) continue;

  if (result.confidence < CONFIDENCE_THRESHOLD) {
    lowConfidenceCount++;
    continue;
  }

  validDetections++;
  const note = frequencyToNote(result.frequency);
  detections.push({ time: timeMs, note, frequency: result.frequency, confidence: result.confidence, rms });
}

console.log('Total frames processed:', Math.floor((samples.length - WINDOW_SIZE) / HOP_SIZE));
console.log('Silent frames:', silenceCount);
console.log('Low confidence frames:', lowConfidenceCount);
console.log('Valid detections:', validDetections);

// Consolidate detections into note events
console.log('\n=== CONSOLIDATED NOTE EVENTS ===');
let noteEvents = [];
let activeNote = null;

for (const d of detections) {
  if (activeNote === null || activeNote.note !== d.note) {
    if (activeNote !== null) {
      activeNote.endTime = d.time;
      noteEvents.push(activeNote);
    }
    activeNote = {
      note: d.note,
      startTime: d.time,
      avgFreq: d.frequency,
      avgConf: d.confidence,
      count: 1
    };
  } else {
    activeNote.avgFreq = (activeNote.avgFreq * activeNote.count + d.frequency) / (activeNote.count + 1);
    activeNote.avgConf = (activeNote.avgConf * activeNote.count + d.confidence) / (activeNote.count + 1);
    activeNote.count++;
  }
}
if (activeNote) {
  activeNote.endTime = (samples.length / SAMPLE_RATE) * 1000;
  noteEvents.push(activeNote);
}

console.log('Total note events:', noteEvents.length);
console.log('\nAll detected notes (chronological):');
noteEvents.forEach((n, i) => {
  const duration = n.endTime - n.startTime;
  console.log(`  ${(n.startTime/1000).toFixed(1)}s: ${n.note.padEnd(4)} ${n.avgFreq.toFixed(1)}Hz conf:${(n.avgConf*100).toFixed(0)}% dur:${(duration/1000).toFixed(2)}s`);
});

// Note frequency histogram
console.log('\n=== NOTE HISTOGRAM ===');
const histogram = {};
noteEvents.forEach(n => {
  histogram[n.note] = (histogram[n.note] || 0) + 1;
});
Object.entries(histogram)
  .sort((a, b) => b[1] - a[1])
  .forEach(([note, count]) => {
    console.log(`  ${note.padEnd(4)}: ${'█'.repeat(Math.min(count, 50))} (${count})`);
  });

console.log('\n=== SUMMARY ===');
console.log('Unique notes detected:', Object.keys(histogram).length);
console.log('Most common note:', Object.entries(histogram).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none');
