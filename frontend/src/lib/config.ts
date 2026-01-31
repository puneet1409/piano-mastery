/**
 * Application Configuration
 *
 * Centralizes environment-specific configuration like backend URLs.
 */

export function getBackendHttpUrl(): string {
  // Check environment variable first
  if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }

  // Default to localhost:8000
  return 'http://localhost:8000';
}

export function getBackendWsUrl(): string {
  const httpUrl = getBackendHttpUrl();

  // Convert http:// to ws:// and https:// to wss://
  return httpUrl
    .replace('http://', 'ws://')
    .replace('https://', 'wss://');
}

export const config = {
  backendHttp: getBackendHttpUrl(),
  backendWs: getBackendWsUrl(),

  // Audio settings
  audio: {
    sampleRate: 44100,
    fftSize: 2048,
    smoothingTimeConstant: 0.3,
  },

  // WebSocket settings
  websocket: {
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000,
  },
} as const;
