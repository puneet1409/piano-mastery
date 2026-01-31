# Piano Mastery UI Redesign - V1 Design Specification

**Date:** 2026-01-25
**Status:** Validated and Ready for Implementation
**Design Philosophy:** Pixar-quality playful learning experience with professional piano teaching

---

## 1. Design Vision

### Core Concept
A piano learning interface featuring "Nota" - a sentient musical note character with Toy Story-level animation quality - guiding students through exercises with a realistic yet playful piano keyboard.

### Quality Bar
- **Character Design:** Pixar/Toy Story aesthetic (not cheap 2D cartoons)
- **Piano Keyboard:** Realistic layout with playful styling
- **Animations:** Simple, well-timed, purposeful (no feature creep)
- **Platform:** Mobile-first (no hover states)

---

## 2. V1 Scope (Must Have)

### 2.1 Piano Keyboard

**Layout:**
- Horizontal left-to-right orientation (standard piano view)
- Responsive octave ranges:
  - Desktop: C3-C6 (37 keys: 22 white, 15 black)
  - Tablet: C4-C6 (25 keys: 15 white, 10 black)
  - Mobile: C4-C5 (13 keys: 8 white, 5 black)

**Key Proportions:**
- White keys: 7:1 height-to-width ratio
- Black keys: 60% height of white keys, 65% width of white keys
- Border radius: 4px (bottom corners only for realism)

**Black Key Positioning (Critical):**
```typescript
// NOT evenly spaced - follows piano pattern
const BLACK_KEY_OFFSETS = {
  'C#': 0.65,  // Between C-D
  'D#': 1.65,  // Between D-E
  // NO BLACK between E-F
  'F#': 3.65,  // Between F-G
  'G#': 4.65,  // Between G-A
  'A#': 5.65,  // Between A-B
  // NO BLACK between B-C
};

// Position = (offset * whiteKeyWidth) - (blackKeyWidth / 2)
```

---

### 2.2 Zero Layout Shift Architecture

**Problem:** Hover/animations cause nearby elements to shift (looks shabby)

**Solution:** Fixed-size container pattern

```tsx
// Each key wrapped in fixed-size slot
<KeySlot style={{ width: keyWidth, height: keyHeight, position: 'relative' }}>
  <KeyFace
    style={{
      position: 'absolute',
      inset: 0,
      transform: pressed ? 'translateY(4px)' : 'translateY(0)'
    }}
  />
</KeySlot>
```

**Rules:**
- ✅ Only animate: `transform`, `opacity`, `box-shadow`
- ❌ Never animate: `width`, `height`, `padding`, `margin`, `border`
- Result: Zero reflow, perfect smoothness

---

### 2.3 Premium Visual Materials

**White Keys:**
```css
.white-key {
  /* Ivory gradient (not flat white) */
  background: linear-gradient(180deg,
    #fffefb 0%,    /* Top */
    #f4f1ea 95%,   /* Body */
    #e0dcd5 100%   /* Bottom edge */
  );

  /* Key thickness (front face) */
  border-bottom: 4px solid #ccc;

  /* Subtle depth */
  box-shadow:
    0 4px 8px rgba(0, 0, 0, 0.1),
    inset 0 -2px 4px rgba(0, 0, 0, 0.05);
}

.white-key.pressed {
  transform: translateY(4px);
  border-bottom: 1px solid #ccc; /* Compressed */
}
```

**Black Keys:**
```css
.black-key {
  /* Ebony gradient with piano lacquer shine */
  background: linear-gradient(180deg,
    #3a3a3a 0%,   /* Top highlight */
    #1a1a1a 80%,  /* Body */
    #000 100%     /* Bottom */
  );

  /* Top edge highlight (lacquer) */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255, 255, 255, 0.15);
  }
}
```

**Key Separators (No Borders):**
```css
.white-key::after {
  content: '';
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg,
    transparent 0%,
    rgba(0, 0, 0, 0.1) 20%,
    rgba(0, 0, 0, 0.1) 80%,
    transparent 100%
  );
}
```

---

### 2.4 Key State Machine

**Base States (Mutually Exclusive):**
- `idle` - Default resting state
- `expected` - Next note to play (breathing cyan glow)
- `disabled` - Out of range / not playable

**Interaction Overlays (Temporary, Auto-Clear):**
- `pressed` - Physical key depression (80ms)
- `hitCorrect` - Correct note played (300ms glow pulse)
- `hitWrong` - Wrong note played (250ms shake + red outline)

**Priority Order (Highest to Lowest):**
1. Interaction overlay (pressed/hit states)
2. Base state (expected/idle)
3. Overlays auto-clear after duration

```typescript
type KeyBaseState = 'idle' | 'expected' | 'disabled';
type KeyOverlay = null | 'pressed' | 'hitCorrect' | 'hitWrong';

const OVERLAY_DURATIONS = {
  pressed: 80,
  hitCorrect: 300,
  hitWrong: 250
};
```

---

### 2.5 Animation Specifications

