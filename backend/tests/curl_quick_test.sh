#!/bin/bash
# Quick HTTP API validation tests

echo "====================================="
echo "PIANO MASTERY - QUICK HTTP API TESTS"
echo "====================================="
echo ""

BACKEND="http://localhost:8000"
PASS=0
FAIL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test function
test_api() {
    local name="$1"
    local url="$2"
    local expected_pattern="$3"

    echo -e "${BLUE}TEST: $name${NC}"
    response=$(curl -s --max-time 3 "$url")
    http_code=$(curl -s --max-time 3 -o /dev/null -w "%{http_code}" "$url")

    if [ "$http_code" = "200" ]; then
        if [ -n "$expected_pattern" ]; then
            if echo "$response" | grep -q "$expected_pattern"; then
                echo -e "  ${GREEN}✅ PASSED${NC} (Status: $http_code, Pattern found)"
                ((PASS++))
            else
                echo -e "  ${RED}❌ FAILED${NC} (Pattern not found: $expected_pattern)"
                echo "  Response: $response"
                ((FAIL++))
            fi
        else
            echo -e "  ${GREEN}✅ PASSED${NC} (Status: $http_code)"
            ((PASS++))
        fi
    else
        echo -e "  ${RED}❌ FAILED${NC} (Status: $http_code)"
        ((FAIL++))
    fi
    echo ""
}

# Run tests
test_api "Health Check" "$BACKEND/health" "healthy"
test_api "API Documentation" "$BACKEND/docs" ""
test_api "OpenAPI Schema" "$BACKEND/openapi.json" "openapi"

# List Exercises Endpoint
echo -e "${BLUE}TEST: List Exercises${NC}"
exercises_response=$(curl -s --max-time 3 "$BACKEND/exercises")
exercise_count=$(echo "$exercises_response" | grep -o '"id"' | wc -l)

if [ $exercise_count -gt 0 ]; then
    echo -e "  ${GREEN}✅ PASSED${NC} - Found $exercise_count exercises"
    ((PASS++))
else
    echo -e "  ${RED}❌ FAILED${NC} - No exercises found"
    echo "  Response: $exercises_response"
    ((FAIL++))
fi
echo ""

# Summary
echo "====================================="
echo "SUMMARY"
echo "====================================="
TOTAL=$((PASS + FAIL))
echo "Total: $TOTAL"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi
