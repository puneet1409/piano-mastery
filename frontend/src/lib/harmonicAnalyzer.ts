/**
 * Harmonic Analysis for Octave Disambiguation
 *
 * Uses harmonic template matching to verify if a detected fundamental
 * frequency is correct or if it's actually a harmonic of a lower note.
 *
 * Piano notes have characteristic harmonic patterns:
 * - f0 (fundamental)
 * - 2*f0 (octave)
 * - 3*f0 (perfect fifth + octave)
 * - 4*f0 (2 octaves)
 * - 5*f0 (major third + 2 octaves)
 * etc.
 *
 * If we detect a frequency and its sub-harmonics have strong presence,
 * the detected frequency might actually be a harmonic, not the fundamental.
 */

export interface HarmonicAnalysis {
  frequency: number;
  isLikelyFundamental: boolean;
  harmonicScore: number; // 0-1, higher = more likely to be fundamental
  possibleFundamental: number | null; // If not fundamental, what might be
  harmonicsPresent: number[]; // List of detected harmonics
}

/**
 * Compute FFT magnitude at specific frequency bins
 */
function computeMagnitudeAtFrequencies(
  samples: Float32Array,
  frequencies: number[],
  sampleRate: number
): Map<number, number> {
  const results = new Map<number, number>();
  const n = samples.length;

  // Apply window
  const windowed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    windowed[i] = samples[i] * window;
  }

  for (const freq of frequencies) {
    if (freq <= 0 || freq >= sampleRate / 2) {
      results.set(freq, 0);
      continue;
    }

    // Compute magnitude at this frequency using Goertzel algorithm (more efficient than full FFT)
    const k = Math.round(freq * n / sampleRate);
    const omega = 2 * Math.PI * k / n;
    const coeff = 2 * Math.cos(omega);

    let s0 = 0;
    let s1 = 0;
    let s2 = 0;

    for (let i = 0; i < n; i++) {
      s0 = windowed[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const real = s1 - s2 * Math.cos(omega);
    const imag = s2 * Math.sin(omega);
    const magnitude = Math.sqrt(real * real + imag * imag) / n;

    results.set(freq, magnitude);
  }

  return results;
}

/**
 * Analyze harmonics of a candidate fundamental frequency
 */
export function analyzeHarmonics(
  samples: Float32Array,
  candidateFreq: number,
  sampleRate: number = 44100
): HarmonicAnalysis {
  // Generate list of expected harmonics (up to 8th harmonic)
  const numHarmonics = 8;
  const harmonicFreqs: number[] = [];
  for (let h = 1; h <= numHarmonics; h++) {
    const harmFreq = candidateFreq * h;
    if (harmFreq < sampleRate / 2) {
      harmonicFreqs.push(harmFreq);
    }
  }

  // Also check sub-harmonics (in case candidateFreq is actually a harmonic)
  const subHarmonics: number[] = [];
  for (const div of [2, 3, 4]) {
    const subFreq = candidateFreq / div;
    if (subFreq >= 30) { // Minimum reasonable piano frequency
      subHarmonics.push(subFreq);
    }
  }

  // Compute magnitudes at all relevant frequencies
  const allFreqs = [...harmonicFreqs, ...subHarmonics];
  const magnitudes = computeMagnitudeAtFrequencies(samples, allFreqs, sampleRate);

  // Get fundamental magnitude
  const fundamentalMag = magnitudes.get(candidateFreq) || 0;

  // Calculate harmonic pattern score
  // A true fundamental should have harmonics with decreasing magnitude
  let harmonicScore = 0;
  const harmonicsPresent: number[] = [];
  let prevMag = fundamentalMag;

  for (let h = 2; h <= numHarmonics; h++) {
    const harmFreq = candidateFreq * h;
    const harmMag = magnitudes.get(harmFreq) || 0;

    if (harmFreq < sampleRate / 2 && harmMag > fundamentalMag * 0.05) {
      harmonicsPresent.push(harmFreq);

      // Harmonics should generally decrease in magnitude
      if (harmMag < prevMag * 1.5) {
        harmonicScore += 1 / h; // Weight lower harmonics more
      }
      prevMag = harmMag;
    }
  }

  // Check if any sub-harmonic is stronger than our candidate
  let possibleFundamental: number | null = null;
  let strongestSubHarmonic = 0;

  for (const subFreq of subHarmonics) {
    const subMag = magnitudes.get(subFreq) || 0;

    // If sub-harmonic has significant energy, our candidate might be a harmonic
    if (subMag > fundamentalMag * 0.3 && subMag > strongestSubHarmonic) {
      // Verify by checking if sub-harmonic has its own harmonic pattern
      const subHarmonicMag2 = magnitudes.get(subFreq * 2) || 0;

      // If sub-harmonic and its octave are both strong, candidate might be a harmonic
      if (subHarmonicMag2 > fundamentalMag * 0.2) {
        strongestSubHarmonic = subMag;
        possibleFundamental = subFreq;
      }
    }
  }

  // Normalize harmonic score to 0-1
  const maxScore = numHarmonics * 0.5; // Theoretical max
  const normalizedScore = Math.min(1, harmonicScore / maxScore);

  // Determine if likely fundamental
  const isLikelyFundamental = possibleFundamental === null || fundamentalMag > strongestSubHarmonic * 0.7;

  return {
    frequency: candidateFreq,
    isLikelyFundamental,
    harmonicScore: normalizedScore,
    possibleFundamental,
    harmonicsPresent
  };
}

/**
 * Enhanced octave verification using harmonic analysis
 *
 * Given multiple octave candidates (e.g., 220Hz, 440Hz, 880Hz),
 * determine which is most likely the actual played note.
 */
export function verifyOctave(
  samples: Float32Array,
  candidates: Array<{ frequency: number; confidence: number }>,
  sampleRate: number = 44100
): { frequency: number; confidence: number; octaveVerified: boolean } | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { ...candidates[0], octaveVerified: false };
  }

  // Analyze each candidate
  const analyses = candidates.map(c => ({
    candidate: c,
    analysis: analyzeHarmonics(samples, c.frequency, sampleRate)
  }));

  // Score each candidate based on harmonic analysis and original confidence
  let bestCandidate = analyses[0];
  let bestScore = -1;

  for (const { candidate, analysis } of analyses) {
    // Combine original confidence with harmonic analysis
    let score = candidate.confidence * 0.5;

    // Bonus for being likely fundamental
    if (analysis.isLikelyFundamental) {
      score += 0.3;
    }

    // Bonus for having good harmonic pattern
    score += analysis.harmonicScore * 0.2;

    // Slight preference for middle piano range (more common in practice)
    const freq = candidate.frequency;
    if (freq >= 130 && freq <= 1000) {
      score += 0.1;
    } else if (freq >= 80 && freq <= 2000) {
      score += 0.05;
    }

    // Penalty if this candidate might be a harmonic of something else
    if (analysis.possibleFundamental !== null) {
      score -= 0.2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = { candidate, analysis };
    }
  }

  return {
    frequency: bestCandidate.candidate.frequency,
    confidence: Math.min(1, bestCandidate.candidate.confidence * (bestCandidate.analysis.isLikelyFundamental ? 1.2 : 0.8)),
    octaveVerified: true
  };
}

/**
 * Piano-specific harmonic template
 * Piano strings have slightly inharmonic overtones (stretched)
 */
export const PIANO_HARMONIC_TEMPLATE = {
  // Relative strengths of first 8 harmonics for typical piano note
  harmonicWeights: [1.0, 0.5, 0.33, 0.25, 0.2, 0.15, 0.1, 0.08],

  // Inharmonicity factor (higher for lower strings)
  getInharmonicity: (fundamentalHz: number): number => {
    if (fundamentalHz < 100) return 0.0005; // Bass strings
    if (fundamentalHz < 300) return 0.0003; // Middle range
    return 0.0001; // Treble
  },

  // Get expected harmonic frequency with piano-specific stretch
  getHarmonicFrequency: (fundamental: number, harmonicNumber: number): number => {
    const B = PIANO_HARMONIC_TEMPLATE.getInharmonicity(fundamental);
    // Piano strings have slightly sharp upper partials
    return fundamental * harmonicNumber * Math.sqrt(1 + B * harmonicNumber * harmonicNumber);
  }
};
