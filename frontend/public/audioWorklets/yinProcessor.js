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
 * YIN pitch detection V4 - Simplified for stability
 *
 * V3 had complex multi-candidate octave disambiguation that caused
 * rapid oscillation between C3/C4. V4 simplifies:
 * - Single first-minimum search (no candidates)
 * - Aggressive octave-UP preference (always prefer higher octave)
 * - 200Hz soft floor (most piano testing is C4 and above)
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
  // Limit search: 80Hz to 2000Hz (tau from ~22 to ~551 at 44100Hz)
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 80));
  const tauMin = Math.max(2, Math.ceil(sampleRate / 2000));

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

  // Step 2: CMND
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let cumulativeSum = 0;

  for (let tau = 1; tau < tauMax; tau++) {
    cumulativeSum += difference[tau];
    cmnd[tau] = cumulativeSum > 0 ? (difference[tau] * tau) / cumulativeSum : 1;
  }

  // Step 3: First-minimum search (prefer FIRST = highest frequency)
  const threshold = 0.15;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      cmndMin = cmnd[tau];
      break;
    }
  }

  // Fallback: global minimum in 150-1000Hz range (avoid sub-harmonics)
  if (bestTau === null) {
    const searchMin = Math.ceil(sampleRate / 1000);  // 1000Hz
    const searchMax = Math.floor(sampleRate / 150);   // 150Hz

    for (let tau = searchMin; tau < Math.min(searchMax, tauMax); tau++) {
      if (cmnd[tau] < cmndMin) {
        cmndMin = cmnd[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau === null || cmndMin > 0.35) {
    return null;
  }

  // Step 4: Parabolic interpolation
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

  // Step 5: Aggressive octave-UP check
  // If detected frequency is below 250Hz, ALWAYS check if octave-up is valid
  // This prevents sub-harmonic detection (C3 when C4 was played)
  if (frequency < 250 && frequency >= 65) {
    const halfTau = Math.round(refinedTau / 2);
    if (halfTau >= tauMin && halfTau < tauMax) {
      const halfCmnd = cmnd[halfTau];
      // Accept octave-up if CMND is reasonable (more permissive than before)
      if (halfCmnd < 0.30) {
        frequency *= 2;
        cmndMin = halfCmnd;
      }
    }
  }

  // Step 6: Hard floor at 130Hz, shift up if needed
  while (frequency < 130 && frequency >= 32) {
    frequency *= 2;
  }

  if (frequency < 130 || frequency > 4500) {
    return null;
  }

  const confidence = Math.max(0, Math.min(1, 1 - cmndMin));
  const midiPitch = frequencyToMidi(frequency);
  const note = midiToNote(midiPitch);

  return {
    note,
    frequency,
    midiPitch,
    confidence,
    velocity: Math.min(1, rms * 10),
    cmndMin,
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

        // Check if detected is a harmonic of expected (2x, 2.5x, 3x, 4x)
        // This catches B5 detected when G4 expected (B5 ≈ 2.52x G4)
        for (const harmonic of [2, 2.5, 3, 4]) {
          const harmonicFreq = expectedFreq * harmonic;
          const centsFromHarmonic = Math.abs(this.centsError(raw.frequency, harmonicFreq));
          if (centsFromHarmonic <= 80) { // 80 cents tolerance for harmonics
            bestMatch = { midi: expectedMidi, note: expectedNote, centsError: 0, harmonicCorrected: harmonic };
            bestCentsAbs = centsFromHarmonic;
            break;
          }
        }
        if (bestMatch) break;
      }
    }

    // Third pass: semitone snap - if detected note is 1-2 semitones away from expected
    // This catches B3 detected when C4 expected, or E4 when D4 expected
    if (!bestMatch) {
      const detectedMidi = raw.midiPitch;
      for (const [expectedMidi, expectedNote] of this.expectedFrequencies) {
        const semitoneDiff = Math.abs(detectedMidi - expectedMidi);
        // If within 2 semitones, snap to expected (with reduced confidence)
        if (semitoneDiff >= 1 && semitoneDiff <= 2) {
          const expectedFreq = 440 * Math.pow(2, (expectedMidi - 69) / 12);
          bestMatch = { midi: expectedMidi, note: expectedNote, centsError: 0, semitoneCorrected: semitoneDiff };
          bestCentsAbs = semitoneDiff * 100; // Convert semitones to cents for scoring
          break;
        }
      }
    }

    if (bestMatch) {
      const expectedFreq = 440 * Math.pow(2, (bestMatch.midi - 69) / 12);
      // Adjust confidence based on correction type
      let confidenceMultiplier = 1 + (this.centsTolerance - bestCentsAbs) / 100;
      if (bestMatch.octaveCorrected) confidenceMultiplier = 0.9;
      if (bestMatch.harmonicCorrected) confidenceMultiplier = 0.85;
      if (bestMatch.semitoneCorrected) confidenceMultiplier = 0.75; // Lower confidence for semitone snaps

      return {
        ...raw,
        note: bestMatch.note,
        frequency: expectedFreq,
        midiPitch: bestMatch.midi,
        confidence: Math.min(1, raw.confidence * confidenceMultiplier)
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

    // RMS tracking for onset detection
    this.prevRms = 0;
    this.rmsHistory = [];
    this.RMS_HISTORY_SIZE = 4;

    // Tentative state
    this.tentativeNote = null;

    // Active note tracking - prevents re-confirming the same sustained note
    this.activeConfirmedNote = null;  // The note currently being held
    this.silenceFrames = 0;           // Count of consecutive silent frames
    this.SILENCE_FRAMES_FOR_NOTE_OFF = 3; // Need 3 silent frames (~35ms) to consider note-off

    // Stats
    this.hopCount = 0;
    this.lastStatsTime = currentTime;

    console.log('[YIN] Processor initialized, sampleRate:', sampleRate);

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
        console.log('[YIN] Expected notes set:', data.notes?.length || 0);
        break;
      case 'setPolyphonyMode':
        this.polyphonyMode = data.enabled;
        break;
      case 'reset':
        this.reset();
        console.log('[YIN] Reset');
        break;
      case 'stop':
        this.isRunning = false;
        console.log('[YIN] Stopped');
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
    this.prevRms = 0;
    this.rmsHistory = [];
    this.tentativeNote = null;
    this.onsetDetector.reset();
    this.lowNoteMode = false;
    this.currentWindowSize = WINDOW_SAMPLES_STANDARD;
    this.activeConfirmedNote = null;
    this.silenceFrames = 0;
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

    // Debug: log RMS every 100 hops to verify audio flow
    if (this.hopCount % 100 === 0) {
      console.log('[YIN] hop:', this.hopCount, 'rms:', currentRms.toFixed(4));
    }

    // Update RMS history for smoothing
    this.rmsHistory.push(currentRms);
    if (this.rmsHistory.length > this.RMS_HISTORY_SIZE) {
      this.rmsHistory.shift();
    }
    const smoothedRms = this.rmsHistory.reduce((a, b) => a + b, 0) / this.rmsHistory.length;

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

    // === SIMPLIFIED DETECTION (matching offline algorithm) ===

    // Gate 1: Silence threshold (must have audio)
    const SILENCE_THRESHOLD = 0.003;
    if (currentRms < SILENCE_THRESHOLD) {
      this.silenceFrames++;
      if (this.silenceFrames >= this.SILENCE_FRAMES_FOR_NOTE_OFF && this.activeConfirmedNote !== null) {
        this.port.postMessage({ type: 'noteOff', note: this.activeConfirmedNote });
        console.log('[YIN] noteOff:', this.activeConfirmedNote);
        this.activeConfirmedNote = null;
        this.tentativeNote = null;
      }
      this.prevRms = smoothedRms;
      return;
    }
    this.silenceFrames = 0;

    // Onset detection for re-triggering same note
    const ONSET_RMS_RATIO = 1.5;
    const isOnset = this.prevRms > 0.001 && currentRms > this.prevRms * ONSET_RMS_RATIO;
    if (isOnset && this.activeConfirmedNote !== null) {
      // Strong onset = new keypress, allow re-trigger
      console.log('[YIN] onset detected, resetting active note');
      this.activeConfirmedNote = null;
    }
    this.prevRms = smoothedRms;

    // Run YIN pitch detection
    const detection = this.detector.detect(window);

    // Gate 2: Must have valid detection with good confidence
    const CONFIDENCE_THRESHOLD = 0.75;  // V5.1: stricter threshold reduces false triggers
    if (!detection) {
      return;
    }

    const confidence = 1 - (detection.cmndMin || 0);
    if (confidence < CONFIDENCE_THRESHOLD) {
      // Low confidence - log but don't emit
      if (this.hopCount % 50 === 0) {
        console.log('[YIN] low confidence:', detection.note, 'conf:', confidence.toFixed(2));
      }
      return;
    }

    // Debug: log good detections
    console.log('[YIN] detect:', detection.note, 'freq:', detection.frequency?.toFixed(1), 'conf:', confidence.toFixed(2), 'rms:', currentRms.toFixed(3));

    // Gate 3: Must be different from currently active note (or no active note)
    if (this.activeConfirmedNote === detection.note) {
      // Same note still sustaining - send frame update
      this.port.postMessage({
        type: 'frame',
        note: detection.note,
        frequency: detection.frequency,
        rms: currentRms,
        confidence: confidence,
        timestamp: now
      });
      return;
    }

    // V5 HYSTERESIS: Prevent oscillation between notes
    // - Octave jumps (12/24 semitones): require 8 frames + 85% confidence
    // - Semitone jumps (1-2 semitones): require 3 frames to prevent flutter
    // - Other intervals: default 2 frames
    let requiredConfirmFrames = 2;  // Default: 2 frames to confirm
    if (this.activeConfirmedNote !== null) {
      const activeMidi = noteToMidi(this.activeConfirmedNote);
      const newMidi = detection.midiPitch;
      const midiDiff = Math.abs(activeMidi - newMidi);

      if (midiDiff === 12 || midiDiff === 24) {
        // Octave jump - require strong evidence
        requiredConfirmFrames = 8;  // ~93ms for octave change
        if (confidence < 0.85) {
          return;  // Not confident enough for octave jump
        }
      } else if (midiDiff <= 2) {
        // Semitone/whole-tone - require slightly more evidence to prevent flutter
        requiredConfirmFrames = 3;
      }
    }

    // New note detected! Emit tentative immediately
    if (!this.tentativeNote || this.tentativeNote.note !== detection.note) {
      // Cancel old tentative if different
      if (this.tentativeNote && this.tentativeNote.note !== detection.note) {
        this.port.postMessage({ type: 'cancelled', note: this.tentativeNote.note });
      }

      this.tentativeNote = {
        note: detection.note,
        timestamp: now,
        detection: detection,
        confirmCount: 1,
        requiredFrames: requiredConfirmFrames
      };

      this.port.postMessage({ type: 'tentative', detection });
      console.log('[YIN] tentative:', detection.note, 'requires:', requiredConfirmFrames, 'frames');
    } else {
      // Same tentative note - increment confirm count
      this.tentativeNote.confirmCount++;
    }

    // Confirm after required consecutive frames
    if (this.tentativeNote && this.tentativeNote.confirmCount >= this.tentativeNote.requiredFrames) {
      // If there was an active note, send noteOff first
      if (this.activeConfirmedNote !== null) {
        this.port.postMessage({ type: 'noteOff', note: this.activeConfirmedNote });
        console.log('[YIN] noteOff (transition):', this.activeConfirmedNote);
      }

      this.port.postMessage({ type: 'confirmed', detection: this.tentativeNote.detection });
      console.log('[YIN] CONFIRMED:', detection.note);

      this.activeConfirmedNote = detection.note;
      this.tentativeNote = null;
    }
  }
}

registerProcessor('yin-processor', YinProcessor);
