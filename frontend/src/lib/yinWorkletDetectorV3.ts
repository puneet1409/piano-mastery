/**
 * YIN Pitch Detector V3 - Fixed Version
 *
 * V3 Analysis Summary:
 * - V2's harmonic rejection and octave-down checks CAUSED the Bollywood regressions
 * - V1's approach (first-minimum, octave-up disambiguation, 130Hz floor) is correct
 * - V3 = V1 algorithm, with cleaner code structure
 *
 * Key insight: Piano pitch detection should prefer HIGHER octaves, not lower.
 * V2 tried to push notes DOWN to fundamentals, but that's wrong for piano.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export interface WorkletDetectionV3 {
  note: string;
  frequency: number;
  midiPitch: number;
  confidence: number;
  velocity: number;
  cmndMin: number;
  rms: number;
}

/**
 * Compute spectral magnitude using Goertzel algorithm (for octave verification)
 */
function getSpectralMagnitude(samples: Float32Array, targetFreq: number, sampleRate: number): number {
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

export interface DetectorOptionsV3 {
  minConfidence?: number;
  minRms?: number;
  // Pre-processing options (Codex recommendations)
  highPassCutoff?: number;    // Hz, default 70 (removes rumble)
  onsetSuppressionMs?: number; // ms, default 0 (skip transient attack)
  // Dynamic windowing for low notes
  expectedNotes?: string[];   // If any are below C3, use larger window
}

/** Standard window size for notes >= 130Hz */
const WINDOW_SAMPLES_STANDARD = 3072;  // ~70ms
/** Extended window size for notes < 130Hz */
const WINDOW_SAMPLES_LOW = 6144;       // ~140ms
/** MIDI threshold for low-note mode */
const LOW_NOTE_THRESHOLD_MIDI = 48;    // C3

/**
 * Get the recommended minimum sample count for the given expected notes.
 * Low notes need longer windows for accurate YIN detection.
 */
export function getRecommendedWindowSize(expectedNotes?: string[]): number {
  if (!expectedNotes || expectedNotes.length === 0) {
    return WINDOW_SAMPLES_STANDARD;
  }

  for (const note of expectedNotes) {
    const midi = noteNameToMidi(note);
    if (midi < LOW_NOTE_THRESHOLD_MIDI) {
      return WINDOW_SAMPLES_LOW;
    }
  }

  return WINDOW_SAMPLES_STANDARD;
}

function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const match = noteName.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const [, note, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[note] ?? 0);
}

/**
 * Apply single-pole high-pass filter to remove low-frequency rumble
 * This helps with recordings that have room noise or pedal sounds
 */
