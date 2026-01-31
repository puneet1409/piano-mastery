/**
 * Comprehensive Test: Score Following + Wrong Note Detection
 *
 * Tests the tricky scenarios:
 * 1. Sync correctly, then detect wrong notes
 * 2. Stay locked when user plays wrong (don't re-sync)
 * 3. Go to LOST mode after too many errors
 * 4. Re-sync after getting lost
 * 5. Mixed sequences of correct/wrong
 *
 * Run with: node testScoreFollowerWithValidation.mjs
 */

// ============================================================================
// SCORE FOLLOWER WITH VALIDATION (inline)
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

function getPitchClass(note) {
  return noteToMidi(note) % 12;
}

function notesMatch(note1, note2, allowOctave = true) {
  if (allowOctave) {
    return getPitchClass(note1) === getPitchClass(note2);
  }
  return noteToMidi(note1) === noteToMidi(note2);
}

class ScoreFollowerWithValidation {
  constructor(song, config = {}) {
    this.song = song;
    this.config = {
      bufferSize: 5,
      lockThreshold: 0.7,
      minMatchesForLock: 3,
      maxConsecutiveErrors: 5,
      allowOctaveEquivalence: true,
      ...config
    };
    this.reset();
  }

  reset() {
    this.mode = 'syncing';
    this.currentPosition = -1;
    this.confidence = 0;
    this.consecutiveErrors = 0;
    this.noteBuffer = [];
  }

  processNote(detectedNote) {
    this.noteBuffer.push(detectedNote);
    if (this.noteBuffer.length > this.config.bufferSize) {
      this.noteBuffer.shift();
    }

    switch (this.mode) {
      case 'syncing':
        return this.processSyncing(detectedNote);
      case 'locked':
        return this.processLocked(detectedNote);
      case 'lost':
        return this.processLost(detectedNote);
    }
  }

  processSyncing(detectedNote) {
    const matches = this.findMatchingPositions();

    if (matches.length > 0 && matches[0].score >= this.config.lockThreshold) {
      this.currentPosition = matches[0].position;
      this.confidence = matches[0].score;

      if (this.noteBuffer.length >= this.config.minMatchesForLock) {
        this.mode = 'locked';
        this.consecutiveErrors = 0;

        return {
          detected: detectedNote,
          expected: this.song.notes[this.currentPosition] || '?',
          isCorrect: true,
          position: this.currentPosition,
          mode: 'locked',
          confidence: this.confidence,
          consecutiveErrors: 0,
          message: `Synced! Position ${this.currentPosition}`,
        };
      }
    }

    return {
      detected: detectedNote,
      expected: '?',
      isCorrect: false,
      position: this.currentPosition,
      mode: 'syncing',
      confidence: matches.length > 0 ? matches[0].score : 0,
      consecutiveErrors: 0,
      message: 'Syncing...',
    };
  }

  processLocked(detectedNote) {
    const expectedPosition = this.currentPosition + 1;

    if (expectedPosition >= this.song.notes.length) {
      return {
        detected: detectedNote,
        expected: 'END',
        isCorrect: false,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: this.consecutiveErrors,
        message: 'Song complete!',
      };
    }

    const expectedNote = this.song.notes[expectedPosition];
    const isCorrect = notesMatch(detectedNote, expectedNote, this.config.allowOctaveEquivalence);

    if (isCorrect) {
      this.currentPosition = expectedPosition;
      this.consecutiveErrors = 0;
      this.confidence = Math.min(1, this.confidence + 0.1);

      return {
        detected: detectedNote,
        expected: expectedNote,
        isCorrect: true,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: 0,
        message: `✓ Correct! Position ${this.currentPosition}`,
      };
    } else {
      this.consecutiveErrors++;
      this.confidence = Math.max(0, this.confidence - 0.15);

      if (this.consecutiveErrors >= this.config.maxConsecutiveErrors) {
        this.mode = 'lost';
        return {
          detected: detectedNote,
          expected: expectedNote,
          isCorrect: false,
          position: this.currentPosition,
          mode: 'lost',
          confidence: this.confidence,
          consecutiveErrors: this.consecutiveErrors,
          message: `Lost sync after ${this.consecutiveErrors} errors`,
        };
      }

      return {
        detected: detectedNote,
        expected: expectedNote,
        isCorrect: false,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: this.consecutiveErrors,
        message: `✗ Wrong! Expected ${expectedNote}`,
      };
    }
  }

  processLost(detectedNote) {
    this.noteBuffer = [detectedNote];
    this.consecutiveErrors = 0;
    this.mode = 'syncing';

    return {
      detected: detectedNote,
      expected: '?',
      isCorrect: false,
      position: -1,
      mode: 'syncing',
      confidence: 0,
      consecutiveErrors: 0,
      message: 'Re-syncing...',
    };
  }

