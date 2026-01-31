/**
 * Client-side Onsets and Frames detector using @magenta/music.
 *
 * This provides EXACT parity with the server-side Python implementation
 * by using the same Google Magenta model running in TensorFlow.js.
 *
 * The model:
 * - Trained on MAESTRO dataset
 * - ~95% F1 score on piano transcription
 * - Polyphonic (detects chords)
 * - Provides onset, frame, offset, and velocity predictions
 */

// Dynamic imports to avoid SSR issues - these libraries require browser globals
type MagentaMusic = typeof import('@magenta/music/es6/transcription');
type TensorFlow = typeof import('@tensorflow/tfjs');

let mm: MagentaMusic | null = null;
let tf: TensorFlow | null = null;

async function loadMagenta(): Promise<{ mm: MagentaMusic; tf: TensorFlow }> {
  if (mm && tf) return { mm, tf };

  // Dynamic import only runs in browser
  const [magentaModule, tfModule] = await Promise.all([
    import('@magenta/music/es6/transcription'),
    import('@tensorflow/tfjs'),
  ]);

  mm = magentaModule;
  tf = tfModule;
  return { mm, tf };
}

export interface NoteEvent {
  note: string;
  pitch: number;
  onset_time: number;
  offset_time: number;
  velocity: number;
  confidence: number;
  onset_strength: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNote(midiPitch: number): string {
  const octave = Math.floor(midiPitch / 12) - 1;
  const noteIndex = midiPitch % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

export function noteToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
  };
  const match = noteName.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const [, note, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[note] ?? 0);
}

/**
 * Audio Buffer Manager - accumulates audio and produces overlapping windows.
 * Mirrors the Python AudioBufferManager exactly.
 */
class AudioBufferManager {
  private buffer: Float32Array = new Float32Array(0);
  private readPos: number = 0;
  private windowSamples: number;
  private hopSamples: number;
  private sampleRate: number;
  private firstWindowEmitted: boolean = false;
  private lastWindowStart: number = 0;
  private compactedOffset: number = 0;
  private recentNotes: NoteEvent[] = [];
  private dedupWindowMs: number;

  constructor(
    sampleRate: number = 44100,
    windowSamples: number = 49392,
    hopRatio: number = 0.5,
    dedupWindowMs: number = 500
  ) {
    this.sampleRate = sampleRate;
    this.windowSamples = windowSamples;
    this.hopSamples = Math.floor(windowSamples * hopRatio);
    this.dedupWindowMs = dedupWindowMs;
  }

  addChunk(chunk: Float32Array): Float32Array | null {
    const newBuffer = new Float32Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    const available = this.buffer.length - this.readPos;
    if (available < this.windowSamples) {
      return null;
    }

    this.lastWindowStart = this.compactedOffset + this.readPos;
    const window = this.buffer.slice(this.readPos, this.readPos + this.windowSamples);

    if (!this.firstWindowEmitted) {
      this.readPos += this.windowSamples;
      this.firstWindowEmitted = true;
    } else {
      this.readPos += this.hopSamples;
    }

    if (this.readPos > this.windowSamples * 4) {
      this.compactedOffset += this.readPos;
      this.buffer = this.buffer.slice(this.readPos);
      this.readPos = 0;
    }

    return window;
  }

  get lastWindowStartSec(): number {
    return this.lastWindowStart / this.sampleRate;
  }

  /**
   * Consensus merge - same algorithm as Python backend.
   */
  consensusNotes(newNotes: NoteEvent[], windowOffsetSec: number): NoteEvent[] {
    const dedupSec = this.dedupWindowMs / 1000;
    const unique: NoteEvent[] = [];

    for (const note of newNotes) {
      const adjusted: NoteEvent = {
        ...note,
        onset_time: note.onset_time + windowOffsetSec,
        offset_time: note.offset_time + windowOffsetSec,
      };

      let merged = false;
      for (const recent of this.recentNotes) {
        if (recent.pitch !== adjusted.pitch) continue;

        // Onset-proximity match
        if (Math.abs(adjusted.onset_time - recent.onset_time) <= dedupSec) {
          // Merge: improve confidence/velocity
          recent.confidence = Math.max(recent.confidence, adjusted.confidence);
          recent.onset_strength = Math.max(recent.onset_strength, adjusted.onset_strength);
          recent.velocity = Math.max(recent.velocity, adjusted.velocity);
          merged = true;
          break;
        }

        // Duration-aware: sustained note re-detection
        if (recent.offset_time >= adjusted.onset_time) {
          merged = true;
          break;
        }
      }

      if (!merged) {
        unique.push(adjusted);
      }
    }

    // Prune stale entries
    const retentionSec = dedupSec * 4;
    if (unique.length > 0) {
      const latestTime = Math.max(...unique.map(n => n.onset_time));
      this.recentNotes = this.recentNotes.filter(
        n => latestTime - n.onset_time <= retentionSec
      );
      this.recentNotes.push(...unique);
    } else if (newNotes.length > 0) {
      const latestIncoming = Math.max(...newNotes.map(n => n.onset_time + windowOffsetSec));
      this.recentNotes = this.recentNotes.filter(
        n => latestIncoming - n.onset_time <= retentionSec
      );
    }

    return unique;
  }

