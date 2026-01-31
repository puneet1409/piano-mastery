# Deployment Guide

Production deployment guide for Piano Mastery App. This document covers deploying the frontend to Vercel and backend to Railway (or Fly.io as an alternative).

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│   Browser   │ ──────> │   Vercel     │         │   Railway    │
│  (Student)  │ <────── │  (Frontend)  │ <─────> │  (Backend)   │
└─────────────┘         └──────────────┘         └──────────────┘
                               │                        │
                               │                        ├─> PostgreSQL
                               │                        └─> File Storage
                               │
                        Static Next.js Build      FastAPI + WebSocket
                        (React, Tailwind)         (Claude Agent)
```

### Components

- **Frontend**: Vercel (static Next.js build)
- **Backend**: Railway or Fly.io (FastAPI + WebSocket server)
- **Database**: Railway PostgreSQL or Supabase
- **File Storage**: Backend server filesystem (session state, skill progress)

## Prerequisites

### Required Accounts
- [GitHub](https://github.com) - Code repository
- [Vercel](https://vercel.com) - Frontend hosting (free tier available)
- [Railway](https://railway.app) - Backend + DB hosting (free $5/month credit)
- [Anthropic](https://console.anthropic.com) - Claude API key

### Required Tools
- Git
- Node.js 18+
- Python 3.11+
- Railway CLI (optional but recommended)

## Frontend Deployment (Vercel)

### Initial Setup

1. **Push code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-github-repo>
   git push -u origin main
   ```

2. **Connect to Vercel**
   - Go to [vercel.com/new](https://vercel.com/new)
   - Import your GitHub repository
   - Select the `frontend` directory as the root

3. **Configure build settings**
   - **Framework Preset**: Next.js
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `.next` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)

4. **Add environment variables**

   In Vercel dashboard > Settings > Environment Variables:

   | Variable | Value | Example |
   |----------|-------|---------|
   | `NEXT_PUBLIC_WS_URL` | Your backend WebSocket URL | `wss://piano-backend.railway.app` |

5. **Deploy**
   - Click "Deploy"
   - Vercel will automatically build and deploy
   - Your app will be live at `https://your-app.vercel.app`

### Continuous Deployment

After initial setup, Vercel automatically deploys:
- **Production**: Every push to `main` branch
- **Preview**: Every push to other branches or pull requests

```bash
# Push to deploy
git add .
git commit -m "Update frontend"
git push origin main
```

## Backend Deployment (Railway)

### Method 1: Railway CLI (Recommended)

1. **Install Railway CLI**
   ```bash
   npm install -g railway
   ```

2. **Login to Railway**
   ```bash
   railway login
   ```

3. **Create new project**
   ```bash
   cd backend
   railway init
   # Select "Create new project"
   # Name it (e.g., "piano-mastery-backend")
   ```

4. **Add PostgreSQL database**
   ```bash
   railway add postgresql
   ```

   Railway automatically sets `DATABASE_URL` environment variable.

5. **Set environment variables**
   ```bash
   railway variables set ANTHROPIC_API_KEY=<your-anthropic-api-key>
   ```

6. **Deploy backend**
   ```bash
   railway up
   ```

7. **Run database migrations**
   ```bash
   # Connect to Railway's PostgreSQL
   railway run psql -f migrations/001_initial_schema.sql
   ```

8. **Get your backend URL**
   ```bash
   railway status
   # Look for "Service URL" (e.g., https://piano-backend.railway.app)
   ```

9. **Update Vercel environment**
   - Go back to Vercel dashboard
   - Update `NEXT_PUBLIC_WS_URL` with your Railway WebSocket URL
   - Change `https://` to `wss://` for WebSocket
   - Redeploy frontend

### Method 2: Railway Dashboard

