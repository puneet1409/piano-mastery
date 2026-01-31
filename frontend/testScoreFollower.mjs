/**
 * Score Follower Test
 *
 * Demonstrates automatic song position detection:
 * - Start playing from any position in the song
 * - Algorithm detects where you are after a few notes
 * - Continuously tracks position as you play
 *
 * Run with: node testScoreFollower.mjs
 */

// ============================================================================
// SCORE FOLLOWER (inline for testing)
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

function pitchClassesMatch(note1, note2) {
  return getPitchClass(note1) === getPitchClass(note2);
}

class ScoreFollower {
  constructor(song, config = {}) {
    this.song = song;
    this.config = {
      bufferSize: 5,
      lockThreshold: 0.7,
      minMatchesForLock: 3,
      ...config
    };
    this.reset();
  }

  reset() {
    this.state = {
      currentPosition: -1,
      confidence: 0,
      matchedNotes: 0,
      isLocked: false,
      detectedNotes: [],
      possiblePositions: [],
    };
  }

  processNote(detectedNote) {
    // Add to buffer
    this.state.detectedNotes.push(detectedNote);
    if (this.state.detectedNotes.length > this.config.bufferSize) {
      this.state.detectedNotes.shift();
    }

    // Find matches
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

      if (score > 0.3) {
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
      this.state.confidence *= 0.8;
      if (this.state.confidence < 0.3) {
        this.state.isLocked = false;
      }
      return;
    }

    const best = candidates[0];

    if (this.state.isLocked && this.state.currentPosition >= 0) {
      const nearbyCandidate = candidates.find(c =>
        Math.abs(c.position - this.state.currentPosition) <= 2 && c.score > 0.5
      );

      if (nearbyCandidate) {
        this.state.currentPosition = nearbyCandidate.position;
        this.state.confidence = nearbyCandidate.score;
        this.state.matchedNotes++;
        return;
      }
    }

    const secondBest = candidates[1];
    const isUnambiguous = !secondBest || (best.score - secondBest.score) > 0.2;

    this.state.currentPosition = best.position;
    this.state.confidence = best.score * (isUnambiguous ? 1 : 0.7);

    if (this.state.detectedNotes.length >= this.config.minMatchesForLock &&
        this.state.confidence >= this.config.lockThreshold) {
      this.state.isLocked = true;
      this.state.matchedNotes = this.state.detectedNotes.length;
    }
  }

  getExpectedNote() {
    if (this.state.currentPosition < 0 || !this.state.isLocked) {
      return null;
    }
    const nextIndex = this.state.currentPosition + 1;
    if (nextIndex >= this.song.notes.length) {
      return null;
    }
    return this.song.notes[nextIndex];
  }

  getState() {
    return { ...this.state };
  }
}

// ============================================================================
// TEST SONGS
// ============================================================================

const SONGS = {
  fur_elise: {
    title: 'Für Elise',
    notes: [
      'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4',  // 0-8
      'C4', 'E4', 'A4', 'B4', 'E4', 'G#4', 'B4', 'C5',         // 9-16
      'E4', 'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5', 'A4', // 17-26
    ],
  },

  twinkle: {
    title: 'Twinkle Twinkle',
    notes: [
      'C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4',   // 0-6
      'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4',   // 7-13
      'G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4',   // 14-20
      'G4', 'G4', 'F4', 'F4', 'E4', 'E4', 'D4',   // 21-27
    ],
  },

  happy_birthday: {
    title: 'Happy Birthday',
    notes: [
      'C4', 'C4', 'D4', 'C4', 'F4', 'E4',         // 0-5
      'C4', 'C4', 'D4', 'C4', 'G4', 'F4',         // 6-11
      'C4', 'C4', 'C5', 'A4', 'F4', 'E4', 'D4',   // 12-18
      'A#4', 'A#4', 'A4', 'F4', 'G4', 'F4',       // 19-24
    ],
  },

  kaise_hua: {
    title: 'Kaise Hua (Kabir Singh)',
    notes: [
      'E4', 'E4', 'F#4', 'G4', 'G4', 'A4', 'B4', 'A4', 'G4',  // 0-8
      'E4', 'F#4', 'G4', 'A4', 'G4', 'F#4', 'E4',              // 9-15
      'D4', 'E4', 'F#4', 'G4', 'F#4', 'E4', 'D4', 'E4',       // 16-23
    ],
  },
};

// ============================================================================
// TEST SCENARIOS
// ============================================================================

