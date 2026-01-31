/**
 * Auto-Sync with Real Audio Test
 *
 * Complete integration test:
 * 1. Generate audio for a segment of a song (any starting position)
 * 2. Run pitch detection on the audio
 * 3. Score follower syncs to the correct position
 * 4. Verify we found the right place in the song
 *
 * Run with: node testAutoSyncWithAudio.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// UTILITIES
// ============================================================================

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToMidi(note) {
  const match = note.match(/^([A-G][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const noteMap = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
  };
  const [, noteName, octStr] = match;
  return (parseInt(octStr) + 1) * 12 + (noteMap[noteName] ?? 0);
}

function midiToNote(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${NOTE_NAMES[noteIndex]}${octave}`;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function frequencyToMidi(freq) {
  return Math.round(12 * Math.log2(freq / 440) + 69);
}

function getPitchClass(note) {
  return noteToMidi(note) % 12;
}

function pitchClassesMatch(note1, note2) {
  return getPitchClass(note1) === getPitchClass(note2);
}

// ============================================================================
// AUDIO GENERATION
// ============================================================================

function generatePianoTone(midi, durationSec, sampleRate = 44100) {
  const frequency = midiToFreq(midi);
  const numSamples = Math.floor(sampleRate * durationSec);
  const samples = new Float32Array(numSamples);

  const harmonics = [1.0, 0.5, 0.33, 0.25, 0.15];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let value = 0;

    for (let h = 0; h < harmonics.length; h++) {
      value += harmonics[h] * Math.sin(2 * Math.PI * frequency * (h + 1) * t);
    }

    // Envelope
    const attackTime = 0.02;
    let envelope = 1;
    if (t < attackTime) {
      envelope = t / attackTime;
    } else {
      envelope = Math.exp(-2 * (t - attackTime));
    }

    samples[i] = value * envelope * 0.5;
  }

  return samples;
}

function generateNoteSequence(notes, noteDuration = 0.3, sampleRate = 44100) {
  const samplesPerNote = Math.floor(sampleRate * noteDuration);
  const totalSamples = samplesPerNote * notes.length;
  const audio = new Float32Array(totalSamples);

  for (let i = 0; i < notes.length; i++) {
    const midi = noteToMidi(notes[i]);
    const tone = generatePianoTone(midi, noteDuration, sampleRate);

    const offset = i * samplesPerNote;
    for (let j = 0; j < tone.length && offset + j < totalSamples; j++) {
      audio[offset + j] = tone[j];
    }
  }

  return audio;
}

// ============================================================================
// YIN PITCH DETECTOR
// ============================================================================

function detectPitch(samples, sampleRate = 44100) {
  if (!samples || samples.length < 1024) return null;

  let rmsSum = 0;
  for (let i = 0; i < samples.length; i++) {
    rmsSum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(rmsSum / samples.length);

  if (rms < 0.005) return null;

  const bufferSize = samples.length;
  const tauMax = Math.min(Math.floor(bufferSize / 2), Math.floor(sampleRate / 50));

  const difference = new Float32Array(tauMax);
  for (let tau = 0; tau < tauMax; tau++) {
    let sum = 0;
    const len = bufferSize - tauMax;
    for (let i = 0; i < len; i++) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let cumulativeSum = 0;

  for (let tau = 1; tau < tauMax; tau++) {
    cumulativeSum += difference[tau];
    if (cumulativeSum > 0) {
      cmnd[tau] = (difference[tau] * tau) / cumulativeSum;
    } else {
      cmnd[tau] = 1;
    }
  }

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

  if (bestTau === null) return null;

  let refinedTau = bestTau;
  if (bestTau > 0 && bestTau < tauMax - 1) {
    const alpha = cmnd[bestTau - 1];
    const beta = cmnd[bestTau];
    const gamma = cmnd[bestTau + 1];
    const denominator = 2 * (2 * beta - alpha - gamma);
    if (Math.abs(denominator) > 1e-10) {
      refinedTau = bestTau + (alpha - gamma) / denominator;
    }
  }

  const frequency = sampleRate / refinedTau;
  const midi = frequencyToMidi(frequency);

  return {
    frequency,
    midi,
    note: midiToNote(midi),
    confidence: 1 - cmndMin,
  };
}

// ============================================================================
// SCORE FOLLOWER
// ============================================================================

class ScoreFollower {
  constructor(song, config = {}) {
    this.song = song;
    this.config = {
      bufferSize: 5,
      lockThreshold: 0.6,
      minMatchesForLock: 3,
      ...config
    };
    this.reset();
  }

  reset() {
    this.state = {
      currentPosition: -1,
      confidence: 0,
      isLocked: false,
      detectedNotes: [],
      possiblePositions: [],
    };
  }

  processNote(detectedNote) {
    this.state.detectedNotes.push(detectedNote);
    if (this.state.detectedNotes.length > this.config.bufferSize) {
      this.state.detectedNotes.shift();
    }

    this.state.possiblePositions = this.findMatchingPositions();
    this.updatePosition();

    return { ...this.state };
  }

  findMatchingPositions() {
    const buffer = this.state.detectedNotes;
    if (buffer.length === 0) return [];

    const songNotes = this.song.notes;
    const positions = [];

    for (let startPos = 0; startPos <= songNotes.length - buffer.length; startPos++) {
      let matches = 0;
      let totalWeight = 0;

      for (let i = 0; i < buffer.length; i++) {
        const weight = (i + 1) / buffer.length;
        totalWeight += weight;

        if (pitchClassesMatch(buffer[i], songNotes[startPos + i])) {
          matches += weight;
        }
      }

      const score = totalWeight > 0 ? matches / totalWeight : 0;

      if (score > 0.4) {
        positions.push({
          position: startPos + buffer.length - 1,
          score,
        });
      }
    }

    positions.sort((a, b) => b.score - a.score);
    return positions.slice(0, 5);
  }

  updatePosition() {
    const candidates = this.state.possiblePositions;

    if (candidates.length === 0) {
      this.state.confidence *= 0.7;
      if (this.state.confidence < 0.3) {
        this.state.isLocked = false;
      }
      return;
    }

    const best = candidates[0];

    // If locked, prefer nearby positions
    if (this.state.isLocked && this.state.currentPosition >= 0) {
      const nearby = candidates.find(c =>
        Math.abs(c.position - this.state.currentPosition) <= 2 && c.score > 0.5
      );

      if (nearby) {
        this.state.currentPosition = nearby.position;
        this.state.confidence = nearby.score;
        return;
      }
    }

    this.state.currentPosition = best.position;
    this.state.confidence = best.score;

    if (this.state.detectedNotes.length >= this.config.minMatchesForLock &&
        this.state.confidence >= this.config.lockThreshold) {
      this.state.isLocked = true;
    }
  }

  getExpectedNote() {
    if (this.state.currentPosition < 0) return null;
    const nextIndex = this.state.currentPosition + 1;
    if (nextIndex >= this.song.notes.length) return null;
    return this.song.notes[nextIndex];
  }
}

// ============================================================================
// TEST SONGS
// ============================================================================

const SONGS = {
  fur_elise: {
    title: 'Für Elise',
    notes: [
      'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',
      'C4', 'E4', 'A4', 'B4', 'E4', 'G#4', 'B4', 'C5',
      'E4', 'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',
    ],
  },
  twinkle: {
    title: 'Twinkle Twinkle',
    notes: [
      'C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4',
      'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4',
      'G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4',
    ],
  },
  happy_birthday: {
    title: 'Happy Birthday',
    notes: [
      'C4', 'C4', 'D4', 'C4', 'F4', 'E4',
      'C4', 'C4', 'D4', 'C4', 'G4', 'F4',
      'C4', 'C4', 'C5', 'A4', 'F4', 'E4', 'D4',
    ],
  },
};

// ============================================================================
// AUTO-SYNC TEST
// ============================================================================

function testAutoSync(songKey, startPosition, numNotes = 7) {
  const song = SONGS[songKey];
  const sampleRate = 44100;
  const noteDuration = 0.25; // seconds per note

  // Get the notes to play (starting from given position)
  const notesToPlay = song.notes.slice(startPosition, startPosition + numNotes);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📁 ${song.title} | Starting from position ${startPosition}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`Full song: ${song.notes.join(' ')}`);
  console.log(`Playing:   ${' '.repeat(startPosition * 4)}${notesToPlay.join(' ')}`);
  console.log();

  // Generate audio for these notes
  const audio = generateNoteSequence(notesToPlay, noteDuration, sampleRate);

  // Initialize score follower
  const follower = new ScoreFollower(song);

  // Process each note's audio segment
  const windowSize = Math.floor(sampleRate * noteDuration * 0.8); // 80% of note duration
  const samplesPerNote = Math.floor(sampleRate * noteDuration);

  console.log('Detected   Expected   Position   Conf   Locked   Status');
  console.log('─'.repeat(65));

  let lockedAtNote = -1;
  let finalPosition = -1;

  for (let i = 0; i < notesToPlay.length; i++) {
    const expectedNote = notesToPlay[i];
    const actualPosition = startPosition + i;

    // Extract audio for this note (from middle of note for stable detection)
    const noteStart = i * samplesPerNote + Math.floor(samplesPerNote * 0.1);
    const noteEnd = Math.min(noteStart + windowSize, audio.length);
    const noteAudio = audio.slice(noteStart, noteEnd);

    // Detect pitch
    const detection = detectPitch(noteAudio, sampleRate);
    const detectedNote = detection ? detection.note : '?';

    // Process in score follower
    const state = follower.processNote(detectedNote);

    const posStr = state.currentPosition >= 0 ? state.currentPosition.toString() : '?';
    const confStr = (state.confidence * 100).toFixed(0) + '%';
    const lockedStr = state.isLocked ? '✓ YES' : 'no';

    // Check accuracy
    const positionCorrect = Math.abs(state.currentPosition - actualPosition) <= 1;
    const noteCorrect = pitchClassesMatch(detectedNote, expectedNote);

    let status = '';
    if (!noteCorrect) {
      status = `⚠ Detection error`;
    } else if (state.isLocked && positionCorrect) {
      status = '✓ Synced correctly!';
      if (lockedAtNote < 0) lockedAtNote = i;
    } else if (state.isLocked) {
      status = `⚠ Wrong position (actual: ${actualPosition})`;
    } else {
      status = '⏳ Syncing...';
    }

    if (state.isLocked) {
      finalPosition = state.currentPosition;
    }

    console.log(
      `${detectedNote.padEnd(11)}${expectedNote.padEnd(11)}${posStr.padEnd(11)}${confStr.padEnd(7)}${lockedStr.padEnd(9)}${status}`
    );
  }

  console.log('─'.repeat(65));

  const expectedFinalPos = startPosition + numNotes - 1;
  const success = Math.abs(finalPosition - expectedFinalPos) <= 1;

  if (success) {
    console.log(`✓ SUCCESS: Synced to position ${finalPosition} (expected: ${expectedFinalPos})`);
    console.log(`  Locked after ${lockedAtNote + 1} notes`);
  } else {
    console.log(`✗ FAILED: Position ${finalPosition} (expected: ${expectedFinalPos})`);
  }

  return { success, lockedAtNote, finalPosition, expectedFinalPos };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('AUTO-SYNC WITH AUDIO DETECTION TEST');
console.log('='.repeat(80));
console.log();
console.log('This test demonstrates the complete flow:');
console.log('  1. Generate audio for notes (simulating user playing)');
console.log('  2. Run pitch detection on audio');
console.log('  3. Score follower syncs to song position');
console.log('  4. Verify correct position found');
console.log();

const tests = [
  { song: 'fur_elise', start: 0, notes: 7, desc: 'Start from beginning' },
  { song: 'fur_elise', start: 9, notes: 7, desc: 'Start from middle' },
  { song: 'fur_elise', start: 17, notes: 7, desc: 'Start near end' },
  { song: 'twinkle', start: 0, notes: 6, desc: 'Twinkle - beginning' },
  { song: 'twinkle', start: 7, notes: 6, desc: 'Twinkle - verse 2' },
  { song: 'happy_birthday', start: 6, notes: 6, desc: 'Happy Birthday - line 2' },
  { song: 'happy_birthday', start: 12, notes: 7, desc: 'Happy Birthday - "dear..."' },
];

let passed = 0;
let total = tests.length;

for (const test of tests) {
  const result = testAutoSync(test.song, test.start, test.notes);
  if (result.success) passed++;
}

console.log();
console.log('='.repeat(80));
console.log('FINAL RESULTS');
console.log('='.repeat(80));
console.log();
console.log(`Tests passed: ${passed}/${total} (${(passed/total*100).toFixed(0)}%)`);
console.log();

if (passed === total) {
  console.log('✓ ALL TESTS PASSED');
  console.log();
  console.log('The auto-sync system successfully:');
  console.log('  • Detects notes from audio');
  console.log('  • Finds correct position in song (from any starting point)');
  console.log('  • Syncs within 3-5 notes');
  console.log('  • Works across different songs');
} else {
  console.log('Some tests failed - review results above');
}

console.log();
console.log('Next steps for production:');
console.log('  1. Integrate with real microphone input');
console.log('  2. Add UI showing sync status and current position');
console.log('  3. Auto-scroll sheet music to detected position');
console.log('  4. Handle tempo variations (dynamic time warping)');
console.log();
