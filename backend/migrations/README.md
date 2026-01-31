# Database Migrations

## Setup PostgreSQL

### Option 1: Docker (Recommended for Development)
```bash
docker run --name piano-mastery-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres
```

### Option 2: Local Installation
Install PostgreSQL from https://www.postgresql.org/download/

## Create Database
```bash
psql -h localhost -U postgres -c "CREATE DATABASE piano_mastery;"
```

## Run Migration
```bash
psql -h localhost -U postgres -d piano_mastery -f migrations/001_initial_schema.sql
```

## Environment Variable
Add to `.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/piano_mastery
```
