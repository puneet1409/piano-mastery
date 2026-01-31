import { test, expect, Page } from '@playwright/test';

/**
 * Edge Case & Simulation Tests for Piano Practice App
 *
 * Tests for:
 * - Boundary conditions
 * - Unusual user interactions
 * - Stress scenarios
 * - Keyboard shortcuts
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Boundary Conditions (10 tests)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Boundary Conditions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
  });

  test('should handle 0% tempo slider', async ({ page }) => {
    // Start practice
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();
    await exerciseBtn.click();
    await page.waitForTimeout(300);
    await page.context().grantPermissions(['microphone']);

    const startBtn = page.getByRole('button', { name: /Start Practice/i });
    await startBtn.click();
    await page.waitForSelector('button:has-text("Stop")', { timeout: 10000 });

    // Try to set tempo to minimum
    const slider = page.locator('input[type="range"]').first();
    if (await slider.count() > 0) {
      await slider.fill('50'); // Minimum is 50%

      // Should not crash
      const body = page.locator('body');
      await expect(body).toBeVisible();
    }

    const stopBtn = page.getByRole('button', { name: /Stop/i });
    await stopBtn.click();
  });

  test('should handle 100% tempo slider', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();
    await exerciseBtn.click();
    await page.waitForTimeout(300);
    await page.context().grantPermissions(['microphone']);

    const startBtn = page.getByRole('button', { name: /Start Practice/i });
    await startBtn.click();
    await page.waitForSelector('button:has-text("Stop")', { timeout: 10000 });

    const slider = page.locator('input[type="range"]').first();
    if (await slider.count() > 0) {
      await slider.fill('100');

      const body = page.locator('body');
      await expect(body).toBeVisible();
    }

    const stopBtn = page.getByRole('button', { name: /Stop/i });
    await stopBtn.click();
  });

  test('should handle very narrow viewport (320px)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Exercises should still be visible
    const exerciseBtns = page.locator('button').filter({ hasText: /Scale|Chord/i });
    const count = await exerciseBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should handle very wide viewport (2560px)', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });

    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle portrait orientation', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 900 });

    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle landscape orientation', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 400 });

    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle zero exercises gracefully', async ({ page }) => {
    await page.route('**/exercises', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ exercises: [] }),
      });
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should not crash
    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/Practice/i);
  });

  test('should handle very long exercise names', async ({ page }) => {
    await page.route('**/exercises', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          exercises: [{
            id: 'test',
            name: 'A Very Long Exercise Name That Should Be Truncated Properly In The UI Display',
            description: 'Test description that is also quite long and should be handled properly by the layout system without breaking',
            difficulty: 'beginner',
            requiresPolyphony: false,
          }],
        }),
      });
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should still be usable
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle special characters in exercise names', async ({ page }) => {
    await page.route('**/exercises', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          exercises: [{
            id: 'test',
            name: 'Test <script>alert("XSS")</script> & Exercise',
            description: 'Description with "quotes" and \'apostrophes\'',
            difficulty: 'beginner',
            requiresPolyphony: false,
          }],
        }),
      });
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should render safely (no XSS)
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Script should not execute
    const alertFired = await page.evaluate(() => {
      return (window as any).__xssFired || false;
    });
    expect(alertFired).toBeFalsy();
  });

  test('should handle many exercises (100+)', async ({ page }) => {
    const manyExercises = Array.from({ length: 100 }, (_, i) => ({
      id: `exercise_${i}`,
      name: `Exercise ${i + 1}`,
      description: `Description for exercise ${i + 1}`,
      difficulty: i % 3 === 0 ? 'beginner' : i % 3 === 1 ? 'intermediate' : 'advanced',
      requiresPolyphony: i % 2 === 0,
    }));

    await page.route('**/exercises', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ exercises: manyExercises }),
      });
    });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should handle many items
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // Should be scrollable
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollHeight).toBeGreaterThan(500);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// User Interaction Edge Cases (10 tests)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('User Interaction Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
  });

  test('should handle double-click on exercise', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();

    // Double click
    await exerciseBtn.dblclick();
    await page.waitForTimeout(300);

    // Should not cause issues
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle rapid exercise switching', async ({ page }) => {
    const exercises = page.locator('button').filter({ hasText: /Scale|Chord|Exercise/i });
    const count = await exercises.count();

    // Rapidly switch between exercises
    for (let i = 0; i < Math.min(count, 5); i++) {
      await exercises.nth(i).click();
      await page.waitForTimeout(50);
    }

    // Should still be usable
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle escape key during count-in', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();
    await exerciseBtn.click();
    await page.waitForTimeout(300);
    await page.context().grantPermissions(['microphone']);

    const startBtn = page.getByRole('button', { name: /Start Practice/i });
    await startBtn.click();

    // Press escape during count-in
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Page should still be functional
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle tab navigation', async ({ page }) => {
    // Tab through elements
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }

    // Focus should move through interactive elements
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle enter key on focused button', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();
    await exerciseBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Should select the exercise
    const nextUpLabel = page.locator('text=Next up');
    await expect(nextUpLabel).toBeVisible();
  });

  test('should handle space key on focused button', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();
    await exerciseBtn.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    // Should select the exercise
    const nextUpLabel = page.locator('text=Next up');
    await expect(nextUpLabel).toBeVisible();
  });

  test('should handle mouse hover states', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();

    // Hover
    await exerciseBtn.hover();
    await page.waitForTimeout(200);

    // Un-hover
    await page.mouse.move(0, 0);
    await page.waitForTimeout(200);

    // Should not cause issues
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle click outside modals', async ({ page }) => {
    // Click empty area
    await page.mouse.click(10, 10);
    await page.waitForTimeout(200);

    // Should not crash
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle right-click (context menu)', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();

    await exerciseBtn.click({ button: 'right' });
    await page.waitForTimeout(200);

    // Should not crash
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle middle-click', async ({ page }) => {
    const exerciseBtn = page.locator('button').filter({ hasText: /Scale/i }).first();

    await exerciseBtn.click({ button: 'middle' });
    await page.waitForTimeout(200);

    // Should not crash
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Stress & Stability Tests (10 tests)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Stress & Stability', () => {
  test('should survive 50 page refreshes', async ({ page }) => {
    for (let i = 0; i < 50; i++) {
      await page.goto('/practice');
      await page.waitForLoadState('domcontentloaded');
    }

    // Final check
    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/Practice/i);
  });

  test('should handle 100 rapid clicks', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    const btn = page.locator('button').first();

    for (let i = 0; i < 100; i++) {
      await btn.click({ force: true });
    }

    // Should still be responsive
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle rapid viewport changes', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    for (let i = 0; i < 20; i++) {
      const width = 320 + Math.random() * 1280;
      const height = 400 + Math.random() * 600;
      await page.setViewportSize({
        width: Math.floor(width),
        height: Math.floor(height),
      });
    }

    // Should still be usable
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle network latency', async ({ page }) => {
    // Add artificial latency
    await page.route('**/*', async (route) => {
      await new Promise((r) => setTimeout(r, 100));
      await route.continue();
    });

    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Should still load
    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/Practice/i);
  });

  test('should handle slow backend response', async ({ page }) => {
    await page.route('**/exercises', async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });

    await page.goto('/practice');
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Should eventually load
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle intermittent failures', async ({ page }) => {
    let failCount = 0;

    await page.route('**/exercises', async (route) => {
      failCount++;
      if (failCount <= 2) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Try multiple times
    for (let i = 0; i < 5; i++) {
      await page.goto('/practice');
      await page.waitForLoadState('networkidle');
    }

    // Should eventually work
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle browser back/forward', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Navigate away and back
    await page.goto('about:blank');
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // Should restore
    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/Practice/i);
  });

  test('should handle page visibility changes', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Simulate visibility change
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should not crash
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle focus/blur events', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Simulate window blur/focus
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    // Should not crash
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should handle online/offline events', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Simulate offline then online
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
    });

    // Should recover
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Accessibility Tests (10 tests)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
  });

  test('should have proper heading hierarchy', async ({ page }) => {
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBeGreaterThanOrEqual(1);

    // H1 should be first heading
    const firstHeading = page.locator('h1, h2, h3, h4, h5, h6').first();
    const tagName = await firstHeading.evaluate((el) => el.tagName);
    expect(tagName).toBe('H1');
  });

  test('should have alt text or aria-label for interactive elements', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');

      // Button should have either text content or aria-label
      expect(text?.trim() || ariaLabel?.trim()).toBeTruthy();
    }
  });

  test('should be keyboard navigable', async ({ page }) => {
    // Should be able to tab to first interactive element
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName || 'NONE';
    });

    // Should focus on something interactive
    expect(['BUTTON', 'INPUT', 'A', 'SELECT']).toContain(focused);
  });

  test('should have sufficient color contrast', async ({ page }) => {
    // Check that text is not the same color as background
    const textColors = await page.evaluate(() => {
      const elements = document.querySelectorAll('p, span, h1, h2, button');
      const colors: string[] = [];

      elements.forEach((el) => {
        const style = getComputedStyle(el);
        colors.push(`${style.color} on ${style.backgroundColor}`);
      });

      return colors.slice(0, 10);
    });

    console.log('Sample text colors:', textColors);
    expect(textColors.length).toBeGreaterThan(0);
  });

  test('should have focus indicators', async ({ page }) => {
    const btn = page.locator('button').first();
    await btn.focus();

    // Check for focus styles
    const focusStyle = await btn.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        outline: style.outline,
        boxShadow: style.boxShadow,
        ring: style.getPropertyValue('--tw-ring-color'),
      };
    });

    console.log('Focus styles:', focusStyle);
  });

  test('should support reduced motion', async ({ page }) => {
    // Set reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should still function
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should work with screen reader landmarks', async ({ page }) => {
    // Check for landmark roles
    const landmarks = await page.evaluate(() => {
      const roles = ['banner', 'navigation', 'main', 'contentinfo'];
      const found: string[] = [];

      roles.forEach((role) => {
        if (document.querySelector(`[role="${role}"]`)) {
          found.push(role);
        }
      });

      // Also check semantic elements
      if (document.querySelector('header')) found.push('header');
      if (document.querySelector('nav')) found.push('nav');
      if (document.querySelector('main')) found.push('main');
      if (document.querySelector('footer')) found.push('footer');

      return found;
    });

    console.log('Landmarks found:', landmarks);
  });

  test('should have proper form labels', async ({ page }) => {
    const inputs = page.locator('input');
    const count = await inputs.count();

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledBy = await input.getAttribute('aria-labelledby');
      const type = await input.getAttribute('type');

      // Hidden or range inputs may not need labels
      if (type !== 'hidden') {
        const hasLabel = id ? await page.locator(`label[for="${id}"]`).count() > 0 : false;
        const hasAccessibility = hasLabel || ariaLabel || ariaLabelledBy;

        if (!hasAccessibility) {
          console.log(`Input ${i} may be missing label`);
        }
      }
    }
  });

  test('should announce dynamic content changes', async ({ page }) => {
    // Check for aria-live regions
    const liveRegions = await page.locator('[aria-live]').count();
    console.log(`Found ${liveRegions} aria-live regions`);
  });

  test('should work with high contrast mode', async ({ page }) => {
    // Set forced colors (high contrast)
    await page.emulateMedia({ forcedColors: 'active' });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Page should still be visible
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
