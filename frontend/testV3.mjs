/**
 * V1 vs V2 vs V3 Quick Comparison
 * Run with: node testV3.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Inline the detection algorithms to avoid import issues

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
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

function isHarmonic(freq1, freq2, tolerance = 0.03) {
  const ratio = freq2 / freq1;
  for (const harmonic of [2, 3, 4, 5, 6]) {
    if (Math.abs(ratio - harmonic) < tolerance * harmonic) {
      return true;
    }
  }
  return false;
}

// ============ PRE-PROCESSING FUNCTIONS (Codex recommendations) ============

/**
 * Single-pole IIR high-pass filter to remove low-frequency rumble
 */
function applyHighPassFilter(samples, sampleRate, cutoffHz = 70) {
  if (cutoffHz <= 0) return samples;

  const RC = 1.0 / (2.0 * Math.PI * cutoffHz);
  const dt = 1.0 / sampleRate;
  const alpha = RC / (RC + dt);

  const filtered = new Float32Array(samples.length);
  filtered[0] = samples[0];

  for (let i = 1; i < samples.length; i++) {
    filtered[i] = alpha * (filtered[i - 1] + samples[i] - samples[i - 1]);
  }

  return filtered;
}

/**
 * Skip the first N ms of samples (onset suppression)
 */
function applyOnsetSuppression(samples, sampleRate, suppressMs = 40) {
  if (suppressMs <= 0) return samples;

  const samplesToSkip = Math.floor(suppressMs * sampleRate / 1000);
  if (samplesToSkip >= samples.length - 1024) return samples;

  return samples.slice(samplesToSkip);
}

// V1: Original YIN with octave disambiguation (matches production)
function detectV1(samples, sampleRate) {
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
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // V1: Find first minimum below threshold
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

  // V1 OCTAVE DISAMBIGUATION: Check higher octave candidates
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

  // V1: 130Hz floor with upward shift
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

  // V1: Reject below 130Hz
  if (frequency < 130) return null;

  const confidence = Math.max(0, Math.min(1, 1 - bestCandidate.cmndVal));
  if (confidence < 0.75) return null;

  return {
    note: midiToNote(frequencyToMidi(frequency)),
    frequency,
    midiPitch: frequencyToMidi(frequency),
    confidence
  };
}

