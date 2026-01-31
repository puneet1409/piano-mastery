"""
File-based state templates for agent-native architecture.

These templates generate markdown files that serve as the interface between
the application and AI agents. The files are both human and machine readable,
allowing agents to understand context and make decisions.
"""

from typing import List, Dict, Optional
from datetime import datetime


def _get_mastery_label(fluency: int) -> str:
    """Convert fluency score to mastery label."""
    if fluency == 0:
        return "NOT_STARTED"
    elif fluency < 50:
        return "LEARNING"
    elif fluency < 80:
        return "PROFICIENT"
    else:
        return "MASTERED"


def create_context_md(
    student_id: str,
    tendencies: List[str],
    active_skills: List[str],
    fluency_scores: Dict[str, int],
    interests: Optional[List[str]] = None,
    practice_history: Optional[Dict] = None
) -> str:
    """
    Generate context.md file content for agent consumption.

    Args:
        student_id: Unique student identifier
        tendencies: List of observed learning tendencies (e.g., "rushes_beat_4")
        active_skills: List of skill IDs currently being practiced
        fluency_scores: Dict mapping skill_id -> fluency (0-100)
        interests: Optional list of student interests
        practice_history: Optional dict with practice stats

    Returns:
        Markdown string ready to be written to context.md
    """
    lines = [
        "# Student Context",
        "",
        f"STUDENT_ID: {student_id}",
        "",
        "## Learning Tendencies",
        ""
    ]

    for tendency in tendencies:
        lines.append(f"- {tendency}")

    lines.extend([
        "",
        "## Active Skills",
        ""
    ])

    for skill_id in active_skills:
        fluency = fluency_scores.get(skill_id, 0)
        mastery = _get_mastery_label(fluency)
        lines.append(f"- {skill_id}: {fluency} ({mastery})")

    if interests:
        lines.extend([
            "",
            "## Interests",
            ""
        ])
        for interest in interests:
            lines.append(f"- {interest}")

    if practice_history:
        lines.extend([
            "",
            "## Recent Practice",
            ""
        ])
        for key, value in practice_history.items():
            lines.append(f"- {key}: {value}")

    lines.append("")  # Trailing newline
    return "\n".join(lines)


def create_session_md(
    session_id: str,
    goal_skill: str,
    start_time: str,
    student_id: Optional[str] = None,
    initial_fluency: Optional[int] = None
) -> str:
    """
    Generate current_session.md file content for practice tracking.

    Args:
        session_id: Unique session identifier
        goal_skill: Target skill ID for this session
        start_time: ISO 8601 timestamp when session started
        student_id: Optional student identifier
        initial_fluency: Optional starting fluency score

    Returns:
        Markdown string ready to be written to current_session.md
    """
    lines = [
        "# Current Practice Session",
        "",
        f"SESSION_ID: {session_id}",
        f"GOAL: Master {goal_skill}",
        f"STARTED: {start_time}",
    ]

    if student_id:
        lines.insert(3, f"STUDENT: {student_id}")

    if initial_fluency is not None:
        mastery = _get_mastery_label(initial_fluency)
        lines.append(f"INITIAL_FLUENCY: {initial_fluency} ({mastery})")

    lines.extend([
        "",
        "## Practice Attempts",
        "",
        "_No attempts yet_",
        ""
    ])

    return "\n".join(lines)


def update_session_md(
    current_content: str,
    attempt_number: int,
    result: str,
    timestamp: str,
    notes: Optional[str] = None
) -> str:
    """
    Update current_session.md with a new practice attempt.

    Args:
        current_content: Existing session markdown content
        attempt_number: Sequential attempt number (1, 2, 3...)
        result: Result of the attempt (e.g., "SUCCESS", "NEEDS_WORK", "AGENT_INTERVENED")
        timestamp: ISO 8601 timestamp of the attempt
        notes: Optional notes about the attempt

    Returns:
        Updated markdown string
    """
    lines = current_content.split("\n")

    # Find the "Practice Attempts" section
    attempts_index = -1
    for i, line in enumerate(lines):
        if line == "## Practice Attempts":
            attempts_index = i
            break

    if attempts_index == -1:
        # Section doesn't exist, add it
        lines.extend([
            "",
            "## Practice Attempts",
            ""
        ])
        attempts_index = len(lines) - 1

    # Remove "_No attempts yet_" placeholder if it exists
    filtered_lines = []
    for line in lines:
        if line.strip() != "_No attempts yet_":
            filtered_lines.append(line)
    lines = filtered_lines

    # Add the new attempt after the header
    attempt_lines = [
        "",
        f"### Attempt {attempt_number} - {timestamp}",
        f"**Result:** {result}"
    ]

    if notes:
        attempt_lines.append(f"**Notes:** {notes}")

    # Find where to insert (after "## Practice Attempts" and any existing attempts)
    insert_index = attempts_index + 1

    # Skip to end of existing attempts
    while insert_index < len(lines) and lines[insert_index].strip():
        insert_index += 1
        # Skip entire attempt blocks
        while insert_index < len(lines) and (lines[insert_index].startswith("###") or lines[insert_index].startswith("**") or lines[insert_index].strip()):
            insert_index += 1

    # Insert the new attempt
    for i, attempt_line in enumerate(attempt_lines):
        lines.insert(insert_index + i, attempt_line)

    # Ensure trailing newline
    if lines[-1] != "":
        lines.append("")

    return "\n".join(lines)
