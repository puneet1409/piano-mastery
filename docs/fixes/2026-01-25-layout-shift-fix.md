# Layout Shift Fix - Piano UI

**Date:** 2026-01-25
**Issue:** "Clumsy" UI appearance and noticeable layout shift when pressing buttons

## Root Cause Analysis

### Problem 1: Transform-based hover effects causing layout shift

**Location:** `src/app/globals.css` lines 70-72, 93-99

```css
/* BEFORE (Caused layout shift) */
.brutal-card:hover {
  transform: translate(-2px, -2px);  /* ❌ Physically moves element */
  box-shadow: 10px 10px 0 var(--concrete-900);  /* ❌ Shadow grows */
}

.brutal-btn:hover:not(:disabled) {
  transform: translate(-2px, -2px);  /* ❌ Physically moves element */
  box-shadow: 6px 6px 0 var(--concrete-900);
}

.brutal-btn:active:not(:disabled) {
  transform: translate(2px, 2px);  /* ❌ Moves in opposite direction */
}
```

**Why this caused layout shift:**
- `translate()` physically moves elements, pushing surrounding content
- Box-shadow size changes from 4px to 10px, affecting layout bounds
- No fixed-size container to constrain movement
- Violates zero-layout-shift principle used in piano KeySlot/KeyFace pattern

### Problem 2: Inline styles overriding CSS classes

**Location:** `src/app/practice/page.tsx` (multiple locations)

```tsx
/* BEFORE (Inline styles creating inconsistency) */
<button
  className="mt-6 w-full py-4 bg-green-500..."
  style={{ border: "3px solid black", boxShadow: "6px 6px 0 black" }}  /* ❌ */
>
```

**Why this was problematic:**
- Inline styles override global `.brutal-btn` class
- Created visual inconsistency across different buttons
- Made hover effects unpredictable
- Harder to maintain consistent design

## The Fix

### 1. Zero-Layout-Shift Hover Effects

```css
/* AFTER (No layout shift) */
.brutal-card {
  background: white;
  border: var(--brutal-border);
  box-shadow: var(--brutal-shadow);
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;  /* ✅ GPU acceleration */
}

.brutal-card:hover {
  transform: scale(1.01);  /* ✅ Scale instead of translate */
  box-shadow: var(--brutal-shadow-hover, 8px 8px 0 var(--concrete-900));
}

.brutal-btn:hover:not(:disabled) {
  transform: scale(1.02);  /* ✅ Subtle scale - no layout shift */
  box-shadow: var(--brutal-shadow-sm);  /* ✅ Consistent shadow size */
}

.brutal-btn:active:not(:disabled) {
  transform: scale(0.98);  /* ✅ Scale down for tactile feedback */
}
```

**Benefits:**
- `scale()` grows/shrinks element in place (no layout shift)
- Fixed shadow size prevents boundary changes
- `will-change: transform` enables GPU acceleration
- Smooth, performant animations

### 2. Remove Inline Styles, Use CSS Classes

```tsx
/* AFTER (Clean, consistent styling) */
<button
  className="brutal-btn mt-6 w-full py-4 bg-green-500 text-white font-bold text-xl hover:bg-green-600"
>
  ▶ START EXERCISE
</button>

<button
  className="brutal-card p-4 text-left ${
    selectedExercise?.id === ex.id
      ? "bg-electric-blue text-white"
      : "bg-white hover:bg-concrete-100"
  }`}
>
```

## Files Modified

1. **`src/app/globals.css`**
   - Changed `.brutal-card:hover` from `translate()` to `scale(1.01)`
   - Changed `.brutal-btn:hover` from `translate()` to `scale(1.02)`
   - Changed `.brutal-btn:active` from `translate()` to `scale(0.98)`
   - Added `will-change: transform` for GPU acceleration
   - Made shadow sizes consistent

2. **`src/app/practice/page.tsx`**
   - Removed all inline `style={{ border, boxShadow }}` props
   - Added `brutal-card` class to exercise selection buttons
   - Added `brutal-btn` class to START and STOP buttons
   - Added `brutal-card` class to next-expected-notes display

3. **`src/app/calibrate/page.tsx`**
   - Removed inline `style={{ border, boxShadow }}` from START/STOP button
   - Added `brutal-btn` class

## Testing Instructions

1. Navigate to http://localhost:3000/practice
2. Hover over exercise selection cards - should see subtle scale, no shift
3. Click "START EXERCISE" button - should see smooth press animation, no layout shift
4. During exercise, click "STOP" button - same smooth behavior
5. Check CharacterStage and keyboard components - should remain stable

## Expected Results

**Before fix:**
- ❌ Buttons and cards "jump" on hover/click
- ❌ Surrounding content shifts when interacting with elements
- ❌ Visual jank and inconsistent shadows
- ❌ Poor user experience, feels "clumsy"

**After fix:**
- ✅ Smooth scale animations with no layout shift
- ✅ Consistent visual design across all brutal-cards and brutal-btns
- ✅ Professional, polished feel
- ✅ Follows same zero-layout-shift pattern as piano KeySlot/KeyFace components

## Architecture Notes

This fix applies the same **Zero Layout Shift Pattern** used in the piano keyboard components:

**Piano Keyboard Pattern (KeySlot/KeyFace):**
```tsx
<KeySlot width={100} height={700}> {/* Fixed container */}
  <KeyFace /> {/* Animates with transform only */}
</KeySlot>
```

**Brutal UI Pattern (now applied):**
```css
.brutal-card {
  /* Fixed dimensions via CSS */
  will-change: transform;
}

.brutal-card:hover {
  /* Animate ONLY transform (no width/height/margin/padding) */
  transform: scale(1.01);
}
```

**Key Principle:** Never animate properties that trigger reflow (width, height, margin, padding, border). Only animate transform and opacity for GPU-accelerated, reflow-free animations.

## Related Documentation

- Piano components README: `src/components/piano/README.md`
- Zero-layout-shift architecture section
- Animation timings and performance guidelines