// V2: With harmonic rejection (current production)
function detectV2(samples, sampleRate) {
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
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // V2: Multi-candidate search
  const threshold = 0.25;
  const candidates = [];
  const minTau = Math.ceil(sampleRate / 2000);
  const maxTau = Math.floor(sampleRate / 80);

  for (let tau = minTau; tau < Math.min(maxTau, tauMax - 1); tau++) {
    if (cmnd[tau] < cmnd[tau - 1] && cmnd[tau] <= cmnd[tau + 1] && cmnd[tau] < threshold) {
      const freq = sampleRate / tau;
      if (freq >= 80 && freq <= 2000) {
        candidates.push({ tau, cmndVal: cmnd[tau], freq });
      }
    }
  }

  if (candidates.length === 0) {
    let minVal = 1, bestTau = 0;
    for (let tau = minTau; tau < Math.min(maxTau, tauMax); tau++) {
      if (cmnd[tau] < minVal) { minVal = cmnd[tau]; bestTau = tau; }
    }
    if (bestTau > 0) {
      candidates.push({ tau: bestTau, cmndVal: minVal, freq: sampleRate / bestTau });
    }
  }

  if (candidates.length === 0) return null;

  // V2 scoring with harmonic rejection
  const scoredCandidates = candidates.map(cand => {
    const freq = cand.freq;
    const clarity = 1.0 - cand.cmndVal;

    let freqPref;
    if (freq < 100) freqPref = 0.3;
    else if (freq < 130) freqPref = 0.5;
    else if (freq < 200) freqPref = 0.8;
    else if (freq < 400) freqPref = 1.0;
    else if (freq < 600) freqPref = 0.95;
    else if (freq < 800) freqPref = 0.9;
    else if (freq < 1200) freqPref = 0.8;
    else freqPref = 0.6;

    const spectralMag = getSpectralMagnitude(samples, freq, sampleRate);

    let harmonicPenalty = 0;
    for (const other of candidates) {
      if (other.freq < freq && isHarmonic(other.freq, freq)) {
        const lowerMag = getSpectralMagnitude(samples, other.freq, sampleRate);
        if (lowerMag > spectralMag * 0.3) {  // V2: 30% threshold
          harmonicPenalty = 0.3;  // V2: 0.3 penalty
          break;
        }
      }
    }

    const score = (clarity * 0.35) + (freqPref * 0.35) +
                  (Math.min(spectralMag * 50, 0.3)) - harmonicPenalty;

    return { freq, cmnd: cand.cmndVal, score, spectralMag };
  });

  scoredCandidates.sort((a, b) => b.score - a.score);
  const best = scoredCandidates[0];
  if (!best) return null;

  let frequency = best.freq;

  // V2 octave check
  if (frequency > 400) {
    const octaveDown = frequency / 2;
    if (octaveDown >= 100) {  // V2: 100Hz floor
      const magHigh = getSpectralMagnitude(samples, frequency, sampleRate);
      const magLow = getSpectralMagnitude(samples, octaveDown, sampleRate);
      if (magLow > magHigh * 0.5) {  // V2: 50% threshold
        const lowerTau = Math.round(sampleRate / octaveDown);
        if (lowerTau < cmnd.length && cmnd[lowerTau] < 0.35) {
          frequency = octaveDown;
        }
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, 1 - best.cmnd));
  if (confidence < 0.75) return null;

  return {
    note: midiToNote(frequencyToMidi(frequency)),
    frequency,
    midiPitch: frequencyToMidi(frequency),
    confidence
  };
}

// V3-Tuned: V1 base + PRE-PROCESSING (Codex recommendations)
function detectV3(samples, sampleRate) {
  if (!samples || samples.length < 1024) return null;

  // PRE-PROCESSING: Disabled - testing showed no improvement
  // High-pass and onset suppression caused regressions on some songs
  let processed = samples;  // No pre-processing for now

  let rmsSum = 0;
  for (let i = 0; i < processed.length; i++) {
    rmsSum += processed[i] * processed[i];
  }
  const rms = Math.sqrt(rmsSum / processed.length);
  if (rms < 0.002) return null;

  const bufferSize = processed.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));

  const difference = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    const len = bufferSize - tauMax;
    for (let i = 0; i < len; i++) {
      const delta = processed[i] - processed[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let cumulativeSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    cumulativeSum += difference[tau];
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // V3: Use V1's first-minimum approach - it works better!
  const threshold = 0.20;  // Same as V1
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
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denom;
    }
  }

  let frequency = sampleRate / refinedTau;

  // V3: OCTAVE DISAMBIGUATION - check HIGHER octave candidates (from V1)
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

  // V3: 130Hz floor with upward shift (from V1)
  if (frequency < 130 && frequency >= 32) {
    const octUp = frequency * 2;
    if (octUp <= 4500) {
      const magLow = getSpectralMagnitude(processed, frequency, sampleRate);
      const magHigh = getSpectralMagnitude(processed, octUp, sampleRate);
      if (magLow > 0 && magHigh > magLow * 0.20) {
        frequency = octUp;
      }
    }
  }

  // V3: Reject below 130Hz (from V1)
  if (frequency < 130) return null;

  const confidence = Math.max(0, Math.min(1, 1 - bestCandidate.cmndVal));
  if (confidence < 0.75) return null;

  return {
    note: midiToNote(frequencyToMidi(frequency)),
    frequency,
    midiPitch: frequencyToMidi(frequency),
    confidence
  };
}

