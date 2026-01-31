/**
 * YIN Worklet Detector - Re-exports V3 algorithm
 *
 * This file provides backward compatibility for code that imports from yinWorkletDetector.
 * The actual implementation is in yinWorkletDetectorV3.ts which has been proven
 * to achieve 92%+ accuracy across 21 test songs.
 *
 * V3 Key Features:
 * - First-minimum CMND search (threshold 0.20)
 * - Octave-UP disambiguation (check tau/2, tau/4, tau/8)
 * - 130Hz floor with spectral-verified upward shift
 */

// Re-export V3 with backward-compatible names
export {
  detectPitchWorkletV3 as detectPitchWorklet,
  type WorkletDetectionV3 as WorkletDetection,
  type DetectorOptionsV3 as DetectorOptions
} from './yinWorkletDetectorV3';

// Also export V3 directly for explicit usage
export { detectPitchWorkletV3, getRecommendedWindowSize } from './yinWorkletDetectorV3';
