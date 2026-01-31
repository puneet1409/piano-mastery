#!/bin/bash
# Simple curl-based API tests for Piano Mastery App

echo "====================================="
echo "PIANO MASTERY APP - CURL API TESTS"
echo "====================================="
echo ""

BACKEND="http://localhost:8000"
FRONTEND="http://localhost:3000"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: Backend Health Check
echo -e "${BLUE}TEST 1: Backend Health Check${NC}"
echo "GET $BACKEND/health"
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BACKEND/health")
http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d':' -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - Status: $http_code"
    echo "Response: $body"
else
    echo -e "${RED}❌ FAILED${NC} - Status: $http_code"
    echo "Response: $body"
fi
echo ""

# Test 2: API Documentation
echo -e "${BLUE}TEST 2: API Documentation${NC}"
echo "GET $BACKEND/docs"
http_code=$(curl -s -o /dev/null -w "%{http_code}" "$BACKEND/docs")

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✅ PASSED${NC} - Status: $http_code"
    echo "API docs accessible"
else
    echo -e "${RED}❌ FAILED${NC} - Status: $http_code"
fi
echo ""

# Test 3: Frontend Homepage
echo -e "${BLUE}TEST 3: Frontend Homepage${NC}"
echo "GET $FRONTEND"
response=$(curl -s "$FRONTEND")
http_code=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND")

if [ "$http_code" = "200" ] && echo "$response" | grep -q "Piano Mastery"; then
    echo -e "${GREEN}✅ PASSED${NC} - Status: $http_code"
    echo "Title: $(echo "$response" | grep -o '<title>[^<]*</title>' | sed 's/<[^>]*>//g')"
else
    echo -e "${RED}❌ FAILED${NC} - Status: $http_code"
fi
echo ""

# Test 4: Check if data files exist
echo -e "${BLUE}TEST 4: Backend Data Files${NC}"
echo "Checking skill_graph.json and drill_playbook.json..."

skill_graph_exists=false
drill_playbook_exists=false

if [ -f "../data/skill_graph.json" ]; then
    skill_count=$(grep -o '"skill_id"' "../data/skill_graph.json" | wc -l)
    echo -e "${GREEN}✅ skill_graph.json found${NC} - $skill_count skills"
    skill_graph_exists=true
else
    echo -e "${RED}❌ skill_graph.json not found${NC}"
fi

if [ -f "../data/drill_playbook.json" ]; then
    drill_count=$(grep -o '"name"' "../data/drill_playbook.json" | wc -l)
    echo -e "${GREEN}✅ drill_playbook.json found${NC} - $drill_count drills"
    drill_playbook_exists=true
else
    echo -e "${RED}❌ drill_playbook.json not found${NC}"
fi
echo ""

# Test 5: WebSocket endpoint (basic connection test)
echo -e "${BLUE}TEST 5: WebSocket Endpoint${NC}"
echo "Note: Full WebSocket testing requires Python script (e2e_test.py)"
echo "WebSocket URL: ws://localhost:8000/ws/{session_id}"
echo "Run: python3 tests/e2e_test.py for complete WebSocket tests"
echo ""

# Summary
echo "====================================="
echo "TEST SUMMARY"
echo "====================================="
total_tests=4
passed_tests=0

[ "$http_code" = "200" ] && ((passed_tests++))
[ "$skill_graph_exists" = true ] && ((passed_tests++))
[ "$drill_playbook_exists" = true ] && ((passed_tests++))

echo "Passed: $passed_tests/$total_tests"
echo ""
echo "For complete end-to-end testing with WebSocket simulation:"
echo "  python3 tests/e2e_test.py"
echo "====================================="
