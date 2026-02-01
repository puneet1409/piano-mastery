#!/usr/bin/env node
/**
 * Automated Pitch Detection Test Runner
 *
 * Runs the YIN algorithm against recorded test bundles and validates results.
 *
 * Test bundles are .json files with a companion .webm audio file.
 * The JSON contains expected notes, remarks, and the original detection log.
 *
 * Usage:
 *   node scripts/run-pitch-tests.js              # Run all tests
 *   node scripts/run-pitch-tests.js --list       # List available tests
 *   node scripts/run-pitch-tests.js <test-file>  # Run specific test
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'audio');
const SAMPLE_RATE = 44100;
const WINDOW_SIZE = 3072;
const HOP_SIZE = 512;

// ============== YIN Algorithm V4 ==============
// Matches yinProcessor.js worklet - aggressive octave-UP preference
function yinDetect(samples, sampleRate) {
  const tauMax = Math.min(Math.floor(samples.length / 2), Math.floor(sampleRate / 60));
  if (tauMax < 2) return null;

  // Step 1: Difference function
  const diff = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < tauMax; i++) {
      const d = samples[i] - samples[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference (CMND)
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? diff[tau] / (runningSum / tau) : 1.0;
  }

  // Step 3: Find first tau below threshold (tighter threshold for V4)
  const threshold = 0.15;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      cmndMin = cmnd[tau];
      break;
    }
  }

  // Fallback: find global minimum
  if (bestTau === null) {
    const minTau = Math.ceil(sampleRate / 2000);
    const maxTauSearch = Math.floor(sampleRate / 80);
    for (let tau = minTau; tau < Math.min(maxTauSearch, tauMax); tau++) {
      if (cmnd[tau] < cmndMin) {
        cmndMin = cmnd[tau];
        bestTau = tau;
      }
    }
  }

  if (bestTau === null) return null;

  // Step 4: Parabolic interpolation
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
  if (frequency < 60 || frequency > 5000) return null;

  // V4: Aggressive octave-UP preference for low frequencies
  // If frequency < 250Hz, check if octave-up has good CMND too
  if (frequency < 250) {
    const halfTau = refinedTau / 2;
    if (halfTau >= 2 && halfTau < tauMax) {
      const halfTauInt = Math.floor(halfTau);
      const halfCmnd = cmnd[halfTauInt];
      // If octave-up CMND is reasonable (< 0.35), prefer it
      if (halfCmnd < 0.35) {
        frequency *= 2;
      }
    }
  }

  // 130Hz floor with octave correction
  if (frequency < 130 && frequency >= 32) {
    while (frequency < 130) {
      frequency *= 2;
    }
  }

  if (frequency < 130) return null;

  return { frequency, confidence: 1.0 - cmndMin, cmndMin };
}

function frequencyToNote(freq) {
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midiNote);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return noteNames[noteIndex] + octave;
}

function noteToMidi(noteName) {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return null;
  const [, note, octaveStr] = match;
  const noteIndex = noteNames.indexOf(note);
  if (noteIndex === -1) return null;
  const octave = parseInt(octaveStr, 10);
  return (octave + 1) * 12 + noteIndex;
}

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// ============== Audio Processing ==============
function processAudioFile(filePath) {
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

  // Process with onset detection (matching the fixed worklet algorithm with octave hysteresis)
  const detections = [];
  let activeNote = null;
  let silenceFrames = 0;
  let prevRms = 0;

  // Octave hysteresis state
  let pendingNote = null;
  let pendingNoteFrames = 0;

  const SILENCE_THRESHOLD = 0.003;
  const SILENCE_FRAMES_FOR_OFF = 3;
  const CONFIDENCE_THRESHOLD = 0.75;  // V5.1: stricter threshold
  const ONSET_RMS_RATIO = 1.5;
  // V5 hysteresis settings
  const OCTAVE_HYSTERESIS_FRAMES = 8;
  const OCTAVE_CONFIDENCE_THRESHOLD = 0.85;
  const SEMITONE_HYSTERESIS_FRAMES = 3;

  for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
    const window = samples.slice(i, i + WINDOW_SIZE);
    const timeMs = (i / SAMPLE_RATE) * 1000;
    const rms = calculateRms(window);

    if (rms < SILENCE_THRESHOLD) {
      silenceFrames++;
      if (silenceFrames >= SILENCE_FRAMES_FOR_OFF && activeNote !== null) {
        detections.push({ time: timeMs, type: 'noteOff', note: activeNote });
        activeNote = null;
        pendingNote = null;
        pendingNoteFrames = 0;
      }
      prevRms = rms;
      continue;
    }

    const isOnset = prevRms > 0.001 && rms > prevRms * ONSET_RMS_RATIO;
    if (isOnset && activeNote !== null) {
      activeNote = null; // Allow re-trigger
      pendingNote = null;
      pendingNoteFrames = 0;
    }

    silenceFrames = 0;
    prevRms = rms;

    const result = yinDetect(window, SAMPLE_RATE);
    if (!result || result.confidence < CONFIDENCE_THRESHOLD) continue;

    const note = frequencyToNote(result.frequency);

    if (activeNote === null || activeNote !== note) {
      // V5: Check for octave/semitone jump - require more evidence
      let requiredFrames = 2;
      if (activeNote !== null) {
        const activeMidi = noteToMidi(activeNote);
        const newMidi = noteToMidi(note);
        if (activeMidi !== null && newMidi !== null) {
          const midiDiff = Math.abs(activeMidi - newMidi);
          if (midiDiff === 12 || midiDiff === 24) {
            // Octave jump - require strong evidence
            requiredFrames = OCTAVE_HYSTERESIS_FRAMES;
            if (result.confidence < OCTAVE_CONFIDENCE_THRESHOLD) {
              continue; // Not confident enough for octave jump
            }
          } else if (midiDiff <= 2) {
            // Semitone/whole-tone - require slightly more evidence
            requiredFrames = SEMITONE_HYSTERESIS_FRAMES;
          }
        }
      }

      // Track pending note for confirmation
      if (pendingNote === note) {
        pendingNoteFrames++;
      } else {
        pendingNote = note;
        pendingNoteFrames = 1;
      }

      // Only emit if we have enough confirming frames
      if (pendingNoteFrames >= requiredFrames) {
        if (activeNote !== null && activeNote !== note) {
          detections.push({ time: timeMs, type: 'noteOff', note: activeNote });
        }
        detections.push({
          time: timeMs,
          type: 'onset',
          note,
          frequency: result.frequency,
          confidence: result.confidence
        });
        activeNote = note;
        pendingNote = null;
        pendingNoteFrames = 0;
      }
    } else {
      // Same note as active - reset pending
      pendingNote = null;
      pendingNoteFrames = 0;
    }
  }

  if (activeNote !== null) {
    detections.push({ time: (samples.length / SAMPLE_RATE) * 1000, type: 'noteOff', note: activeNote });
  }

  const onsets = detections.filter(d => d.type === 'onset');
  return {
    duration: samples.length / SAMPLE_RATE,
    detections,
    onsets,
    noteOffs: detections.filter(d => d.type === 'noteOff'),
    uniqueNotes: [...new Set(onsets.map(d => d.note))],
    onsetCount: onsets.length
  };
}

// ============== Test Runner ==============
function findTestBundles() {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    return [];
  }

  return fs.readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('pitch-test-') && !f.includes('-test-report'))
    .map(f => path.join(FIXTURES_DIR, f));
}

function runTestBundle(jsonPath) {
  const bundle = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const audioPath = path.join(path.dirname(jsonPath), bundle.audioFile);

  if (!fs.existsSync(audioPath)) {
    return {
      status: 'skipped',
      reason: `Audio file not found: ${bundle.audioFile}`,
      bundle
    };
  }

  try {
    const result = processAudioFile(audioPath);
    const errors = [];
    const warnings = [];

    // Compare with expected (from test case or original detection)
    const expectedNotes = bundle.testCase?.expectedNotes || bundle.results?.uniqueNotes || [];
    const originalOnsetCount = bundle.results?.onsetCount || 0;

    // Check onset count
    if (originalOnsetCount > 0) {
      const diff = Math.abs(result.onsetCount - originalOnsetCount);
      if (diff > 0) {
        if (result.onsetCount > originalOnsetCount * 2) {
          errors.push(`Too many onsets: got ${result.onsetCount}, expected ~${originalOnsetCount} (over-triggering)`);
        } else if (result.onsetCount < originalOnsetCount / 2) {
          errors.push(`Too few onsets: got ${result.onsetCount}, expected ~${originalOnsetCount} (under-detecting)`);
        } else {
          warnings.push(`Onset count differs: got ${result.onsetCount}, original was ${originalOnsetCount}`);
        }
      }
    }

    // Check expected notes
    if (expectedNotes.length > 0) {
      const missingNotes = expectedNotes.filter(n => !result.uniqueNotes.includes(n));
      const extraNotes = result.uniqueNotes.filter(n => !expectedNotes.includes(n));

      if (missingNotes.length > 0) {
        errors.push(`Missing expected notes: ${missingNotes.join(', ')}`);
      }
      if (extraNotes.length > 0) {
        warnings.push(`Extra notes detected: ${extraNotes.join(', ')}`);
      }
    }

    // Check for issues flagged in original recording
    if (bundle.issueLog && bundle.issueLog.length > 0) {
      warnings.push(`Original recording had ${bundle.issueLog.length} issues flagged`);
    }

    return {
      status: errors.length === 0 ? (warnings.length === 0 ? 'passed' : 'warning') : 'failed',
      bundle,
      result,
      errors,
      warnings,
      comparison: {
        originalOnsets: originalOnsetCount,
        newOnsets: result.onsetCount,
        expectedNotes,
        detectedNotes: result.uniqueNotes
      }
    };
  } catch (err) {
    return { status: 'error', bundle, error: err.message };
  }
}

function runAllTests() {
  const bundles = findTestBundles();

  if (bundles.length === 0) {
    console.log('\n  No test bundles found in:', FIXTURES_DIR);
    console.log('  Record tests using http://localhost:3001/pitch-test\n');
    return true;
  }

  console.log('\n========================================');
  console.log('  PITCH DETECTION REGRESSION TESTS');
  console.log('========================================\n');

  const results = { passed: 0, warning: 0, failed: 0, skipped: 0, error: 0 };

  for (const jsonPath of bundles) {
    const result = runTestBundle(jsonPath);
    results[result.status]++;

    const icon = {
      passed: '✓',
      warning: '⚠',
      failed: '✗',
      skipped: '○',
      error: '!'
    }[result.status];

    const color = {
      passed: '\x1b[32m',
      warning: '\x1b[33m',
      failed: '\x1b[31m',
      skipped: '\x1b[90m',
      error: '\x1b[31m'
    }[result.status];

    const testName = result.bundle.testCase?.name ||
                     result.bundle.audioFile.replace('.webm', '') ||
                     path.basename(jsonPath);

    console.log(`${color}${icon}\x1b[0m ${testName}`);
    console.log(`   File: ${path.basename(jsonPath)}`);

    if (result.status === 'passed' || result.status === 'warning') {
      console.log(`   Onsets: ${result.comparison.originalOnsets} → ${result.comparison.newOnsets}`);
      console.log(`   Notes: ${result.comparison.detectedNotes.join(', ')}`);
    }

    if (result.errors) {
      result.errors.forEach(e => console.log(`   \x1b[31m→ ${e}\x1b[0m`));
    }
    if (result.warnings) {
      result.warnings.forEach(w => console.log(`   \x1b[33m→ ${w}\x1b[0m`));
    }
    if (result.status === 'skipped') {
      console.log(`   → ${result.reason}`);
    }
    if (result.status === 'error') {
      console.log(`   → ${result.error}`);
    }

    // Show remarks from original recording
    if (result.bundle.remarks && result.bundle.remarks.length > 0) {
      console.log('   Remarks:');
      result.bundle.remarks.forEach(r => {
        console.log(`     ${(r.timeOffset/1000).toFixed(1)}s: "${r.text}"`);
      });
    }

    console.log('');
  }

  console.log('========================================');
  console.log(`  ${results.passed} passed, ${results.warning} warnings, ${results.failed} failed, ${results.skipped} skipped`);
  console.log('========================================\n');

  // Save report
  const reportPath = path.join(FIXTURES_DIR, 'last-run.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: results,
    details: bundles.map(b => runTestBundle(b))
  }, null, 2));

  return results.failed === 0 && results.error === 0;
}

function listTests() {
  const bundles = findTestBundles();

  console.log('\n========================================');
  console.log('  AVAILABLE TEST BUNDLES');
  console.log('========================================\n');

  if (bundles.length === 0) {
    console.log('  No test bundles found.\n');
    console.log('  To create tests:');
    console.log('  1. Go to http://localhost:3001/pitch-test');
    console.log('  2. Select a test case');
    console.log('  3. Click "Record Test"');
    console.log('  4. Play the pattern and click "Stop & Save"');
    console.log('  5. Move files to:', FIXTURES_DIR);
    console.log('');
    return;
  }

  for (const jsonPath of bundles) {
    const bundle = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const audioPath = path.join(path.dirname(jsonPath), bundle.audioFile);
    const hasAudio = fs.existsSync(audioPath);

    console.log(`${hasAudio ? '✓' : '○'} ${path.basename(jsonPath)}`);
    console.log(`   Test: ${bundle.testCase?.name || 'Freeform'}`);
    console.log(`   Date: ${bundle.timestamp}`);
    console.log(`   Duration: ${(bundle.duration/1000).toFixed(1)}s`);
    console.log(`   Notes: ${bundle.results?.uniqueNotes?.join(', ') || 'N/A'}`);
    console.log(`   Onsets: ${bundle.results?.onsetCount || 0}`);
    if (bundle.remarks?.length > 0) {
      console.log(`   Remarks: ${bundle.remarks.length}`);
    }
    console.log('');
  }
}

// ============== Main ==============
const args = process.argv.slice(2);

if (args.includes('--list') || args.includes('-l')) {
  listTests();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Pitch Detection Regression Test Runner

Usage:
  node scripts/run-pitch-tests.js              Run all tests
  node scripts/run-pitch-tests.js --list       List available test bundles
  node scripts/run-pitch-tests.js <file.json>  Run specific test

Test bundles are created from http://localhost:3001/pitch-test
Each bundle contains:
  - .webm audio file
  - .json with metadata, remarks, and original detection results

Place test files in: ${FIXTURES_DIR}
  `);
} else if (args.length > 0 && !args[0].startsWith('-')) {
  // Run specific test
  let testPath = args[0];
  if (!path.isAbsolute(testPath)) {
    testPath = path.join(FIXTURES_DIR, testPath);
  }
  if (!testPath.endsWith('.json')) {
    testPath += '.json';
  }

  if (fs.existsSync(testPath)) {
    const result = runTestBundle(testPath);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Test not found:', testPath);
  }
} else {
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}