  findMatchingPositions() {
    const buffer = this.noteBuffer;
    if (buffer.length === 0) return [];

    const songNotes = this.song.notes;
    const positions = [];

    for (let startPos = 0; startPos <= songNotes.length - buffer.length; startPos++) {
      let matches = 0;
      let totalWeight = 0;

      for (let i = 0; i < buffer.length; i++) {
        const weight = (i + 1) / buffer.length;
        totalWeight += weight;

        if (notesMatch(buffer[i], songNotes[startPos + i], this.config.allowOctaveEquivalence)) {
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

  getExpectedNext() {
    if (this.mode !== 'locked' || this.currentPosition < 0) return null;
    const nextPos = this.currentPosition + 1;
    if (nextPos >= this.song.notes.length) return null;
    return this.song.notes[nextPos];
  }
}

// ============================================================================
// TEST SONGS
// ============================================================================

const SONGS = {
  simple_scale: {
    title: 'C Major Scale',
    notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'],
  },
  fur_elise: {
    title: 'Für Elise',
    notes: [
      'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',
      'C4', 'E4', 'A4', 'B4', 'E4', 'G#4', 'B4', 'C5',
    ],
  },
  twinkle: {
    title: 'Twinkle Twinkle',
    notes: ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'],
  },
};

// ============================================================================
// TEST RUNNER
// ============================================================================

function runTest(testName, song, playedNotes, expectedResults) {
  console.log(`\n${'─'.repeat(75)}`);
  console.log(`TEST: ${testName}`);
  console.log(`${'─'.repeat(75)}`);
  console.log(`Song: ${song.notes.join(' ')}`);
  console.log(`Played: ${playedNotes.join(' ')}`);
  console.log();

  const follower = new ScoreFollowerWithValidation(song);

  console.log('Note'.padEnd(8) + 'Expected'.padEnd(10) + 'Correct?'.padEnd(10) + 'Mode'.padEnd(10) + 'Pos'.padEnd(6) + 'Errors'.padEnd(8) + 'Message');
  console.log('─'.repeat(75));

  let allPassed = true;
  const results = [];

  for (let i = 0; i < playedNotes.length; i++) {
    const note = playedNotes[i];
    const result = follower.processNote(note);
    results.push(result);

    const correctStr = result.isCorrect ? '✓ Yes' : '✗ No';
    const posStr = result.position >= 0 ? result.position.toString() : '-';

    console.log(
      `${note.padEnd(8)}${result.expected.padEnd(10)}${correctStr.padEnd(10)}${result.mode.padEnd(10)}${posStr.padEnd(6)}${result.consecutiveErrors.toString().padEnd(8)}${result.message}`
    );

    // Check against expected if provided
    if (expectedResults && expectedResults[i]) {
      const exp = expectedResults[i];
      if (exp.isCorrect !== undefined && exp.isCorrect !== result.isCorrect) {
        console.log(`   ⚠ FAIL: Expected isCorrect=${exp.isCorrect}`);
        allPassed = false;
      }
      if (exp.mode !== undefined && exp.mode !== result.mode) {
        console.log(`   ⚠ FAIL: Expected mode=${exp.mode}`);
        allPassed = false;
      }
      if (exp.position !== undefined && exp.position !== result.position) {
        console.log(`   ⚠ FAIL: Expected position=${exp.position}`);
        allPassed = false;
      }
    }
  }

  console.log('─'.repeat(75));
  console.log(allPassed ? '✓ TEST PASSED' : '✗ TEST FAILED');

  return { passed: allPassed, results };
}

// ============================================================================
// TEST CASES
// ============================================================================

console.log('='.repeat(80));
console.log('SCORE FOLLOWER + WRONG NOTE DETECTION TESTS');
console.log('='.repeat(80));
console.log();
console.log('Testing the combined system:');
console.log('  - Score following (find position)');
console.log('  - Note validation (right/wrong detection)');
console.log('  - State management (syncing → locked → lost)');
console.log();

let passed = 0;
let total = 0;

// TEST 1: Perfect play - all correct notes
total++;
const test1 = runTest(
  '1. Perfect Play - All Correct Notes',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'],
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true, position: 2 },
    { mode: 'locked', isCorrect: true, position: 3 },
    { mode: 'locked', isCorrect: true, position: 4 },
    { mode: 'locked', isCorrect: true, position: 5 },
    { mode: 'locked', isCorrect: true, position: 6 },
    { mode: 'locked', isCorrect: true, position: 7 },
  ]
);
if (test1.passed) passed++;

// TEST 2: One wrong note - should stay locked
total++;
const test2 = runTest(
  '2. One Wrong Note - Stay Locked, Report Error',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F#4', 'G4', 'A4'],  // F#4 is wrong (should be F4)
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },  // F#4 wrong!
    { mode: 'locked', isCorrect: true },   // G4 correct (position advances after F4)
    { mode: 'locked', isCorrect: true },
  ]
);
if (test2.passed) passed++;

