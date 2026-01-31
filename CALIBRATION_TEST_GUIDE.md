# Calibration Test Suite - User Guide

## 🎯 Purpose

The Calibration Test Suite validates the pitch detection algorithm using synthetically generated tones with known frequencies. This ensures the algorithm accurately detects piano notes across different octaves and durations.

---

## 🚀 Quick Start

### 1. Start Backend Server

```bash
cd /home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend
python3 simple_test_server.py
```

**Expected output:**
```
✓ Using OPTIMIZED YIN algorithm for professional piano pitch detection
✓ Score-aware detection (cheat code) available
✓ Polyphonic chord detection available

Server: http://localhost:8000
WebSocket: ws://localhost:8000/ws/{session_id}
```

### 2. Frontend Already Running

Frontend should already be running on `http://localhost:3000`

If not:
```bash
cd /home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/frontend
npm run dev
```

### 3. Open Calibration Test Page

Navigate to: **http://localhost:3000/calibration**

---

## 📋 Test Suite Overview

### Test Cases (9 Total)

#### Basic Tests (4 tests)
| Test | Note | Frequency | Duration | Purpose |
|------|------|-----------|----------|---------|
| Middle C | C4 | 261.63 Hz | 1000ms | Standard reference |
| Concert Pitch | A4 | 440.00 Hz | 1000ms | Tuning standard |
| E4 | E4 | 329.63 Hz | 1000ms | Natural note |
| G4 | G4 | 392.00 Hz | 1000ms | Natural note |

#### Intermediate Tests (3 tests)
| Test | Note | Frequency | Duration | Purpose |
|------|------|-----------|----------|---------|
| High C | C5 | 523.25 Hz | 1000ms | Higher octave |
| Low C | C3 | 130.81 Hz | 1000ms | Lower octave |
| F# (Black Key) | F#4 | 369.99 Hz | 1000ms | Accidental note |

#### Advanced Tests (2 tests)
| Test | Note | Frequency | Duration | Purpose |
|------|------|-----------|----------|---------|
| Quick Note | D4 | 293.66 Hz | 500ms | Short duration |
| Very Quick | B4 | 493.88 Hz | 250ms | Very short duration |

---

## 🎹 How to Use

### Running Individual Tests

