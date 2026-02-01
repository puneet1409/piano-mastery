"use client";

import React, { useRef, useEffect, useMemo } from "react";
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental } from "vexflow";
import { FallingNote } from "./FallingNotes";

interface SheetMusicProps {
  notes: FallingNote[];
  currentTimeMs: number;
  isActive: boolean;
  bpm: number;
  beatsPerBar: number;
  feedbackText?: string;
  feedbackType?: "correct" | "wrong" | null;
}

// Convert note name to VexFlow format
function toVexFlowNote(noteName: string): { key: string; accidental?: string } {
  // Input: "C4", "F#5", "Bb3"
  // Output: { key: "c/4", accidental: "#" }
  const match = noteName.match(/^([A-G])(#|b)?(\d+)$/);
  if (!match) return { key: "c/4" };

  const [, letter, acc, octave] = match;
  return {
    key: `${letter.toLowerCase()}/${octave}`,
    accidental: acc || undefined,
  };
}

// Get duration string for VexFlow based on note duration
function getVexDuration(durationMs: number | undefined, beatDurationMs: number): string {
  if (!durationMs) return "q"; // quarter note default

  const beats = durationMs / beatDurationMs;
  if (beats >= 3.5) return "w";      // whole
  if (beats >= 1.75) return "h";     // half
  if (beats >= 0.875) return "q";    // quarter
  if (beats >= 0.4375) return "8";   // eighth
  return "16";                        // sixteenth
}

// Color based on status
function getColor(status: FallingNote["status"], hand: string | null): string {
  switch (status) {
    case "hit": return "#10b981";      // emerald
    case "missed": return "#ef4444";   // red
    case "active": return hand === "left" ? "#fb923c" : "#3b82f6"; // orange/blue
    default: return "#94a3b8";         // slate for pending
  }
}

export default function SheetMusic({
  notes,
  currentTimeMs,
  isActive,
  bpm,
  beatsPerBar,
  feedbackText,
  feedbackType,
}: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const beatDurationMs = useMemo(() => bpm > 0 ? 60000 / bpm : 500, [bpm]);

  // Group notes by bar
  const bars = useMemo(() => {
    const barMap = new Map<number, FallingNote[]>();
    notes.forEach(note => {
      const bar = note.bar;
      if (!barMap.has(bar)) barMap.set(bar, []);
      barMap.get(bar)!.push(note);
    });
    return Array.from(barMap.entries()).sort((a, b) => a[0] - b[0]);
  }, [notes]);

  // Find current bar based on time
  const currentBar = useMemo(() => {
    if (!isActive || notes.length === 0) return 0;
    const barDurationMs = beatsPerBar * beatDurationMs;
    return Math.floor(currentTimeMs / barDurationMs);
  }, [currentTimeMs, beatsPerBar, beatDurationMs, isActive, notes.length]);

  useEffect(() => {
    if (!containerRef.current || bars.length === 0) return;

    const container = containerRef.current;
    container.innerHTML = ""; // Clear previous render

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Create renderer
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, height);
    rendererRef.current = renderer;

    const context = renderer.getContext();
    context.setFont("Arial", 10);

    // Calculate layout
    const staveWidth = Math.min(250, (width - 60) / Math.min(bars.length, 4));
    const stavesPerRow = Math.floor((width - 40) / staveWidth);
    const rowHeight = 120;

    // Determine which bars to show (window around current bar)
    const visibleBars = bars.slice(
      Math.max(0, currentBar - 1),
      Math.min(bars.length, currentBar + stavesPerRow + 1)
    );

    visibleBars.forEach(([barNum, barNotes], idx) => {
      const row = Math.floor(idx / stavesPerRow);
      const col = idx % stavesPerRow;
      const x = 20 + col * staveWidth;
      const y = 40 + row * rowHeight;

      // Create stave
      const stave = new Stave(x, y, staveWidth - 10);
      if (col === 0) {
        stave.addClef("treble");
        if (row === 0 && barNum <= 1) {
          stave.addTimeSignature(`${beatsPerBar}/4`);
        }
      }
      stave.setContext(context).draw();

      // Create notes for this bar
      if (barNotes.length > 0) {
        const vexNotes: StaveNote[] = [];

        // Group simultaneous notes (chords)
        const timeGroups = new Map<number, FallingNote[]>();
        barNotes.forEach(note => {
          const time = Math.round(note.expectedTimeMs);
          if (!timeGroups.has(time)) timeGroups.set(time, []);
          timeGroups.get(time)!.push(note);
        });

        Array.from(timeGroups.entries())
          .sort((a, b) => a[0] - b[0])
          .forEach(([, groupNotes]) => {
            const keys = groupNotes.map(n => toVexFlowNote(n.note).key);
            const duration = getVexDuration(groupNotes[0].durationMs, beatDurationMs);

            try {
              const staveNote = new StaveNote({
                keys,
                duration,
                auto_stem: true,
              });

              // Add accidentals
              groupNotes.forEach((n, i) => {
                const vexNote = toVexFlowNote(n.note);
                if (vexNote.accidental) {
                  staveNote.addModifier(new Accidental(vexNote.accidental), i);
                }
              });

              // Color based on status
              const color = getColor(groupNotes[0].status, groupNotes[0].hand);
              staveNote.setStyle({ fillStyle: color, strokeStyle: color });

              vexNotes.push(staveNote);
            } catch (e) {
              // Skip invalid notes
              console.warn("Failed to create note:", keys, e);
            }
          });

        if (vexNotes.length > 0) {
          try {
            const voice = new Voice({ num_beats: beatsPerBar, beat_value: 4 }).setStrict(false);
            voice.addTickables(vexNotes);
            new Formatter().joinVoices([voice]).format([voice], staveWidth - 50);
            voice.draw(context, stave);
          } catch (e) {
            console.warn("Failed to render bar:", barNum, e);
          }
        }
      }

      // Highlight current bar
      if (barNum === currentBar + 1) {
        context.save();
        context.setFillStyle("rgba(59, 130, 246, 0.1)");
        context.fillRect(x, y, staveWidth - 10, 80);
        context.restore();
      }
    });
  }, [bars, currentBar, beatsPerBar, beatDurationMs]);

  // Re-render on resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && bars.length > 0) {
        // Trigger re-render by updating a dependency
        containerRef.current.innerHTML = "";
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [bars]);

  return (
    <div className="relative w-full h-full overflow-auto bg-white">
      <div
        ref={containerRef}
        className="w-full min-h-full"
        style={{ minHeight: "300px" }}
      />

      {/* Floating feedback text */}
      {feedbackText && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 bottom-4 text-lg font-semibold pointer-events-none px-4 py-2 rounded-full ${
            feedbackType === "correct"
              ? "bg-emerald-100 text-emerald-600"
              : feedbackType === "wrong"
                ? "bg-red-100 text-red-600"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {feedbackText}
        </div>
      )}
    </div>
  );
}
