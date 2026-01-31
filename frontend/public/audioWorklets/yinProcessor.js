/**
 * YIN Pitch Detection AudioWorklet Processor
 *
 * Runs on the audio render thread, keeping the main UI thread free.
 * Receives audio samples, performs YIN pitch detection, posts results back.
 */

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
  const noteMap = {
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
 * Simple ring buffer for audio samples
 */
class RingBuffer {
  constructor(size) {
    this.buffer = new Float32Array(size);
    this.writeIndex = 0;
    this.filled = 0;
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      if (this.filled < this.buffer.length) {
        this.filled++;
      }
    }
  }

  getLatest(count) {
    const result = new Float32Array(count);
    const available = Math.min(count, this.filled);
    let readIndex = (this.writeIndex - available + this.buffer.length) % this.buffer.length;

    for (let i = 0; i < available; i++) {
      result[i] = this.buffer[readIndex];
      readIndex = (readIndex + 1) % this.buffer.length;
    }
    return result;
  }

  hasEnough(count) {
    return this.filled >= count;
  }

  clear() {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.filled = 0;
  }
}

/**
 * Spectral flux onset detector (simplified HFC)
 */
class SimpleOnsetDetector {
  constructor(sampleRate, fftSize = 1024) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.prevMagnitudes = null;
    this.threshold = 1.5;
  }

  detect(samples) {
    // Compute simple spectral energy change
    let energy = 0;
    for (let i = 0; i < samples.length; i++) {
      energy += samples[i] * samples[i];
    }
    energy = Math.sqrt(energy / samples.length);

    if (this.prevEnergy === undefined) {
      this.prevEnergy = energy;
      return { isOnset: false, strength: 0 };
    }

    const ratio = this.prevEnergy > 0.001 ? energy / this.prevEnergy : 1;
    const isOnset = ratio > this.threshold && energy > 0.002;
    this.prevEnergy = energy;

    return { isOnset, strength: ratio };
  }

  reset() {
    this.prevEnergy = undefined;
  }
}

/**
 * Compute spectral magnitude at a specific frequency using Goertzel algorithm
 * More efficient than full FFT when checking specific frequencies
 */