1. **Click any test case** in the left panel
2. **Observe the tone playing** (you'll hear it if speakers are on)
3. **Watch the visualization**:
   - Left panel: Expected note (highlighted in cyan)
   - Right panel: Detected note (highlighted in cyan if correct)
4. **Check the result icon**:
   - ✅ = Correct detection
   - ❌ = Failed detection
   - ⏸️ = Not yet run

### Running Full Test Suite

1. Click **"▶️ RUN ALL TESTS"** button
2. All 9 tests will run sequentially
3. Results appear immediately after each test
4. Final accuracy percentage shown in "Results Summary"

---

## 📊 Understanding Results

### Connection Status

At the top of the page:
- **🟢 WebSocket: CONNECTED** - Backend is ready
- **🔴 WebSocket: DISCONNECTED** - Backend not running or unreachable

### Results Summary

Shows 4 key metrics:
1. **Tests Run** - How many tests completed
2. **Passed** - Correct detections
3. **Failed** - Incorrect or missed detections
4. **Accuracy %** - Overall success rate

### Expected Performance

With a properly functioning algorithm:
- **Basic tests**: 100% accuracy (4/4)
- **Intermediate tests**: 100% accuracy (3/3)
- **Advanced tests**: 90-100% accuracy (2/2)

**Overall target**: ≥95% accuracy (9/9 or 8/9 tests passing)

---

## 🎵 Piano Keyboard Visualization

### Color Coding:

- **Cyan glow (expected)**: These are the notes the system should detect
- **Cyan highlight (detected)**: These are the notes the backend actually detected
- **Green pulse**: Correct match (expected = detected)
- **Red shake**: Wrong note detected

### Layout:

- Displays 3 octaves (C3 to C6)
- White keys: Natural notes (C, D, E, F, G, A, B)
- Black keys: Accidentals (C#, D#, F#, G#, A#)
- Note labels visible on white keys

---

## 🔧 Troubleshooting

### WebSocket Shows "DISCONNECTED"

**Problem**: Backend server not running or not reachable

**Solutions**:
1. Check backend is running: `ps aux | grep simple_test_server`
2. If not running: `cd backend && python3 simple_test_server.py`
3. Check port 8000 is free: `lsof -i :8000`
4. Verify backend health: `curl http://localhost:8000/health`

### No Sound Playing

**Problem**: Audio not audible during tests

**Solutions**:
1. Check browser audio permissions
2. Increase system volume
3. Check browser isn't muted
4. Note: Sine waves are very pure tones (may sound different from piano)

### All Tests Failing

**Problem**: 0% accuracy, all tests show ❌

**Possible causes**:
1. **WebSocket not connected** - Check connection status
2. **Backend algorithm error** - Check backend console for errors
3. **Sample rate mismatch** - Ensure backend expects 44100 Hz
4. **Threshold too high** - Backend may be filtering out test tones

**Debug steps**:
1. Check backend console output during test
2. Look for detection messages: `♪ OPTIMIZED YIN DETECTED: ...`
3. If no detection messages appear, backend isn't receiving audio
4. If detection shows wrong notes, algorithm needs tuning

### Tests Timing Out

**Problem**: Tests hang or don't complete

**Solutions**:
1. Refresh the page
2. Restart backend server
3. Clear browser cache (Ctrl+Shift+R)
4. Check browser console for JavaScript errors (F12)

---

## 🔬 Technical Details

### Audio Generation

- **Engine**: Web Audio API (`AudioContext`)
- **Waveform**: Pure sine wave (single frequency)
- **Sample Rate**: 44100 Hz
- **Envelope**: 10ms fade-in, 10ms fade-out (prevents clicks)
- **Amplitude**: 0.3 (30% volume)

### Audio Transmission

- **Protocol**: WebSocket
- **Format**: JSON messages with Float32Array samples
- **Chunk Size**: 4096 samples
- **Encoding**: Raw audio samples (no compression)

### Backend Detection

- **Algorithm**: Optimized YIN (piano-specific tuning)
- **Window Size**: 2048 samples
- **Frequency Range**: 27.5 Hz (A0) to 4186 Hz (C8)
- **Confidence Threshold**: Typically 0.8-0.9
- **RMS Threshold**: Minimum volume for detection

---

## 📈 Performance Benchmarks

### Expected Detection Latency

- **Audio capture**: ~93ms (4096 samples @ 44.1kHz)
- **WebSocket transmission**: <10ms (local network)
- **Backend processing**: 5-15ms (YIN algorithm)
- **Frontend update**: <5ms (React state update)

**Total latency**: ~110-125ms end-to-end

### Accuracy Targets

| Difficulty | Target Accuracy | Notes |
|------------|----------------|-------|
| Basic | 100% | Pure tones, long duration |
| Intermediate | 100% | Different octaves, black keys |
| Advanced | 90%+ | Short duration challenges algorithm |

---

## 🎓 Learning & Debugging

### What Makes a Test Fail?

1. **Frequency Detection Error**: Backend detects wrong fundamental frequency
2. **Confidence Too Low**: Detection below threshold, ignored
3. **RMS Too Low**: Audio amplitude below noise floor
4. **Harmonic Confusion**: Algorithm picks harmonic instead of fundamental
5. **WebSocket Latency**: Message lost or delayed

### How to Improve Accuracy

1. **Tune confidence threshold** - Lower if missing detections
2. **Tune RMS threshold** - Lower if volume too quiet
3. **Adjust window size** - Larger for low frequencies
4. **Enable harmonic filtering** - Remove 2x, 3x, 4x frequencies
5. **Add temporal smoothing** - Average multiple frames

---

## 📝 Test Results Log

After running tests, record results here:

**Date**: _____________________
**Backend Version**: _____________________
**Test Results**:

| Test | Expected | Detected | Result |
|------|----------|----------|--------|
| 1. Middle C (C4) | C4 | | |
| 2. Concert Pitch (A4) | A4 | | |
| 3. E4 | E4 | | |
| 4. G4 | G4 | | |
| 5. High C (C5) | C5 | | |
| 6. Low C (C3) | C3 | | |
| 7. F#4 (Black Key) | F#4 | | |
| 8. Quick Note (D4) | D4 | | |
| 9. Very Quick (B4) | B4 | | |

**Overall Accuracy**: _______ / 9 = _______%

**Notes**:
_____________________________________________________
_____________________________________________________

---

## 🔗 Related Pages

- **Home**: http://localhost:3000/
- **Practice** (with score following): http://localhost:3000/practice
- **Device Selector**: http://localhost:3000/device-selector
- **Mic Test**: http://localhost:3000/mic-test
- **Backend Health**: http://localhost:8000/health
- **Backend API Docs**: http://localhost:8000/docs

---

## 💡 Tips for Best Results

1. **Close other audio applications** - Prevent microphone conflicts
2. **Use headphones for testing** - Avoid audio feedback loops
3. **Run tests in quiet environment** - Minimize background noise
4. **Test one at a time first** - Understand individual test behavior
5. **Run full suite for statistics** - Get overall accuracy metrics
6. **Record results** - Track improvements over time

---

**Status**: Ready to test
**Last Updated**: 2026-01-25

Happy testing! 🎹🎯
