/**
 * Adaptive Threshold Calibration
 *
 * Auto-calibrates detection thresholds based on user's piano and microphone.
 * Runs during a calibration phase where user plays specific notes.
 */

export interface CalibrationResult {
  success: boolean;
  thresholds: CalibratedThresholds;
  stats: CalibrationStats;
  recommendations: string[];
}

export interface CalibratedThresholds {
  minRms: number;           // Minimum RMS for note detection
  maxCmnd: number;          // Maximum CMND (confidence) threshold
  onsetRatio: number;       // RMS ratio for onset detection
  lowNoteMinRms: number;    // Higher RMS threshold for low notes
  velocityScale: number;    // Multiplier to normalize velocity
}

export interface CalibrationStats {
  samplesCollected: number;
  notesDetected: number;
  averageRms: number;
  minRmsDetected: number;
  maxRmsDetected: number;
  averageConfidence: number;
  noiseFloor: number;
  dynamicRange: number;     // Ratio of max to min RMS
}

export interface CalibrationSample {
  note: string;
  frequency: number;
  rms: number;
  cmnd: number;
  timestamp: number;
}

/**
 * Calibration state manager
 */
export class AdaptiveCalibrator {
  private samples: CalibrationSample[] = [];
  private silenceSamples: number[] = [];
  private isCalibrating: boolean = false;
  private calibrationStartTime: number = 0;

  // Calibration phases
  private phase: 'silence' | 'soft' | 'normal' | 'loud' | 'complete' = 'silence';

  // Target notes for calibration (covers full range)
  private readonly CALIBRATION_NOTES = ['C3', 'C4', 'C5', 'A4'];

  constructor() {}

  /**
   * Start calibration process
   */
  start(): void {
    this.samples = [];
    this.silenceSamples = [];
    this.isCalibrating = true;
    this.calibrationStartTime = Date.now();
    this.phase = 'silence';
    console.log('[CALIBRATION] Started - listening for silence...');
  }

  /**
   * Add a sample during calibration
   */
  addSample(sample: CalibrationSample | null, rms: number): void {
    if (!this.isCalibrating) return;

    const elapsed = Date.now() - this.calibrationStartTime;

    // Phase 1: Collect silence samples (first 2 seconds)
    if (this.phase === 'silence') {
      if (elapsed < 2000) {
        this.silenceSamples.push(rms);
      } else {
        this.phase = 'soft';
        console.log('[CALIBRATION] Silence collected. Now play SOFTLY...');
      }
      return;
    }

    // Phases 2-4: Collect note samples
    if (sample) {
      this.samples.push(sample);

      if (this.phase === 'soft' && this.samples.length >= 5) {
        this.phase = 'normal';
        console.log('[CALIBRATION] Soft samples collected. Now play NORMALLY...');
      } else if (this.phase === 'normal' && this.samples.length >= 15) {
        this.phase = 'loud';
        console.log('[CALIBRATION] Normal samples collected. Now play LOUDLY...');
      } else if (this.phase === 'loud' && this.samples.length >= 25) {
        this.phase = 'complete';
        console.log('[CALIBRATION] Complete!');
      }
    }
  }

  /**
   * Check if calibration is complete
   */
  isComplete(): boolean {
    return this.phase === 'complete';
  }

  /**
   * Get current phase
   */
  getPhase(): string {
    return this.phase;
  }

  /**
   * Get progress (0-100)
   */
  getProgress(): number {
    switch (this.phase) {
      case 'silence': return 10;
      case 'soft': return 30;
      case 'normal': return 60;
      case 'loud': return 90;
      case 'complete': return 100;
      default: return 0;
    }
  }

  /**
   * Calculate calibrated thresholds from collected samples
   */
  getResults(): CalibrationResult {
    if (this.samples.length < 10) {
      return {
        success: false,
        thresholds: this.getDefaultThresholds(),
        stats: this.calculateStats(),
        recommendations: ['Not enough samples collected. Please try again.']
      };
    }

    const stats = this.calculateStats();
    const thresholds = this.calculateThresholds(stats);
    const recommendations = this.generateRecommendations(stats);

    this.isCalibrating = false;

    return {
      success: true,
      thresholds,
      stats,
      recommendations
    };
  }

