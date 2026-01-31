import pytest
from app.agents.templates import create_context_md, create_session_md

def test_create_context_md():
    context = create_context_md(
        student_id="sarah_123",
        tendencies=["rushes_beat_4", "visual_learner"],
        active_skills=["L3.1", "L3.2"],
        fluency_scores={"L3.1": 75, "L3.2": 40}
    )

    assert "STUDENT_ID: sarah_123" in context
    assert "rushes_beat_4" in context
    assert "L3.1: 75 (PROFICIENT)" in context
    assert "L3.2: 40 (LEARNING)" in context

def test_create_session_md():
    session = create_session_md(
        session_id="session_456",
        goal_skill="L3.2",
        start_time="2026-01-24T10:00:00Z"
    )

    assert "SESSION_ID: session_456" in session
    assert "GOAL: Master L3.2" in session
    assert "2026-01-24T10:00:00Z" in session
