"use client";

import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { getNoteYPosition, generatePianoKeys, getWhiteKeys } from "@/lib/pianoKeys";
import { Octave } from "@/types/piano";
import { FallingNote } from "./FallingNotes";

interface NoteRailProps {
  /** All notes in the exercise with timing info */
  notes: FallingNote[];
  /** Current playback time in ms (from performance.now offset) */
  currentTimeMs: number;
  /** Is the exercise actively playing */
  isActive: boolean;
  /** Piano keyboard config to align positions */
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

/** Pixels per millisecond — controls scroll speed */
const PX_PER_MS = 0.25;
/** How far ahead/behind (in ms) to render notes */
const WINDOW_AHEAD_MS = 5000;
const WINDOW_BEHIND_MS = 2000;
/** Note rectangle width (in time direction) */
const NOTE_WIDTH = 28;
/** Note height (pitch direction) */
const NOTE_HEIGHT = 18;
/** Play-line offset from left edge */
const PLAYLINE_LEFT = 80;
/** Padding for pitch range */
const PITCH_PADDING_TOP = 30;
const PITCH_PADDING_BOTTOM = 30;

export default function NoteRail({
  notes,
  currentTimeMs,
  isActive,
  startOctave,
  endOctave,
  bpm,
  beatsPerBar,
  feedbackText,
  feedbackType,
}: NoteRailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const currentTimeMsRef = useRef(currentTimeMs);
  const notesRef = useRef(notes);

  // Keep refs in sync
  useEffect(() => { currentTimeMsRef.current = currentTimeMs; }, [currentTimeMs]);
  useEffect(() => { notesRef.current = notes; }, [notes]);

  // Bar line duration
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

    const playLineX = PLAYLINE_LEFT;
    const t = currentTimeMsRef.current;

    // Draw bar lines (vertical in rail mode)
    if (barDurationMs > 0) {
      const firstBarTime = Math.floor((t - WINDOW_BEHIND_MS) / barDurationMs) * barDurationMs;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      for (let barTime = firstBarTime; barTime < t + WINDOW_AHEAD_MS; barTime += barDurationMs) {
        const x = playLineX + (barTime - t) * PX_PER_MS;
        if (x < -10 || x > width + 10) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }

    // Draw pitch reference lines (staff-like)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.lineWidth = 1;
    const staffNotes = ["C3", "E3", "G3", "B3", "D4", "F4", "A4", "C5", "E5", "G5", "B5", "D6"];
    for (const refNote of staffNotes) {
      const y = getNoteYPosition(refNote, startOctave, endOctave, height, PITCH_PADDING_TOP, PITCH_PADDING_BOTTOM);
      if (y !== null && y > 0 && y < height) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw play-line (vertical)
    ctx.save();
    ctx.shadowColor = "rgba(59, 130, 246, 0.6)";
    ctx.shadowBlur = 12;
    ctx.strokeStyle = "rgba(59, 130, 246, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playLineX, 0);
    ctx.lineTo(playLineX, height);
    ctx.stroke();
    ctx.restore();

    // Draw notes
    const currentNotes = notesRef.current;
    for (let i = 0; i < currentNotes.length; i++) {
      const note = currentNotes[i];
      const timeDelta = note.expectedTimeMs - t;

      // Culling: skip notes outside visible window
      if (timeDelta > WINDOW_AHEAD_MS || timeDelta < -WINDOW_BEHIND_MS) continue;

      const noteY = getNoteYPosition(note.note, startOctave, endOctave, height, PITCH_PADDING_TOP, PITCH_PADDING_BOTTOM);
      if (noteY === null) continue;

      // X position based on time delta (future notes to the right)
      const noteX = playLineX + timeDelta * PX_PER_MS - NOTE_WIDTH / 2;

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
        roundRect(ctx, noteX, noteY - NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 4);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = fillColor;
        roundRect(ctx, noteX, noteY - NOTE_HEIGHT / 2, NOTE_WIDTH, NOTE_HEIGHT, 4);
        ctx.fill();
      }

      // Note label and finger number
      if (note.status === "active" || note.status === "pending") {
        const showFinger = note.finger && note.finger >= 1 && note.finger <= 5;
        const isActive = note.status === "active";

        // Draw finger number for pending/active notes with finger data
        if (showFinger) {
          const circleRadius = 7;
          const circleX = noteX + NOTE_WIDTH / 2;

          // Finger circle background
          ctx.beginPath();
          ctx.arc(circleX, noteY, circleRadius, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.4)";
          ctx.fill();

          // Finger number
          ctx.fillStyle = isActive
            ? (note.hand === "left" ? "#ea580c" : "#2563eb")
            : "#64748b";
          ctx.font = "bold 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(note.finger), circleX, noteY);
        } else if (isActive) {
          // Fallback: show note name if no finger data
          ctx.fillStyle = "white";
          ctx.font = "bold 9px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(note.note, noteX + NOTE_WIDTH / 2, noteY);
        }
      }
    }

    // Draw pitch labels on left edge
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelNotes = ["C3", "C4", "C5", "C6"];
    for (const label of labelNotes) {
      const y = getNoteYPosition(label, startOctave, endOctave, height, PITCH_PADDING_TOP, PITCH_PADDING_BOTTOM);
      if (y !== null && y > 10 && y < height - 10) {
        ctx.fillText(label, 35, y);
      }
    }
  }, [startOctave, endOctave, barDurationMs]);

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
