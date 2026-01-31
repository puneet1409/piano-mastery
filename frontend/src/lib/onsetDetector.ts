/**
 * Onset Detection using Spectral Flux
 *
 * Detects when new notes start vs sustained notes.
 * Uses spectral flux (change in frequency content over time) to identify attacks.
 */

export interface OnsetResult {
  isOnset: boolean;
  flux: number;
  threshold: number;
  energy: number;
}

export class OnsetDetector {
  private sampleRate: number;
  private fftSize: number;
  private previousSpectrum: Float32Array | null = null;
  private fluxHistory: number[] = [];
  private energyHistory: number[] = [];

  // Adaptive threshold parameters
  private readonly HISTORY_SIZE = 10;
  private readonly ONSET_MULTIPLIER = 1.5; // Flux must be 1.5x above average
  private readonly MIN_ENERGY = 0.01; // Minimum energy to consider
  private readonly COOLDOWN_MS = 50; // Minimum time between onsets

  private lastOnsetTime = 0;

  constructor(sampleRate: number = 44100, fftSize: number = 2048) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
  }

  /**
   * Compute FFT magnitude spectrum
   */
  private computeSpectrum(samples: Float32Array): Float32Array {
    const n = this.fftSize;
    const spectrum = new Float32Array(n / 2);

    // Apply Hanning window
    const windowed = new Float32Array(n);
    for (let i = 0; i < n && i < samples.length; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
      windowed[i] = samples[i] * window;
    }

    // Simple DFT for magnitude (not optimized but works for small buffers)
    for (let k = 0; k < n / 2; k++) {
      let real = 0;
      let imag = 0;
      for (let t = 0; t < n; t++) {
        const angle = -2 * Math.PI * k * t / n;
        real += windowed[t] * Math.cos(angle);
        imag += windowed[t] * Math.sin(angle);
      }
      spectrum[k] = Math.sqrt(real * real + imag * imag);
    }

    return spectrum;
  }

  /**
   * Compute spectral flux (positive difference only)
   */
  private computeFlux(currentSpectrum: Float32Array, previousSpectrum: Float32Array): number {
    let flux = 0;
    for (let i = 0; i < currentSpectrum.length; i++) {
      const diff = currentSpectrum[i] - previousSpectrum[i];
      // Only count increases (onsets have positive spectral change)
      if (diff > 0) {
        flux += diff;
      }
    }
    return flux;
  }

  /**
   * Compute RMS energy
   */
  private computeEnergy(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Detect if current frame contains an onset
   */
  detect(samples: Float32Array, currentTimeMs: number): OnsetResult {
    const energy = this.computeEnergy(samples);
    const currentSpectrum = this.computeSpectrum(samples);

    // Initialize on first call
    if (this.previousSpectrum === null) {
      this.previousSpectrum = currentSpectrum;
      return { isOnset: false, flux: 0, threshold: 0, energy };
    }

    // Compute spectral flux
    const flux = this.computeFlux(currentSpectrum, this.previousSpectrum);
    this.previousSpectrum = currentSpectrum;

    // Update history
    this.fluxHistory.push(flux);
    this.energyHistory.push(energy);
    if (this.fluxHistory.length > this.HISTORY_SIZE) {
      this.fluxHistory.shift();
      this.energyHistory.shift();
    }

    // Compute adaptive threshold
    const avgFlux = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length;
    const threshold = avgFlux * this.ONSET_MULTIPLIER;

    // Check onset conditions
    const hasEnergy = energy > this.MIN_ENERGY;
    const exceedsThreshold = flux > threshold && flux > avgFlux * 0.5; // Also check absolute level
    const cooldownPassed = (currentTimeMs - this.lastOnsetTime) > this.COOLDOWN_MS;

    const isOnset = hasEnergy && exceedsThreshold && cooldownPassed;

    if (isOnset) {
      this.lastOnsetTime = currentTimeMs;
    }

    return { isOnset, flux, threshold, energy };
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.previousSpectrum = null;
    this.fluxHistory = [];
    this.energyHistory = [];
    this.lastOnsetTime = 0;
  }
}

/**
 * High-Frequency Content (HFC) onset detector
 * Better for percussive attacks and piano notes
 */
export class HFCOnsetDetector {
  private sampleRate: number;
  private fftSize: number;
  private previousHFC: number = 0;
  private hfcHistory: number[] = [];

  private readonly HISTORY_SIZE = 8;
  private readonly ONSET_MULTIPLIER = 2.0;
  private readonly MIN_HFC = 0.001;
  private readonly COOLDOWN_MS = 40;

  private lastOnsetTime = 0;

  constructor(sampleRate: number = 44100, fftSize: number = 1024) {
    this.sampleRate = sampleRate;
    this.fftSize = fftSize;
  }

  /**
   * Compute High-Frequency Content
   * Weights higher frequencies more heavily (better for attack detection)
   */
  private computeHFC(samples: Float32Array): number {
    const n = this.fftSize;
    let hfc = 0;

    // Apply window and compute weighted spectrum
    for (let k = 1; k < n / 4; k++) { // Focus on lower-mid frequencies for piano
      let real = 0;
      let imag = 0;
      for (let t = 0; t < Math.min(n, samples.length); t++) {
        const window = 0.5 * (1 - Math.cos(2 * Math.PI * t / (n - 1)));
        const angle = -2 * Math.PI * k * t / n;
        real += samples[t] * window * Math.cos(angle);
        imag += samples[t] * window * Math.sin(angle);
      }
      const magnitude = Math.sqrt(real * real + imag * imag);
      // Weight by frequency bin (higher bins weighted more)
      hfc += magnitude * k;
    }

    return hfc / (n / 4);
  }

  detect(samples: Float32Array, currentTimeMs: number): OnsetResult {
    const hfc = this.computeHFC(samples);
    const energy = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);

    // Compute derivative (change in HFC)
    const hfcDelta = Math.max(0, hfc - this.previousHFC);
    this.previousHFC = hfc;

    // Update history
    this.hfcHistory.push(hfcDelta);
    if (this.hfcHistory.length > this.HISTORY_SIZE) {
      this.hfcHistory.shift();
    }

    // Adaptive threshold
    const avgDelta = this.hfcHistory.reduce((a, b) => a + b, 0) / this.hfcHistory.length;
    const threshold = avgDelta * this.ONSET_MULTIPLIER;

    // Check onset
    const exceedsThreshold = hfcDelta > threshold && hfcDelta > this.MIN_HFC;
    const cooldownPassed = (currentTimeMs - this.lastOnsetTime) > this.COOLDOWN_MS;

    const isOnset = exceedsThreshold && cooldownPassed;

    if (isOnset) {
      this.lastOnsetTime = currentTimeMs;
    }

    return { isOnset, flux: hfcDelta, threshold, energy };
  }

  reset(): void {
    this.previousHFC = 0;
    this.hfcHistory = [];
    this.lastOnsetTime = 0;
  }
}