// TEST 3: Multiple wrong notes - count errors
total++;
const test3 = runTest(
  '3. Multiple Wrong Notes - Count Consecutive Errors',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'G4', 'G4', 'G4', 'F4'],  // 3 wrong G4s, then correct F4
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },  // Wrong (expected F4)
    { mode: 'locked', isCorrect: false },  // Still wrong
    { mode: 'locked', isCorrect: false },  // Still wrong
    { mode: 'locked', isCorrect: true },   // Finally correct
  ]
);
if (test3.passed) passed++;

// TEST 4: Too many errors - go LOST
total++;
const test4 = runTest(
  '4. Too Many Errors - Go to LOST Mode',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'X4', 'X4', 'X4', 'X4', 'X4'].map(n => n === 'X4' ? 'A#4' : n),  // 5 wrong notes
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'lost', isCorrect: false },  // 5th error = LOST
  ]
);
if (test4.passed) passed++;

// TEST 5: Start from middle - correct detection
total++;
const test5 = runTest(
  '5. Start From Middle - Correct Sync',
  SONGS.twinkle,
  ['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'],  // Start from position 7
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', position: 9 },
    { mode: 'locked', isCorrect: true, position: 10 },
    { mode: 'locked', isCorrect: true, position: 11 },
    { mode: 'locked', isCorrect: true, position: 12 },
    { mode: 'locked', isCorrect: true, position: 13 },
  ]
);
if (test5.passed) passed++;

// TEST 6: Start from middle, then play wrong
total++;
const test6 = runTest(
  '6. Start From Middle, Then Wrong Notes',
  SONGS.fur_elise,
  ['C4', 'E4', 'A4', 'B4', 'F4', 'G#4'],  // Start at pos 9, then F4 is wrong (expected E4)
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },  // F4 wrong (expected E4)
    { mode: 'locked', isCorrect: true },   // G#4 correct
  ]
);
if (test6.passed) passed++;

// TEST 7: Octave equivalence - C4 = C5
total++;
const test7 = runTest(
  '7. Octave Equivalence - C4 matches C5',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C4'],  // C4 instead of C5 at end
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: true },  // C4 matches C5 due to octave equivalence
  ]
);
if (test7.passed) passed++;

// TEST 8: Recovery after LOST
total++;
const test8 = runTest(
  '8. Recovery After Getting LOST',
  { title: 'Recovery Test', notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'] },
  [
    'C4', 'D4', 'E4',  // Sync
    'X4', 'X4', 'X4', 'X4', 'X4',  // 5 wrong = LOST
    'F5', 'G5',  // Re-sync from end
  ].map(n => n === 'X4' ? 'A#4' : n),
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked' },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'locked', isCorrect: false },
    { mode: 'lost' },  // Lost!
    { mode: 'syncing' },  // Re-syncing
    { mode: 'syncing' },  // Still syncing (need more notes)
  ]
);
if (test8.passed) passed++;

// TEST 9: Mixed correct and wrong
total++;
const test9 = runTest(
  '9. Mixed Correct and Wrong Notes',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F#4', 'F4', 'G4', 'A#4', 'A4', 'B4'],
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },  // F#4 wrong
    { mode: 'locked', isCorrect: true },   // F4 correct
    { mode: 'locked', isCorrect: true },   // G4 correct
    { mode: 'locked', isCorrect: false },  // A#4 wrong
    { mode: 'locked', isCorrect: true },   // A4 correct
    { mode: 'locked', isCorrect: true },   // B4 correct
  ]
);
if (test9.passed) passed++;

// TEST 10: Real scenario - Für Elise with mistakes
total++;
const test10 = runTest(
  '10. Für Elise With Realistic Mistakes',
  SONGS.fur_elise,
  ['E5', 'D#5', 'E5', 'D5', 'E5', 'B4', 'D5', 'C5'],  // D5 instead of D#5
  [
    { mode: 'syncing' },
    { mode: 'syncing' },
    { mode: 'locked', isCorrect: true },
    { mode: 'locked', isCorrect: false },  // D5 wrong (expected D#5)
    { mode: 'locked', isCorrect: true },   // E5 correct
    { mode: 'locked', isCorrect: true },   // B4 correct
    { mode: 'locked', isCorrect: true },   // D5 correct
    { mode: 'locked', isCorrect: true },   // C5 correct
  ]
);
if (test10.passed) passed++;

// ============================================================================
// SUMMARY
// ============================================================================

console.log();
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log(`Tests passed: ${passed}/${total} (${(passed/total*100).toFixed(0)}%)`);
console.log();

if (passed === total) {
  console.log('✓ ALL TESTS PASSED');
  console.log();
  console.log('The combined system correctly:');
  console.log('  ✓ Syncs to song position from any starting point');
  console.log('  ✓ Detects wrong notes and reports them');
  console.log('  ✓ Stays locked when wrong notes are played (doesn\'t re-sync)');
  console.log('  ✓ Goes to LOST mode after too many consecutive errors');
  console.log('  ✓ Re-syncs after getting lost');
  console.log('  ✓ Handles octave equivalence (C4 = C5)');
  console.log('  ✓ Counts consecutive errors correctly');
} else {
  console.log('✗ SOME TESTS FAILED - Review above');
}
console.log();
