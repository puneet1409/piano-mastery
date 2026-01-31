# Piano Mastery App

Agent-native piano learning application for fast-tracking musical education with quality technique. Built with collaborative AI coaching powered by Claude.

## Features

### Core Learning Experience
- **Real-time AI Coaching**: Claude agent provides live feedback during practice
- **Audio Analysis**: Pitch detection and timing analysis using Web Audio API
- **Interactive Keyboard**: Visual feedback showing correct fingering and hand position
- **Sheet Music Display**: VexFlow-powered notation with measure-by-measure progression
- **Skill-Based Progression**: Master foundational techniques that transfer across songs

### Practice Modes
- **Guided Practice**: Agent breaks down difficult passages into learnable chunks
- **Free Play**: Practice with optional agent observation
- **Drill Mode**: Targeted exercises for specific techniques (scales, arpeggios, chord progressions)

### Intelligence Features
- **Productive Struggle Detection**: Agent knows when to intervene vs. let you work through challenges
- **Memory Persistence**: Session history and skill progress saved across practice sessions
- **Contextual Hints**: Agent references sheet music, timing data, and previous attempts

## Tech Stack

### Frontend
- **Next.js 16** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS 4** - Utility-first styling
- **VexFlow.js 5.0** - Music notation rendering
- **Tone.js 15** - Audio playback and synthesis
- **Pitchy 4** - Real-time pitch detection
- **Web Audio API** - Low-latency audio capture

### Backend
- **Python 3.11+** - Modern Python with async support
- **FastAPI 0.109** - High-performance async web framework
- **WebSockets** - Real-time bidirectional communication
- **Anthropic Claude API** - Agent reasoning and coaching
- **librosa 0.10** - Audio analysis and feature extraction
- **PostgreSQL** - Session data and skill progress storage

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.11+
- **PostgreSQL** 14+ (or use Docker)
- **Anthropic API Key** ([get one here](https://console.anthropic.com/))

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd piano-app
   ```

2. **Frontend setup**
   ```bash
   cd frontend
   npm install
   ```

3. **Backend setup**
   ```bash
   cd ../backend
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Database setup**
   ```bash
   # Create PostgreSQL database
   createdb piano_mastery

   # Run migrations
   psql -d piano_mastery -f migrations/001_initial_schema.sql
   ```

5. **Environment variables**

   Create `backend/.env`:
   ```env
   ANTHROPIC_API_KEY=sk-ant-...
   DATABASE_URL=postgresql://localhost/piano_mastery
   ```

   Create `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_WS_URL=ws://localhost:8000
   ```

### Running Locally

1. **Start backend** (Terminal 1)
   ```bash
   cd backend
   source venv/bin/activate
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Start frontend** (Terminal 2)
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open browser**
   ```
   http://localhost:3000
   ```

## Project Structure

```
piano-app/
├── frontend/                  # Next.js React application
│   ├── src/
│   │   ├── app/              # App Router pages
│   │   │   ├── layout.tsx    # Root layout
│   │   │   └── page.tsx      # Home page (practice session)
│   │   ├── components/       # React components
│   │   │   ├── SessionHeader.tsx
│   │   │   └── KeyboardVisualization.tsx
│   │   └── lib/              # Utilities
│   │       ├── websocketClient.ts
│   │       └── audioCapture.ts
│   ├── public/               # Static assets
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                   # FastAPI Python backend
│   ├── app/
│   │   ├── agents/           # Agent loop & prompts
│   │   │   ├── claude_client.py
│   │   │   ├── session_manager.py
│   │   │   ├── prompts.py
│   │   │   └── templates.py
│   │   ├── tools/            # Atomic tool primitives
│   │   │   ├── pitch_detection.py
│   │   │   └── drill_generator.py
│   │   ├── api/              # FastAPI routes
│   │   │   └── websocket.py
│   │   ├── models/           # Data models
│   │   │   └── skill.py
│   │   └── main.py           # Application entry point
│   ├── migrations/           # SQL migrations
│   │   └── 001_initial_schema.sql
│   ├── requirements.txt
│   └── pytest.ini
│
└── docs/                      # Documentation
    ├── DESIGN.md             # Complete architecture design
    ├── DEPLOYMENT.md         # Production deployment guide
    ├── AGENT_LOOP_IMPLEMENTATION.md
    ├── AUDIO-CAPTURE-API.md
    └── MANUAL-TESTING-GUIDE.md
```

## Testing

### Frontend Tests
```bash
cd frontend
npm test                      # Run all tests
npm test -- --watch          # Watch mode
```

### Backend Tests
```bash
cd backend
pytest                        # Run all tests
pytest -v                     # Verbose output
pytest tests/test_agent.py   # Specific test file
pytest -k "pitch"            # Tests matching pattern
```

### Manual Testing
See [docs/MANUAL-TESTING-GUIDE.md](docs/MANUAL-TESTING-GUIDE.md) for detailed testing procedures including:
- Audio capture verification
- WebSocket connection testing
- Agent loop interaction
- Sheet music rendering

## Development Workflow

### Adding New Tools

1. Define tool in `backend/app/tools/`
2. Register in agent's tool list (`app/agents/claude_client.py`)
3. Test tool independently
4. Update agent prompt if needed (`app/agents/prompts.py`)

### Adding New UI Components

1. Create component in `frontend/src/components/`
2. Use TypeScript for props
3. Follow Tailwind CSS patterns
4. Test with dev server hot reload

### Database Migrations

```bash
# Create new migration
touch backend/migrations/002_description.sql

# Write SQL in migration file
# Apply manually
psql -d piano_mastery -f backend/migrations/002_description.sql
```

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for complete production deployment guide including:
- Vercel frontend hosting
- Railway/Fly.io backend deployment
- PostgreSQL database setup
- Environment variable configuration
- Scaling considerations

## Architecture Principles

This app follows **agent-native architecture** principles:

1. **Parity**: Whatever users can do via UI, agents can do via tools
2. **Granularity**: Atomic tool primitives (not high-level operations)
3. **Composability**: New features = new prompts, not new code
4. **Files as Interface**: Session state stored in files for agent context

See [docs/DESIGN.md](docs/DESIGN.md) for complete design rationale.

## MVP Goal

Learn "Perfect" by Ed Sheeran with:
- Quality technique (proper fingering, timing, dynamics)
- Skill transferability (foundational skills that apply to other songs)
- Real-time agent coaching during practice

## Contributing

This is currently a personal learning project. Feel free to fork and adapt for your own use.

## License

MIT License - See LICENSE file for details

## Resources

- [VexFlow Documentation](https://github.com/0xfe/vexflow)
- [Tone.js Guide](https://tonejs.github.io/)
- [Anthropic Claude API](https://docs.anthropic.com/en/api)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)

## Support

For questions or issues, please refer to the documentation in the `docs/` directory or open an issue on GitHub.
