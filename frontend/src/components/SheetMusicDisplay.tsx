'use client';

import React, { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter } from 'vexflow';

interface SheetMusicDisplayProps {
  skillId: string;
  highlightNotes?: string[];
}

export default function SheetMusicDisplay({ skillId, highlightNotes = [] }: SheetMusicDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous render
    containerRef.current.innerHTML = '';

    // Create renderer
    const renderer = new Renderer(containerRef.current, Renderer.Backends.SVG);
    renderer.resize(600, 200);
    const context = renderer.getContext();

    // Create stave
    const stave = new Stave(10, 40, 580);
    stave.addClef('bass').addTimeSignature('6/8');
    stave.setContext(context).draw();

    // Create notes for L3.2 pattern: G G B D G B
    const notes = [
      new StaveNote({ clef: 'bass', keys: ['g/2'], duration: '8' }),
      new StaveNote({ clef: 'bass', keys: ['g/2'], duration: '8' }),
      new StaveNote({ clef: 'bass', keys: ['b/3'], duration: '8' }),
      new StaveNote({ clef: 'bass', keys: ['d/4'], duration: '8' }),
      new StaveNote({ clef: 'bass', keys: ['g/2'], duration: '8' }),
      new StaveNote({ clef: 'bass', keys: ['b/3'], duration: '8' }),
    ];

    // Highlight notes if specified
    if (highlightNotes.length > 0) {
      notes.forEach((note) => {
        const noteKey = note.getKeys()[0];
        if (highlightNotes.some(h => noteKey.startsWith(h.toLowerCase()))) {
          note.setStyle({ fillStyle: 'blue', strokeStyle: 'blue' });
        }
      });
    }

    // Create voice
    const voice = new Voice({ numBeats: 6, beatValue: 8 });
    voice.addTickables(notes);

    // Format and draw
    new Formatter().joinVoices([voice]).format([voice], 520);
    voice.draw(context, stave);

  }, [skillId, highlightNotes]);

  return (
    <div className="bg-white p-4 rounded-lg border border-gray-300">
      <div ref={containerRef} />
    </div>
  );
}
