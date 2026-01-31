-- Students table
CREATE TABLE students (
    student_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Skill progress table
CREATE TABLE skill_progress (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(student_id),
    skill_id VARCHAR(50) NOT NULL,
    fluency INTEGER DEFAULT 0 CHECK (fluency >= 0 AND fluency <= 100),
    mastery_status VARCHAR(20) CHECK (mastery_status IN ('NOT_STARTED', 'PROFICIENT', 'MASTERED')),
    last_practiced TIMESTAMPTZ,
    total_practice_time_minutes INTEGER DEFAULT 0,
    UNIQUE(student_id, skill_id)
);

-- Practice sessions table
CREATE TABLE practice_sessions (
    session_id VARCHAR(100) PRIMARY KEY,
    student_id INTEGER REFERENCES students(student_id),
    goal_skill_id VARCHAR(50) NOT NULL,
    start_time TIMESTAMPTZ DEFAULT NOW(),
    end_time TIMESTAMPTZ,
    total_attempts INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))
);

-- Attempt logs table
CREATE TABLE attempt_logs (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(100) REFERENCES practice_sessions(session_id),
    attempt_number INTEGER NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    audio_analysis JSONB,
    agent_decision JSONB,
    tier INTEGER CHECK (tier IN (1, 2, 3))
);

-- Agent observations table
CREATE TABLE agent_observations (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(student_id),
    observation_type VARCHAR(50),
    observation_text TEXT NOT NULL,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    skill_id VARCHAR(50)
);

-- Indexes
CREATE INDEX idx_skill_progress_student ON skill_progress(student_id);
CREATE INDEX idx_sessions_student ON practice_sessions(student_id);
CREATE INDEX idx_attempts_session ON attempt_logs(session_id);
CREATE INDEX idx_observations_student ON agent_observations(student_id);
