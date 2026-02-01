/**
 * Audio recorder utility for debugging pitch detection.
 * Records mic input to a WAV file for offline analysis.
 */

export class AudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private recordedChunks: Float32Array[] = [];
  private isRecording: boolean = false;
  private sampleRate: number = 44100;

  async start(): Promise<void> {
    if (this.isRecording) return;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Use ScriptProcessorNode to capture raw samples
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.recordedChunks = [];

    this.processor.onaudioprocess = (e) => {
      if (this.isRecording) {
        const inputData = e.inputBuffer.getChannelData(0);
        this.recordedChunks.push(new Float32Array(inputData));
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    this.isRecording = true;
    console.log('[AudioRecorder] Recording started');
  }

  stop(): Float32Array {
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // Combine all chunks into one array
    const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.recordedChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    console.log(`[AudioRecorder] Recording stopped: ${(totalLength / this.sampleRate).toFixed(1)}s, ${totalLength} samples`);
    return combined;
  }

  /**
   * Convert recorded audio to WAV blob for download
   */
  static toWavBlob(samples: Float32Array, sampleRate: number = 44100): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);  // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Audio data (convert float to int16)
    let offset2 = 44;
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset2, sample * 0x7FFF, true);
      offset2 += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /**
   * Download recorded audio as WAV file
   */
  static downloadWav(samples: Float32Array, filename: string = 'recording.wav', sampleRate: number = 44100): void {
    const blob = this.toWavBlob(samples, sampleRate);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`[AudioRecorder] Downloaded ${filename}`);
  }
}

/**
 * Global recorder instance for easy access from console
 */
let globalRecorder: AudioRecorder | null = null;
let globalRecording: Float32Array | null = null;
// Auto-record enabled by default for debug/testing
let autoRecordEnabled: boolean = true;

export function startRecording(): Promise<void> {
  globalRecorder = new AudioRecorder();
  return globalRecorder.start();
}

export function stopRecording(): Float32Array {
  if (!globalRecorder) throw new Error('No recording in progress');
  globalRecording = globalRecorder.stop();
  globalRecorder = null;
  return globalRecording;
}

export function downloadRecording(filename: string = 'demo-recording.wav'): void {
  if (!globalRecording) throw new Error('No recording available');
  AudioRecorder.downloadWav(globalRecording, filename);
}

export function getRecording(): Float32Array | null {
  return globalRecording;
}

/**
 * Auto-recording functions for debug/test mode
 * Automatically records during exercise and saves on stop
 */
export function enableAutoRecord(): void {
  autoRecordEnabled = true;
  console.log('[AudioRecorder] Auto-record ENABLED - will record during exercises');
}

export function disableAutoRecord(): void {
  autoRecordEnabled = false;
  console.log('[AudioRecorder] Auto-record DISABLED');
}

export function isAutoRecordEnabled(): boolean {
  return autoRecordEnabled;
}

export async function autoStartRecording(): Promise<void> {
  if (!autoRecordEnabled) return;
  if (globalRecorder) return; // Already recording
  try {
    await startRecording();
    console.log('[AudioRecorder] Auto-recording started');
  } catch (err) {
    console.error('[AudioRecorder] Failed to auto-start recording:', err);
  }
}

export function autoStopAndSaveRecording(exerciseName?: string): void {
  if (!autoRecordEnabled) return;
  if (!globalRecorder) return; // Not recording
  try {
    const samples = stopRecording();
    if (samples.length > 0) {
      // Generate filename with timestamp
      const timestamp = Date.now();
      const safeName = (exerciseName || 'exercise').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      const filename = `${safeName}-${timestamp}.wav`;
      AudioRecorder.downloadWav(samples, filename);
      console.log(`[AudioRecorder] Auto-saved recording: ${filename}`);
    }
  } catch (err) {
    console.error('[AudioRecorder] Failed to auto-save recording:', err);
  }
}

// Expose to window for console access
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).startRecording = startRecording;
  (window as unknown as Record<string, unknown>).stopRecording = stopRecording;
  (window as unknown as Record<string, unknown>).downloadRecording = downloadRecording;
  (window as unknown as Record<string, unknown>).getRecording = getRecording;
  (window as unknown as Record<string, unknown>).enableAutoRecord = enableAutoRecord;
  (window as unknown as Record<string, unknown>).disableAutoRecord = disableAutoRecord;
}
