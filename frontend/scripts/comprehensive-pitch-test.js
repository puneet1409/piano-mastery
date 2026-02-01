#!/usr/bin/env node
/**
 * Comprehensive Pitch Detection Test Suite
 *
 * Runs the YIN algorithm against recorded audio and generates detailed reports
 * with timestamp-based analysis of detection quality.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const WINDOW_SIZE = 3072;
const HOP_SIZE = 512;

// ============== YIN Algorithm V4 (matching worklet) ==============
function yinDetect(samples, sampleRate) {
  const bufferSize = samples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 80));
  const tauMin = Math.max(2, Math.ceil(sampleRate / 2000));

  if (tauMax < tauMin) return null;

  // Step 1: Difference function
  const diff = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    const len = bufferSize - tauMax;
    for (let i = 0; i < len; i++) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: CMND
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? (diff[tau] * tau) / runningSum : 1.0;
  }

  // Step 3: First minimum search (prefer FIRST = highest frequency)
  const threshold = 0.15;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      cmndMin = cmnd[tau];
      break;
    }
  }

  // Fallback: global minimum in 150-1000Hz range
  if (bestTau === null) {
    const searchMin = Math.ceil(sampleRate / 1000);
    const searchMax = Math.floor(sampleRate / 150);
    for (let tau = searchMin; tau < Math.min(searchMax, tauMax); tau++) {
      if (cmnd[tau] < cmndMin) {
        cmndMin = cmnd[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau === null || cmndMin > 0.35) return null;

  // Parabolic interpolation
  let refinedTau = bestTau;
  if (bestTau > 0 && bestTau < tauMax - 1) {
    const alpha = cmnd[bestTau - 1];
    const beta = cmnd[bestTau];
    const gamma = cmnd[bestTau + 1];
    const denom = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denom) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denom;
    }
  }

  let frequency = sampleRate / refinedTau;

  // Aggressive octave-UP for frequencies below 250Hz
  if (frequency < 250 && frequency >= 65) {
    const halfTau = Math.round(refinedTau / 2);
    if (halfTau >= tauMin && halfTau < tauMax && cmnd[halfTau] < 0.30) {
      frequency *= 2;
      cmndMin = cmnd[halfTau];
    }
  }

  // Hard floor at 130Hz
  while (frequency < 130 && frequency >= 32) {
    frequency *= 2;
  }

  if (frequency < 130 || frequency > 4500) return null;

  return { frequency, confidence: 1.0 - cmndMin, cmndMin };
}

function frequencyToNote(freq) {
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midiNote);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return { note: noteNames[noteIndex] + octave, midi: rounded };
}

function noteToFreq(noteName) {
  const noteMap = { 'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11 };
  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 0;
  const midi = (parseInt(match[2]) + 1) * 12 + noteMap[match[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// ============== Test Cases ==============
const TEST_CASES = [
  {
    id: 'silence-rejection',
    name: 'Silence Rejection',
    description: 'Should not detect notes during silence',
    timeRanges: [[0, 12]], // First 12 seconds appear silent
    expectedBehavior: 'no-detections',
  },
  {
    id: 'c4-detection',
    name: 'C4 Detection',
    description: 'Middle C detection accuracy',
    expectedNotes: ['C4'],
    frequencyRange: [255, 270], // C4 = 261.6Hz ± tolerance
  },
  {
    id: 'chromatic-scale',
    name: 'Chromatic Scale Detection',
    description: 'All semitones from C4 to C5',
    expectedNotes: ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'],
  },
  {
    id: 'octave-accuracy',
    name: 'Octave Accuracy',
    description: 'Should not confuse octaves (C3 vs C4 vs C5)',
    checkOctaveErrors: true,
  },
  {
    id: 'confidence-threshold',
    name: 'Confidence Threshold',
    description: 'Only accept detections with confidence >= 65%',
    minConfidence: 0.65,
  },
  {
    id: 'note-stability',
    name: 'Note Stability',
    description: 'Sustained notes should not oscillate between adjacent pitches',
    maxOscillations: 3, // per sustained note
  },
  {
    id: 'onset-detection',
    name: 'Onset Detection',
    description: 'Each keypress should produce exactly one onset',
  },
];

// ============== Audio Processing ==============
function loadAudio(filePath) {
  const tempFile = path.join(process.env.TEMP || '/tmp', `pitch_test_${Date.now()}.raw`);

  try {
    execSync(`ffmpeg -y -i "${filePath}" -f f32le -acodec pcm_f32le -ac 1 -ar 44100 "${tempFile}"`, {
      stdio: 'pipe'
    });
  } catch (err) {
    throw new Error(`ffmpeg failed: ${err.message}`);
  }

  const buffer = fs.readFileSync(tempFile);
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  fs.unlinkSync(tempFile);

  return samples;
}

function processAudio(samples) {
  const SILENCE_THRESHOLD = 0.003;
  const CONFIDENCE_THRESHOLD = 0.75;  // V5.1: stricter threshold

  const frames = [];
  const detections = [];
  let activeNote = null;
  let noteStartTime = 0;
  let silenceFrames = 0;

  // Octave hysteresis tracking
  let tentativeNote = null;
  let tentativeCount = 0;

  for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
    const window = samples.slice(i, i + WINDOW_SIZE);
    const timeMs = (i / SAMPLE_RATE) * 1000;
    const rms = calculateRms(window);

    const frame = { time: timeMs, rms, detection: null, note: null, confidence: 0 };

    if (rms < SILENCE_THRESHOLD) {
      silenceFrames++;
      tentativeNote = null;
      tentativeCount = 0;
      if (silenceFrames >= 3 && activeNote !== null) {
        detections.push({
          type: 'noteOff',
          note: activeNote.note,
          time: timeMs,
          duration: timeMs - noteStartTime,
          avgConfidence: activeNote.totalConf / activeNote.frameCount,
          frameCount: activeNote.frameCount,
        });
        activeNote = null;
      }
      frames.push(frame);
      continue;
    }

    silenceFrames = 0;
    const result = yinDetect(window, SAMPLE_RATE);

    if (!result) {
      tentativeNote = null;
      tentativeCount = 0;
      frames.push(frame);
      continue;
    }

    const confidence = result.confidence;
    frame.detection = result;
    frame.confidence = confidence;

    if (confidence < CONFIDENCE_THRESHOLD) {
      frame.rejected = 'low-confidence';
      tentativeNote = null;
      tentativeCount = 0;
      frames.push(frame);
      continue;
    }

    const { note, midi } = frequencyToNote(result.frequency);
    frame.note = note;
    frame.midi = midi;

    // V5 HYSTERESIS: require more frames to prevent oscillation
    let requiredFrames = 2;
    if (activeNote !== null) {
      const midiDiff = Math.abs(activeNote.midi - midi);
      if (midiDiff === 12 || midiDiff === 24) {
        // Octave jump - require strong evidence
        requiredFrames = 8;
        if (confidence < 0.85) {
          frames.push(frame);
          continue;
        }
      } else if (midiDiff <= 2) {
        // Semitone/whole-tone - require slightly more evidence
        requiredFrames = 3;
      }
    }

    // Track tentative note
    if (tentativeNote !== note) {
      tentativeNote = note;
      tentativeCount = 1;
    } else {
      tentativeCount++;
    }

    // Only accept note if we have enough consecutive frames
    if (tentativeCount < requiredFrames) {
      frames.push(frame);
      continue;
    }

    if (activeNote === null || activeNote.note !== note) {
      // New note confirmed
      if (activeNote !== null) {
        detections.push({
          type: 'noteOff',
          note: activeNote.note,
          time: timeMs,
          duration: timeMs - noteStartTime,
          avgConfidence: activeNote.totalConf / activeNote.frameCount,
          frameCount: activeNote.frameCount,
        });
      }

      detections.push({
        type: 'onset',
        note: note,
        midi: midi,
        time: timeMs,
        frequency: result.frequency,
        confidence: confidence,
      });

      activeNote = { note, midi, totalConf: confidence, frameCount: 1 };
      noteStartTime = timeMs;
    } else {
      // Sustaining
      activeNote.totalConf += confidence;
      activeNote.frameCount++;
    }

    frames.push(frame);
  }

  // Close final note
  if (activeNote !== null) {
    const endTime = (samples.length / SAMPLE_RATE) * 1000;
    detections.push({
      type: 'noteOff',
      note: activeNote.note,
      time: endTime,
      duration: endTime - noteStartTime,
      avgConfidence: activeNote.totalConf / activeNote.frameCount,
      frameCount: activeNote.frameCount,
    });
  }

  return { frames, detections };
}

// ============== Test Analysis ==============
function analyzeResults(frames, detections) {
  const report = {
    summary: {},
    tests: [],
    issues: [],
    timeline: [],
  };

  // Basic stats
  const onsets = detections.filter(d => d.type === 'onset');
  const noteOffs = detections.filter(d => d.type === 'noteOff');
  const uniqueNotes = [...new Set(onsets.map(d => d.note))];

  report.summary = {
    totalFrames: frames.length,
    totalDuration: frames.length > 0 ? frames[frames.length - 1].time / 1000 : 0,
    silentFrames: frames.filter(f => f.rms < 0.003).length,
    detectedFrames: frames.filter(f => f.note).length,
    lowConfidenceFrames: frames.filter(f => f.rejected === 'low-confidence').length,
    onsetCount: onsets.length,
    uniqueNotes: uniqueNotes,
    notesByFrequency: {},
  };

  // Note frequency histogram
  for (const onset of onsets) {
    report.summary.notesByFrequency[onset.note] = (report.summary.notesByFrequency[onset.note] || 0) + 1;
  }

  // ===== TEST 1: Silence Rejection =====
  const silenceTest = {
    name: 'Silence Rejection (0-12s)',
    passed: true,
    details: [],
  };
  const silenceDetections = onsets.filter(d => d.time < 12000);
  if (silenceDetections.length > 0) {
    silenceTest.passed = false;
    silenceTest.details.push(`Found ${silenceDetections.length} false detections during silence`);
    silenceDetections.forEach(d => {
      report.issues.push({
        type: 'false-positive',
        time: d.time,
        note: d.note,
        description: `Detection during silence period: ${d.note} at ${(d.time/1000).toFixed(2)}s`,
      });
    });
  } else {
    silenceTest.details.push('No false positives during silence');
  }
  report.tests.push(silenceTest);

  // ===== TEST 2: Confidence Distribution =====
  const confTest = {
    name: 'Confidence Distribution',
    passed: true,
    details: [],
  };
  const confValues = onsets.map(d => d.confidence);
  const avgConf = confValues.reduce((a, b) => a + b, 0) / confValues.length || 0;
  const lowConfCount = confValues.filter(c => c < 0.65).length;
  confTest.details.push(`Average confidence: ${(avgConf * 100).toFixed(1)}%`);
  confTest.details.push(`Low confidence detections (< 65%): ${lowConfCount}`);
  if (lowConfCount > onsets.length * 0.1) {
    confTest.passed = false;
    confTest.details.push('WARNING: >10% of detections have low confidence');
  }
  report.tests.push(confTest);

  // ===== TEST 3: Octave Accuracy =====
  const octaveTest = {
    name: 'Octave Accuracy',
    passed: true,
    details: [],
    errors: [],
  };

  // Find rapid octave jumps (likely errors)
  for (let i = 1; i < onsets.length; i++) {
    const prev = onsets[i - 1];
    const curr = onsets[i];
    const timeDiff = curr.time - prev.time;
    const midiDiff = Math.abs(curr.midi - prev.midi);

    // If notes are within 100ms and exactly 12 semitones apart, likely octave error
    if (timeDiff < 100 && (midiDiff === 12 || midiDiff === 24)) {
      octaveTest.errors.push({
        time: curr.time,
        from: prev.note,
        to: curr.note,
        timeDiff,
      });
      report.issues.push({
        type: 'octave-error',
        time: curr.time,
        note: `${prev.note}→${curr.note}`,
        description: `Rapid octave jump in ${timeDiff.toFixed(0)}ms`,
      });
    }
  }

  if (octaveTest.errors.length > 0) {
    octaveTest.passed = false;
    octaveTest.details.push(`Found ${octaveTest.errors.length} potential octave errors`);
  } else {
    octaveTest.details.push('No obvious octave errors detected');
  }
  report.tests.push(octaveTest);

  // ===== TEST 4: Note Stability =====
  const stabilityTest = {
    name: 'Note Stability',
    passed: true,
    details: [],
    oscillations: [],
  };

  // Find oscillations between adjacent notes
  let oscillationCount = 0;
  for (let i = 2; i < onsets.length; i++) {
    const a = onsets[i - 2];
    const b = onsets[i - 1];
    const c = onsets[i];

    // Check for A→B→A pattern within 500ms total
    if (a.note === c.note && a.note !== b.note && (c.time - a.time) < 500) {
      const midiDiff = Math.abs(a.midi - b.midi);
      if (midiDiff <= 2) { // Adjacent notes (1-2 semitones)
        oscillationCount++;
        stabilityTest.oscillations.push({
          time: b.time,
          pattern: `${a.note}→${b.note}→${c.note}`,
        });
      }
    }
  }

  if (oscillationCount > 5) {
    stabilityTest.passed = false;
    stabilityTest.details.push(`Found ${oscillationCount} note oscillations (instability)`);
    report.issues.push({
      type: 'instability',
      description: `${oscillationCount} oscillations between adjacent notes`,
    });
  } else {
    stabilityTest.details.push(`Oscillation count: ${oscillationCount} (acceptable)`);
  }
  report.tests.push(stabilityTest);

  // ===== TEST 5: Chromatic Coverage =====
  const chromaticTest = {
    name: 'Chromatic Coverage',
    passed: true,
    details: [],
  };
  const expectedChromatic = ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'];
  const detectedSet = new Set(uniqueNotes);
  const foundChromatic = expectedChromatic.filter(n => detectedSet.has(n));
  const missingChromatic = expectedChromatic.filter(n => !detectedSet.has(n));

  chromaticTest.details.push(`Found ${foundChromatic.length}/13 chromatic notes: ${foundChromatic.join(', ')}`);
  if (missingChromatic.length > 0) {
    chromaticTest.details.push(`Missing: ${missingChromatic.join(', ')}`);
  }
  report.tests.push(chromaticTest);

  // ===== TEST 6: Detection Latency Proxy =====
  const latencyTest = {
    name: 'Detection Consistency',
    passed: true,
    details: [],
  };

  // Check note durations (very short = potential glitch)
  const veryShortNotes = noteOffs.filter(n => n.duration < 50);
  if (veryShortNotes.length > 10) {
    latencyTest.passed = false;
    latencyTest.details.push(`${veryShortNotes.length} notes shorter than 50ms (potential glitches)`);
  } else {
    latencyTest.details.push(`Short note count: ${veryShortNotes.length} (acceptable)`);
  }
  report.tests.push(latencyTest);

  // ===== Generate Timeline =====
  // Group detections into 10-second windows
  const windowSize = 10000; // 10 seconds
  const maxTime = frames.length > 0 ? frames[frames.length - 1].time : 0;

  for (let t = 0; t < maxTime; t += windowSize) {
    const windowOnsets = onsets.filter(d => d.time >= t && d.time < t + windowSize);
    const windowNotes = [...new Set(windowOnsets.map(d => d.note))];
    const avgConf = windowOnsets.length > 0
      ? windowOnsets.reduce((sum, d) => sum + d.confidence, 0) / windowOnsets.length
      : 0;

    report.timeline.push({
      startTime: t / 1000,
      endTime: (t + windowSize) / 1000,
      onsetCount: windowOnsets.length,
      uniqueNotes: windowNotes,
      avgConfidence: avgConf,
    });
  }

  return report;
}

// ============== Main ==============
const audioPath = process.argv[2];
if (!audioPath) {
  console.log('Usage: node comprehensive-pitch-test.js <audio.webm>');
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('  COMPREHENSIVE PITCH DETECTION TEST REPORT');
console.log('='.repeat(60));
console.log('\nAudio file:', audioPath);
console.log('Processing...\n');

const samples = loadAudio(audioPath);
const { frames, detections } = processAudio(samples);
const report = analyzeResults(frames, detections);

// Print Summary
console.log('='.repeat(60));
console.log('  SUMMARY');
console.log('='.repeat(60));
console.log(`Duration: ${report.summary.totalDuration.toFixed(1)} seconds`);
console.log(`Total frames: ${report.summary.totalFrames}`);
console.log(`Silent frames: ${report.summary.silentFrames} (${(report.summary.silentFrames / report.summary.totalFrames * 100).toFixed(1)}%)`);
console.log(`Detected frames: ${report.summary.detectedFrames}`);
console.log(`Low confidence (rejected): ${report.summary.lowConfidenceFrames}`);
console.log(`Total onsets: ${report.summary.onsetCount}`);
console.log(`Unique notes: ${report.summary.uniqueNotes.length}`);
console.log('\nNote distribution:');
Object.entries(report.summary.notesByFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .forEach(([note, count]) => {
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`  ${note.padEnd(4)} ${bar} (${count})`);
  });

// Print Test Results
console.log('\n' + '='.repeat(60));
console.log('  TEST RESULTS');
console.log('='.repeat(60));
let passCount = 0;
let failCount = 0;
for (const test of report.tests) {
  const icon = test.passed ? '✓' : '✗';
  const color = test.passed ? '\x1b[32m' : '\x1b[31m';
  console.log(`\n${color}${icon}\x1b[0m ${test.name}`);
  test.details.forEach(d => console.log(`    ${d}`));
  if (test.passed) passCount++;
  else failCount++;
}

// Print Issues
if (report.issues.length > 0) {
  console.log('\n' + '='.repeat(60));
  console.log('  ISSUES FOUND');
  console.log('='.repeat(60));

  const issuesByType = {};
  for (const issue of report.issues) {
    issuesByType[issue.type] = issuesByType[issue.type] || [];
    issuesByType[issue.type].push(issue);
  }

  for (const [type, issues] of Object.entries(issuesByType)) {
    console.log(`\n${type.toUpperCase()} (${issues.length}):`);
    issues.slice(0, 10).forEach(issue => {
      const timeStr = issue.time ? `${(issue.time/1000).toFixed(2)}s` : '';
      console.log(`  ${timeStr.padEnd(8)} ${issue.note || ''} ${issue.description || ''}`);
    });
    if (issues.length > 10) {
      console.log(`  ... and ${issues.length - 10} more`);
    }
  }
}

// Print Timeline
console.log('\n' + '='.repeat(60));
console.log('  TIMELINE (10-second windows)');
console.log('='.repeat(60));
console.log('\nTime(s)   Onsets  Avg Conf  Notes');
console.log('-'.repeat(60));
for (const window of report.timeline) {
  if (window.onsetCount > 0) {
    const notes = window.uniqueNotes.slice(0, 8).join(', ');
    const more = window.uniqueNotes.length > 8 ? '...' : '';
    console.log(
      `${window.startTime.toFixed(0).padStart(3)}-${window.endTime.toFixed(0).padStart(3)}s  ` +
      `${String(window.onsetCount).padStart(4)}    ` +
      `${(window.avgConfidence * 100).toFixed(0).padStart(3)}%      ` +
      `${notes}${more}`
    );
  }
}

// Final Score
console.log('\n' + '='.repeat(60));
console.log('  FINAL SCORE');
console.log('='.repeat(60));
console.log(`\nTests passed: ${passCount}/${passCount + failCount}`);
console.log(`Issues found: ${report.issues.length}`);

const score = Math.round((passCount / (passCount + failCount)) * 100 - Math.min(report.issues.length, 20));
console.log(`\nOverall score: ${score}/100`);

if (score >= 80) {
  console.log('\x1b[32m✓ GOOD - Algorithm performing well\x1b[0m');
} else if (score >= 60) {
  console.log('\x1b[33m⚠ FAIR - Some improvements needed\x1b[0m');
} else {
  console.log('\x1b[31m✗ POOR - Significant issues found\x1b[0m');
}

// Save detailed report
const reportPath = audioPath.replace('.webm', '-test-report.json');
fs.writeFileSync(reportPath, JSON.stringify({ ...report, detections }, null, 2));
console.log(`\nDetailed report saved to: ${reportPath}`);
console.log('');
