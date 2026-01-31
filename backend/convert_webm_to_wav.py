#!/usr/bin/env python3
"""
Convert WebM audio to WAV format without ffmpeg.
Uses pure Python libraries.
"""

import sys
import wave
import struct

try:
    import av
    HAS_AV = True
except ImportError:
    HAS_AV = False
    print("⚠️  PyAV not installed. Trying alternative method...")

def convert_with_pyav(webm_file: str, wav_file: str):
    """Convert using PyAV (requires av package)."""
    container = av.open(webm_file)
    audio_stream = next(s for s in container.streams if s.type == 'audio')

    print(f"   Input: {webm_file}")
    print(f"   Sample rate: {audio_stream.sample_rate} Hz")
    print(f"   Channels: {audio_stream.channels}")
    print(f"   Duration: {container.duration / 1000000:.2f}s")

    # Decode audio frames
    samples = []
    for frame in container.decode(audio=0):
        # Convert to numpy array and extract samples
        arr = frame.to_ndarray()
        if arr.ndim > 1:
            arr = arr.mean(axis=0)  # Convert stereo to mono
        samples.extend(arr.flatten())

    # Write WAV file
    with wave.open(wav_file, 'wb') as wav:
        wav.setnchannels(1)  # Mono
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(audio_stream.sample_rate)

        # Convert to 16-bit PCM
        for sample in samples:
            # Normalize to [-1, 1] then scale to int16
            normalized = max(-1.0, min(1.0, float(sample)))
            pcm = int(normalized * 32767)
            wav.writeframes(struct.pack('<h', pcm))

    print(f"✅ Converted to: {wav_file}")
    return True


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 convert_webm_to_wav.py <input.webm> [output.wav]")
        sys.exit(1)

    webm_file = sys.argv[1]
    wav_file = sys.argv[2] if len(sys.argv) > 2 else webm_file.replace('.webm', '.wav')

    print(f"🔄 Converting WebM to WAV...")

    if HAS_AV:
        try:
            convert_with_pyav(webm_file, wav_file)
        except Exception as e:
            print(f"❌ Conversion failed: {e}")
            print("\nTo install PyAV: pip3 install av --break-system-packages")
            sys.exit(1)
    else:
        print("❌ No audio conversion library available!")
        print("\nPlease install one of:")
        print("  pip3 install av --break-system-packages")
        print("\nOr install ffmpeg:")
        print("  sudo apt-get install ffmpeg")
        sys.exit(1)


if __name__ == "__main__":
    main()
