/**
 * Client-side pitch detection using Web Audio API + autocorrelation.
 * No backend roundtrip - runs entirely in the browser with ~10-20ms latency.
 */

// Note frequencies for MIDI range
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToNote(frequency: number): { note: string; cents: number } | null {
  if (frequency < 20 || frequency > 4200) return null;

  // Convert frequency to MIDI note number
  const midiNote = 12 * Math.log2(frequency / 440) + 69;
  const roundedMidi = Math.round(midiNote);
  const cents = Math.round((midiNote - roundedMidi) * 100);

  const octave = Math.floor(roundedMidi / 12) - 1;
  const noteIndex = roundedMidi % 12;
  const noteName = NOTE_NAMES[noteIndex];

  return {
    note: `${noteName}${octave}`,
    cents,
  };
}

/**
 * Autocorrelation-based pitch detection (YIN-inspired).
 * Fast and accurate for monophonic piano notes.
 */
function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minFreq: number = 80,
  maxFreq: number = 1100
): { frequency: number; confidence: number } | null {
  const bufferSize = buffer.length;

  // Check if there's enough signal (RMS threshold)
  let rms = 0;
  for (let i = 0; i < bufferSize; i++) {
    rms += buffer[i] * buffer[i];
  }
  rms = Math.sqrt(rms / bufferSize);
  if (rms < 0.01) return null; // Too quiet

  // Autocorrelation
  const minPeriod = Math.floor(sampleRate / maxFreq);
  const maxPeriod = Math.ceil(sampleRate / minFreq);

  let bestCorrelation = 0;
  let bestPeriod = 0;

  // Normalized autocorrelation with parabolic interpolation
  for (let period = minPeriod; period < maxPeriod && period < bufferSize / 2; period++) {
    let correlation = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < bufferSize - period; i++) {
      correlation += buffer[i] * buffer[i + period];
      norm1 += buffer[i] * buffer[i];
      norm2 += buffer[i + period] * buffer[i + period];
    }

    const normalizedCorrelation = correlation / Math.sqrt(norm1 * norm2 + 1e-10);

    if (normalizedCorrelation > bestCorrelation) {
      bestCorrelation = normalizedCorrelation;
      bestPeriod = period;
    }
  }

  if (bestCorrelation < 0.8 || bestPeriod === 0) return null;

  // Parabolic interpolation for sub-sample accuracy
  const y1 = bestPeriod > minPeriod ? autocorr(buffer, bestPeriod - 1) : 0;
  const y2 = bestCorrelation;
  const y3 = bestPeriod < maxPeriod - 1 ? autocorr(buffer, bestPeriod + 1) : 0;

  const shift = (y1 - y3) / (2 * (y1 - 2 * y2 + y3) + 1e-10);
  const refinedPeriod = bestPeriod + (isFinite(shift) ? shift : 0);

  const frequency = sampleRate / refinedPeriod;

  return {
    frequency,
    confidence: bestCorrelation,
  };
}

function autocorr(buffer: Float32Array, period: number): number {
  let correlation = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < buffer.length - period; i++) {
    correlation += buffer[i] * buffer[i + period];
    norm1 += buffer[i] * buffer[i];
    norm2 += buffer[i + period] * buffer[i + period];
  }

  return correlation / Math.sqrt(norm1 * norm2 + 1e-10);
}

export interface DetectionResult {
  note: string;
  frequency: number;
  confidence: number;
  timestamp: number;
}

export interface ClientPitchDetectorOptions {
  /** Callback when a note is detected */
  onNoteDetected: (result: DetectionResult) => void;
  /** Minimum confidence threshold (0-1) */
  confidenceThreshold?: number;
  /** Detection interval in ms */
  detectionIntervalMs?: number;
}

export class ClientPitchDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private intervalId: number | null = null;
  private lastDetectedNote: string | null = null;
  private lastDetectionTime: number = 0;
  private options: Required<ClientPitchDetectorOptions>;
  private startTime: number = 0;

  constructor(options: ClientPitchDetectorOptions) {
    this.options = {
      confidenceThreshold: options.confidenceThreshold ?? 0.85,
      detectionIntervalMs: options.detectionIntervalMs ?? 30,
      onNoteDetected: options.onNoteDetected,
    };
  }

  async start(): Promise<void> {
    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.audioContext = new AudioContext();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.source.connect(this.analyser);

      this.buffer = new Float32Array(this.analyser.fftSize);
      this.startTime = performance.now();

      // Start detection loop
      this.intervalId = window.setInterval(() => {
        this.detect();
      }, this.options.detectionIntervalMs);

      console.log('[ClientPitchDetector] Started');
    } catch (error) {
      console.error('[ClientPitchDetector] Failed to start:', error);
      throw error;
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
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

    this.analyser = null;
    this.buffer = null;
    this.lastDetectedNote = null;

    console.log('[ClientPitchDetector] Stopped');
  }

  private detect(): void {
    if (!this.analyser || !this.buffer) return;

    this.analyser.getFloatTimeDomainData(this.buffer);

    const result = detectPitch(
      this.buffer,
      this.audioContext?.sampleRate ?? 44100
    );

    if (!result || result.confidence < this.options.confidenceThreshold) {
      return;
    }

    const noteResult = frequencyToNote(result.frequency);
    if (!noteResult) return;

    // Debounce: don't fire same note within 100ms
    const now = performance.now();
    if (
      noteResult.note === this.lastDetectedNote &&
      now - this.lastDetectionTime < 100
    ) {
      return;
    }

    this.lastDetectedNote = noteResult.note;
    this.lastDetectionTime = now;

    this.options.onNoteDetected({
      note: noteResult.note,
      frequency: result.frequency,
      confidence: result.confidence,
      timestamp: now - this.startTime,
    });
  }

  /** Reset the start time (call when exercise starts) */
  resetTimer(): void {
    this.startTime = performance.now();
    this.lastDetectedNote = null;
  }
}
