/**
 * CharacterStage - Integrates Nota character with score display
 *
 * This component combines:
 * - NotaSVG animated character (responds to performance)
 * - Score statistics (accuracy, streak)
 * - Real-time feedback visualization
 */

'use client';

import React from 'react';
import NotaSVG, { NotaState } from './NotaSVG';
import styles from './piano.module.css';

interface CharacterStageProps {
  accuracy: number;        // 0-100 percentage
  streak: number;          // Current streak count
  lastResult?: 'correct' | 'wrong' | null;  // Most recent result
  noDetectionTime?: number; // Seconds since last detection
}

export default function CharacterStage({
  accuracy,
  streak,
  lastResult = null,
  noDetectionTime = 0,
}: CharacterStageProps) {
  // Determine Nota's emotional state based on performance
  const getNotaState = (): NotaState => {
    // Recent result takes priority
    if (lastResult === 'correct') return 'excited';
    if (lastResult === 'wrong') return 'sad';

    // If no recent activity for 5+ seconds
    if (noDetectionTime > 5) return 'confused';

    // Otherwise, idle
    return 'idle';
  };

  return (
    <div className={styles.characterStage}>
      {/* Nota Character Section */}
      <div className={styles.notaSection}>
        <NotaSVG state={getNotaState()} size={120} />
      </div>

      {/* Score Display Section */}
      <div className={styles.scoreSection}>
        <div className={styles.scoreDisplay}>
          {/* Accuracy */}
          <div className={styles.scoreStat}>
            <div className={styles.scoreLabel}>Accuracy</div>
            <div className={styles.scoreValue}>{accuracy.toFixed(0)}%</div>
          </div>

          {/* Streak */}
          <div className={styles.scoreStat}>
            <div className={styles.scoreLabel}>Streak</div>
            <div className={styles.scoreValue}>
              {streak > 0 ? `🔥 ${streak}` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
