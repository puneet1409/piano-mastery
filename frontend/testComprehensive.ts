/**
 * COMPREHENSIVE DEMO MODE TEST (Bun Native)
 * Tests 10 songs with practice_mode enabled (no timing requirements)
 * Uses Bun's native WebSocket - no external dependencies
 */

const SERVER = 'http://localhost:8000';

const TEST_SONGS = [
  { id: 'c_major_scale', type: 'single_note', name: 'C Major Scale' },
  { id: 'twinkle_twinkle', type: 'single_note', name: 'Twinkle Twinkle' },
  { id: 'ajeeb_daastaan_ajeeb_beginner', type: 'beat_score', name: 'Ajeeb Daastaan (Beginner)' },
  { id: 'canon_in_d_canon_beginner', type: 'beat_score', name: 'Canon in D (Beginner)' },
  { id: 'moonlight_sonata_moonlight_beginner', type: 'beat_score', name: 'Moonlight Sonata (Beginner)' },
  { id: 'ode_to_joy_ode_beginner', type: 'beat_score', name: 'Ode to Joy (Beginner)' },
  { id: 'pal_pal_dil_pal_beginner', type: 'beat_score', name: 'Pal Pal Dil Ke Paas (Beginner)' },
  { id: 'perfect_perfect_easy', type: 'beat_score', name: 'Perfect - Ed Sheeran (Beginner)' },
  { id: 'twinkle_twinkle_twinkle_beginner', type: 'beat_score', name: 'Twinkle MIDI (Beginner)' },
  { id: 'yeh_shaam_yeh_shaam_beginner', type: 'beat_score', name: 'Yeh Shaam Mastani (Beginner)' },
];

const WRONG_NOTES = ['X#9', 'Z0', 'Q7', 'W3'];

function log(level: string, msg: string, data: unknown = null) {
  const ts = new Date().toISOString().slice(11, 23);
  const colors: Record<string, string> = {
    'INFO': '\x1b[36m', 'OK': '\x1b[32m', 'WARN': '\x1b[33m',
    'ERROR': '\x1b[31m', 'DEBUG': '\x1b[90m', 'NOTE': '\x1b[35m',
    'SEND': '\x1b[34m', 'RECV': '\x1b[94m',
  };
  console.log(`${ts} ${colors[level] || ''}[${level}]\x1b[0m ${msg}`);
  if (data) console.log(`           ${JSON.stringify(data)}`);
}

