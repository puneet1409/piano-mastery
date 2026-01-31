/**
 * KeySlot - Fixed Container Pattern for Zero Layout Shift
 *
 * This component provides a fixed-dimension container that NEVER changes size.
 * It prevents layout shift by maintaining constant dimensions even when child
 * animations occur.
 *
 * Design principle: The slot is the "stage", the KeyFace is the "actor".
 */

import React from 'react';
import styles from './piano.module.css';

interface KeySlotProps {
  width: number;
  height: number;
  left?: number; // For absolutely positioned black keys
  children: React.ReactNode;
}

export default function KeySlot({ width, height, left, children }: KeySlotProps) {
  const style: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    position: left !== undefined ? 'absolute' : 'relative',
    ...(left !== undefined && { left: `${left}px` }),
  };

  return (
    <div className={styles.keySlot} style={style}>
      {children}
    </div>
  );
}
