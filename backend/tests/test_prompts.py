import pytest
from app.agents.prompts import generate_agent_prompt, DecisionContext

def test_generate_agent_prompt():
    context = DecisionContext(
        student_id="sarah_123",
        goal_skill_id="L3.2",
        current_fluency=40,
        attempt_count=3,
        recent_attempts=[
            {"timing": [+5, +15, +95, +110], "pitch": [100, 100, 100, 100]},
            {"timing": [+10, +20, +100, +105], "pitch": [100, 100, 100, 100]},
            {"timing": [+8, +18, +92, +108], "pitch": [100, 100, 100, 100]},
        ],
        student_tendencies=["rushes_beat_4"],
        pattern_detected="rushing beats 3-4"
    )

    prompt = generate_agent_prompt(context)

    assert "sarah_123" in prompt
    assert "L3.2" in prompt
    assert "rushing beats 3-4" in prompt
    assert "DECISION NEEDED" in prompt
