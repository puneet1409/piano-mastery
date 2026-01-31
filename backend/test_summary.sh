#!/bin/bash
echo "======================================================================"
echo "PIANO MASTERY APP - API TEST SUMMARY"
echo "======================================================================"
echo ""
echo "1. Backend Health Check:"
curl -s http://localhost:8000/health | python3 -m json.tool
echo ""
echo ""
echo "2. Frontend Status:"
curl -s http://localhost:3000 | grep -o '<title>[^<]*</title>'
echo ""
echo ""
echo "3. API Documentation:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:8000/docs
echo ""
echo "4. Data Files:"
[ -f data/skill_graph.json ] && echo "✅ skill_graph.json exists" || echo "❌ skill_graph.json missing"
[ -f data/drill_playbook.json ] && echo "✅ drill_playbook.json exists" || echo "❌ drill_playbook.json missing"
echo ""
echo "5. Running WebSocket Test..."
python3 tests/websocket_basic_test.py 2>&1 | grep "✅" | head -5
echo ""
echo "6. Running Agent Decision Test..."
python3 tests/agent_decision_test.py 2>&1 | grep -E "✅|Tier" | head -5
echo ""
echo "======================================================================"
echo "For complete E2E test, run: python3 tests/e2e_full_test.py"
echo "======================================================================"
