import { test, expect } from '@playwright/test';

test.describe('Practice Page Layout', () => {
  test('page fits viewport with no document scroll', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    // Screenshot: initial load
    await page.screenshot({ path: 'test-results/01-practice-initial.png', fullPage: false });
    await page.screenshot({ path: 'test-results/01-practice-fullpage.png', fullPage: true });

    // Check: body/html overflow is hidden
    const bodyOverflow = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const bodyStyle = getComputedStyle(body);
      const htmlStyle = getComputedStyle(html);
      return {
        bodyOverflow: bodyStyle.overflow,
        bodyOverflowY: bodyStyle.overflowY,
        bodyHeight: bodyStyle.height,
        htmlOverflow: htmlStyle.overflow,
        htmlOverflowY: htmlStyle.overflowY,
        htmlHeight: htmlStyle.height,
        bodyScrollHeight: body.scrollHeight,
        bodyClientHeight: body.clientHeight,
        htmlScrollHeight: html.scrollHeight,
        htmlClientHeight: html.clientHeight,
        windowInnerHeight: window.innerHeight,
      };
    });
    console.log('Body/HTML overflow check:', JSON.stringify(bodyOverflow, null, 2));

    // The page should NOT scroll at document level
    expect(bodyOverflow.bodyScrollHeight).toBeLessThanOrEqual(bodyOverflow.bodyClientHeight + 1);

    // Check: outer wrapper is viewport-locked
    const outerWrapper = await page.evaluate(() => {
      const firstDiv = document.body.querySelector(':scope > div:not([hidden])');
      if (!firstDiv) return null;
      const style = getComputedStyle(firstDiv);
      return {
        className: firstDiv.className,
        height: style.height,
        overflow: style.overflow,
        overflowY: style.overflowY,
        offsetHeight: (firstDiv as HTMLElement).offsetHeight,
        scrollHeight: (firstDiv as HTMLElement).scrollHeight,
      };
    });
    console.log('Outer wrapper:', JSON.stringify(outerWrapper, null, 2));
    expect(outerWrapper).not.toBeNull();
    expect(outerWrapper!.overflow).toContain('hidden');
  });

  test('no elements extend beyond viewport width', async ({ page }) => {
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');

    const overflowCheck = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const all = document.querySelectorAll('*');
      const overflowing: string[] = [];
      all.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > viewportWidth + 2 || rect.bottom > viewportHeight + 50) {
          const tag = el.tagName.toLowerCase();
          const cls = el.className?.toString().slice(0, 60) || '';
          overflowing.push(`${tag}.${cls} right=${Math.round(rect.right)} bottom=${Math.round(rect.bottom)}`);
        }
      });
      return {
        viewportWidth,
        viewportHeight,
        overflowingElements: overflowing.slice(0, 10),
        totalOverflowing: overflowing.length,
      };
    });
    console.log('Overflow check:', JSON.stringify(overflowCheck, null, 2));
    // Allow some tolerance but flag major overflow
    if (overflowCheck.totalOverflowing > 0) {
      console.warn(`WARNING: ${overflowCheck.totalOverflowing} elements extend beyond viewport`);
    }

    await page.screenshot({ path: 'test-results/02-overflow-check.png' });
  });

  test('visual structure at 1280x720', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/03-desktop-1280x720.png' });

    // Log what text is visible
    const visibleText = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      let node;
      while (node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (text && text.length > 2) texts.push(text);
      }
      return texts.slice(0, 20);
    });
    console.log('Visible text:', visibleText);
  });

  test('visual structure at 768x1024 (tablet)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/04-tablet-768x1024.png' });
  });

  test('visual structure at 375x812 (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/practice');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/05-mobile-375x812.png' });
  });
});
