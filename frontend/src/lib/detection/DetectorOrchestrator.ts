/**
 * DetectorOrchestrator - Routes audio to appropriate detectors based on exercise type.
 *
 * Architecture:
 * - Lite (YIN): Client-side, monophonic, instant feedback (~20ms)
 * - Pro (Polyphonic ML): Server-side, chords/multi-note, confirmed scoring (~200ms)
 *
 * Both output unified NoteEvents, so UI doesn't care which engine produced them.
 */

import {
  NoteEvent,
  ExerciseMeta,
  DetectorConfig,
  getDetectorConfig,
  midiToNoteName,
  noteNameToMidi,
} from "../music/types";
import { ClientYinDetector, YinDetection } from "../clientYinDetector";
import { ProStreamClient, ProStreamStats } from "./ProStreamClient";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  /** Called for tentative events (instant UI feedback) */
  onTentative: (event: NoteEvent) => void;

  /** Called for confirmed events (scoring) */
  onConfirmed: (event: NoteEvent) => void;

  /** Called when Pro connection status changes */
  onProStatusChange?: (connected: boolean) => void;

  /** Called on error */
  onError?: (error: Error, source: "lite" | "pro") => void;
}

export interface OrchestratorOptions {
  /** Sample rate for audio processing */
  sampleRate?: number;

  /** Expected notes for score-aware detection */
  expectedNotes?: string[];

  /** Exercise start time (performance.now()) for timestamp calculation */
  exerciseStartTime?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DetectorOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

export class DetectorOrchestrator {
  private config: DetectorConfig;
  private callbacks: OrchestratorCallbacks;
  private options: OrchestratorOptions;

  // Lite detector (YIN)
  private liteDetector: ClientYinDetector | null = null;

  // Pro detector (WebSocket streaming)
  private proClient: ProStreamClient | null = null;
  private proConnected: boolean = false;

  // State
  private isRunning: boolean = false;
  private exerciseStartTime: number = 0;
  private expectedPitches: Set<number> = new Set();

  constructor(
    meta: ExerciseMeta,
    callbacks: OrchestratorCallbacks,
    options: OrchestratorOptions = {}
  ) {
    this.config = getDetectorConfig(meta);
    this.callbacks = callbacks;
    this.options = {
      sampleRate: options.sampleRate ?? 44100,
      expectedNotes: options.expectedNotes ?? [],
      exerciseStartTime: options.exerciseStartTime ?? 0,
    };

    // Build expected pitches set
    this.updateExpectedNotes(this.options.expectedNotes ?? []);

    console.log(
      `[Orchestrator] Config: useLite=${this.config.useLite}, usePro=${this.config.usePro}, scoreAware=${this.config.scoreAware}`
    );
  }

  /**
   * Start all configured detectors.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.exerciseStartTime = this.options.exerciseStartTime || performance.now();

    // Start Lite detector (YIN)
    if (this.config.useLite) {
      await this.startLite();
    }

    // Start Pro detector (WebSocket) - Task 3 will implement this
    if (this.config.usePro) {
      await this.startPro();
    }

    this.isRunning = true;
    console.log("[Orchestrator] Started");
  }

  /**
   * Stop all detectors.
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.liteDetector) {
      this.liteDetector.stop();
      this.liteDetector = null;
    }

    // Stop Pro - Task 3 will implement this
    this.stopPro();

    this.isRunning = false;
    console.log("[Orchestrator] Stopped");
  }

  /**
   * Update expected notes for score-aware detection.
   */
  updateExpectedNotes(notes: string[]): void {
    this.expectedPitches.clear();
    for (const note of notes) {
      this.expectedPitches.add(noteNameToMidi(note));
    }

    // Update Lite detector
    if (this.liteDetector) {
      this.liteDetector.setExpectedNotes(notes);
    }

    // Update Pro detector (send via WebSocket) - Task 3
    this.sendExpectedToPro(notes);

    console.log(`[Orchestrator] Expected notes updated: ${notes.join(", ")}`);
  }

  /**
   * Update exercise start time (for timestamp calculation).
   */
  setExerciseStartTime(time: number): void {
    this.exerciseStartTime = time;
  }

