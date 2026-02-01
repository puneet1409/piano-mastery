/**
 * Test pitch detection on recorded audio files
 * Usage: node scripts/test-audio-file.js <path-to-audio-file>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// YIN algorithm (same as yinProcessor.js)
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

  // Step 2: CMND
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum > 0 ? diff[tau] / (runningSum / tau) : 1.0;
  }

  // Step 3: First-minimum search
  const threshold = 0.20;
  let bestTau = null;
  let cmndMin = 1.0;

  for (let tau = 2; tau < tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < tauMax && cmnd[tau + 1] < cmnd[tau]) {
        tau++;
      }
      bestTau = tau;
      cmndMin = cmnd[tau];
      break;
    }
  }

  // Fallback: global minimum
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

  const frequency = sampleRate / refinedTau;

  // Reject below 60Hz (allow low notes for testing)
  if (frequency < 60 || frequency > 5000) return null;

  const confidence = 1.0 - cmndMin;
  return { frequency, confidence, cmndMin };
}

// Convert frequency to note name
function frequencyToNote(freq) {
  const midiNote = 69 + 12 * Math.log2(freq / 440);
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midiNote);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return noteNames[noteIndex] + octave;
}

// Calculate RMS
function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

// Main processing
async function processAudioFile(filePath) {
  console.log(`\n=== Processing: ${path.basename(filePath)} ===\n`);

  // Use ffmpeg to convert to raw PCM
  const tempFile = path.join(process.env.TEMP || '/tmp', 'audio_test.raw');

  try {
    execSync(`ffmpeg -y -i "${filePath}" -f f32le -acodec pcm_f32le -ac 1 -ar 44100 "${tempFile}"`, {
      stdio: 'pipe'
    });
  } catch (err) {
    console.error('Error: ffmpeg failed. Make sure ffmpeg is installed.');
    console.error(err.message);
    return;
  }

  // Read raw PCM data
  const buffer = fs.readFileSync(tempFile);
  const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);

  console.log(`Audio duration: ${(samples.length / 44100).toFixed(2)}s`);
  console.log(`Total samples: ${samples.length}\n`);

  // Process in windows
  const SAMPLE_RATE = 44100;
  const WINDOW_SIZE = 3072;  // ~70ms
  const HOP_SIZE = 512;      // ~12ms

  const detections = [];
  let activeNote = null;
  let silenceFrames = 0;
  let prevRms = 0;
  const SILENCE_THRESHOLD = 0.003;
  const SILENCE_FRAMES_FOR_OFF = 3;
  const CONFIDENCE_THRESHOLD = 0.65;
  const ONSET_RMS_RATIO = 1.5; // Need 50% RMS increase to re-trigger same note

  let onsetCount = 0;
  let frameCount = 0;
  let noteOffCount = 0;

  for (let i = 0; i + WINDOW_SIZE < samples.length; i += HOP_SIZE) {
    const window = samples.slice(i, i + WINDOW_SIZE);
    const timeMs = (i / SAMPLE_RATE) * 1000;
    const rms = calculateRms(window);

    // Silence detection
    if (rms < SILENCE_THRESHOLD) {
      silenceFrames++;
      if (silenceFrames >= SILENCE_FRAMES_FOR_OFF && activeNote !== null) {
        detections.push({ time: timeMs, type: 'noteOff', note: activeNote });
        noteOffCount++;
        activeNote = null;
      }
      prevRms = rms;
      continue;
    }

    // Check for onset (RMS spike) - allows re-triggering same note
    const isOnset = prevRms > 0.001 && rms > prevRms * ONSET_RMS_RATIO;
    if (isOnset && activeNote !== null) {
      // Strong onset while same note active = new keypress, reset
      activeNote = null;
    }

    silenceFrames = 0;
    prevRms = rms;

    // Pitch detection
    const result = yinDetect(window, SAMPLE_RATE);
    if (!result || result.confidence < CONFIDENCE_THRESHOLD) continue;

    const note = frequencyToNote(result.frequency);

    // New note detection (onset) - only if different from active OR no active note
    if (activeNote === null || activeNote !== note) {
      if (activeNote !== null && activeNote !== note) {
        // Different note = implicit note-off for previous
        detections.push({ time: timeMs, type: 'noteOff', note: activeNote });
        noteOffCount++;
      }
      detections.push({
        time: timeMs,
        type: 'onset',
        note,
        frequency: result.frequency,
        confidence: result.confidence
      });
      onsetCount++;
      activeNote = note;
    } else {
      // Same note continuing = frame (no new onset)
      frameCount++;
    }
  }

  // Final note-off if still active
  if (activeNote !== null) {
    detections.push({ time: (samples.length / SAMPLE_RATE) * 1000, type: 'noteOff', note: activeNote });
    noteOffCount++;
  }

  // Clean up temp file
  fs.unlinkSync(tempFile);

  // Report results
  console.log('=== SUMMARY ===');
  console.log(`Onsets (new notes): ${onsetCount}`);
  console.log(`Frames (sustain): ${frameCount}`);
  console.log(`Note-offs: ${noteOffCount}`);

  const uniqueNotes = [...new Set(detections.filter(d => d.type === 'onset').map(d => d.note))];
  console.log(`Unique notes: ${uniqueNotes.join(', ')}`);

  console.log('\n=== DETECTION LOG ===');
  const onsetEvents = detections.filter(d => d.type === 'onset' || d.type === 'noteOff');
  for (const d of onsetEvents.slice(0, 50)) { // Show first 50
    if (d.type === 'onset') {
      console.log(`${(d.time/1000).toFixed(3)}s [ONSET] ${d.note} (${d.frequency.toFixed(1)}Hz, ${(d.confidence*100).toFixed(0)}%)`);
    } else {
      console.log(`${(d.time/1000).toFixed(3)}s [OFF]   ${d.note}`);
    }
  }
  if (onsetEvents.length > 50) {
    console.log(`... and ${onsetEvents.length - 50} more events`);
  }

  return { onsetCount, frameCount, noteOffCount, uniqueNotes, detections };
}

// Run
const audioFile = process.argv[2];
if (!audioFile) {
  // Default to testing the recording in Downloads
  const defaultFile = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads', 'pitch-test-1769918028340.json');
  console.log('Usage: node scripts/test-audio-file.js <audio-file>');
  console.log('\nNo file specified. Looking for test recordings...');

  const downloadsDir = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');
  const webmFiles = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.webm'));

  if (webmFiles.length > 0) {
    console.log(`\nFound ${webmFiles.length} .webm files in Downloads:`);
    webmFiles.forEach(f => console.log(`  - ${f}`));
    console.log(`\nTesting: ${webmFiles[0]}`);
    processAudioFile(path.join(downloadsDir, webmFiles[0]));
  } else {
    console.log('No .webm files found in Downloads folder.');
  }
} else {
  processAudioFile(audioFile);
}
