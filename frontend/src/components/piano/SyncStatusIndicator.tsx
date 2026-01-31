/**
 * Sync Status Indicator
 *
 * Shows the auto-sync score follower state:
 * - SYNCING: Looking for position in song (listening to notes)
 * - LOCKED: Synced to position, validating notes
 * - LOST: Lost sync, re-syncing
 */

import React from "react";

export type SyncMode = "syncing" | "locked" | "lost";

interface SyncStatusIndicatorProps {
  mode: SyncMode;
  position: number;
  totalNotes: number;
  confidence: number;
  expectedNote: string | null;
  consecutiveErrors: number;
  accuracy: number;
  compact?: boolean;
}

export function SyncStatusIndicator({
  mode,
  position,
  totalNotes,
  confidence,
  expectedNote,
  consecutiveErrors,
  accuracy,
  compact = false,
}: SyncStatusIndicatorProps) {
  const getModeColor = () => {
    switch (mode) {
      case "syncing":
        return "bg-yellow-500/20 border-yellow-500/50 text-yellow-400";
      case "locked":
        return "bg-emerald-500/20 border-emerald-500/50 text-emerald-400";
      case "lost":
        return "bg-red-500/20 border-red-500/50 text-red-400";
    }
  };

  const getModeIcon = () => {
    switch (mode) {
      case "syncing":
        return (
          <span className="animate-pulse" title="Syncing...">
            &#128269;
          </span>
        );
      case "locked":
        return <span title="Locked">&#128274;</span>;
      case "lost":
        return (
          <span className="animate-bounce" title="Lost - Re-syncing">
            &#128260;
          </span>
        );
    }
  };

  const getModeLabel = () => {
    switch (mode) {
      case "syncing":
        return "Syncing...";
      case "locked":
        return "Locked";
      case "lost":
        return "Re-syncing...";
    }
  };

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border ${getModeColor()}`}
      >
        <span className="text-sm">{getModeIcon()}</span>
        <span className="text-xs font-medium">{getModeLabel()}</span>
        {mode === "locked" && expectedNote && (
          <span className="text-xs opacity-70">Next: {expectedNote}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col gap-2 p-3 rounded-xl border backdrop-blur-sm ${getModeColor()}`}
    >
      {/* Header with mode */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{getModeIcon()}</span>
          <span className="font-semibold text-sm">{getModeLabel()}</span>
        </div>
        <div className="text-xs opacity-70">
          {Math.round(confidence * 100)}% confidence
        </div>
      </div>

      {/* Position & Progress */}
      {mode === "locked" && (
        <div className="flex items-center justify-between text-xs">
          <div>
            Position: <span className="font-mono">{position + 1}</span>/
            <span className="font-mono">{totalNotes}</span>
          </div>
          <div>
            Accuracy: <span className="font-semibold">{Math.round(accuracy)}%</span>
          </div>
        </div>
      )}

      {/* Expected Note */}
      {mode === "locked" && expectedNote && (
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-70">Next note:</span>
          <span className="font-mono font-bold text-lg">{expectedNote}</span>
        </div>
      )}

      {/* Error indicator */}
      {consecutiveErrors > 0 && mode === "locked" && (
        <div className="flex items-center gap-1 text-xs text-red-400">
          <span>Errors:</span>
          <span className="font-mono">
            {"X".repeat(Math.min(consecutiveErrors, 5))}
          </span>
          {consecutiveErrors >= 4 && (
            <span className="text-red-300 animate-pulse ml-1">
              (will lose sync at 5)
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      {mode === "locked" && totalNotes > 0 && (
        <div className="h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-current transition-all duration-300"
            style={{ width: `${((position + 1) / totalNotes) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default SyncStatusIndicator;