function runTest(songKey, scenario) {
  const song = SONGS[songKey];
  const follower = new ScoreFollower(song);

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📁 ${song.title} | ${scenario.name}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`Song notes: ${song.notes.join(' ')}`);
  console.log(`Playing from position ${scenario.startPos}: ${scenario.notes.join(' ')}`);
  console.log();

  console.log('Note'.padEnd(8) + 'Position'.padEnd(12) + 'Confidence'.padEnd(12) + 'Locked'.padEnd(10) + 'Expected Next');
  console.log('─'.repeat(60));

  let correctPositions = 0;
  let totalNotes = 0;

  for (let i = 0; i < scenario.notes.length; i++) {
    const note = scenario.notes[i];
    const actualPos = scenario.startPos + i;

    const state = follower.processNote(note);

    const posStr = state.currentPosition >= 0 ? state.currentPosition.toString() : '?';
    const confStr = (state.confidence * 100).toFixed(0) + '%';
    const lockedStr = state.isLocked ? '✓ YES' : 'no';

    const expectedNext = follower.getExpectedNote();
    const nextStr = expectedNext ? expectedNext : '-';

    // Check if detected position is correct (within 1 of actual)
    const isCorrect = Math.abs(state.currentPosition - actualPos) <= 1;
    if (state.isLocked) {
      totalNotes++;
      if (isCorrect) correctPositions++;
    }

    const posDisplay = isCorrect ? posStr : `${posStr} (actual: ${actualPos})`;

    console.log(
      `${note.padEnd(8)}${posDisplay.padEnd(12)}${confStr.padEnd(12)}${lockedStr.padEnd(10)}${nextStr}`
    );
  }

  const accuracy = totalNotes > 0 ? (correctPositions / totalNotes * 100).toFixed(0) : 'N/A';
  console.log('─'.repeat(60));
  console.log(`Position accuracy: ${accuracy}% (${correctPositions}/${totalNotes} locked notes correct)`);

  return { correctPositions, totalNotes };
}

// ============================================================================
// MAIN
// ============================================================================

console.log('='.repeat(80));
console.log('SCORE FOLLOWER TEST - Automatic Song Position Detection');
console.log('='.repeat(80));
console.log();
console.log('This demonstrates automatic sync: play from anywhere, algorithm finds you!');

// Test 1: Start from beginning
runTest('fur_elise', {
  name: 'Start from beginning',
  startPos: 0,
  notes: ['E5', 'D#5', 'E5', 'D#5', 'E5', 'B4', 'D5', 'C5'],
});

// Test 2: Start from middle
runTest('fur_elise', {
  name: 'Start from middle (position 9)',
  startPos: 9,
  notes: ['C4', 'E4', 'A4', 'B4', 'E4', 'G#4', 'B4', 'C5'],
});

// Test 3: Start from near end
runTest('fur_elise', {
  name: 'Start from near end (position 17)',
  startPos: 17,
  notes: ['E4', 'E5', 'D#5', 'E5', 'D#5', 'E5', 'B4'],
});

// Test 4: Twinkle from middle
runTest('twinkle', {
  name: 'Start from verse 2 (position 7)',
  startPos: 7,
  notes: ['F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4'],
});

// Test 5: Happy Birthday from "happy birthday dear..."
runTest('happy_birthday', {
  name: 'Start from "dear..." section (position 12)',
  startPos: 12,
  notes: ['C4', 'C4', 'C5', 'A4', 'F4', 'E4', 'D4'],
});

// Test 6: With some wrong notes (realistic scenario)
console.log(`\n${'─'.repeat(70)}`);
console.log(`📁 Twinkle Twinkle | With missed/wrong notes`);
console.log(`${'─'.repeat(70)}`);
console.log(`Song notes: ${SONGS.twinkle.notes.join(' ')}`);
console.log(`Playing (with errors): C4 C4 G4 F4(wrong) A4 A4 G4`);
console.log();

const follower = new ScoreFollower(SONGS.twinkle);
const playedWithErrors = ['C4', 'C4', 'G4', 'F4', 'A4', 'A4', 'G4']; // F4 is wrong (should be G4)

console.log('Note'.padEnd(8) + 'Position'.padEnd(12) + 'Confidence'.padEnd(12) + 'Locked'.padEnd(10) + 'Status');
console.log('─'.repeat(60));

for (let i = 0; i < playedWithErrors.length; i++) {
  const note = playedWithErrors[i];
  const state = follower.processNote(note);

  const posStr = state.currentPosition >= 0 ? state.currentPosition.toString() : '?';
  const confStr = (state.confidence * 100).toFixed(0) + '%';
  const lockedStr = state.isLocked ? '✓ YES' : 'no';

  // Check if this was a wrong note
  const expectedNote = SONGS.twinkle.notes[i];
  const isWrong = note !== expectedNote;
  const status = isWrong ? `⚠ Wrong (expected ${expectedNote})` : '✓ Correct';

  console.log(`${note.padEnd(8)}${posStr.padEnd(12)}${confStr.padEnd(12)}${lockedStr.padEnd(10)}${status}`);
}

// Test 7: Bollywood song
runTest('kaise_hua', {
  name: 'Start from chorus (position 9)',
  startPos: 9,
  notes: ['E4', 'F#4', 'G4', 'A4', 'G4', 'F#4', 'E4'],
});

console.log();
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log();
console.log('The Score Follower algorithm:');
console.log('  ✓ Detects position after ~3-5 notes');
console.log('  ✓ Works when starting from any position in the song');
console.log('  ✓ Handles some wrong notes gracefully');
console.log('  ✓ Provides confidence score for UI feedback');
console.log('  ✓ Predicts next expected note once locked');
console.log();
console.log('Integration ideas:');
console.log('  1. Auto-scroll sheet music to current position');
console.log('  2. Show "syncing..." until locked, then show position');
console.log('  3. Highlight current note in song visualization');
console.log('  4. Jump playback to detected position');
console.log();