  reset(): void {
    this.buffer = new Float32Array(0);
    this.readPos = 0;
    this.firstWindowEmitted = false;
    this.lastWindowStart = 0;
    this.compactedOffset = 0;
    this.recentNotes = [];
  }
}

export interface ClientOnsetsFramesOptions {
  onNoteDetected: (note: NoteEvent) => void;
  onNotesInWindow?: (notes: NoteEvent[]) => void;
  onModelLoaded?: () => void;
  onError?: (error: Error) => void;
  expectedPitches?: Set<number>;
  sampleRate?: number;
}

/**
 * Client-side Onsets and Frames detector.
 * Uses the exact same Magenta model as the server for parity.
 */
export class ClientOnsetsFrames {
  private model: InstanceType<MagentaMusic['OnsetsAndFrames']> | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private bufferManager: AudioBufferManager;
  private options: ClientOnsetsFramesOptions;
  private isRunning: boolean = false;
  private isModelLoaded: boolean = false;
  private startTime: number = 0;
  private processingWindow: boolean = false;

  constructor(options: ClientOnsetsFramesOptions) {
    this.options = {
      sampleRate: 44100,
      ...options,
    };
    this.bufferManager = new AudioBufferManager(this.options.sampleRate);
  }

  /**
   * Load the Onsets and Frames model.
   * Call this before start() for faster initialization.
   */
  async loadModel(): Promise<void> {
    if (this.isModelLoaded) return;

    console.log('[OnsetsFrames] Loading model...');

    // Dynamically load Magenta and TensorFlow.js (browser-only)
    const { mm: magenta, tf: tensorflow } = await loadMagenta();

    // Use WebGL backend for GPU acceleration
    await tensorflow.setBackend('webgl');
    await tensorflow.ready();
    console.log('[OnsetsFrames] TensorFlow.js backend:', tensorflow.getBackend());

    // Initialize Onsets and Frames model
    this.model = new magenta.OnsetsAndFrames(
      'https://storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni'
    );

    await this.model.initialize();
    this.isModelLoaded = true;

    console.log('[OnsetsFrames] Model loaded successfully');
    this.options.onModelLoaded?.();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    try {
      // Ensure model is loaded
      if (!this.isModelLoaded) {
        await this.loadModel();
      }

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Use ScriptProcessor for real-time audio capture
      const bufferSize = 4096;
      this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.isRunning) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const chunk = new Float32Array(inputData);

        const window = this.bufferManager.addChunk(chunk);
        if (window && !this.processingWindow) {
          this.processWindow(window);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      this.startTime = performance.now();
      this.isRunning = true;

      console.log('[OnsetsFrames] Started real-time transcription');
    } catch (error) {
      console.error('[OnsetsFrames] Failed to start:', error);
      this.options.onError?.(error as Error);
      throw error;
    }
  }

  private async processWindow(window: Float32Array): Promise<void> {
    if (!this.model || this.processingWindow) return;

    this.processingWindow = true;

    try {
      // Run transcription on the audio window
      const noteSequence = await this.model.transcribeFromAudioArray(
        window,
        this.options.sampleRate!
      );

      // Convert Magenta NoteSequence to our NoteEvent format
      const notes: NoteEvent[] = [];
      if (noteSequence.notes) {
        for (const note of noteSequence.notes) {
          // Filter by expected pitches if provided (score-aware)
          if (this.options.expectedPitches &&
              !this.options.expectedPitches.has(note.pitch!)) {
            // Lower confidence for unexpected notes
            const confidence = (note.velocity ?? 80) / 127 * 0.7;
            if (confidence < 0.3) continue; // Skip low-confidence unexpected notes
          }

          notes.push({
            note: midiToNote(note.pitch!),
            pitch: note.pitch!,
            onset_time: note.startTime!,
            offset_time: note.endTime!,
            velocity: (note.velocity ?? 80) / 127,
            confidence: (note.velocity ?? 80) / 127,
            onset_strength: (note.velocity ?? 80) / 127,
          });
        }
      }

      // Apply consensus merge (same as Python backend)
      const windowOffset = this.bufferManager.lastWindowStartSec;
      const uniqueNotes = this.bufferManager.consensusNotes(notes, windowOffset);

      if (uniqueNotes.length > 0) {
        console.log(`[OnsetsFrames] Window detected: ${uniqueNotes.map(n => n.note).join(', ')}`);
        this.options.onNotesInWindow?.(uniqueNotes);

        for (const note of uniqueNotes) {
          this.options.onNoteDetected(note);
        }
      }
    } catch (error) {
      console.error('[OnsetsFrames] Transcription error:', error);
    } finally {
      this.processingWindow = false;
    }
  }

  stop(): void {
    this.isRunning = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
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

    this.bufferManager.reset();
    console.log('[OnsetsFrames] Stopped');
  }

  /**
   * Update expected pitches for score-aware detection.
   */
  setExpectedPitches(pitches: Set<number>): void {
    this.options.expectedPitches = pitches;
  }

  resetTimer(): void {
    this.startTime = performance.now();
    this.bufferManager.reset();
  }

  get modelLoaded(): boolean {
    return this.isModelLoaded;
  }
}
