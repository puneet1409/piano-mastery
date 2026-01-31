from typing import List, Dict
from pydantic import BaseModel

SYSTEM_PROMPT = """You are a piano teacher helping students master "Perfect" by Ed Sheeran.

TEACHING PHILOSOPHY:
- Quality over speed (proper technique, no bad habits)
- Mastery-based progression (don't advance until proficient)
- Real-time intervention (catch mistakes immediately)
- Targeted drilling (isolate problems, don't repeat what works)

INTERVENTION TIERS:
- Tier 1 (Silent): Performance meets thresholds, no intervention needed
- Tier 2 (Gentle): Minor issues, suggest adjustment without stopping
- Tier 3 (Active): Fundamental error pattern, generate targeted drill

YOUR ROLE:
Analyze student attempts and decide:
1. What tier of intervention is appropriate?
2. If Tier 3, what drill should be generated?
3. What feedback should be shown to student?

Always explain your reasoning concisely.
"""

class DecisionContext(BaseModel):
    student_id: str
    goal_skill_id: str
    current_fluency: int
    attempt_count: int
    recent_attempts: List[Dict]
    student_tendencies: List[str]
    pattern_detected: str

def generate_agent_prompt(context: DecisionContext) -> str:
    """Generate complete prompt for agent decision-making."""

    # Format recent attempts
    attempts_text = "\n".join([
        f"  Attempt #{i+1}: Timing {att['timing']}, Pitch {att['pitch']}"
        for i, att in enumerate(context.recent_attempts[-3:])
    ])

    tendencies_text = ", ".join(context.student_tendencies) if context.student_tendencies else "None recorded"

    dynamic_context = f"""
STUDENT: {context.student_id}
GOAL SKILL: {context.goal_skill_id}
CURRENT FLUENCY: {context.current_fluency}/100
ATTEMPT COUNT: {context.attempt_count}

KNOWN TENDENCIES:
- {tendencies_text}

RECENT ATTEMPTS:
{attempts_text}

PATTERN DETECTED: {context.pattern_detected}

DECISION NEEDED: What do you do next?

Respond in JSON format:
{{
  "tier": 1 | 2 | 3,
  "reasoning": "Brief explanation of why this tier",
  "feedback_message": "Message to show student (if tier 2 or 3)",
  "drill_id": "drill template ID (if tier 3)",
  "drill_parameters": {{"param": "value"}} (if tier 3)
}}
"""

    return SYSTEM_PROMPT + "\n" + dynamic_context

def parse_agent_decision(response_text: str) -> Dict:
    """Parse agent's JSON response into structured decision."""
    import json

    # Extract JSON from response
    start = response_text.find('{')
    end = response_text.rfind('}') + 1

    if start == -1 or end == 0:
        raise ValueError("No JSON found in agent response")

    json_text = response_text[start:end]
    decision = json.loads(json_text)

    # Validate required fields
    required_fields = ["tier", "reasoning"]
    for field in required_fields:
        if field not in decision:
            raise ValueError(f"Missing required field: {field}")

    return decision
