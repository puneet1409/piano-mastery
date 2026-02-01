"use client";

import React, { useState, useRef, useCallback } from "react";

interface DetectionResult {
  time: number;
  type: string;
  note?: string;
  frequency?: number;
  confidence?: number;
  rms?: number;
}

export default function OfflineAudioTest() {
  const [results, setResults] = useState<DetectionResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<{
    onsets: number;
    frames: number;
    noteOffs: number;
    uniqueNotes: string[];
    duration: number;
  } | null>(null);

  const processAudio = useCallback(async () => {
    if (!audioFile) return;

    setIsProcessing(true);
    setResults([]);
    setSummary(null);
    setProgress(0);

    try {
      // Read the audio file
      const arrayBuffer = await audioFile.arrayBuffer();

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 44100 });

      // Decode the audio
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log(`Audio loaded: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels} channels, ${audioBuffer.sampleRate}Hz`);

      // Load the YIN worklet
      await audioContext.audioWorklet.addModule("/audioWorklets/yinProcessor.js");

      // Create nodes
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      const workletNode = new AudioWorkletNode(audioContext, "yin-processor", {
        processorOptions: { sampleRate: audioContext.sampleRate },
      });

      // Collect results
      const detections: DetectionResult[] = [];
      const startTime = performance.now();

      workletNode.port.onmessage = (event) => {
        const data = event.data;
        const currentTime = (performance.now() - startTime) / 1000;

        if (data.type === "confirmed") {
          detections.push({
            time: currentTime,
            type: "onset",
            note: data.detection?.note,
            frequency: data.detection?.frequency,
            confidence: data.detection?.cmndMin ? 1 - data.detection.cmndMin : undefined,
          });
          setResults([...detections]);
        }

        if (data.type === "frame") {
          detections.push({
            time: currentTime,
            type: "frame",
            note: data.note,
            rms: data.rms,
          });
          // Don't update UI for every frame (too many)
        }

        if (data.type === "noteOff") {
          detections.push({
            time: currentTime,
            type: "noteOff",
            note: data.note,
          });
          setResults([...detections]);
        }
      };

      // Connect and play
      source.connect(workletNode);
      source.connect(audioContext.destination); // Also play audio so we can hear it

      // Track progress
      const duration = audioBuffer.duration;
      const progressInterval = setInterval(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        setProgress(Math.min(100, (elapsed / duration) * 100));
      }, 100);

      source.start();

      // Wait for playback to complete
      await new Promise<void>((resolve) => {
        source.onended = () => {
          clearInterval(progressInterval);
          setProgress(100);
          resolve();
        };
      });

      // Generate summary
      const onsets = detections.filter(d => d.type === "onset");
      const frames = detections.filter(d => d.type === "frame");
      const noteOffs = detections.filter(d => d.type === "noteOff");
      const uniqueNotes = [...new Set(onsets.map(d => d.note).filter(Boolean))] as string[];

      setSummary({
        onsets: onsets.length,
        frames: frames.length,
        noteOffs: noteOffs.length,
        uniqueNotes,
        duration: audioBuffer.duration,
      });

      setResults(detections.filter(d => d.type !== "frame")); // Show only onsets/noteOffs

      // Cleanup
      await audioContext.close();

    } catch (err) {
      console.error("Error processing audio:", err);
      alert(`Error: ${err}`);
    } finally {
      setIsProcessing(false);
    }
  }, [audioFile]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
      setResults([]);
      setSummary(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Offline Audio Test</h1>
        <p className="text-slate-400 mb-6">
          Upload an audio recording to test the pitch detection algorithm.
          The audio will play back and detections will be logged.
        </p>

        {/* File Input */}
        <div className="bg-slate-800 p-4 rounded mb-6">
          <label className="block text-sm font-medium mb-2">Select Audio File</label>
          <input
            type="file"
            accept="audio/*,video/webm"
            onChange={handleFileSelect}
            className="block w-full text-sm text-slate-400
              file:mr-4 file:py-2 file:px-4
              file:rounded file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-600 file:text-white
              hover:file:bg-blue-700"
          />
          {audioFile && (
            <p className="mt-2 text-sm text-slate-400">
              Selected: {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
        </div>

        {/* Process Button */}
        <button
          onClick={processAudio}
          disabled={!audioFile || isProcessing}
          className={`px-6 py-3 rounded font-medium mb-6 ${
            !audioFile || isProcessing
              ? "bg-slate-700 text-slate-500 cursor-not-allowed"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {isProcessing ? "Processing..." : "Process Audio"}
        </button>

        {/* Progress */}
        {isProcessing && (
          <div className="mb-6">
            <div className="h-2 bg-slate-700 rounded">
              <div
                className="h-full bg-emerald-500 rounded transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-slate-400 mt-1">{progress.toFixed(0)}%</p>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-slate-800 p-4 rounded mb-6">
            <h2 className="text-lg font-semibold mb-3">Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-slate-400">Duration</div>
                <div className="text-xl font-mono">{summary.duration.toFixed(2)}s</div>
              </div>
              <div>
                <div className="text-slate-400">Onsets (confirmed)</div>
                <div className="text-xl font-mono text-emerald-400">{summary.onsets}</div>
              </div>
              <div>
                <div className="text-slate-400">Frames</div>
                <div className="text-xl font-mono">{summary.frames}</div>
              </div>
              <div>
                <div className="text-slate-400">Note Offs</div>
                <div className="text-xl font-mono">{summary.noteOffs}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-slate-400 text-sm">Unique Notes Detected</div>
              <div className="flex flex-wrap gap-2 mt-1">
                {summary.uniqueNotes.map((note, i) => (
                  <span key={i} className="px-2 py-1 bg-blue-600 rounded text-sm">
                    {note}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-slate-800 p-4 rounded">
            <h2 className="text-lg font-semibold mb-3">
              Detection Events ({results.length})
            </h2>
            <div className="max-h-96 overflow-y-auto font-mono text-xs space-y-1">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`${
                    r.type === "onset"
                      ? "text-emerald-400"
                      : r.type === "noteOff"
                        ? "text-orange-400"
                        : "text-slate-500"
                  }`}
                >
                  <span className="text-slate-600">{r.time.toFixed(3)}s</span>
                  {" "}
                  <span className="uppercase">[{r.type}]</span>
                  {" "}
                  {r.note && <span className="font-bold">{r.note}</span>}
                  {r.frequency && <span> ({r.frequency.toFixed(1)}Hz)</span>}
                  {r.confidence !== undefined && (
                    <span> conf:{(r.confidence * 100).toFixed(0)}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Link back */}
        <div className="mt-6">
          <a href="/pitch-test" className="text-blue-400 hover:underline">
            ← Back to Live Testing
          </a>
        </div>
      </div>
    </div>
  );
}
