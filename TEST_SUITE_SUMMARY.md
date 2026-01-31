# Piano Detection Test Suite Summary

This document summarizes the comprehensive test suite for the piano detection system.

## Test Count Summary

| Category | File | Test Count |
|----------|------|------------|
| Backend Algorithms | `backend/tests/test_detection_algorithms.py` | 100 |
| Frontend Detection | `frontend/tests/detection/detection.test.ts` | ~40 |
| API Tests (curl) | `backend/tests/test_api.sh` | 20 |
| E2E: Detection Flow | `frontend/tests/e2e/detection-flow.spec.ts` | 80 |
| E2E: Performance | `frontend/tests/e2e/performance.spec.ts` | 20 |
| E2E: Edge Cases | `frontend/tests/e2e/edge-cases.spec.ts` | 40 |
| UI: Practice Page | `frontend/tests/ui/practice-page.spec.ts` | 13 |
| UI: Layout Check | `frontend/tests/ui/layout-check.spec.ts` | 5 |
| **TOTAL** | | **~318 tests** |

## Test Categories

### 1. Backend Algorithm Tests (`test_detection_algorithms.py`)

**100 tests** covering:

- YIN pitch detection (20 tests)
  - Single note detection (C4, A4, E5, etc.)
  - Octave accuracy (C3, C4, C5, C6, C7)
  - Pitch stability over time
  - Note naming conventions (sharps vs flats)
  - Frequency edge cases

- Score Follower (20 tests)
  - Simple sequence matching
  - Repeated notes handling
  - Out-of-order detection
  - Timing tolerance (early/late)
  - Missed note handling
  - Chord matching

- Gate System (20 tests)
  - Energy gate thresholds
  - Confidence gate thresholds
  - Onset gate detection
  - Combined gate logic
  - Noise rejection

- Stability Confirmation (20 tests)
  - 2/3 hop confirmation
  - Jitter handling
  - Transient rejection
  - Note duration tracking

- Polyphonic Detection (20 tests)
  - Two-note chords
  - Three-note chords
  - Note separation
  - Octave detection
  - Voice tracking

### 2. Frontend Detection Tests (`detection.test.ts`)

**~40 tests** covering:

- NoteEvent type validation
- ClientScoreFollower logic
- Stability confirmation (2/3 rule)
- Gate system logic
- Timing window calculations
- Progress tracking
- Simulated audio with jitter

### 3. API Tests (`test_api.sh`)

**20 tests** covering:

- Health endpoint
- Exercises endpoint
- WebSocket connectivity
- Exercise metadata
- Response times
- Error handling
- CORS headers

### 4. E2E Detection Flow Tests (`detection-flow.spec.ts`)

**80 tests** in 8 categories:

1. **Exercise Selection** (10 tests)
   - Page title display
   - Exercise loading
   - Difficulty badges
   - Selection highlighting
   - Start button visibility

2. **Practice Session** (15 tests)
   - Count-in overlay
   - Stop button
   - Progress counter
   - BPM indicator
   - Piano keyboard render
   - Falling notes visualization
   - Exercise name in header
   - Toolbar controls

3. **Mode Toggles** (15 tests)
   - Metronome ON/OFF
   - Loop mode toggle
   - Wait mode toggle
   - Client mode toggle
   - Polyphony mode toggle
   - Display mode switching
   - Tempo slider

4. **Visual Feedback** (10 tests)
   - Canvas rendering
   - Feedback text area
   - Correct/wrong indicators
   - Piano key display
   - Progress bar updates
   - Note animations

5. **Responsive Layout** (10 tests)
   - 1920x1080 viewport
   - 1280x720 viewport
   - 768x1024 tablet
   - 375x812 mobile
   - Octave range adjustment
   - Toolbar stacking

6. **Completion Flow** (10 tests)
   - Completion overlay
   - Replay button
   - Back button
   - Star rating
   - Accuracy percentage
   - Timing statistics

7. **Error Handling** (10 tests)
   - Missing microphone permission
   - Backend disconnect
   - WebSocket errors
   - Invalid exercise
   - Rapid toggle clicks
   - Resize during practice

8. **API Integration** (10 tests)
   - Exercises fetch
   - Health status
   - Required fields
   - requiresPolyphony field
   - Response times
   - CORS headers

### 5. Performance Tests (`performance.spec.ts`)

**20 tests** covering:

- Page load times
- DOMContentLoaded timing
- Largest Contentful Paint (LCP)
- First Input Delay (FID)
- Cumulative Layout Shift (CLS)
- JavaScript bundle size
- Cache effectiveness
- Main thread blocking
- Time to Interactive (TTI)
- Memory usage
- Frame rate (60fps)
- Animation efficiency

### 6. Edge Case Tests (`edge-cases.spec.ts`)

**40 tests** in 4 categories:

1. **Boundary Conditions** (10 tests)
   - Min/max tempo slider
   - Very narrow viewport (320px)
   - Very wide viewport (2560px)
   - Portrait/landscape orientation
   - Zero exercises
   - Very long exercise names
   - Special characters (XSS)
   - Many exercises (100+)

2. **User Interaction** (10 tests)
   - Double-click
   - Rapid switching
   - Escape key
   - Tab navigation
   - Enter/Space keys
   - Mouse hover
   - Click outside
   - Right-click
   - Middle-click

3. **Stress & Stability** (10 tests)
   - 50 page refreshes
   - 100 rapid clicks
   - Rapid viewport changes
   - Network latency
   - Slow backend response
   - Intermittent failures
   - Back/forward navigation
   - Visibility changes
   - Focus/blur events
   - Online/offline events

4. **Accessibility** (10 tests)
   - Heading hierarchy
   - Interactive element labels
   - Keyboard navigation
   - Color contrast
   - Focus indicators
   - Reduced motion
   - Screen reader landmarks
   - Form labels
   - Dynamic content
   - High contrast mode

## Running Tests

### Backend Algorithm Tests
```bash
cd piano-app/backend
python -m pytest tests/test_detection_algorithms.py -v
```

### Frontend Detection Tests
```bash
cd piano-app/frontend
npm test -- detection.test.ts
```

### API Tests (requires running server)
```bash
cd piano-app/backend
python simple_test_server.py &  # Start server first
bash tests/test_api.sh
```

### Playwright E2E Tests
```bash
cd piano-app/frontend
# Ensure dev server and backend are running
npx playwright test
```

### Run Specific E2E Test File
```bash
cd piano-app/frontend
npx playwright test tests/e2e/detection-flow.spec.ts
npx playwright test tests/e2e/performance.spec.ts
npx playwright test tests/e2e/edge-cases.spec.ts
```

## Test Coverage Areas

### Detection Pipeline
- Audio capture (simulated)
- YIN pitch detection
- 3-gate filtering (energy, confidence, onset)
- Stability confirmation (2/3 hops)
- Score following
- Timing evaluation
- Hit/miss/wrong classification

### User Interface
- Exercise selection
- Practice session flow
- Mode toggles
- Visual feedback
- Keyboard highlighting
- Falling notes animation
- Completion overlay

### System Integration
- Frontend-backend communication
- WebSocket streaming
- REST API endpoints
- Error recovery
- State management

### Quality Metrics
- Performance (LCP, CLS, FID)
- Responsiveness (mobile, tablet, desktop)
- Accessibility (a11y)
- Stress tolerance
- Edge case handling