  /**
   * Reset state for replay.
   */
  reset(): void {
    if (this.liteDetector) {
      this.liteDetector.reset();
    }
    // Reset Pro state - Task 3
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lite Detector (YIN)
  // ─────────────────────────────────────────────────────────────────────────────

  private async startLite(): Promise<void> {
    const expectedNotes = Array.from(this.expectedPitches).map(midiToNoteName);

    this.liteDetector = new ClientYinDetector({
      sampleRate: this.options.sampleRate,
      expectedNotes,

      // Two-speed: tentative fires immediately
      onTentativeNote: (detection: YinDetection) => {
        const event = this.yinToNoteEvent(detection, "tentative");
        this.callbacks.onTentative(event);
      },

      // Two-speed: confirmed fires after stability check
      onNoteDetected: (detection: YinDetection) => {
        const event = this.yinToNoteEvent(detection, "confirmed");

        // In Lite-only mode, confirmed goes to scoring
        // In Lite+Pro mode, Lite confirmed is still just for UI (Pro does scoring)
        if (this.config.usePro) {
          // Pro mode: Lite confirmed is still "tentative" for scoring purposes
          // Real scoring waits for Pro confirmed
          this.callbacks.onTentative(event);
        } else {
          // Lite-only mode: Lite confirmed is the real confirmed
          this.callbacks.onConfirmed(event);
        }
      },

      onTentativeCancelled: (note: string) => {
        console.log(`[Orchestrator] Lite tentative cancelled: ${note}`);
      },

      onError: (error: Error) => {
        console.error("[Orchestrator] Lite error:", error);
        this.callbacks.onError?.(error, "lite");
      },
    });

    await this.liteDetector.start();
    console.log("[Orchestrator] Lite detector started");
  }

  /**
   * Convert YIN detection to unified NoteEvent.
   */
  private yinToNoteEvent(
    detection: YinDetection,
    kind: "tentative" | "confirmed"
  ): NoteEvent {
    const tOnMs = performance.now() - this.exerciseStartTime;

    return {
      pitch: detection.midiPitch,
      noteName: detection.note,
      tOnMs,
      confidence: detection.confidence,
      velocity: Math.round(detection.velocity * 127),
      source: "yin",
      kind,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Pro Detector (WebSocket Streaming)
  // ─────────────────────────────────────────────────────────────────────────────

  private async startPro(): Promise<void> {
    const expectedNotes = Array.from(this.expectedPitches).map(midiToNoteName);

    this.proClient = new ProStreamClient(
      {
        onNoteEvents: (events: NoteEvent[]) => {
          // Pro events are always confirmed
          for (const event of events) {
            this.callbacks.onConfirmed(event);
          }
        },
        onConnectionChange: (connected: boolean) => {
          this.proConnected = connected;
          this.callbacks.onProStatusChange?.(connected);
          console.log(`[Orchestrator] Pro connection: ${connected ? "connected" : "disconnected"}`);
        },
        onError: (error: Error) => {
          console.error("[Orchestrator] Pro error:", error);
          this.callbacks.onError?.(error, "pro");
        },
        onStats: (stats: ProStreamStats) => {
          // Forward stats if needed
        },
      },
      {
        sessionId: `pro-${Date.now()}`,
      }
    );

    try {
      await this.proClient.start(this.exerciseStartTime);
      // Send initial expected notes
      if (expectedNotes.length > 0) {
        this.proClient.sendExpectedNotes(expectedNotes);
      }
      console.log("[Orchestrator] Pro detector started");
    } catch (error) {
      console.warn("[Orchestrator] Pro detector failed to start:", error);
      // Don't throw - Pro is optional, Lite can still work
      this.proClient = null;
      this.proConnected = false;
      this.callbacks.onProStatusChange?.(false);
    }
  }

  private stopPro(): void {
    if (this.proClient) {
      this.proClient.stop();
      this.proClient = null;
    }
    this.proConnected = false;
  }

  private sendExpectedToPro(notes: string[]): void {
    if (this.proClient && this.proConnected) {
      this.proClient.sendExpectedNotes(notes);
    }
  }

  /**
   * Handle NoteEvent from Pro detector.
   * Called by ProStreamClient when server sends events.
   */
  handleProEvent(event: NoteEvent): void {
    // Pro events are always confirmed (server does the stability check)
    this.callbacks.onConfirmed(event);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Status
  // ─────────────────────────────────────────────────────────────────────────────

  get status(): { lite: boolean; pro: boolean; running: boolean } {
    return {
      lite: this.liteDetector !== null,
      pro: this.proConnected,
      running: this.isRunning,
    };
  }
}
