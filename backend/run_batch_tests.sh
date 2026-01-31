#!/bin/bash
# Batch testing script for pitch detection algorithm
# Runs multiple test cases and summarizes results

echo "================================"
echo "PIANO PITCH DETECTION BATCH TEST"
echo "================================"
echo ""

# Generate test audio files if they don't exist
if [ ! -f "test_c4_sustained.wav" ]; then
    echo "📁 Generating test audio files..."
    python3 generate_test_audio.py
    echo ""
fi

# Test counter
total_tests=0
passed_tests=0

echo "🧪 Running algorithm tests..."
echo ""

# Function to run a test and check result
run_test() {
    local file=$1
    local expected=$2
    local test_name=$3

    total_tests=$((total_tests + 1))

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "TEST #$total_tests: $test_name"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Run the test and capture output
    output=$(python3 test_detection_headless.py "$file" "$expected" 2>&1)
    exit_code=$?

    echo "$output"

    # Check if test passed (F1 >= 0.8 or "EXCELLENT/GOOD" in output)
    if echo "$output" | grep -q "EXCELLENT\|GOOD"; then
        passed_tests=$((passed_tests + 1))
        echo "✅ TEST PASSED"
    else
        echo "❌ TEST FAILED"
    fi

    echo ""
}

# Run tests
run_test "test_c4_sustained.wav" "C4" "Single sustained middle C"
run_test "test_c_major_scale.wav" "C4 D4 E4 F4 G4 A4 B4 C5" "C major scale"
run_test "test_chromatic.wav" "C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4 C5" "Chromatic sequence"
run_test "test_octaves_c.wav" "C3 C4 C5" "Octave test (C3-C4-C5)"
run_test "test_staccato.wav" "C4 E4 G4 C5" "Staccato notes"
run_test "test_low_notes.wav" "A1 C2 E2 A2" "Low notes (bass)"
run_test "test_high_notes.wav" "C6 E6 G6 C7" "High notes (treble)"

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "BATCH TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total tests: $total_tests"
echo "Passed: $passed_tests"
echo "Failed: $((total_tests - passed_tests))"
echo "Success rate: $(awk "BEGIN {printf \"%.1f\", ($passed_tests / $total_tests) * 100}")%"
echo ""

if [ $passed_tests -eq $total_tests ]; then
    echo "✅ ALL TESTS PASSED!"
    exit 0
else
    echo "⚠️  SOME TESTS FAILED"
    exit 1
fi