**Expected Note (Breathing Glow):**
```css
@keyframes breathe {
  0%, 100% {
    box-shadow: 0 0 20px rgba(88, 235, 237, 0.4);
    filter: brightness(1.05);
  }
  50% {
    box-shadow: 0 0 30px rgba(88, 235, 237, 0.7);
    filter: brightness(1.15);
  }
}

.key--expected {
  animation: breathe 1.4s ease-in-out infinite;
}
```

**Pressed (Physical Depression):**
```css
.key--pressed {
  transform: translateY(4px);
  transition: transform 0.08s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.2);
}
```

**Correct Hit (Radial Pulse):**
```css
@keyframes correctPulse {
  0% {
    box-shadow:
      0 0 0 0 rgba(88, 235, 237, 0.7),
      inset 0 0 30px rgba(88, 235, 237, 0.6);
  }
  100% {
    box-shadow:
      0 0 0 20px rgba(88, 235, 237, 0),
      inset 0 0 20px rgba(88, 235, 237, 0.4);
  }
}

.key--hit-correct {
  animation: correctPulse 0.3s ease-out;
}
```

**Wrong Hit (Micro Shake + Red Outline):**
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.key--hit-wrong {
  animation: shake 0.25s cubic-bezier(0.36, 0.07, 0.19, 0.97);
  box-shadow:
    0 0 0 2px #FF4757,
    0 0 20px rgba(255, 71, 87, 0.4);
}
```

**Timing Summary:**
- Key press: **80ms** (snappy)
- Correct feedback: **300ms** (satisfying)
- Wrong feedback: **250ms** (brief)
- Expected breathing: **1.4s cycle** (calm)

---

### 2.6 Nota Character (SVG Implementation)

**Design:**
- Sentient musical note with expressive eyes and tiny limbs
- SVG-based with CSS animations (not Rive/Lottie in V1)
- Lives in fixed "stage area" above piano

**Animation States:**
```typescript
type NotaState =
  | 'idle'      // Gentle bounce, waiting
  | 'excited'   // Bigger bounce, happy expression (correct streak)
  | 'sad'       // Slumped, sympathetic (after mistake)
  | 'confused'  // Head tilt, question mark (no audio detected)
```

**Emotional Transitions:**
- Streak of 3+ correct → `excited`
- Wrong note → `sad` (250ms), then back to `idle`
- No detection for 10s → `confused`

**Position:**
- Fixed stage area (corner or above piano)
- Does NOT hop on keys in V1 (avoids covering labels)
- Reacts emotionally from sideline

---

### 2.7 Feedback System

**Micro-Feedback Labels:**

On each note attempt, show floating label:
- ✅ **Perfect** (±10ms timing)
- ✅ **Good** (±30ms timing)
- ⚠️ **Early** (-50ms)
- ⚠️ **Late** (+50ms)
- ❌ **Wrong Note** (shows "D4 → Expected E4")
- ❌ **Missed**

**Animation:**
```css
@keyframes floatUp {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-30px);
  }
}

.feedback-label {
  animation: floatUp 0.8s ease-out forwards;
}
```

**Score Display:**
```
┌────────────────────────────┐
│ Accuracy: 87%   Streak: 🔥12│
└────────────────────────────┘
```

- Simple percentage (not 3 meters in V1)
- Streak counter with fire emoji
- Updates smoothly (no jumps)

---

### 2.8 Component Structure

```tsx
<PianoKeyboard
  detectedNotes={['C4', 'E4']}  // Can be multiple (chords)
  expectedNotes={['C4', 'E4', 'G4']}
  progress={{ correct: 12, total: 20, accuracy: 87 }}
  streak={12}
>
  {/* Character Stage */}
  <div className="character-stage">
    <NotaSVG state={notaState} />
    <ScoreDisplay accuracy={87} streak={12} />
  </div>

  {/* Keyboard */}
  <div className="keyboard-container">
    <div className="white-keys-layer">
      {whiteKeys.map(key => (
        <KeySlot key={key.note}>
          <KeyFace
            note={key.note}
            baseState={getBaseState(key)}
            overlay={getOverlay(key)}
          />
        </KeySlot>
      ))}
    </div>

    <div className="black-keys-layer">
      {blackKeys.map(key => (
        <KeySlot
          key={key.note}
          style={{ left: calculateBlackKeyPosition(key) }}
        >
          <KeyFace
            note={key.note}
            baseState={getBaseState(key)}
            overlay={getOverlay(key)}
          />
        </KeySlot>
      ))}
    </div>
  </div>

  {/* Progress */}
  <ProgressBar percent={progress.completion} />
</PianoKeyboard>
```

---

### 2.9 Error Handling

**Connection Loss:**
```tsx
{!wsConnected && (
  <ErrorBanner>
    ⚠️ Connection lost. Reconnecting...
  </ErrorBanner>
)}
```

**Audio Permission Denied:**
```tsx
{audioError && (
  <ErrorBanner>
    🎤 Microphone access required. Please allow in browser settings.
  </ErrorBanner>
)}
```

**No Detection (10s):**
```tsx
{noDetectionTime > 10000 && (
  <NotaHint>
    I'm not hearing anything... try playing louder? 🎹
  </NotaHint>
)}
```

---

### 2.10 Responsive Breakpoints

```css
/* Desktop: 3 octaves */
@media (min-width: 1024px) {
  .keyboard { --octave-count: 3; }
}

