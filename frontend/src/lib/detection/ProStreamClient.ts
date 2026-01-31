/**
 * ProStreamClient - WebSocket client for streaming audio to polyphonic detection server.
 *
 * Architecture:
 * - Captures audio via ScriptProcessor (AudioWorklet coming in future)
 * - Resamples 44.1kHz → 16kHz mono
 * - Sends binary PCM16 frames with timestamps
 * - Receives NoteEvents from server
 *
 * Message Protocol:
 * - Client → Server (binary): [uint32 timestamp_ms][int16 pcm samples...]
 * - Client → Server (JSON): {type: "start"|"stop"|"expected", ...}
 * - Server → Client (JSON): {type: "note_events", events: NoteEvent[]}
 */

import { NoteEvent, midiToNoteName } from "../music/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProStreamCallbacks {
  /** Called when server sends confirmed note events */
  onNoteEvents: (events: NoteEvent[]) => void;
  /** Called when connection status changes */
  onConnectionChange: (connected: boolean) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Called with stats for debugging */
  onStats?: (stats: ProStreamStats) => void;
}

export interface ProStreamStats {
  connected: boolean;
  framesSent: number;
  bytesPerSec: number;
  framesPerSec: number;
  latencyMs: number;
}

export interface ProStreamOptions {
  /** WebSocket URL (default: ws://localhost:8000/ws/pro) */
  wsUrl?: string;
  /** Session ID for the connection */
  sessionId?: string;
  /** Target sample rate for server (default: 16000) */
  targetSampleRate?: number;
  /** Frame size in ms (default: 20ms = 320 samples at 16kHz) */
  frameSizeMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WS_URL = "ws://localhost:8000/ws/pro";
const SOURCE_SAMPLE_RATE = 44100;
const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE_MS = 20; // 20ms frames
const SCRIPT_BUFFER_SIZE = 1024; // ~23ms at 44.1kHz

// ─────────────────────────────────────────────────────────────────────────────
// Simple Linear Resampler (44.1kHz → 16kHz)
// ─────────────────────────────────────────────────────────────────────────────

class LinearResampler {
  private ratio: number;

  constructor(sourceRate: number, targetRate: number) {
    this.ratio = targetRate / sourceRate;
  }