  /**
   * Calculate statistics from samples
   */
  private calculateStats(): CalibrationStats {
    if (this.samples.length === 0) {
      return {
        samplesCollected: 0,
        notesDetected: 0,
        averageRms: 0,
        minRmsDetected: 0,
        maxRmsDetected: 0,
        averageConfidence: 0,
        noiseFloor: 0,
        dynamicRange: 1
      };
    }

    const rmsValues = this.samples.map(s => s.rms);
    const cmndValues = this.samples.map(s => s.cmnd);

    const averageRms = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
    const minRmsDetected = Math.min(...rmsValues);
    const maxRmsDetected = Math.max(...rmsValues);
    const averageConfidence = 1 - (cmndValues.reduce((a, b) => a + b, 0) / cmndValues.length);

    // Noise floor from silence samples
    const noiseFloor = this.silenceSamples.length > 0
      ? this.silenceSamples.reduce((a, b) => a + b, 0) / this.silenceSamples.length
      : 0.001;

    const dynamicRange = minRmsDetected > 0 ? maxRmsDetected / minRmsDetected : 1;

    return {
      samplesCollected: this.samples.length,
      notesDetected: this.samples.length,
      averageRms,
      minRmsDetected,
      maxRmsDetected,
      averageConfidence,
      noiseFloor,
      dynamicRange
    };
  }

  /**
   * Calculate optimal thresholds from statistics
   */
  private calculateThresholds(stats: CalibrationStats): CalibratedThresholds {
    // MinRMS: Set above noise floor but below softest played note
    const minRms = Math.max(
      stats.noiseFloor * 3,  // 3x noise floor
      stats.minRmsDetected * 0.5  // Half of softest detection
    );

    // Max CMND: Based on average confidence (lower CMND = higher confidence)
    const avgCmnd = 1 - stats.averageConfidence;
    const maxCmnd = Math.min(0.2, avgCmnd * 1.5);

    // Onset ratio: Based on dynamic range
    const onsetRatio = stats.dynamicRange > 5 ? 1.2 : 1.4;

    // Low note minimum RMS: Higher threshold for bass
    const lowNoteMinRms = minRms * 1.5;

    // Velocity scale: Normalize to typical range
    const targetMaxVelocity = 0.3; // Expected max RMS for fff
    const velocityScale = targetMaxVelocity / Math.max(stats.maxRmsDetected, 0.1);

    return {
      minRms,
      maxCmnd,
      onsetRatio,
      lowNoteMinRms,
      velocityScale
    };
  }

  /**
   * Generate user recommendations
   */
  private generateRecommendations(stats: CalibrationStats): string[] {
    const recommendations: string[] = [];

    if (stats.noiseFloor > 0.01) {
      recommendations.push('High background noise detected. Try moving to a quieter location.');
    }

    if (stats.dynamicRange < 3) {
      recommendations.push('Limited dynamic range. Try playing softer and louder notes.');
    }

    if (stats.averageConfidence < 0.7) {
      recommendations.push('Low detection confidence. Try moving the microphone closer to the piano.');
    }

    if (stats.samplesCollected < 20) {
      recommendations.push('More samples recommended for better calibration.');
    }

    if (recommendations.length === 0) {
      recommendations.push('Calibration looks good! Ready to practice.');
    }

    return recommendations;
  }

  /**
   * Get default thresholds (fallback)
   */
  private getDefaultThresholds(): CalibratedThresholds {
    return {
      minRms: 0.01,
      maxCmnd: 0.15,
      onsetRatio: 1.3,
      lowNoteMinRms: 0.015,
      velocityScale: 1.0
    };
  }

  /**
   * Stop calibration
   */
  stop(): void {
    this.isCalibrating = false;
    this.phase = 'complete';
  }

  /**
   * Reset calibration
   */
  reset(): void {
    this.samples = [];
    this.silenceSamples = [];
    this.isCalibrating = false;
    this.phase = 'silence';
  }
}

/**
 * Apply calibrated thresholds to detector
 */
export function applyCalibration(
  detector: { setGateThresholds: (gates: Partial<{ minRms: number; maxCmnd: number; onsetRatio: number }>) => void },
  thresholds: CalibratedThresholds
): void {
  detector.setGateThresholds({
    minRms: thresholds.minRms,
    maxCmnd: thresholds.maxCmnd,
    onsetRatio: thresholds.onsetRatio
  });
  console.log('[CALIBRATION] Applied thresholds:', thresholds);
}