/* Tablet: 2 octaves */
@media (min-width: 640px) and (max-width: 1023px) {
  .keyboard { --octave-count: 2; }
}

/* Mobile: 1 octave */
@media (max-width: 639px) {
  .keyboard {
    --octave-count: 1;
    /* Stack vertically if needed */
  }
}
```

---

## 3. Explicitly Deferred to V2

**Features Cut from V1 (to avoid overcomplplication):**

❌ **2.5D Perspective Transform** (`rotateX(20deg)`)
- Reason: Complicates click detection, black key math, mobile viewing
- V2: Add after V1 is validated

❌ **Spring Physics Library** (`react-spring`)
- Reason: 40KB+ dependency for marginal benefit
- V2: Upgrade if user feedback demands it

❌ **Timing Lane** (Guitar Hero-style playhead)
- Reason: Separate complex feature, can overwhelm beginners
- V2: Add as optional "challenge mode"

❌ **Duration Ribbons** (phantom hand visualization)
- Reason: Visually cluttered, complex note-on/off tracking
- V2: Add for advanced articulation teaching

❌ **Dynamic Viewport Panning**
- Reason: Most exercises fit in 3 octaves, can be disorienting
- V2: Add for advanced multi-octave songs

❌ **Rive/Lottie Character**
- Reason: Requires separate animation workflow, blocks iteration
- V2: Upgrade from SVG after design validated

❌ **Particle Effects** (sparkles, confetti)
- Reason: Visual noise, requires library
- V2: Add for celebrations if needed

❌ **Hover States**
- Reason: Mobile-first (tablets don't have hover)
- V2: Never add (not needed)

---

## 4. Success Metrics

**V1 is successful if:**

1. ✅ **Zero layout shift** - No elements move unexpectedly on any interaction
2. ✅ **Correct piano layout** - Black keys positioned accurately per note
3. ✅ **Premium feel** - Users describe it as "polished" or "professional"
4. ✅ **Clear feedback** - Users understand correct/wrong immediately
5. ✅ **Playful character** - Nota adds personality without distraction
6. ✅ **Mobile works** - Fully functional on tablets and phones
7. ✅ **Fast iteration** - Can change animations/colors in minutes (no complex dependencies)

---

## 5. Implementation Priority

**Phase 1: Foundation (Week 1)**
1. KeySlot + KeyFace architecture (zero layout shift)
2. Correct black key positioning algorithm
3. Responsive octave ranges
4. Basic white/black key rendering

**Phase 2: Premium Feel (Week 1-2)**
5. Material gradients (ivory/ebony)
6. State machine implementation
7. CSS animations (breathe, pulse, shake)
8. Key separators and details

**Phase 3: Character & Feedback (Week 2)**
9. Nota SVG character (3 emotional states)
10. Micro-feedback labels
11. Score display
12. Error handling UI

**Phase 4: Polish (Week 2-3)**
13. Performance optimization
14. Cross-browser testing
15. Mobile refinements
16. Animation timing tweaks

---

## 6. Technical Dependencies

**Required:**
- React 18+
- TypeScript
- CSS Modules or Tailwind
- WebSocket client (already implemented)

**No Additional Libraries Needed:**
- ❌ react-spring (using CSS)
- ❌ framer-motion (using CSS)
- ❌ lottie-react (using SVG)
- ❌ react-particles (deferred to V2)

---

## 7. Design Rationale

**Why This Approach:**

1. **Zero Layout Shift** - Most critical UX issue, fixed at architecture level
2. **Correct Piano Layout** - Teaches real piano skills, not abstract interface
3. **Simple Animations** - CSS-only = fast iteration, no library complexity
4. **SVG Character** - Quick to implement, easy to modify, no external dependencies
5. **Mobile-First** - No hover states = works perfectly on touch devices
6. **V2 Deferred** - Ship fast, validate with users, then enhance

**What Makes It "Pixar Quality":**
- Premium materials (gradients, subsurface glow, realistic textures)
- Character with personality (not just decorative)
- Purposeful animations (every motion has meaning)
- Attention to detail (key separators, lacquer shine, ivory feel)
- Simplicity (no feature bloat, focused experience)

---

## 8. Next Steps

1. **Review & Approve** this design spec
2. **Create detailed implementation plan** (using superpowers:writing-plans)
3. **Set up git worktree** (using superpowers:using-git-worktrees)
4. **Implement Phase 1** (foundation)
5. **User testing** (validate before adding V2 features)

---

**Design Status:** ✅ Validated and Ready for Implementation
**Target Timeline:** 2-3 weeks for V1
**Review Date:** 2026-01-25