function getSpectralMagnitude(samples, targetFreq, sampleRate) {
  const n = samples.length;
  if (targetFreq <= 0 || targetFreq >= sampleRate / 2) return 0;

  // Goertzel algorithm with Hanning window
  const k = Math.round(targetFreq * n / sampleRate);
  const w = 2 * Math.PI * k / n;
  const coeff = 2 * Math.cos(w);

  let s0 = 0, s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    // Apply Hanning window
    const windowed = samples[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
    s0 = windowed + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  const real = s1 - s2 * Math.cos(w);
  const imag = s2 * Math.sin(w);
  return Math.sqrt(real * real + imag * imag) / n;
}

/**
 * Check if freq2 is a harmonic of freq1
 */
function isHarmonic(freq1, freq2, tolerance = 0.03) {
  const ratio = freq2 / freq1;
  for (const harmonic of [2, 3, 4, 5, 6]) {
    if (Math.abs(ratio - harmonic) < tolerance * harmonic) {
      return true;
    }
  }
  return false;
}

/**
 * YIN pitch detection V3 - Proven algorithm with 92%+ accuracy.
 *
 * Key differences from V2:
 * - First-minimum search (not multi-candidate) - more reliable
 * - Octave-UP disambiguation (not octave-DOWN) - correct for piano
 * - Stricter threshold (0.20 vs 0.25) - fewer false positives
 *
 * Algorithm:
 * 1. First-minimum CMND search (threshold 0.20)
 * 2. Octave-UP disambiguation (check tau/2, tau/4, tau/8)
 * 3. 130Hz floor with spectral-verified upward shift
 * 4. Reject anything below 130Hz
 */
function detectPitch(samples, sampleRate) {
  if (!samples || samples.length < 1024) {
    return null;
  }

  // Calculate RMS
  let rmsSum = 0;
  for (let i = 0; i < samples.length; i++) {
    rmsSum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(rmsSum / samples.length);

  if (rms < 0.002) {
    return null;
  }

  const bufferSize = samples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));

  // Step 1: Difference function
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

  // Step 2: CMND (Cumulative Mean Normalized Difference)
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

  // Step 3: V3 First-minimum search (NOT multi-candidate)
  const threshold = 0.20;  // Stricter than V2's 0.25
  let bestTau = null;
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
      refinedTau = bestTau + (alpha - gamma) / denominator;
    }
  }

  let frequency = sampleRate / refinedTau;

  // Step 5: V3 OCTAVE-UP disambiguation (NOT octave-down!)
  // Check if HIGHER octave candidates have valid CMND
  const candidates = [
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
  let bestCandidate = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const clarity = 1.0 - cand.cmndVal;

    // Frequency preference (piano range)
    let freqPref;
    if (cand.freq < 80) freqPref = 0.1;
    else if (cand.freq < 130) freqPref = 0.3;
    else if (cand.freq < 200) freqPref = 0.6;
    else if (cand.freq < 600) freqPref = 1.0;  // Sweet spot
    else if (cand.freq < 1200) freqPref = 0.95;
    else if (cand.freq < 2400) freqPref = 0.85;
    else freqPref = 0.7;

    // Octave bonus - prefer higher octaves when CMND is comparable
    const octaveBonus = 0.1 * Math.log2(cand.multiplier);

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
      const magLow = getSpectralMagnitude(samples, frequency, sampleRate);
      const magHigh = getSpectralMagnitude(samples, octaveUp, sampleRate);

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

  const confidence = Math.max(0, Math.min(1, 1 - finalCmnd));
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

/**
 * Score-aware pitch detector
 */
class ScoreAwareYinDetector {
  constructor(sampleRate, centsTolerance = 35) {
    this.sampleRate = sampleRate;
    this.expectedFrequencies = new Map();
    this.centsTolerance = centsTolerance;
  }

  setExpectedNotes(notes) {
    this.expectedFrequencies.clear();
    for (const note of notes) {
      const midi = noteToMidi(note);
      this.expectedFrequencies.set(midi, note);
    }
  }

  centsError(detectedFreq, expectedFreq) {
    return 1200 * Math.log2(detectedFreq / expectedFreq);
  }

  detect(samples) {
    const raw = detectPitch(samples, this.sampleRate);
    if (!raw) return null;

    if (this.expectedFrequencies.size === 0) {
      return raw;
    }

    let bestMatch = null;
    let bestCentsAbs = Infinity;

    // First pass: exact match within tolerance
    for (const [expectedMidi, expectedNote] of this.expectedFrequencies) {
      const expectedFreq = 440 * Math.pow(2, (expectedMidi - 69) / 12);
      const cents = this.centsError(raw.frequency, expectedFreq);
      const centsAbs = Math.abs(cents);

      if (centsAbs <= this.centsTolerance && centsAbs < bestCentsAbs) {
        bestCentsAbs = centsAbs;
        bestMatch = { midi: expectedMidi, note: expectedNote, centsError: cents };
      }
    }

    // Second pass: check if detection is an octave off from any expected note
    // This catches YIN sub-harmonic errors (detecting C3 when C4 is expected)
    if (!bestMatch) {
      for (const [expectedMidi, expectedNote] of this.expectedFrequencies) {
        const expectedFreq = 440 * Math.pow(2, (expectedMidi - 69) / 12);

        // Check if detected is one octave below expected
        const octaveDownFreq = expectedFreq / 2;
        const centsFromOctaveDown = Math.abs(this.centsError(raw.frequency, octaveDownFreq));

        // If within 50 cents of octave-down, snap to the expected note
        if (centsFromOctaveDown <= 50) {
          bestMatch = { midi: expectedMidi, note: expectedNote, centsError: 0, octaveCorrected: true };
          bestCentsAbs = centsFromOctaveDown;
          break;
        }

        // Check if detected is two octaves below expected
        const twoOctavesDownFreq = expectedFreq / 4;
        const centsFromTwoOctavesDown = Math.abs(this.centsError(raw.frequency, twoOctavesDownFreq));

        if (centsFromTwoOctavesDown <= 50) {
          bestMatch = { midi: expectedMidi, note: expectedNote, centsError: 0, octaveCorrected: true };
          bestCentsAbs = centsFromTwoOctavesDown;
          break;
        }
      }
    }

    if (bestMatch) {
      const expectedFreq = 440 * Math.pow(2, (bestMatch.midi - 69) / 12);
      return {
        ...raw,
        note: bestMatch.note,
        frequency: expectedFreq,
        midiPitch: bestMatch.midi,
        confidence: Math.min(1, raw.confidence * (bestMatch.octaveCorrected ? 0.9 : (1 + (this.centsTolerance - bestCentsAbs) / 100)))
      };
    }

    return raw;
  }
}

// Processing parameters
const WINDOW_SAMPLES_STANDARD = 3072;  // ~70ms - good for notes >= 130Hz
const WINDOW_SAMPLES_LOW = 6144;       // ~140ms - needed for notes < 130Hz (C3 and below)
const HOP_SAMPLES = 512;               // ~11.6ms

/**
 * YIN Pitch Detection Processor
 * Runs on audio render thread for smooth UI
 */
class YinProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Start with standard window, will switch to low-note mode if needed
    this.currentWindowSize = WINDOW_SAMPLES_STANDARD;
    this.ringBuffer = new RingBuffer(WINDOW_SAMPLES_LOW); // Use larger buffer, read less
    this.samplesSinceLastHop = 0;
    this.detector = new ScoreAwareYinDetector(sampleRate);
    this.onsetDetector = new SimpleOnsetDetector(sampleRate);

    // Track if low-note mode is active
    this.lowNoteMode = false;

    // State
    this.isRunning = true;
    this.polyphonyMode = false;

    // Gate thresholds (can be updated via messages)
    this.gateThresholds = {
      minRms: 0.001,
      maxCmnd: 0.35,
      onsetRatio: 1.1
    };

    // Octave error rejection: track recently confirmed notes to block sub-harmonic errors
    this.recentlyConfirmedMidi = null;
    this.recentlyConfirmedTime = 0;
    this.OCTAVE_GRACE_PERIOD_MS = 400; // Block octave-down errors for 400ms after confirmation

    // RMS tracking for onset detection
    this.prevRms = 0;
    this.rmsHistory = [];
    this.RMS_HISTORY_SIZE = 4;

    // Debounce
    this.lastDetectedNote = null;
    this.lastDetectionTime = 0;
    this.debounceMs = 50;

    // Stability tracking
    this.recentPitches = [null, null, null];
    this.STABILITY_WINDOW = 3;
    this.STABILITY_THRESHOLD = 2;

    // Tentative state
    this.tentativeNote = null;
    this.twoSpeedConfig = {
      confirmDelayMs: 80,
      tentativeOnly: false
    };

    // Stats
    this.hopCount = 0;
    this.lastStatsTime = currentTime;

    // Onset tracking
    this.lastOnsetTime = 0;
    this.ONSET_REFRACTORY_MS = 30;

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'setExpectedNotes':
        this.detector.setExpectedNotes(data.notes || []);
        // Check if any expected notes are low (below C3/130Hz)
        this.updateWindowMode(data.notes || []);
        break;
      case 'setGates':
        if (data.gates) {
          if (data.gates.minRms !== undefined) this.gateThresholds.minRms = data.gates.minRms;
          if (data.gates.maxCmnd !== undefined) this.gateThresholds.maxCmnd = data.gates.maxCmnd;
          if (data.gates.onsetRatio !== undefined) this.gateThresholds.onsetRatio = data.gates.onsetRatio;
        }
        break;
      case 'setPolyphonyMode':
        this.polyphonyMode = data.enabled;
        break;
      case 'setTwoSpeed':
        if (data.config) {
          if (data.config.confirmDelayMs !== undefined) this.twoSpeedConfig.confirmDelayMs = data.config.confirmDelayMs;
          if (data.config.tentativeOnly !== undefined) this.twoSpeedConfig.tentativeOnly = data.config.tentativeOnly;
        }
        break;
      case 'reset':
        this.reset();
        break;
      case 'stop':
        this.isRunning = false;
        break;
    }
  }

  /**
   * Dynamic window sizing based on expected notes.
   * Low notes (below C3/130Hz) need larger windows for accurate detection.
   */
  updateWindowMode(notes) {
    const LOW_NOTE_THRESHOLD_MIDI = 48; // C3 = MIDI 48, ~130Hz
    let hasLowNotes = false;

    for (const note of notes) {
      const midi = noteToMidi(note);
      if (midi < LOW_NOTE_THRESHOLD_MIDI) {
        hasLowNotes = true;
        break;
      }
    }

    const newWindowSize = hasLowNotes ? WINDOW_SAMPLES_LOW : WINDOW_SAMPLES_STANDARD;

    if (newWindowSize !== this.currentWindowSize) {
      this.currentWindowSize = newWindowSize;
      this.lowNoteMode = hasLowNotes;
      // Note: Ring buffer stays at WINDOW_SAMPLES_LOW, we just read less from it
    }
  }

  reset() {
    this.ringBuffer.clear();
    this.samplesSinceLastHop = 0;
    this.lastDetectedNote = null;
    this.lastDetectionTime = 0;
    this.prevRms = 0;
    this.rmsHistory = [];
    this.recentPitches = [null, null, null];
    this.tentativeNote = null;
    this.onsetDetector.reset();
    this.lastOnsetTime = 0;
    this.recentlyConfirmedMidi = null;
    this.recentlyConfirmedTime = 0;
    this.lowNoteMode = false;
    this.currentWindowSize = WINDOW_SAMPLES_STANDARD;
  }

  process(inputs, outputs, parameters) {
    if (!this.isRunning) return false;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];

    // Add to ring buffer
    this.ringBuffer.push(samples);
    this.samplesSinceLastHop += samples.length;

    // Run detection every hop (use dynamic window size)
    if (this.samplesSinceLastHop >= HOP_SAMPLES && this.ringBuffer.hasEnough(this.currentWindowSize)) {
      this.samplesSinceLastHop = 0;
      this.hopCount++;
      this.runDetection();
    }

    return true;
  }

  runDetection() {
    const now = currentTime * 1000; // Convert to ms

    if (this.polyphonyMode) {
      return;
    }

    const window = this.ringBuffer.getLatest(this.currentWindowSize);

    // Calculate RMS
    let rmsSum = 0;
    for (let i = 0; i < window.length; i++) {
      rmsSum += window[i] * window[i];
    }
    const currentRms = Math.sqrt(rmsSum / window.length);

    // Update RMS history
    this.rmsHistory.push(currentRms);
    if (this.rmsHistory.length > this.RMS_HISTORY_SIZE) {
      this.rmsHistory.shift();
    }
    const smoothedRms = this.rmsHistory.reduce((a, b) => a + b, 0) / this.rmsHistory.length;

    // Run YIN
    const detection = this.detector.detect(window);

    // Stats every 500ms
    if (now - this.lastStatsTime > 500) {
      const elapsed = (now - this.lastStatsTime) / 1000;
      const updatesPerSec = this.hopCount / elapsed;

      this.port.postMessage({
        type: 'stats',
        stats: {
          updatesPerSec,
          rms: currentRms,
          smoothedRms
        }
      });

      this.hopCount = 0;
      this.lastStatsTime = now;
    }

    // 3-Gate system
    const energyGate = currentRms >= this.gateThresholds.minRms;
    const confidenceGate = detection ? detection.cmndMin <= this.gateThresholds.maxCmnd : false;

    const isNewNote = detection?.note !== this.lastDetectedNote;

    // Onset detection
    const onsetResult = this.onsetDetector.detect(window);
    const spectralOnset = onsetResult.isOnset && (now - this.lastOnsetTime) > this.ONSET_REFRACTORY_MS;
    if (spectralOnset) {
      this.lastOnsetTime = now;
    }

    const rmsOnset = this.prevRms > 0 && currentRms > this.prevRms * this.gateThresholds.onsetRatio;
    const isOnset = spectralOnset || rmsOnset;

    const isSustaining = detection?.note === this.lastDetectedNote &&
                         now - this.lastDetectionTime < 200;
    const onsetGate = isNewNote || isOnset || isSustaining;

    this.prevRms = smoothedRms;

    const allGatesPass = energyGate && confidenceGate && onsetGate;

    // Stability tracking
    const currentPitch = (detection && allGatesPass) ? detection.midiPitch : null;
    this.recentPitches.push(currentPitch);
    if (this.recentPitches.length > this.STABILITY_WINDOW) {
      this.recentPitches.shift();
    }

    const checkStability = (pitch) => {
      const matches = this.recentPitches.filter(p => p === pitch).length;
      return matches >= this.STABILITY_THRESHOLD;
    };

    if (detection && allGatesPass) {
      // Octave-error rejection: block sub-harmonic errors during grace period
      // If we recently confirmed a note, reject detections that are 1 or 2 octaves below
      if (this.recentlyConfirmedMidi !== null &&
          now - this.recentlyConfirmedTime < this.OCTAVE_GRACE_PERIOD_MS) {
        const midiDiff = this.recentlyConfirmedMidi - detection.midiPitch;
        // Block if exactly 12 (one octave) or 24 (two octaves) below
        // Also block if it's a common harmonic error (e.g., B4→E3 is 19 semitones)
        if (midiDiff === 12 || midiDiff === 24 || midiDiff === 19 || midiDiff === 7) {
          // Skip this detection - it's likely a sub-harmonic artifact
          return;
        }
      }

      if (
        detection.note !== this.lastDetectedNote ||
        now - this.lastDetectionTime > this.debounceMs
      ) {
        // Emit tentative
        this.port.postMessage({
          type: 'tentative',
          detection
        });

        // Cancel old tentative if different
        if (this.tentativeNote && this.tentativeNote.note !== detection.note) {
          this.port.postMessage({
            type: 'cancelled',
            note: this.tentativeNote.note
          });
        }

        this.tentativeNote = {
          note: detection.note,
          timestamp: now,
          detection
        };

        this.lastDetectedNote = detection.note;
        this.lastDetectionTime = now;
      }

      // Check stability confirmation
      if (this.tentativeNote && !this.twoSpeedConfig.tentativeOnly) {
        const isStable = checkStability(detection.midiPitch);
        if (isStable && this.tentativeNote.note === detection.note) {
          this.port.postMessage({
            type: 'confirmed',
            detection: this.tentativeNote.detection
          });
          // Track confirmed note for octave-error rejection
          this.recentlyConfirmedMidi = this.tentativeNote.detection.midiPitch;
          this.recentlyConfirmedTime = now;
          this.tentativeNote = null;
        }
      }
    } else {
      // Cancel tentative if timeout
      if (this.tentativeNote && now - this.tentativeNote.timestamp > this.twoSpeedConfig.confirmDelayMs * 2) {
        this.port.postMessage({
          type: 'cancelled',
          note: this.tentativeNote.note
        });
        this.tentativeNote = null;
      }
    }
  }
}

registerProcessor('yin-processor', YinProcessor);