1. **Create new project**
   - Go to [railway.app/new](https://railway.app/new)
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Select `backend` directory

2. **Add PostgreSQL**
   - In project dashboard, click "+ New"
   - Select "Database" > "PostgreSQL"

3. **Configure service**
   - Click on your service
   - Go to "Settings"
   - Set **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Set **Root Directory**: `backend`

4. **Set environment variables**
   - Go to "Variables" tab
   - Add:
     - `ANTHROPIC_API_KEY`: Your Claude API key
     - `DATABASE_URL`: (Auto-set by Railway when you add PostgreSQL)

5. **Deploy**
   - Railway automatically builds and deploys
   - Click "Deploy" if needed

6. **Run migrations**
   ```bash
   # From local machine
   railway login
   railway link  # Link to your project
   railway run psql -f migrations/001_initial_schema.sql
   ```

## Backend Deployment (Fly.io - Alternative)

### Setup

1. **Install Fly.io CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**
   ```bash
   fly auth login
   ```

3. **Create app**
   ```bash
   cd backend
   fly launch --no-deploy
   # Follow prompts to configure
   ```

4. **Create `fly.toml`** (if not auto-generated)
   ```toml
   app = "piano-mastery-backend"
   primary_region = "iad"

   [build]
     dockerfile = "Dockerfile"

   [env]
     PORT = "8080"

   [[services]]
     internal_port = 8080
     protocol = "tcp"

     [[services.ports]]
       port = 80
       handlers = ["http"]

     [[services.ports]]
       port = 443
       handlers = ["tls", "http"]

   [http_service]
     internal_port = 8080
     force_https = true
   ```

5. **Create `Dockerfile`**
   ```dockerfile
   FROM python:3.11-slim

   WORKDIR /app

   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt

   COPY . .

   CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
   ```

6. **Set secrets**
   ```bash
   fly secrets set ANTHROPIC_API_KEY=<your-key>
   fly secrets set DATABASE_URL=<your-postgres-url>
   ```

7. **Deploy**
   ```bash
   fly deploy
   ```

## Database Setup

### Option 1: Railway PostgreSQL (Recommended)

Automatically provisioned when you run `railway add postgresql`.

```bash
# Run migrations
railway run psql -f migrations/001_initial_schema.sql

# Verify tables
railway run psql -c "\dt"
```

### Option 2: Supabase (Alternative)

1. Create project at [supabase.com](https://supabase.com)
2. Get connection string from Settings > Database
3. Run migrations:
   ```bash
   psql "postgresql://[YOUR_CONNECTION_STRING]" -f backend/migrations/001_initial_schema.sql
   ```
4. Set `DATABASE_URL` environment variable in Railway/Fly.io

### Option 3: Managed PostgreSQL

For production scale, consider:
- [Neon](https://neon.tech) - Serverless Postgres
- [PlanetScale](https://planetscale.com) - MySQL alternative
- [AWS RDS](https://aws.amazon.com/rds/) - Enterprise grade

## Environment Variables Reference

### Backend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for agent reasoning | `sk-ant-api03-...` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://user:pass@host/db` |
| `PORT` | No | Server port (auto-set by Railway/Fly.io) | `8000` |
| `CORS_ORIGINS` | No | Allowed CORS origins | `https://your-app.vercel.app` |

### Frontend Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `NEXT_PUBLIC_WS_URL` | Yes | Backend WebSocket URL | `wss://piano-backend.railway.app` |

## Post-Deployment Verification

### 1. Check Frontend
```bash
curl https://your-app.vercel.app
# Should return HTML
```

### 2. Check Backend Health
```bash
curl https://your-backend.railway.app/health
# Should return {"status": "healthy"}
```

### 3. Test WebSocket Connection
```bash
# Use wscat (npm install -g wscat)
wscat -c wss://your-backend.railway.app/ws
# Should connect without errors
```

### 4. Verify Database
```bash
railway run psql -c "SELECT COUNT(*) FROM practice_sessions;"
# Should return count (even if 0)
```

## Monitoring and Logs

### Vercel Logs
```bash
# View deployment logs
vercel logs <deployment-url>

# Real-time logs
vercel logs --follow
```

### Railway Logs
```bash
# Via CLI
railway logs

# Via dashboard
# Go to project > Service > Deployments > View logs
```

### Fly.io Logs
```bash
fly logs
```

## Scaling Considerations

### Traffic < 1,000 users/month
Current architecture is sufficient:
- Vercel free tier: 100GB bandwidth
- Railway free tier: $5/month credit
- Single backend instance handles ~100 concurrent WebSocket connections

### Traffic > 1,000 users/month

#### Frontend Scaling
Vercel automatically scales. No action needed.

#### Backend Scaling

**Option 1: Vertical Scaling**
- Upgrade Railway plan to increase memory/CPU
- Good for up to 5,000 concurrent users

**Option 2: Horizontal Scaling (Multiple Instances)**

Requirements:
1. **Session Storage**: Move from file-based to Redis
   ```bash
   railway add redis
   ```

2. **Load Balancer**: Railway provides automatic load balancing

3. **Code Changes**:
   ```python
   # Replace file-based session storage
   from redis import Redis

   redis_client = Redis.from_url(os.environ["REDIS_URL"])

   # Store session in Redis instead of files
   redis_client.set(f"session:{session_id}", json.dumps(session_data))
   ```

#### Database Scaling

**Option 1: Connection Pooling**
```bash
railway add pgbouncer
# Update DATABASE_URL to use pgbouncer
```

**Option 2: Read Replicas**
- Railway Pro plan supports read replicas
- Route read queries to replicas, writes to primary

### Audio Processing Optimization

For CPU-intensive audio analysis at scale:

1. **Background Workers**
   ```python
   # Use Celery for async audio processing
   from celery import Celery

   celery_app = Celery('piano_app', broker=os.environ['REDIS_URL'])

   @celery_app.task
   def analyze_audio(audio_data):
       # CPU-intensive librosa processing
       pass
   ```

2. **Dedicated Worker Pool**
   - Deploy separate Railway service for workers
   - Scale workers independently from API

## Troubleshooting

### Frontend Issues

**Problem**: `WebSocket connection failed`
- **Cause**: Wrong `NEXT_PUBLIC_WS_URL` or backend not running
- **Fix**: Verify backend URL, check Railway logs

**Problem**: `Module not found` errors
- **Cause**: Missing dependencies
- **Fix**: Check `package.json`, run `npm install`, redeploy

### Backend Issues

**Problem**: `ImportError: No module named 'anthropic'`
- **Cause**: Dependencies not installed
- **Fix**: Check `requirements.txt`, Railway auto-installs on deploy

**Problem**: `Database connection refused`
- **Cause**: `DATABASE_URL` not set or incorrect
- **Fix**: Verify Railway PostgreSQL is added, check environment variables

**Problem**: `WebSocket upgrade failed`
- **Cause**: CORS or routing issue
- **Fix**: Check `app/main.py` CORS settings, verify WebSocket route

### Database Issues

**Problem**: `relation "practice_sessions" does not exist`
- **Cause**: Migrations not run
- **Fix**: Run `railway run psql -f migrations/001_initial_schema.sql`

**Problem**: `too many connections`
- **Cause**: Connection leak or need pooling
- **Fix**: Add pgbouncer or fix connection handling in code

## Rollback Procedures

### Vercel Rollback
```bash
# List deployments
vercel ls

# Promote previous deployment to production
vercel promote <deployment-url>
```

### Railway Rollback
1. Go to Railway dashboard
2. Click on service > Deployments
3. Find previous successful deployment
4. Click "Redeploy"

### Fly.io Rollback
```bash
# List releases
fly releases

# Rollback to previous version
fly releases rollback
```

## Cost Estimation

### Free Tier (Development)
- **Vercel**: Free (100GB bandwidth, unlimited deployments)
- **Railway**: $5/month credit (enough for small backend + PostgreSQL)
- **Anthropic Claude API**: $0 (development usage ~$5-10/month)
- **Total**: ~$5-10/month

### Production (1,000 active users)
- **Vercel**: $20/month (Pro plan for better support)
- **Railway**: $20/month (Hobby plan with 8GB RAM)
- **Anthropic Claude API**: ~$100/month (estimated usage)
- **Total**: ~$140/month

### Production (10,000 active users)
- **Vercel**: $20/month (scales automatically)
- **Railway**: $50/month (2 instances + PostgreSQL)
- **Redis**: $10/month (for session storage)
- **Anthropic Claude API**: ~$1,000/month
- **Total**: ~$1,080/month

## Security Best Practices

### API Keys
- Never commit API keys to Git
- Use environment variables for all secrets
- Rotate keys periodically

### CORS Configuration
```python
# app/main.py
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://your-app.vercel.app",  # Production only
        "http://localhost:3000"          # Development only
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Database Security
- Use SSL connections (Railway enables by default)
- Limit database user permissions
- Enable connection pooling to prevent DOS

### Rate Limiting
```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.websocket("/ws")
@limiter.limit("10/minute")
async def websocket_endpoint(websocket: WebSocket):
    # WebSocket handler
    pass
```

## Backup and Disaster Recovery

### Database Backups

**Railway**:
- Automatic daily backups (retained for 7 days on Hobby plan)
- Manual backup: `railway run pg_dump > backup.sql`

**Restore**:
```bash
railway run psql < backup.sql
```

### Session Data Backups

If using file-based storage:
```bash
# Backup session files
railway run tar -czf sessions-backup.tar.gz /app/data/sessions

# Restore
railway run tar -xzf sessions-backup.tar.gz -C /app/data
```

## Support and Resources

- **Vercel Documentation**: https://vercel.com/docs
- **Railway Documentation**: https://docs.railway.app
- **Fly.io Documentation**: https://fly.io/docs
- **Anthropic API Status**: https://status.anthropic.com

## Next Steps

After successful deployment:

1. Set up monitoring (Railway/Vercel built-in metrics)
2. Configure custom domain (Vercel > Settings > Domains)
3. Enable SSL (automatic on Vercel and Railway)
4. Set up error tracking (Sentry, LogRocket)
5. Configure analytics (Vercel Analytics, PostHog)
6. Create staging environment (duplicate Railway project)

For questions or issues, refer to the platform-specific documentation or open an issue in the repository.
