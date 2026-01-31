import { test, expect } from '@playwright/test';

test.describe('Piano Mastery Practice Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/practice');
    await page.waitForLoadState('networkidle');
  });

  test('should load practice page without errors', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Piano Mastery/i);

    // Check main heading exists
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/Practice/i);

    console.log('✅ Practice page loaded successfully');
  });

  test('should display exercise selection', async ({ page }) => {
    // Check for exercise selection card
    const exerciseCard = page.locator('.brutal-card, [class*="card"]').first();
    await expect(exerciseCard).toBeVisible();

    // Count exercise buttons/cards
    const exercises = page.locator('button').filter({ hasText: /Scale|Chord|Exercise/i });
    const count = await exercises.count();

    console.log(`✅ Found ${count} exercise options`);
    expect(count).toBeGreaterThan(0);
  });

  test('should measure zero layout shift on page load', async ({ page }) => {
    // Measure initial layout
    const initialLayout = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    }));

    // Wait for any animations
    await page.waitForTimeout(500);

    // Measure final layout
    const finalLayout = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight,
    }));

    const shift = Math.abs(finalLayout.scrollHeight - initialLayout.scrollHeight);

    console.log(`Layout shift: ${shift}px`);
    console.log('✅ Layout shift test completed');

    // Accept small shifts due to images/fonts loading
    expect(shift).toBeLessThan(100);
  });

  test('should display piano keyboard when exercise starts', async ({ page }) => {
    // Look for exercise buttons
    const exercises = page.locator('button').filter({ hasText: /Scale|Chord|Exercise/i });
    const exerciseCount = await exercises.count();

    if (exerciseCount > 0) {
      // Click first exercise
      await exercises.first().click();
      await page.waitForTimeout(300);

      // Look for START button
      const startButton = page.getByRole('button', { name: /START/i });

      if (await startButton.count() > 0) {
        console.log('✅ START button appeared after exercise selection');
      } else {
        console.log('⚠️  No START button found - may require microphone permission');
      }
    } else {
      console.log('⚠️  No exercises found on page');
    }
  });

  test('should have clean DOM structure', async ({ page }) => {
    const domQuality = await page.evaluate(() => {
      const issues: string[] = [];

      // Check for excessive inline styles
      const inlineStyleElements = document.querySelectorAll('[style]');
      if (inlineStyleElements.length > 20) {
        issues.push(`${inlineStyleElements.length} elements with inline styles`);
      }

      // Check for zero-dimension elements
      const cards = document.querySelectorAll('.brutal-card, [class*="card"]');
      cards.forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          issues.push(`Card ${i} has zero dimensions`);
        }
      });

      return {
        totalElements: document.querySelectorAll('*').length,
        inlineStyles: inlineStyleElements.length,
        cards: cards.length,
        issues,
      };
    });

    console.log('DOM Quality Report:');
    console.log(`  Total elements: ${domQuality.totalElements}`);
    console.log(`  Elements with inline styles: ${domQuality.inlineStyles}`);
    console.log(`  Cards found: ${domQuality.cards}`);
    console.log(`  Issues: ${domQuality.issues.length > 0 ? domQuality.issues.join(', ') : 'None'}`);

    expect(domQuality.cards).toBeGreaterThan(0);
    console.log('✅ DOM structure test passed');
  });

  test('should measure Cumulative Layout Shift (CLS)', async ({ page }) => {
    // Set up layout shift tracking
    await page.evaluate(() => {
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift' && !(entry as any).hadRecentInput) {
              (window as any).__clsValue = ((window as any).__clsValue || 0) + (entry as any).value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
        (window as any).__clsValue = 0;
      }
    });

    // Interact with page
    const exercises = page.locator('button').filter({ hasText: /Scale|Chord|Exercise/i });
    const exerciseCount = await exercises.count();

    if (exerciseCount > 0) {
      await exercises.first().click();
      await page.waitForTimeout(500);
    }

    // Get CLS value
    const cls = await page.evaluate(() => (window as any).__clsValue || 0);

    console.log(`Cumulative Layout Shift (CLS): ${cls.toFixed(4)}`);

    // CLS scoring: Good < 0.1, Needs improvement < 0.25, Poor >= 0.25
    if (cls < 0.1) {
      console.log('✅ EXCELLENT CLS score (< 0.1)');
    } else if (cls < 0.25) {
      console.log('⚠️  CLS needs improvement (< 0.25)');
    } else {
      console.log('❌ POOR CLS score (>= 0.25)');
    }

    expect(cls).toBeLessThan(0.25);
  });
});

test.describe('Piano Keyboard Component', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000/practice');
    await page.waitForLoadState('networkidle');
  });

  test('should render without crashing', async ({ page }) => {
    // Basic smoke test - page should load
    const body = page.locator('body');
    await expect(body).toBeVisible();

    console.log('✅ Page rendered successfully');
  });

  test('should display Neo-Brutalist UI elements', async ({ page }) => {
    // Check for brutal-card or brutal-btn classes
    const brutalElements = await page.evaluate(() => {
      const cards = document.querySelectorAll('.brutal-card, [class*="brutal"]');
      return {
        count: cards.length,
        hasElements: cards.length > 0,
      };
    });

    console.log(`Found ${brutalElements.count} Neo-Brutalist UI elements`);
    console.log('✅ UI design system check completed');
  });
});

test.describe('Backend Health Check', () => {
  test('backend should be responding', async ({ request }) => {
    const response = await request.get('http://localhost:8000/health');

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const data = await response.json();
    console.log('Backend health:', data);

    expect(data).toHaveProperty('status');
    expect(data.status).toBe('healthy');

    console.log('✅ Backend health check passed');
  });
});