  /** Resample Float32Array to target rate */
  resample(input: Float32Array): Float32Array {
    const outputLength = Math.floor(input.length * this.ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i / this.ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
      const frac = srcIndex - srcIndexFloor;

      // Linear interpolation
      output[i] = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
    }

    return output;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ProStreamClient
// ─────────────────────────────────────────────────────────────────────────────

export class ProStreamClient {
  private options: Required<ProStreamOptions>;
  private callbacks: ProStreamCallbacks;

  // WebSocket
  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Audio capture
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private resampler: LinearResampler;

  // Frame accumulator (accumulate samples until we have a full frame)
  private frameBuffer: Float32Array;
  private frameBufferIndex: number = 0;
  private targetFrameSize: number;

  // Stats
  private framesSent: number = 0;
  private bytesSent: number = 0;
  private lastStatsTime: number = 0;
  private exerciseStartTime: number = 0;

  constructor(callbacks: ProStreamCallbacks, options: ProStreamOptions = {}) {
    this.callbacks = callbacks;
    this.options = {
      wsUrl: options.wsUrl ?? DEFAULT_WS_URL,
      sessionId: options.sessionId ?? `pro-${Date.now()}`,
      targetSampleRate: options.targetSampleRate ?? TARGET_SAMPLE_RATE,
      frameSizeMs: options.frameSizeMs ?? FRAME_SIZE_MS,
    };

    this.resampler = new LinearResampler(SOURCE_SAMPLE_RATE, this.options.targetSampleRate);

    // Calculate frame size in samples
    this.targetFrameSize = Math.floor(
      (this.options.targetSampleRate * this.options.frameSizeMs) / 1000
    );
    this.frameBuffer = new Float32Array(this.targetFrameSize);

    console.log(
      `[ProStream] Initialized: targetRate=${this.options.targetSampleRate}Hz, frameSize=${this.targetFrameSize} samples (${this.options.frameSizeMs}ms)`
    );
  }

  /**
   * Start streaming audio to server.
   */
  async start(exerciseStartTime: number = performance.now()): Promise<void> {
    this.exerciseStartTime = exerciseStartTime;

    // Connect WebSocket
    await this.connectWebSocket();

    // Start audio capture
    await this.startAudioCapture();

    console.log("[ProStream] Started");
  }

  /**
   * Stop streaming and disconnect.
   */
  stop(): void {
    this.stopAudioCapture();
    this.disconnectWebSocket();
    console.log("[ProStream] Stopped");
  }

  /**
   * Send expected notes to server for score-aware gating.
   */
  sendExpectedNotes(notes: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Convert note names to MIDI pitches
    const pitches = notes.map((note) => {
      const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
      if (!match) return 60;
      const noteMap: Record<string, number> = {
        C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3,
        E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8,
        Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
      };
      const [, noteName, octStr] = match;
      return (parseInt(octStr) + 1) * 12 + (noteMap[noteName] ?? 0);
    });

    this.ws.send(
      JSON.stringify({
        type: "expected",
        pitches,
        notes,
      })
    );
  }

  /**
   * Update exercise start time (for timestamp calculation).
   */
  setExerciseStartTime(time: number): void {
    this.exerciseStartTime = time;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket
  // ─────────────────────────────────────────────────────────────────────────────

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.options.wsUrl}/${this.options.sessionId}`;
      console.log(`[ProStream] Connecting to ${url}`);

      this.ws = new WebSocket(url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        console.log("[ProStream] WebSocket connected");
        this.connected = true;
        this.callbacks.onConnectionChange(true);

        // Send start message
        this.ws?.send(
          JSON.stringify({
            type: "start",
            sessionId: this.options.sessionId,
            sampleRate: this.options.targetSampleRate,
            frameSize: this.targetFrameSize,
          })
        );

        resolve();
      };

      this.ws.onclose = () => {
        console.log("[ProStream] WebSocket closed");
        this.connected = false;
        this.callbacks.onConnectionChange(false);

        // Auto-reconnect after 2 seconds
        if (!this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.connected) {
              console.log("[ProStream] Attempting reconnect...");
              this.connectWebSocket().catch(() => {});
            }
          }, 2000);
        }
      };

      this.ws.onerror = (event) => {
        console.error("[ProStream] WebSocket error:", event);
        this.callbacks.onError?.(new Error("WebSocket connection error"));
        reject(new Error("WebSocket connection error"));
      };

      this.ws.onmessage = (event) => {
        this.handleServerMessage(event.data);
      };
    });
  }

  private disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // Send stop message
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "stop" }));
      }
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.callbacks.onConnectionChange(false);
  }

  private handleServerMessage(data: string | ArrayBuffer): void {
    if (typeof data !== "string") return;

    try {
      const msg = JSON.parse(data);

      if (msg.type === "note_events" && Array.isArray(msg.events)) {
        // Convert server events to our NoteEvent format
        const events: NoteEvent[] = msg.events.map((e: any) => ({
          pitch: e.pitch,
          noteName: e.noteName || midiToNoteName(e.pitch),
          tOnMs: e.tOnMs,
          tOffMs: e.tOffMs,
          velocity: e.velocity,
          confidence: e.confidence ?? 0.9,
          onsetStrength: e.onsetStrength,
          source: "polyphonic" as const,
          kind: "confirmed" as const,
        }));

        if (events.length > 0) {
          console.log(
            `[ProStream] Received ${events.length} note events: ${events
              .map((e) => e.noteName)
              .join(", ")}`
          );
          this.callbacks.onNoteEvents(events);
        }
      } else if (msg.type === "error") {
        console.error("[ProStream] Server error:", msg.message);
        this.callbacks.onError?.(new Error(msg.message));
      } else if (msg.type === "stats") {
        // Server-side stats
        console.log(`[ProStream] Server stats: latency=${msg.latencyMs}ms`);
      }
    } catch (err) {
      console.error("[ProStream] Failed to parse server message:", err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Audio Capture
  // ─────────────────────────────────────────────────────────────────────────────

  private async startAudioCapture(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: SOURCE_SAMPLE_RATE,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: SOURCE_SAMPLE_RATE });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.processor = this.audioContext.createScriptProcessor(
      SCRIPT_BUFFER_SIZE,
      1,
      1
    );

    this.processor.onaudioprocess = (e) => {
      if (!this.connected) return;

      const inputData = e.inputBuffer.getChannelData(0);
      this.processAudioChunk(inputData);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.lastStatsTime = performance.now();
    this.framesSent = 0;
    this.bytesSent = 0;

    console.log("[ProStream] Audio capture started");
  }

  private stopAudioCapture(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.frameBufferIndex = 0;
  }

  private processAudioChunk(samples: Float32Array): void {
    // Resample 44.1kHz → 16kHz
    const resampled = this.resampler.resample(samples);

    // Accumulate into frame buffer
    for (let i = 0; i < resampled.length; i++) {
      this.frameBuffer[this.frameBufferIndex++] = resampled[i];

      // When buffer is full, send frame
      if (this.frameBufferIndex >= this.targetFrameSize) {
        this.sendFrame(this.frameBuffer);
        this.frameBufferIndex = 0;
      }
    }

    // Update stats every 500ms
    const now = performance.now();
    if (now - this.lastStatsTime > 500) {
      const elapsed = (now - this.lastStatsTime) / 1000;
      const stats: ProStreamStats = {
        connected: this.connected,
        framesSent: this.framesSent,
        bytesPerSec: Math.round(this.bytesSent / elapsed),
        framesPerSec: Math.round(this.framesSent / elapsed),
        latencyMs: this.options.frameSizeMs, // Approximate
      };

      console.log(
        `[ProStream-STATS] ${stats.framesPerSec} fps, ${Math.round(stats.bytesPerSec / 1024)} KB/s`
      );

      this.callbacks.onStats?.(stats);
      this.framesSent = 0;
      this.bytesSent = 0;
      this.lastStatsTime = now;
    }
  }

  private sendFrame(samples: Float32Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Calculate timestamp relative to exercise start
    const timestampMs = Math.round(performance.now() - this.exerciseStartTime);

    // Create binary message: [uint32 timestamp][int16 samples...]
    const headerSize = 4; // 4 bytes for timestamp
    const dataSize = samples.length * 2; // 2 bytes per int16
    const buffer = new ArrayBuffer(headerSize + dataSize);

    // Write timestamp (uint32)
    const view = new DataView(buffer);
    view.setUint32(0, timestampMs, true); // little-endian

    // Write PCM16 samples
    const int16View = new Int16Array(buffer, headerSize);
    for (let i = 0; i < samples.length; i++) {
      // Clamp and convert float32 [-1, 1] to int16 [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, samples[i]));
      int16View[i] = Math.round(sample * 32767);
    }

    this.ws.send(buffer);
    this.framesSent++;
    this.bytesSent += buffer.byteLength;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.connected;
  }
}
