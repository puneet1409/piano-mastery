"use client";

import React, { useState, useRef, useEffect } from "react";
import PianoKeyboard from "@/components/piano/PianoKeyboard";
import { config } from "@/lib/config";

// Force client-side rendering
export const dynamic = 'force-dynamic';

interface NoteSequenceItem {
  note: string;
  frequency: number;
  duration: number;
}

interface ChordItem {
  notes: string[];  // Multiple notes played simultaneously
  duration: number;
}

interface TestCase {
  id: string;
  name: string;
  category: 'single' | 'scale' | 'arpeggio' | 'melody' | 'chord';
  difficulty: 'basic' | 'intermediate' | 'advanced';
  sequence: NoteSequenceItem[];
  chords?: ChordItem[];  // For polyphonic chord tests
  description?: string;
}

// Ground truth score from high-accuracy detection
interface GroundTruthScore {
  notes: Array<{
    note: string;
    frequency: number;
    startTime: number;
    duration: number;
    confidence: number;
  }>;
  totalDuration: number;
  algorithm: 'fft' | 'autocorrelation' | 'polyphonic';
}

// Validation result comparing fast algorithm vs ground truth
interface ValidationResult {
  precision: number;  // True positives / (True positives + False positives)
  recall: number;     // True positives / (True positives + False negatives)
  f1Score: number;    // 2 * (precision * recall) / (precision + recall)
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  detectedNotes: string[];
  missedNotes: string[];
  incorrectNotes: string[];
}

// Testing phase state
type TestingPhase = 'idle' | 'phase1_recording' | 'phase2_groundtruth' | 'phase3_validate_fast' | 'phase4_youtube' | 'phase5_live';

interface TestingSession {
  phase: TestingPhase;
  referenceAudio: AudioBuffer | null;
  groundTruth: GroundTruthScore | null;
  phase3Result: ValidationResult | null;
  phase4Result: ValidationResult | null;
  phase5Result: ValidationResult | null;
}

// Helper to create note frequency mapping
const NOTE_FREQUENCIES: Record<string, number> = {
  'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81, 'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00, 'A#3': 233.08, 'B3': 246.94,
  'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63, 'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00, 'A#4': 466.16, 'B4': 493.88,
  'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25, 'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00, 'A#5': 932.33, 'B5': 987.77,
  'C6': 1046.50,
};

const createSequence = (notes: string[], duration: number = 500): NoteSequenceItem[] => {
  return notes.map(note => ({
    note,
    frequency: NOTE_FREQUENCIES[note],
    duration
  }));
};

