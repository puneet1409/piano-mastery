"use client";

import React from "react";

export type DisplayMode = "falling" | "rail" | "sheet";

interface DisplayModeToggleProps {
  mode: DisplayMode;
  onChange: (mode: DisplayMode) => void;
}

export default function DisplayModeToggle({ mode, onChange }: DisplayModeToggleProps) {
  return (
    <div className="inline-flex items-center rounded-full bg-slate-800/70 p-0.5 ring-1 ring-white/10">
      <button
        onClick={() => onChange("falling")}
        className={`px-3 py-1.5 text-[10px] font-medium rounded-full transition-all duration-200 ${
          mode === "falling"
            ? "bg-slate-600 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-300"
        }`}
        title="Vertical falling notes (Synthesia style)"
      >
        Falling
      </button>
      <button
        onClick={() => onChange("rail")}
        className={`px-3 py-1.5 text-[10px] font-medium rounded-full transition-all duration-200 ${
          mode === "rail"
            ? "bg-slate-600 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-300"
        }`}
        title="Horizontal scrolling rail"
      >
        Rail
      </button>
      <button
        onClick={() => onChange("sheet")}
        className={`px-3 py-1.5 text-[10px] font-medium rounded-full transition-all duration-200 ${
          mode === "sheet"
            ? "bg-slate-600 text-white shadow-sm"
            : "text-slate-400 hover:text-slate-300"
        }`}
        title="Traditional sheet music notation"
      >
        Sheet
      </button>
    </div>
  );
}
