import { expect, test, type Page } from '@playwright/test';

/**
 * Collect anything the page reports as an error, so that each test can assert
 * that the console stayed clean.
 */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    // The build under test has no data directory, so the request for the
    // catalog is answered with 404, and the browser itself logs that. The
    // app handles the missing file deliberately (see catalog.spec.ts), so
    // that one message is expected. Any other error still fails the test.
    if (message.location().url.endsWith('/data/catalog.json.gz')) {
      return;
    }
    errors.push(`console.error: ${message.text()}`);
  });
  return errors;
}

/**
 * Count the distinct colours in a PNG. Decoding happens inside the browser so
 * that the test suite needs no image library of its own.
 */
async function countDistinctColours(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      throw new Error('2D canvas is unavailable');
    }
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const colours = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colours.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return colours.size;
  }, png.toString('base64'));
}

test('loads, starts the renderer and reports no errors', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');

  await expect(page).toHaveTitle('Orbit Now');
  await expect(page.getByRole('heading', { level: 1, name: 'Orbit Now' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');
  await expect(page.locator('#render-status')).toBeEmpty();
  await expect(page.locator('#build-info')).toHaveText(/^Build ([0-9a-f]{7}|unknown revision)/);

  expect(errors).toEqual([]);
});

test('actually draws the globe', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');

  // Sample a square at the centre of the viewport, where the globe is and no
  // interface element overlaps it. A canvas that failed to draw would be one
  // flat colour; the shaded globe and its grid lines produce many. The square
  // must be large (half the shorter side of the viewport) because the middle
  // of the globe, between grid lines, really is a single flat colour.
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('Viewport size is unavailable');
  }
  const size = Math.round(Math.min(viewport.width, viewport.height) / 2);
  const png = await page.screenshot({
    clip: {
      x: Math.round((viewport.width - size) / 2),
      y: Math.round((viewport.height - size) / 2),
      width: size,
      height: size,
    },
  });
  expect(await countDistinctColours(page, png)).toBeGreaterThan(16);
});

test('switches modes and loads the What if? code only on demand', async ({ page }) => {
  const errors = trackErrors(page);
  const whatIfRequests: string[] = [];
  page.on('request', (request) => {
    if (/whatif-[\w-]+\.js$/.test(new URL(request.url()).pathname)) {
      whatIfRequests.push(request.url());
    }
  });

  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');

  const nowTab = page.getByRole('tab', { name: 'Now' });
  const whatIfTab = page.getByRole('tab', { name: 'What if?' });
  // Each mode's layer covers the whole view; its card is what the viewer sees.
  const nowPanel = page.locator('#panel-now #overview');
  const whatIfPanel = page.locator('#panel-whatif #whatif-card');

  await expect(nowTab).toHaveAttribute('aria-selected', 'true');
  await expect(nowPanel).toBeVisible();
  await expect(whatIfPanel).toBeHidden();
  expect(whatIfRequests).toEqual([]);

  await whatIfTab.click();
  await expect(whatIfTab).toHaveAttribute('aria-selected', 'true');
  await expect(nowPanel).toBeHidden();
  await expect(whatIfPanel).toContainText('Illustrative model, not a prediction');
  await expect(page.locator('html')).toHaveAttribute('data-whatif', 'idle');
  expect(whatIfRequests).toHaveLength(1);

  // Keyboard: Left arrow from the second tab returns to the first.
  await whatIfTab.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(nowTab).toBeFocused();
  await expect(nowTab).toHaveAttribute('aria-selected', 'true');
  await expect(nowPanel).toBeVisible();
  await expect(whatIfPanel).toBeHidden();

  expect(errors).toEqual([]);
});
