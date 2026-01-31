# Piano Components - V1

Premium piano keyboard components with Pixar-quality character integration.

## Components

### PianoKeyboard

Main piano keyboard component with responsive octave ranges.

**Props:**
- `detectedNotes?: string[]` - Currently detected notes (e.g., `['C4', 'E4']`)
- `expectedNotes?: string[]` - Expected notes to play (highlighted)
- `showLabels?: boolean` - Show note labels on keys (default: `true`)
- `startOctave?: Octave` - Starting octave (default: `3`)
- `endOctave?: Octave` - Ending octave (default: `6`)

**Example:**
```tsx
<PianoKeyboard
  detectedNotes={['C4']}
  expectedNotes={['C4', 'E4', 'G4']}
  showLabels={true}
  startOctave={3}
  endOctave={6}
/>
```

### CharacterStage

Nota character with score display.

**Props:**
- `accuracy: number` - Accuracy percentage (0-100)
- `streak: number` - Current streak count
- `lastResult?: 'correct' | 'wrong' | null` - Last note result
- `noDetectionTime?: number` - Time in ms with no detection

**Example:**
```tsx
<CharacterStage
  accuracy={87}
  streak={12}
  lastResult="correct"
  noDetectionTime={0}
/>
```

### NotaSVG

Animated musical note character.

**Props:**
- `state: 'idle' | 'excited' | 'sad' | 'confused'` - Emotional state
- `size?: number` - Size in pixels (default: `80`)

**States:**
- `idle` - Gentle bounce (default waiting state)
- `excited` - Bigger bounce + sparkles (streak 3+)
- `sad` - Slump animation (after mistake)
- `confused` - Head tilt + question mark (no detection 10s+)

## Architecture

### Zero Layout Shift Pattern

All animations use the **KeySlot + KeyFace** pattern:

```tsx
<KeySlot width={100} height={700}> {/* Fixed size container */}
  <KeyFace {...props} /> {/* Animates with transform only */}
</KeySlot>
```

**Rules:**
- ✅ Animate: `transform`, `opacity`, `box-shadow`
- ❌ Never animate: `width`, `height`, `padding`, `margin`, `border`

### Black Key Positioning

Black keys use **correct piano pattern** (not evenly spaced):

```typescript
const BLACK_KEY_OFFSETS = {
  'C#': 0.65,  // Between C-D
  'D#': 1.65,  // Between D-E
  // NO BLACK between E-F
  'F#': 3.65,  // Between F-G
  'G#': 4.65,  // Between G-A
  'A#': 5.65,  // Between A-B
  // NO BLACK between B-C
};
```

### State Machine

**Base States** (mutually exclusive):
- `idle` - Default
- `expected` - Next note (breathing glow)
- `disabled` - Not playable

**Overlays** (temporary, auto-clear):
- `pressed` (80ms) - Physical depression
- `hitCorrect` (300ms) - Cyan pulse
- `hitWrong` (250ms) - Red shake

## Responsive Breakpoints

```css
Desktop (1024px+):  3 octaves (C3-C6)
Tablet (640-1023px): 2 octaves (C4-C6)
Mobile (<640px):     1 octave (C4-C5)
```

## Animation Timings

```typescript
const TIMINGS = {
  keyPress: 80,           // Snappy
  correctFeedback: 300,   // Satisfying
  wrongFeedback: 250,     // Brief
  breathingCycle: 1400,   // Calm
};
```

## Premium Materials

**White Keys:** Ivory gradient with subtle depth
**Black Keys:** Ebony gradient with lacquer shine

See `piano.module.css` for complete styling.

## Dependencies

**Zero external dependencies:**
- Pure React + TypeScript
- CSS Modules only
- No animation libraries (CSS-only)
- No SVG libraries (inline SVG)

## Performance

- Fixed-size containers = no reflow
- CSS animations (GPU accelerated)
- Minimal re-renders (useMemo, useCallback)
- Responsive but performant (resize debounced)

## V2 Features (Deferred)

- 2.5D perspective transform
- Spring physics library
- Timing lane (Guitar Hero style)
- Duration ribbons
- Rive/Lottie character upgrade
- Particle effects
