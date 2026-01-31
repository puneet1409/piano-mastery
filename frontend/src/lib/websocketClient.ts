interface AudioEvent {
  type: string;
  data: any;
  timestamp: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private onEvent: ((event: AudioEvent) => void) | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  connect(onEvent: (event: AudioEvent) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.onEvent = onEvent;

      const wsUrl = `ws://localhost:8000/ws/${this.sessionId}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
        resolve();
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        reject(error);
      };

      this.ws.onmessage = (message) => {
        const event: AudioEvent = JSON.parse(message.data);
        if (this.onEvent) {
          this.onEvent(event);
        }
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected");
      };
    });
  }

  /**
   * Send audio chunk to backend for pitch detection.
   *
   * @param samples - Float32Array of audio samples
   * @param expectedNotes - Optional list of expected notes for score-aware detection
   *                        (e.g., ["C4", "E4", "G4"] for a C major chord)
   */
  sendAudioChunk(samples: Float32Array, expectedNotes?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
      return;
    }

    // Convert Float32Array to base64 for efficient transfer
    const buffer = new ArrayBuffer(samples.length * 4);
    const view = new Float32Array(buffer);
    view.set(samples);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));

    const event: AudioEvent = {
      type: "audio_chunk",
      data: {
        audio: base64,
        sample_rate: 44100,
        expected_notes: expectedNotes,  // Score-aware detection
      },
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(event));
  }

  send(event: Omit<AudioEvent, 'timestamp'> & { timestamp?: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not connected");
      return;
    }
    const eventWithTimestamp: AudioEvent = {
      ...event,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    this.ws.send(JSON.stringify(eventWithTimestamp));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
