# MuseScore Testing Setup Guide

## 🎵 Testing Bollywood Songs from MuseScore

Perfect! You have a MuseScore subscription. Here's how to test with songs from **user 8633351's Bollywood collection**.

---

## 📋 **Quick Setup (5 minutes)**

### Step 1: Install Dependencies

```bash
# Install Python MIDI library (already done ✓)
pip3 install mido --break-system-packages

# Install FluidSynth for MIDI-to-audio conversion
sudo apt update
sudo apt install -y fluidsynth fluid-soundfont-gm

# Verify installation
which fluidsynth
ls /usr/share/sounds/sf2/FluidR3_GM.sf2
```

---

## 🎼 **Workflow: MuseScore → Testing**

### Step 2: Download from MuseScore

1. **Go to the collection:**
   - https://musescore.com/user/8633351/sets/3403536

2. **Pick a song** (e.g., any Bollywood favorite)

3. **Download MIDI:**
   - Click on the score
   - Click "Download" button
   - Select "MIDI" format
   - Save to: `backend/test_audio/musescore/`

### Step 3: Process the MIDI File

```bash
cd /home/puneet/dev/study-app/.worktrees/piano-mastery/piano-app/backend

# Create directory
mkdir -p test_audio/musescore

# Process a single MIDI file
python3 musescore_workflow.py test_audio/musescore/your_song.mid
```

**This will:**
- ✓ Extract all chords from the MIDI (ground truth)
- ✓ Convert MIDI to WAV audio (44.1kHz)
- ✓ Save chord data as JSON
- ✓ Ready for testing!

### Step 4: Test Chord Detection

```bash
# Test the generated WAV file
python3 test_real_audio.py test_audio/musescore/your_song.wav
```

---

## 📊 **Analyze Entire Collection**

Downloaded multiple songs? Analyze them all at once:

```bash
# Analyze all MIDI files in directory
python3 musescore_workflow.py --analyze test_audio/musescore/

# This will show:
# - Total songs
# - Songs with chords
# - Total chord events
# - Total single notes
```

---

## 🎯 **Example Workflow**

Let's say you download **"Tum Hi Ho"** from the collection:

```bash
# 1. Download from MuseScore
# Save as: test_audio/musescore/tum_hi_ho.mid

# 2. Process it
python3 musescore_workflow.py test_audio/musescore/tum_hi_ho.mid

# Output will show:
# - First 5 chord events with timing
# - Generated files:
#   * tum_hi_ho_chords.json (ground truth)
#   * tum_hi_ho.wav (audio)

# 3. Test detection
python3 test_real_audio.py test_audio/musescore/tum_hi_ho.wav

# 4. Compare results
# - Open tum_hi_ho_chords.json to see expected chords
# - Check if detector matched them
```

---

## 📈 **What to Expect**

### Chord Extraction Output:
```
📊 Analyzing MIDI: tum_hi_ho.mid
  ✓ Found 245 note events
  ✓ 87 are chords (2+ notes)

  First 5 events:
    1. [CHORD] C4 + E4 + G4 @ 0.50s
    2. [NOTE] G4 @ 1.20s
    3. [CHORD] F4 + A4 + C5 @ 2.10s
    4. [CHORD] G4 + B4 + D5 @ 3.50s
    5. [NOTE] C5 @ 4.20s
```

### Audio Conversion:
```
🎵 Converting MIDI to WAV...
  Input: tum_hi_ho.mid
  Output: tum_hi_ho.wav
  Using soundfont: /usr/share/sounds/sf2/FluidR3_GM.sf2
  ✓ Created: tum_hi_ho.wav (4.2 MB)
```

---

## 🔍 **Validation Strategy**

### For Each Song:

1. **Extract ground truth** (from MIDI)
   - Know exactly which chords should be detected
   - Know exact timing

2. **Test detection** (on generated audio)
   - Run polyphonic detector
   - Compare against ground truth

3. **Calculate accuracy**
   - Chord-level accuracy
   - Note-level precision/recall
   - Timing accuracy

### Metrics to Track:

