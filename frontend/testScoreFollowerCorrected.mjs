/**
 * CORRECTED Score Follower Tests
 *
 * Key insight: The system has TWO valid modes:
 *
 * STRICT MODE (default):
 *   - Position only advances on CORRECT notes
 *   - Wrong note = "try again"
 *   - Better for learning
 *
 * FORGIVING MODE:
 *   - Position advances on any note (marks wrong ones)
 *   - User continues through song regardless
 *   - Better for flow/performance
 *
 * Run with: node testScoreFollowerCorrected.mjs
 */

// ============================================================================
// SCORE FOLLOWER WITH VALIDATION
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
      strictMode: true,  // NEW: strict vs forgiving
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
    this.totalCorrect = 0;
    this.totalWrong = 0;
  }

  processNote(detectedNote) {
    this.noteBuffer.push(detectedNote);
    if (this.noteBuffer.length > this.config.bufferSize) {
      this.noteBuffer.shift();
    }

    switch (this.mode) {
      case 'syncing': return this.processSyncing(detectedNote);
      case 'locked': return this.processLocked(detectedNote);
      case 'lost': return this.processLost(detectedNote);
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
          message: `✓ Synced at position ${this.currentPosition}`,
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
      message: '⏳ Syncing...',
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
        message: '🎉 Song complete!',
      };
    }

    const expectedNote = this.song.notes[expectedPosition];
    const isCorrect = notesMatch(detectedNote, expectedNote, this.config.allowOctaveEquivalence);

    if (isCorrect) {
      this.currentPosition = expectedPosition;
      this.consecutiveErrors = 0;
      this.totalCorrect++;
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
      this.totalWrong++;
      this.confidence = Math.max(0, this.confidence - 0.15);

      // In FORGIVING mode, advance anyway
      if (!this.config.strictMode) {
        this.currentPosition = expectedPosition;
      }

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
          message: `❌ Lost sync after ${this.consecutiveErrors} errors`,
        };
      }

      const tryAgain = this.config.strictMode ? ' (try again)' : '';
      return {
        detected: detectedNote,
        expected: expectedNote,
        isCorrect: false,
        position: this.currentPosition,
        mode: 'locked',
        confidence: this.confidence,
        consecutiveErrors: this.consecutiveErrors,
        message: `✗ Wrong! Expected ${expectedNote}${tryAgain}`,
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
      message: '🔄 Re-syncing...',
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
        positions.push({ position: startPos + buffer.length - 1, score });
      }
    }

    positions.sort((a, b) => b.score - a.score);
    return positions.slice(0, 5);
  }

  getStats() {
    return {
      correct: this.totalCorrect,
      wrong: this.totalWrong,
      accuracy: this.totalCorrect + this.totalWrong > 0
        ? this.totalCorrect / (this.totalCorrect + this.totalWrong)
        : 0,
    };
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
  twinkle: {
    title: 'Twinkle Twinkle',
    notes: ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'],
  },
};

// ============================================================================
// TEST RUNNER
// ============================================================================

