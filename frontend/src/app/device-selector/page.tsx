"use client";

import React, { useState, useEffect, useRef } from "react";

// Force client-side rendering (no SSR/SSG)
export const dynamic = 'force-dynamic';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: string;
}

export default function DeviceSelectorPage() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [isRecording, setIsRecording] = useState(false);
  const [volume, setVolume] = useState(0);
  const [peakVolume, setPeakVolume] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Get list of audio devices
  const loadDevices = async () => {
    try {
      // First, request permission to access devices
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const deviceList = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = deviceList
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
          kind: device.kind,
        }));

      setDevices(audioInputs);

      // Auto-select the first device
      if (audioInputs.length > 0 && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error("Failed to enumerate devices:", error);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const startRecording = async (deviceId: string) => {
    try {
      // Stop any existing recording
      stopRecording();

      // Request microphone with specific device
      const constraints: MediaStreamConstraints = {
        audio: deviceId === 'default'
          ? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : {
              deviceId: { exact: deviceId },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Create audio context
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // Create analyser
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.3;
      analyserRef.current = analyser;

      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      setIsRecording(true);
      setPeakVolume(0);

      // Start monitoring
      monitorVolume();

    } catch (error) {
      console.error("Failed to start recording:", error);
      alert(`Failed to access microphone: ${error}`);
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
      const volumePercent = rms * 100;

      setVolume(volumePercent);

      // Track peak
      setPeakVolume(prev => Math.max(prev, volumePercent));

      animationFrameRef.current = requestAnimationFrame(updateVolume);
    };

    updateVolume();
  };

  const stopRecording = () => {
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

  const testDevice = (deviceId: string) => {
    setSelectedDevice(deviceId);
    startRecording(deviceId);
  };

  const volumeColor =
    volume < 1 ? 'bg-gray-500' :
    volume < 5 ? 'bg-yellow-500' :
    volume < 20 ? 'bg-green-500' : 'bg-red-500';

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-900 to-blue-900 border-4 border-purple-500 p-6 rounded-lg">
          <h1 className="text-4xl font-bold mb-2">🎤 Audio Device Selector</h1>
          <p className="text-xl text-gray-300">Find and test your microphones</p>
        </div>

        {/* Device List */}
        <div className="bg-gray-800 border-4 border-gray-600 p-6 rounded-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold">Available Microphones</h2>
            <button
              onClick={loadDevices}
              className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded font-bold"
            >
              🔄 Refresh
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p className="mb-4">No microphones found.</p>
              <button
                onClick={loadDevices}
                className="bg-green-500 hover:bg-green-600 px-6 py-3 rounded-lg font-bold"
              >
                Grant Microphone Access
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {devices.map((device, idx) => (
                <div
                  key={device.deviceId}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition ${
                    selectedDevice === device.deviceId
                      ? 'bg-blue-900 border-blue-500'
                      : 'bg-gray-700 border-gray-600 hover:bg-gray-650'
                  }`}
                  onClick={() => testDevice(device.deviceId)}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-bold text-lg">
                        {idx === 0 && '⭐ '}
                        {device.label}
                      </div>
                      <div className="text-sm text-gray-400 font-mono">
                        ID: {device.deviceId.slice(0, 20)}...
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        testDevice(device.deviceId);
                      }}
                      className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded font-bold"
                    >
                      TEST
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Volume Meter */}
        {isRecording && (
          <div className="bg-gray-800 border-4 border-green-500 p-6 rounded-lg">
            <h2 className="text-2xl font-bold mb-4">Live Volume</h2>

            {/* Current Volume */}
            <div className="mb-6">
              <div className="text-sm text-gray-400 mb-2">Current Volume</div>
              <div className="text-6xl font-bold text-center mb-4">
                <span className={volumeColor.replace('bg-', 'text-')}>
                  {volume.toFixed(2)}%
                </span>
              </div>

              <div className="h-16 bg-gray-900 border-2 border-gray-700 rounded relative overflow-hidden">
                <div
                  className={`h-full transition-all duration-100 ${volumeColor}`}
                  style={{ width: `${Math.min(100, volume)}%` }}
                ></div>
              </div>
            </div>

            {/* Peak Volume */}
            <div className="mb-6">
              <div className="text-sm text-gray-400 mb-2">Peak Volume (since start)</div>
              <div className="text-4xl font-bold text-yellow-400 text-center">
                {peakVolume.toFixed(2)}%
              </div>
            </div>

            {/* Status Indicators */}
            <div className="grid grid-cols-4 gap-2 text-center text-sm">
              <div className={`p-2 rounded ${volume < 1 ? 'bg-red-900' : 'bg-gray-700'}`}>
                <div className="font-bold">Silent</div>
                <div className="text-xs text-gray-400">&lt; 1%</div>
              </div>
              <div className={`p-2 rounded ${volume >= 1 && volume < 5 ? 'bg-yellow-900' : 'bg-gray-700'}`}>
                <div className="font-bold">Quiet</div>
                <div className="text-xs text-gray-400">1-5%</div>
              </div>
              <div className={`p-2 rounded ${volume >= 5 && volume < 20 ? 'bg-green-900' : 'bg-gray-700'}`}>
                <div className="font-bold">Good</div>
                <div className="text-xs text-gray-400">5-20%</div>
              </div>
              <div className={`p-2 rounded ${volume >= 20 ? 'bg-red-900' : 'bg-gray-700'}`}>
                <div className="font-bold">Loud</div>
                <div className="text-xs text-gray-400">&gt; 20%</div>
              </div>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={stopRecording}
                className="bg-red-500 hover:bg-red-600 px-8 py-3 rounded-lg font-bold text-lg"
              >
                ⏹ STOP TEST
              </button>
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-yellow-900 border-4 border-yellow-500 p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-4">📋 How to Use</h2>
          <ol className="list-decimal list-inside space-y-3 text-lg">
            <li>Check the list of available microphones above</li>
            <li>Click <strong>"TEST"</strong> on each device to try it</li>
            <li>Make noise (speak, clap, play piano) near the microphone</li>
            <li>Watch the volume meter - it should go above 5% for good audio</li>
            <li>Find which device responds to your piano/keyboard</li>
          </ol>

          <div className="mt-6 p-4 bg-yellow-800 rounded-lg">
            <div className="font-bold mb-2">🎯 What to Look For:</div>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>0-1%</strong>: Device is silent/muted</li>
              <li><strong>1-5%</strong>: Only background noise, too quiet</li>
              <li><strong>5-20%</strong>: ✅ GOOD - Should detect notes</li>
              <li><strong>20%+</strong>: Very loud, may distort</li>
            </ul>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="bg-red-900 border-4 border-red-500 p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-4">🔧 If All Devices Show &lt; 1%</h2>
          <ul className="list-disc list-inside space-y-2 text-lg">
            <li>Check system microphone settings:
              <ul className="list-circle list-inside ml-6 mt-1 text-base">
                <li>Windows: Settings → Sound → Input</li>
                <li>Mac: System Preferences → Sound → Input</li>
                <li>Linux: Settings → Sound → Input</li>
              </ul>
            </li>
            <li>Ensure microphone is not muted in system tray</li>
            <li>Increase microphone gain/volume to 80-100%</li>
            <li>Try speaking VERY LOUD directly into the microphone</li>
            <li>Check if another app is using the microphone</li>
            <li>Restart browser and try again</li>
          </ul>
        </div>

        {/* System Info */}
        <div className="bg-gray-800 border-4 border-gray-600 p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-4">System Info</h2>
          <div className="space-y-2 font-mono text-sm text-gray-300">
            <div>Devices Found: <strong className="text-white">{devices.length}</strong></div>
            <div>Recording: <strong className={isRecording ? 'text-green-400' : 'text-red-400'}>{isRecording ? 'YES' : 'NO'}</strong></div>
            <div>Browser: {typeof navigator !== 'undefined' ? navigator.userAgent.split(' ').slice(-2).join(' ') : 'Loading...'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
