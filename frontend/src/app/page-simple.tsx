"use client";

import React, { useState } from "react";
import PianoKeyboard from "@/components/piano/PianoKeyboard";

export default function Home() {
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);

  const simulateNote = (note: string) => {
    setDetectedNotes((prev) => {
      if (!prev.includes(note)) {
        return [...prev, note];
      }
      return prev;
    });

    setTimeout(() => {
      setDetectedNotes((prev) => prev.filter((n) => n !== note));
    }, 500);
  };

  const playPattern = (notes: string[]) => {
    notes.forEach((note, index) => {
      setTimeout(() => simulateNote(note), index * 150);
    });
  };

  return (
    <main className="min-h-screen bg-[var(--concrete-100)] p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="brutal-card p-8 text-center">
          <h1 className="text-display text-6xl mb-4">PIANO MASTERY</h1>
          <p className="text-technical text-lg text-[var(--concrete-500)]">
            AI-Powered Practice Sessions
          </p>
        </div>

        {/* Piano Keyboard */}
        <PianoKeyboard
          detectedNotes={detectedNotes}
          expectedNotes={["C4", "E4", "G4"]}
          showLabels={true}
        />

        {/* Test Controls */}
        <div className="brutal-card p-6">
          <h2 className="text-display text-2xl mb-6">TEST CONTROLS</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <button
              onClick={() => simulateNote("C4")}
              className="brutal-btn bg-[var(--electric-blue)] text-white px-6 py-4 text-sm"
            >
              C4
            </button>
            <button
              onClick={() => simulateNote("E4")}
              className="brutal-btn bg-[var(--electric-blue)] text-white px-6 py-4 text-sm"
            >
              E4
            </button>
            <button
              onClick={() => simulateNote("G4")}
              className="brutal-btn bg-[var(--electric-blue)] text-white px-6 py-4 text-sm"
            >
              G4
            </button>
            <button
              onClick={() => simulateNote("C5")}
              className="brutal-btn bg-[var(--electric-blue)] text-white px-6 py-4 text-sm"
            >
              C5
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => playPattern(["C4", "E4", "G4"])}
              className="brutal-btn bg-[var(--success-green)] text-[var(--concrete-900)] px-6 py-4"
            >
              🎹 CHORD
            </button>
            <button
              onClick={() => playPattern(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])}
              className="brutal-btn bg-[var(--success-green)] text-[var(--concrete-900)] px-6 py-4"
            >
              🎼 SCALE
            </button>
            <button
              onClick={() => setDetectedNotes([])}
              className="brutal-btn bg-[var(--error-red)] text-white px-6 py-4"
            >
              CLEAR
            </button>
          </div>
        </div>

        {/* Current Detection Display */}
        <div className="brutal-card p-6">
          <h2 className="text-display text-2xl mb-4">DETECTED NOTES</h2>
          <div className="bg-[var(--concrete-900)] p-6 text-[var(--success-green)] text-technical">
            {detectedNotes.length > 0 ? (
              <div className="flex flex-wrap gap-4">
                {detectedNotes.map((note, idx) => (
                  <div
                    key={idx}
                    className="bg-[var(--electric-cyan)] text-[var(--concrete-900)] px-6 py-3 font-bold text-2xl border-2 border-[var(--concrete-900)] animate-pulse"
                  >
                    {note}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">NO NOTES DETECTED</div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="brutal-card p-6 bg-[var(--warning-orange)] bg-opacity-10">
          <h2 className="text-display text-xl mb-4">INSTRUCTIONS</h2>
          <ul className="text-technical space-y-2">
            <li>• Click individual notes (C4, E4, G4, C5) to test single note detection</li>
            <li>• Click 🎹 CHORD to play C major chord</li>
            <li>• Click 🎼 SCALE to play C major scale</li>
            <li>• Watch keys light up in ELECTRIC CYAN when detected</li>
            <li>• Orange rings show expected notes to play</li>
            <li>• Notes auto-clear after 500ms</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