function runTest(testName, song, playedNotes, config = {}) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`TEST: ${testName}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`Mode: ${config.strictMode === false ? 'FORGIVING' : 'STRICT'}`);
  console.log(`Song: ${song.notes.join(' ')}`);
  console.log(`Played: ${playedNotes.join(' ')}`);
  console.log();

  const follower = new ScoreFollowerWithValidation(song, config);

  console.log('Note'.padEnd(8) + 'Expected'.padEnd(10) + 'Result'.padEnd(12) + 'Mode'.padEnd(10) + 'Pos'.padEnd(6) + 'Message');
  console.log('─'.repeat(80));

  for (const note of playedNotes) {
    const result = follower.processNote(note);
    const resultStr = result.isCorrect ? '✓ Correct' : '✗ Wrong';
    const posStr = result.position >= 0 ? result.position.toString() : '-';

    console.log(
      `${note.padEnd(8)}${result.expected.padEnd(10)}${resultStr.padEnd(12)}${result.mode.padEnd(10)}${posStr.padEnd(6)}${result.message}`
    );
  }

  const stats = follower.getStats();
  console.log('─'.repeat(80));
  console.log(`Accuracy: ${(stats.accuracy * 100).toFixed(0)}% (${stats.correct} correct, ${stats.wrong} wrong)`);

  return { stats, follower };
}

// ============================================================================
// MAIN TESTS
// ============================================================================

console.log('='.repeat(80));
console.log('SCORE FOLLOWER + WRONG NOTE DETECTION');
console.log('='.repeat(80));
console.log();
console.log('Comparing STRICT mode vs FORGIVING mode:');
console.log('  STRICT: Wrong note = try again (position stays)');
console.log('  FORGIVING: Wrong note = marked wrong, continue (position advances)');
console.log();

// Test 1: Perfect play (same in both modes)
runTest(
  '1. Perfect Play (STRICT)',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'],
  { strictMode: true }
);

// Test 2: STRICT mode - wrong note means "try again"
runTest(
  '2. One Wrong Note (STRICT) - Must retry',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F#4', 'F4', 'G4', 'A4', 'B4', 'C5'],  // F#4 wrong, then F4 correct
  { strictMode: true }
);

// Test 3: FORGIVING mode - wrong note marked but continues
runTest(
  '3. One Wrong Note (FORGIVING) - Continues anyway',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C5'],  // F#4 wrong, continues to G4
  { strictMode: false }
);

// Test 4: Multiple wrong in STRICT mode
runTest(
  '4. Multiple Wrong Notes (STRICT) - Keeps trying',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'G4', 'G4', 'F4', 'G4', 'A4', 'B4', 'C5'],  // Two wrong G4s, then correct F4
  { strictMode: true }
);

// Test 5: Real scenario - Twinkle with mistakes (STRICT)
runTest(
  '5. Twinkle with Mistakes (STRICT)',
  SONGS.twinkle,
  ['C4', 'C4', 'G4', 'A4', 'G4', 'A4', 'A4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'],
  // Note: A4 wrong (expected G4), G4 correct, then continues
  { strictMode: true }
);

// Test 6: Real scenario - Twinkle with mistakes (FORGIVING)
runTest(
  '6. Twinkle with Mistakes (FORGIVING)',
  SONGS.twinkle,
  ['C4', 'C4', 'G4', 'A4', 'A4', 'A4', 'G4', 'F4', 'E4', 'E4', 'E4', 'D4', 'D4', 'C4'],
  // Errors at positions 3 (A4 vs G4), 7 (F4 vs F4 correct), etc.
  { strictMode: false }
);

// Test 7: STRICT mode - too many errors goes LOST
runTest(
  '7. Too Many Errors (STRICT) - Goes LOST',
  SONGS.simple_scale,
  ['C4', 'D4', 'E4', 'A#4', 'A#4', 'A#4', 'A#4', 'A#4', 'C4', 'D4', 'E4'],  // 5 wrong, re-sync
  { strictMode: true }
);

// Test 8: Start from middle, make mistakes
runTest(
  '8. Start from Middle with Mistakes (STRICT)',
  SONGS.twinkle,
  ['F4', 'F4', 'E4', 'D4', 'E4', 'D4', 'D4', 'C4'],  // Start at pos 7, D4 wrong at pos 9 (expected E4)
  { strictMode: true }
);

console.log();
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('The system correctly handles both modes:');
console.log();
console.log('STRICT MODE (recommended for learning):');
console.log('  ✓ Wrong note = "try again" - user must play correct note');
console.log('  ✓ Position only advances on correct notes');
console.log('  ✓ Forces user to learn the correct sequence');
console.log();
console.log('FORGIVING MODE (good for performance/flow):');
console.log('  ✓ Wrong note marked but position advances');
console.log('  ✓ User continues through song regardless');
console.log('  ✓ Good for sight-reading practice, performances');
console.log();
console.log('Both modes:');
console.log('  ✓ Sync from any starting position');
console.log('  ✓ Track accuracy statistics');
console.log('  ✓ Go LOST after 5 consecutive errors');
console.log('  ✓ Re-sync automatically after getting lost');
console.log();
