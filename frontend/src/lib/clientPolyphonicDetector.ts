/**
 * Client-side Polyphonic Pitch Detection using FFT-based multi-peak detection
 * Detects 2-3 simultaneous notes for chord recognition
 *
 * Ported from Python polyphonic_detector.py
 */

export interface DetectedNote {
  note: string;
  frequency: number;
  magnitude: number;
  confidence: number;
  midiPitch: number;
}

export interface ChordDetection {
  notes: DetectedNote[];
  timestamp: number;
  isChord: boolean; // True if 2+ notes detected
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Piano frequency range (C3=130Hz to C8=4186Hz for clean detection)
// Using C3 as minimum reduces false positives significantly
const MIN_FREQUENCY = 130.0;
const MAX_FREQUENCY = 4186.0;

// Detection thresholds
const PEAK_THRESHOLD = 0.20; // Minimum magnitude relative to max peak
const MIN_PEAK_DISTANCE_HZ = 30; // Minimum frequency separation between peaks
const MAX_NOTES = 3; // Maximum simultaneous notes to detect

function frequencyToNote(freq: number): { note: string; octave: number; midi: number } {
  if (freq <= 0) {
    return { note: '?', octave: 0, midi: 0 };
  }

  // A4 = 440 Hz is our reference (MIDI note 69)
  const midiNote = Math.round(12 * Math.log2(freq / 440.0) + 69);
  const noteIndex = ((midiNote % 12) + 12) % 12;
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = NOTE_NAMES[noteIndex];

  return { note: noteName, octave, midi: midiNote };
}

/**
 * Compute FFT magnitude spectrum using DFT
 * (For production, consider using Web Audio API's AnalyserNode)
 */
function computeFFT(samples: Float32Array, fftSize: number): { magnitudes: Float32Array; frequencies: Float32Array; sampleRate: number } {
  const n = Math.min(fftSize, samples.length);
  const sampleRate = 44100; // Assume standard sample rate
  const magnitudes = new Float32Array(n / 2);
  const frequencies = new Float32Array(n / 2);

  // Apply Hanning window
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    windowed[i] = (i < samples.length ? samples[i] : 0) * window;
  }

  // Compute magnitude spectrum using DFT
  for (let k = 0; k < n / 2; k++) {
    let real = 0;
    let imag = 0;
    for (let t = 0; t < n; t++) {
      const angle = -2 * Math.PI * k * t / n;
      real += windowed[t] * Math.cos(angle);
      imag += windowed[t] * Math.sin(angle);
    }
    magnitudes[k] = Math.sqrt(real * real + imag * imag);
    frequencies[k] = k * sampleRate / n;
  }

  return { magnitudes, frequencies, sampleRate };
}

/**
 * Find peaks in FFT spectrum that likely correspond to musical notes
 */
function detectPeaks(
  magnitudes: Float32Array<ArrayBufferLike>,
  frequencies: Float32Array<ArrayBufferLike>
): Array<{ frequency: number; magnitude: number }> {
  const peaks: Array<{ frequency: number; magnitude: number }> = [];

  // Filter to piano range
  const validIndices: number[] = [];
  for (let i = 0; i < frequencies.length; i++) {
    if (frequencies[i] >= MIN_FREQUENCY && frequencies[i] <= MAX_FREQUENCY) {
      validIndices.push(i);
    }
  }

  if (validIndices.length === 0) {
    return [];
  }

  // Find max magnitude in valid range for threshold calculation
  let maxMagnitude = 0;
  for (const i of validIndices) {
    if (magnitudes[i] > maxMagnitude) {
      maxMagnitude = magnitudes[i];
    }
  }

  const threshold = maxMagnitude * PEAK_THRESHOLD;

  // Find local maxima above threshold
  const rawPeaks: Array<{ frequency: number; magnitude: number }> = [];
  for (let j = 1; j < validIndices.length - 1; j++) {
    const i = validIndices[j];
    const iPrev = validIndices[j - 1];
    const iNext = validIndices[j + 1];

    const magnitude = magnitudes[i];
    if (
      magnitude > magnitudes[iPrev] &&
      magnitude > magnitudes[iNext] &&
      magnitude >= threshold
    ) {
      rawPeaks.push({ frequency: frequencies[i], magnitude });
    }
  }

  // Sort by magnitude (descending)
  rawPeaks.sort((a, b) => b.magnitude - a.magnitude);

  // Filter out harmonics and close frequencies
  for (const peak of rawPeaks) {
    let tooClose = false;

    for (const accepted of peaks) {
      const ratio = peak.frequency > accepted.frequency
        ? peak.frequency / accepted.frequency
        : accepted.frequency / peak.frequency;

      // Skip if harmonic (2x, 3x, etc.) or too close in frequency
      if (
        Math.abs(ratio - Math.round(ratio)) < 0.05 || // Harmonic
        Math.abs(peak.frequency - accepted.frequency) < MIN_PEAK_DISTANCE_HZ // Too close
      ) {
        tooClose = true;
        break;
      }
    }

    if (!tooClose) {
      peaks.push(peak);
    }

    // Stop after finding enough peaks
    if (peaks.length >= MAX_NOTES) {
      break;
    }
  }

  return peaks;
}

