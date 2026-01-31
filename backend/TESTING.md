# Headless Algorithm Testing Guide

Test the piano pitch detection algorithm without the UI.

## Quick Start

```bash
cd /home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend

# 1. Generate synthetic test audio
python3 generate_test_audio.py

# 2. Run batch tests
bash run_batch_tests.sh

# 3. Test individual files
python3 test_detection_headless.py test_c4_sustained.wav C4
```

## Files

| File | Purpose |
|------|---------|
| `test_detection_headless.py` | Main testing script - analyzes audio with YIN algorithm |
| `generate_test_audio.py` | Generates synthetic piano audio files for testing |
| `run_batch_tests.sh` | Runs all tests and reports pass/fail |
| `TESTING.md` | This documentation |

## Testing Individual Files

### Syntax
```bash
python3 test_detection_headless.py <audio_file.wav> [expected_notes]
```

### Examples

**Single sustained note:**
```bash
python3 test_detection_headless.py test_c4_sustained.wav C4
```

**Note sequence (space-separated):**
```bash
python3 test_detection_headless.py test_c_major_scale.wav "C4 D4 E4 F4 G4 A4 B4 C5"
```

**No expected notes (just show detections):**
```bash
python3 test_detection_headless.py recording.wav
```

### Output Example

```
📁 Loading: test_c4_sustained.wav
   Sample rate: 44100 Hz
   Channels: 1
   Duration: 3.00s
   Samples: 132,300

🎯 Analyzing audio with YIN algorithm...
   Progress: 50% (32/64 chunks)
   Progress: 100% (64/64 chunks)

✅ Analysis complete: 1 notes detected (1 raw → 1 merged)

================================================================================
DETECTION RESULTS
================================================================================

📝 Detected sequence: C4

📊 Detailed Analysis:
#    Note   Freq (Hz)    Expected     Deviation       Duration     Conf     Status
----------------------------------------------------------------------------------------------------
1    C4        261.6 Hz     261.6 Hz      +0 cents          2970 ms    95%   ✅ Accurate

----------------------------------------------------------------------------------------------------
📈 Summary:
   Total notes: 1
   Total duration: 2.97s
   Average confidence: 95.0%
   Average pitch deviation: 0 cents

================================================================================
ACCURACY VALIDATION
================================================================================

📋 Expected: C4
🎵 Detected: C4

📊 Metrics:
   Precision: 100.0% (detected notes that were correct)
   Recall: 100.0% (expected notes that were detected)
   F1 Score: 100.0% (harmonic mean of precision and recall)

✅ EXCELLENT: Algorithm performed very well (F1 = 100.0%)

================================================================================
```

## Batch Testing

Run all tests at once:

```bash
bash run_batch_tests.sh
```

Tests run:
1. Single sustained middle C
2. C major scale
3. Chromatic sequence
4. Octave test (C3-C4-C5)
5. Staccato notes (very short)
6. Low notes (bass)
7. High notes (treble)

Expected output:
```
BATCH TEST SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total tests: 7
Passed: 7
Failed: 0
Success rate: 100.0%

✅ ALL TESTS PASSED!
```

## Testing Real Audio

### From YouTube Video

1. Download audio using `yt-dlp`:
```bash
yt-dlp -x --audio-format wav -o "youtube_piano.wav" <youtube_url>
```

2. Test it:
```bash
python3 test_detection_headless.py youtube_piano.wav "C4 D4 E4"
```

### From Recording

If you recorded audio in the UI (Phase 1), export it and test:

```bash
python3 test_detection_headless.py recording.wav
```

## Metrics Explained

| Metric | Meaning | Good Value |
|--------|---------|------------|
| **Precision** | Of all detected notes, how many were correct? | >90% |
| **Recall** | Of all expected notes, how many were detected? | >90% |
| **F1 Score** | Balance between precision and recall | >80% |
| **Cents Deviation** | Pitch accuracy (1200 cents = 1 octave) | <20 cents |
| **Confidence** | Algorithm's certainty | >80% |

### Status Indicators
- ✅ **Accurate**: <20 cents deviation (very good)
- ⚠️ **Slightly off**: 20-50 cents (acceptable)
- ❌ **Wrong note**: >50 cents (likely wrong note detected)

## Interpreting Results

### Good Detection
```
✅ C4: 261.6Hz vs 261.6Hz (+0 cents) 2970 ms 95% ✅ Accurate
F1 Score: 100.0%
```
Perfect! Note detected correctly.

### Calibration Issue
```
Average deviation: +25 cents
All notes are SHARP
```
Systematic pitch shift - likely sample rate mismatch or playback speed wrong.

### Algorithm Issue
```
✅ C4: 1046.5Hz vs 261.6Hz (+2400 cents) 500 ms 90% ❌ Wrong note?
```
Detected harmonic instead of fundamental - algorithm error.

### Missed Notes
```
❌ Missed notes: D4, E4
Recall: 62.5%
```
Algorithm failed to detect some notes - may need to adjust confidence threshold.

## Troubleshooting

### No notes detected
- Audio too quiet (RMS < 0.003)
- Check: `python3 -c "import wave; w=wave.open('file.wav'); print(w.getframerate())"`
- Expected: 44100 Hz

### Wrong octaves detected
- YIN detecting harmonics instead of fundamental
- Check cents deviation - should be multiples of 1200

### Many spurious short notes
- Noise or instability
- Notes <100ms are automatically filtered

### Tests timeout
- Audio file too long (>60s)
- Try shorter clips

## Advanced Usage

### Custom confidence threshold

Edit `optimized_yin.py` line 45:
```python
threshold = 0.10  # Lower = more sensitive (more false positives)
                  # Higher = less sensitive (more missed notes)
```

### Adjust merge threshold

Edit `test_detection_headless.py` line 133:
```python
if prev['note'] == note_data['note'] and time_gap < 0.3:  # 300ms
```

### View raw detections (before merging)

Add `--raw` flag support by modifying the script.

## Next Steps

After validating with synthetic audio:

1. Test with real piano recordings
2. Test with YouTube videos of piano performances
3. Compare YIN vs FFT-based polyphonic detection
4. Tune parameters based on failure modes
5. Integrate improvements back into UI

## Support

If tests fail consistently:
1. Check Python dependencies: `pip3 install numpy`
2. Verify audio file format: `file test_c4_sustained.wav`
3. Check backend logs for errors
4. Report issue with test output
