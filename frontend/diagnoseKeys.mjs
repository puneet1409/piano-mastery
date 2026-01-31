/**
 * Diagnose actual keys of low-scoring songs
 * Compare detected notes to common musical keys
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Common musical keys and their notes
const KEYS = {
  // Major keys
  'C major': ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
  'G major': ['G', 'A', 'B', 'C', 'D', 'E', 'F#'],
  'D major': ['D', 'E', 'F#', 'G', 'A', 'B', 'C#'],
  'A major': ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#'],
  'E major': ['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#'],
  'B major': ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#'],
  'F major': ['F', 'G', 'A', 'Bb', 'C', 'D', 'E'],
  'Bb major': ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
  'Eb major': ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
  'Ab major': ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
  'Db major': ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'],
  // Minor keys (natural minor)
  'A minor': ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
  'E minor': ['E', 'F#', 'G', 'A', 'B', 'C', 'D'],
  'B minor': ['B', 'C#', 'D', 'E', 'F#', 'G', 'A'],
  'F# minor': ['F#', 'G#', 'A', 'B', 'C#', 'D', 'E'],
  'C# minor': ['C#', 'D#', 'E', 'F#', 'G#', 'A', 'B'],
  'G# minor': ['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F#'],
  'D minor': ['D', 'E', 'F', 'G', 'A', 'Bb', 'C'],
  'G minor': ['G', 'A', 'Bb', 'C', 'D', 'Eb', 'F'],
  'C minor': ['C', 'D', 'Eb', 'F', 'G', 'Ab', 'Bb'],
  'F minor': ['F', 'G', 'Ab', 'Bb', 'C', 'Db', 'Eb'],
};

// Enharmonic equivalents
const ENHARMONIC = {
  'C#': 'Db', 'Db': 'C#',
  'D#': 'Eb', 'Eb': 'D#',
  'F#': 'Gb', 'Gb': 'F#',
  'G#': 'Ab', 'Ab': 'G#',
  'A#': 'Bb', 'Bb': 'A#',
};

function normalizeNote(note) {
  return note;
}

function notesMatch(note1, note2) {
  if (note1 === note2) return true;
  if (ENHARMONIC[note1] === note2) return true;
  if (ENHARMONIC[note2] === note1) return true;
  return false;
}

function scoreKeyMatch(detectedNotes, keyNotes) {
  let matches = 0;
  for (const detected of detectedNotes) {
    for (const keyNote of keyNotes) {
      if (notesMatch(detected, keyNote)) {
        matches++;
        break;
      }
    }
  }
  return matches;
}

function findBestKeys(detectedNotes, topN = 5) {
  const scores = [];

  for (const [keyName, keyNotes] of Object.entries(KEYS)) {
    const score = scoreKeyMatch(detectedNotes, keyNotes);
    const percentage = (score / detectedNotes.length) * 100;
    scores.push({ keyName, score, total: detectedNotes.length, percentage });
  }

  scores.sort((a, b) => b.percentage - a.percentage);
  return scores.slice(0, topN);
}

function suggestExpectedNotes(keyName) {
  const keyNotes = KEYS[keyName];
  if (!keyNotes) return [];

  // Return tonic, dominant, subdominant, mediant, and other important notes
  // For major: I, V, IV, iii, vi (1st, 5th, 4th, 3rd, 6th)
  // For minor: i, v, iv, III, VII (1st, 5th, 4th, 3rd, 7th)
  return [keyNotes[0], keyNotes[4], keyNotes[3], keyNotes[2], keyNotes[5]];
}

// Songs to investigate - current failing songs from testV3.mjs
const lowScoringSongs = [
  {
    name: 'Tujhe Dekha To',
    file: 'tujhe_dekha_to.wav',
    currentExpected: ['Eb', 'Bb', 'Ab', 'G', 'C'],
    detected: ['D', 'G', 'E', 'D#', 'B', 'A', 'F', 'C']  // From test output
  },
  {
    name: 'Kaise Hua',
    file: 'kaise_hua.wav',
    currentExpected: ['G', 'D', 'C', 'B', 'E'],
    detected: ['F#', 'B', 'G', 'E']  // From test output - only 4 notes detected!
  },
];

console.log('='.repeat(80));
console.log('KEY ANALYSIS FOR LOW-SCORING SONGS');
console.log('='.repeat(80));

for (const song of lowScoringSongs) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`SONG: ${song.name}`);
  console.log(`${'─'.repeat(80)}`);

  console.log(`\nCurrent Expected Notes: ${song.currentExpected.join(', ')}`);
  console.log(`Actually Detected:      ${song.detected.join(', ')}`);

  // Find best matching keys for detected notes
  const bestKeys = findBestKeys(song.detected);

  console.log(`\nBest Matching Keys for Detected Notes:`);
  for (const match of bestKeys) {
    const keyNotes = KEYS[match.keyName].join(', ');
    console.log(`  ${match.keyName.padEnd(15)} ${match.score}/${match.total} (${match.percentage.toFixed(0)}%) - [${keyNotes}]`);
  }

  // Suggest new expected notes based on best key
  const bestKey = bestKeys[0];
  const suggestedNotes = suggestExpectedNotes(bestKey.keyName);

  console.log(`\nSUGGESTED FIX:`);
  console.log(`  Recording appears to be in: ${bestKey.keyName}`);
  console.log(`  Suggested expected notes:   ${suggestedNotes.join(', ')}`);

  // Check how many of suggested notes are in detected
  const suggestedMatch = scoreKeyMatch(suggestedNotes, song.detected);
  console.log(`  Would match: ${suggestedMatch}/5 (${(suggestedMatch/5*100).toFixed(0)}%)`);
}

console.log(`\n${'='.repeat(80)}`);
console.log('RECOMMENDED EXPECTED NOTES UPDATE');
console.log('='.repeat(80));

for (const song of lowScoringSongs) {
  const bestKeys = findBestKeys(song.detected);
  const bestKey = bestKeys[0];
  const suggestedNotes = suggestExpectedNotes(bestKey.keyName);

  console.log(`\n${song.name}:`);
  console.log(`  OLD: expected: ['${song.currentExpected.join("', '")}']`);
  console.log(`  NEW: expected: ['${suggestedNotes.join("', '")}']  // ${bestKey.keyName}`);
}
