import pytest
from unittest.mock import Mock, patch, MagicMock
from app.agents.claude_client import get_agent_decision
from app.agents.prompts import DecisionContext

def test_get_agent_decision():
    # Mock the Anthropic class and its response
    with patch('app.agents.claude_client.Anthropic') as mock_anthropic_class:
        # Create mock client instance
        mock_client = MagicMock()

        # Create mock response
        mock_response = MagicMock()
        mock_content = MagicMock()
        mock_content.text = '{"tier": 3, "reasoning": "Consistent rushing", "feedback_message": "Try slowing down", "drill_id": "isolate_beat_4"}'
        mock_response.content = [mock_content]

        # Configure mock to return our response
        mock_client.messages.create.return_value = mock_response
        mock_anthropic_class.return_value = mock_client

        # Create test context
        context = DecisionContext(
            student_id="sarah_123",
            goal_skill_id="L3.2",
            current_fluency=40,
            attempt_count=3,
            recent_attempts=[{"timing": [+100], "pitch": [100]}],
            student_tendencies=["rushes_beat_4"],
            pattern_detected="rushing beat 4"
        )

        # Call the function
        decision = get_agent_decision(context)

        # Verify results
        assert decision["tier"] == 3
        assert decision["drill_id"] == "isolate_beat_4"
        assert decision["reasoning"] == "Consistent rushing"
        assert decision["feedback_message"] == "Try slowing down"

        # Verify the API was called
        assert mock_client.messages.create.called
        assert mock_anthropic_class.called