```json
{
  "song": "tum_hi_ho",
  "ground_truth_chords": 87,
  "detected_chords": 83,
  "perfect_matches": 78,
  "partial_matches": 5,
  "misses": 4,
  "accuracy": "89.7%"
}
```

---

## 🎹 **Recommended Songs to Test**

From user 8633351's collection, start with these types:

### **1. Simple Songs (Good for initial testing)**
- Songs with clear chord progressions
- Slower tempo
- Minimal ornamentations

### **2. Complex Songs (Advanced testing)**
- Fast arpeggios
- Jazz-style chord progressions
- Multiple instrument parts

### **3. Diverse Styles**
- Classical Bollywood (older songs)
- Modern Bollywood (electronic elements)
- Devotional songs (simpler progressions)

---

## ⚙️ **Troubleshooting**

### If FluidSynth fails:
```bash
# Check if soundfont exists
ls /usr/share/sounds/sf2/

# If missing, download one:
wget https://musical-artifacts.com/artifacts/738/FluidR3_GM.sf2
mkdir -p soundfonts
mv FluidR3_GM.sf2 soundfonts/

# Use custom soundfont:
python3 musescore_workflow.py song.mid soundfonts/FluidR3_GM.sf2
```

### If MIDI parsing fails:
- Check if file is valid MIDI
- Try opening in MuseScore desktop app
- Re-download from MuseScore

### If no chords detected:
- MIDI might be single-note melody
- Adjust time_resolution parameter:
  ```python
  # In musescore_workflow.py, line where extract_chords_from_midi is called
  chords = extract_chords_from_midi(path, time_resolution=0.3)  # Wider window
  ```

---

## 📁 **Directory Structure**

After processing multiple songs:

```
backend/
├── test_audio/
│   ├── musescore/
│   │   ├── song1.mid           (downloaded)
│   │   ├── song1.wav           (generated)
│   │   ├── song1_chords.json   (ground truth)
│   │   ├── song2.mid
│   │   ├── song2.wav
│   │   ├── song2_chords.json
│   │   └── ...
│   ├── piano_c1.wav            (test samples)
│   └── mixed_chord.wav
├── musescore_workflow.py       (main tool)
└── test_real_audio.py          (detector test)
```

---

## 🚀 **Next Steps**

1. **Download 5-10 songs** from the collection
2. **Process them all**:
   ```bash
   for file in test_audio/musescore/*.mid; do
     python3 musescore_workflow.py "$file"
   done
   ```

3. **Run batch detection**:
   ```bash
   for file in test_audio/musescore/*.wav; do
     echo "Testing: $file"
     python3 test_real_audio.py "$file"
   done
   ```

4. **Analyze results** - Compare detected chords vs ground truth

---

## 🎯 **What This Gives You**

✅ **Real Bollywood music testing**
✅ **Ground truth chord data** (from MIDI)
✅ **Validation metrics** (accuracy, precision, recall)
✅ **Cultural diversity** (Indian music patterns)
✅ **Production-ready testing** (real-world songs)

---

## 📝 **Alternative: Pre-downloaded Collection**

If you want to test immediately:

1. Download the entire collection as ZIP from MuseScore
2. Extract to `test_audio/musescore/`
3. Run batch analysis:
   ```bash
   python3 musescore_workflow.py --analyze test_audio/musescore/
   ```

This will process everything automatically.

---

## ✅ **Ready to Start!**

**You now have:**
- ✓ MIDI parsing (mido installed)
- ✓ Workflow script (musescore_workflow.py)
- ✓ Testing pipeline (complete)

**Just need:**
- FluidSynth installation (for audio conversion)
- Download songs from MuseScore

**Once FluidSynth is installed, you're ready to test with real Bollywood music!**

---

**Quick Install Command:**
```bash
sudo apt install -y fluidsynth fluid-soundfont-gm
```

**Then start testing:**
```bash
# Download a song from MuseScore collection
# Save to test_audio/musescore/

python3 musescore_workflow.py test_audio/musescore/your_song.mid
```