function applyHighPassFilter(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  if (cutoffHz <= 0) return samples;

  // Single-pole IIR high-pass: y[n] = alpha * (y[n-1] + x[n] - x[n-1])
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
 * YIN pitch detection V3 - Uses V1's proven approach
 *
 * Algorithm:
 * 1. First-minimum search (threshold 0.20)
 * 2. Octave-UP disambiguation (check tau/2, tau/4, tau/8)
 * 3. 130Hz floor with spectral-verified upward shift
 * 4. Reject anything still below 130Hz
 */
export function detectPitchWorkletV3(
  samples: Float32Array,
  sampleRate: number = 44100,
  options: DetectorOptionsV3 = {}
): WorkletDetectionV3 | null {
  const {
    minConfidence = 0.75,
    minRms = 0.002,
    highPassCutoff = 70,       // Default: 70Hz high-pass (Codex recommendation)
    onsetSuppressionMs = 0,    // Default: disabled (can enable with 30-50ms)
    expectedNotes             // Used to determine if larger window is needed
  } = options;

  // Get recommended window size based on expected notes
  const recommendedWindowSize = getRecommendedWindowSize(expectedNotes);
  const minSamples = Math.min(1024, recommendedWindowSize);

  if (!samples || samples.length < minSamples) {
    return null;
  }

  // Warn if samples might be too short for low notes
  if (expectedNotes && samples.length < recommendedWindowSize) {
    // Detection will proceed but may be less accurate for low notes
  }

  // PRE-PROCESSING STEP 1: Onset suppression (skip transient attack phase)
  let processedSamples = samples;
  if (onsetSuppressionMs > 0) {
    const samplesToSkip = Math.floor(onsetSuppressionMs * sampleRate / 1000);
    if (samplesToSkip < samples.length - 1024) {
      processedSamples = samples.slice(samplesToSkip);
    }
  }

  // PRE-PROCESSING STEP 2: High-pass filter (remove low-frequency rumble)
  if (highPassCutoff > 0) {
    processedSamples = applyHighPassFilter(processedSamples, sampleRate, highPassCutoff);
  }

  // Calculate RMS on processed samples
  let rmsSum = 0;
  for (let i = 0; i < processedSamples.length; i++) {
    rmsSum += processedSamples[i] * processedSamples[i];
  }
  const rms = Math.sqrt(rmsSum / processedSamples.length);

  if (rms < minRms) {
    return null;
  }

  const bufferSize = processedSamples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));

  // Step 1: Difference function
  const difference = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    const len = bufferSize - tauMax;
    for (let i = 0; i < len; i++) {
      const delta = processedSamples[i] - processedSamples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  // Step 2: CMND
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

  // Step 3: First-minimum search (V1 approach - NOT multi-candidate)
  const threshold = 0.20;
  let bestTau: number | null = null;
  let cmndMin = 1.0;

  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      // Follow to local minimum
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

  if (bestTau === null) {
    return null;
  }

  // Step 4: Parabolic interpolation
  let refinedTau = bestTau;
  if (bestTau > 0 && bestTau < tauMax - 1) {
    const alpha = cmnd[bestTau - 1];
    const beta = cmnd[bestTau];
    const gamma = cmnd[bestTau + 1];
    const denominator = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denominator) > 1e-10) {
      const peak = (alpha - gamma) / denominator;
      refinedTau = bestTau + peak;
    }
  }

  let frequency = sampleRate / refinedTau;

  // Step 5: OCTAVE-UP disambiguation (V1 approach - NOT octave-down!)
  // Check if HIGHER octave candidates have valid CMND
  interface Candidate {
    freq: number;
    cmndVal: number;
    multiplier: number;
  }

  const candidates: Candidate[] = [
    { freq: frequency, cmndVal: cmnd[bestTau], multiplier: 1 }
  ];

  for (const multiplier of [2, 4, 8]) {
    const octaveTau = refinedTau / multiplier;
    if (octaveTau >= 2 && octaveTau < tauMax) {
      const octaveTauInt = Math.round(octaveTau);
      const octaveCmnd = cmnd[octaveTauInt];
      const octaveFreq = sampleRate / octaveTau;

      // Accept if CMND is good and frequency is in valid range
      if (octaveCmnd < 0.20 && octaveFreq >= 130 && octaveFreq <= 4500) {
        candidates.push({
          freq: octaveFreq,
          cmndVal: octaveCmnd,
          multiplier
        });
      }
    }
  }

  // Score candidates - prefer higher octaves with good CMND
  let bestCandidate: Candidate | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const freq = cand.freq;
    const cmndVal = cand.cmndVal;
    const multiplier = cand.multiplier;

    const clarity = 1.0 - cmndVal;

    // Frequency preference (piano range)
    let freqPref: number;
    if (freq < 80) freqPref = 0.1;
    else if (freq < 130) freqPref = 0.3;
    else if (freq < 200) freqPref = 0.6;
    else if (freq < 600) freqPref = 1.0;  // Sweet spot
    else if (freq < 1200) freqPref = 0.95;
    else if (freq < 2400) freqPref = 0.85;
    else freqPref = 0.7;

    // Octave bonus - prefer higher octaves when CMND is comparable
    const octaveBonus = 0.1 * Math.log2(multiplier);

    const score = (clarity * 0.4) + (freqPref * 0.5) + (octaveBonus * 0.1);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = cand;
    }
  }

  if (!bestCandidate) {
    return null;
  }

  frequency = bestCandidate.freq;
  const finalCmnd = bestCandidate.cmndVal;

  // Step 6: 130Hz floor with spectral-verified upward shift
  if (frequency < 130 && frequency >= 32) {
    const octaveUp = frequency * 2;
    if (octaveUp <= 4500) {
      const magLow = getSpectralMagnitude(processedSamples, frequency, sampleRate);
      const magHigh = getSpectralMagnitude(processedSamples, octaveUp, sampleRate);

      // Shift up if the higher octave has at least 20% of the energy
      if (magLow > 0 && magHigh > magLow * 0.20) {
        frequency = octaveUp;
      }
    }
  }

  // Reject anything still below 130Hz - these are usually subharmonics
  if (frequency < 130) {
    return null;
  }

  // Step 7: Final confidence calculation
  const confidence = Math.max(0, Math.min(1, 1 - finalCmnd));

  if (confidence < minConfidence) {
    return null;
  }

  const velocity = Math.min(1, rms * 10);
  const midiPitch = frequencyToMidi(frequency);
  const note = midiToNote(midiPitch);

  return {
    note,
    frequency,
    midiPitch,
    confidence,
    velocity,
    cmndMin: finalCmnd,
    rms
  };
}
