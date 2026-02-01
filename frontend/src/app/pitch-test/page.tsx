"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// Types for detection events
interface DetectionEvent {
  timestamp: number;
  type: "tentative" | "confirmed" | "cancelled" | "debug";
  frequency?: number;
  note?: string;
  midi?: number;
  confidence?: number;
  rms?: number;
  cmnd?: number;
  message?: string;
  raw?: Record<string, unknown>;
}

interface TestCase {
  id: string;
  name: string;
  description: string;
  instructions: string;
  expectedNotes: string[];
  difficulty: 1 | 2 | 3 | 4 | 5;
}

const TEST_CASES: TestCase[] = [
  {
    id: "latency-test",
    name: "Latency Check",
    description: "Measure detection latency",
    instructions: "Watch the keyboard below. Play any key and observe how quickly it lights up. Should be <100ms.",
    expectedNotes: [],
    difficulty: 1,
  },
  {
    id: "single-short",
    name: "Single Short Note",
    description: "One quick staccato note",
    instructions: "Play middle C (C4) once, short and crisp",
    expectedNotes: ["C4"],
    difficulty: 1,
  },
  {
    id: "single-sustained",
    name: "Single Sustained Note",
    description: "One long held note",
    instructions: "Play middle C (C4) and hold for 3 seconds",
    expectedNotes: ["C4"],
    difficulty: 1,
  },
  {
    id: "octave-test",
    name: "Octave Clarity",
    description: "Test octave detection accuracy",
    instructions: "Play C3, then C4, then C5 slowly (one at a time)",
    expectedNotes: ["C3", "C4", "C5"],
    difficulty: 2,
  },
  {
    id: "chromatic-up",
    name: "Chromatic Scale Up",
    description: "All semitones ascending",
    instructions: "Play C4 to C5 chromatically (all keys including black)",
    expectedNotes: ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4", "C5"],
    difficulty: 3,
  },
  {
    id: "low-notes",
    name: "Low Notes",
    description: "Test low frequency detection",
    instructions: "Play C2, then C3, then E2, then G2",
    expectedNotes: ["C2", "C3", "E2", "G2"],
    difficulty: 3,
  },
  {
    id: "high-notes",
    name: "High Notes",
    description: "Test high frequency detection",
    instructions: "Play C6, then E6, then G6, then C7",
    expectedNotes: ["C6", "E6", "G6", "C7"],
    difficulty: 3,
  },
  {
    id: "fast-sequence",
    name: "Fast Sequence",
    description: "Quick note succession",
    instructions: "Play C4-E4-G4-C5 quickly (like an arpeggio)",
    expectedNotes: ["C4", "E4", "G4", "C5"],
    difficulty: 4,
  },
  {
    id: "repeated-note",
    name: "Repeated Note",
    description: "Same note multiple times",
    instructions: "Play C4 five times with short gaps",
    expectedNotes: ["C4", "C4", "C4", "C4", "C4"],
    difficulty: 4,
  },
  {
    id: "dynamics",
    name: "Dynamic Range",
    description: "Soft to loud on same note",
    instructions: "Play C4 very softly (pp), then medium (mf), then loud (ff)",
    expectedNotes: ["C4", "C4", "C4"],
    difficulty: 4,
  },
  {
    id: "black-keys",
    name: "Black Keys Only",
    description: "Test accidentals",
    instructions: "Play F#4, G#4, A#4, C#5, D#5",
    expectedNotes: ["F#4", "G#4", "A#4", "C#5", "D#5"],
    difficulty: 3,
  },
  {
    id: "soft-notes",
    name: "Very Soft Notes (pp)",
    description: "Test minimum volume detection",
    instructions: "Play C4, E4, G4 as quietly as possible (pianissimo)",
    expectedNotes: ["C4", "E4", "G4"],
    difficulty: 5,
  },
  {
    id: "trills",
    name: "Trill Test",
    description: "Rapid alternation between two notes",
    instructions: "Trill between C4 and D4 for 3 seconds",
    expectedNotes: ["C4", "D4"],
    difficulty: 5,
  },
  {
    id: "octave-jump",
    name: "Octave Jumps",
    description: "Test octave detection stability",
    instructions: "Play C3, then C5 immediately after (big jump)",
    expectedNotes: ["C3", "C5"],
    difficulty: 4,
  },
  {
    id: "release-test",
    name: "Note Release",
    description: "Test that released notes stop detecting",
    instructions: "Play and hold C4 for 2 sec, release, wait 1 sec, then play E4",
    expectedNotes: ["C4", "E4"],
    difficulty: 2,
  },
];

