import psycopg2
from psycopg2.extras import RealDictCursor
import os

def get_db_connection():
    """Get PostgreSQL database connection."""
    return psycopg2.connect(
        os.environ.get("DATABASE_URL"),
        cursor_factory=RealDictCursor
    )

def save_skill_progress(student_id: int, skill_id: str, fluency: int, mastery_status: str):
    """Update skill progress in database."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO skill_progress (student_id, skill_id, fluency, mastery_status, last_practiced)
                VALUES (%s, %s, %s, %s, NOW())
                ON CONFLICT (student_id, skill_id)
                DO UPDATE SET
                    fluency = EXCLUDED.fluency,
                    mastery_status = EXCLUDED.mastery_status,
                    last_practiced = NOW()
            """, (student_id, skill_id, fluency, mastery_status))
            conn.commit()
    finally:
        conn.close()

def get_skill_progress(student_id: int, skill_id: str) -> dict:
    """Get skill progress for student."""
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fluency, mastery_status, last_practiced, total_practice_time_minutes
                FROM skill_progress
                WHERE student_id = %s AND skill_id = %s
            """, (student_id, skill_id))
            return cur.fetchone()
    finally:
        conn.close()

def save_attempt_log(session_id: str, attempt_number: int, audio_analysis: dict, agent_decision: dict):
    """Log attempt and agent decision."""
    import json
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO attempt_logs (session_id, attempt_number, audio_analysis, agent_decision, tier)
                VALUES (%s, %s, %s, %s, %s)
            """, (
                session_id,
                attempt_number,
                json.dumps(audio_analysis),
                json.dumps(agent_decision),
                agent_decision.get("tier")
            ))
            conn.commit()
    finally:
        conn.close()
