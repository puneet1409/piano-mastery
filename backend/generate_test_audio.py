#!/usr/bin/env python3
"""
Generate synthetic test audio files for algorithm testing.
Creates pure sine wave audio files for controlled testing.

Usage:
    python3 generate_test_audio.py
"""

import numpy as np
import wave
import struct


def get_note_frequency(note: str) -> float:
    """Convert note name to frequency in Hz."""
    note_offsets = {
        "C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4,
        "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2
    }

    note_name = note[:-1]
    octave = int(note[-1])

    semitones_from_a4 = note_offsets.get(note_name, 0) + (octave - 4) * 12
    frequency = 440 * (2 ** (semitones_from_a4 / 12))

    return frequency


def generate_note(frequency: float, duration: float, sample_rate: int = 44100, amplitude: float = 0.3) -> np.ndarray:
    """Generate a pure sine wave for a given frequency."""
    num_samples = int(sample_rate * duration)
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # Pure sine wave
    audio = amplitude * np.sin(2 * np.pi * frequency * t)

    # Add fade in/out to avoid clicks
    fade_samples = int(0.01 * sample_rate)  # 10ms fade
    fade_in = np.linspace(0, 1, fade_samples)
    fade_out = np.linspace(1, 0, fade_samples)

    audio[:fade_samples] *= fade_in
    audio[-fade_samples:] *= fade_out

    return audio.astype(np.float32)


def generate_piano_note(frequency: float, duration: float, sample_rate: int = 44100) -> np.ndarray:
    """Generate a piano-like sound with harmonics."""
    num_samples = int(sample_rate * duration)
    t = np.linspace(0, duration, num_samples, endpoint=False)

    # Fundamental + harmonics with decay
    audio = 0.5 * np.sin(2 * np.pi * frequency * t)  # Fundamental
    audio += 0.3 * np.sin(2 * np.pi * frequency * 2 * t)  # 2nd harmonic
    audio += 0.15 * np.sin(2 * np.pi * frequency * 3 * t)  # 3rd harmonic
    audio += 0.08 * np.sin(2 * np.pi * frequency * 4 * t)  # 4th harmonic
    audio += 0.04 * np.sin(2 * np.pi * frequency * 5 * t)  # 5th harmonic

    # Envelope (attack-decay-sustain-release)
    attack = 0.01  # 10ms
    decay = 0.1    # 100ms
    sustain_level = 0.7
    release = 0.05  # 50ms

    envelope = np.ones(num_samples)

    # Attack
    attack_samples = int(attack * sample_rate)
    envelope[:attack_samples] = np.linspace(0, 1, attack_samples)

    # Decay
    decay_samples = int(decay * sample_rate)
    decay_end = attack_samples + decay_samples
    if decay_end < num_samples:
        envelope[attack_samples:decay_end] = np.linspace(1, sustain_level, decay_samples)

    # Sustain (already set to sustain_level)
    envelope[decay_end:-int(release * sample_rate)] = sustain_level

    # Release
    release_samples = int(release * sample_rate)
    envelope[-release_samples:] = np.linspace(sustain_level, 0, release_samples)

    audio *= envelope

    # Normalize
    audio = audio / np.max(np.abs(audio)) * 0.3

    return audio.astype(np.float32)


def save_wav(filename: str, audio: np.ndarray, sample_rate: int = 44100):
    """Save audio to WAV file."""
    # Convert to 16-bit PCM
    audio_int16 = (audio * 32767).astype(np.int16)

    with wave.open(filename, 'wb') as wav:
        wav.setnchannels(1)  # Mono
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(sample_rate)
        wav.writeframes(audio_int16.tobytes())

    print(f"✅ Created: {filename} ({len(audio) / sample_rate:.2f}s)")


def main():
    print("🎵 Generating test audio files...\n")

    # Test 1: Single middle C (sustained)
    print("Test 1: Single middle C (sustained)")
    freq_c4 = get_note_frequency("C4")
    audio = generate_piano_note(freq_c4, 3.0)  # 3 seconds
    save_wav("test_c4_sustained.wav", audio)

    # Test 2: C major scale
    print("\nTest 2: C major scale")
    scale_notes = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]
    scale_audio = []
    for note in scale_notes:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 0.5)  # 500ms per note
        scale_audio.append(note_audio)
        # Add 100ms gap
        gap = np.zeros(int(0.1 * 44100))
        scale_audio.append(gap)

    audio = np.concatenate(scale_audio)
    save_wav("test_c_major_scale.wav", audio)

    # Test 3: Chromatic sequence
    print("\nTest 3: Chromatic sequence (C4-C5)")
    chromatic = ["C4", "C#4", "D4", "D#4", "E4", "F4", "F#4", "G4", "G#4", "A4", "A#4", "B4", "C5"]
    chromatic_audio = []
    for note in chromatic:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 0.4)
        chromatic_audio.append(note_audio)
        gap = np.zeros(int(0.05 * 44100))
        chromatic_audio.append(gap)

    audio = np.concatenate(chromatic_audio)
    save_wav("test_chromatic.wav", audio)

    # Test 4: Octave test (same note, different octaves)
    print("\nTest 4: Octave test (C3-C4-C5)")
    octave_notes = ["C3", "C4", "C5"]
    octave_audio = []
    for note in octave_notes:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 1.0)
        octave_audio.append(note_audio)
        gap = np.zeros(int(0.2 * 44100))
        octave_audio.append(gap)

    audio = np.concatenate(octave_audio)
    save_wav("test_octaves_c.wav", audio)

    # Test 5: Very short notes (staccato)
    print("\nTest 5: Staccato notes")
    staccato_notes = ["C4", "E4", "G4", "C5"]
    staccato_audio = []
    for note in staccato_notes:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 0.15)  # Very short
        staccato_audio.append(note_audio)
        gap = np.zeros(int(0.2 * 44100))
        staccato_audio.append(gap)

    audio = np.concatenate(staccato_audio)
    save_wav("test_staccato.wav", audio)

    # Test 6: Low notes (bass)
    print("\nTest 6: Low notes (A1-A2)")
    low_notes = ["A1", "C2", "E2", "A2"]
    low_audio = []
    for note in low_notes:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 1.0)
        low_audio.append(note_audio)
        gap = np.zeros(int(0.2 * 44100))
        low_audio.append(gap)

    audio = np.concatenate(low_audio)
    save_wav("test_low_notes.wav", audio)

    # Test 7: High notes (treble)
    print("\nTest 7: High notes (C6-C7)")
    high_notes = ["C6", "E6", "G6", "C7"]
    high_audio = []
    for note in high_notes:
        freq = get_note_frequency(note)
        note_audio = generate_piano_note(freq, 0.8)
        high_audio.append(note_audio)
        gap = np.zeros(int(0.2 * 44100))
        high_audio.append(gap)

    audio = np.concatenate(high_audio)
    save_wav("test_high_notes.wav", audio)

    print("\n✅ All test files generated!")
    print("\nTest with:")
    print("  python3 test_detection_headless.py test_c4_sustained.wav C4")
    print("  python3 test_detection_headless.py test_c_major_scale.wav \"C4 D4 E4 F4 G4 A4 B4 C5\"")


if __name__ == "__main__":
    main()
