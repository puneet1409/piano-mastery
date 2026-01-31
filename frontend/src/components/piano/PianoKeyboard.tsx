'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { generatePianoKeys, getWhiteKeys, getBlackKeys, calculateBlackKeyPosition } from '@/lib/pianoKeys';
import { KeyBaseState, KeyOverlay, Octave } from '@/types/piano';
import KeySlot from './KeySlot';
import KeyFace from './KeyFace';
import styles from './piano.module.css';

interface PianoKeyboardProps {
  detectedNotes?: string[];
  expectedNotes?: string[];
  tentativeNotes?: string[]; // Two-speed: instant visual feedback before confirmation
  showLabels?: boolean;
  startOctave?: Octave;
  endOctave?: Octave;
  onKeyClick?: (note: string) => void;
  interactive?: boolean;
}

export default function PianoKeyboard({
  detectedNotes = [],
  expectedNotes = [],
  tentativeNotes = [],
  showLabels = true,
  startOctave = 3,
  endOctave = 6,
  onKeyClick,
  interactive = false,
}: PianoKeyboardProps) {
  const [keyOverlays, setKeyOverlays] = useState<Record<string, KeyOverlay>>({});
  const [containerWidth, setContainerWidth] = useState(1200);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Generate piano keys
  const allKeys = useMemo(
    () => generatePianoKeys(startOctave, endOctave),
    [startOctave, endOctave]
  );

  const whiteKeys = useMemo(() => getWhiteKeys(allKeys), [allKeys]);
  const blackKeys = useMemo(() => getBlackKeys(allKeys), [allKeys]);

  // Measure container width on mount and resize
  React.useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate key dimensions (responsive)
  const whiteKeyWidth = containerWidth / whiteKeys.length;
  const whiteKeyHeight = whiteKeyWidth * 4.5; // Realistic 4.5:1 ratio
  const blackKeyWidth = whiteKeyWidth * 0.65;
  const blackKeyHeight = whiteKeyHeight * 0.62; // 62% of white key height

  // Determine key states
  const getKeyBaseState = useCallback((note: string): KeyBaseState => {
    if (expectedNotes.includes(note)) return 'expected';
    return 'idle';
  }, [expectedNotes]);

  const getKeyOverlay = useCallback((note: string): KeyOverlay => {
    return keyOverlays[note] || null;
  }, [keyOverlays]);

  // Handle overlay end
  const handleOverlayEnd = useCallback((note: string) => {
    setKeyOverlays(prev => {
      const next = { ...prev };
      delete next[note];
      return next;
    });
  }, []);

  // Update overlays when detectedNotes changes
  React.useEffect(() => {
    if (detectedNotes.length > 0) {
      const newOverlays: Record<string, KeyOverlay> = {};

      detectedNotes.forEach(note => {
        // Check if correct
        if (expectedNotes.includes(note)) {
          newOverlays[note] = 'hitCorrect';
        } else {
          newOverlays[note] = 'hitWrong';
        }
      });

      setKeyOverlays(prev => ({ ...prev, ...newOverlays }));
    }
  }, [detectedNotes, expectedNotes]);

  // Update overlays for tentative notes (instant visual feedback)
  React.useEffect(() => {
    if (tentativeNotes.length > 0) {
      const newOverlays: Record<string, KeyOverlay> = {};

      tentativeNotes.forEach(note => {
        // Tentative uses same visual as correct for instant feedback
        // (will be confirmed or cancelled shortly)
        if (expectedNotes.includes(note)) {
          newOverlays[note] = 'hitCorrect';
        }
        // Don't show wrong for tentative - wait for confirmation
      });

      setKeyOverlays(prev => ({ ...prev, ...newOverlays }));
    }
  }, [tentativeNotes, expectedNotes]);

  return (
    <div ref={containerRef} className={styles.pianoContainer}>
      <div className={styles.keyboard} style={{ height: `${whiteKeyHeight}px` }}>
        {/* White Keys Layer */}
        <div className={styles.whiteKeysLayer}>
          {whiteKeys.map((key, index) => (
            <KeySlot
              key={key.note}
              width={whiteKeyWidth}
              height={whiteKeyHeight}
            >
              <KeyFace
                note={key.note}
                isBlack={false}
                baseState={getKeyBaseState(key.note)}
                overlay={getKeyOverlay(key.note)}
                onOverlayEnd={() => handleOverlayEnd(key.note)}
                showLabel={showLabels}
                onClick={onKeyClick}
                interactive={interactive}
              />
            </KeySlot>
          ))}
        </div>

        {/* Black Keys Layer */}
        <div className={styles.blackKeysLayer}>
          {blackKeys.map(key => {
            const left = calculateBlackKeyPosition(key, whiteKeyWidth, blackKeyWidth);

            return (
              <KeySlot
                key={key.note}
                width={blackKeyWidth}
                height={blackKeyHeight}
                left={left}
              >
                <KeyFace
                  note={key.note}
                  isBlack={true}
                  baseState={getKeyBaseState(key.note)}
                  overlay={getKeyOverlay(key.note)}
                  onOverlayEnd={() => handleOverlayEnd(key.note)}
                  showLabel={showLabels}
                  onClick={onKeyClick}
                  interactive={interactive}
                />
              </KeySlot>
            );
          })}
        </div>
      </div>
    </div>
  );
}
