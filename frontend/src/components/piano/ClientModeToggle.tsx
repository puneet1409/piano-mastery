"use client";

import React from "react";

interface ClientModeToggleProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export default function ClientModeToggle({ enabled, onChange }: ClientModeToggleProps) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-medium transition-all duration-200 ring-1 ring-white/10 ${
        enabled
          ? "bg-green-500/20 text-green-300"
          : "bg-slate-800/70 text-slate-400 hover:bg-slate-700/70"
      }`}
      title={
        enabled
          ? "Client-side YIN detection (<20ms latency)"
          : "Click to enable client-side detection"
      }
    >
      {enabled ? "Client ⚡" : "Client"}
    </button>
  );
}
