"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import PianoKeyboard from "@/components/piano/PianoKeyboard";
import FallingNotes, { FallingNote } from "@/components/piano/FallingNotes";
import NoteRail from "@/components/piano/NoteRail";
import DisplayModeToggle, { DisplayMode } from "@/components/piano/DisplayModeToggle";
import AutoPlayDemo from "@/components/piano/AutoPlayDemo";
import ClientModeToggle from "@/components/piano/ClientModeToggle";
import { Octave } from "@/types/piano";
import { AudioCapture } from "@/lib/audioCapture";
import { WebSocketClient } from "@/lib/websocketClient";
import { ClientScoreFollower, MatchResult } from "@/lib/clientScoreFollower";
import { ClientYinDetector, YinDetection } from "@/lib/clientYinDetector";
import { getBackendHttpUrl } from "@/lib/config";
import { NoteEvent, ExerciseMeta } from "@/lib/music/types";
import { DetectorOrchestrator } from "@/lib/detection/DetectorOrchestrator";
import {
  ScoreFollowerWithValidation,
  NoteResult as AutoSyncResult,
  FollowerMode as AutoSyncMode,
  SongData,
} from "@/lib/scoreFollowerWithValidation";
import SyncStatusIndicator from "@/components/piano/SyncStatusIndicator";

interface Exercise {
  id: string;
  name: string;
  description: string;
  notes?: string[];
  difficulty: string;
  type?: string;
  available?: boolean;
  /** Does this exercise require polyphonic detection? */
  requiresPolyphony?: boolean;
  /** Expected number of voices (1 = monophonic, 2 = two hands) */
  expectedVoices?: 1 | 2;
}

// ── Metronome hook ──────────────────────────────────────────────────────
function useMetronome() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const beatRef = useRef(0);
  const [enabled, setEnabled] = useState(true);
  const [bpm, setBpm] = useState(0);
  const [beatsPerBar, setBeatsPerBar] = useState(2);
  const [beatUnit, setBeatUnit] = useState(1);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const playClick = useCallback(
    (strong: boolean) => {
      try {
        const ctx = getAudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = strong ? 1000 : 800;
        gain.gain.value = strong ? 0.3 : 0.15;
        const dur = strong ? 0.05 : 0.03;
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + dur);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      } catch {
        // AudioContext may be suspended; ignore
      }
    },
    [getAudioCtx],
  );

  const start = useCallback(
    (targetBpm: number, targetBeatsPerBar: number, targetBeatUnit: number = 1) => {
      if (targetBpm <= 0) return;
      setBpm(targetBpm);
      setBeatsPerBar(targetBeatsPerBar);
      setBeatUnit(targetBeatUnit);
      beatRef.current = 0;

      if (timerRef.current) clearInterval(timerRef.current);
      const intervalMs = Math.round((60000 / targetBpm) * targetBeatUnit);
      timerRef.current = setInterval(() => {
        const strong = beatRef.current % targetBeatsPerBar === 0;
        playClick(strong);
        beatRef.current += 1;
      }, intervalMs);
    },
    [playClick],
  );

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setBpm(0);
  }, []);

  const updateTempo = useCallback(
    (newBpm: number) => {
      if (newBpm <= 0 || !timerRef.current) return;
      setBpm(newBpm);
      if (timerRef.current) clearInterval(timerRef.current);
      const intervalMs = Math.round((60000 / newBpm) * beatUnit);
      timerRef.current = setInterval(() => {
        const strong = beatRef.current % beatsPerBar === 0;
        playClick(strong);
        beatRef.current += 1;
      }, intervalMs);
    },
    [beatsPerBar, beatUnit, playClick],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, []);

  return { enabled, setEnabled, bpm, start, stop, updateTempo, playClick };
}

// ── Count-in helper ────────────────────────────────────────────────────
function useCountIn() {
  const [counting, setCounting] = useState(false);
  const [countLabel, setCountLabel] = useState<string | null>(null);

  const run = useCallback(
    (
      bpm: number,
      beatsPerBar: number,
      playClick: (strong: boolean) => void,
      onDone: () => void,
    ) => {
      if (bpm <= 0 || beatsPerBar <= 0) {
        onDone();
        return;
      }
      setCounting(true);
      const intervalMs = Math.round(60000 / bpm);
      let beat = 0;
      const total = beatsPerBar;

      const tick = () => {
        if (beat >= total) {
          setCounting(false);
          setCountLabel(null);
          onDone();
          return;
        }
        const remaining = total - beat;
        setCountLabel(remaining === 1 ? "GO" : String(remaining));
        playClick(beat === 0);
        beat += 1;
        setTimeout(tick, intervalMs);
      };
      tick();
    },
    [],
  );

  return { counting, countLabel, run };
}

// ── Sound cues for note feedback ──────────────────────────────────────
function useSoundCues() {
  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const playCorrect = useCallback(() => {
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.value = 523;
      gain1.gain.setValueAtTime(0.15, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.value = 659;
      gain2.gain.setValueAtTime(0.12, now + 0.06);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.06);
      osc2.stop(now + 0.18);
    } catch { /* AudioContext unavailable */ }
  }, [getCtx]);

  const playWrong = useCallback(() => {
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 150;
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch { /* AudioContext unavailable */ }
  }, [getCtx]);

  const playPerfect = useCallback(() => {
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;
      [1200, 1800].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, now + i * 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15 + i * 0.03);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.03);
        osc.stop(now + 0.15 + i * 0.03);
      });
    } catch { /* AudioContext unavailable */ }
  }, [getCtx]);

  const playComplete = useCallback(() => {
    try {
      const ctx = getCtx();
      const now = ctx.currentTime;
      const notes = [523, 659, 784, 1047];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.1;
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch { /* AudioContext unavailable */ }
  }, [getCtx]);

  useEffect(() => {
    return () => {
      if (ctxRef.current) ctxRef.current.close().catch(() => {});
    };
  }, []);

  return { playCorrect, playWrong, playPerfect, playComplete };
}

