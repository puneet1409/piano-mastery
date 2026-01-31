"use client";

import React, { useState, useRef, useEffect } from "react";
import PianoKeyboard from "@/components/piano/PianoKeyboard";
import { AudioCapture } from "@/lib/audioCapture";
import { WebSocketClient } from "@/lib/websocketClient";

interface DebugLog {
  timestamp: number;
  type: "audio" | "detection" | "rejection" | "error" | "info";
  message: string;
  data?: any;
}

export default function CalibrationPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);

  // Real-time metrics
  const [currentVolume, setCurrentVolume] = useState(0);
  const [lastFrequency, setLastFrequency] = useState<number | null>(null);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [lastConfidence, setLastConfidence] = useState<number | null>(null);
  const [detectionCount, setDetectionCount] = useState(0);
  const [rejectionCount, setRejectionCount] = useState(0);

  const audioCaptureRef = useRef<AudioCapture | null>(null);
  const wsClientRef = useRef<WebSocketClient | null>(null);
  const sessionIdRef = useRef<string>(`calibrate-${Date.now()}`);
  const debugLogRef = useRef<HTMLDivElement>(null);

  const addLog = (type: DebugLog["type"], message: string, data?: any) => {
    const log: DebugLog = {
      timestamp: Date.now(),
      type,
      message,
      data,
    };
    setDebugLogs((prev) => [...prev.slice(-200), log]);
  };

  const handleStartRecording = async () => {
    try {
      addLog("info", "🎤 Starting audio capture...");

      const wsClient = new WebSocketClient(sessionIdRef.current);
      await wsClient.connect((event) => {
        if (event.type === "note_detected") {
          const { note, frequency, confidence, rms } = event.data;

          setLastFrequency(frequency);
          setLastNote(note);
          setLastConfidence(confidence);
          setDetectionCount((prev) => prev + 1);

          addLog("detection", `✓ DETECTED: ${note} @ ${frequency.toFixed(1)}Hz`, {
            note,
            frequency,
            confidence: `${(confidence * 100).toFixed(1)}%`,
            rms: rms.toFixed(4),
          });

          // Show note on keyboard (auto-clear after 1.5s)
          setDetectedNotes((prev) => {
            if (!prev.includes(note)) {
              setTimeout(() => {
                setDetectedNotes((current) => current.filter((n) => n !== note));
              }, 1500);
              return [...prev, note];
            }
            return prev;
          });
        }
      });

      wsClientRef.current = wsClient;
      setWsConnected(true);
      addLog("info", "✓ WebSocket connected");

      const audioCapture = new AudioCapture();
      await audioCapture.start((samples) => {
        // Calculate RMS volume
        const rms = Math.sqrt(
          samples.reduce((sum, s) => sum + s * s, 0) / samples.length
        );
        setCurrentVolume(rms);

        // Log audio chunks
        if (rms > 0.001) {
          addLog("audio", `Audio chunk: RMS=${rms.toFixed(4)}, samples=${samples.length}`);
        }

        // Send to backend
        if (wsClient) {
          wsClient.sendAudioChunk(samples, 44100);
        }
      });

      audioCaptureRef.current = audioCapture;
      setIsRecording(true);
      addLog("info", "✓ Recording started");
    } catch (error: any) {
      addLog("error", `Failed to start: ${error.message}`);
      console.error("Failed to start recording:", error);
    }
  };

  const handleStopRecording = () => {
    if (audioCaptureRef.current) {
      audioCaptureRef.current.stop();
      audioCaptureRef.current = null;
    }

    if (wsClientRef.current) {
      wsClientRef.current.disconnect();
      wsClientRef.current = null;
    }

    setIsRecording(false);
    setWsConnected(false);
    addLog("info", "⏹ Recording stopped");
  };

  // Auto-scroll debug log
  useEffect(() => {
    if (debugLogRef.current) {
      debugLogRef.current.scrollTop = debugLogRef.current.scrollHeight;
    }
  }, [debugLogs]);

  const volumePercent = Math.min(100, currentVolume * 1000);
  const frequencyForDisplay = lastFrequency ? lastFrequency.toFixed(1) : "—";

  return (
    <div className="min-h-screen bg-concrete-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Piano Note Detection Calibration
          </h1>
          <p className="text-concrete-600">
            Test microphone accuracy and debug note detection in real-time
          </p>
        </div>

        {/* Main Control */}
        <div className="brutal-card p-8 mb-6">
          <button
            onClick={isRecording ? handleStopRecording : handleStartRecording}
            className={`brutal-btn w-full py-6 text-2xl font-bold ${
              isRecording
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-electric-blue text-white hover:bg-blue-600"
            }`}
          >
            {isRecording ? "⏹ STOP" : "▶ START DETECTION"}
          </button>

          {wsConnected && (
            <div className="mt-4 text-center text-green-600 font-mono font-bold">
              ✓ Connected to backend server
            </div>
          )}
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="brutal-card p-4">
            <div className="text-sm text-concrete-600 mb-1">VOLUME (RMS)</div>
            <div className="text-3xl font-mono font-bold">
              {currentVolume.toFixed(4)}
            </div>
            <div className="mt-2 h-2 bg-concrete-200 rounded overflow-hidden">
              <div
                className="h-full bg-electric-cyan transition-all"
                style={{ width: `${volumePercent}%` }}
              />
            </div>
          </div>

          <div className="brutal-card p-4">
            <div className="text-sm text-concrete-600 mb-1">FREQUENCY</div>
            <div className="text-3xl font-mono font-bold">
              {frequencyForDisplay}
              <span className="text-base ml-1">Hz</span>
            </div>
          </div>

          <div className="brutal-card p-4">
            <div className="text-sm text-concrete-600 mb-1">LAST NOTE</div>
            <div className="text-3xl font-mono font-bold">
              {lastNote || "—"}
            </div>
          </div>

          <div className="brutal-card p-4">
            <div className="text-sm text-concrete-600 mb-1">CONFIDENCE</div>
            <div className="text-3xl font-mono font-bold">
              {lastConfidence ? `${(lastConfidence * 100).toFixed(0)}%` : "—"}
            </div>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="brutal-card p-4 mb-6 flex items-center justify-between">
          <div className="font-mono">
            <span className="text-green-600 font-bold">{detectionCount}</span>{" "}
            detections
          </div>
          <div className="font-mono">
            <span className="text-red-600 font-bold">{rejectionCount}</span>{" "}
            rejections
          </div>
          <button
            onClick={() => {
              setDebugLogs([]);
              setDetectionCount(0);
              setRejectionCount(0);
              addLog("info", "Logs cleared");
            }}
            className="px-4 py-1 bg-concrete-200 hover:bg-concrete-300 font-mono text-sm"
          >
            CLEAR LOGS
          </button>
        </div>

        {/* Visual Feedback: Piano Keyboard */}
        <div className="brutal-card p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">DETECTED NOTES</h2>
          <PianoKeyboard detectedNotes={detectedNotes} showLabels={true} />
        </div>

        {/* Creative Visual: Frequency Meter */}
        {lastFrequency && (
          <div className="brutal-card p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">FREQUENCY VISUALIZATION</h2>
            <div className="relative h-32 bg-concrete-100 rounded-lg overflow-hidden">
              <div
                className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-electric-cyan to-electric-blue transition-all duration-200"
                style={{
                  height: `${Math.min(100, (lastFrequency / 1000) * 100)}%`,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-4xl font-mono font-bold text-white drop-shadow-lg">
                  {lastFrequency.toFixed(1)} Hz
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Debug Log */}
        <div className="brutal-card p-6">
          <h2 className="text-xl font-bold mb-4">DEBUG LOG (Real-time)</h2>
          <div
            ref={debugLogRef}
            className="bg-black text-green-400 font-mono text-sm p-4 h-96 overflow-y-auto rounded"
            style={{ fontFamily: "monospace" }}
          >
            {debugLogs.length === 0 ? (
              <div className="text-concrete-500">
                Waiting for activity... Click START to begin.
              </div>
            ) : (
              debugLogs.map((log, i) => {
                const time = new Date(log.timestamp).toLocaleTimeString(
                  "en-US",
                  {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    fractionalSecondDigits: 3,
                  }
                );

                const color =
                  log.type === "detection"
                    ? "text-green-400"
                    : log.type === "error"
                    ? "text-red-400"
                    : log.type === "rejection"
                    ? "text-yellow-400"
                    : log.type === "audio"
                    ? "text-blue-400"
                    : "text-gray-400";

                return (
                  <div key={i} className={`${color} mb-1`}>
                    <span className="text-gray-500">[{time}]</span> {log.message}
                    {log.data && (
                      <span className="ml-2 text-gray-500">
                        {JSON.stringify(log.data)}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-6 text-sm text-concrete-600">
          <p className="mb-2">
            <strong>How to use:</strong>
          </p>
          <ol className="list-decimal ml-6 space-y-1">
            <li>Click START DETECTION</li>
            <li>Allow microphone access when prompted</li>
            <li>Play piano (or YouTube video of piano)</li>
            <li>Watch notes appear on keyboard and in debug log</li>
            <li>Check frequency/confidence values for accuracy</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
