"use client";

import React, { useState, useRef } from "react";

// Force client-side rendering (no SSR/SSG)
export const dynamic = 'force-dynamic';

export default function AudioTestPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioData, setAudioData] = useState<{
    rms: number;
    min: number;
    max: number;
    samples: number;
  } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-20), `[${timestamp}] ${message}`]);
  };

  const startRecording = async () => {
    try {
      addLog("Requesting microphone access...");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100,
        },
      });

      addLog("✓ Microphone access granted");
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 44100 });
      audioContextRef.current = audioContext;
      addLog(`✓ AudioContext created (sample rate: ${audioContext.sampleRate})`);

      const source = audioContext.createMediaStreamSource(stream);
      addLog("✓ Audio source created");

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Calculate statistics
        const rms = Math.sqrt(
          inputData.reduce((sum, val) => sum + val * val, 0) / inputData.length
        );
        const min = Math.min(...inputData);
        const max = Math.max(...inputData);

        setAudioData({
          rms: rms,
          min: min,
          max: max,
          samples: inputData.length,
        });

        // Log significant audio activity
        if (rms > 0.01) {
          addLog(`🎤 Audio activity: RMS=${rms.toFixed(4)}`);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      addLog("✓ Audio processing started");
      setIsRecording(true);

    } catch (error) {
      addLog(`✗ Error: ${error}`);
      console.error("Failed to start recording:", error);
    }
  };

  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);
    setAudioData(null);
    addLog("✓ Recording stopped");
  };

  const volumePercent = audioData ? Math.min(100, audioData.rms * 1000) : 0;

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gray-800 rounded-lg p-6 border-4 border-green-500">
          <h1 className="text-4xl font-bold mb-2 text-green-400">🎤 Audio Diagnostic Test</h1>
          <p className="text-gray-400">Check if microphone is capturing audio properly</p>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-6 border-4 border-gray-700">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-6 px-8 rounded-lg text-2xl"
            >
              🎤 START MICROPHONE TEST
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-6 px-8 rounded-lg text-2xl"
            >
              ⏹ STOP TEST
            </button>
          )}
        </div>

        {/* Live Audio Metrics */}
        {audioData && (
          <div className="bg-gray-800 rounded-lg p-6 border-4 border-blue-500">
            <h2 className="text-2xl font-bold mb-4 text-blue-400">Live Audio Metrics</h2>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-900 p-4 rounded border-2 border-gray-700">
                <div className="text-sm text-gray-400 mb-1">RMS Volume</div>
                <div className="text-3xl font-bold text-green-400">
                  {audioData.rms.toFixed(4)}
                </div>
              </div>

              <div className="bg-gray-900 p-4 rounded border-2 border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Volume %</div>
                <div className="text-3xl font-bold text-yellow-400">
                  {volumePercent.toFixed(1)}%
                </div>
              </div>

              <div className="bg-gray-900 p-4 rounded border-2 border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Min</div>
                <div className="text-3xl font-bold text-blue-400">
                  {audioData.min.toFixed(3)}
                </div>
              </div>

              <div className="bg-gray-900 p-4 rounded border-2 border-gray-700">
                <div className="text-sm text-gray-400 mb-1">Max</div>
                <div className="text-3xl font-bold text-purple-400">
                  {audioData.max.toFixed(3)}
                </div>
              </div>
            </div>

            {/* Volume Bar */}
            <div className="mb-4">
              <div className="text-sm text-gray-400 mb-2">Volume Meter</div>
              <div className="h-12 bg-gray-900 border-2 border-gray-700 rounded relative overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ${
                    volumePercent < 1 ? 'bg-gray-600' :
                    volumePercent < 10 ? 'bg-yellow-500' :
                    volumePercent < 50 ? 'bg-green-500' :
                    'bg-red-500'
                  }`}
                  style={{ width: `${volumePercent}%` }}
                ></div>
                <div className="absolute inset-0 flex items-center justify-center text-white font-bold">
                  {volumePercent.toFixed(1)}%
                </div>
              </div>
            </div>

            {/* Thresholds */}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className={`p-3 rounded ${audioData.rms > 0.01 ? 'bg-green-900 border-2 border-green-500' : 'bg-gray-900 border-2 border-gray-700'}`}>
                <div className="font-bold">Threshold: 0.01</div>
                <div className="text-gray-400">
                  {audioData.rms > 0.01 ? '✓ ABOVE (will detect)' : '✗ BELOW (too quiet)'}
                </div>
              </div>

              <div className={`p-3 rounded ${audioData.rms > 0.005 ? 'bg-yellow-900 border-2 border-yellow-500' : 'bg-gray-900 border-2 border-gray-700'}`}>
                <div className="font-bold">Threshold: 0.005</div>
                <div className="text-gray-400">
                  {audioData.rms > 0.005 ? '✓ ABOVE (borderline)' : '✗ BELOW'}
                </div>
              </div>

              <div className={`p-3 rounded ${audioData.rms > 0.001 ? 'bg-blue-900 border-2 border-blue-500' : 'bg-gray-900 border-2 border-gray-700'}`}>
                <div className="font-bold">Threshold: 0.001</div>
                <div className="text-gray-400">
                  {audioData.rms > 0.001 ? '✓ ABOVE (any sound)' : '✗ BELOW'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Activity Log */}
        <div className="bg-gray-800 rounded-lg p-6 border-4 border-gray-700">
          <h2 className="text-2xl font-bold mb-4">Activity Log</h2>
          <div className="bg-black p-4 rounded font-mono text-sm max-h-96 overflow-y-auto">
            {logs.length > 0 ? (
              logs.map((log, idx) => (
                <div key={idx} className="text-green-400 py-1">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-gray-600">No activity yet. Click START to begin.</div>
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-gray-800 rounded-lg p-6 border-4 border-yellow-500">
          <h2 className="text-2xl font-bold mb-4 text-yellow-400">📋 Diagnostic Instructions</h2>
          <ol className="list-decimal list-inside space-y-2 text-lg">
            <li>Click <strong>"START MICROPHONE TEST"</strong></li>
            <li>Allow microphone access when prompted</li>
            <li>Make some noise (speak, play piano, clap)</li>
            <li>Watch the <strong>RMS Volume</strong> value:
              <ul className="list-disc list-inside ml-6 mt-2 space-y-1">
                <li><strong>&gt; 0.01</strong> = Good! Backend will detect notes</li>
                <li><strong>0.005 - 0.01</strong> = Borderline, increase volume</li>
                <li><strong>&lt; 0.005</strong> = Too quiet, won't detect</li>
              </ul>
            </li>
            <li>Check the threshold indicators (green = good)</li>
            <li>If always below 0.01: Increase microphone gain in system settings</li>
          </ol>
        </div>

        {/* Expected Values */}
        <div className="bg-gray-800 rounded-lg p-6 border-4 border-purple-500">
          <h2 className="text-2xl font-bold mb-4 text-purple-400">Expected Values</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-bold text-lg mb-2">🔇 Silence / Background</h3>
              <ul className="space-y-1 text-gray-300">
                <li>RMS: 0.0001 - 0.001</li>
                <li>Volume %: 0.1 - 1%</li>
                <li>Status: Too quiet to detect</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2">🎹 Piano / Speaking</h3>
              <ul className="space-y-1 text-gray-300">
                <li>RMS: 0.01 - 0.1</li>
                <li>Volume %: 10 - 100%</li>
                <li>Status: Will detect notes</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2">🔊 Loud Playing</h3>
              <ul className="space-y-1 text-gray-300">
                <li>RMS: 0.05 - 0.2</li>
                <li>Volume %: 50 - 200%</li>
                <li>Status: Might clip/distort</li>
              </ul>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2">📱 Browser Check</h3>
              <ul className="space-y-1 text-gray-300">
                <li>F12 → Console for errors</li>
                <li>Check site permissions (lock icon)</li>
                <li>Try different browser if stuck</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
