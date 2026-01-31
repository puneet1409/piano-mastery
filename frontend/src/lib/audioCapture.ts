export class AudioCapture {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private onAudioData: ((samples: Float32Array) => void) | null = null;

  async start(onAudioData: (samples: Float32Array) => void): Promise<void> {
    this.onAudioData = onAudioData;

    // Request microphone access
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 44100,
      },
    });

    // Setup Web Audio API
    this.audioContext = new AudioContext({ sampleRate: 44100 });
    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Create processor for streaming chunks
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      if (this.onAudioData) {
        this.onAudioData(inputData);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  isRecording(): boolean {
    return this.mediaStream !== null && this.audioContext !== null;
  }
}
