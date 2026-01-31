"use client";

import React, { useState, useRef, useEffect } from "react";

// Force client-side rendering (no SSR/SSG)
export const dynamic = 'force-dynamic';

export default function MicTestPage() {
  const [isRecording, setIsRecording] = useState(false);
  const [volume, setVolume] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string>("unknown");

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const startMicrophone = async () => {
    try {
      setError(null);
      setPermissionStatus("requesting...");

      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      setPermissionStatus("granted");
      streamRef.current = stream;

      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Create analyser
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsRecording(true);

      // Start monitoring volume
      monitorVolume();

    } catch (err: any) {
      setError(err.message || "Failed to access microphone");
      setPermissionStatus("denied");
      console.error("Microphone error:", err);
    }
  };

  const monitorVolume = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateVolume = () => {
      analyser.getByteTimeDomainData(dataArray);

      // Calculate RMS volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / bufferLength);

      setVolume(rms * 100);

      animationFrameRef.current = requestAnimationFrame(updateVolume);
    };

    updateVolume();
  };

  const stopMicrophone = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsRecording(false);
    setVolume(0);
  };

  useEffect(() => {
    return () => {
      stopMicrophone();
    };
  }, []);

  const volumeColor =
    volume < 1 ? 'bg-gray-500' :
    volume < 10 ? 'bg-yellow-500' :
    volume < 50 ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black text-white p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-6xl font-bold mb-4">🎤</h1>
          <h2 className="text-4xl font-bold mb-2">Microphone Test</h2>
          <p className="text-xl text-gray-300">Simple browser-only microphone check</p>
        </div>

        {/* Permission Status */}
        <div className={`p-6 rounded-lg border-4 ${
          permissionStatus === 'granted' ? 'bg-green-900 border-green-500' :
          permissionStatus === 'denied' ? 'bg-red-900 border-red-500' :
          'bg-gray-800 border-gray-600'
        }`}>
          <div className="text-lg font-bold mb-2">Permission Status</div>
          <div className="text-3xl">
            {permissionStatus === 'granted' && '✅ Granted'}
            {permissionStatus === 'denied' && '❌ Denied'}
            {permissionStatus === 'requesting...' && '⏳ Requesting...'}
            {permissionStatus === 'unknown' && '❓ Not Requested'}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900 border-4 border-red-500 p-6 rounded-lg">
            <div className="text-xl font-bold mb-2">❌ Error</div>
            <div className="text-lg">{error}</div>
            <div className="mt-4 text-sm text-red-200">
              <strong>Possible fixes:</strong>
              <ul className="list-disc list-inside mt-2">
                <li>Check browser permissions (click lock icon in address bar)</li>
                <li>Make sure no other app is using the microphone</li>
                <li>Try a different browser</li>
                <li>Check system microphone isn't muted</li>
              </ul>
            </div>
          </div>
        )}

        {/* Volume Meter */}
        <div className="bg-gray-800 border-4 border-gray-600 p-8 rounded-lg">
          <div className="text-2xl font-bold mb-6 text-center">Volume Level</div>

          {/* Big number display */}
          <div className="text-center mb-8">
            <div className={`text-8xl font-bold ${volumeColor.replace('bg-', 'text-')}`}>
              {volume.toFixed(1)}%
            </div>
          </div>

          {/* Visual bar */}
          <div className="h-20 bg-gray-900 border-4 border-gray-700 rounded-lg relative overflow-hidden mb-6">
            <div
              className={`h-full transition-all duration-100 ${volumeColor}`}
              style={{ width: `${Math.min(100, volume)}%` }}
            ></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-white drop-shadow-lg">
                {volume.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Status indicators */}
          <div className="grid grid-cols-3 gap-4 text-center text-sm">
            <div className={`p-3 rounded ${volume < 1 ? 'bg-gray-700' : 'bg-gray-900'}`}>
              <div className="font-bold">Silent</div>
              <div className="text-gray-400">&lt; 1%</div>
            </div>
            <div className={`p-3 rounded ${volume >= 1 && volume < 10 ? 'bg-yellow-900' : 'bg-gray-900'}`}>
              <div className="font-bold">Good</div>
              <div className="text-gray-400">1-10%</div>
            </div>
            <div className={`p-3 rounded ${volume >= 10 ? 'bg-green-900' : 'bg-gray-900'}`}>
              <div className="font-bold">Loud</div>
              <div className="text-gray-400">&gt; 10%</div>
            </div>
          </div>
        </div>

        {/* Control Button */}
        <div className="text-center">
          {!isRecording ? (
            <button
              onClick={startMicrophone}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-6 px-12 rounded-lg text-2xl border-4 border-green-700 shadow-lg transform transition hover:scale-105"
            >
              🎤 START TEST
            </button>
          ) : (
            <button
              onClick={stopMicrophone}
              className="bg-red-500 hover:bg-red-600 text-white font-bold py-6 px-12 rounded-lg text-2xl border-4 border-red-700 shadow-lg transform transition hover:scale-105"
            >
              ⏹ STOP TEST
            </button>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-blue-900 border-4 border-blue-500 p-6 rounded-lg">
          <h3 className="text-2xl font-bold mb-4">📋 Instructions</h3>
          <ol className="list-decimal list-inside space-y-3 text-lg">
            <li>Click <strong>"START TEST"</strong></li>
            <li>Allow microphone access when prompted</li>
            <li>Make noise (speak, clap, play piano)</li>
            <li>Watch the volume meter move</li>
          </ol>

          <div className="mt-6 p-4 bg-blue-800 rounded-lg">
            <div className="font-bold mb-2">✅ What to expect:</div>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>Silence: 0-1%</li>
              <li>Normal speaking: 5-20%</li>
              <li>Loud playing: 20-50%</li>
              <li>Very loud: 50%+</li>
            </ul>
          </div>
        </div>

        {/* Browser Info */}
        <div className="bg-gray-800 border-4 border-gray-600 p-6 rounded-lg text-sm">
          <h3 className="text-xl font-bold mb-3">Browser Info</h3>
          <div className="space-y-2 font-mono text-gray-300">
            <div>Browser: {typeof navigator !== 'undefined' ? navigator.userAgent.split(' ').slice(-2).join(' ') : 'Loading...'}</div>
            <div>getUserMedia: {typeof navigator !== 'undefined' && navigator.mediaDevices ? '✅ Supported' : '❌ Not Supported'}</div>
            <div>AudioContext: {typeof window !== 'undefined' && (window.AudioContext || (window as any).webkitAudioContext) ? '✅ Supported' : '❌ Not Supported'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
