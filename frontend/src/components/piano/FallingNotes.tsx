"use client";

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { getNoteXPosition, getWhiteKeys, generatePianoKeys } from "@/lib/pianoKeys";
import { Octave } from "@/types/piano";

export interface FallingNote {
  /** Note name like "C4", "F#5" */
  note: string;
  /** Which hand: "right" | "left" | null */
  hand: string | null;
  /** Bar number (for bar lines) */
  bar: number;
  /** Index in the exercise sequence */
  index: number;
  /** Computed: absolute time in ms when this note should be played */
  expectedTimeMs: number;
  /** Status: pending, active, hit, missed */
  status: "pending" | "active" | "hit" | "missed";
  /** Finger number 1-5 (1=thumb, 5=pinky) */
  finger?: number;
}

interface FallingNotesProps {
  /** All notes in the exercise with timing info */
  notes: FallingNote[];
  /** Current playback time in ms (from performance.now offset) */
  currentTimeMs: number;
  /** Is the exercise actively playing */
  isActive: boolean;
  /** Piano keyboard config to align X positions */
  startOctave: Octave;
  endOctave: Octave;
  /** BPM for computing bar line positions */
  bpm: number;
  /** Beats per bar */
  beatsPerBar: number;
  /** Floating feedback text */
  feedbackText?: string;
  /** Feedback type for coloring */
  feedbackType?: "correct" | "wrong" | null;
}

/** Pixels per millisecond — controls fall speed */
const PX_PER_MS = 0.25;
/** How far ahead/behind (in ms) to render notes */
const WINDOW_AHEAD_MS = 5000;
const WINDOW_BEHIND_MS = 2000;
/** Note rectangle height */
const NOTE_HEIGHT = 28;
/** Play-line offset from bottom */
const PLAYLINE_BOTTOM = 40;

export default function FallingNotes({
  notes,
  currentTimeMs,
  isActive,
  startOctave,
  endOctave,
  bpm,
  beatsPerBar,
  feedbackText,
  feedbackType,
}: FallingNotesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const currentTimeMsRef = useRef(currentTimeMs);
  const notesRef = useRef(notes);

  // Keep refs in sync
  useEffect(() => { currentTimeMsRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Compute keyboard metrics once
  const keyboardMetrics = useMemo(() => {
    const keys = generatePianoKeys(startOctave, endOctave);
    const whiteKeys = getWhiteKeys(keys);
    return { whiteKeyCount: whiteKeys.length };
  }, [startOctave, endOctave]);

  // Bar line positions (time in ms for each bar boundary)
  const barDurationMs = useMemo(() => {
    if (bpm <= 0) return 0;
    return beatsPerBar * (60000 / bpm);
  }, [bpm, beatsPerBar]);

  // Canvas-based rendering for performance
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    // Resize canvas if needed
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const playLineY = height - PLAYLINE_BOTTOM;
    const t = currentTimeMsRef.current;
    const whiteKeyWidth = width / keyboardMetrics.whiteKeyCount;
    const blackKeyWidth = whiteKeyWidth * 0.65;

    // Draw bar lines
    if (barDurationMs > 0) {
      const firstBarTime = Math.floor((t - WINDOW_BEHIND_MS) / barDurationMs) * barDurationMs;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      for (let barTime = firstBarTime; barTime < t + WINDOW_AHEAD_MS; barTime += barDurationMs) {
        const y = playLineY - (barTime - t) * PX_PER_MS;
        if (y < -10 || y > height + 10) continue;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw play-line
    ctx.save();
    ctx.shadowColor = "rgba(59, 130, 246, 0.6)";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, playLineY);
    ctx.lineTo(width, playLineY);
    ctx.stroke();
    ctx.restore();

    // Draw notes
    const currentNotes = notesRef.current;
    for (let i = 0; i < currentNotes.length; i++) {
      const note = currentNotes[i];
      const timeDelta = note.expectedTimeMs - t;

      // Culling: skip notes outside visible window
      if (timeDelta > WINDOW_AHEAD_MS || timeDelta < -WINDOW_BEHIND_MS) continue;

      const pos = getNoteXPosition(note.note, startOctave, whiteKeyWidth, blackKeyWidth);
      if (!pos) continue;

      const noteY = playLineY - timeDelta * PX_PER_MS - NOTE_HEIGHT / 2;

      // Color by status and hand
      let fillColor: string;
      let glowColor: string | null = null;
      switch (note.status) {
        case "hit":
          fillColor = "rgba(16, 185, 129, 0.85)"; // emerald
          break;
        case "missed":
          fillColor = "rgba(239, 68, 68, 0.6)"; // red
          break;
        case "active":
          fillColor = note.hand === "left"
            ? "rgba(251, 146, 60, 0.9)" // orange for left
            : "rgba(59, 130, 246, 0.9)"; // blue for right
          glowColor = note.hand === "left"
            ? "rgba(251, 146, 60, 0.5)"
            : "rgba(59, 130, 246, 0.5)";
          break;
        default: // pending
          fillColor = note.hand === "left"
            ? "rgba(251, 146, 60, 0.35)"
            : "rgba(147, 197, 253, 0.35)";
      }

      // Draw glow for active notes
      if (glowColor) {
        ctx.save();
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 16;
        ctx.fillStyle = fillColor;
        roundRect(ctx, pos.x - pos.width / 2, noteY, pos.width, NOTE_HEIGHT, 6);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = fillColor;
        roundRect(ctx, pos.x - pos.width / 2, noteY, pos.width, NOTE_HEIGHT, 6);
        ctx.fill();
      }

      // Note label and finger number
      if (note.status === "active" || note.status === "pending") {
        const showFinger = note.finger && note.finger >= 1 && note.finger <= 5;
        const isActive = note.status === "active";

        // Draw finger number circle for pending/active notes with finger data
        if (showFinger) {
          const circleRadius = 9;
          const circleY = noteY + NOTE_HEIGHT / 2;

          // Finger circle background
          ctx.beginPath();
          ctx.arc(pos.x, circleY, circleRadius, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.5)";
          ctx.fill();

          // Finger number
          ctx.fillStyle = isActive
            ? (note.hand === "left" ? "#ea580c" : "#2563eb")
            : "#64748b";
          ctx.font = "bold 11px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(note.finger), pos.x, circleY);
        } else if (isActive) {
          // Fallback: show note name if no finger data
          ctx.fillStyle = "white";
          ctx.font = "bold 10px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(note.note, pos.x, noteY + NOTE_HEIGHT / 2);
        }
      }
    }
  }, [startOctave, keyboardMetrics.whiteKeyCount, barDurationMs]);

  // Animation loop
  useEffect(() => {
    if (!isActive) {
      // Render once even when not active (for initial state)
      render();
      return;
    }

    const loop = () => {
      render();
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isActive, render]);

  // Re-render when notes change (status updates)
  useEffect(() => {
    render();
  }, [notes, currentTimeMs, render]);

  // Handle window resize - re-render to update canvas dimensions
  useEffect(() => {
    const handleResize = () => {
      render();
    };
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [render]);

  return (
    <div ref={containerRef} className="relative flex-1 w-full min-h-0 overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Floating feedback text */}
      {feedbackText && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-16 text-lg font-semibold pointer-events-none transition-all duration-300 animate-feedback-float ${
            feedbackType === "correct"
              ? "text-emerald-400"
              : feedbackType === "wrong"
                ? "text-red-400"
                : "text-slate-400"
          }`}
        >
          {feedbackText}
        </div>
      )}
    </div>
  );
}

/** Helper: draw a rounded rectangle path */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
