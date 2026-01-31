#!/bin/bash

# Run database migration for Piano Mastery App
# This script reads DATABASE_URL from .env and runs the migration SQL

set -e

# Change to backend directory
cd "$(dirname "$0")"

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Please create .env with DATABASE_URL"
    exit 1
fi

# Load DATABASE_URL from .env
source .env

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL not set in .env"
    exit 1
fi

echo "🎹 Running Piano Mastery App Database Migration"
echo "================================================"
echo ""
echo "Migration file: migrations/001_initial_schema.sql"
echo "Database: ${DATABASE_URL%%@*}@***" # Hide credentials
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled"
    exit 0
fi

# Run migration using psql
if command -v psql > /dev/null; then
    echo ""
    echo "Running migration..."
    psql "$DATABASE_URL" < migrations/001_initial_schema.sql
    echo ""
    echo "✅ Migration completed successfully!"
else
    echo ""
    echo "❌ psql not found. Please install PostgreSQL client tools:"
    echo "   sudo apt install postgresql-client"
    echo ""
    echo "Or run the migration manually:"
    echo "   psql \"$DATABASE_URL\" < migrations/001_initial_schema.sql"
    exit 1
fi
