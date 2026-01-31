"use client";

import React, { useState } from "react";
import PianoKeyboard from "@/components/piano/PianoKeyboard";

export default function TestNotesPage() {
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [noteHistory, setNoteHistory] = useState<string[]>([]);

  const addNote = (note: string) => {
    // Add to detected notes
    setDetectedNotes((prev) => {
      if (!prev.includes(note)) {
        return [...prev, note];
      }
      return prev;
    });

    // Add to history
    setNoteHistory((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${note}`]);

    // Auto-clear after 500ms
    setTimeout(() => {
      setDetectedNotes((prev) => prev.filter((n) => n !== note));
    }, 500);
  };

  const playPattern = (pattern: string[]) => {
    pattern.forEach((note, index) => {
      setTimeout(() => addNote(note), index * 150);
    });
  };

  const clearHistory = () => {
    setNoteHistory([]);
    setDetectedNotes([]);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-4 border-black">
          <h1 className="text-4xl font-bold mb-2">🎹 Note Detection Test</h1>
          <p className="text-gray-600">Simple visual test for piano keyboard feedback</p>
        </div>

        {/* Piano Keyboard */}
        <div>
          <PianoKeyboard
            detectedNotes={detectedNotes}
            expectedNotes={["C4", "E4", "G4"]}
            showLabels={true}
          />
        </div>

        {/* Test Buttons */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-4 border-black">
          <h2 className="text-2xl font-bold mb-4">Test Patterns</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => addNote("C4")}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              C4
            </button>
            <button
              onClick={() => addNote("E4")}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              E4
            </button>
            <button
              onClick={() => addNote("G4")}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              G4
            </button>
            <button
              onClick={() => addNote("C5")}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              C5
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            <button
              onClick={() => playPattern(["C4", "E4", "G4"])}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              🎹 C Major Chord
            </button>
            <button
              onClick={() => playPattern(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              🎼 C Scale
            </button>
            <button
              onClick={clearHistory}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-6 rounded-lg border-4 border-black shadow-lg transition"
            >
              🗑️ Clear
            </button>
          </div>
        </div>

        {/* Current Detection */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-4 border-black">
          <h2 className="text-2xl font-bold mb-4">Currently Detected</h2>
          {detectedNotes.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {detectedNotes.map((note, idx) => (
                <div
                  key={idx}
                  className="bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg border-4 border-black text-2xl animate-pulse"
                >
                  {note}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-lg">No notes detected. Click buttons above to test.</p>
          )}
        </div>

        {/* Note History */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-4 border-black">
          <h2 className="text-2xl font-bold mb-4">Note History</h2>
          <div className="bg-gray-900 text-green-400 font-mono p-4 rounded-lg max-h-64 overflow-y-auto">
            {noteHistory.length > 0 ? (
              noteHistory.slice(-20).reverse().map((entry, idx) => (
                <div key={idx} className="py-1">
                  {entry}
                </div>
              ))
            ) : (
              <div className="text-gray-600">No notes played yet...</div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-yellow-100 rounded-lg shadow-lg p-6 border-4 border-black">
          <h2 className="text-2xl font-bold mb-4">📋 Instructions</h2>
          <ol className="list-decimal list-inside space-y-2 text-lg">
            <li>Click individual note buttons (C4, E4, G4, C5) to test single notes</li>
            <li>Click "🎹 C Major Chord" to see all three notes of a C chord</li>
            <li>Click "🎼 C Scale" to play a full C major scale</li>
            <li>Watch the keyboard keys light up in cyan when detected</li>
            <li>Orange rings show "expected" notes (C4, E4, G4)</li>
            <li>Notes auto-clear after 500ms</li>
          </ol>
        </div>

        {/* Visual Feedback Legend */}
        <div className="bg-white rounded-lg shadow-lg p-6 border-4 border-black">
          <h2 className="text-2xl font-bold mb-4">🎨 Visual Feedback Guide</h2>
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-cyan-400 rounded border-4 border-black"></div>
              <div>
                <strong className="text-lg">Cyan Background</strong>
                <p className="text-gray-600">Note is currently being detected</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white rounded border-4 border-orange-500"></div>
              <div>
                <strong className="text-lg">Orange Ring</strong>
                <p className="text-gray-600">Expected note (should be played)</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-white rounded border-4 border-black relative">
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-full"></div>
              </div>
              <div>
                <strong className="text-lg">Pulsing Dot</strong>
                <p className="text-gray-600">Active indicator on detected keys</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