function logSeparator(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

interface SongConfig {
  id: string;
  type: string;
  name: string;
}

interface TestResults {
  song: string;
  type: string;
  mode: string;
  started: boolean;
  notesSent: number;
  notesMatched: number;
  notesWrong: number;
  noteResults: Array<{
    note: string;
    matched: boolean;
    action: string;
    position: number;
    expected: string;
  }>;
  expectedSequence: string[];
  errors: string[];
}

async function testSong(songConfig: SongConfig, testMode: string): Promise<TestResults> {
  const { id, type, name } = songConfig;
  const isAccurate = testMode === 'accurate';

  log('INFO', `Testing: ${name} (${type}) - ${isAccurate ? 'ACCURATE' : 'WITH ERRORS'}`);

  const sessionId = `test-${id}-${testMode}-${Date.now()}`;
  const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`);

  return new Promise((resolve) => {
    const results: TestResults = {
      song: name, type, mode: testMode, started: false,
      notesSent: 0, notesMatched: 0, notesWrong: 0,
      noteResults: [], expectedSequence: [], errors: [],
    };

    let allNotes: string[] = [];
    let playIndex = 0;
    let notesSentCount = 0;
    const maxNotes = 5;

    const timeout = setTimeout(() => {
      log('WARN', `Timeout for ${name}`);
      results.errors.push('timeout');
      ws.close();
      resolve(results);
    }, 15000);

    function injectNextNote() {
      if (notesSentCount >= maxNotes || playIndex >= allNotes.length) {
        finishTest();
        return;
      }

      const expectedNote = allNotes[playIndex];
      let noteToPlay: string;

      if (isAccurate) {
        noteToPlay = expectedNote;
      } else {
        noteToPlay = (notesSentCount % 2 === 1)
          ? WRONG_NOTES[notesSentCount % WRONG_NOTES.length]
          : expectedNote;
      }

      notesSentCount++;
      results.notesSent++;

      log('SEND', `[${notesSentCount}] ${noteToPlay} (expect: ${expectedNote})`);
      ws.send(JSON.stringify({ type: 'test_note', data: { note: noteToPlay } }));
    }

    function finishTest() {
      clearTimeout(timeout);
      const acc = results.notesSent > 0 ? ((results.notesMatched / results.notesSent) * 100).toFixed(0) : '0';
      log('INFO', `Result: ${acc}% (${results.notesMatched}/${results.notesSent})`);
      ws.close();
      resolve(results);
    }

    ws.onopen = () => {
      log('DEBUG', `Connected, starting with practice_mode=true`);
      ws.send(JSON.stringify({
        type: 'start_exercise',
        data: {
          exercise: id,
          hands: 'right',
          practice_mode: true
        }
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);

      if (msg.type === 'session_started') return;

      if (msg.type === 'exercise_started') {
        results.started = true;
        const data = msg.data;

        if (data.all_notes && data.all_notes.length > 0) {
          allNotes = data.all_notes.map((g: { notes: string | string[] }) => {
            const notes = Array.isArray(g.notes) ? g.notes : [g.notes];
            return notes[0];
          });
        } else if (data.expected_notes) {
          allNotes = data.expected_notes;
        }

        results.expectedSequence = allNotes.slice(0, maxNotes);
        log('OK', `Loaded: ${data.exercise_name} (${allNotes.length} notes)`);
        log('DEBUG', `First ${maxNotes}: ${results.expectedSequence.join(' -> ')}`);

        if (type === 'beat_score') {
          ws.send(JSON.stringify({ type: 'count_in_complete' }));
        }
        setTimeout(() => injectNextNote(), 200);
        return;
      }

      if (msg.type === 'timing_started') return;

      if (msg.type === 'note_detected') {
        const data = msg.data;
        const matched = data.matched;
        const note = data.note;

        results.noteResults.push({
          note, matched,
          action: data.action || '',
          position: data.current_index,
          expected: results.expectedSequence[playIndex] || 'unknown',
        });

        if (matched) {
          results.notesMatched++;
          playIndex++;
          log('OK', `[${notesSentCount}] ${note} MATCHED -> pos ${data.current_index}`);
        } else {
          results.notesWrong++;
          log('WARN', `[${notesSentCount}] ${note} WRONG (${data.action})`);
        }

        if (data.completed || notesSentCount >= maxNotes) {
          finishTest();
        } else {
          setTimeout(() => injectNextNote(), 100);
        }
        return;
      }

      if (msg.type === 'exercise_complete') {
        log('OK', `Complete! ${msg.data.correct}/${msg.data.total}`);
        finishTest();
        return;
      }

      if (msg.type === 'error') {
        log('ERROR', msg.data?.message || 'Unknown error');
        results.errors.push(msg.data?.message);
        finishTest();
      }
    };

    ws.onerror = (event) => {
      log('ERROR', 'WebSocket error');
      results.errors.push('websocket_error');
      clearTimeout(timeout);
      resolve(results);
    };
  });
}

async function main() {
  logSeparator('COMPREHENSIVE TEST WITH PRACTICE MODE');
  console.log('Testing with practice_mode=true (no timing requirements)\n');

  try {
    const health = await fetch(`${SERVER}/health`).then(r => r.json());
    log('OK', `Server healthy`);
  } catch (e) {
    log('ERROR', `Server not running: ${(e as Error).message}`);
    process.exit(1);
  }

  const exercises = await fetch(`${SERVER}/exercises`).then(r => r.json());
  const availableIds = new Set((exercises.exercises || []).map((e: { id: string }) => e.id));
  log('INFO', `Available: ${availableIds.size} exercises`);

  const allResults: TestResults[] = [];

  for (const song of TEST_SONGS) {
    if (!availableIds.has(song.id)) {
      log('WARN', `Skipping ${song.name} - not found`);
      continue;
    }

    logSeparator(song.name);

    log('INFO', '--- ACCURATE PLAY ---');
    const accurateResult = await testSong(song, 'accurate');
    allResults.push(accurateResult);
    await new Promise(r => setTimeout(r, 300));

    log('INFO', '--- WITH ERRORS ---');
    const errorResult = await testSong(song, 'with_errors');
    allResults.push(errorResult);
    await new Promise(r => setTimeout(r, 300));
  }

  logSeparator('FINAL SUMMARY');

  console.log('\n| Song                         | Mode       | Sent | Match | Wrong | Acc  |');
  console.log('|------------------------------|------------|------|-------|-------|------|');

  let totalSent = 0, totalMatched = 0;
  let accurateTests = 0, accuratePassed = 0;
  let errorTests = 0, errorBehavedCorrectly = 0;

  for (const r of allResults) {
    const acc = r.notesSent > 0 ? ((r.notesMatched / r.notesSent) * 100).toFixed(0) + '%' : 'N/A';
    console.log(`| ${r.song.padEnd(28)} | ${r.mode.padEnd(10)} | ${String(r.notesSent).padStart(4)} | ${String(r.notesMatched).padStart(5)} | ${String(r.notesWrong).padStart(5)} | ${acc.padStart(4)} |`);

    totalSent += r.notesSent;
    totalMatched += r.notesMatched;

    if (r.mode === 'accurate') {
      accurateTests++;
      if (r.notesMatched === r.notesSent && r.notesSent > 0) accuratePassed++;
    } else {
      errorTests++;
      if (r.notesWrong > 0) errorBehavedCorrectly++;
    }
  }

  const totalAcc = totalSent > 0 ? ((totalMatched / totalSent) * 100).toFixed(0) + '%' : 'N/A';
  console.log('|------------------------------|------------|------|-------|-------|------|');
  console.log(`| TOTAL                        |            | ${String(totalSent).padStart(4)} | ${String(totalMatched).padStart(5)} | ${String(totalSent - totalMatched).padStart(5)} | ${totalAcc.padStart(4)} |`);

  logSeparator('VERDICT');
  console.log(`\nAccurate play: ${accuratePassed}/${accurateTests} songs at 100%`);
  console.log(`Error handling: ${errorBehavedCorrectly}/${errorTests} correctly rejected wrong notes`);

  if (accuratePassed === accurateTests) {
    log('OK', '\n✓ ALL ACCURATE TESTS PASSED - Practice mode working!');
    process.exit(0);
  } else {
    log('ERROR', `\n✗ ${accurateTests - accuratePassed} accurate tests failed`);
    process.exit(1);
  }
}

main().catch(e => {
  log('ERROR', e.message);
  process.exit(1);
});