// ── Completion Overlay ────────────────────────────────────────────────
function CompletionOverlay({
  correct,
  total,
  timingStats,
  onReplay,
  onBackToMenu,
}: {
  correct: number;
  total: number;
  timingStats: { avgAbs: number; onTime: number; early: number; late: number };
  onReplay: () => void;
  onBackToMenu: () => void;
}) {
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
  const stars = accuracy >= 90 ? 3 : accuracy >= 70 ? 2 : accuracy >= 50 ? 1 : 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="animate-completion-enter bg-slate-900 rounded-3xl p-8 md:p-12 max-w-md w-full mx-4 text-center ring-1 ring-white/10 shadow-[0_25px_60px_rgba(0,0,0,0.5)]">
        {/* Stars */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`text-5xl ${i < stars ? "animate-star-fill" : "opacity-20"}`}
              style={{ animationDelay: `${i * 0.15 + 0.3}s` }}
            >
              ★
            </span>
          ))}
        </div>

        {/* Accuracy */}
        <div className="text-6xl font-bold text-white mb-1">{accuracy}%</div>
        <div className="text-sm text-slate-400 mb-6">
          {correct}/{total} correct
        </div>

        {/* Timing stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-slate-800/60 rounded-xl p-3 ring-1 ring-white/5">
            <div className="text-emerald-400 font-bold text-lg">{timingStats.onTime}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">On time</div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3 ring-1 ring-white/5">
            <div className="text-amber-400 font-bold text-lg">{timingStats.early}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Early</div>
          </div>
          <div className="bg-slate-800/60 rounded-xl p-3 ring-1 ring-white/5">
            <div className="text-red-400 font-bold text-lg">{timingStats.late}</div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Late</div>
          </div>
        </div>

        <div className="text-xs text-slate-500 mb-6">
          Avg timing: {Math.round(timingStats.avgAbs)}ms
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onReplay}
            className="flex-1 py-3.5 rounded-2xl bg-emerald-500 text-white font-semibold hover:bg-emerald-400 active:scale-[0.98] transition-all"
          >
            Replay
          </button>
          <button
            onClick={onBackToMenu}
            className="flex-1 py-3.5 rounded-2xl bg-slate-800 text-slate-300 font-semibold hover:bg-slate-700 active:scale-[0.98] transition-all ring-1 ring-white/10"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────
export default function PracticePage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState({ correct: 0, total: 0, completion_percent: 0 });
  const [feedback, setFeedback] = useState<string>("");
  const [exerciseComplete, setExerciseComplete] = useState(false);

  const [expectedNotes, setExpectedNotes] = useState<string[]>([]);
  const [nextExpectedNotes, setNextExpectedNotes] = useState<string[]>([]);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [exerciseMeta, setExerciseMeta] = useState<{
    bpm?: number;
    timeSignature?: string;
    beatsPerBar?: number;
    beatUnit?: number;
    hands?: string;
  }>({});
  const [timingStats, setTimingStats] = useState({
    samples: 0,
    avgAbs: 0,
    early: 0,
    late: 0,
    onTime: 0,
    wrong: 0,
  });
  const [loopMode, setLoopMode] = useState(false);
  const [waitMode, setWaitMode] = useState(false); // Training mode: pause until correct note played
  const [waitingForNote, setWaitingForNote] = useState<string | null>(null); // Current note we're waiting for
  const [currentBar, setCurrentBar] = useState<number | null>(null);
  const [cleanPasses, setCleanPasses] = useState(0);
  const [barStats, setBarStats] = useState({ wrong: 0, timingOff: 0 });

  const [lastResult, setLastResult] = useState<"correct" | "wrong" | null>(null);

  // Falling notes state
  const [fallingNotes, setFallingNotes] = useState<FallingNote[]>([]);
  const [exerciseStartTime, setExerciseStartTime] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);

  // Gap 2: hand mode
  const [handsMode, setHandsMode] = useState<"both" | "right" | "left">("both");

  // Gap 5: adaptive tempo
  const [currentBpm, setCurrentBpm] = useState<number | null>(null);
  const [tempoMultiplier, setTempoMultiplier] = useState(1.0);

  // Display mode toggle
  const [displayMode, setDisplayMode] = useState<DisplayMode>("falling");

  // Auto-sync mode: pattern-based position detection (no timing required)
  const [autoSyncMode, setAutoSyncMode] = useState(false);
  const autoSyncFollowerRef = useRef<ScoreFollowerWithValidation | null>(null);
  const [autoSyncState, setAutoSyncState] = useState<{
    mode: AutoSyncMode;
    position: number;
    confidence: number;
    consecutiveErrors: number;
    expectedNext: string | null;
    totalCorrect: number;
    totalWrong: number;
  }>({
    mode: "syncing",
    position: -1,
    confidence: 0,
    consecutiveErrors: 0,
    expectedNext: null,
    totalCorrect: 0,
    totalWrong: 0,
  });

  // Client-side detection mode (low latency, no backend)
  const [clientMode, setClientMode] = useState(true); // Default ON for lower latency (~20ms vs ~600ms server)
  const [polyphonyMode, setPolyphonyMode] = useState(false); // Disable client detection for polyphonic songs
  const clientYinRef = useRef<ClientYinDetector | null>(null);
  const clientFollowerRef = useRef<ClientScoreFollower | null>(null);
  // Orchestrator for unified detection
  const orchestratorRef = useRef<DetectorOrchestrator | null>(null);
  // Two-speed: tentative notes for instant visual feedback
  const [tentativeNotes, setTentativeNotes] = useState<string[]>([]);

  const [octaveRange, setOctaveRange] = useState<{ start: Octave; end: Octave }>({
    start: 3,
    end: 6,
  });

  // Hooks
  const metronome = useMetronome();
  const countIn = useCountIn();
  const soundCues = useSoundCues();

  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const sessionIdRef = useRef<string>(`practice-${Date.now()}`);

  // Refs to avoid stale closures
  const currentBarRef = useRef<number | null>(null);
  const barStatsRef = useRef({ wrong: 0, timingOff: 0 });
  const cleanPassesRef = useRef(0);
  const loopModeRef = useRef(false);
  const waitModeRef = useRef(false);
  const soundCuesRef = useRef(soundCues);
  const exerciseStartTimeRef = useRef(0);
  // Track last matched note for grace period (sustained notes shouldn't show as wrong)
  const lastMatchedRef = useRef<{ note: string; time: number } | null>(null);
  // Wait mode: track time offset when paused waiting for note
  const waitPausedAtRef = useRef<number | null>(null);
  const waitTimeOffsetRef = useRef<number>(0);

  useEffect(() => { currentBarRef.current = currentBar; }, [currentBar]);
  useEffect(() => { barStatsRef.current = barStats; }, [barStats]);
  useEffect(() => { cleanPassesRef.current = cleanPasses; }, [cleanPasses]);
  useEffect(() => { loopModeRef.current = loopMode; }, [loopMode]);
  useEffect(() => { waitModeRef.current = waitMode; }, [waitMode]);
  useEffect(() => { soundCuesRef.current = soundCues; }, [soundCues]);
  useEffect(() => { exerciseStartTimeRef.current = exerciseStartTime; }, [exerciseStartTime]);

  // Time ticker — updates currentTimeMs via requestAnimationFrame
  // Also advances missed notes in client mode
  // In wait mode, pauses time when an expected note is due until it's played
  useEffect(() => {
    if (!isRecording || exerciseStartTime === 0) return;
    let raf: number;
    let lastMissCheck = 0;
    const tick = () => {
      const rawElapsed = performance.now() - exerciseStartTime;
      let effectiveElapsed = rawElapsed - waitTimeOffsetRef.current;

      // Wait mode: check if we should pause for an expected note
      if (waitModeRef.current && clientMode && clientFollowerRef.current) {
        const expectedNotes = clientFollowerRef.current.getExpectedNotes(effectiveElapsed);
        const progress = clientFollowerRef.current.getProgress();

        // Find the first pending note that's past due
        const pendingNotes = fallingNotes.filter((fn, idx) =>
          fn.status === "pending" && effectiveElapsed > fn.expectedTimeMs + 100
        );

        if (pendingNotes.length > 0 && progress.pending > 0) {
          const waitingFor = pendingNotes[0];
          // Pause: cap effective time at this note's expected time + small buffer
          if (waitPausedAtRef.current === null) {
            waitPausedAtRef.current = rawElapsed;
            setWaitingForNote(waitingFor.note);
            console.log(`[WAIT-MODE] Pausing at ${waitingFor.note} @ ${waitingFor.expectedTimeMs}ms`);
          }
          // Keep effective time at the note's time
          effectiveElapsed = waitingFor.expectedTimeMs + 100;
        } else {
          // Resume if we were paused
          if (waitPausedAtRef.current !== null) {
            const pauseDuration = rawElapsed - waitPausedAtRef.current;
            waitTimeOffsetRef.current += pauseDuration;
            console.log(`[WAIT-MODE] Resuming after ${pauseDuration.toFixed(0)}ms pause`);
            waitPausedAtRef.current = null;
            setWaitingForNote(null);
            effectiveElapsed = rawElapsed - waitTimeOffsetRef.current;
          }
        }
      }

      setCurrentTimeMs(effectiveElapsed);

      // In client mode (non-wait), periodically check for missed notes
      if (clientMode && clientFollowerRef.current && !waitModeRef.current && effectiveElapsed - lastMissCheck > 200) {
        lastMissCheck = effectiveElapsed;
        const missed = clientFollowerRef.current.advanceMissedNotes(effectiveElapsed);
        if (missed.length > 0) {
          console.log(`[CLIENT-TICK] Marking ${missed.length} notes as missed at t=${effectiveElapsed.toFixed(0)}ms`);
          setFallingNotes((prev) =>
            prev.map((fn, idx) =>
              missed.includes(idx) ? { ...fn, status: "missed" as const } : fn
            )
          );
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isRecording, exerciseStartTime, clientMode, fallingNotes]);

  // Auto-sync mode: Handle detected notes (must be defined before the useEffect that uses it)
  const processAutoSyncNote = useCallback(
    (detectedNote: string) => {
      if (!autoSyncFollowerRef.current) return null;

      const result = autoSyncFollowerRef.current.processNote(detectedNote);
      console.log("[AUTO-SYNC] Result:", result);

      // Update state
      const state = autoSyncFollowerRef.current.getState();
      setAutoSyncState((prev) => ({
        mode: state.mode,
        position: state.position,
        confidence: state.confidence,
        consecutiveErrors: state.consecutiveErrors,
        expectedNext: state.expectedNext,
        totalCorrect: result.isCorrect ? prev.totalCorrect + 1 : prev.totalCorrect,
        totalWrong:
          !result.isCorrect && result.mode === "locked"
            ? prev.totalWrong + 1
            : prev.totalWrong,
      }));

      // Play sound feedback
      if (result.isCorrect) {
        soundCuesRef.current.playCorrect();
        setLastResult("correct");
        setFeedback(result.message);
      } else if (result.mode === "locked") {
        soundCuesRef.current.playWrong();
        setLastResult("wrong");
        setFeedback(result.message);
      } else {
        // Syncing or lost mode - just show status
        setFeedback(result.message);
      }

      // Update falling note status if locked and correct
      if (result.mode === "locked" && result.isCorrect && result.position >= 0) {
        setFallingNotes((prev) =>
          prev.map((fn, idx) =>
            idx === result.position ? { ...fn, status: "hit" as const } : fn
          )
        );
      }

      return result;
    },
    []
  );

  // Client-side detection mode (YIN pitch detection - same algorithm as server, <20ms latency)
  useEffect(() => {
    if (!clientMode || !isRecording || exerciseStartTime === 0 || fallingNotes.length === 0) {
      // Cleanup when disabled
      if (clientYinRef.current) {
        clientYinRef.current.stop();
        clientYinRef.current = null;
      }
      clientFollowerRef.current = null;
      return;
    }

    // Build expected notes list for score-aware detection
    const expectedNotes = [...new Set(fallingNotes.map(fn => fn.note))];

    // Initialize client-side score follower
    clientFollowerRef.current = new ClientScoreFollower(fallingNotes, {
      onTimeToleranceMs: 150,
      maxTimingWindowMs: 500,
      onMatch: (result: MatchResult) => {
        console.log(`[CLIENT-YIN] Match: ${result.note} ${result.timingStatus} (${result.timingErrorMs}ms)`);
        setFeedback(result.feedback);
        setLastResult("correct");
        soundCuesRef.current.playCorrect();
        // Record for grace period - sustained notes shouldn't trigger "wrong"
        lastMatchedRef.current = { note: result.note, time: performance.now() };
        setDetectedNotes([result.note]);
        setTimeout(() => setDetectedNotes([]), 600);

        // Update note status to "hit"
        setFallingNotes((prev) =>
          prev.map((fn, idx) =>
            idx === result.noteIndex ? { ...fn, status: "hit" as const } : fn
          )
        );

        // Update progress
        const prog = clientFollowerRef.current?.getProgress();
        if (prog) {
          setProgress({
            correct: prog.matched,
            total: prog.total,
            completion_percent: prog.percentComplete,
          });

          // Check for completion
          if (prog.matched === prog.total) {
            setExerciseComplete(true);
            soundCuesRef.current.playComplete();
          }
        }

        // Update timing stats
        setTimingStats((prev) => ({
          ...prev,
          samples: prev.samples + 1,
          onTime: prev.onTime + (result.timingStatus === "on_time" ? 1 : 0),
          early: prev.early + (result.timingStatus === "early" ? 1 : 0),
          late: prev.late + (result.timingStatus === "late" ? 1 : 0),
          avgAbs: (prev.avgAbs * prev.samples + Math.abs(result.timingErrorMs)) / (prev.samples + 1),
        }));
      },
      onWrongNote: (note: string, expectedNotesList: string[]) => {
        // Grace period: if this is the same note we just matched, ignore it (sustained note)
        const GRACE_PERIOD_MS = 800;
        const lastMatched = lastMatchedRef.current;
        if (lastMatched && lastMatched.note === note && (performance.now() - lastMatched.time) < GRACE_PERIOD_MS) {
          console.log(`[CLIENT-YIN] Ignoring sustained ${note} (grace period)`);
          return;
        }

        console.log(`[CLIENT-YIN] Wrong: ${note}, expected: ${expectedNotesList.join(", ")}`);
        setFeedback(`Wrong note: ${note}`);
        setLastResult("wrong");
        soundCuesRef.current.playWrong();
        setDetectedNotes([note]);
        setTimeout(() => setDetectedNotes([]), 400);
        setTimingStats((prev) => ({ ...prev, wrong: prev.wrong + 1 }));
      },
    });

    console.log("[CLIENT-YIN] Initializing with expected notes:", expectedNotes);

    // Initialize YIN pitch detector with two-speed tentative/confirm system
    const yinDetector = new ClientYinDetector({
      sampleRate: 44100,
      expectedNotes,
      // Two-speed config: 80ms confirm delay for responsive feel with false positive protection
      twoSpeed: {
        confirmDelayMs: 80,
        tentativeOnly: false,
      },
      // CONFIRMED callback - used for scoring (delayed)
      onNoteDetected: (detection: YinDetection) => {
        const elapsed = performance.now() - exerciseStartTimeRef.current;

        // Clear tentative highlight
        setTentativeNotes([]);

        // If auto-sync mode is enabled, use pattern-based detection
        if (autoSyncMode && autoSyncFollowerRef.current) {
          console.log(`[CLIENT-YIN] CONFIRMED (auto-sync): ${detection.note}`);
          processAutoSyncNote(detection.note);
          setDetectedNotes([detection.note]);
          setTimeout(() => setDetectedNotes([]), 600);
          return;
        }

        // Otherwise use time-based detection
        const currentExpected = clientFollowerRef.current?.getExpectedNotes(elapsed) || [];
        console.log(`[CLIENT-YIN] CONFIRMED: ${detection.note} @ ${elapsed.toFixed(0)}ms | expected now: ${currentExpected.join(", ")}`);

        if (clientFollowerRef.current) {
          clientFollowerRef.current.processDetection(detection.note, elapsed);

          // Mark missed notes
          const missed = clientFollowerRef.current.advanceMissedNotes(elapsed);
          if (missed.length > 0) {
            setFallingNotes((prev) =>
              prev.map((fn, idx) =>
                missed.includes(idx) ? { ...fn, status: "missed" as const } : fn
              )
            );
          }
        }
      },
      // TENTATIVE callback - immediate visual feedback only (no scoring)
      onTentativeNote: (detection: YinDetection) => {
        console.log(`[CLIENT-YIN] TENTATIVE: ${detection.note}`);
        setTentativeNotes([detection.note]);
      },
      // CANCELLED callback - clear tentative if it was a false positive
      onTentativeCancelled: (note: string) => {
        console.log(`[CLIENT-YIN] CANCELLED: ${note}`);
        setTentativeNotes((prev) => prev.filter((n) => n !== note));
      },
      onError: (err) => {
        console.error("[CLIENT-YIN] Error:", err);
        setClientMode(false);
      },
    });

    // Apply polyphony mode
    yinDetector.polyphonyMode = polyphonyMode;

    yinDetector.start().catch((err) => {
      console.error("[CLIENT-YIN] Failed to start:", err);
      setClientMode(false);
    });

    clientYinRef.current = yinDetector;
    console.log("[CLIENT-YIN] Started - no model loading, instant detection");

    return () => {
      yinDetector.stop();
      clientYinRef.current = null;
      clientFollowerRef.current = null;
    };
  }, [clientMode, isRecording, exerciseStartTime, fallingNotes.length, polyphonyMode, autoSyncMode, processAutoSyncNote]);

  // Sync polyphony mode changes to the detector
  useEffect(() => {
    if (clientYinRef.current) {
      clientYinRef.current.polyphonyMode = polyphonyMode;
    }
  }, [polyphonyMode]);

  // Auto-sync mode: Initialize ScoreFollowerWithValidation for pattern-based detection
  useEffect(() => {
    if (!autoSyncMode || !isRecording || fallingNotes.length === 0) {
      autoSyncFollowerRef.current = null;
      return;
    }

    // Build song data from falling notes
    const noteSequence = fallingNotes.map((fn) => fn.note);
    const songData: SongData = {
      title: selectedExercise?.name || "Practice",
      notes: noteSequence,
    };

    // Create auto-sync follower (strict mode - must play correct notes)
    const follower = new ScoreFollowerWithValidation(songData, {
      strictMode: true,
      allowOctaveEquivalence: true,
      bufferSize: 5,
      lockThreshold: 0.7,
      minMatchesForLock: 3,
      maxConsecutiveErrors: 5,
    });

    autoSyncFollowerRef.current = follower;
    console.log("[AUTO-SYNC] Initialized with", noteSequence.length, "notes");

    // Reset state
    setAutoSyncState({
      mode: "syncing",
      position: -1,
      confidence: 0,
      consecutiveErrors: 0,
      expectedNext: null,
      totalCorrect: 0,
      totalWrong: 0,
    });

    return () => {
      autoSyncFollowerRef.current = null;
    };
  }, [autoSyncMode, isRecording, fallingNotes.length, selectedExercise?.name]);

  // Load exercises
  useEffect(() => {
    const backendUrl = getBackendHttpUrl();
    fetch(`${backendUrl}/exercises`)
      .then((res) => res.json())
      .then((data) => setExercises(data.exercises || []))
      .catch((err) => console.error("Failed to load exercises:", err));
  }, []);

  // Responsive octave ranges
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      if (w >= 1024) setOctaveRange({ start: 3, end: 6 });
      else if (w >= 640) setOctaveRange({ start: 4, end: 6 });
      else setOctaveRange({ start: 4, end: 5 });
    };
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  /** Build falling notes from all_notes data + exercise timing */
  const buildFallingNotes = useCallback(
    (
      allNotes: { notes: string[]; hand: string | null; bar: number; fingers?: number[] }[],
      bpm: number,
      beatsPerBar: number,
    ): FallingNote[] => {
      console.log("[buildFallingNotes] input:", { bpm, beatsPerBar, notesCount: allNotes.length });
      if (bpm <= 0 || allNotes.length === 0) {
        console.log("[buildFallingNotes] Early return: bpm or notes empty");
        return [];
      }
      const barDurationMs = beatsPerBar * (60000 / bpm);

      // Group notes by bar
      const barGroups: Map<number, typeof allNotes> = new Map();
      allNotes.forEach((n) => {
        const group = barGroups.get(n.bar) || [];
        group.push(n);
        barGroups.set(n.bar, group);
      });

      const result: FallingNote[] = [];
      let globalIndex = 0;

      // Add lead-in time so first note isn't at 0ms (give 1 beat of preparation)
      const leadInMs = 60000 / bpm; // One beat lead-in

      barGroups.forEach((barNotes, barNum) => {
        const barStartMs = (barNum - 1) * barDurationMs + leadInMs; // bars are 1-based, add lead-in
        console.log(`[buildFallingNotes] Bar ${barNum}: startMs=${barStartMs}, notes=${barNotes.length}`);
        barNotes.forEach((n, idxInBar) => {
          const expectedTimeMs =
            barStartMs + (idxInBar / Math.max(barNotes.length, 1)) * barDurationMs;
          // Each note group may have multiple notes (chord) — create one falling note per note
          n.notes.forEach((note, noteIdx) => {
            result.push({
              note,
              hand: n.hand,
              bar: n.bar,
              index: globalIndex,
              expectedTimeMs,
              status: "pending",
              finger: n.fingers?.[noteIdx],
            });
          });
          globalIndex++;
        });
      });

      return result;
    },
    [],
  );

  const handleStartExercise = async () => {
    if (!selectedExercise) return;

    try {
      const wsClient = new WebSocketClient(sessionIdRef.current);
      await wsClient.connect((event) => {
        console.log("WebSocket event:", event);

        if (event.type === "exercise_started") {
          const expected = event.data.expected_notes || [];
          setExpectedNotes(expected);
          setNextExpectedNotes(event.data.next_expected_notes || expected.slice(0, 2));
          const bpm = event.data.bpm;
          const beatUnit = event.data.time_signature?.beat_unit || 1;
          const bpb = event.data.beats_per_bar || 2;
          setExerciseMeta({
            bpm,
            timeSignature: event.data.time_signature
              ? `${event.data.time_signature.numerator}/${event.data.time_signature.denominator}`
              : undefined,
            beatsPerBar: bpb,
            beatUnit,
            hands: event.data.hands,
          });
          setCurrentBpm(bpm || null);
          setTempoMultiplier(1.0);
          setFeedback("Count-in...");
          setExerciseComplete(false);
          setProgress({
            correct: 0,
            total: event.data.total_notes || event.data.total_groups || 0,
            completion_percent: 0,
          });
          setCurrentPosition(0);
          setTimingStats({ samples: 0, avgAbs: 0, early: 0, late: 0, onTime: 0, wrong: 0 });
          setCurrentBar(null);
          setCleanPasses(0);
          setBarStats({ wrong: 0, timingOff: 0 });
          setWaitingForNote(null);
          waitPausedAtRef.current = null;
          waitTimeOffsetRef.current = 0;

          // Build falling notes from all_notes data
          console.log("[DEBUG] exercise_started:", {
            bpm,
            bpb,
            all_notes: event.data.all_notes,
            all_notes_length: event.data.all_notes?.length
          });
          if (event.data.all_notes) {
            const built = buildFallingNotes(event.data.all_notes, bpm || 0, bpb);
            console.log("[DEBUG] Built falling notes:", built.length, built.slice(0, 3));
            setFallingNotes(built);
          } else {
            console.log("[DEBUG] No all_notes in response");
            setFallingNotes([]);
          }

          // Count-in
          if (bpm && bpm > 0) {
            countIn.run(bpm, bpb, metronome.playClick, () => {
              wsClient.send({ type: "count_in_complete", data: {} });
              setFeedback("Play the highlighted notes!");
              // Mark exercise start time
              const startT = performance.now();
              setExerciseStartTime(startT);
              exerciseStartTimeRef.current = startT;
              if (metronome.enabled) {
                metronome.start(bpm, bpb, beatUnit);
              }
            });
          } else {
            wsClient.send({ type: "count_in_complete", data: {} });
            setFeedback("Play the highlighted notes!");
            const startT = performance.now();
            setExerciseStartTime(startT);
            exerciseStartTimeRef.current = startT;
          }
        } else if (event.type === "note_detected") {
          const {
            note,
            matched_expected,
            feedback: noteFeedback,
            action,
            progress: noteProgress,
            timing_status,
            timing_error_ms,
            group_position,
          } = event.data;

          // Detailed logging for debugging
          const elapsedMs = performance.now() - exerciseStartTimeRef.current;
          console.log(`[DETECT] ${note} | action=${action} | matched=${matched_expected} | timing=${timing_status} | error=${timing_error_ms}ms | elapsed=${elapsedMs.toFixed(0)}ms | pos=${group_position}`);

          if (action === "accept" && matched_expected) {
            const timingLabel =
              timing_status && timing_status !== "on_time"
                ? ` (${timing_status} by ${Math.abs(timing_error_ms)}ms)`
                : timing_status === "on_time"
                  ? " (on time)"
                  : "";
            setFeedback(`${noteFeedback}${timingLabel}`);
            setTimingStats((prev) => {
              const samples = prev.samples + 1;
              const absErr = typeof timing_error_ms === "number" ? Math.abs(timing_error_ms) : 0;
              const avgAbs = (prev.avgAbs * prev.samples + absErr) / samples;
              const timingOff = timing_status === "early" || timing_status === "late";
              if (timingOff) {
                setBarStats((bp) => ({ ...bp, timingOff: bp.timingOff + 1 }));
              }
              return {
                samples,
                avgAbs,
                early: prev.early + (timing_status === "early" ? 1 : 0),
                late: prev.late + (timing_status === "late" ? 1 : 0),
                onTime: prev.onTime + (timing_status === "on_time" ? 1 : 0),
                wrong: prev.wrong,
              };
            });
            setLastResult("correct");
            if (timing_status === "on_time") {
              soundCuesRef.current.playPerfect();
            } else {
              soundCuesRef.current.playCorrect();
            }

            // Update falling note status to "hit"
            if (typeof group_position === "number") {
              setFallingNotes((prev) =>
                prev.map((fn) =>
                  fn.index === group_position - 1 && fn.note === note
                    ? { ...fn, status: "hit" as const }
                    : fn,
                ),
              );
            }

            setDetectedNotes([note]);
            setTimeout(() => setDetectedNotes([]), 800);

            if (noteProgress) {
              const [current] = noteProgress.split("/").map(Number);
              setCurrentPosition(current);
              setNextExpectedNotes(expectedNotes.slice(current, current + 2));
            }
          } else if (action === "reject") {
            setFeedback(`${noteFeedback}`);
            setTimingStats((prev) => ({ ...prev, wrong: prev.wrong + 1 }));
            setBarStats((bp) => ({ ...bp, wrong: bp.wrong + 1 }));
            setLastResult("wrong");
            soundCuesRef.current.playWrong();
            setDetectedNotes([note]);
            setTimeout(() => setDetectedNotes([]), 500);
          }
        } else if (event.type === "exercise_progress") {
          setProgress(event.data);
          if (typeof event.data.current_group === "number") {
            setCurrentPosition(event.data.current_group);

            // Mark upcoming note as "active", past notes as "missed" if not hit
            setFallingNotes((prev) => {
              const curGroup = event.data.current_group;
              return prev.map((fn) => {
                if (fn.index === curGroup - 1 && fn.status === "pending") {
                  return { ...fn, status: "active" as const };
                }
                if (fn.index < curGroup - 1 && fn.status === "pending") {
                  return { ...fn, status: "missed" as const };
                }
                return fn;
              });
            });
          }
          if (event.data.next_expected_notes) {
            setNextExpectedNotes(event.data.next_expected_notes);
          } else {
            setNextExpectedNotes(expectedNotes.slice(currentPosition, currentPosition + 2));
          }
          if (typeof event.data.current_bpm === "number") {
            setCurrentBpm(event.data.current_bpm);
          }
          if (typeof event.data.current_bar === "number") {
            const nextBar = event.data.current_bar;
            const prevBar = currentBarRef.current;
            const prevBarStats = barStatsRef.current;
            const prevCleanPasses = cleanPassesRef.current;
            const isLooping = loopModeRef.current;

            if (prevBar === null) {
              setCurrentBar(nextBar);
              setBarStats({ wrong: 0, timingOff: 0 });
              setCleanPasses(0);
            } else if (nextBar !== prevBar) {
              const wasClean = prevBarStats.wrong === 0 && prevBarStats.timingOff === 0;
              if (isLooping) {
                const nextClean = wasClean ? prevCleanPasses + 1 : 0;
                if (nextClean >= 3) {
                  setCleanPasses(0);
                  setCurrentBar(nextBar);
                  setBarStats({ wrong: 0, timingOff: 0 });
                } else {
                  setCleanPasses(nextClean);
                  setBarStats({ wrong: 0, timingOff: 0 });
                  handleReplayLastBar(1);
                }
              } else {
                setCurrentBar(nextBar);
                setBarStats({ wrong: 0, timingOff: 0 });
                setCleanPasses(0);
              }
            }
          }
        } else if (event.type === "exercise_complete") {
          setExerciseComplete(true);
          setFeedback(`${event.data.message} - ${event.data.correct}/${event.data.total} correct!`);
          metronome.stop();
          soundCuesRef.current.playComplete();
          // Mark all remaining pending notes as missed
          setFallingNotes((prev) =>
            prev.map((fn) =>
              fn.status === "pending" || fn.status === "active"
                ? { ...fn, status: "missed" as const }
                : fn,
            ),
          );
        } else if (event.type === "exercise_restarted") {
          setFeedback(`${event.data.message}`);
          setNextExpectedNotes(event.data.next_expected_notes || []);
          setCurrentPosition(0);
          setBarStats({ wrong: 0, timingOff: 0 });
        } else if (event.type === "tempo_change") {
          const newBpm = event.data.bpm;
          const multiplier = event.data.tempo_multiplier;
          if (typeof newBpm === "number") {
            setCurrentBpm(newBpm);
            if (metronome.enabled) metronome.updateTempo(newBpm);
          }
          if (typeof multiplier === "number") setTempoMultiplier(multiplier);
        }
      });

      wsClientRef.current = wsClient;
      setWsConnected(true);

      wsClient.send({
        type: "start_exercise",
        data: { exercise: selectedExercise.id, hands: handsMode },
      });

      const audioCapture = new AudioCapture();
      await audioCapture.start((samples) => {
        if (wsClient) wsClient.sendAudioChunk(samples);
      });

      audioCaptureRef.current = audioCapture;
      setIsRecording(true);
    } catch (error) {
      console.error("Failed to start exercise:", error);
      setFeedback("Failed to start exercise");
    }
  };

  const handleStopExercise = () => {
    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }
    if (wsClientRef.current) {
      wsClientRef.current.send({ type: "stop_exercise", data: {} });
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }
    metronome.stop();
    setIsRecording(false);
    setWsConnected(false);
    setExerciseStartTime(0);
    setCurrentTimeMs(0);
    setFeedback("Exercise stopped");
  };

  const handleBackToMenu = () => {
    handleStopExercise();
    setExerciseComplete(false);
    setFallingNotes([]);
  };

  const handleReplayExercise = () => {
    setExerciseComplete(false);
    handleStopExercise();
    // Re-trigger start after a small delay
    setTimeout(() => handleStartExercise(), 200);
  };

  const handleReplayLastBar = (bars: number) => {
    if (!wsClientRef.current) return;
    wsClientRef.current.send({ type: "replay_last_bar", data: { bars } });
  };

  const displayBpm = currentBpm || exerciseMeta.bpm;

  return (
    <div
      className={`h-screen overflow-hidden transition-colors duration-500 ${
        isRecording
          ? "bg-slate-950 text-white"
          : "bg-gradient-to-b from-slate-50 to-white text-slate-900"
      }`}
    >
      {/* Count-in overlay */}
      {countIn.counting && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
          <div className="text-white text-[10rem] leading-none font-bold font-mono animate-pulse drop-shadow-[0_0_60px_rgba(16,185,129,0.4)]">
            {countIn.countLabel}
          </div>
        </div>
      )}

      {/* Completion overlay */}
      {exerciseComplete && (
        <CompletionOverlay
          correct={progress.correct}
          total={progress.total}
          timingStats={timingStats}
          onReplay={handleReplayExercise}
          onBackToMenu={handleBackToMenu}
        />
      )}

      {/* ═══ EXERCISE SELECTION ═══ */}
      {!isRecording && !countIn.counting && (
        <div className="h-full overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-12">
          <div className="text-center mb-10 animate-fade-up">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-slate-900 mb-2">
              Practice
            </h1>
            <p className="text-base text-slate-500">Choose a piece to begin</p>
          </div>

          {selectedExercise && (
            <div className="rounded-3xl p-6 md:p-8 mb-8 bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-[0_20px_50px_rgba(16,185,129,0.35)] animate-fade-up">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-emerald-100 mb-1">
                    Next up
                  </p>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    {selectedExercise.name}
                  </h2>
                  <p className="text-sm text-emerald-100 mt-1">
                    {selectedExercise.description}
                  </p>
                </div>
                <span
                  className={`text-xs px-3 py-1 rounded-full font-medium backdrop-blur-sm ${
                    selectedExercise.difficulty === "beginner"
                      ? "bg-white/20"
                      : selectedExercise.difficulty === "intermediate"
                        ? "bg-amber-400/30"
                        : "bg-red-400/30"
                  }`}
                >
                  {selectedExercise.difficulty}
                </span>
              </div>

              <div className="space-y-3 mt-5 pt-5 border-t border-white/20">
                {selectedExercise.type === "beat_score" && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase tracking-widest text-emerald-100 mr-2">
                      Hands
                    </span>
                    {(["both", "right", "left"] as const).map((h) => (
                      <button
                        key={h}
                        onClick={() => setHandsMode(h)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                          handsMode === h
                            ? "bg-white text-emerald-700 shadow-md"
                            : "bg-white/15 text-white hover:bg-white/25"
                        }`}
                      >
                        {h === "both" ? "Both" : h === "right" ? "Right" : "Left"}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-emerald-100">
                    Metronome
                  </span>
                  <button
                    onClick={() => metronome.setEnabled(!metronome.enabled)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                      metronome.enabled ? "bg-white" : "bg-white/30"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 w-5 h-5 rounded-full shadow-sm transition-all duration-200 ${
                        metronome.enabled
                          ? "translate-x-5 bg-emerald-600"
                          : "translate-x-0.5 bg-white"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <button
                onClick={handleStartExercise}
                disabled={selectedExercise.available === false}
                className={`w-full mt-6 py-4 rounded-2xl text-lg font-bold transition-all duration-200 ${
                  selectedExercise.available === false
                    ? "bg-white/20 text-white/50 cursor-not-allowed"
                    : "bg-white text-emerald-700 hover:bg-emerald-50 active:scale-[0.98] shadow-lg hover:shadow-xl"
                }`}
              >
                Start Practice
              </button>
            </div>
          )}

          <p className="text-xs uppercase tracking-widest text-slate-400 mb-4 px-1">
            {selectedExercise ? "Or choose another" : "Select a piece"}
          </p>

          <div className="space-y-3 mb-8">
            {exercises.map((ex, i) => (
              <button
                key={ex.id}
                onClick={() => setSelectedExercise(ex)}
                disabled={ex.available === false}
                style={{ animationDelay: `${i * 60}ms` }}
                className={`animate-fade-up w-full text-left p-5 rounded-2xl transition-all duration-200 ease-out ${
                  selectedExercise?.id === ex.id
                    ? "bg-white ring-2 ring-emerald-400 shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
                    : ex.available === false
                      ? "bg-slate-100 text-slate-400 cursor-not-allowed opacity-60"
                      : "bg-white/90 ring-1 ring-black/5 shadow-[0_4px_20px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(15,23,42,0.1)] active:scale-[0.99]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-base text-slate-900">{ex.name}</div>
                    <div className="text-sm text-slate-500 mt-0.5">{ex.description}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    {ex.requiresPolyphony && (
                      <span className="text-[10px] uppercase tracking-wider bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium ring-1 ring-purple-100">
                        Chords
                      </span>
                    )}
                    {ex.type === "beat_score" && (
                      <span className="text-[10px] uppercase tracking-wider bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium ring-1 ring-blue-100">
                        Score
                      </span>
                    )}
                    <span
                      className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ring-1 ${
                        ex.difficulty === "beginner"
                          ? "bg-emerald-50 text-emerald-600 ring-emerald-100"
                          : ex.difficulty === "intermediate"
                            ? "bg-amber-50 text-amber-600 ring-amber-100"
                            : "bg-red-50 text-red-600 ring-red-100"
                      }`}
                    >
                      {ex.difficulty}
                    </span>
                  </div>
                </div>
                {ex.notes && ex.notes.length > 0 && (
                  <div className="text-xs text-slate-400 mt-2 font-mono tracking-wide">
                    {ex.notes.join(" → ")}
                  </div>
                )}
                {ex.available === false && (
                  <div className="text-xs text-red-400 mt-1.5">MIDI file not found</div>
                )}
              </button>
            ))}
          </div>

          <div className="text-center">
            <p className="inline-flex items-center gap-2 text-xs text-slate-400 bg-slate-100 px-4 py-2 rounded-full ring-1 ring-slate-200/50">
              Notes fall toward the keyboard. Play them as they reach the line.
            </p>
          </div>
        </div>
        </div>
      )}

      {/* ═══ ACTIVE PRACTICE (waterfall layout) ═══ */}
      {isRecording && (
        <div className="h-screen flex flex-col overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-slate-800 flex-shrink-0">
            <div
              className="h-full bg-emerald-400 transition-all duration-500 shadow-[0_0_12px_rgba(52,211,153,0.5)]"
              style={{ width: `${progress.completion_percent}%` }}
            />
          </div>

          {/* Top bar */}
          <div className="flex items-center justify-between px-5 py-2.5 bg-slate-900/80 backdrop-blur-md flex-shrink-0 border-b border-white/5">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={handleStopExercise}
                className="rounded-full bg-red-500/15 text-red-400 hover:bg-red-500/25 px-3.5 py-1.5 text-xs font-medium transition-all duration-200 ring-1 ring-red-500/20"
              >
                Stop
              </button>
              <h2 className="font-semibold text-white text-sm tracking-tight truncate max-w-[220px]">
                {selectedExercise?.name}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800/70 px-3 py-1 text-xs ring-1 ring-white/10">
                <span className="text-emerald-400 font-mono font-medium">
                  {progress.correct}/{progress.total}
                </span>
              </span>
              {displayBpm && (
                <span className="inline-flex items-center rounded-full bg-slate-800/70 px-2.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-white/10">
                  {Math.round(displayBpm)} BPM
                  {tempoMultiplier < 1.0 && (
                    <span className="text-amber-400 ml-1">
                      ({Math.round(tempoMultiplier * 100)}%)
                    </span>
                  )}
                </span>
              )}
              {exerciseMeta.timeSignature && (
                <span className="hidden sm:inline-flex items-center rounded-full bg-slate-800/70 px-2.5 py-0.5 text-[10px] text-slate-400 ring-1 ring-white/10">
                  {exerciseMeta.timeSignature}
                </span>
              )}
            </div>
          </div>

          {/* Auto-sync status indicator */}
          {autoSyncMode && (
            <div className="absolute top-16 right-4 z-20">
              <SyncStatusIndicator
                mode={autoSyncState.mode}
                position={autoSyncState.position}
                totalNotes={fallingNotes.length}
                confidence={autoSyncState.confidence}
                expectedNote={autoSyncState.expectedNext}
                consecutiveErrors={autoSyncState.consecutiveErrors}
                accuracy={
                  autoSyncState.totalCorrect + autoSyncState.totalWrong > 0
                    ? (autoSyncState.totalCorrect /
                        (autoSyncState.totalCorrect + autoSyncState.totalWrong)) *
                      100
                    : 0
                }
              />
            </div>
          )}

          {/* Visualization area (falling notes or rail) */}
          {displayMode === "falling" ? (
            <FallingNotes
              notes={fallingNotes}
              currentTimeMs={currentTimeMs}
              isActive={isRecording && exerciseStartTime > 0}
              startOctave={octaveRange.start}
              endOctave={octaveRange.end}
              bpm={displayBpm || 0}
              beatsPerBar={exerciseMeta.beatsPerBar || 4}
              feedbackText={feedback}
              feedbackType={lastResult}
            />
          ) : (
            <NoteRail
              notes={fallingNotes}
              currentTimeMs={currentTimeMs}
              isActive={isRecording && exerciseStartTime > 0}
              startOctave={octaveRange.start}
              endOctave={octaveRange.end}
              bpm={displayBpm || 0}
              beatsPerBar={exerciseMeta.beatsPerBar || 4}
              feedbackText={feedback}
              feedbackType={lastResult}
            />
          )}

          {/* Piano keyboard tray */}
          <div className="flex-shrink-0 bg-slate-800/80 ring-1 ring-white/5 shadow-[0_-10px_30px_rgba(0,0,0,0.4)] px-3 pt-3 pb-1">
            <PianoKeyboard
              detectedNotes={detectedNotes}
              expectedNotes={nextExpectedNotes}
              tentativeNotes={tentativeNotes}
              showLabels={true}
              startOctave={octaveRange.start}
              endOctave={octaveRange.end}
            />
          </div>

          {/* Minimal toolbar */}
          <div className="flex-shrink-0 bg-slate-900/90 backdrop-blur-sm px-5 py-2 flex items-center justify-center gap-2.5 flex-wrap">
            {/* Display mode toggle */}
            <DisplayModeToggle mode={displayMode} onChange={setDisplayMode} />

            {/* Metronome */}
            <button
              onClick={() => {
                metronome.setEnabled((prev: boolean) => {
                  if (!prev && exerciseMeta.bpm) {
                    metronome.start(
                      currentBpm || exerciseMeta.bpm,
                      exerciseMeta.beatsPerBar || 2,
                      exerciseMeta.beatUnit || 1,
                    );
                  } else {
                    metronome.stop();
                  }
                  return !prev;
                });
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
                metronome.enabled
                  ? "bg-purple-500/20 text-purple-300"
                  : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
              }`}
            >
              Metro {metronome.enabled ? "ON" : "OFF"}
            </button>

            {/* Loop */}
            <button
              onClick={() => setLoopMode((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
                loopMode
                  ? "bg-blue-500/20 text-blue-300"
                  : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
              }`}
            >
              {loopMode ? `Loop (${cleanPasses}/3)` : "Loop"}
            </button>

            {/* Wait mode - training: pause until correct note played */}
            <button
              onClick={() => setWaitMode((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
                waitMode
                  ? "bg-green-500/20 text-green-300"
                  : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
              }`}
              title="Training mode: pauses until you play the correct note"
            >
              {waitMode ? (waitingForNote ? `Wait: ${waitingForNote}` : "Wait ON") : "Wait"}
            </button>

            {/* Auto-sync mode - pattern-based position detection */}
            <button
              onClick={() => setAutoSyncMode((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
                autoSyncMode
                  ? "bg-cyan-500/20 text-cyan-300"
                  : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
              }`}
              title="Auto-sync: detects position from note sequence (no timing required)"
            >
              {autoSyncMode
                ? autoSyncState.mode === "locked"
                  ? `Sync: ${autoSyncState.position + 1}/${fallingNotes.length}`
                  : autoSyncState.mode === "syncing"
                  ? "Syncing..."
                  : "Re-sync..."
                : "Auto-Sync"}
            </button>

            {/* Client-side detection mode (low latency YIN) */}
            <ClientModeToggle
              enabled={clientMode}
              onChange={setClientMode}
            />

            {/* Polyphony mode - disable client detection for complex songs */}
            {clientMode && (
              <button
                onClick={() => setPolyphonyMode((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
                  polyphonyMode
                    ? "bg-orange-500/20 text-orange-300"
                    : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
                }`}
                title="Disable client detection for polyphonic/chord songs (use server-side)"
              >
                {polyphonyMode ? "Poly ON" : "Poly"}
              </button>
            )}

            {/* Auto-play demo mode */}
            <AutoPlayDemo
              notes={fallingNotes}
              currentTimeMs={currentTimeMs}
              isActive={isRecording && exerciseStartTime > 0}
              waitingForNote={
                autoSyncMode && autoSyncState.mode === "locked"
                  ? autoSyncState.expectedNext
                  : waitingForNote
              }
            />

            {/* Tempo slider */}
            {exerciseMeta.bpm && (
              <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/70 px-3 py-1.5 ring-1 ring-white/10">
                <span className="text-[10px] text-slate-500">Tempo</span>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={Math.round(tempoMultiplier * 100)}
                  onChange={(e) => {
                    const mult = Number(e.target.value) / 100;
                    setTempoMultiplier(mult);
                    const newBpm = exerciseMeta.bpm! * mult;
                    setCurrentBpm(newBpm);
                    if (metronome.enabled) metronome.updateTempo(newBpm);
                    wsClientRef.current?.send({
                      type: "set_tempo_multiplier",
                      data: { multiplier: mult },
                    });
                  }}
                  className="w-16 h-1 accent-emerald-400"
                />
                <span className="text-[10px] text-slate-500 font-mono w-7">
                  {Math.round(tempoMultiplier * 100)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
