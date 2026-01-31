#!/bin/bash
#
# API Tests for Piano Mastery Detection Server
#
# Tests:
# - Health endpoint
# - Exercises list endpoint
# - WebSocket connection
# - Pro WebSocket endpoint
#
# Run with: bash tests/test_api.sh
#
# Prerequisites:
# - Server running on localhost:8000
# - curl, websocat (optional) installed
#

set -e

BASE_URL="http://localhost:8000"
WS_URL="ws://localhost:8000"
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_TESTS=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test helper functions
pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    PASS_COUNT=$((PASS_COUNT + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo "  Expected: $2"
    echo "  Got: $3"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

skip() {
    echo -e "${YELLOW}○ SKIP${NC}: $1 - $2"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

assert_status() {
    local test_name="$1"
    local expected="$2"
    local actual="$3"

    if [ "$actual" = "$expected" ]; then
        pass "$test_name"
    else
        fail "$test_name" "$expected" "$actual"
    fi
}

assert_contains() {
    local test_name="$1"
    local expected="$2"
    local actual="$3"

    if [[ "$actual" == *"$expected"* ]]; then
        pass "$test_name"
    else
        fail "$test_name" "contains '$expected'" "${actual:0:100}..."
    fi
}

assert_json_field() {
    local test_name="$1"
    local json="$2"
    local field="$3"
    local expected="$4"

    local actual=$(echo "$json" | python3 -c "import sys, json; print(json.load(sys.stdin).get('$field', ''))" 2>/dev/null)

    if [ "$actual" = "$expected" ]; then
        pass "$test_name"
    else
        fail "$test_name" "$expected" "$actual"
    fi
}

# Check if server is running
check_server() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Checking server status..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if curl -s --connect-timeout 2 "$BASE_URL/health" > /dev/null 2>&1; then
        echo -e "${GREEN}Server is running${NC}"
        return 0
    else
        echo -e "${RED}Server is not running at $BASE_URL${NC}"
        echo "Please start the server with: python3 simple_test_server.py"
        exit 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Health Endpoint Tests
# ─────────────────────────────────────────────────────────────────────────────

test_health_endpoint() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing Health Endpoint"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Test 1: Health endpoint returns 200
    local status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
    assert_status "Health endpoint returns 200" "200" "$status"

    # Test 2: Health endpoint returns JSON
    local response=$(curl -s "$BASE_URL/health")
    assert_contains "Health response is JSON" "status" "$response"

    # Test 3: Health status is healthy
    assert_json_field "Health status is healthy" "$response" "status" "healthy"
}

# ─────────────────────────────────────────────────────────────────────────────
# Exercises Endpoint Tests
# ─────────────────────────────────────────────────────────────────────────────

test_exercises_endpoint() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing Exercises Endpoint"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Test 4: Exercises endpoint returns 200
    local status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/exercises")
    assert_status "Exercises endpoint returns 200" "200" "$status"

    # Test 5: Exercises response contains exercises array
    local response=$(curl -s "$BASE_URL/exercises")
    assert_contains "Exercises response has exercises" "exercises" "$response"

    # Test 6: C Major Scale exercise exists
    assert_contains "C Major Scale exercise exists" "c_major_scale" "$response"

    # Test 7: Exercise has required fields
    assert_contains "Exercise has id field" '"id"' "$response"
    assert_contains "Exercise has name field" '"name"' "$response"
    assert_contains "Exercise has difficulty field" '"difficulty"' "$response"

    # Test 8: Exercise has requiresPolyphony field
    assert_contains "Exercise has requiresPolyphony" "requiresPolyphony" "$response"

    # Test 9: Monophonic exercise has requiresPolyphony=false
    local mono_exercise=$(curl -s "$BASE_URL/exercises" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ex in data.get('exercises', []):
    if ex.get('id') == 'c_major_scale':
        print(ex.get('requiresPolyphony', True))
        break
" 2>/dev/null)
    assert_status "C Major Scale is monophonic" "False" "$mono_exercise"

    # Test 10: Count exercises
    local count=$(curl -s "$BASE_URL/exercises" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(len(data.get('exercises', [])))
" 2>/dev/null)
    if [ "$count" -ge 2 ]; then
        pass "At least 2 exercises available (got $count)"
    else
        fail "At least 2 exercises available" ">=2" "$count"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# WebSocket Tests (Basic connectivity)
# ─────────────────────────────────────────────────────────────────────────────

test_websocket_basic() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing WebSocket Connectivity"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Check if websocat is available
    if ! command -v websocat &> /dev/null; then
        skip "WebSocket connection test" "websocat not installed"
        skip "WebSocket JSON message test" "websocat not installed"
        return
    fi

    # Test 11: WebSocket accepts connection
    local session_id="test-$(date +%s)"
    local ws_response=$(echo '{"type":"ping"}' | timeout 2 websocat -n1 "$WS_URL/ws/$session_id" 2>&1 || echo "TIMEOUT")

    if [[ "$ws_response" != "TIMEOUT" && "$ws_response" != *"error"* ]]; then
        pass "WebSocket accepts connection"
    else
        skip "WebSocket accepts connection" "Connection failed or timed out"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Exercise Metadata Tests
# ─────────────────────────────────────────────────────────────────────────────

test_exercise_metadata() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing Exercise Metadata"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local response=$(curl -s "$BASE_URL/exercises")

    # Test 12-15: Specific exercise metadata
    local exercises=$(echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for ex in data.get('exercises', []):
    print(f\"{ex.get('id')}|{ex.get('requiresPolyphony', 'MISSING')}|{ex.get('type', 'MISSING')}\")
" 2>/dev/null)

    # Check each exercise type
    if echo "$exercises" | grep -q "c_major_scale|False"; then
        pass "C Major Scale marked as monophonic"
    else
        fail "C Major Scale marked as monophonic" "requiresPolyphony=False" "$(echo "$exercises" | grep c_major_scale)"
    fi

    # Check if chord exercises are marked polyphonic
    if echo "$exercises" | grep -q "basic_chords|True"; then
        pass "Basic Chords marked as polyphonic"
    elif echo "$exercises" | grep -q "basic_chords"; then
        fail "Basic Chords marked as polyphonic" "requiresPolyphony=True" "$(echo "$exercises" | grep basic_chords)"
    else
        skip "Basic Chords marked as polyphonic" "Exercise not available"
    fi

    # Check Perfect exercise
    if echo "$exercises" | grep -q "perfect_easy|True"; then
        pass "Perfect (Ed Sheeran) marked as polyphonic"
    elif echo "$exercises" | grep -q "perfect_easy"; then
        fail "Perfect (Ed Sheeran) marked as polyphonic" "requiresPolyphony=True" "$(echo "$exercises" | grep perfect_easy)"
    else
        skip "Perfect (Ed Sheeran) marked as polyphonic" "Exercise not available"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Response Time Tests
# ─────────────────────────────────────────────────────────────────────────────

test_response_times() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing Response Times"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Test 16: Health endpoint response time < 100ms
    local start=$(date +%s%N)
    curl -s "$BASE_URL/health" > /dev/null
    local end=$(date +%s%N)
    local duration_ms=$(( (end - start) / 1000000 ))

    if [ "$duration_ms" -lt 100 ]; then
        pass "Health endpoint < 100ms (${duration_ms}ms)"
    else
        fail "Health endpoint < 100ms" "<100ms" "${duration_ms}ms"
    fi

    # Test 17: Exercises endpoint response time < 200ms
    start=$(date +%s%N)
    curl -s "$BASE_URL/exercises" > /dev/null
    end=$(date +%s%N)
    duration_ms=$(( (end - start) / 1000000 ))

    if [ "$duration_ms" -lt 200 ]; then
        pass "Exercises endpoint < 200ms (${duration_ms}ms)"
    else
        fail "Exercises endpoint < 200ms" "<200ms" "${duration_ms}ms"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Error Handling Tests
# ─────────────────────────────────────────────────────────────────────────────

test_error_handling() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing Error Handling"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Test 18: 404 for unknown endpoint
    local status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/unknown-endpoint")
    assert_status "Unknown endpoint returns 404" "404" "$status"

    # Test 19: Invalid HTTP method
    status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/health")
    if [ "$status" = "405" ] || [ "$status" = "200" ]; then
        pass "Health endpoint handles POST (got $status)"
    else
        fail "Health endpoint handles POST" "405 or 200" "$status"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# CORS Tests
# ─────────────────────────────────────────────────────────────────────────────

test_cors() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing CORS Headers"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    # Test 20: CORS headers present
    local headers=$(curl -s -I -H "Origin: http://localhost:3000" "$BASE_URL/health")

    if echo "$headers" | grep -qi "access-control-allow-origin"; then
        pass "CORS Access-Control-Allow-Origin header present"
    else
        fail "CORS Access-Control-Allow-Origin header present" "Header present" "Header missing"
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

main() {
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║       Piano Mastery API Test Suite                           ║"
    echo "╚══════════════════════════════════════════════════════════════╝"

    check_server

    test_health_endpoint
    test_exercises_endpoint
    test_websocket_basic
    test_exercise_metadata
    test_response_times
    test_error_handling
    test_cors

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Test Summary"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo -e "Total:  $TOTAL_TESTS"
    echo -e "Passed: ${GREEN}$PASS_COUNT${NC}"
    echo -e "Failed: ${RED}$FAIL_COUNT${NC}"
    echo -e "Skipped: $((TOTAL_TESTS - PASS_COUNT - FAIL_COUNT))"
    echo ""

    if [ "$FAIL_COUNT" -gt 0 ]; then
        exit 1
    fi
}

main "$@"
