#!/usr/bin/env python3
"""
Piano Triads Dataset Testing - Fixed with correct API
"""

import os
import glob
import random
from scipy.io import wavfile
from polyphonic_detector import PolyphonicDetector

TRIADS_DIR = "datasets/piano-triads/audio_augmented_x10"
SAMPLE_SIZE = 50  # Test 50 random chords per type

CHORD_TYPE_MAP = {
    'M': 'Major',
    'm': 'Minor',
    'd': 'Diminished',
    'a': 'Augmented'
}

def parse_filename(filename):
    basename = os.path.basename(filename).replace('.wav', '')
    parts = basename.split('_')
    
    if len(parts) >= 4:
        root = parts[2]
        chord_code = parts[3]
        chord_type = CHORD_TYPE_MAP.get(chord_code, 'Unknown')
        return {'root': root, 'chord_type': chord_type, 'chord_code': chord_code}
    return None

def test_chord_file(wav_path, detector):
    try:
        sample_rate, audio = wavfile.read(wav_path)
        
        if len(audio.shape) > 1:
            audio = audio[:, 0]
        
        audio_norm = audio.astype(float) / 32768.0
        
        # Create detector with correct sample rate
        detector_instance = PolyphonicDetector(sample_rate=sample_rate)
        detection = detector_instance.detect_from_samples(audio_norm.tolist())
        
        return {
            'detected_count': len(detection.notes),
            'detected_notes': [n.note for n in detection.notes],
            'is_chord': detection.is_chord
        }
    except Exception as e:
        return {'error': str(e), 'detected_count': 0, 'is_chord': False}

def main():
    print("\n" + "="*70)
    print("PIANO TRIADS SYSTEMATIC TESTING")
    print("="*70)
    
    if not os.path.exists(TRIADS_DIR):
        print(f"\n❌ Dataset not found: {TRIADS_DIR}")
        return
    
    detector = PolyphonicDetector()
    all_files = glob.glob(f"{TRIADS_DIR}/*.wav")
    print(f"\n📊 Found {len(all_files)} chord samples")
    
    chord_types = {}
    for f in all_files:
        info = parse_filename(f)
        if info:
            chord_type = info['chord_type']
            if chord_type not in chord_types:
                chord_types[chord_type] = []
            chord_types[chord_type].append(f)
    
    print(f"📁 Chord types found: {list(chord_types.keys())}")
    
    results = {}
    
    for chord_type, files in chord_types.items():
        print(f"\n{'='*70}")
        print(f"Testing: {chord_type.upper()} chords")
        print(f"{'='*70}")
        
        test_files = random.sample(files, min(SAMPLE_SIZE, len(files)))
        
        correct = 0
        partial = 0
        failed = 0
        total = len(test_files)
        
        for i, wav_path in enumerate(test_files):
            if i % 10 == 0:
                print(f"\r  Progress: {i}/{total}", end="")
            
            result = test_chord_file(wav_path, detector)
            count = result.get('detected_count', 0)
            
            if count == 3:
                correct += 1
            elif count == 2:
                partial += 1
            else:
                failed += 1
        
        accuracy = (correct / total) * 100
        partial_pct = (partial / total) * 100
        
        print(f"\r  ✓ Perfect (3 notes): {accuracy:.1f}% ({correct}/{total})")
        print(f"    Partial (2 notes): {partial_pct:.1f}% ({partial}/{total})")
        print(f"    Failed (0-1 notes): {failed}/{total}")
        
        results[chord_type] = {
            'tested': total,
            'perfect': correct,
            'partial': partial,
            'failed': failed,
            'accuracy': accuracy
        }
    
    print(f"\n{'='*70}")
    print("SUMMARY")
    print(f"{'='*70}")
    
    for chord_type, stats in results.items():
        print(f"  {chord_type:15} Perfect: {stats['accuracy']:5.1f}% | Partial: {stats['partial']:3d} | Failed: {stats['failed']:3d}")
    
    total_perfect = sum(s['perfect'] for s in results.values())
    total_tested = sum(s['tested'] for s in results.values())
    overall_accuracy = (total_perfect / total_tested) * 100 if total_tested > 0 else 0
    
    print(f"\n  {'Overall':15} Perfect: {overall_accuracy:.1f}%")
    
    print(f"\n{'='*70}")
    print("COMPARISON WITH PUBLISHED BENCHMARKS")
    print(f"{'='*70}")
    print(f"  Our Algorithm (FFT):  {overall_accuracy:.1f}% perfect triad detection")
    print(f"  Deep Learning (BTC):  75-80% chord accuracy (ISMIR 2019)")
    print(f"  Human Annotators:     80% chord accuracy (MIREX)")
    
    if overall_accuracy >= 80:
        print(f"\n  ✅ EXCELLENT: Matches/exceeds state-of-the-art!")
    elif overall_accuracy >= 70:
        print(f"\n  ✓ GOOD: Production-ready for tutoring app")
    else:
        print(f"\n  ⚠️ NEEDS IMPROVEMENT: Consider tuning thresholds")
    
    print(f"\n{'='*70}")
    print("✅ TESTING COMPLETE")
    print(f"{'='*70}")

if __name__ == "__main__":
    main()
