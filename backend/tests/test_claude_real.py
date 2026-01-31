"""
Manual test for real Claude API integration.
Run with: ANTHROPIC_API_KEY=sk-... pytest tests/test_claude_real.py -v -s
"""
import os
import pytest
from app.agents.claude_client import get_agent_decision
from app.agents.prompts import DecisionContext

@pytest.mark.skipif(not os.environ.get("ANTHROPIC_API_KEY"), reason="No API key")
def test_real_claude_decision():
    context = DecisionContext(
        student_id="test_student",
        goal_skill_id="L3.2",
        current_fluency=40,
        attempt_count=3,
        recent_attempts=[
            {"timing": [+5, +15, +95, +110], "pitch": [100, 100, 100, 100]},
            {"timing": [+10, +20, +100, +105], "pitch": [100, 100, 100, 100]},
            {"timing": [+8, +18, +92, +108], "pitch": [100, 100, 100, 100]},
        ],
        student_tendencies=["rushes_beat_4"],
        pattern_detected="rushing beats 3-4 consistently"
    )

    decision = get_agent_decision(context)

    print("\n=== Agent Decision ===")
    print(f"Tier: {decision['tier']}")
    print(f"Reasoning: {decision['reasoning']}")
    if decision.get('feedback_message'):
        print(f"Feedback: {decision['feedback_message']}")
    if decision.get('drill_id'):
        print(f"Drill: {decision['drill_id']}")

    assert decision["tier"] in [1, 2, 3]
    assert len(decision["reasoning"]) > 0
