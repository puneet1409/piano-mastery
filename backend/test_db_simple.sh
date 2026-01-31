#!/bin/bash

# Simple database connection test without Python dependencies

set -e

# Change to backend directory
cd "$(dirname "$0")"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    exit 1
fi

# Load DATABASE_URL from .env
source .env

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set in .env"
    exit 1
fi

echo "🎹 Testing Piano Mastery App Database Connection"
echo "================================================"
echo ""

# Test connection with psql
if command -v psql > /dev/null; then
    echo "Testing connection..."
    echo ""

    # Get PostgreSQL version
    psql "$DATABASE_URL" -c "SELECT version();" --tuples-only --no-align 2>&1 | head -1
    echo ""

    # Check for piano app tables
    echo "Checking for piano app tables:"
    psql "$DATABASE_URL" -t -c "
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('students', 'skill_progress', 'practice_sessions', 'attempt_logs', 'agent_observations')
        ORDER BY table_name;
    " 2>&1 | grep -v "^$" || echo "   ⚠️  No piano app tables found. Run migration: ./run_migration.sh"

    echo ""
    echo "✅ Database connection successful!"
else
    echo "❌ psql not found. Please install PostgreSQL client tools:"
    echo "   sudo apt install postgresql-client"
    echo ""
    echo "Or test with Python:"
    echo "   source venv/bin/activate && python test_db.py"
fi
