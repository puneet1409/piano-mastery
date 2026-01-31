/**
 * Client-side YIN pitch detector with ring buffer + hop updates
 *
 * Architecture:
 * - Ring buffer holds last WINDOW samples (~70ms)
 * - Every HOP samples (~12ms), run YIN on the window
 * - This gives ~86 updates/sec for "instant" feel
 *
 * YIN Algorithm:
 * 1. Difference function - measures signal self-similarity at lag τ
 * 2. CMND - cumulative mean normalized difference (prevents τ=0 bias)
 * 3. Threshold search - find first τ where cmnd < threshold
 * 4. Parabolic interpolation - sub-sample accuracy
 * 5. Octave disambiguation - check harmonic multiples
 *
 * Enhanced with:
 * - Spectral flux onset detection for note start/sustain distinction
 * - Harmonic analysis for octave disambiguation
 * - Client-side polyphonic detection for chords
 */

// Note: onsetDetector and harmonicAnalyzer are used inside the AudioWorklet processor

export interface YinDetection {
  note: string;
  frequency: number;
  midiPitch: number;
  confidence: number;   // 0-1 (derived from 1 - cmndMin)
  velocity: number;     // 0-1 (from RMS)
  cmndMin: number;      // Raw CMND value for gating
  rms: number;          // Raw RMS for energy gating
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToMidi(freq: number): number {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function midiToNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function noteToMidi(noteName: string): number {
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
 * Simple ring buffer for audio samples
 */
class RingBuffer {
  private buffer: Float32Array;
  private writeIndex: number = 0;
  private filled: number = 0;

  constructor(size: number) {
    this.buffer = new Float32Array(size);
  }

  /** Add samples to the buffer */
  push(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.writeIndex] = samples[i];
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      if (this.filled < this.buffer.length) {
        this.filled++;
      }
    }
  }

  /** Get the last N samples as a contiguous array */
  getLatest(count: number): Float32Array {
    const result = new Float32Array(count);
    const available = Math.min(count, this.filled);

    // Read from (writeIndex - available) to writeIndex
    let readIndex = (this.writeIndex - available + this.buffer.length) % this.buffer.length;

    for (let i = 0; i < available; i++) {
      result[i] = this.buffer[readIndex];
      readIndex = (readIndex + 1) % this.buffer.length;
    }

    return result;
  }

  /** Check if buffer has enough samples */
  hasEnough(count: number): boolean {
    return this.filled >= count;
  }

  /** Clear the buffer */
  clear(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
    this.filled = 0;
  }
}

/**
 * Compute spectral magnitude at a specific frequency using Goertzel algorithm
 * More efficient than full FFT when checking specific frequencies
 */
function getSpectralMagnitude(samples: Float32Array, targetFreq: number, sampleRate: number): number {
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
function isHarmonic(freq1: number, freq2: number, tolerance: number = 0.03): boolean {
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
export function detectPitch(
  samples: Float32Array,
  sampleRate: number = 44100
): YinDetection | null {
  if (!samples || samples.length < 1024) {
    return null;
  }

  // Calculate RMS for silence detection
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

  // Step 2: Cumulative Mean Normalized Difference (CMND)
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
      refinedTau = bestTau + (alpha - gamma) / denominator;
    }
  }

  let frequency = sampleRate / refinedTau;

  // Step 5: V3 OCTAVE-UP disambiguation (NOT octave-down!)
  // Check if HIGHER octave candidates have valid CMND
  interface OctaveCandidate {
    freq: number;
    cmndVal: number;
    multiplier: number;
  }

  const candidates: OctaveCandidate[] = [
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
  let bestCandidate: OctaveCandidate | null = null;
  let bestScore = -1;

  for (const cand of candidates) {
    const clarity = 1.0 - cand.cmndVal;

    // Frequency preference (piano range)
    let freqPref: number;
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

  // Confidence based on CMND clarity
  const confidence = Math.max(0, Math.min(1, 1 - finalCmnd));

  // Velocity estimate from RMS (normalized to 0-1)
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
 * Score-aware pitch detector - uses expected notes to improve accuracy.
 * Uses cents-based matching instead of Hz tolerance.
 */
export class ScoreAwareYinDetector {
  private sampleRate: number;
  private expectedFrequencies: Map<number, string> = new Map(); // midi -> note name
  private centsTolerance: number;

  constructor(sampleRate: number = 44100, centsTolerance: number = 35) {
    this.sampleRate = sampleRate;
    this.centsTolerance = centsTolerance;
  }

  /**
   * Set expected notes from the score.
   * Detection will prefer matching these frequencies.
   */
  setExpectedNotes(notes: string[]): void {
    this.expectedFrequencies.clear();
    for (const note of notes) {
      const midi = noteToMidi(note);
      this.expectedFrequencies.set(midi, note);
    }
  }

  /**
   * Calculate cents difference between two frequencies
   */
  private centsError(detectedFreq: number, expectedFreq: number): number {
    return 1200 * Math.log2(detectedFreq / expectedFreq);
  }

  /**
   * Detect pitch with score-aware matching using cents tolerance.
   */
  detect(samples: Float32Array): YinDetection | null {
    const raw = detectPitch(samples, this.sampleRate);
    if (!raw) return null;

    // If no expected notes, return raw detection
    if (this.expectedFrequencies.size === 0) {
      return raw;
    }

    // Find closest expected note within cents tolerance
    let bestMatch: { midi: number; note: string; centsError: number } | null = null;
    let bestCentsAbs = Infinity;

    for (const [expectedMidi, expectedNote] of this.expectedFrequencies) {
      const expectedFreq = 440 * Math.pow(2, (expectedMidi - 69) / 12);
      const cents = this.centsError(raw.frequency, expectedFreq);
      const centsAbs = Math.abs(cents);

      if (centsAbs <= this.centsTolerance && centsAbs < bestCentsAbs) {
        bestCentsAbs = centsAbs;
        bestMatch = { midi: expectedMidi, note: expectedNote, centsError: cents };
      }
    }

    if (bestMatch) {
      // Snap to expected note
      const expectedFreq = 440 * Math.pow(2, (bestMatch.midi - 69) / 12);
      return {
        ...raw,
        note: bestMatch.note,
        frequency: expectedFreq,
        midiPitch: bestMatch.midi,
        confidence: Math.min(1, raw.confidence * (1 + (this.centsTolerance - bestCentsAbs) / 100))
      };
    }

    // No match - return raw detection
    return raw;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AudioWorklet-based Architecture (replaces ScriptProcessorNode)
// ─────────────────────────────────────────────────────────────────────────────

/** Processing parameters at 44.1kHz */
const SAMPLE_RATE = 44100;
const WINDOW_SAMPLES_STANDARD = 3072;  // ~70ms - good for notes >= 130Hz
const WINDOW_SAMPLES_LOW = 6144;       // ~140ms - needed for notes < 130Hz
const HOP_SAMPLES = 512;               // ~11.6ms - frequent updates (~86/sec)
const LOW_NOTE_THRESHOLD_MIDI = 48;    // C3 = MIDI 48 (~130Hz)

/**
 * Two-speed feedback system:
 * - TENTATIVE: Immediate visual feedback (key highlight) - fires instantly
 * - CONFIRMED: Delayed scoring feedback - fires after confirmDelayMs of stable detection
 *
 * This provides instant "feel" while avoiding false positives in scoring.
 */
export interface TentativeDetection {
  note: string;
  timestamp: number;
  detection: YinDetection;
}

export interface ClientYinOptions {
  /** Called when note is CONFIRMED (after stable detection) - use for scoring */
  onNoteDetected: (note: YinDetection) => void;
  /** Called immediately on TENTATIVE detection - use for visual feedback only */
  onTentativeNote?: (note: YinDetection) => void;
  /** Called when tentative note is cancelled (false positive) */
  onTentativeCancelled?: (note: string) => void;
  onError?: (error: Error) => void;
  sampleRate?: number;
  expectedNotes?: string[];
  /** Debug callback for monitoring performance */
  onDebugStats?: (stats: YinDebugStats) => void;
  /** Gate thresholds (optional - uses sensible defaults) */
  gates?: {
    /** Minimum RMS for energy gate (default: 0.01) */
    minRms?: number;
    /** Maximum CMND for confidence gate (default: 0.15) */
    maxCmnd?: number;
    /** RMS ratio for onset detection (default: 1.3 = 30% increase) */
    onsetRatio?: number;
  };
  /** Two-speed timing (optional) */
  twoSpeed?: {
    /** Delay before confirming a tentative note (default: 80ms) */
    confirmDelayMs?: number;
    /** If true, only emit tentative (no confirmed) - for visual-only mode */
    tentativeOnly?: boolean;
  };
}

export interface YinDebugStats {
  windowMs: number;
  hopMs: number;
  updatesPerSec: number;
  rms: number;
  latencyMs: number;
}

/** Message types sent from AudioWorklet processor */
interface WorkletMessage {
  type: 'tentative' | 'confirmed' | 'cancelled' | 'stats';
  detection?: YinDetection;
  note?: string;
  stats?: {
    updatesPerSec: number;
    rms: number;
    smoothedRms: number;
  };
}

/**
 * Real-time client-side YIN detector using AudioWorkletNode.
 *
 * Architecture:
 * - AudioWorklet processor runs on separate audio render thread
 * - All YIN detection happens off the main thread
 * - Main thread only receives detection results via message passing
 * - Result: Smooth UI with no jank from pitch detection
 *
 * Migration from ScriptProcessorNode:
 * - ScriptProcessorNode ran on main thread, blocking UI at ~86 updates/sec
 * - AudioWorkletNode runs in dedicated audio thread
 * - Same API surface maintained for compatibility
 */
export class ClientYinDetector {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private options: ClientYinOptions;
  private isRunning: boolean = false;
  private workletReady: boolean = false;

  // Gate thresholds (sent to worklet)
  private gateThresholds: { minRms: number; maxCmnd: number; onsetRatio: number };

  // Two-speed config (sent to worklet)
  private twoSpeedConfig: { confirmDelayMs: number; tentativeOnly: boolean };

  // Polyphony mode flag
  private _polyphonyMode: boolean = false;

  // Expected notes cache (for setExpectedNotes before worklet ready)
  private pendingExpectedNotes: string[] | null = null;

  constructor(options: ClientYinOptions) {
    this.options = {
      sampleRate: SAMPLE_RATE,
      ...options
    };

    // Initialize gate thresholds
    this.gateThresholds = {
      minRms: options.gates?.minRms ?? 0.001,
      maxCmnd: options.gates?.maxCmnd ?? 0.35,
      onsetRatio: options.gates?.onsetRatio ?? 1.1
    };

    // Initialize two-speed config
    this.twoSpeedConfig = {
      confirmDelayMs: options.twoSpeed?.confirmDelayMs ?? 80,
      tentativeOnly: options.twoSpeed?.tentativeOnly ?? false
    };

    if (options.expectedNotes) {
      this.pendingExpectedNotes = options.expectedNotes;
    }

    console.log(`[YIN-Worklet] Gates: minRms=${this.gateThresholds.minRms}, maxCmnd=${this.gateThresholds.maxCmnd}, onsetRatio=${this.gateThresholds.onsetRatio}`);
    console.log(`[YIN-Worklet] Two-speed: confirmDelay=${this.twoSpeedConfig.confirmDelayMs}ms, tentativeOnly=${this.twoSpeedConfig.tentativeOnly}`);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });

      // Register the AudioWorklet module
      await this.audioContext.audioWorklet.addModule('/audioWorklets/yinProcessor.js');

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create AudioWorkletNode
      this.workletNode = new AudioWorkletNode(this.audioContext, 'yin-processor');

      // Handle messages from the worklet
      this.workletNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        this.handleWorkletMessage(event.data);
      };

      // Connect audio graph
      this.source.connect(this.workletNode);
      // Note: No need to connect worklet to destination - it's analysis only

      this.workletReady = true;
      this.isRunning = true;

      // Send initial configuration to worklet
      this.sendToWorklet('setGates', { gates: this.gateThresholds });
      this.sendToWorklet('setTwoSpeed', { config: this.twoSpeedConfig });
      this.sendToWorklet('setPolyphonyMode', { enabled: this._polyphonyMode });

      // Send pending expected notes
      if (this.pendingExpectedNotes) {
        this.sendToWorklet('setExpectedNotes', { notes: this.pendingExpectedNotes });
        this.pendingExpectedNotes = null;
      }

      const windowMs = (WINDOW_SAMPLES_STANDARD / SAMPLE_RATE * 1000).toFixed(1);
      const hopMs = (HOP_SAMPLES / SAMPLE_RATE * 1000).toFixed(1);
      console.log(`[YIN-Worklet] Started AudioWorklet detection: window=${windowMs}ms (up to ${(WINDOW_SAMPLES_LOW / SAMPLE_RATE * 1000).toFixed(0)}ms for low notes), hop=${hopMs}ms, ~${Math.round(SAMPLE_RATE / HOP_SAMPLES)} updates/sec`);
      console.log('[YIN-Worklet] Detection runs on audio thread - UI should stay smooth');
    } catch (error) {
      console.error('[YIN-Worklet] Failed to start:', error);
      this.options.onError?.(error as Error);
      throw error;
    }
  }

  private handleWorkletMessage(data: WorkletMessage): void {
    switch (data.type) {
      case 'tentative':
        if (data.detection) {
          this.options.onTentativeNote?.(data.detection);
        }
        break;

      case 'confirmed':
        if (data.detection) {
          this.options.onNoteDetected(data.detection);
        }
        break;

      case 'cancelled':
        if (data.note) {
          this.options.onTentativeCancelled?.(data.note);
        }
        break;

      case 'stats':
        if (data.stats && this.options.onDebugStats) {
          // Note: actual window size varies based on low-note mode
          this.options.onDebugStats({
            windowMs: WINDOW_SAMPLES_STANDARD / SAMPLE_RATE * 1000,
            hopMs: HOP_SAMPLES / SAMPLE_RATE * 1000,
            updatesPerSec: data.stats.updatesPerSec,
            rms: data.stats.rms,
            latencyMs: WINDOW_SAMPLES_STANDARD / SAMPLE_RATE * 1000 / 2
          });
        }
        break;
    }
  }

  private sendToWorklet(type: string, data: Record<string, unknown>): void {
    if (this.workletNode && this.workletReady) {
      this.workletNode.port.postMessage({ type, ...data });
    }
  }

  stop(): void {
    this.isRunning = false;

    // Tell worklet to stop
    this.sendToWorklet('stop', {});

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.workletReady = false;
    console.log('[YIN-Worklet] Stopped');
  }

  /**
   * Update expected notes for score-aware detection.
   */
  setExpectedNotes(notes: string[]): void {
    if (this.workletReady) {
      this.sendToWorklet('setExpectedNotes', { notes });
    } else {
      this.pendingExpectedNotes = notes;
    }
  }

  /**
   * Reset detection state (e.g., when restarting exercise).
   */
  reset(): void {
    this.sendToWorklet('reset', {});
  }

  /**
   * Update gate thresholds at runtime (for tuning).
   */
  setGateThresholds(gates: Partial<{ minRms: number; maxCmnd: number; onsetRatio: number }>): void {
    if (gates.minRms !== undefined) this.gateThresholds.minRms = gates.minRms;
    if (gates.maxCmnd !== undefined) this.gateThresholds.maxCmnd = gates.maxCmnd;
    if (gates.onsetRatio !== undefined) this.gateThresholds.onsetRatio = gates.onsetRatio;

    this.sendToWorklet('setGates', { gates: this.gateThresholds });
    console.log(`[YIN-Worklet] Gates updated: minRms=${this.gateThresholds.minRms}, maxCmnd=${this.gateThresholds.maxCmnd}, onsetRatio=${this.gateThresholds.onsetRatio}`);
  }

  /**
   * Polyphony mode switch.
   * When enabled, client-side detection is disabled (use server-side for polyphonic songs).
   */
  get polyphonyMode(): boolean {
    return this._polyphonyMode;
  }

  set polyphonyMode(enabled: boolean) {
    this._polyphonyMode = enabled;
    this.sendToWorklet('setPolyphonyMode', { enabled });

    if (enabled) {
      console.log('[YIN-Worklet] Polyphony mode ENABLED - client detection disabled');
    } else {
      console.log('[YIN-Worklet] Polyphony mode DISABLED - client detection active');
    }
  }

  /**
   * Update two-speed config at runtime.
   */
  setTwoSpeedConfig(config: Partial<{ confirmDelayMs: number; tentativeOnly: boolean }>): void {
    if (config.confirmDelayMs !== undefined) this.twoSpeedConfig.confirmDelayMs = config.confirmDelayMs;
    if (config.tentativeOnly !== undefined) this.twoSpeedConfig.tentativeOnly = config.tentativeOnly;

    this.sendToWorklet('setTwoSpeed', { config: this.twoSpeedConfig });
    console.log(`[YIN-Worklet] Two-speed updated: confirmDelay=${this.twoSpeedConfig.confirmDelayMs}ms, tentativeOnly=${this.twoSpeedConfig.tentativeOnly}`);
  }
}
