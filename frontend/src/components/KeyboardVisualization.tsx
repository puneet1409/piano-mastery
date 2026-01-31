"use client";

import React, { useRef, useEffect } from "react";

interface KeyboardVisualizationProps {
  highlightedKeys?: string[]; // e.g., ["C4", "E4", "G4"]
  width?: number;
  height?: number;
}

export default function KeyboardVisualization({
  highlightedKeys = [],
  width = 800,
  height = 200,
}: KeyboardVisualizationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Piano keyboard constants
    const whiteKeyWidth = width / 14; // 2 octaves = 14 white keys
    const whiteKeyHeight = height * 0.8;
    const blackKeyWidth = whiteKeyWidth * 0.6;
    const blackKeyHeight = whiteKeyHeight * 0.6;

    // White keys pattern: C D E F G A B
    const whiteKeys = ["C", "D", "E", "F", "G", "A", "B"];
    const blackKeyPositions = [1, 2, 4, 5, 6]; // positions after C, D, F, G, A

    // Draw white keys
    for (let octave = 0; octave < 2; octave++) {
      for (let i = 0; i < whiteKeys.length; i++) {
        const x = (octave * 7 + i) * whiteKeyWidth;
        const keyName = `${whiteKeys[i]}${octave + 4}`; // C4, D4, etc.

        // Check if this key should be highlighted
        const isHighlighted = highlightedKeys.includes(keyName);

        ctx.fillStyle = isHighlighted ? "#0ea5e9" : "#ffffff";
        ctx.fillRect(x, 0, whiteKeyWidth, whiteKeyHeight);
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, 0, whiteKeyWidth, whiteKeyHeight);

        // Draw key label
        ctx.fillStyle = isHighlighted ? "#ffffff" : "#000000";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.fillText(keyName, x + whiteKeyWidth / 2, whiteKeyHeight - 10);
      }
    }

    // Draw black keys
    for (let octave = 0; octave < 2; octave++) {
      blackKeyPositions.forEach((pos) => {
        const x = (octave * 7 + pos) * whiteKeyWidth - blackKeyWidth / 2;

        // Determine black key name
        let keyName = "";
        if (pos === 1) keyName = `C#${octave + 4}`;
        else if (pos === 2) keyName = `D#${octave + 4}`;
        else if (pos === 4) keyName = `F#${octave + 4}`;
        else if (pos === 5) keyName = `G#${octave + 4}`;
        else if (pos === 6) keyName = `A#${octave + 4}`;

        const isHighlighted = highlightedKeys.includes(keyName);

        ctx.fillStyle = isHighlighted ? "#0284c7" : "#000000";
        ctx.fillRect(x, 0, blackKeyWidth, blackKeyHeight);
        ctx.strokeStyle = "#333333";
        ctx.strokeRect(x, 0, blackKeyWidth, blackKeyHeight);

        // Draw key label
        if (isHighlighted) {
          ctx.fillStyle = "#ffffff";
          ctx.font = "10px Arial";
          ctx.textAlign = "center";
          ctx.fillText(keyName, x + blackKeyWidth / 2, blackKeyHeight - 5);
        }
      });
    }
  }, [highlightedKeys, width, height]);

  return (
    <div className="bg-gray-100 rounded-lg p-4 shadow-inner">
      <h3 className="text-lg font-semibold text-gray-700 mb-3">
        Piano Keyboard
      </h3>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-300 rounded bg-white"
      />
      <p className="text-xs text-gray-500 mt-2">
        {highlightedKeys.length > 0
          ? `Highlighted: ${highlightedKeys.join(", ")}`
          : "Play the highlighted keys"}
      </p>
    </div>
  );
}