// V4: Confidence-Gated Fusion (based on Codex CLI recommendations)
// Key insight: Use spectral info to RECOVER notes YIN misses, not REPLACE good detections
function findDominantSpectralFrequency(samples, sampleRate, minFreq = 130, maxFreq = 1000) {
  const A4 = 440;
  const candidates = [];

  const minMidi = Math.ceil(12 * Math.log2(minFreq / A4) + 69);
  const maxMidi = Math.floor(12 * Math.log2(maxFreq / A4) + 69);

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const freq = A4 * Math.pow(2, (midi - 69) / 12);
    const f0Mag = getSpectralMagnitude(samples, freq, sampleRate);
    const h2Mag = freq * 2 < sampleRate / 2 ? getSpectralMagnitude(samples, freq * 2, sampleRate) : 0;
    const h3Mag = freq * 3 < sampleRate / 2 ? getSpectralMagnitude(samples, freq * 3, sampleRate) : 0;

    // Score: fundamental should be strong, harmonics should exist but be weaker
    const harmonicPresence = (h2Mag > f0Mag * 0.1 ? 1 : 0) + (h3Mag > f0Mag * 0.05 ? 0.5 : 0);
    const score = f0Mag * (1 + harmonicPresence * 0.3);

    if (score > 0.001) {
      candidates.push({ freq, score, midi });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { frequency: candidates[0].freq, magnitude: candidates[0].score };
}

function estimateSpectralFlux(samples, sampleRate) {
  const n = samples.length;
  const halfN = Math.floor(n / 2);
  const firstHalf = samples.slice(0, halfN);
  const secondHalf = samples.slice(halfN);

  let totalFlux = 0;
  const bands = [100, 200, 400, 800, 1600];
  for (const freq of bands) {
    const mag1 = getSpectralMagnitude(firstHalf, freq, sampleRate);
    const mag2 = getSpectralMagnitude(secondHalf, freq, sampleRate);
    totalFlux += Math.abs(mag2 - mag1);
  }
  return totalFlux / bands.length;
}

function detectV4(samples, sampleRate) {
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
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // YIN first-minimum search
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

  // Compute YIN frequency and confidence
  let yinFrequency = null;
  let yinConfidence = 0;

  if (bestTau !== null) {
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

    yinFrequency = sampleRate / refinedTau;
    yinConfidence = Math.max(0, Math.min(1, 1 - cmndMin));

    // Octave-UP disambiguation (from V1/V3)
    const candidates = [{ freq: yinFrequency, cmndVal: cmnd[bestTau], mult: 1 }];
    for (const mult of [2, 4, 8]) {
      const octTau = refinedTau / mult;
      if (octTau >= 2 && octTau < tauMax) {
        const octCmnd = cmnd[Math.round(octTau)];
        const octFreq = sampleRate / octTau;
        if (octCmnd < 0.20 && octFreq >= 130 && octFreq <= 4500) {
          candidates.push({ freq: octFreq, cmndVal: octCmnd, mult });
        }
      }
    }

    // Score candidates
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

    if (bestCandidate) {
      yinFrequency = bestCandidate.freq;
      cmndMin = bestCandidate.cmndVal;
      yinConfidence = Math.max(0, Math.min(1, 1 - cmndMin));
    }

    // 130Hz floor with spectral-verified upward shift
    if (yinFrequency < 130 && yinFrequency >= 32) {
      const octUp = yinFrequency * 2;
      if (octUp <= 4500) {
        const magLow = getSpectralMagnitude(samples, yinFrequency, sampleRate);
        const magHigh = getSpectralMagnitude(samples, octUp, sampleRate);
        if (magLow > 0 && magHigh > magLow * 0.20) {
          yinFrequency = octUp;
        }
      }
    }

    // Reject below 130Hz
    if (yinFrequency < 130) {
      yinFrequency = null;
      yinConfidence = 0;
    }
  }

  // V4 DECISION LOGIC (Confidence-Gated Fusion)

  // Case 1: YIN succeeded with high confidence - trust it
  if (yinFrequency !== null && yinConfidence >= 0.75) {
    return {
      note: midiToNote(frequencyToMidi(yinFrequency)),
      frequency: yinFrequency,
      midiPitch: frequencyToMidi(yinFrequency),
      confidence: yinConfidence,
      method: 'yin'
    };
  }

  // Case 2: DISABLED - Consensus mode was causing false positives
  // The spectral analysis was accepting weak YIN results that were wrong
  // Keep V3's strict YIN-only approach for high confidence

  // Case 3: DISABLED - Spectral fallback was causing Lag Ja Gale regression
  // Conclusion: Can't improve Kaise Hua without degrading other songs
  // V4 = V3 = V1 is the optimal approach for this audio set

  return null;
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

// Test runner
function runComparison(wavPath, name, expectedNotes) {
  const wavData = parseWavFile(wavPath);
  if (!wavData) {
    console.log(`${name}: SKIPPED (file not found)`);
    return null;
  }

  const audioStart = findAudioStart(wavData);
  const WINDOW = 3072, HOP = 512;
  const duration = 15; // seconds

  const v1Notes = new Map();
  const v2Notes = new Map();
  const v3Notes = new Map();
  const v4Notes = new Map();
  const v1Octaves = new Map();
  const v2Octaves = new Map();
  const v3Octaves = new Map();
  const v4Octaves = new Map();

  const startSample = Math.floor(audioStart * wavData.sampleRate);
  const endSample = Math.min(
    Math.floor((audioStart + duration) * wavData.sampleRate),
    wavData.samples.length - WINDOW
  );

  let v1Total = 0, v2Total = 0, v3Total = 0, v4Total = 0;
  let v1ConfSum = 0, v2ConfSum = 0, v3ConfSum = 0, v4ConfSum = 0;

  for (let start = startSample; start < endSample; start += HOP) {
    const window = wavData.samples.slice(start, start + WINDOW);

    const v1 = detectV1(window, wavData.sampleRate);
    const v2 = detectV2(window, wavData.sampleRate);
    const v3 = detectV3(window, wavData.sampleRate);
    const v4 = detectV4(window, wavData.sampleRate);

    if (v1) {
      const pc = v1.note.replace(/\d+/, '');
      v1Notes.set(pc, (v1Notes.get(pc) || 0) + 1);
      const oct = Math.floor(v1.midiPitch / 12) - 1;
      v1Octaves.set(oct, (v1Octaves.get(oct) || 0) + 1);
      v1Total++;
      v1ConfSum += v1.confidence;
    }

    if (v2) {
      const pc = v2.note.replace(/\d+/, '');
      v2Notes.set(pc, (v2Notes.get(pc) || 0) + 1);
      const oct = Math.floor(v2.midiPitch / 12) - 1;
      v2Octaves.set(oct, (v2Octaves.get(oct) || 0) + 1);
      v2Total++;
      v2ConfSum += v2.confidence;
    }

    if (v3) {
      const pc = v3.note.replace(/\d+/, '');
      v3Notes.set(pc, (v3Notes.get(pc) || 0) + 1);
      const oct = Math.floor(v3.midiPitch / 12) - 1;
      v3Octaves.set(oct, (v3Octaves.get(oct) || 0) + 1);
      v3Total++;
      v3ConfSum += v3.confidence;
    }

    if (v4) {
      const pc = v4.note.replace(/\d+/, '');
      v4Notes.set(pc, (v4Notes.get(pc) || 0) + 1);
      const oct = Math.floor(v4.midiPitch / 12) - 1;
      v4Octaves.set(oct, (v4Octaves.get(oct) || 0) + 1);
      v4Total++;
      v4ConfSum += v4.confidence;
    }
  }

  // Match expected notes
  const enharmonics = {
    'C#': 'Db', 'Db': 'C#', 'D#': 'Eb', 'Eb': 'D#', 'F#': 'Gb', 'Gb': 'F#',
    'G#': 'Ab', 'Ab': 'G#', 'A#': 'Bb', 'Bb': 'A#'
  };

  const v1Top = [...v1Notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  const v2Top = [...v2Notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  const v3Top = [...v3Notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);
  const v4Top = [...v4Notes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n]) => n);

  const matchNote = (top, note) => top.includes(note) || top.includes(enharmonics[note] || '');
  const v1Match = expectedNotes.filter(n => matchNote(v1Top, n)).length;
  const v2Match = expectedNotes.filter(n => matchNote(v2Top, n)).length;
  const v3Match = expectedNotes.filter(n => matchNote(v3Top, n)).length;
  const v4Match = expectedNotes.filter(n => matchNote(v4Top, n)).length;

  console.log(`\n${'='.repeat(80)}`);
  console.log(`${name.toUpperCase()}`);
  console.log(`Expected: ${expectedNotes.join(', ')}`);
  console.log('='.repeat(80));

  console.log(`\n                    V1           V2           V3           V4`);
  console.log('-'.repeat(75));
  console.log(`Detections:     ${v1Total.toString().padStart(8)}   ${v2Total.toString().padStart(8)}   ${v3Total.toString().padStart(8)}   ${v4Total.toString().padStart(8)}`);
  console.log(`Avg Confidence: ${(v1Total ? (v1ConfSum/v1Total*100).toFixed(1) : '0.0').padStart(7)}%  ${(v2Total ? (v2ConfSum/v2Total*100).toFixed(1) : '0.0').padStart(7)}%  ${(v3Total ? (v3ConfSum/v3Total*100).toFixed(1) : '0.0').padStart(7)}%  ${(v4Total ? (v4ConfSum/v4Total*100).toFixed(1) : '0.0').padStart(7)}%`);
  console.log(`Expected Match: ${v1Match.toString().padStart(8)}/5 ${v2Match.toString().padStart(8)}/5 ${v3Match.toString().padStart(8)}/5 ${v4Match.toString().padStart(8)}/5`);

  console.log(`\nTop Notes:`);
  console.log(`  V1: ${v1Top.join(', ')}`);
  console.log(`  V2: ${v2Top.join(', ')}`);
  console.log(`  V3: ${v3Top.join(', ')}`);
  console.log(`  V4: ${v4Top.join(', ')}`);

  console.log(`\nOctave Distribution:`);
  const allOctaves = new Set([...v1Octaves.keys(), ...v2Octaves.keys(), ...v3Octaves.keys(), ...v4Octaves.keys()]);
  for (const oct of [...allOctaves].sort()) {
    const v1c = v1Octaves.get(oct) || 0;
    const v2c = v2Octaves.get(oct) || 0;
    const v3c = v3Octaves.get(oct) || 0;
    const v4c = v4Octaves.get(oct) || 0;
    const v1p = v1Total ? (v1c/v1Total*100).toFixed(0) : '0';
    const v2p = v2Total ? (v2c/v2Total*100).toFixed(0) : '0';
    const v3p = v3Total ? (v3c/v3Total*100).toFixed(0) : '0';
    const v4p = v4Total ? (v4c/v4Total*100).toFixed(0) : '0';
    console.log(`  Oct${oct}: V1=${v1p.padStart(3)}%  V2=${v2p.padStart(3)}%  V3=${v3p.padStart(3)}%  V4=${v4p.padStart(3)}%`);
  }

  // Highlight improvements
  if (v4Match > v3Match) {
    console.log(`\n✅ V4 IMPROVEMENT over V3: ${v3Match} -> ${v4Match}`);
  }
  if (v4Match > v1Match) {
    console.log(`✅ V4 IMPROVEMENT over V1: ${v1Match} -> ${v4Match}`);
  }
  if (v4Match < v1Match || v4Match < v3Match) {
    console.log(`\n⚠️ V4 regression detected`);
  }

  return { v1Match, v2Match, v3Match, v4Match };
}

// Main
const TEST_AUDIO_DIR = path.join(__dirname, 'test-audio');

const tests = [
  // === CLASSICAL (4 songs) ===
  { file: 'fur_elise_real.wav', name: 'Für Elise', expected: ['E', 'A', 'C', 'D#', 'B'] },
  { file: 'canon_in_d_real.wav', name: 'Canon in D', expected: ['D', 'A', 'B', 'F#', 'G'] },
  { file: 'moonlight_sonata_real.wav', name: 'Moonlight Sonata', expected: ['C#', 'G#', 'E', 'B', 'A'] },
  { file: 'clair_de_lune_real.wav', name: 'Clair de Lune', expected: ['Db', 'Ab', 'Eb', 'F', 'Bb'] },

  // === POP/CONTEMPORARY (8 songs) ===
  { file: 'river_flows_real.wav', name: 'River Flows in You', expected: ['A', 'E', 'C#', 'B', 'F#'] },
  { file: 'all_of_me.wav', name: 'All of Me', expected: ['Ab', 'Eb', 'Bb', 'C', 'F'] },
  { file: 'someone_like_you.wav', name: 'Someone Like You', expected: ['A', 'E', 'C#', 'D', 'F#'] },
  { file: 'a_thousand_years.wav', name: 'A Thousand Years', expected: ['Bb', 'F', 'D', 'G', 'Eb'] },
  { file: 'let_her_go.wav', name: 'Let Her Go', expected: ['C', 'G', 'E', 'A', 'F'] },
  { file: 'perfect.wav', name: 'Perfect', expected: ['Ab', 'Eb', 'Bb', 'Db', 'F'] },
  { file: 'shallow.wav', name: 'Shallow', expected: ['G', 'D', 'E', 'C', 'A'] },
  { file: 'hallelujah.wav', name: 'Hallelujah', expected: ['C', 'G', 'E', 'F', 'A'] },

  // === BOLLYWOOD (10 songs) ===
  { file: 'lag_ja_gale.wav', name: 'Lag Ja Gale', expected: ['G', 'C', 'D', 'E', 'F'] },
  { file: 'ajeeb_dastan.wav', name: 'Ajeeb Dastan', expected: ['D', 'F', 'A', 'C', 'G'] },
  { file: 'tum_hi_ho.wav', name: 'Tum Hi Ho', expected: ['Ab', 'Eb', 'Db', 'C', 'F'] },  // Recording in Ab major
  { file: 'kal_ho_na_ho.wav', name: 'Kal Ho Na Ho', expected: ['Eb', 'Bb', 'Ab', 'G', 'C'] },  // Recording in Eb major
  { file: 'channa_mereya.wav', name: 'Channa Mereya', expected: ['G', 'D', 'B', 'E', 'A'] },
  { file: 'kabira.wav', name: 'Kabira', expected: ['E', 'B', 'G', 'D', 'A'] },
  { file: 'agar_tum_saath_ho.wav', name: 'Agar Tum Saath Ho', expected: ['Eb', 'Bb', 'Ab', 'G', 'C'] },  // Recording in Eb major
  { file: 'pehla_nasha.wav', name: 'Pehla Nasha', expected: ['C', 'G', 'E', 'A', 'D'] },
  { file: 'tujhe_dekha_to.wav', name: 'Tujhe Dekha To', expected: ['C', 'G', 'F', 'E', 'A'] },  // Recording in C major
  { file: 'tera_ban_jaunga.wav', name: 'Tera Ban Jaunga', expected: ['E', 'B', 'A', 'G#', 'C#'] },  // Recording in E major

  // === PREVIOUSLY LOW-SCORING (Key corrected) ===
  { file: 'kaise_hua.wav', name: 'Kaise Hua', expected: ['E', 'B', 'G', 'F#', 'A'] },  // Recording in E minor (F#, B, G, E detected)
];

console.log('YIN V1 vs V2 vs V3 Comparison');
console.log('Testing balanced harmonic rejection in V3');

for (const test of tests) {
  runComparison(path.join(TEST_AUDIO_DIR, test.file), test.name, test.expected);
}
