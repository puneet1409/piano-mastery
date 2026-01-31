"""
Practice session manager for agent-driven piano learning.

This module maintains session state, tracks student attempts, detects patterns,
and coordinates with the Claude agent to make pedagogical decisions.
"""

from typing import Dict, List, Optional
from datetime import datetime
from app.agents.prompts import DecisionContext
from app.agents.claude_client import get_agent_decision_async
from app.tools.drill_generator import generate_drill, validate_drill_success


class PracticeSession:
    """Manages state for a single practice session."""

    def __init__(self, session_id: str, student_id: str, goal_skill_id: str):
        self.session_id = session_id
        self.student_id = student_id
        self.goal_skill_id = goal_skill_id
        self.attempt_count = 0
        self.recent_attempts: List[Dict] = []
        self.current_drill: Optional[Dict] = None
        self.student_tendencies: List[str] = []
        self.current_fluency = 40  # TODO: Load from database
        self.drill_attempts: List[Dict] = []  # Attempts during drill practice

    async def process_attempt(self, audio_analysis: Dict) -> Dict:
        """
        Process student attempt and get agent decision.

        Args:
            audio_analysis: Dict with keys like 'notes_detected', 'timing', 'success'

        Returns:
            Dict containing agent decision with tier, message, and optional drill
        """
        self.attempt_count += 1
        self.recent_attempts.append(audio_analysis)

        # Keep last 5 attempts for pattern detection
        if len(self.recent_attempts) > 5:
            self.recent_attempts = self.recent_attempts[-5:]

        # If in drill mode, track drill attempts separately
        if self.current_drill:
            self.drill_attempts.append(audio_analysis)

            # Check if drill is complete
            drill_complete, message = validate_drill_success(
                self.current_drill,
                self.drill_attempts
            )

            if drill_complete:
                # Exit drill mode
                drill_info = self.current_drill
                self.current_drill = None
                self.drill_attempts = []

                return {
                    "tier": 3,
                    "type": "drill_complete",
                    "message": f"Great job! You've completed the {drill_info['name']} drill. Back to regular practice.",
                    "reasoning": "Drill success criteria met"
                }

        # Detect patterns from recent attempts
        pattern = self._detect_pattern()

        # Update student tendencies if pattern is detected
        if pattern and pattern != "No clear pattern" and pattern != "Insufficient data":
            if pattern not in self.student_tendencies:
                self.student_tendencies.append(pattern)

        # Build context for agent
        context = DecisionContext(
            student_id=self.student_id,
            goal_skill_id=self.goal_skill_id,
            current_fluency=self.current_fluency,
            attempt_count=self.attempt_count,
            recent_attempts=self.recent_attempts,
            student_tendencies=self.student_tendencies,
            pattern_detected=pattern
        )

        # Get agent decision from Claude
        decision = await get_agent_decision_async(context)

        # If Tier 3 intervention, generate drill
        if decision["tier"] == 3 and decision.get("drill_id"):
            try:
                self.current_drill = generate_drill(
                    decision["drill_id"],
                    decision.get("drill_parameters", {})
                )
                self.drill_attempts = []  # Reset drill attempt tracking

                # Add drill to decision response
                decision["drill"] = self.current_drill
                decision["type"] = "drill_start"

            except ValueError as e:
                # Drill generation failed, fallback to Tier 2
                print(f"Failed to generate drill: {e}")
                decision["tier"] = 2
                decision["message"] = decision.get("feedback_message", "Keep practicing!")

        return decision

    def _detect_pattern(self) -> str:
        """
        Detect common error patterns from recent attempts.

        Returns:
            String description of detected pattern or "No clear pattern"
        """
        if len(self.recent_attempts) < 2:
            return "Insufficient data"

        # Analyze last 3 attempts for consistent issues
        recent_three = self.recent_attempts[-3:]

        # Check for consistent timing issues on specific beats
        timing_issues = []
        for attempt in recent_three:
            timing = attempt.get("timing", [])
            if len(timing) >= 4:
                # Check each beat for deviation (>80ms is considered late/early)
                for beat_idx, deviation in enumerate(timing[:4], 1):
                    if abs(deviation) > 80:
                        timing_issues.append((beat_idx, deviation))

        # If same beat has issues in all 3 attempts, that's a pattern
        if len(timing_issues) >= 3:
            # Count issues per beat
            beat_counts = {}
            for beat, deviation in timing_issues:
                if beat not in beat_counts:
                    beat_counts[beat] = {"count": 0, "deviations": []}
                beat_counts[beat]["count"] += 1
                beat_counts[beat]["deviations"].append(deviation)

            # Find beat with most consistent issues
            for beat, data in beat_counts.items():
                if data["count"] >= 2:  # Issue in at least 2 of last 3 attempts
                    avg_deviation = sum(data["deviations"]) / len(data["deviations"])
                    if avg_deviation > 80:
                        return f"rushing beat {beat} consistently"
                    elif avg_deviation < -80:
                        return f"dragging beat {beat} consistently"

        # Check for pitch accuracy issues
        pitch_errors = 0
        for attempt in recent_three:
            if not attempt.get("success", False) and attempt.get("notes_detected"):
                pitch_errors += 1

        if pitch_errors >= 2:
            return "inconsistent pitch accuracy"

        # Check for general timing inconsistency
        all_timings = [attempt.get("timing", []) for attempt in recent_three]
        if all(len(t) >= 4 for t in all_timings):
            # Calculate variance in timing across attempts
            variances = []
            for beat_idx in range(4):
                beat_values = [timing[beat_idx] for timing in all_timings]
                mean = sum(beat_values) / len(beat_values)
                variance = sum((x - mean) ** 2 for x in beat_values) / len(beat_values)
                variances.append(variance)

            avg_variance = sum(variances) / len(variances)
            if avg_variance > 1000:  # High variance indicates inconsistency
                return "inconsistent timing across attempts"

        return "No clear pattern"

    def get_session_summary(self) -> Dict:
        """Get summary of current session state."""
        return {
            "session_id": self.session_id,
            "student_id": self.student_id,
            "goal_skill_id": self.goal_skill_id,
            "attempt_count": self.attempt_count,
            "student_tendencies": self.student_tendencies,
            "current_fluency": self.current_fluency,
            "in_drill_mode": self.current_drill is not None,
            "current_drill": self.current_drill
        }


# Global session store (in production, use Redis or database)
active_sessions: Dict[str, PracticeSession] = {}


def get_session(session_id: str) -> Optional[PracticeSession]:
    """Get existing practice session by ID."""
    return active_sessions.get(session_id)


def create_session(session_id: str, student_id: str, goal_skill_id: str) -> PracticeSession:
    """Create a new practice session."""
    session = PracticeSession(session_id, student_id, goal_skill_id)
    active_sessions[session_id] = session
    return session


def end_session(session_id: str) -> None:
    """End and remove a practice session."""
    if session_id in active_sessions:
        del active_sessions[session_id]