// Frequency to note conversion
function frequencyToNote(freq: number): { note: string; midi: number; cents: number } {
  const A4 = 440;
  const semitones = 12 * Math.log2(freq / A4);
  const midi = Math.round(semitones + 69);
  const cents = Math.round((semitones + 69 - midi) * 100);

  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const noteName = noteNames[midi % 12];
  const octave = Math.floor(midi / 12) - 1;

  return { note: `${noteName}${octave}`, midi, cents };
}

// Piano keyboard component for visual feedback
function MiniKeyboard({ activeNotes, expectedNotes }: { activeNotes: Set<string>; expectedNotes: string[] }) {
  const keys = [];
  const startMidi = 36; // C2
  const endMidi = 96;   // C7

  for (let midi = startMidi; midi <= endMidi; midi++) {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = noteNames[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    const fullNote = `${noteName}${octave}`;
    const isBlack = noteName.includes("#");
    const isActive = activeNotes.has(fullNote);
    const isExpected = expectedNotes.includes(fullNote);

    keys.push(
      <div
        key={midi}
        className={`
          ${isBlack
            ? "w-3 h-12 -mx-1.5 z-10 rounded-b"
            : "w-5 h-20 rounded-b border border-slate-600"
          }
          ${isActive
            ? "bg-emerald-500"
            : isExpected
              ? isBlack ? "bg-blue-700" : "bg-blue-200"
              : isBlack ? "bg-slate-800" : "bg-white"
          }
          transition-colors duration-75
        `}
        title={fullNote}
      />
    );
  }

  return (
    <div className="flex items-end justify-center bg-slate-900 p-2 rounded overflow-x-auto">
      {keys}
    </div>
  );
}

export default function PitchTestPage() {
  const [isListening, setIsListening] = useState(false);
  const [selectedTest, setSelectedTest] = useState<TestCase | null>(null);
  const [events, setEvents] = useState<DetectionEvent[]>([]);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [stats, setStats] = useState({ rms: 0, frequency: 0, confidence: 0 });
  const [issueLog, setIssueLog] = useState<{type: string; note: string; time: number}[]>([]);
  const [remarks, setRemarks] = useState<{text: string; time: number}[]>([]);
  const [remarkInput, setRemarkInput] = useState("");
  const [showFrames, setShowFrames] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [parameters, setParameters] = useState({
    minRms: 0.001,
    confidenceThreshold: 0.75,
    centsTolerance: 35,
    debounceMs: 50,
  });

  // Update worklet when parameters change
  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({
        type: "setGates",
        gates: {
          minRms: parameters.minRms,
        },
      });
    }
  }, [parameters.minRms]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<number>(0);

  // Auto-scroll log to bottom (within container only)
  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [events]);

  const addEvent = useCallback((event: Omit<DetectionEvent, "timestamp">) => {
    const newEvent = { ...event, timestamp: Date.now() };
    setEvents(prev => [...prev.slice(-500), newEvent]); // Keep last 500 events
  }, []);

  const startListening = async () => {
    try {
      addEvent({ type: "debug", message: "Requesting microphone access..." });

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
        },
      });
      streamRef.current = stream;

      addEvent({ type: "debug", message: "Microphone access granted" });

      const audioContext = new AudioContext({ sampleRate: 44100 });
      audioContextRef.current = audioContext;

      // Ensure AudioContext is running (may be suspended by default)
      if (audioContext.state === "suspended") {
        await audioContext.resume();
        addEvent({ type: "debug", message: "AudioContext resumed from suspended state" });
      }

      addEvent({ type: "debug", message: `AudioContext created, sample rate: ${audioContext.sampleRate}, state: ${audioContext.state}` });

      // Create analyser for visualizations
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // Load the YIN processor worklet (with cache buster)
      const workletUrl = `/audioWorklets/yinProcessor.js?v=${Date.now()}`;
      await audioContext.audioWorklet.addModule(workletUrl);
      addEvent({ type: "debug", message: "YIN AudioWorklet loaded (v2 simplified)" });

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser); // Connect to analyser for visualization

      const workletNode = new AudioWorkletNode(audioContext, "yin-processor", {
        processorOptions: {
          sampleRate: audioContext.sampleRate,
        },
      });
      workletNodeRef.current = workletNode;

      // CRITICAL: Connect source to worklet for pitch detection!
      source.connect(workletNode);

      // Configure the worklet with current parameters
      workletNode.port.postMessage({
        type: "configure",
        minRms: parameters.minRms,
        maxCmnd: 0.35,
        debounceMs: parameters.debounceMs,
      });

      // Handle messages from worklet
      workletNode.port.onmessage = (event) => {
        const data = event.data;

        // Debug: log all message types
        if (data.type !== "stats") {
          console.log("[Worklet Message]", data.type, data);
        }

        if (data.type === "stats") {
          const statsData = data.stats || data;
          setStats(prev => ({
            ...prev,
            rms: statsData.rms || statsData.smoothedRms || prev.rms,
          }));
          return;
        }

        if (data.type === "tentative") {
          const detection = data.detection;
          if (!detection) return;

          const { note, frequency, midiPitch, cmndMin } = detection;
          const confidence = cmndMin !== undefined ? 1 - cmndMin : 0.8;

          setStats(prev => ({
            ...prev,
            frequency: frequency || 0,
            confidence,
          }));

          addEvent({
            type: "tentative",
            frequency,
            note,
            midi: midiPitch,
            confidence,
            cmnd: cmndMin,
            raw: detection,
          });

          setActiveNotes(prev => new Set([...prev, note]));

          // Clear after a short delay
          setTimeout(() => {
            setActiveNotes(prev => {
              const next = new Set(prev);
              next.delete(note);
              return next;
            });
          }, 200);
        }

        if (data.type === "confirmed") {
          const detection = data.detection;
          if (!detection) return;

          const { note, frequency, midiPitch, cmndMin } = detection;
          const confidence = cmndMin !== undefined ? 1 - cmndMin : 0.8;

          addEvent({
            type: "confirmed",
            frequency,
            note,
            midi: midiPitch,
            confidence,
            cmnd: cmndMin,
            raw: detection,
          });

          setDetectedNotes(prev => [...prev, note]);
        }

        if (data.type === "cancelled") {
          addEvent({
            type: "cancelled",
            message: `Detection cancelled: ${data.note || "unknown"}`,
            raw: data,
          });
        }

        if (data.type === "noteOff") {
          addEvent({
            type: "debug",
            message: `NOTE OFF: ${data.note}`,
            note: data.note,
          });
        }

        if (data.type === "frame") {
          setFrameCount(prev => prev + 1);
          // Update stats with frame data
          setStats(prev => ({
            ...prev,
            rms: data.rms || prev.rms,
            frequency: data.frequency || prev.frequency,
            confidence: data.confidence || prev.confidence,
          }));
          // Only log frames if showFrames is enabled (to avoid spam)
          // Note: We check the ref since this is in a closure
        }
      };

      // Already connected to workletNode at line 307
      // Don't connect to destination - we don't need audio output

      setIsListening(true);
      addEvent({ type: "debug", message: "Pitch detection started - play a note!" });

      // Start visualization loop
      const drawVisualizations = () => {
        if (!analyserRef.current) return;

        const analyser = analyserRef.current;
        const waveformCanvas = waveformCanvasRef.current;
        const spectrumCanvas = spectrumCanvasRef.current;

        // Draw waveform
        if (waveformCanvas) {
          const ctx = waveformCanvas.getContext("2d");
          if (ctx) {
            const dataArray = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(dataArray);

            ctx.fillStyle = "#0f172a";
            ctx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);

            ctx.lineWidth = 2;
            ctx.strokeStyle = "#10b981";
            ctx.beginPath();

            const sliceWidth = waveformCanvas.width / dataArray.length;
            let x = 0;

            for (let i = 0; i < dataArray.length; i++) {
              const v = dataArray[i];
              const y = (v + 1) / 2 * waveformCanvas.height;

              if (i === 0) {
                ctx.moveTo(x, y);
              } else {
                ctx.lineTo(x, y);
              }
              x += sliceWidth;
            }
            ctx.stroke();
          }
        }

        // Draw spectrum
        if (spectrumCanvas) {
          const ctx = spectrumCanvas.getContext("2d");
          if (ctx) {
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);

            ctx.fillStyle = "#0f172a";
            ctx.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);

            // Only show lower frequencies (more relevant for piano)
            const relevantBins = Math.floor(dataArray.length / 4); // ~0-5kHz
            const barWidth = spectrumCanvas.width / relevantBins;

            for (let i = 0; i < relevantBins; i++) {
              const barHeight = (dataArray[i] / 255) * spectrumCanvas.height;
              const hue = (i / relevantBins) * 240; // Blue to red
              ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
              ctx.fillRect(
                i * barWidth,
                spectrumCanvas.height - barHeight,
                barWidth - 1,
                barHeight
              );
            }

            // Draw frequency markers
            ctx.fillStyle = "#64748b";
            ctx.font = "10px monospace";
            const nyquist = audioContext.sampleRate / 2;
            [100, 500, 1000, 2000, 4000].forEach(freq => {
              const x = (freq / (nyquist / 4)) * spectrumCanvas.width;
              if (x < spectrumCanvas.width) {
                ctx.fillText(`${freq}Hz`, x, 12);
              }
            });
          }
        }

        animationRef.current = requestAnimationFrame(drawVisualizations);
      };

      drawVisualizations();

    } catch (err) {
      addEvent({ type: "debug", message: `Error: ${err}` });
      console.error("Failed to start listening:", err);
    }
  };

  const stopListening = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = 0;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsListening(false);
    addEvent({ type: "debug", message: "Pitch detection stopped" });
  };

  const clearLog = () => {
    setEvents([]);
    setDetectedNotes([]);
    setIssueLog([]);
    setRemarks([]);
    setFrameCount(0);
  };

  const logIssue = (type: string) => {
    const lastNote = detectedNotes[detectedNotes.length - 1] || "?";
    setIssueLog(prev => [...prev, { type, note: lastNote, time: Date.now() }]);
    addEvent({ type: "debug", message: `ISSUE LOGGED: ${type} - Last detected: ${lastNote}` });
  };

  const addRemark = () => {
    if (!remarkInput.trim()) return;
    const time = Date.now();
    setRemarks(prev => [...prev, { text: remarkInput.trim(), time }]);
    addEvent({ type: "debug", message: `REMARK: ${remarkInput.trim()}` });
    setRemarkInput("");
  };

  const startRecording = () => {
    if (!streamRef.current) {
      addEvent({ type: "debug", message: "Start listening first before recording" });
      return;
    }

    // Clear previous events for clean recording
    setEvents([]);
    setDetectedNotes([]);
    setRemarks([]);
    setFrameCount(0);

    recordedChunksRef.current = [];
    const startTime = Date.now();
    setRecordingStartTime(startTime);

    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: "audio/webm;codecs=opus",
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Generate timestamp-based filename
      const timestamp = new Date(startTime).toISOString().replace(/[:.]/g, "-");
      const testId = selectedTest?.id || "freeform";
      const baseFilename = `pitch-test-${testId}-${timestamp}`;

      // Save audio file
      const audioBlob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioLink = document.createElement("a");
      audioLink.href = audioUrl;
      audioLink.download = `${baseFilename}.webm`;
      audioLink.click();
      URL.revokeObjectURL(audioUrl);

      // Create comprehensive test bundle JSON
      const testBundle = {
        version: "1.0",
        audioFile: `${baseFilename}.webm`,
        timestamp: new Date(startTime).toISOString(),
        duration: duration,
        testCase: selectedTest ? {
          id: selectedTest.id,
          name: selectedTest.name,
          description: selectedTest.description,
          expectedNotes: selectedTest.expectedNotes,
        } : null,
        parameters: parameters,
        results: {
          detectedNotes: detectedNotes,
          uniqueNotes: [...new Set(detectedNotes)],
          onsetCount: detectedNotes.length,
          frameCount: frameCount,
        },
        remarks: remarks.map(r => ({
          text: r.text,
          timeOffset: r.time - startTime,
        })),
        events: events.map(e => ({
          type: e.type,
          note: e.note,
          frequency: e.frequency,
          confidence: e.confidence,
          message: e.message,
          timeOffset: e.timestamp - startTime,
        })),
        issueLog: issueLog.map(i => ({
          type: i.type,
          note: i.note,
          timeOffset: i.time - startTime,
        })),
      };

      // Save JSON bundle
      const jsonBlob = new Blob([JSON.stringify(testBundle, null, 2)], { type: "application/json" });
      const jsonUrl = URL.createObjectURL(jsonBlob);
      const jsonLink = document.createElement("a");
      jsonLink.href = jsonUrl;
      jsonLink.download = `${baseFilename}.json`;
      jsonLink.click();
      URL.revokeObjectURL(jsonUrl);

      addEvent({ type: "debug", message: `Saved: ${baseFilename}.webm + .json` });
    };

    mediaRecorder.start();
    mediaRecorderRef.current = mediaRecorder;
    setIsRecording(true);
    addEvent({ type: "debug", message: "Recording started - play your test pattern!" });
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      addEvent({ type: "debug", message: "Recording stopped, saving files..." });
    }
  };

  const startTest = (test: TestCase) => {
    setSelectedTest(test);
    setDetectedNotes([]);
    addEvent({ type: "debug", message: `Starting test: ${test.name}` });
    addEvent({ type: "debug", message: `Instructions: ${test.instructions}` });
    addEvent({ type: "debug", message: `Expected notes: ${test.expectedNotes.join(", ")}` });
  };

  const endTest = () => {
    if (selectedTest) {
      const expected = selectedTest.expectedNotes;
      const detected = detectedNotes;

      // Simple analysis
      const hits = detected.filter(n => expected.includes(n)).length;
      const misses = expected.filter(n => !detected.includes(n));
      const falsePositives = detected.filter(n => !expected.includes(n));

      addEvent({
        type: "debug",
        message: `Test complete! Hits: ${hits}/${expected.length}, Misses: ${misses.length}, False positives: ${falsePositives.length}`,
      });

      if (misses.length > 0) {
        addEvent({ type: "debug", message: `Missed notes: ${misses.join(", ")}` });
      }
      if (falsePositives.length > 0) {
        addEvent({ type: "debug", message: `False positives: ${falsePositives.join(", ")}` });
      }
    }
    setSelectedTest(null);
  };

  const exportLog = () => {
    const startTime = events[0]?.timestamp || Date.now();
    const logData = {
      timestamp: new Date().toISOString(),
      parameters,
      selectedTest,
      detectedNotes,
      issueLog: issueLog.map(i => ({ ...i, timeOffset: i.time - startTime })),
      issueSummary: issueLog.reduce((acc, issue) => {
        acc[issue.type] = (acc[issue.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      remarks: remarks.map(r => ({ ...r, timeOffset: r.time - startTime })),
      events: events.map(e => ({
        ...e,
        timeOffset: e.timestamp - startTime,
      })),
    };

    const blob = new Blob([JSON.stringify(logData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pitch-test-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Override global overflow:hidden
  useEffect(() => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      <div className="max-w-7xl mx-auto pb-8">
        <h1 className="text-2xl font-bold mb-4">Pitch Detection Testing Lab</h1>

        {/* Controls */}
        <div className="flex gap-4 mb-4 flex-wrap">
          <button
            onClick={isListening ? stopListening : startListening}
            className={`px-6 py-2 rounded font-medium ${
              isListening
                ? "bg-red-600 hover:bg-red-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {isListening ? "Stop Listening" : "Start Listening"}
          </button>

          <button
            onClick={clearLog}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Clear Log
          </button>

          <button
            onClick={exportLog}
            className="px-4 py-2 rounded bg-slate-700 hover:bg-slate-600"
          >
            Export Log
          </button>

          {/* Recording Controls */}
          <div className="border-l border-slate-600 pl-4 flex gap-2 items-center">
            {isRecording ? (
              <button
                onClick={stopRecording}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 font-medium flex items-center gap-2"
              >
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Stop & Save
              </button>
            ) : (
              <button
                onClick={startRecording}
                disabled={!isListening}
                className={`px-4 py-2 rounded font-medium ${
                  isListening
                    ? "bg-red-900 hover:bg-red-800"
                    : "bg-slate-700 text-slate-500 cursor-not-allowed"
                }`}
                title={isListening ? "Start recording test" : "Start listening first"}
              >
                Record Test
              </button>
            )}
            {isRecording && (
              <span className="text-red-400 text-sm">
                {Math.floor((Date.now() - recordingStartTime) / 1000)}s
              </span>
            )}
          </div>

          <div className="border-l border-slate-600 pl-4 flex gap-2 items-center">
            <span className="text-xs text-slate-400">Log Issue:</span>
            <button
              onClick={() => logIssue("false-positive")}
              className="px-3 py-1.5 rounded bg-red-900 hover:bg-red-800 text-xs"
              title="Wrong note detected"
            >
              False +
            </button>
            <button
              onClick={() => logIssue("missed")}
              className="px-3 py-1.5 rounded bg-yellow-900 hover:bg-yellow-800 text-xs"
              title="Note not detected"
            >
              Missed
            </button>
            <button
              onClick={() => logIssue("octave-error")}
              className="px-3 py-1.5 rounded bg-purple-900 hover:bg-purple-800 text-xs"
              title="Wrong octave detected"
            >
              Octave
            </button>
            <button
              onClick={() => logIssue("late")}
              className="px-3 py-1.5 rounded bg-orange-900 hover:bg-orange-800 text-xs"
              title="Detection felt slow"
            >
              Late
            </button>
          </div>
        </div>

        {/* Remarks Input */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={remarkInput}
            onChange={e => setRemarkInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addRemark()}
            placeholder="Type observation and press Enter (timestamped)..."
            className="flex-1 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={addRemark}
            className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 font-medium"
          >
            Add Remark
          </button>
        </div>

        {/* Remarks List */}
        {remarks.length > 0 && (
          <div className="bg-blue-950 border border-blue-800 rounded p-3 mb-4">
            <div className="text-sm font-medium text-blue-400 mb-2">
              Remarks ({remarks.length})
            </div>
            <div className="space-y-1 text-xs max-h-24 overflow-y-auto">
              {remarks.map((r, i) => (
                <div key={i} className="text-blue-300">
                  <span className="text-blue-500 font-mono">
                    {new Date(r.time).toISOString().split("T")[1].slice(0, 12)}
                  </span>
                  {" "}{r.text}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Issue Summary */}
        {issueLog.length > 0 && (
          <div className="bg-red-950 border border-red-800 rounded p-3 mb-4">
            <div className="text-sm font-medium text-red-400 mb-2">
              Issues Logged ({issueLog.length})
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(
                issueLog.reduce((acc, issue) => {
                  acc[issue.type] = (acc[issue.type] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([type, count]) => (
                <span key={type} className="px-2 py-1 bg-red-900 rounded">
                  {type}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Big Note Display */}
        <div className="bg-slate-800 p-6 rounded mb-4 text-center">
          <div className="text-6xl font-bold font-mono mb-2" style={{
            color: activeNotes.size > 0 ? "#10b981" : "#475569"
          }}>
            {activeNotes.size > 0
              ? Array.from(activeNotes).join(" ")
              : detectedNotes.length > 0
                ? detectedNotes[detectedNotes.length - 1]
                : "---"}
          </div>
          <div className="text-slate-400 text-sm">
            {stats.frequency > 0 ? `${stats.frequency.toFixed(1)} Hz` : "Waiting for input..."}
            {stats.confidence > 0 && ` • ${(stats.confidence * 100).toFixed(0)}% confidence`}
            {frameCount > 0 && ` • ${frameCount} frames`}
          </div>
        </div>

        {/* Live Stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-slate-800 p-4 rounded">
            <div className="text-xs text-slate-400">RMS Level</div>
            <div className="text-xl font-mono">{stats.rms.toFixed(4)}</div>
            <div className="h-2 bg-slate-700 rounded mt-1">
              <div
                className="h-full bg-emerald-500 rounded transition-all"
                style={{ width: `${Math.min(100, stats.rms * 1000)}%` }}
              />
            </div>
          </div>
          <div className="bg-slate-800 p-4 rounded">
            <div className="text-xs text-slate-400">Frequency</div>
            <div className="text-xl font-mono">
              {stats.frequency > 0 ? `${stats.frequency.toFixed(1)} Hz` : "---"}
            </div>
            <div className="text-sm text-slate-400">
              {stats.frequency > 0 ? frequencyToNote(stats.frequency).note : ""}
            </div>
          </div>
          <div className="bg-slate-800 p-4 rounded">
            <div className="text-xs text-slate-400">Confidence</div>
            <div className="text-xl font-mono">{(stats.confidence * 100).toFixed(1)}%</div>
            <div className="h-2 bg-slate-700 rounded mt-1">
              <div
                className={`h-full rounded transition-all ${
                  stats.confidence >= parameters.confidenceThreshold ? "bg-emerald-500" : "bg-yellow-500"
                }`}
                style={{ width: `${stats.confidence * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Visualizations */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-800 p-2 rounded">
            <div className="text-xs text-slate-400 mb-1">Waveform</div>
            <canvas
              ref={waveformCanvasRef}
              width={400}
              height={100}
              className="w-full h-24 rounded bg-slate-900"
            />
          </div>
          <div className="bg-slate-800 p-2 rounded">
            <div className="text-xs text-slate-400 mb-1">Spectrum (0-5kHz)</div>
            <canvas
              ref={spectrumCanvasRef}
              width={400}
              height={100}
              className="w-full h-24 rounded bg-slate-900"
            />
          </div>
        </div>

        {/* Mini Keyboard */}
        <div className="mb-4">
          <MiniKeyboard
            activeNotes={activeNotes}
            expectedNotes={selectedTest?.expectedNotes || []}
          />
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Test Cases */}
          <div className="bg-slate-800 p-4 rounded">
            <h2 className="text-lg font-semibold mb-3">Test Cases</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {TEST_CASES.map(test => (
                <button
                  key={test.id}
                  onClick={() => selectedTest?.id === test.id ? endTest() : startTest(test)}
                  className={`w-full text-left p-3 rounded ${
                    selectedTest?.id === test.id
                      ? "bg-blue-600"
                      : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{test.name}</span>
                    <span className="text-xs text-slate-400">
                      {"★".repeat(test.difficulty)}{"☆".repeat(5 - test.difficulty)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">{test.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Current Test / Parameters */}
          <div className="bg-slate-800 p-4 rounded">
            {selectedTest ? (
              <>
                <h2 className="text-lg font-semibold mb-3">Current Test: {selectedTest.name}</h2>
                <div className="bg-slate-900 p-3 rounded mb-4">
                  <div className="text-sm font-medium text-blue-400 mb-2">Instructions:</div>
                  <div className="text-sm">{selectedTest.instructions}</div>
                </div>
                <div className="mb-4">
                  <div className="text-sm font-medium text-slate-400 mb-2">Expected Notes:</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedTest.expectedNotes.map((note, i) => (
                      <span
                        key={i}
                        className={`px-2 py-1 rounded text-sm ${
                          detectedNotes.includes(note)
                            ? "bg-emerald-600"
                            : "bg-slate-700"
                        }`}
                      >
                        {note}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mb-4">
                  <div className="text-sm font-medium text-slate-400 mb-2">Detected Notes:</div>
                  <div className="flex flex-wrap gap-1 min-h-[32px]">
                    {detectedNotes.map((note, i) => {
                      const isExpected = selectedTest.expectedNotes.includes(note);
                      return (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-sm ${
                            isExpected ? "bg-emerald-600" : "bg-red-600"
                          }`}
                        >
                          {note}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={endTest}
                  className="w-full py-2 rounded bg-blue-600 hover:bg-blue-700 font-medium"
                >
                  End Test & Analyze
                </button>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold mb-3">Detection Parameters</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-slate-400">Min RMS (silence threshold)</label>
                    <input
                      type="range"
                      min="0.0001"
                      max="0.01"
                      step="0.0001"
                      value={parameters.minRms}
                      onChange={e => setParameters(p => ({ ...p, minRms: parseFloat(e.target.value) }))}
                      className="w-full"
                    />
                    <div className="text-xs font-mono">{parameters.minRms.toFixed(4)}</div>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400">Confidence Threshold</label>
                    <input
                      type="range"
                      min="0.5"
                      max="0.95"
                      step="0.05"
                      value={parameters.confidenceThreshold}
                      onChange={e => setParameters(p => ({ ...p, confidenceThreshold: parseFloat(e.target.value) }))}
                      className="w-full"
                    />
                    <div className="text-xs font-mono">{(parameters.confidenceThreshold * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400">Cents Tolerance</label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      step="5"
                      value={parameters.centsTolerance}
                      onChange={e => setParameters(p => ({ ...p, centsTolerance: parseInt(e.target.value) }))}
                      className="w-full"
                    />
                    <div className="text-xs font-mono">{parameters.centsTolerance} cents</div>
                  </div>
                  <div>
                    <label className="text-sm text-slate-400">Debounce (ms)</label>
                    <input
                      type="range"
                      min="20"
                      max="150"
                      step="10"
                      value={parameters.debounceMs}
                      onChange={e => setParameters(p => ({ ...p, debounceMs: parseInt(e.target.value) }))}
                      className="w-full"
                    />
                    <div className="text-xs font-mono">{parameters.debounceMs}ms</div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Event Log */}
          <div className="bg-slate-800 p-4 rounded">
            <h2 className="text-lg font-semibold mb-3">Event Log</h2>
            <div
              ref={logContainerRef}
              className="h-96 overflow-y-auto font-mono text-xs space-y-1 bg-slate-900 p-2 rounded"
            >
              {events.map((event, i) => (
                <div
                  key={i}
                  className={`${
                    event.type === "confirmed"
                      ? "text-emerald-400"
                      : event.type === "tentative"
                        ? "text-blue-400"
                        : event.type === "cancelled"
                          ? "text-red-400"
                          : "text-slate-500"
                  }`}
                >
                  <span className="text-slate-600">
                    {new Date(event.timestamp).toISOString().split("T")[1].slice(0, 12)}
                  </span>
                  {" "}
                  <span className="uppercase">[{event.type}]</span>
                  {" "}
                  {event.note && (
                    <span className="font-bold">{event.note}</span>
                  )}
                  {event.frequency && (
                    <span> ({event.frequency.toFixed(1)}Hz)</span>
                  )}
                  {event.confidence !== undefined && (
                    <span> conf:{(event.confidence * 100).toFixed(0)}%</span>
                  )}
                  {event.rms !== undefined && (
                    <span> rms:{event.rms.toFixed(4)}</span>
                  )}
                  {event.message && (
                    <span> {event.message}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick Reference */}
        <div className="mt-4 bg-slate-800 p-4 rounded">
          <h2 className="text-lg font-semibold mb-3">Quick Reference</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-slate-400">Detection Algorithm</div>
              <div className="font-medium">YIN (AudioWorklet)</div>
            </div>
            <div>
              <div className="text-slate-400">Sample Rate</div>
              <div className="font-medium">44,100 Hz</div>
            </div>
            <div>
              <div className="text-slate-400">Window Size</div>
              <div className="font-medium">3,072 samples (~70ms)</div>
            </div>
            <div>
              <div className="text-slate-400">Hop Size</div>
              <div className="font-medium">512 samples (~12ms)</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