/**
 * Client-side polyphonic detector for chord recognition
 */
export class ClientPolyphonicDetector {
  private sampleRate: number;
  private fftSize: number;
  private minEnergy: number;

  constructor(sampleRate: number = 44100, fftSize: number = 4096) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
    this.minEnergy = 0.01;
  }

  /**
   * Detect multiple pitches from audio buffer using FFT
   */
  detect(samples: Float32Array): ChordDetection {
    // Check minimum buffer size
    if (samples.length < 2048) {
      return { notes: [], timestamp: Date.now(), isChord: false };
    }

    // Calculate RMS energy
    let rmsSum = 0;
    for (let i = 0; i < samples.length; i++) {
      rmsSum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(rmsSum / samples.length);

    // Skip if too quiet
    if (rms < this.minEnergy) {
      return { notes: [], timestamp: Date.now(), isChord: false };
    }

    // Compute FFT
    const { magnitudes, frequencies } = computeFFT(samples, this.fftSize);

    // Find peaks
    const peaks = detectPeaks(magnitudes, frequencies);

    // Convert peaks to notes
    const detectedNotes: DetectedNote[] = [];
    const maxMagnitude = Math.max(...Array.from(magnitudes));

    for (const peak of peaks) {
      const { note, octave, midi } = frequencyToNote(peak.frequency);
      const fullNote = `${note}${octave}`;
      const confidence = Math.min(peak.magnitude / maxMagnitude, 1.0);

      detectedNotes.push({
        note: fullNote,
        frequency: peak.frequency,
        magnitude: peak.magnitude,
        confidence,
        midiPitch: midi
      });
    }

    // Sort by frequency (lowest to highest)
    detectedNotes.sort((a, b) => a.frequency - b.frequency);

    return {
      notes: detectedNotes,
      timestamp: Date.now(),
      isChord: detectedNotes.length >= 2
    };
  }

  /**
   * Set minimum energy threshold
   */
  setMinEnergy(energy: number): void {
    this.minEnergy = energy;
  }
}

/**
 * Fast chord detector using Web Audio API AnalyserNode
 * More efficient than DFT for real-time use
 */
export class WebAudioChordDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frequencyData: Float32Array<ArrayBuffer> | null = null;
  private isRunning: boolean = false;

  private onChordDetected: ((chord: ChordDetection) => void) | null = null;
  private animationFrame: number | null = null;

  constructor(private fftSize: number = 4096) {}

  async start(onChordDetected: (chord: ChordDetection) => void): Promise<void> {
    if (this.isRunning) return;

    this.onChordDetected = onChordDetected;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      this.audioContext = new AudioContext();
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.3;

      this.source.connect(this.analyser);

      this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
      this.isRunning = true;

      this.processAudio();
      console.log('[POLY] Started Web Audio chord detector');
    } catch (error) {
      console.error('[POLY] Failed to start:', error);
      throw error;
    }
  }

  private processAudio = (): void => {
    if (!this.isRunning || !this.analyser || !this.frequencyData) return;

    this.analyser.getFloatFrequencyData(this.frequencyData);

    // Convert dB to linear magnitude
    const magnitudes = new Float32Array(this.frequencyData.length);
    for (let i = 0; i < this.frequencyData.length; i++) {
      // Convert from dB to linear (dB = 20 * log10(magnitude))
      magnitudes[i] = Math.pow(10, this.frequencyData[i] / 20);
    }

    // Create frequency array
    const frequencies = new Float32Array(this.frequencyData.length);
    const binWidth = this.audioContext!.sampleRate / this.fftSize;
    for (let i = 0; i < frequencies.length; i++) {
      frequencies[i] = i * binWidth;
    }

    // Detect peaks
    const peaks = detectPeaks(magnitudes, frequencies);

    if (peaks.length > 0) {
      const maxMagnitude = Math.max(...peaks.map(p => p.magnitude));

      const notes: DetectedNote[] = peaks.map(peak => {
        const { note, octave, midi } = frequencyToNote(peak.frequency);
        return {
          note: `${note}${octave}`,
          frequency: peak.frequency,
          magnitude: peak.magnitude,
          confidence: Math.min(peak.magnitude / maxMagnitude, 1.0),
          midiPitch: midi
        };
      });

      notes.sort((a, b) => a.frequency - b.frequency);

      const chord: ChordDetection = {
        notes,
        timestamp: Date.now(),
        isChord: notes.length >= 2
      };

      this.onChordDetected?.(chord);
    }

    this.animationFrame = requestAnimationFrame(this.processAudio);
  };

  stop(): void {
    this.isRunning = false;

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    console.log('[POLY] Stopped Web Audio chord detector');
  }
}
