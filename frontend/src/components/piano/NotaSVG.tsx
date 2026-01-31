import React from 'react';
import styles from './nota.module.css';

export type NotaState = 'idle' | 'excited' | 'sad' | 'confused';

interface NotaSVGProps {
  state: NotaState;
  size?: number;
}

export default function NotaSVG({ state, size = 80 }: NotaSVGProps) {
  const stateClass = {
    idle: styles.idle,
    excited: styles.excited,
    sad: styles.sad,
    confused: styles.confused,
  }[state];

  return (
    <div className={`${styles.notaContainer} ${stateClass}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Musical Note Body */}
        <ellipse
          cx="40"
          cy="70"
          rx="25"
          ry="20"
          fill="#1a1a1a"
          className={styles.noteBody}
        />

        {/* Musical Note Stem */}
        <rect
          x="62"
          y="35"
          width="6"
          height="40"
          rx="3"
          fill="#1a1a1a"
          className={styles.noteStem}
        />

        {/* Musical Note Flag */}
        <path
          d="M68 35 Q85 30, 85 40 L85 48 Q85 43, 68 45 Z"
          fill="#1a1a1a"
          className={styles.noteFlag}
        />

        {/* Eyes (state-dependent) */}
        <g className={styles.eyes}>
          {state === 'idle' && (
            <>
              <circle cx="32" cy="65" r="4" fill="white" />
              <circle cx="48" cy="65" r="4" fill="white" />
              <circle cx="33" cy="65" r="2" fill="#000" />
              <circle cx="49" cy="65" r="2" fill="#000" />
            </>
          )}

          {state === 'excited' && (
            <>
              <circle cx="32" cy="63" r="5" fill="white" />
              <circle cx="48" cy="63" r="5" fill="white" />
              <circle cx="34" cy="62" r="3" fill="#000" />
              <circle cx="50" cy="62" r="3" fill="#000" />
            </>
          )}

          {state === 'sad' && (
            <>
              <ellipse cx="32" cy="67" rx="3" ry="2" fill="white" />
              <ellipse cx="48" cy="67" rx="3" ry="2" fill="white" />
              <ellipse cx="32" cy="67" rx="1.5" ry="1" fill="#000" />
              <ellipse cx="48" cy="67" rx="1.5" ry="1" fill="#000" />
            </>
          )}

          {state === 'confused' && (
            <>
              <circle cx="30" cy="65" r="4" fill="white" />
              <circle cx="50" cy="65" r="4" fill="white" />
              <circle cx="31" cy="65" r="2" fill="#000" />
              <circle cx="51" cy="65" r="2" fill="#000" />
            </>
          )}
        </g>

        {/* Mouth (state-dependent) */}
        <g className={styles.mouth}>
          {state === 'idle' && (
            <path d="M 32 75 Q 40 78, 48 75" stroke="#000" strokeWidth="2" fill="none" />
          )}

          {state === 'excited' && (
            <path d="M 30 73 Q 40 80, 50 73" stroke="#000" strokeWidth="2" fill="none" />
          )}

          {state === 'sad' && (
            <path d="M 32 78 Q 40 75, 48 78" stroke="#000" strokeWidth="2" fill="none" />
          )}

          {state === 'confused' && (
            <ellipse cx="40" cy="76" rx="4" ry="3" fill="#000" />
          )}
        </g>

        {/* Question mark for confused state */}
        {state === 'confused' && (
          <text
            x="75"
            y="25"
            fontSize="20"
            fill="#FF6B35"
            className={styles.questionMark}
          >
            ?
          </text>
        )}

        {/* Sparkles for excited state */}
        {state === 'excited' && (
          <g className={styles.sparkles}>
            <text x="10" y="30" fontSize="16" fill="#58EBED">✨</text>
            <text x="75" y="55" fontSize="16" fill="#58EBED">✨</text>
            <text x="15" y="85" fontSize="12" fill="#58EBED">✨</text>
          </g>
        )}
      </svg>
    </div>
  );
}
