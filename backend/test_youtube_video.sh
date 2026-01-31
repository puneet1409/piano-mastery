#!/bin/bash
# Download YouTube video audio and test with pitch detection
# Usage: bash test_youtube_video.sh <youtube_url> [expected_notes]

if [ -z "$1" ]; then
    echo "Usage: bash test_youtube_video.sh <youtube_url> [expected_notes]"
    echo ""
    echo "Examples:"
    echo "  bash test_youtube_video.sh 'https://youtube.com/watch?v=...' 'C4'"
    echo "  bash test_youtube_video.sh 'https://youtube.com/watch?v=...' 'C4 D4 E4 F4 G4'"
    echo ""
    echo "Good test videos to search for on YouTube:"
    echo "  - 'piano middle C note'"
    echo "  - 'piano C major scale'"
    echo "  - 'piano single note test'"
    exit 1
fi

URL=$1
EXPECTED=${2:-""}

echo "🎬 Downloading audio from YouTube..."
echo "URL: $URL"
echo ""

# Download audio as WAV
OUTPUT_FILE="youtube_test_$(date +%s).wav"

yt-dlp -x --audio-format wav --audio-quality 0 -o "$OUTPUT_FILE" "$URL"

if [ $? -ne 0 ]; then
    echo "❌ Download failed!"
    exit 1
fi

echo ""
echo "✅ Download complete: $OUTPUT_FILE"
echo ""

# Get file info
file "$OUTPUT_FILE"
echo ""

# Run detection test
if [ -n "$EXPECTED" ]; then
    echo "🧪 Testing with expected notes: $EXPECTED"
    python3 test_detection_headless.py "$OUTPUT_FILE" "$EXPECTED"
else
    echo "🧪 Testing without expected notes (showing raw detections)"
    python3 test_detection_headless.py "$OUTPUT_FILE"
fi

echo ""
echo "💾 Audio saved as: $OUTPUT_FILE"
echo "   (You can test again with: python3 test_detection_headless.py $OUTPUT_FILE)"
