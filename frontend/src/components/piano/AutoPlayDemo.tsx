"use client";

import React, { useRef, useCallback, useEffect, useState } from "react";
import { FallingNote } from "./FallingNotes";

interface AutoPlayDemoProps {
  /** All notes to play */
  notes: FallingNote[];
  /** Current time in ms from exercise start */
  currentTimeMs: number;
  /** Is the exercise actively running */
  isActive: boolean;
  /** Callback when demo mode changes */
  onDemoModeChange?: (active: boolean) => void;
  /** Note we're waiting for in wait mode (hint to user) */
  waitingForNote?: string | null;
  /** Is wait mode enabled (pauses until correct note played) */
  waitModeEnabled?: boolean;
}

// Piano note frequencies (A4 = 440Hz)
function noteToFrequency(noteName: string): number {
  const NOTE_SEMITONES: Record<string, number> = {
    'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5,
    'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11,
  };

  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 440;

  const [, name, octStr] = match;
  const octave = parseInt(octStr, 10);
  const semitone = NOTE_SEMITONES[name] ?? 0;

  // MIDI note number (A4 = 69)
  const midiNote = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

export default function AutoPlayDemo({
  notes,
  currentTimeMs,
  isActive,
  onDemoModeChange,
  waitingForNote,
  waitModeEnabled = false,
}: AutoPlayDemoProps) {
  const [demoActive, setDemoActive] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playedIndicesRef = useRef<Set<number>>(new Set());
  const gainNodeRef = useRef<GainNode | null>(null);

  // Initialize audio context
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      gainNodeRef.current = audioCtxRef.current.createGain();
      gainNodeRef.current.gain.value = 0.5; // Volume (louder for mic pickup)
      gainNodeRef.current.connect(audioCtxRef.current.destination);
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Play a single piano note
  // Uses pure sine wave for strong fundamental - harmonics were causing detection issues
  // when played through speakers (speaker/mic path emphasizes upper harmonics)
  const playNote = useCallback((noteName: string, duration: number = 0.6) => {
    const ctx = getAudioContext();
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const freq = noteToFrequency(noteName);
    const now = ctx.currentTime;

    // Pure sine wave for strong fundamental (best for YIN detection through speakers)
    const osc1 = ctx.createOscillator();
    const noteGain = ctx.createGain();

    osc1.type = "sine";  // Pure sine = strongest fundamental, no harmonics
    osc1.frequency.value = freq;

    // Optional: very subtle 2nd harmonic for warmth (1/n^2 rolloff = 0.25)
    const osc2 = ctx.createOscillator();
    const osc2Gain = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2;
    osc2Gain.gain.value = 0.1;  // Reduced from 0.3 to 0.1 (steep rolloff)

    osc1.connect(noteGain);
    osc2.connect(osc2Gain);
    osc2Gain.connect(noteGain);
    noteGain.connect(gain);

    // ADSR envelope
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(0.8, now + 0.01); // Attack
    noteGain.gain.linearRampToValueAtTime(0.6, now + 0.1);  // Decay
    noteGain.gain.linearRampToValueAtTime(0.4, now + duration * 0.7); // Sustain
    noteGain.gain.linearRampToValueAtTime(0, now + duration); // Release

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
  }, [getAudioContext]);

  // Auto-play notes as they become due (only when wait mode is OFF)
  useEffect(() => {
    if (!demoActive || !isActive || notes.length === 0) return;

    // In wait mode, don't auto-advance at all - we'll play via the waitingForNote system
    // This keeps audio in sync with the paused visual position
    if (waitModeEnabled) return;

    // Without wait mode: play slightly early to compensate for YIN detection latency (~100-200ms)
    const PLAY_EARLY_MS = 150; // Reduced from 350ms - client YIN is faster than server

    // Minimum delay before first note - give YIN time to initialize and start capturing
    // This prevents first notes from being missed due to audio setup latency
    const MIN_STARTUP_DELAY_MS = 500;

    // Find notes that should be played now
    const notesToPlay = notes.filter((note, idx) => {
      if (playedIndicesRef.current.has(idx)) return false;
      // Don't play any notes until MIN_STARTUP_DELAY_MS has passed
      if (currentTimeMs < MIN_STARTUP_DELAY_MS) return false;
      const playTime = note.expectedTimeMs - PLAY_EARLY_MS;
      // Window: from playTime until expectedTime + 300ms
      return currentTimeMs >= playTime && currentTimeMs < note.expectedTimeMs + 300;
    });

    notesToPlay.forEach((note, i) => {
      const idx = notes.indexOf(note);
      if (idx >= 0 && !playedIndicesRef.current.has(idx)) {
        playedIndicesRef.current.add(idx);
        console.log(`[DEMO] Playing ${note.note} | expected=${note.expectedTimeMs.toFixed(0)}ms | current=${currentTimeMs.toFixed(0)}ms | index=${idx}`);
        // Stagger chord notes slightly
        setTimeout(() => playNote(note.note), i * 15);
      }
    });
  }, [demoActive, isActive, notes, currentTimeMs, playNote, waitModeEnabled]);

  // Reset played notes when exercise restarts
  useEffect(() => {
    if (!isActive) {
      playedIndicesRef.current.clear();
    }
  }, [isActive]);

  // In wait mode, play the expected note - immediately on first wait, then every 1.5s
  const lastWaitHintRef = useRef<number>(0);
  const lastWaitNoteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!demoActive || !isActive || !waitingForNote) {
      lastWaitNoteRef.current = null;
      return;
    }

    const now = Date.now();
    // Play immediately if this is a new note we're waiting for
    const isNewNote = waitingForNote !== lastWaitNoteRef.current;
    // Or play every 1.5 seconds as a reminder hint
    const shouldRepeat = now - lastWaitHintRef.current > 1500;

    if (isNewNote || shouldRepeat) {
      lastWaitHintRef.current = now;
      lastWaitNoteRef.current = waitingForNote;
      console.log(`[DEMO-WAIT] Playing ${waitingForNote} (${isNewNote ? 'new' : 'repeat'})`);
      playNote(waitingForNote, 0.5);
    }
  }, [demoActive, isActive, waitingForNote, playNote, currentTimeMs]);

  // Toggle demo mode
  const toggleDemo = useCallback(() => {
    const newState = !demoActive;
    setDemoActive(newState);
    playedIndicesRef.current.clear();
    onDemoModeChange?.(newState);

    // Initialize audio context on user interaction
    if (newState) {
      getAudioContext();
    }
  }, [demoActive, getAudioContext, onDemoModeChange]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return (
    <button
      onClick={toggleDemo}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
        demoActive
          ? "bg-amber-500/20 text-amber-300 animate-pulse"
          : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
      }`}
      title="Auto-play notes through speakers for demo/testing"
    >
      {demoActive ? "Demo ON" : "Demo"}
    </button>
  );
}
