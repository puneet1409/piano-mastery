#!/bin/bash
# Complete End-to-End HTTP/API Testing with curl

set -e  # Exit on first error

echo "======================================================================"
echo "PIANO MASTERY APP - CURL END-TO-END TEST"
echo "======================================================================"
echo ""

BACKEND="http://localhost:8000"
FRONTEND="http://localhost:3000"
PASS_COUNT=0
FAIL_COUNT=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test function
test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local expected_code="$4"
    local check_pattern="$5"

    echo -e "${BLUE}TEST: $name${NC}"
    echo "  → $method $url"

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$url")
    else
        response=$(curl -s -X "$method" -w "\nHTTP_CODE:%{http_code}" "$url")
    fi

    http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d':' -f2)
    body=$(echo "$response" | sed '/HTTP_CODE/d')

    if [ "$http_code" = "$expected_code" ]; then
        if [ -n "$check_pattern" ]; then
            if echo "$body" | grep -q "$check_pattern"; then
                echo -e "  ${GREEN}✅ PASSED${NC} (Status: $http_code, Pattern found)"
                ((PASS_COUNT++))
            else
                echo -e "  ${RED}❌ FAILED${NC} (Status: $http_code, Pattern not found: $check_pattern)"
                echo "  Response: $body"
                ((FAIL_COUNT++))
            fi
        else
            echo -e "  ${GREEN}✅ PASSED${NC} (Status: $http_code)"
            ((PASS_COUNT++))
        fi
    else
        echo -e "  ${RED}❌ FAILED${NC} (Expected: $expected_code, Got: $http_code)"
        echo "  Response: $body"
        ((FAIL_COUNT++))
    fi
    echo ""
}

echo "======================================================================"
echo "BACKEND API TESTS"
echo "======================================================================"
echo ""

# Test 1: Health Check
test_endpoint \
    "Health Check Endpoint" \
    "GET" \
    "$BACKEND/health" \
    "200" \
    "healthy"

# Test 2: API Documentation
test_endpoint \
    "API Documentation (OpenAPI)" \
    "GET" \
    "$BACKEND/docs" \
    "200" \
    ""

# Test 3: OpenAPI JSON Schema
test_endpoint \
    "OpenAPI Schema" \
    "GET" \
    "$BACKEND/openapi.json" \
    "200" \
    "openapi"

echo "======================================================================"
echo "FRONTEND TESTS"
echo "======================================================================"
echo ""

# Test 4: Frontend Homepage
test_endpoint \
    "Frontend Homepage" \
    "GET" \
    "$FRONTEND" \
    "200" \
    "Piano Mastery"

# Test 5: Next.js API Health (if exists)
test_endpoint \
    "Frontend API Routes" \
    "GET" \
    "$FRONTEND/api/health" \
    "404" \
    ""  # Expected 404 since we don't have this route yet

echo "======================================================================"
echo "DATA FILES VERIFICATION"
echo "======================================================================"
echo ""

# Check backend data files
echo -e "${BLUE}TEST: Backend Data Files${NC}"

if [ -f "../data/skill_graph.json" ]; then
    skill_count=$(grep -o '"skill_id"' "../data/skill_graph.json" | wc -l)
    echo -e "  ${GREEN}✅ skill_graph.json found${NC} - $skill_count skills"
    ((PASS_COUNT++))
else
    echo -e "  ${RED}❌ skill_graph.json not found${NC}"
    ((FAIL_COUNT++))
fi

if [ -f "../data/drill_playbook.json" ]; then
    drill_count=$(grep -o '"name"' "../data/drill_playbook.json" | wc -l)
    echo -e "  ${GREEN}✅ drill_playbook.json found${NC} - ~$drill_count drills"
    ((PASS_COUNT++))
else
    echo -e "  ${RED}❌ drill_playbook.json not found${NC}"
    ((FAIL_COUNT++))
fi

echo ""

echo "======================================================================"
echo "WEBSOCKET CONNECTION TEST"
echo "======================================================================"
echo ""

echo -e "${BLUE}TEST: WebSocket Endpoint${NC}"
echo "  Note: Full WebSocket testing requires Python"
echo "  Running basic WebSocket test..."
echo ""

# Run Python WebSocket test
if python3 tests/websocket_basic_test.py 2>&1 | grep -q "BASIC WEBSOCKET TEST PASSED"; then
    echo -e "  ${GREEN}✅ WebSocket test PASSED${NC}"
    ((PASS_COUNT++))
else
    echo -e "  ${RED}❌ WebSocket test FAILED${NC}"
    ((FAIL_COUNT++))
fi

echo ""

echo "======================================================================"
echo "TEST SUMMARY"
echo "======================================================================"
echo ""

TOTAL=$((PASS_COUNT + FAIL_COUNT))
PASS_RATE=$((PASS_COUNT * 100 / TOTAL))

echo "Total Tests: $TOTAL"
echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"
echo "Pass Rate: $PASS_RATE%"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: python3 tests/e2e_full_test.py"
    echo "  2. Open: http://localhost:3000 in browser"
    echo "======================================================================"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    echo "======================================================================"
    exit 1
fi
