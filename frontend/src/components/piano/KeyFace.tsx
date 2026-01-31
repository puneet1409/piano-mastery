/**
 * KeyFace - Animated Visual Element for Piano Keys
 *
 * This component renders the visual appearance of a piano key and handles
 * all state-based styling and overlay animations.
 *
 * It lives inside a KeySlot container and can animate freely without
 * causing layout shift.
 */

'use client';

import React, { useEffect, useRef } from 'react';
import { KeyBaseState, KeyOverlay, OVERLAY_DURATIONS } from '@/types/piano';
import styles from './piano.module.css';

interface KeyFaceProps {
  note: string;
  isBlack: boolean;
  baseState: KeyBaseState;
  overlay: KeyOverlay;
  onOverlayEnd: () => void;
  showLabel: boolean;
  onClick?: (note: string) => void;
  interactive?: boolean;
}

export default function KeyFace({
  note,
  isBlack,
  baseState,
  overlay,
  onOverlayEnd,
  showLabel,
  onClick,
  interactive = false,
}: KeyFaceProps) {
  const overlayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Handle overlay animation timeout
  useEffect(() => {
    if (overlay) {
      const duration = OVERLAY_DURATIONS[overlay];

      overlayTimerRef.current = setTimeout(() => {
        onOverlayEnd();
      }, duration);
    }

    return () => {
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
      }
    };
  }, [overlay, onOverlayEnd]);

  // Build CSS classes
  const keyClass = [
    styles.keyFace,
    isBlack ? styles.blackKey : styles.whiteKey,
    styles[`state-${baseState}`],
    overlay && styles[`overlay-${overlay}`],
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = () => {
    if (interactive && onClick) {
      onClick(note);
    }
  };

  return (
    <div
      className={keyClass}
      onClick={handleClick}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      {showLabel && !isBlack && (
        <span className={styles.keyLabel}>{note}</span>
      )}
      {overlay && <div className={styles.overlayFlash} />}
    </div>
  );
}
