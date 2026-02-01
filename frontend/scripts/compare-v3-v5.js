#!/usr/bin/env node
/**
 * V3 vs V5 Algorithm Comparison
 * Tests both algorithms on the same audio file and compares results.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const WINDOW_SIZE = 3072;
const HOP_SIZE = 512;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function noteToMidi(noteName) {
  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return null;
  const [, note, octaveStr] = match;
  const noteIndex = NOTE_NAMES.indexOf(note);
  if (noteIndex === -1) return null;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + noteIndex;
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

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// ============== V3 YIN Algorithm ==============
// Original V3 with multi-candidate scoring and spectral verification
function yinDetectV3(samples, sampleRate) {
  const bufferSize = samples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));
  if (tauMax < 2) return null;

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

  // First-minimum search (threshold 0.20)
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
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denom;
    }
  }

  let frequency = sampleRate / refinedTau;

  // V3: Multi-candidate octave-UP disambiguation
  const candidates = [{ freq: frequency, cmndVal: cmnd[bestTau], mult: 1 }];

  for (const mult of [2, 4, 8]) {
    const octTau = refinedTau / mult;
    if (octTau >= 2 && octTau < tauMax) {
      const octTauInt = Math.round(octTau);
      const octCmnd = cmnd[octTauInt];
      const octFreq = sampleRate / octTau;
      if (octCmnd < 0.20 && octFreq >= 130 && octFreq <= 4500) {
        candidates.push({ freq: octFreq, cmndVal: octCmnd, mult });
      }
    }
  }

  // Score candidates - prefer higher octaves with good CMND
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

    const octBonus = 0.1 * Math.log2(cand.mult);
    const score = (clarity * 0.4) + (freqPref * 0.5) + (octBonus * 0.1);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (!bestCandidate) return null;
  frequency = bestCandidate.freq;
  const finalCmnd = bestCandidate.cmndVal;

  // 130Hz floor with spectral verification
  if (frequency < 130 && frequency >= 32) {
    const octUp = frequency * 2;
    if (octUp <= 4500) {
      const magLow = getSpectralMagnitude(samples, frequency, sampleRate);
      const magHigh = getSpectralMagnitude(samples, octUp, sampleRate);
      if (magLow > 0 && magHigh > magLow * 0.20) {
        frequency = octUp;
      }
    }
  }

  if (frequency < 130) return null;

  const confidence = Math.max(0, Math.min(1, 1 - finalCmnd));
  return { frequency, confidence, cmndMin: finalCmnd };
}

// ============== V5 YIN Algorithm ==============
// Tighter threshold, aggressive octave-UP, no spectral verification
function yinDetectV5(samples, sampleRate) {
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

  // Tighter threshold (0.15)
  const threshold = 0.15;
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

  let frequency = sampleRate / refinedTau;
  if (frequency < 60 || frequency > 5000) return null;

  // V5: Aggressive octave-UP for low frequencies
  if (frequency < 250) {
    const halfTau = refinedTau / 2;
    if (halfTau >= 2 && halfTau < tauMax) {
      const halfTauInt = Math.floor(halfTau);
      const halfCmnd = cmnd[halfTauInt];
      if (halfCmnd < 0.35) {
        frequency *= 2;
      }
    }
  }

  // 130Hz floor
  if (frequency < 130 && frequency >= 32) {
    while (frequency < 130) frequency *= 2;
  }

  if (frequency < 130) return null;

  return { frequency, confidence: 1.0 - cmndMin, cmndMin };
}

// ============== Processing ==============
function processAudioFile(filePath) {
  const tempFile = path.join(process.env.TEMP || '/tmp', `compare_${Date.now()}.raw`);

  try {
    execSync(`ffmpeg -y -i "${filePath}" -f f32le -acodec pcm_f32le -ac 1 -ar 44100 "${tempFile}"`, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(`ffmpeg failed: ${err.message}`);
  }

  const buffer = fs.readFileSync(tempFile);
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  fs.unlinkSync(tempFile);

  const v3Results = { onsets: [], octaveErrors: 0, oscillations: 0, shortNotes: 0 };
  const v5Results = { onsets: [], octaveErrors: 0, oscillations: 0, shortNotes: 0 };

  // Process with both algorithms
  for (const [version, yinFn, results] of [['V3', yinDetectV3, v3Results], ['V5', yinDetectV5, v5Results]]) {
    let activeNote = null;
    let activeStart = 0;
    let silenceFrames = 0;
    let prevRms = 0;
    let pendingNote = null;
    let pendingCount = 0;

    const SILENCE_THRESHOLD = 0.003;
    const SILENCE_FRAMES_FOR_OFF = 3;
    // V5.1: Use V3's stricter threshold but keep V5's hysteresis
    const CONFIDENCE_THRESHOLD = 0.75;
    const ONSET_RMS_RATIO = 1.5;

    for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
      const window = samples.slice(i, i + WINDOW_SIZE);
      const timeMs = (i / SAMPLE_RATE) * 1000;
      const rms = calculateRms(window);

      if (rms < SILENCE_THRESHOLD) {
        silenceFrames++;
        if (silenceFrames >= SILENCE_FRAMES_FOR_OFF && activeNote !== null) {
          const duration = timeMs - activeStart;
          if (duration < 50) results.shortNotes++;
          activeNote = null;
          pendingNote = null;
          pendingCount = 0;
        }
        prevRms = rms;
        continue;
      }

      const isOnset = prevRms > 0.001 && rms > prevRms * ONSET_RMS_RATIO;
      if (isOnset && activeNote !== null) {
        activeNote = null;
        pendingNote = null;
        pendingCount = 0;
      }

      silenceFrames = 0;
      prevRms = rms;

      const result = yinFn(window, SAMPLE_RATE);
      if (!result || result.confidence < CONFIDENCE_THRESHOLD) continue;

      const note = midiToNote(frequencyToMidi(result.frequency));

      if (activeNote === null || activeNote !== note) {
        // Hysteresis (V5 only uses stronger hysteresis)
        let requiredFrames = 2;
        if (version === 'V5' && activeNote !== null) {
          const activeMidi = noteToMidi(activeNote);
          const newMidi = noteToMidi(note);
          if (activeMidi && newMidi) {
            const midiDiff = Math.abs(activeMidi - newMidi);
            if (midiDiff === 12 || midiDiff === 24) {
              requiredFrames = 8;
              if (result.confidence < 0.85) continue;
            } else if (midiDiff <= 2) {
              requiredFrames = 3;
            }
          }
        }

        if (pendingNote === note) {
          pendingCount++;
        } else {
          pendingNote = note;
          pendingCount = 1;
        }

        if (pendingCount >= requiredFrames) {
          // Check for octave error
          if (activeNote !== null) {
            const prevMidi = noteToMidi(activeNote);
            const newMidi = noteToMidi(note);
            if (prevMidi && newMidi) {
              const diff = Math.abs(prevMidi - newMidi);
              if (diff === 12 || diff === 24) {
                const timeDiff = timeMs - activeStart;
                if (timeDiff < 100) results.octaveErrors++;
              }
              // Check for oscillation
              if (results.onsets.length >= 2) {
                const prevPrev = results.onsets[results.onsets.length - 2];
                if (prevPrev && prevPrev.note === note) {
                  results.oscillations++;
                }
              }
            }

            const duration = timeMs - activeStart;
            if (duration < 50) results.shortNotes++;
          }

          results.onsets.push({ time: timeMs, note, confidence: result.confidence });
          activeNote = note;
          activeStart = timeMs;
          pendingNote = null;
          pendingCount = 0;
        }
      } else {
        pendingNote = null;
        pendingCount = 0;
      }
    }
  }

  return { v3Results, v5Results, duration: samples.length / SAMPLE_RATE };
}

// ============== Main ==============
const audioFile = process.argv[2];
if (!audioFile) {
  console.log('Usage: node compare-v3-v5.js <audio-file>');
  process.exit(1);
}

if (!fs.existsSync(audioFile)) {
  console.error('File not found:', audioFile);
  process.exit(1);
}

console.log('\n============================================================');
console.log('  V3 vs V5 ALGORITHM COMPARISON');
console.log('============================================================\n');
console.log('Audio:', path.basename(audioFile));
console.log('Processing...\n');

const { v3Results, v5Results, duration } = processAudioFile(audioFile);

console.log('                         V3           V5');
console.log('------------------------------------------------------------');
console.log(`Total onsets:        ${v3Results.onsets.length.toString().padStart(6)}       ${v5Results.onsets.length.toString().padStart(6)}`);
console.log(`Octave errors:       ${v3Results.octaveErrors.toString().padStart(6)}       ${v5Results.octaveErrors.toString().padStart(6)}`);
console.log(`Oscillations:        ${v3Results.oscillations.toString().padStart(6)}       ${v5Results.oscillations.toString().padStart(6)}`);
console.log(`Short notes (<50ms): ${v3Results.shortNotes.toString().padStart(6)}       ${v5Results.shortNotes.toString().padStart(6)}`);

// Unique notes
const v3Notes = [...new Set(v3Results.onsets.map(o => o.note))];
const v5Notes = [...new Set(v5Results.onsets.map(o => o.note))];
console.log(`\nUnique notes:        ${v3Notes.length.toString().padStart(6)}       ${v5Notes.length.toString().padStart(6)}`);

// Average confidence
const v3AvgConf = v3Results.onsets.length > 0
  ? (v3Results.onsets.reduce((s, o) => s + o.confidence, 0) / v3Results.onsets.length * 100).toFixed(1)
  : '0.0';
const v5AvgConf = v5Results.onsets.length > 0
  ? (v5Results.onsets.reduce((s, o) => s + o.confidence, 0) / v5Results.onsets.length * 100).toFixed(1)
  : '0.0';
console.log(`Avg confidence:      ${v3AvgConf.padStart(5)}%      ${v5AvgConf.padStart(5)}%`);

// Scoring
const v3Score = 100 - (v3Results.octaveErrors * 10) - (v3Results.oscillations * 5) - (v3Results.shortNotes * 2);
const v5Score = 100 - (v5Results.octaveErrors * 10) - (v5Results.oscillations * 5) - (v5Results.shortNotes * 2);
console.log(`\nQuality score:       ${Math.max(0, v3Score).toString().padStart(6)}       ${Math.max(0, v5Score).toString().padStart(6)}`);

console.log('\n------------------------------------------------------------');
if (v5Score > v3Score) {
  console.log(`✓ V5 wins by ${v5Score - v3Score} points`);
} else if (v3Score > v5Score) {
  console.log(`✗ V3 wins by ${v3Score - v5Score} points`);
} else {
  console.log('= Tie');
}
console.log('============================================================\n');