const TEST_CASES: TestCase[] = [
  // ===== SINGLE NOTES =====
  {
    id: '1',
    name: 'Middle C (C4)',
    category: 'single',
    difficulty: 'basic',
    sequence: createSequence(['C4'], 1000),
    description: 'Foundation note, center of keyboard'
  },
  {
    id: '2',
    name: 'A4 (Concert Pitch)',
    category: 'single',
    difficulty: 'basic',
    sequence: createSequence(['A4'], 1000),
    description: 'Standard tuning reference (440 Hz)'
  },

  // ===== SCALES =====
  {
    id: '10',
    name: 'C Major Scale (Ascending)',
    category: 'scale',
    difficulty: 'intermediate',
    sequence: createSequence(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'], 400),
    description: 'Do-Re-Mi-Fa-Sol-La-Ti-Do'
  },
  {
    id: '11',
    name: 'C Major Scale (Descending)',
    category: 'scale',
    difficulty: 'intermediate',
    sequence: createSequence(['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'], 400),
    description: 'Descending pattern'
  },
  {
    id: '12',
    name: 'G Major Scale',
    category: 'scale',
    difficulty: 'intermediate',
    sequence: createSequence(['G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5'], 400),
    description: 'One sharp (F#)'
  },
  {
    id: '13',
    name: 'Chromatic Scale',
    category: 'scale',
    difficulty: 'advanced',
    sequence: createSequence(['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'], 300),
    description: 'All 12 semitones'
  },

  // ===== ARPEGGIOS =====
  {
    id: '20',
    name: 'C Major Arpeggio',
    category: 'arpeggio',
    difficulty: 'intermediate',
    sequence: createSequence(['C4', 'E4', 'G4', 'C5'], 500),
    description: 'Broken C major chord'
  },
  {
    id: '21',
    name: 'A Minor Arpeggio',
    category: 'arpeggio',
    difficulty: 'intermediate',
    sequence: createSequence(['A4', 'C5', 'E5'], 500),
    description: 'Broken A minor chord'
  },
  {
    id: '22',
    name: 'G Major Arpeggio',
    category: 'arpeggio',
    difficulty: 'intermediate',
    sequence: createSequence(['G4', 'B4', 'D5', 'G5'], 500),
    description: 'Broken G major chord'
  },

  // ===== MELODIES =====
  {
    id: '30',
    name: 'Twinkle Twinkle (First Line)',
    category: 'melody',
    difficulty: 'advanced',
    sequence: createSequence(['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4'], 400),
    description: 'Twin-kle twin-kle lit-tle star'
  },
  {
    id: '31',
    name: 'Mary Had a Little Lamb',
    category: 'melody',
    difficulty: 'advanced',
    sequence: createSequence(['E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4'], 400),
    description: 'Ma-ry had a lit-tle lamb'
  },
  {
    id: '32',
    name: 'Hot Cross Buns',
    category: 'melody',
    difficulty: 'advanced',
    sequence: createSequence(['E4', 'D4', 'C4', 'E4', 'D4', 'C4'], 500),
    description: 'Simple 3-note melody'
  },
  {
    id: '33',
    name: 'Ode to Joy (Opening)',
    category: 'melody',
    difficulty: 'advanced',
    sequence: createSequence(['E4', 'E4', 'F4', 'G4', 'G4', 'F4', 'E4', 'D4'], 350),
    description: 'Beethoven\'s famous theme'
  },

  // ===== INTERVALS (Sequential) =====
  {
    id: '40',
    name: 'Perfect Fifth (C-G)',
    category: 'arpeggio',
    difficulty: 'basic',
    sequence: createSequence(['C4', 'G4'], 800),
    description: 'Consonant interval'
  },
  {
    id: '41',
    name: 'Octave Jump (C4-C5)',
    category: 'arpeggio',
    difficulty: 'basic',
    sequence: createSequence(['C4', 'C5'], 800),
    description: '8 notes apart'
  },
  {
    id: '42',
    name: 'Major Third (C-E)',
    category: 'arpeggio',
    difficulty: 'basic',
    sequence: createSequence(['C4', 'E4'], 800),
    description: 'Happy interval'
  },

  // ===== CHORDS (Polyphonic - Simultaneous Notes) =====
  {
    id: '50',
    name: 'C Major Chord',
    category: 'chord',
    difficulty: 'intermediate',
    sequence: [],
    chords: [{ notes: ['C4', 'E4', 'G4'], duration: 1500 }],
    description: 'C-E-G played together (polyphonic test)'
  },
  {
    id: '51',
    name: 'F Major Chord',
    category: 'chord',
    difficulty: 'intermediate',
    sequence: [],
    chords: [{ notes: ['F4', 'A4', 'C5'], duration: 1500 }],
    description: 'F-A-C played together'
  },
  {
    id: '52',
    name: 'G Major Chord',
    category: 'chord',
    difficulty: 'intermediate',
    sequence: [],
    chords: [{ notes: ['G4', 'B4', 'D5'], duration: 1500 }],
    description: 'G-B-D played together'
  },
  {
    id: '53',
    name: 'Two-Note Chord (C4+C5)',
    category: 'chord',
    difficulty: 'basic',
    sequence: [],
    chords: [{ notes: ['C4', 'C5'], duration: 1500 }],
    description: 'Octave played simultaneously (polyphonic test)'
  },
  {
    id: '54',
    name: 'Chord Progression (C-F-G-C)',
    category: 'chord',
    difficulty: 'advanced',
    sequence: [],
    chords: [
      { notes: ['C4', 'E4', 'G4'], duration: 1000 },
      { notes: ['F4', 'A4', 'C5'], duration: 1000 },
      { notes: ['G4', 'B4', 'D5'], duration: 1000 },
      { notes: ['C4', 'E4', 'G4'], duration: 1000 },
    ],
    description: 'I-IV-V-I progression with polyphonic chords'
  },
];

export default function CalibrationPage() {
  const [currentTest, setCurrentTest] = useState<TestCase | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentNoteIndex, setCurrentNoteIndex] = useState<number>(-1);
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [testResults, setTestResults] = useState<Record<string, boolean>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [sequenceDetections, setSequenceDetections] = useState<Record<number, string[]>>({});
  const [uploadedAudio, setUploadedAudio] = useState<AudioBuffer | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState<string>('');
  const [practiceMode, setPracticeMode] = useState<TestCase | null>(null);
  const [practiceProgress, setPracticeProgress] = useState<number>(0); // Current step in practice sequence
  const [isRecording, setIsRecording] = useState(false);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordedAudioBuffer, setRecordedAudioBuffer] = useState<AudioBuffer | null>(null);
  const [analyzedScore, setAnalyzedScore] = useState<NoteSequenceItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showAnalysisPanel, setShowAnalysisPanel] = useState(false);

  // 5-Phase Testing Pipeline State
  const [testingSession, setTestingSession] = useState<TestingSession>({
    phase: 'idle',
    referenceAudio: null,
    groundTruth: null,
    phase3Result: null,
    phase4Result: null,
    phase5Result: null,
  });

  // UI State - Progressive Disclosure
  const [showAlgorithmTesting, setShowAlgorithmTesting] = useState(false);
  const [showQuickTest, setShowQuickTest] = useState(true);
  const [showMicrophonePanel, setShowMicrophonePanel] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const detectedNotesAccumulator = useRef<Set<string>>(new Set());
  const sequenceDetectionsRef = useRef<Record<number, string[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new AudioContext({ sampleRate: 44100 });

    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const sessionId = `calibration_${Date.now()}`;
    const wsUrl = `${config.backendWs}/ws/${sessionId}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('WebSocket connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'ground_truth_result') {
          // Clear analysis timeout
          if ((window as any).phase2Timeout) {
            clearTimeout((window as any).phase2Timeout);
          }

          // Phase 2 ground truth received from backend YIN algorithm
          const result = data.data;
          console.log(`\n✅ Phase 2 complete: ${result.mergedCount} notes detected (${result.rawCount} raw → ${result.mergedCount} merged)`);
          console.log(`   Ground truth: ${result.notes.map((n: any) => n.note).join(' → ')}`);

          // Detailed frequency analysis
          console.log('\n📊 PHASE 2 FREQUENCY ANALYSIS (Backend YIN):');
          result.notes.forEach((n: any, idx: number) => {
            const expectedFreq = noteToFrequency(n.note);
            const cents = calculateCents(n.frequency, expectedFreq);
            const deviation = Math.abs(cents);
            const status = deviation < 20 ? '✅' : deviation < 50 ? '⚠️' : '❌';
            console.log(`   ${status} ${idx + 1}. ${n.note}: ${n.frequency.toFixed(1)}Hz vs ${expectedFreq.toFixed(1)}Hz (${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents) dur:${n.duration.toFixed(0)}ms conf:${(n.confidence * 100).toFixed(0)}%`);
          });

          // Calculate average deviation to detect systematic pitch shift
          const avgCents = result.notes.length > 0 ? result.notes.reduce((sum: number, n: any) => {
            const expectedFreq = noteToFrequency(n.note);
            return sum + calculateCents(n.frequency, expectedFreq);
          }, 0) / result.notes.length : 0;

          if (Math.abs(avgCents) > 10) {
            console.log(`\n🔧 CALIBRATION ISSUE DETECTED:`);
            console.log(`   Average deviation: ${avgCents > 0 ? '+' : ''}${avgCents.toFixed(0)} cents`);
            console.log(`   ${avgCents > 0 ? 'All notes are SHARP' : 'All notes are FLAT'}`);
            console.log(`   This suggests systematic pitch shift - possible causes:`);
            console.log(`   - Recording played at wrong speed`);
            console.log(`   - Audio sample rate mismatch`);
            console.log(`   - YouTube playback speed not 1.0x`);
          }

          console.log('\n   Next: Phase 3 - Validate fast algorithm');

          // Update state with ground truth
          const groundTruth: GroundTruthScore = {
            notes: result.notes,
            totalDuration: result.totalDuration,
            algorithm: result.algorithm
          };

          setTestingSession(prev => ({
            ...prev,
            phase: 'idle',
            groundTruth: groundTruth
          }));
        } else if (data.type === 'ground_truth_error') {
          // Clear analysis timeout
          if ((window as any).phase2Timeout) {
            clearTimeout((window as any).phase2Timeout);
          }

          console.error('❌ Ground truth analysis failed:', data.error);
          setTestingSession(prev => ({ ...prev, phase: 'idle' }));
        } else if (data.type === 'detection') {
          const notes = data.notes || [];
          const isChord = data.is_chord || false;
          const numNotes = data.num_notes || notes.length;

          // Enhanced logging for polyphonic detection with frequency analysis
          if (isChord || numNotes > 1) {
            console.log(`🎹 CHORD DETECTED: ${notes.join(' + ')} (${numNotes} notes, avg confidence: ${(data.confidence * 100).toFixed(1)}%)`);
            if (data.frequencies) {
              const freqStr = data.frequencies.map((f: number) => f.toFixed(1) + 'Hz').join(', ');
              console.log(`   Frequencies: ${freqStr}`);

              // Show deviation for each note
              notes.forEach((note: string, idx: number) => {
                const detectedFreq = data.frequencies[idx];
                const expectedFreq = noteToFrequency(note);
                const cents = calculateCents(detectedFreq, expectedFreq);
                const deviation = Math.abs(cents);
                const status = deviation < 20 ? '✅' : deviation < 50 ? '⚠️' : '❌';
                console.log(`   ${status} ${note}: ${detectedFreq.toFixed(1)}Hz vs ${expectedFreq.toFixed(1)}Hz (${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents)`);
              });
            }
          } else if (notes.length > 0) {
            const note = notes[0];
            const detectedFreq = data.frequencies ? data.frequencies[0] : null;
            const expectedFreq = noteToFrequency(note);

            if (detectedFreq) {
              const cents = calculateCents(detectedFreq, expectedFreq);
              const deviation = Math.abs(cents);
              const status = deviation < 20 ? '✅' : deviation < 50 ? '⚠️' : '❌';
              console.log(`${status} Single note: ${note} at ${detectedFreq.toFixed(1)}Hz (expected: ${expectedFreq.toFixed(1)}Hz, ${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents, conf: ${(data.confidence * 100).toFixed(1)}%)`);

              if (deviation > 20) {
                console.log(`   🔍 DIAGNOSIS: ${deviation.toFixed(0)} cents off - ${deviation < 50 ? 'Slightly out of tune' : 'Significantly out of tune or wrong note!'}`);
              }
            } else {
              console.log(`🎵 Single note: ${note} (confidence: ${(data.confidence * 100).toFixed(1)}%)`);
            }
          }

          setDetectedNotes(notes);

          // Accumulate all detected notes for test validation
          notes.forEach((note: string) => {
            detectedNotesAccumulator.current.add(note);
          });

          // Practice mode progression - advance to next note if current is correct
          if (micActive && practiceMode) {
            const currentStep = practiceProgress;
            if (currentStep < practiceMode.sequence.length) {
              const expectedNote = practiceMode.sequence[currentStep].note;
              if (notes.includes(expectedNote)) {
                console.log(`✅ CORRECT! ${expectedNote} detected. Advancing from step ${currentStep} to ${currentStep + 1}`);
                console.log(`   Accumulated so far: ${Array.from(detectedNotesAccumulator.current).join(', ')}`);

                // Advance to next note after brief delay to show green feedback
                setTimeout(() => {
                  setPracticeProgress(prev => prev + 1);
                  setDetectedNotes([]); // Clear immediately when advancing
                  console.log('   Advanced to next note');
                }, 600);
              } else if (notes.length > 0) {
                console.log(`❌ Wrong note: Expected ${expectedNote}, got ${notes.join(', ')}`);
              }
            } else if (practiceProgress >= practiceMode.sequence.length) {
              console.log(`🎉 Practice complete! All ${practiceMode.sequence.length} notes played.`);
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    wsRef.current = ws;

    return () => {
      ws.close();
      // Clean up microphone on unmount
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (micProcessorRef.current) {
        micProcessorRef.current.disconnect();
      }
    };
  }, []);

  // Play a single note
  const playSingleNote = async (noteItem: NoteSequenceItem, noteIndex: number) => {
    if (!audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // CRITICAL: Resume AudioContext if suspended (browser autoplay policy)
    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('🔊 AudioContext resumed');
    }

    setCurrentNoteIndex(noteIndex);
    setDetectedNotes([]);

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(noteItem.frequency, ctx.currentTime);

    // Envelope: fade in and out
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + noteItem.duration / 1000 - 0.01);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + noteItem.duration / 1000);

    // Connect for BOTH detection AND sound output
    oscillator.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(ctx.destination); // SPEAKERS!
    analyser.connect(processor);
    processor.connect(ctx.destination);

    // Capture and send audio chunks
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const samplesArray = Array.from(inputData);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            samples: samplesArray,
            sample_rate: 44100,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    };

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + noteItem.duration / 1000);

    // Wait for note to complete
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        processor.disconnect();
        oscillator.disconnect();
        gainNode.disconnect();
        analyser.disconnect();

        // Save detected notes for this note index (using ref for sync access)
        const detected = Array.from(detectedNotesAccumulator.current);
        sequenceDetectionsRef.current[noteIndex] = detected;
        setSequenceDetections(prev => ({ ...prev, [noteIndex]: detected }));

        console.log(`  Note ${noteIndex}: Expected ${noteItem.note}, Detected: ${detected.join(', ')}`);

        resolve();
      }, noteItem.duration + 100);
    });
  };

  // Play simultaneous notes (chord)
  const playSimultaneousNotes = async (chordItem: ChordItem, chordIndex: number) => {
    if (!audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('🔊 AudioContext resumed');
    }

    setCurrentNoteIndex(chordIndex);
    setDetectedNotes([]);

    // Create oscillators for each note in the chord
    const oscillators: OscillatorNode[] = [];
    const gainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    // Create oscillator for each note
    chordItem.notes.forEach(note => {
      const freq = NOTE_FREQUENCIES[note];
      if (freq) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        osc.connect(gainNode);
        oscillators.push(osc);
      }
    });

    // Envelope: fade in and out
    const volume = 0.2 / chordItem.notes.length; // Reduce volume per note to avoid clipping
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + chordItem.duration / 1000 - 0.01);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + chordItem.duration / 1000);

    // Connect for BOTH detection AND sound output
    gainNode.connect(analyser);
    gainNode.connect(ctx.destination); // SPEAKERS!
    analyser.connect(processor);
    processor.connect(ctx.destination);

    // Capture and send audio chunks
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const samplesArray = Array.from(inputData);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            samples: samplesArray,
            sample_rate: 44100,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    };

    // Start all oscillators
    oscillators.forEach(osc => {
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + chordItem.duration / 1000);
    });

    console.log(`🎹 Playing chord: ${chordItem.notes.join(' + ')}`);

    // Wait for chord to complete
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        processor.disconnect();
        oscillators.forEach(osc => osc.disconnect());
        gainNode.disconnect();
        analyser.disconnect();

        // Save detected notes for this chord index
        const detected = Array.from(detectedNotesAccumulator.current);
        sequenceDetectionsRef.current[chordIndex] = detected;
        setSequenceDetections(prev => ({ ...prev, [chordIndex]: detected }));

        console.log(`  Chord ${chordIndex}: Expected ${chordItem.notes.join('+')}, Detected: ${detected.join(', ')}`);

        resolve();
      }, chordItem.duration + 100);
    });
  };

  // Play test sequence
  const playTestTone = async (testCase: TestCase) => {
    if (!audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('Audio context or WebSocket not ready');
      return;
    }

    setCurrentTest(testCase);
    setIsPlaying(true);
    setCurrentNoteIndex(-1);
    setDetectedNotes([]);
    setSequenceDetections({});
    sequenceDetectionsRef.current = {}; // Clear ref

    // Clear accumulator for this test
    detectedNotesAccumulator.current.clear();

    // Check if this is a chord test or sequential test
    if (testCase.chords && testCase.chords.length > 0) {
      // CHORD TEST (polyphonic)
      const allExpectedChords = testCase.chords.map(c => c.notes.join('+'));
      console.log(`\n🎹 Starting CHORD test: ${testCase.name}`);
      console.log(`  Category: ${testCase.category}`);
      console.log(`  Chords: ${allExpectedChords.join(' → ')}`);

      // Play each chord
      for (let i = 0; i < testCase.chords.length; i++) {
        detectedNotesAccumulator.current.clear(); // Clear for each chord
        await playSimultaneousNotes(testCase.chords[i], i);
        await new Promise(resolve => setTimeout(resolve, 200)); // Gap between chords
      }

      setIsPlaying(false);
      setCurrentNoteIndex(-1);

      // Check success: all notes in each chord must be detected
      let correctCount = 0;
      testCase.chords.forEach((chordItem, idx) => {
        const detected = sequenceDetectionsRef.current[idx] || [];
        const allNotesDetected = chordItem.notes.every(note => detected.includes(note));
        if (allNotesDetected) {
          correctCount++;
        }
      });

      const successRate = (correctCount / testCase.chords.length) * 100;
      const success = successRate >= 70;

      console.log(`\n✅ Chord test ${testCase.name} complete:`);
      console.log(`  Expected: ${allExpectedChords.join(' → ')}`);
      console.log(`  Correct: ${correctCount}/${testCase.chords.length} (${successRate.toFixed(0)}%)`);
      console.log(`  Result: ${success ? 'PASS ✅' : 'FAIL ❌'}\n`);

      setTestResults(prev => ({ ...prev, [testCase.id]: success }));

    } else {
      // SEQUENTIAL TEST (monophonic)
      const allExpectedNotes = testCase.sequence.map(s => s.note);
      console.log(`\n🎵 Starting test: ${testCase.name}`);
      console.log(`  Category: ${testCase.category}`);
      console.log(`  Sequence: ${allExpectedNotes.join(' → ')}`);

      // Play each note in sequence
      for (let i = 0; i < testCase.sequence.length; i++) {
        detectedNotesAccumulator.current.clear(); // Clear for each note
        await playSingleNote(testCase.sequence[i], i);
        await new Promise(resolve => setTimeout(resolve, 100)); // Gap between notes
      }

      setIsPlaying(false);
      setCurrentNoteIndex(-1);

      // Check success: at least 70% of notes detected correctly (using ref for sync access)
      let correctCount = 0;
      testCase.sequence.forEach((noteItem, idx) => {
        const detected = sequenceDetectionsRef.current[idx] || [];
        if (detected.includes(noteItem.note)) {
          correctCount++;
        }
      });

      const successRate = (correctCount / testCase.sequence.length) * 100;
      const success = successRate >= 70;

      console.log(`\n✅ Test ${testCase.name} complete:`);
      console.log(`  Expected: ${allExpectedNotes.join(' → ')}`);
      console.log(`  Correct: ${correctCount}/${testCase.sequence.length} (${successRate.toFixed(0)}%)`);
      console.log(`  Result: ${success ? 'PASS ✅' : 'FAIL ❌'}\n`);

      setTestResults(prev => ({ ...prev, [testCase.id]: success }));
    }
  };

  // Run all tests
  const runAllTests = async () => {
    for (const test of TEST_CASES) {
      await new Promise(resolve => setTimeout(resolve, 200)); // Wait between tests
      await playTestTone(test);
      await new Promise(resolve => setTimeout(resolve, 200)); // Gap before next test
    }
  };

  // Handle audio file upload
  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !audioContextRef.current) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      setUploadedAudio(audioBuffer);
      setUploadedFileName(file.name);
      console.log(`✅ Loaded audio file: ${file.name} (${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels} channels)`);
    } catch (error) {
      console.error('Failed to load audio file:', error);
      alert('Failed to load audio file. Make sure it\'s a valid audio format (MP3, WAV, etc.)');
    }
  };

  // Play uploaded audio file and detect
  const playUploadedAudio = async () => {
    if (!uploadedAudio || !audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('Audio file, context, or WebSocket not ready');
      return;
    }

    const ctx = audioContextRef.current;

    // Resume AudioContext if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
      console.log('🔊 AudioContext resumed');
    }

    setIsPlaying(true);
    setDetectedNotes([]);
    detectedNotesAccumulator.current.clear();

    console.log(`\n🎵 Playing uploaded file: ${uploadedFileName}`);

    const source = ctx.createBufferSource();
    source.buffer = uploadedAudio;

    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    // Connect for both playback and detection
    source.connect(analyser);
    source.connect(ctx.destination); // SPEAKERS!
    analyser.connect(processor);
    processor.connect(ctx.destination);

    // Capture and send audio chunks
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const samplesArray = Array.from(inputData);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            samples: samplesArray,
            sample_rate: ctx.sampleRate,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    };

    source.start(0);

    // Stop after file duration
    setTimeout(() => {
      source.stop();
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
      setIsPlaying(false);

      const detected = Array.from(detectedNotesAccumulator.current);
      console.log(`✅ Playback complete. Detected notes: ${detected.join(', ')}`);
    }, uploadedAudio.duration * 1000 + 100);
  };

  // Start microphone capture
  const startMicrophone = async () => {
    if (!audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setMicError('AudioContext or WebSocket not ready');
      return;
    }

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      const ctx = audioContextRef.current;

      // Resume AudioContext if suspended
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      // Connect microphone to processor (no speakers to avoid feedback)
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      // Capture and send audio chunks
      let chunkCount = 0;
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const samplesArray = Array.from(inputData);

          // Log every 50th chunk to verify audio is flowing
          chunkCount++;
          if (chunkCount % 50 === 0) {
            const rms = Math.sqrt(samplesArray.reduce((sum, val) => sum + val * val, 0) / samplesArray.length);
            console.log(`🎤 Audio chunk ${chunkCount}: RMS=${rms.toFixed(4)}`);
          }

          wsRef.current.send(JSON.stringify({
            type: 'audio_chunk',
            data: {
              samples: samplesArray,
              sample_rate: ctx.sampleRate,
            },
            timestamp: new Date().toISOString(),
          }));
        }
      };

      micStreamRef.current = stream;
      micProcessorRef.current = processor;
      setMicActive(true);
      setMicError('');
      setDetectedNotes([]);
      detectedNotesAccumulator.current.clear();

      console.log('🎤 Microphone started - play music from any device!');
    } catch (error) {
      console.error('Microphone access error:', error);
      setMicError('Microphone access denied. Please allow microphone in browser settings.');
    }
  };

  // Stop microphone capture
  const stopMicrophone = () => {
    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }

    setMicActive(false);
    setPracticeMode(null);
    setPracticeProgress(0);
    console.log('🎤 Microphone stopped');
  };

  // Start recording microphone input
  const startRecording = () => {
    if (!micStreamRef.current) {
      console.error('Microphone not active');
      return;
    }

    try {
      const mediaRecorder = new MediaRecorder(micStreamRef.current, {
        mimeType: 'audio/webm',
      });

      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        setRecordedAudioBlob(blob);

        // Decode audio for analysis
        if (audioContextRef.current) {
          try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            setRecordedAudioBuffer(audioBuffer);
            setShowAnalysisPanel(true);
            console.log(`💾 Recording captured: ${audioBuffer.duration.toFixed(2)}s`);
          } catch (error) {
            console.error('Failed to decode recorded audio:', error);
          }
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      console.log('🔴 Recording started');
    } catch (error) {
      console.error('Failed to start recording:', error);
    }
  };

  // Stop recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      console.log('⏹️ Recording stopped');
    }
  };

  // Export test sequence as audio file
  const exportTestAudio = async (test: TestCase) => {
    if (!audioContextRef.current) return;

    const ctx = audioContextRef.current;
    const totalDuration = test.sequence.reduce((sum, note) => sum + note.duration / 1000, 0);
    const gapDuration = 0.1; // 100ms gap between notes
    const totalWithGaps = totalDuration + (test.sequence.length - 1) * gapDuration;

    // Create offline context for rendering
    const offlineCtx = new OfflineAudioContext(1, 44100 * totalWithGaps, 44100);

    let currentTime = 0;

    // Generate each note in sequence
    test.sequence.forEach((noteItem, idx) => {
      const oscillator = offlineCtx.createOscillator();
      const gainNode = offlineCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(noteItem.frequency, currentTime);

      const duration = noteItem.duration / 1000;

      // Envelope
      gainNode.gain.setValueAtTime(0, currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, currentTime + 0.01);
      gainNode.gain.linearRampToValueAtTime(0.3, currentTime + duration - 0.01);
      gainNode.gain.linearRampToValueAtTime(0, currentTime + duration);

      oscillator.connect(gainNode);
      gainNode.connect(offlineCtx.destination);

      oscillator.start(currentTime);
      oscillator.stop(currentTime + duration);

      currentTime += duration + gapDuration;
    });

    // Render audio
    const renderedBuffer = await offlineCtx.startRendering();

    // Convert to WAV
    const wav = audioBufferToWav(renderedBuffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);

    // Download
    const a = document.createElement('a');
    a.href = url;
    a.download = `${test.id}_${test.name.replace(/\s+/g, '_')}.wav`;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`💾 Exported: ${test.name}`);
  };

  // Analyze recorded audio with high-accuracy FFT detection
  const analyzeRecording = async () => {
    if (!recordedAudioBuffer || !audioContextRef.current) return;

    setIsAnalyzing(true);
    console.log('🔬 Starting high-accuracy analysis...');

    const buffer = recordedAudioBuffer;
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    // FFT analysis parameters
    const fftSize = 8192; // Larger FFT for better frequency resolution
    const hopSize = 2048; // Window hop (25% overlap)
    const windowSize = fftSize;

    const detectedSequence: NoteSequenceItem[] = [];
    let currentNote: string | null = null;
    let noteStartTime = 0;
    let consecutiveFrames = 0;
    const minConsecutiveFrames = 3; // Need 3 consecutive frames to confirm a note

    // Process audio in windows
    for (let i = 0; i + windowSize < channelData.length; i += hopSize) {
      const window = channelData.slice(i, i + windowSize);

      // Apply Hann window
      const windowed = window.map((sample, idx) => {
        const hannValue = 0.5 * (1 - Math.cos((2 * Math.PI * idx) / (windowSize - 1)));
        return sample * hannValue;
      });

      // Simple autocorrelation for pitch detection
      const frequency = detectPitchAutocorrelation(windowed, sampleRate);

      if (frequency) {
        const note = frequencyToNote(frequency);

        if (note === currentNote) {
          consecutiveFrames++;
        } else {
          // Note changed - save previous if it was stable
          if (currentNote && consecutiveFrames >= minConsecutiveFrames) {
            const duration = ((i - noteStartTime) / sampleRate) * 1000;
            if (duration > 50) { // Ignore very short notes (noise)
              detectedSequence.push({
                note: currentNote,
                frequency: noteToFrequency(currentNote),
                duration: Math.round(duration)
              });
              console.log(`  Detected: ${currentNote} (${duration.toFixed(0)}ms)`);
            }
          }

          currentNote = note;
          noteStartTime = i;
          consecutiveFrames = 1;
        }
      }
    }

    // Add final note if stable
    if (currentNote && consecutiveFrames >= minConsecutiveFrames) {
      const duration = ((channelData.length - noteStartTime) / sampleRate) * 1000;
      if (duration > 50) {
        detectedSequence.push({
          note: currentNote,
          frequency: noteToFrequency(currentNote),
          duration: Math.round(duration)
        });
        console.log(`  Detected: ${currentNote} (${duration.toFixed(0)}ms)`);
      }
    }

    setAnalyzedScore(detectedSequence);
    setIsAnalyzing(false);
    console.log(`✅ Analysis complete: ${detectedSequence.length} notes detected`);
  };

  // Autocorrelation pitch detection
  const detectPitchAutocorrelation = (buffer: Float32Array, sampleRate: number): number | null => {
    const minFreq = 80; // C2
    const maxFreq = 1200; // D#6
    const minPeriod = Math.floor(sampleRate / maxFreq);
    const maxPeriod = Math.floor(sampleRate / minFreq);

    let bestCorrelation = 0;
    let bestPeriod = 0;

    // Autocorrelation with fundamental bias
    for (let period = minPeriod; period < maxPeriod; period++) {
      let correlation = 0;
      for (let i = 0; i < buffer.length - period; i++) {
        correlation += buffer[i] * buffer[i + period];
      }

      // CRITICAL FIX: Bias toward lower frequencies (fundamentals over harmonics)
      // Longer period = lower frequency = fundamental
      // Add 30% bonus for each doubling of period
      const fundamentalBias = 1.0 + (0.3 * Math.log2(period / minPeriod));
      const biasedCorrelation = correlation * fundamentalBias;

      if (biasedCorrelation > bestCorrelation) {
        bestCorrelation = biasedCorrelation;
        bestPeriod = period;
      }
    }

    // Threshold for valid pitch
    if (bestCorrelation < 0.01) return null;

    return sampleRate / bestPeriod;
  };

  // Convert frequency to nearest note
  const frequencyToNote = (frequency: number): string => {
    const A4 = 440;
    const C0 = A4 * Math.pow(2, -4.75);
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const halfSteps = 12 * Math.log2(frequency / C0);
    const noteIndex = Math.round(halfSteps);
    const octave = Math.floor(noteIndex / 12);
    const note = noteNames[noteIndex % 12];

    return `${note}${octave}`;
  };

  // Convert note to frequency
  const noteToFrequency = (note: string): number => {
    const noteMatch = note.match(/^([A-G]#?)(\d)$/);
    if (!noteMatch) return 440;

    const [, noteName, octaveStr] = noteMatch;
    const octave = parseInt(octaveStr);

    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteIndex = noteNames.indexOf(noteName);

    const A4 = 440;
    const halfSteps = (octave - 4) * 12 + (noteIndex - 9);
    return A4 * Math.pow(2, halfSteps / 12);
  };

  // Calculate cents deviation (musical pitch measurement)
  const calculateCents = (detectedFreq: number, expectedFreq: number): number => {
    if (expectedFreq === 0) return 0;
    return 1200 * Math.log2(detectedFreq / expectedFreq);
  };

  // Replay recorded audio with analyzed score as reference
  const replayWithScore = async () => {
    if (!recordedAudioBuffer || !audioContextRef.current || !wsRef.current || analyzedScore.length === 0) {
      console.error('Missing recording, audio context, or analyzed score');
      return;
    }

    const ctx = audioContextRef.current;

    // Resume AudioContext if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    setIsPlaying(true);
    setDetectedNotes([]);
    detectedNotesAccumulator.current.clear();
    setCurrentTest({
      id: 'analyzed',
      name: 'Analyzed Recording',
      category: 'melody',
      difficulty: 'advanced',
      sequence: analyzedScore,
      description: 'Ground truth from high-accuracy analysis'
    });
    setCurrentNoteIndex(0);

    console.log(`\n🎵 Replaying with analyzed score (${analyzedScore.length} notes)`);
    console.log(`   Expected sequence: ${analyzedScore.map(n => n.note).join(' → ')}`);

    const source = ctx.createBufferSource();
    source.buffer = recordedAudioBuffer;

    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    // Connect for both playback and detection
    source.connect(analyser);
    source.connect(ctx.destination);
    analyser.connect(processor);
    processor.connect(ctx.destination);

    // Capture and send audio chunks
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const samplesArray = Array.from(inputData);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            samples: samplesArray,
            sample_rate: ctx.sampleRate,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    };

    source.start(0);

    // Stop after file duration
    setTimeout(() => {
      source.stop();
      processor.disconnect();
      analyser.disconnect();
      source.disconnect();
      setIsPlaying(false);
      setCurrentTest(null);
      setCurrentNoteIndex(-1);

      const detected = Array.from(detectedNotesAccumulator.current);
      const correct = detected.filter(d => analyzedScore.some(a => a.note === d)).length;
      const accuracy = (correct / analyzedScore.length) * 100;

      console.log(`\n✅ Replay complete:`);
      console.log(`   Expected: ${analyzedScore.map(n => n.note).join(', ')}`);
      console.log(`   Detected: ${detected.join(', ')}`);
      console.log(`   Accuracy: ${correct}/${analyzedScore.length} (${accuracy.toFixed(1)}%)`);
    }, recordedAudioBuffer.duration * 1000 + 100);
  };

  // Download analyzed score as JSON
  const downloadAnalyzedScore = () => {
    const data = {
      duration: recordedAudioBuffer?.duration || 0,
      sampleRate: recordedAudioBuffer?.sampleRate || 44100,
      sequence: analyzedScore,
      timestamp: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analyzed_score_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('💾 Downloaded analyzed score');
  };

  // Download original recording
  const downloadRecording = () => {
    if (!recordedAudioBlob) return;

    const url = URL.createObjectURL(recordedAudioBlob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording_${timestamp}.webm`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`💾 Downloaded recording: ${filename}`);
  };

  // Convert AudioBuffer to WAV format
  const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
    const length = buffer.length * buffer.numberOfChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, buffer.numberOfChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * buffer.numberOfChannels * 2, true);
    view.setUint16(32, buffer.numberOfChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);

    // Write audio data
    const channelData = buffer.getChannelData(0);
    let offset = 44;
    for (let i = 0; i < channelData.length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return arrayBuffer;
  };

  // ==================== 5-PHASE TESTING PIPELINE ====================

  // Phase 1: Start recording reference audio
  const startPhase1Recording = async () => {
    if (!audioContextRef.current || !wsRef.current) return;

    console.log('\n🎯 PHASE 1: Recording reference audio...');
    setTestingSession(prev => ({ ...prev, phase: 'phase1_recording' }));
    setDetectedNotes([]); // Clear previous detections
    detectedNotesAccumulator.current.clear();

    // Start microphone recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // Set up MediaRecorder for saving audio
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContextRef.current!.decodeAudioData(arrayBuffer);

        console.log(`✅ Phase 1 complete: ${audioBuffer.duration.toFixed(2)}s recorded`);
        console.log(`   Detected notes during recording: ${Array.from(detectedNotesAccumulator.current).join(', ')}`);
        console.log('   Starting Phase 2 - Generate ground truth...');

        // Auto-start Phase 2
        setTestingSession(prev => ({
          ...prev,
          phase: 'phase2_groundtruth',
          referenceAudio: audioBuffer,
        }));

        // Clean up audio processing
        if (micProcessorRef.current) {
          micProcessorRef.current.disconnect();
          micProcessorRef.current = null;
        }
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);

        // Start Phase 2 after brief delay
        setTimeout(() => startPhase2GroundTruth(audioBuffer), 500);
      };

      // Set up real-time audio processing for visual feedback
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      const processor = ctx.createScriptProcessor(4096, 1, 1);

      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      let chunkCount = 0;
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        chunkCount++;

        // Send to backend for real-time detection
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio_chunk',
            data: { samples: Array.from(inputData), sample_rate: ctx.sampleRate }
          }));
        }

        // Calculate volume for visual feedback
        if (chunkCount % 10 === 0) {
          const rms = Math.sqrt(inputData.reduce((sum, val) => sum + val * val, 0) / inputData.length);
          console.log(`🎤 Phase 1 Recording... Volume: ${(rms * 100).toFixed(1)}%`);
        }
      };

      micProcessorRef.current = processor;

      // Start recording
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);

      console.log('   🔴 Recording started... Click "Stop Phase 1" when done');
      console.log('   Real-time detection active - watch for notes appearing below');

    } catch (error) {
      console.error('Failed to start recording:', error);
      setMicError(`Microphone error: ${error}`);
      setTestingSession(prev => ({ ...prev, phase: 'idle' }));
    }
  };

  const stopPhase1Recording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      console.log('   Stopping recording...');
    }
  };

  // Phase 2: Generate ground truth using backend YIN algorithm (PROPER)
  const startPhase2GroundTruth = async (audioBuffer: AudioBuffer) => {
    console.log('\n🎯 PHASE 2: Sending audio to backend for YIN ground truth analysis...');
    setTestingSession(prev => ({ ...prev, phase: 'phase2_groundtruth' }));

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected');
      setTestingSession(prev => ({ ...prev, phase: 'idle' }));
      return;
    }

    // Convert AudioBuffer to samples array
    const channelData = audioBuffer.getChannelData(0);
    const samples = Array.from(channelData);

    console.log(`   Sending ${samples.length.toLocaleString()} samples (${audioBuffer.duration.toFixed(2)}s) to backend...`);
    console.log(`   JSON payload size: ~${(JSON.stringify(samples).length / 1024 / 1024).toFixed(2)} MB`);

    // Set timeout for analysis (60 seconds max)
    const analysisTimeout = setTimeout(() => {
      console.error('❌ Phase 2 analysis timeout (60s) - backend may be overloaded');
      setTestingSession(prev => ({ ...prev, phase: 'idle' }));
    }, 60000);

    // Store timeout in ref so we can clear it when result arrives
    (window as any).phase2Timeout = analysisTimeout;

    try {
      // Send to backend for YIN analysis
      wsRef.current.send(JSON.stringify({
        type: 'analyze_full_audio',
        data: {
          samples: samples,
          sample_rate: audioBuffer.sampleRate
        }
      }));

      console.log('   ⏳ Waiting for backend YIN analysis... (this may take 10-30 seconds for long recordings)');
      console.log('   💡 Check backend terminal for progress updates');
    } catch (error) {
      console.error('❌ Failed to send audio for analysis:', error);
      clearTimeout(analysisTimeout);
      setTestingSession(prev => ({ ...prev, phase: 'idle' }));
    }
  };

  // Phase 3: Validate fast algorithm against ground truth (same audio file)
  const startPhase3Validation = async () => {
    if (!testingSession.referenceAudio || !testingSession.groundTruth) {
      console.error('Cannot start Phase 3: Missing reference audio or ground truth');
      return;
    }

    console.log('\n🎯 PHASE 3: Validating fast algorithm (playing same recording)...');
    setTestingSession(prev => ({ ...prev, phase: 'phase3_validate_fast' }));

    const ctx = audioContextRef.current!;
    if (ctx.state === 'suspended') await ctx.resume();

    const source = ctx.createBufferSource();
    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    source.buffer = testingSession.referenceAudio;
    source.connect(analyser);
    source.connect(ctx.destination);
    analyser.connect(processor);
    processor.connect(ctx.destination);

    const detectedNotesList: string[] = [];

    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: { samples: Array.from(inputData), sample_rate: ctx.sampleRate }
        }));
      }
    };

    // Collect detections via WebSocket (already handled in ws.onmessage)
    const originalHandler = wsRef.current!.onmessage;
    wsRef.current!.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'detection' && data.notes) {
        data.notes.forEach((note: string) => {
          if (!detectedNotesList.includes(note)) {
            detectedNotesList.push(note);
          }
        });
      }
      originalHandler?.call(wsRef.current, event);
    };

    source.start();

    source.onended = () => {
      processor.disconnect();
      wsRef.current!.onmessage = originalHandler;

      // Calculate validation metrics
      const result = calculateValidationMetrics(
        testingSession.groundTruth!.notes.map(n => n.note),
        detectedNotesList
      );

      setTestingSession(prev => ({
        ...prev,
        phase: 'idle',
        phase3Result: result
      }));

      console.log(`✅ Phase 3 complete:`);
      console.log(`   Precision: ${(result.precision * 100).toFixed(1)}%`);
      console.log(`   Recall: ${(result.recall * 100).toFixed(1)}%`);
      console.log(`   F1 Score: ${(result.f1Score * 100).toFixed(1)}%`);
      console.log(`   Next: Phase 4 - Test YouTube/external playback`);
    };
  };

  // Phase 4: Test with external playback (YouTube/speakers) + microphone
  const startPhase4ExternalTest = async () => {
    if (!testingSession.groundTruth) {
      console.error('Cannot start Phase 4: Missing ground truth');
      return;
    }

    console.log('\n🎯 PHASE 4: Testing with external playback...');
    console.log('   Instructions:');
    console.log('   1. Play the reference audio through speakers/YouTube');
    console.log('   2. Microphone will capture and detect');
    console.log('   3. Click "Stop Phase 4" when playback complete');

    setTestingSession(prev => ({ ...prev, phase: 'phase4_youtube' }));

    // Start microphone capture with fast detection
    await startMicrophone();
  };

  const stopPhase4ExternalTest = () => {
    console.log('   Stopping Phase 4...');
    stopMicrophone();

    // Calculate validation metrics
    const detectedNotesList = Array.from(detectedNotesAccumulator.current);
    const result = calculateValidationMetrics(
      testingSession.groundTruth!.notes.map(n => n.note),
      detectedNotesList
    );

    setTestingSession(prev => ({
      ...prev,
      phase: 'idle',
      phase4Result: result
    }));

    console.log(`✅ Phase 4 complete:`);
    console.log(`   Precision: ${(result.precision * 100).toFixed(1)}%`);
    console.log(`   Recall: ${(result.recall * 100).toFixed(1)}%`);
    console.log(`   F1 Score: ${(result.f1Score * 100).toFixed(1)}%`);
    console.log(`   Next: Phase 5 - Live piano performance`);

    detectedNotesAccumulator.current.clear();
  };

  // Phase 5: Live performance feedback
  const startPhase5LivePerformance = async () => {
    if (!testingSession.groundTruth) {
      console.error('Cannot start Phase 5: Missing ground truth');
      return;
    }

    console.log('\n🎯 PHASE 5: Live performance feedback...');
    console.log('   Instructions:');
    console.log('   1. Play the tune on your piano');
    console.log('   2. Real-time feedback will show correct/incorrect notes');
    console.log('   3. Click "Stop Phase 5" when done');

    setTestingSession(prev => ({ ...prev, phase: 'phase5_live' }));

    // Start microphone with ground truth validation
    await startMicrophone();
  };

  const stopPhase5LivePerformance = () => {
    console.log('   Stopping Phase 5...');
    stopMicrophone();

    // Calculate final performance metrics
    const detectedNotesList = Array.from(detectedNotesAccumulator.current);
    const result = calculateValidationMetrics(
      testingSession.groundTruth!.notes.map(n => n.note),
      detectedNotesList
    );

    setTestingSession(prev => ({
      ...prev,
      phase: 'idle',
      phase5Result: result
    }));

    console.log(`✅ Phase 5 complete:`);
    console.log(`   Precision: ${(result.precision * 100).toFixed(1)}%`);
    console.log(`   Recall: ${(result.recall * 100).toFixed(1)}%`);
    console.log(`   F1 Score: ${(result.f1Score * 100).toFixed(1)}%`);
    console.log('\n🎉 All 5 phases complete!');

    detectedNotesAccumulator.current.clear();
  };

  // Calculate validation metrics (precision, recall, F1)
  const calculateValidationMetrics = (expectedNotes: string[], detectedNotes: string[]): ValidationResult => {
    const expectedSet = new Set(expectedNotes);
    const detectedSet = new Set(detectedNotes);

    const truePositives = detectedNotes.filter(note => expectedSet.has(note)).length;
    const falsePositives = detectedNotes.filter(note => !expectedSet.has(note)).length;
    const falseNegatives = expectedNotes.filter(note => !detectedSet.has(note)).length;

    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

    return {
      precision,
      recall,
      f1Score,
      truePositives,
      falsePositives,
      falseNegatives,
      detectedNotes: Array.from(detectedSet),
      missedNotes: expectedNotes.filter(note => !detectedSet.has(note)),
      incorrectNotes: detectedNotes.filter(note => !expectedSet.has(note))
    };
  };

  // Reset testing session
  const resetTestingSession = () => {
    setTestingSession({
      phase: 'idle',
      referenceAudio: null,
      groundTruth: null,
      phase3Result: null,
      phase4Result: null,
      phase5Result: null,
    });
    detectedNotesAccumulator.current.clear();
    console.log('🔄 Testing session reset');
  };

  // ==================== END 5-PHASE TESTING PIPELINE ====================

  const getResultIcon = (testId: string) => {
    if (!(testId in testResults)) return '⏸️';
    return testResults[testId] ? '✅' : '❌';
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'single': return '🎵';
      case 'scale': return '🎼';
      case 'arpeggio': return '🎸';
      case 'melody': return '🎹';
      case 'chord': return '🎻';
      default: return '🎵';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'single': return { bg: '#f0f9ff', border: '#0ea5e9', text: '#0369a1' };
      case 'scale': return { bg: '#f0fdf4', border: '#22c55e', text: '#15803d' };
      case 'arpeggio': return { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' };
      case 'melody': return { bg: '#fae8ff', border: '#a855f7', text: '#6b21a8' };
      case 'chord': return { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' };
      default: return { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' };
    }
  };

  // Get currently playing note(s) for visual feedback
  const getCurrentlyExpectedNotes = (): string[] => {
    // Practice mode with microphone - show ONLY current note in sequence
    if (micActive && practiceMode) {
      if (practiceProgress < practiceMode.sequence.length) {
        return [practiceMode.sequence[practiceProgress].note];
      }
      // Completed all notes
      return [];
    }

    // If playing uploaded audio, show all detected notes as "expected" (no right/wrong)
    if (uploadedAudio && isPlaying && !currentTest) {
      return Array.from(detectedNotesAccumulator.current);
    }

    if (!currentTest) {
      return [];
    }

    // Handle CHORD tests (polyphonic)
    if (currentTest.chords && currentTest.chords.length > 0) {
      if (currentNoteIndex < 0 || currentNoteIndex >= currentTest.chords.length) {
        // Show all chords' notes when not playing
        return currentTest.chords.flatMap(c => c.notes);
      }
      // Show current chord's notes
      return currentTest.chords[currentNoteIndex].notes;
    }

    // Handle SEQUENTIAL tests (monophonic)
    if (currentNoteIndex < 0 || currentNoteIndex >= currentTest.sequence.length) {
      return currentTest.sequence.map(s => s.note);
    }
    return [currentTest.sequence[currentNoteIndex].note];
  };

  // Play a note when user clicks/taps a piano key
  const playInteractiveNote = async (note: string) => {
    if (!audioContextRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || isPlaying) {
      return;
    }

    const frequency = NOTE_FREQUENCIES[note];
    if (!frequency) {
      console.error(`Unknown note: ${note}`);
      return;
    }

    const ctx = audioContextRef.current;

    // Resume AudioContext if suspended
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    console.log(`🎹 Playing interactive note: ${note} (${frequency.toFixed(1)} Hz)`);

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const analyser = ctx.createAnalyser();
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    const duration = 0.8; // 800ms duration

    // Envelope: fade in and out
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + duration - 0.1);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

    // Connect for both playback and detection
    oscillator.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(ctx.destination); // SPEAKERS!
    analyser.connect(processor);
    processor.connect(ctx.destination);

    // Capture and send audio chunks
    processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const samplesArray = Array.from(inputData);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            samples: samplesArray,
            sample_rate: 44100,
          },
          timestamp: new Date().toISOString(),
        }));
      }
    };

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);

    // Clean up after duration
    setTimeout(() => {
      processor.disconnect();
      oscillator.disconnect();
      gainNode.disconnect();
      analyser.disconnect();
    }, duration * 1000 + 100);
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, padding: '12px', display: 'flex', flexDirection: 'column', background: 'linear-gradient(to bottom right, #faf5ff, #eff6ff)' }}>
      <div style={{ flex: 1, maxWidth: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Header */}
        <div style={{ marginBottom: '8px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>🎯 Pitch Detection Test</h1>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', backgroundColor: wsConnected ? '#22c55e' : '#ef4444', color: 'white' }}>
                {wsConnected ? 'CONNECTED' : 'DISCONNECTED'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                Backend: {config.backendHttp}
              </div>
            </div>
          </div>
        </div>

        {/* Mode Toggle Buttons */}
        <div style={{ marginBottom: '8px', display: 'flex', gap: '6px', flexShrink: 0 }}>
          <button
            onClick={() => {
              setShowAlgorithmTesting(!showAlgorithmTesting);
              setShowQuickTest(!showAlgorithmTesting ? false : true);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: showAlgorithmTesting ? '#8b5cf6' : '#e5e7eb',
              color: showAlgorithmTesting ? 'white' : '#6b7280'
            }}
          >
            🧪 Algorithm Testing
          </button>
          <button
            onClick={() => {
              setShowQuickTest(!showQuickTest);
              setShowAlgorithmTesting(!showQuickTest ? false : true);
            }}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: showQuickTest ? '#8b5cf6' : '#e5e7eb',
              color: showQuickTest ? 'white' : '#6b7280'
            }}
          >
            🎯 Quick Test
          </button>
          <button
            onClick={() => setShowMicrophonePanel(!showMicrophonePanel)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '0.75rem',
              fontWeight: 'bold',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: showMicrophonePanel || micActive ? '#22c55e' : '#e5e7eb',
              color: showMicrophonePanel || micActive ? 'white' : '#6b7280'
            }}
          >
            🎤 Microphone {micActive ? '(Active)' : ''}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', flex: 1, minHeight: 0 }}>
          {/* Left Sidebar: Context-Aware Panels */}
          <div style={{ width: '224px', minWidth: '224px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'auto' }}>

            {/* 5-Phase Testing Pipeline - Only when active */}
            {showAlgorithmTesting && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0 }}>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '6px', color: '#7c3aed' }}>🧪 Algorithm Testing Pipeline</h2>

              <div style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: '8px', lineHeight: '1.4' }}>
                <strong>Systematic 5-phase testing:</strong><br/>
                1️⃣ Record reference audio<br/>
                2️⃣ Generate ground truth (high-accuracy)<br/>
                3️⃣ Validate fast algo (same file)<br/>
                4️⃣ Test YouTube playback (mic quality)<br/>
                5️⃣ Live piano performance
              </div>

              {/* Phase Status */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem' }}>
                    {testingSession.referenceAudio ? '✅' : '⏸️'} Phase 1: Record Reference
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem' }}>
                    {testingSession.groundTruth ? '✅' : '⏸️'} Phase 2: Ground Truth
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem' }}>
                    {testingSession.phase3Result ? `✅ F1: ${(testingSession.phase3Result.f1Score * 100).toFixed(0)}%` : '⏸️ Phase 3: Validate Fast Algo'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem' }}>
                    {testingSession.phase4Result ? `✅ F1: ${(testingSession.phase4Result.f1Score * 100).toFixed(0)}%` : '⏸️ Phase 4: YouTube Test'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ fontSize: '0.7rem' }}>
                    {testingSession.phase5Result ? `✅ F1: ${(testingSession.phase5Result.f1Score * 100).toFixed(0)}%` : '⏸️ Phase 5: Live Piano'}
                  </span>
                </div>
              </div>

              {/* Phase Controls */}
              {testingSession.phase === 'idle' && !testingSession.referenceAudio && (
                <button
                  onClick={startPhase1Recording}
                  style={{ width: '100%', backgroundColor: '#8b5cf6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ▶️ Start Phase 1
                </button>
              )}

              {testingSession.phase === 'phase1_recording' && (
                <>
                  <div style={{
                    backgroundColor: '#fee2e2',
                    border: '2px solid #ef4444',
                    borderRadius: '4px',
                    padding: '6px',
                    marginBottom: '4px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{
                        width: '10px',
                        height: '10px',
                        backgroundColor: '#ef4444',
                        borderRadius: '50%',
                        animation: 'pulse 1s ease-in-out infinite'
                      }}></div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#991b1b' }}>
                        🔴 RECORDING
                      </div>
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#6b7280' }}>
                      Detecting notes in real-time...
                    </div>
                    {detectedNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#059669' }}>
                        Just detected: {detectedNotes.join(', ')}
                      </div>
                    )}
                    <div style={{ fontSize: '0.65rem', color: '#6b7280' }}>
                      Total: {detectedNotesAccumulator.current.size} unique notes
                    </div>
                    <div style={{ fontSize: '0.6rem', color: '#6b7280', marginTop: '2px', fontStyle: 'italic' }}>
                      Check console for frequency details
                    </div>
                  </div>

                  <button
                    onClick={stopPhase1Recording}
                    style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                  >
                    ⏹️ Stop Phase 1
                  </button>
                </>
              )}

              {testingSession.phase === 'phase2_groundtruth' && (
                <div style={{
                  backgroundColor: '#dbeafe',
                  border: '2px solid #3b82f6',
                  borderRadius: '4px',
                  padding: '6px',
                  marginBottom: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{
                      width: '10px',
                      height: '10px',
                      backgroundColor: '#3b82f6',
                      borderRadius: '50%',
                      animation: 'pulse 1s ease-in-out infinite'
                    }}></div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1e40af' }}>
                      🔬 ANALYZING
                    </div>
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#6b7280' }}>
                    Generating ground truth with high-accuracy FFT...
                  </div>
                </div>
              )}

              {testingSession.phase === 'idle' && testingSession.groundTruth && !testingSession.phase3Result && (
                <button
                  onClick={startPhase3Validation}
                  style={{ width: '100%', backgroundColor: '#8b5cf6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ▶️ Start Phase 3
                </button>
              )}

              {testingSession.phase === 'idle' && testingSession.phase3Result && !testingSession.phase4Result && (
                <button
                  onClick={startPhase4ExternalTest}
                  style={{ width: '100%', backgroundColor: '#8b5cf6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ▶️ Start Phase 4
                </button>
              )}

              {testingSession.phase === 'phase4_youtube' && (
                <button
                  onClick={stopPhase4ExternalTest}
                  style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ⏹️ Stop Phase 4
                </button>
              )}

              {testingSession.phase === 'idle' && testingSession.phase4Result && !testingSession.phase5Result && (
                <button
                  onClick={startPhase5LivePerformance}
                  style={{ width: '100%', backgroundColor: '#8b5cf6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ▶️ Start Phase 5
                </button>
              )}

              {testingSession.phase === 'phase5_live' && (
                <button
                  onClick={stopPhase5LivePerformance}
                  style={{ width: '100%', backgroundColor: '#ef4444', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginBottom: '4px' }}
                >
                  ⏹️ Stop Phase 5
                </button>
              )}

              {testingSession.referenceAudio && (
                <button
                  onClick={resetTestingSession}
                  style={{ width: '100%', backgroundColor: '#6b7280', color: 'white', padding: '3px 6px', borderRadius: '4px', fontSize: '0.7rem', border: 'none', cursor: 'pointer' }}
                >
                  🔄 Reset Session
                </button>
              )}

              {/* Results Display with Diagnostic Info */}
              {testingSession.groundTruth && (
                <div style={{ marginTop: '6px', padding: '4px', backgroundColor: '#f0fdf4', borderRadius: '4px', fontSize: '0.65rem' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Ground Truth (Phase 2):</div>
                  <div style={{ marginBottom: '4px' }}>{testingSession.groundTruth.notes.map(n => n.note).join(' → ')}</div>
                  <div style={{ fontSize: '0.6rem', color: '#6b7280' }}>
                    Algorithm: {testingSession.groundTruth.algorithm} |
                    Duration: {testingSession.groundTruth.totalDuration.toFixed(1)}s
                  </div>

                  {/* Calculate average deviation */}
                  {(() => {
                    const avgCents = testingSession.groundTruth.notes.reduce((sum, n) => {
                      const expectedFreq = noteToFrequency(n.note);
                      return sum + calculateCents(n.frequency, expectedFreq);
                    }, 0) / testingSession.groundTruth.notes.length;

                    const hasCalibrationIssue = Math.abs(avgCents) > 10;

                    return hasCalibrationIssue && (
                      <div style={{ marginTop: '4px', padding: '3px', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '3px' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#92400e' }}>
                          ⚠️ Calibration Issue Detected
                        </div>
                        <div style={{ fontSize: '0.6rem', color: '#78350f' }}>
                          Avg deviation: {avgCents > 0 ? '+' : ''}{avgCents.toFixed(0)} cents ({avgCents > 0 ? 'sharp' : 'flat'})
                        </div>
                        <div style={{ fontSize: '0.55rem', color: '#78350f', marginTop: '2px' }}>
                          Possible cause: Sample rate mismatch or playback speed ≠ 1.0x
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ marginTop: '4px', maxHeight: '100px', overflowY: 'auto', border: '1px solid #d1d5db', borderRadius: '3px', padding: '2px' }}>
                    {testingSession.groundTruth.notes.map((n, idx) => {
                      const expectedFreq = noteToFrequency(n.note);
                      const cents = calculateCents(n.frequency, expectedFreq);
                      const deviation = Math.abs(cents);
                      const status = deviation < 20 ? '✅' : deviation < 50 ? '⚠️' : '❌';

                      return (
                        <div key={idx} style={{ fontSize: '0.6rem', color: '#374151', marginBottom: '1px', fontFamily: 'monospace' }}>
                          {status} {n.note}: {n.frequency.toFixed(1)}Hz ({cents > 0 ? '+' : ''}{cents.toFixed(0)}¢)
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              </div>
            )}

            {/* Microphone Input - Only when panel is shown or mic is active */}
            {(showMicrophonePanel || micActive) && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>🎤 Live Microphone</h2>

              {micActive ? (
                <>
                  <div style={{
                    backgroundColor: '#dcfce7',
                    border: '1px solid #22c55e',
                    borderRadius: '4px',
                    padding: '6px',
                    marginBottom: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      backgroundColor: '#22c55e',
                      borderRadius: '50%',
                      animation: 'pulse 1.5s ease-in-out infinite'
                    }}></div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#15803d' }}>
                      LISTENING
                    </div>
                  </div>

                  {/* Practice Mode Selection */}
                  <div style={{ marginBottom: '4px' }}>
                    <label style={{ fontSize: '0.65rem', color: '#6b7280', display: 'block', marginBottom: '2px' }}>
                      Practice Mode (Optional):
                    </label>
                    <select
                      value={practiceMode?.id || ''}
                      onChange={(e) => {
                        const test = TEST_CASES.find(t => t.id === e.target.value);
                        setPracticeMode(test || null);
                        setPracticeProgress(0); // Reset progress
                        setDetectedNotes([]);
                        detectedNotesAccumulator.current.clear();
                      }}
                      style={{
                        width: '100%',
                        padding: '4px',
                        borderRadius: '4px',
                        border: '1px solid #d1d5db',
                        fontSize: '0.7rem',
                        backgroundColor: 'white'
                      }}
                    >
                      <option value="">Free Play (No Score)</option>
                      {TEST_CASES.map(test => (
                        <option key={test.id} value={test.id}>
                          {getCategoryIcon(test.category)} {test.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {practiceMode && (
                    <div style={{
                      backgroundColor: '#eff6ff',
                      border: '1px solid #3b82f6',
                      borderRadius: '4px',
                      padding: '4px',
                      marginBottom: '4px',
                      fontSize: '0.65rem'
                    }}>
                      <div style={{ fontWeight: 'bold', color: '#1d4ed8', marginBottom: '4px' }}>
                        Progress: {practiceProgress}/{practiceMode.sequence.length}
                      </div>

                      {/* Sequence visualization */}
                      <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginBottom: '4px' }}>
                        {practiceMode.sequence.map((noteItem, idx) => {
                          const isCompleted = idx < practiceProgress;
                          const isCurrent = idx === practiceProgress;
                          const isPending = idx > practiceProgress;

                          return (
                            <div
                              key={idx}
                              style={{
                                padding: '2px 5px',
                                borderRadius: '3px',
                                fontSize: '0.65rem',
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                                border: isCurrent ? '2px solid #0ea5e9' : '1px solid #cbd5e1',
                                backgroundColor: isCompleted
                                  ? '#22c55e'
                                  : isCurrent
                                  ? '#06b6d4'
                                  : '#f1f5f9',
                                color: isCompleted || isCurrent ? 'white' : '#64748b',
                              }}
                            >
                              {noteItem.note}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ color: '#6b7280' }}>
                        {practiceProgress < practiceMode.sequence.length
                          ? `Play: ${practiceMode.sequence[practiceProgress].note}`
                          : '✅ Completed!'}
                      </div>
                    </div>
                  )}

                  {/* Recording button */}
                  <button
                    onClick={isRecording ? stopRecording : startRecording}
                    style={{
                      width: '100%',
                      backgroundColor: isRecording ? '#dc2626' : '#8b5cf6',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      border: 'none',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '4px'
                    }}
                  >
                    {isRecording ? (
                      <>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          backgroundColor: 'white',
                          borderRadius: '50%',
                          animation: 'pulse 1.5s ease-in-out infinite'
                        }}></div>
                        💾 Stop Recording
                      </>
                    ) : (
                      '🔴 Record Session'
                    )}
                  </button>

                  <div style={{ display: 'grid', gridTemplateColumns: practiceMode ? '1fr 1fr' : '1fr', gap: '4px' }}>
                    {practiceMode && (
                      <button
                        onClick={() => {
                          setPracticeProgress(0);
                          setDetectedNotes([]);
                          detectedNotesAccumulator.current.clear();
                          console.log('🔄 Practice sequence reset');
                        }}
                        style={{
                          backgroundColor: '#f59e0b',
                          color: 'white',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 'bold',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        🔄 Restart
                      </button>
                    )}
                    <button
                      onClick={stopMicrophone}
                      style={{
                        backgroundColor: '#ef4444',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      ⏹️ Stop
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    onClick={startMicrophone}
                    disabled={!wsConnected}
                    style={{
                      width: '100%',
                      backgroundColor: !wsConnected ? '#9ca3af' : '#22c55e',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      marginBottom: '4px',
                      border: 'none',
                      cursor: !wsConnected ? 'not-allowed' : 'pointer'
                    }}
                  >
                    🎤 Start Microphone
                  </button>
                  <div style={{ fontSize: '0.65rem', color: '#6b7280', lineHeight: '1.2' }}>
                    Play music from phone, piano, or any device. Select practice mode for score-aligned detection.
                  </div>
                  {micError && (
                    <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: '4px' }}>
                      {micError}
                    </div>
                  )}
                </>
              )}
              </div>
            )}

            {/* Two-Pass Analysis Panel */}
            {showAnalysisPanel && recordedAudioBuffer && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0, border: '2px solid #8b5cf6' }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', color: '#7c3aed' }}>
                  🔬 Two-Pass Analysis
                </h2>

                <div style={{ backgroundColor: '#faf5ff', border: '1px solid #a855f7', borderRadius: '4px', padding: '4px', marginBottom: '4px', fontSize: '0.65rem' }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>
                    Recording: {recordedAudioBuffer.duration.toFixed(2)}s
                  </div>
                  {analyzedScore.length > 0 && (
                    <div style={{ color: '#6b7280' }}>
                      Detected: {analyzedScore.length} notes
                    </div>
                  )}
                </div>

                {analyzedScore.length === 0 ? (
                  <button
                    onClick={analyzeRecording}
                    disabled={isAnalyzing}
                    style={{
                      width: '100%',
                      backgroundColor: isAnalyzing ? '#9ca3af' : '#8b5cf6',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      marginBottom: '4px',
                      border: 'none',
                      cursor: isAnalyzing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isAnalyzing ? '⏳ Analyzing...' : '🔬 Analyze (High-Accuracy)'}
                  </button>
                ) : (
                  <>
                    {/* Show detected sequence */}
                    <div style={{ marginBottom: '4px', maxHeight: '80px', overflowY: 'auto' }}>
                      <div style={{ fontSize: '0.65rem', color: '#6b7280', marginBottom: '2px' }}>
                        Detected Sequence:
                      </div>
                      <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                        {analyzedScore.map((note, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '2px 4px',
                              borderRadius: '3px',
                              fontSize: '0.65rem',
                              fontFamily: 'monospace',
                              fontWeight: 'bold',
                              backgroundColor: '#8b5cf6',
                              color: 'white'
                            }}
                          >
                            {note.note}
                          </div>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={replayWithScore}
                      disabled={isPlaying || !wsConnected}
                      style={{
                        width: '100%',
                        backgroundColor: isPlaying || !wsConnected ? '#9ca3af' : '#10b981',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        marginBottom: '4px',
                        border: 'none',
                        cursor: isPlaying || !wsConnected ? 'not-allowed' : 'pointer'
                      }}
                    >
                      ▶️ Test Fast Algorithm
                    </button>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '4px' }}>
                      <button
                        onClick={downloadRecording}
                        style={{
                          backgroundColor: '#6366f1',
                          color: 'white',
                          padding: '3px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        💾 Audio
                      </button>
                      <button
                        onClick={downloadAnalyzedScore}
                        style={{
                          backgroundColor: '#6366f1',
                          color: 'white',
                          padding: '3px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        💾 Score
                      </button>
                    </div>
                  </>
                )}

                <button
                  onClick={() => {
                    setShowAnalysisPanel(false);
                    setRecordedAudioBlob(null);
                    setRecordedAudioBuffer(null);
                    setAnalyzedScore([]);
                  }}
                  style={{
                    width: '100%',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    padding: '3px 6px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  ✕ Close
                </button>
              </div>
            )}

            {/* Audio File Upload */}
            <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0 }}>
              <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>🎼 Audio File</h2>

              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleAudioUpload}
                style={{ display: 'none' }}
              />

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isPlaying || micActive}
                style={{ width: '100%', backgroundColor: isPlaying || micActive ? '#9ca3af' : '#8b5cf6', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', border: 'none', cursor: isPlaying || micActive ? 'not-allowed' : 'pointer' }}
              >
                📁 Choose File
              </button>

              {uploadedFileName && (
                <>
                  <div style={{ fontSize: '0.65rem', color: '#6b7280', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {uploadedFileName}
                  </div>
                  <button
                    onClick={playUploadedAudio}
                    disabled={isPlaying || !wsConnected || micActive}
                    style={{ width: '100%', backgroundColor: isPlaying || !wsConnected || micActive ? '#9ca3af' : '#10b981', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', border: 'none', cursor: isPlaying || !wsConnected || micActive ? 'not-allowed' : 'pointer' }}
                  >
                    ▶️ Play & Detect
                  </button>
                </>
              )}
            </div>

            {/* Test Cases - Only in Quick Test mode */}
            {showQuickTest && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>🎯 Preset Tests</h2>

              <button
                onClick={runAllTests}
                disabled={isPlaying || !wsConnected || micActive}
                style={{ width: '100%', backgroundColor: isPlaying || !wsConnected || micActive ? '#9ca3af' : '#2563eb', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', border: 'none', cursor: isPlaying || !wsConnected || micActive ? 'not-allowed' : 'pointer' }}
              >
                ▶️ RUN ALL
              </button>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto', flex: 1 }}>
                {TEST_CASES.map(test => {
                  const categoryStyle = getCategoryColor(test.category);
                  return (
                    <button
                      key={test.id}
                      onClick={() => !isPlaying && !micActive && playTestTone(test)}
                      disabled={isPlaying || !wsConnected || micActive}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: currentTest?.id === test.id ? `2px solid ${categoryStyle.border}` : '1px solid #e5e7eb',
                        backgroundColor: currentTest?.id === test.id ? categoryStyle.bg : 'white',
                        borderRadius: '4px',
                        padding: '4px 6px',
                        fontSize: '0.75rem',
                        cursor: isPlaying || !wsConnected || micActive ? 'not-allowed' : 'pointer',
                        opacity: isPlaying || !wsConnected || micActive ? 0.5 : 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ flex: 1 }}>
                          <span style={{ fontSize: '0.875rem' }}>{getResultIcon(test.id)}</span>{' '}
                          <span style={{ fontSize: '0.875rem' }}>{getCategoryIcon(test.category)}</span>{' '}
                          {test.name}
                        </span>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            exportTestAudio(test);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              e.preventDefault();
                              exportTestAudio(test);
                            }
                          }}
                          style={{
                            backgroundColor: '#8b5cf6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            padding: '2px 6px',
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                            flexShrink: 0
                          }}
                          title="Export as audio file"
                          aria-label="Export as audio file"
                        >
                          📥
                        </div>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: '#6b7280', fontFamily: 'monospace' }}>
                        {test.sequence.map(s => s.note).join(' → ')}
                      </div>
                    </button>
                  );
                })}
              </div>
              </div>
            )}

            {/* Results Summary - Only in Quick Test mode */}
            {showQuickTest && Object.keys(testResults).length > 0 && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>Results</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px', textAlign: 'center', fontSize: '0.75rem' }}>
                <div style={{ backgroundColor: '#f9fafb', padding: '4px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold' }}>{Object.keys(testResults).length}</div>
                  <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Run</div>
                </div>
                <div style={{ backgroundColor: '#f0fdf4', padding: '4px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#15803d' }}>
                    {Object.values(testResults).filter(Boolean).length}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Pass</div>
                </div>
                <div style={{ backgroundColor: '#fef2f2', padding: '4px', borderRadius: '4px' }}>
                  <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#dc2626' }}>
                    {Object.values(testResults).filter(v => !v).length}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Fail</div>
                </div>
                {Object.keys(testResults).length > 0 && (
                  <div style={{ backgroundColor: '#eff6ff', padding: '4px', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#1d4ed8' }}>
                      {((Object.values(testResults).filter(Boolean).length / Object.keys(testResults).length) * 100).toFixed(0)}%
                    </div>
                    <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Acc</div>
                  </div>
                )}
              </div>
              </div>
            )}

            {/* Validation Results Panel - Only with Algorithm Testing */}
            {(testingSession.phase3Result || testingSession.phase4Result || testingSession.phase5Result) && (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', padding: '6px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px' }}>📊 Validation Metrics</h2>

                {testingSession.phase3Result && (
                  <div style={{ marginBottom: '6px', padding: '4px', backgroundColor: '#f0f9ff', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '2px' }}>Phase 3 (Same File):</div>
                    <div style={{ fontSize: '0.65rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px' }}>
                      <div>P: {(testingSession.phase3Result.precision * 100).toFixed(0)}%</div>
                      <div>R: {(testingSession.phase3Result.recall * 100).toFixed(0)}%</div>
                      <div>F1: {(testingSession.phase3Result.f1Score * 100).toFixed(0)}%</div>
                    </div>
                    {testingSession.phase3Result.incorrectNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#dc2626', marginTop: '2px' }}>
                        Wrong: {testingSession.phase3Result.incorrectNotes.join(', ')}
                      </div>
                    )}
                    {testingSession.phase3Result.missedNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: '2px' }}>
                        Missed: {testingSession.phase3Result.missedNotes.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {testingSession.phase4Result && (
                  <div style={{ marginBottom: '6px', padding: '4px', backgroundColor: '#fef3c7', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '2px' }}>Phase 4 (YouTube):</div>
                    <div style={{ fontSize: '0.65rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px' }}>
                      <div>P: {(testingSession.phase4Result.precision * 100).toFixed(0)}%</div>
                      <div>R: {(testingSession.phase4Result.recall * 100).toFixed(0)}%</div>
                      <div>F1: {(testingSession.phase4Result.f1Score * 100).toFixed(0)}%</div>
                    </div>
                    {testingSession.phase4Result.incorrectNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#dc2626', marginTop: '2px' }}>
                        Wrong: {testingSession.phase4Result.incorrectNotes.join(', ')}
                      </div>
                    )}
                    {testingSession.phase4Result.missedNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: '2px' }}>
                        Missed: {testingSession.phase4Result.missedNotes.join(', ')}
                      </div>
                    )}
                  </div>
                )}

                {testingSession.phase5Result && (
                  <div style={{ padding: '4px', backgroundColor: '#f0fdf4', borderRadius: '4px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 'bold', marginBottom: '2px' }}>Phase 5 (Live Piano):</div>
                    <div style={{ fontSize: '0.65rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px' }}>
                      <div>P: {(testingSession.phase5Result.precision * 100).toFixed(0)}%</div>
                      <div>R: {(testingSession.phase5Result.recall * 100).toFixed(0)}%</div>
                      <div>F1: {(testingSession.phase5Result.f1Score * 100).toFixed(0)}%</div>
                    </div>
                    {testingSession.phase5Result.incorrectNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#dc2626', marginTop: '2px' }}>
                        Wrong: {testingSession.phase5Result.incorrectNotes.join(', ')}
                      </div>
                    )}
                    {testingSession.phase5Result.missedNotes.length > 0 && (
                      <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: '2px' }}>
                        Missed: {testingSession.phase5Result.missedNotes.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Two-Part Display */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
            {/* PART 1: TONE PLAYER / EXPECTED */}
            <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', border: '2px solid #67e8f9', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ background: 'linear-gradient(to right, #06b6d4, #3b82f6)', color: 'white', padding: '4px 8px', borderTopLeftRadius: '4px', borderTopRightRadius: '4px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>🎵 TONE PLAYER (Expected)</h2>
              </div>

              <div style={{ padding: '6px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                {micActive ? (
                  <>
                    {/* Microphone Active */}
                    <div style={{ backgroundColor: practiceMode ? '#eff6ff' : '#dcfce7', border: `1px solid ${practiceMode ? '#3b82f6' : '#22c55e'}`, borderRadius: '4px', padding: '6px', marginBottom: '6px', flexShrink: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px', fontSize: '0.75rem' }}>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                            {practiceMode ? 'Practice Mode' : 'Microphone Input'}
                          </div>
                          <div style={{ fontWeight: 'bold', color: practiceMode ? '#1d4ed8' : '#15803d', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={{
                              width: '8px',
                              height: '8px',
                              backgroundColor: '#22c55e',
                              borderRadius: '50%',
                              animation: 'pulse 1.5s ease-in-out infinite'
                            }}></div>
                            {practiceMode ? `🎯 ${practiceMode.name}` : '🎤 LISTENING'}
                          </div>
                        </div>
                        {practiceMode && (
                          <>
                            <div>
                              <div style={{ color: '#6b7280', fontSize: '0.65rem', marginBottom: '2px' }}>
                                Progress: {practiceProgress}/{practiceMode.sequence.length}
                              </div>

                              {/* Sequence visualization */}
                              <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                                {practiceMode.sequence.map((noteItem, idx) => {
                                  const isCompleted = idx < practiceProgress;
                                  const isCurrent = idx === practiceProgress;

                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        padding: '2px 5px',
                                        borderRadius: '3px',
                                        fontSize: '0.65rem',
                                        fontFamily: 'monospace',
                                        fontWeight: 'bold',
                                        border: isCurrent ? '2px solid #0ea5e9' : '1px solid #cbd5e1',
                                        backgroundColor: isCompleted
                                          ? '#22c55e'
                                          : isCurrent
                                          ? '#06b6d4'
                                          : '#f1f5f9',
                                        color: isCompleted || isCurrent ? 'white' : '#64748b',
                                      }}
                                    >
                                      {noteItem.note}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>
                              {practiceProgress < practiceMode.sequence.length
                                ? `▶️ Play: ${practiceMode.sequence[practiceProgress].note}`
                                : '✅ Sequence Complete!'}
                            </div>
                          </>
                        )}
                        {!practiceMode && (
                          <div>
                            <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>
                              Play music from any external device
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <h3 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', color: '#0e7490', flexShrink: 0 }}>
                        {practiceMode ? `Expected: ${practiceProgress < practiceMode.sequence.length ? practiceMode.sequence[practiceProgress].note : 'Complete!'}` : 'Live Detection:'}
                      </h3>
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <PianoKeyboard
                          expectedNotes={getCurrentlyExpectedNotes()}
                          detectedNotes={[]}
                          showLabels={true}
                          startOctave={3}
                          endOctave={6}
                          onKeyClick={playInteractiveNote}
                          interactive={false}
                        />
                      </div>
                    </div>
                  </>
                ) : uploadedAudio && isPlaying && !currentTest ? (
                  <>
                    {/* Playing uploaded audio file */}
                    <div style={{ backgroundColor: '#faf5ff', border: '1px solid #a855f7', borderRadius: '4px', padding: '6px', marginBottom: '6px', flexShrink: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px', fontSize: '0.75rem' }}>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Playing Audio File</div>
                          <div style={{ fontWeight: 'bold', color: '#7c3aed', fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            🎼 {uploadedFileName}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.65rem' }}>Duration</div>
                          <div style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                            {uploadedAudio.duration.toFixed(2)}s
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <h3 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', color: '#0e7490', flexShrink: 0 }}>Detected Notes (Live):</h3>
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <PianoKeyboard
                          expectedNotes={getCurrentlyExpectedNotes()}
                          detectedNotes={[]}
                          showLabels={true}
                          startOctave={3}
                          endOctave={6}
                          onKeyClick={playInteractiveNote}
                          interactive={true}
                        />
                      </div>
                    </div>
                  </>
                ) : currentTest ? (
                  <>
                    <div style={{ backgroundColor: '#ecfeff', border: '1px solid #67e8f9', borderRadius: '4px', padding: '6px', marginBottom: '6px', flexShrink: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '0.75rem', marginBottom: '6px' }}>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Category</div>
                          <div style={{ fontWeight: 'bold', color: '#0e7490', fontSize: '0.75rem' }}>
                            {getCategoryIcon(currentTest.category)} {currentTest.category.toUpperCase()}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Status</div>
                          <div style={{ fontWeight: 'bold', fontSize: '0.75rem' }}>
                            {isPlaying ? `🎵 Note ${currentNoteIndex + 1}/${currentTest.sequence.length}` : '⏸️ Ready'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Difficulty</div>
                          <div style={{ fontWeight: 'bold', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                            {currentTest.difficulty}
                          </div>
                        </div>
                      </div>

                      {/* Note Sequence Display */}
                      <div style={{ marginTop: '4px' }}>
                        <div style={{ color: '#6b7280', fontSize: '0.65rem', marginBottom: '2px' }}>Sequence:</div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {currentTest.sequence.map((noteItem, idx) => {
                            const isPlaying = idx === currentNoteIndex;
                            const wasPlayed = idx < currentNoteIndex || (idx <= currentNoteIndex && !isPlaying);
                            const detected = sequenceDetections[idx] || [];
                            const isCorrect = detected.includes(noteItem.note);

                            return (
                              <div
                                key={idx}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.7rem',
                                  fontFamily: 'monospace',
                                  fontWeight: 'bold',
                                  border: isPlaying ? '2px solid #0ea5e9' : '1px solid #cbd5e1',
                                  backgroundColor: isPlaying
                                    ? '#06b6d4'
                                    : wasPlayed
                                    ? isCorrect
                                      ? '#22c55e'
                                      : '#ef4444'
                                    : '#f1f5f9',
                                  color: isPlaying || wasPlayed ? 'white' : '#64748b',
                                  animation: isPlaying ? 'pulse 0.5s ease-in-out infinite' : 'none'
                                }}
                              >
                                {noteItem.note}
                              </div>
                            );
                          })}
                        </div>
                        {currentTest.description && (
                          <div style={{ fontSize: '0.65rem', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                            {currentTest.description}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <h3 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', color: '#0e7490', flexShrink: 0 }}>
                        Expected Keys {!isPlaying && '(Click to play)'}:
                      </h3>
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <PianoKeyboard
                          expectedNotes={getCurrentlyExpectedNotes()}
                          detectedNotes={[]}
                          showLabels={true}
                          startOctave={3}
                          endOctave={6}
                          onKeyClick={playInteractiveNote}
                          interactive={!isPlaying}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', flexShrink: 0 }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '4px' }}>🎹</div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '2px' }}>Interactive Piano</div>
                        <div style={{ fontSize: '0.75rem' }}>Click any key to play</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                      <PianoKeyboard
                        expectedNotes={[]}
                        detectedNotes={[]}
                        showLabels={true}
                        startOctave={3}
                        endOctave={6}
                        onKeyClick={playInteractiveNote}
                        interactive={true}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* PART 2: DETECTOR / DETECTED */}
            <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', border: '2px solid #86efac', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ background: 'linear-gradient(to right, #10b981, #059669)', color: 'white', padding: '4px 8px', borderTopLeftRadius: '4px', borderTopRightRadius: '4px', flexShrink: 0 }}>
                <h2 style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>🎤 DETECTOR (Detected)</h2>
              </div>

              <div style={{ padding: '6px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                {currentTest || detectedNotes.length > 0 || Array.from(detectedNotesAccumulator.current).length > 0 || micActive ? (
                  <>
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac', borderRadius: '4px', padding: '6px', marginBottom: '6px', flexShrink: 0 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', fontSize: '0.75rem' }}>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Status</div>
                          <div style={{ fontWeight: 'bold', color: '#15803d', fontSize: '0.75rem' }}>
                            {micActive && practiceMode ? '🎯 Practice' : micActive ? '🎤 Microphone' : isPlaying ? '🎧 Listen' : currentTest ? '⏸️ Idle' : '🎹 Free Play'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>Detected</div>
                          <div style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#16a34a', fontSize: '0.75rem' }}>
                            {detectedNotes.length > 0 ? detectedNotes.join(', ') : '—'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                            {micActive && practiceMode ? 'Progress' : 'Accumulated'}
                          </div>
                          <div style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '0.75rem' }}>
                            {micActive && practiceMode ? (
                              <>
                                {practiceProgress} / {practiceMode.sequence.length}
                                {practiceProgress === practiceMode.sequence.length && ' ✅'}
                              </>
                            ) : (
                              Array.from(detectedNotesAccumulator.current).length > 0
                                ? Array.from(detectedNotesAccumulator.current).join(', ')
                                : '—'
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <h3 style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '4px', color: '#15803d', flexShrink: 0 }}>
                        Detected Keys {micActive && practiceMode ? '(✅ Green = Correct, ❌ Red = Wrong)' : micActive ? '(Microphone)' : !currentTest && '(Free Play)'}:
                      </h3>
                      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <PianoKeyboard
                          expectedNotes={currentTest ? getCurrentlyExpectedNotes() : (micActive && practiceMode) ? [practiceMode.sequence[practiceProgress]?.note].filter(Boolean) : detectedNotes}
                          detectedNotes={detectedNotes}
                          showLabels={true}
                          startOctave={3}
                          endOctave={6}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '4px' }}>🎤</div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '2px' }}>Detector Ready</div>
                      <div style={{ fontSize: '0.75rem' }}>Click keys above to hear & detect</div>
                      <div style={{ fontSize: '0.75rem', marginTop: '8px' }}>or start microphone</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
