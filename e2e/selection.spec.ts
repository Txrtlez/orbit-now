import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, serveCatalog } from './fixtures';

/**
 * Load the page with a catalog whose objects are in sensible present-day
 * positions, with the idle camera drift switched off so that nothing moves
 * between measuring where an object is and clicking it.
 */
async function loadWithObjects(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = Date.now();
  await serveCatalog(
    page,
    fixtureCatalogGzip({ fetchedAt: new Date(now).toISOString(), epochAtMs: now }),
  );
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  return errors;
}

interface Target {
  readonly noradId: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Find an object that can be clicked unambiguously: on screen, not behind
 * the Earth, not under any part of the interface, and well away from every
 * other object.
 */
async function findClickableObject(page: Page): Promise<Target | null> {
  return page.evaluate(() => {
    const debug = window.orbitNowDebug;
    if (debug === undefined) {
      return null;
    }
    const placed = debug
      .noradIds()
      .map((noradId) => ({ noradId, position: debug.screenPositionOf(noradId) }))
      .flatMap(({ noradId, position }) =>
        position === null ? [] : [{ noradId, x: position.x, y: position.y }],
      );
    const clear = placed.find(
      (candidate) =>
        document.elementFromPoint(candidate.x, candidate.y)?.id === 'globe' &&
        placed.every(
          (other) =>
            other.noradId === candidate.noradId ||
            Math.hypot(other.x - candidate.x, other.y - candidate.y) > 60,
        ),
    );
    return clear ?? null;
  });
}

/** Wait until some object can be clicked unambiguously, and say where it is. */
async function waitForClickableObject(page: Page): Promise<Target> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const target = await findClickableObject(page);
    if (target !== null) {
      return target;
    }
    if (Date.now() > deadline) {
      throw new Error('No object became clickable within 15 seconds');
    }
    await page.waitForTimeout(250);
  }
}

/** Find a spot on the globe view with no object anywhere near it. */
async function findEmptySpot(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const debug = window.orbitNowDebug;
    if (debug === undefined) {
      return null;
    }
    const placed = debug
      .noradIds()
      .map((noradId) => debug.screenPositionOf(noradId))
      .filter((position) => position !== null);
    for (let y = 100; y < window.innerHeight - 100; y += 20) {
      for (let x = 20; x < window.innerWidth - 20; x += 20) {
        if (
          document.elementFromPoint(x, y)?.id === 'globe' &&
          placed.every((position) => Math.hypot(position.x - x, position.y - y) > 60)
        ) {
          return { x, y };
        }
      }
    }
    return null;
  });
}

async function tapOrClick(page: Page, x: number, y: number, hasTouch: boolean): Promise<void> {
  if (hasTouch) {
    await page.touchscreen.tap(x, y);
  } else {
    await page.mouse.click(x, y);
  }
}

test('selects the object that is clicked or tapped and describes it', async ({
  page,
  hasTouch,
}) => {
  const errors = await loadWithObjects(page);
  const panel = page.locator('#object-panel');
  await expect(panel).toBeHidden();

  const { noradId, x, y } = await waitForClickableObject(page);
  await tapOrClick(page, x, y, hasTouch);

  await expect(page.locator('html')).toHaveAttribute('data-selected', String(noradId));
  await expect(panel).toBeVisible();
  await expect(panel.locator('#object-title')).toHaveText(
    `VERIFICATION ${String(noradId).padStart(5, '0')}`,
  );
  // Live figures have been filled in with plausible-looking values.
  await expect(panel.getByText(/^[\d,]+ km$/).first()).toBeVisible();
  await expect(panel.getByText(/^\d+\.\d\d km\/s$/)).toBeVisible();
  await expect(panel.getByText(/^(\d+\.\d° [NS]|0\.0°), (\d+\.\d° [EW]|0\.0°)$/)).toBeVisible();
  // Figures that come with the element set.
  await expect(panel).toContainText('Catalog number');
  await expect(panel).toContainText(String(noradId));
  await expect(panel).toContainText('Period');
  await expect(panel).toContainText('Inclination');

  expect(errors).toEqual([]);
});

test('clears the selection with the close button, the Escape key, or a tap on empty space', async ({
  page,
  hasTouch,
}) => {
  await loadWithObjects(page);
  const panel = page.locator('#object-panel');
  const html = page.locator('html');

  const select = async (): Promise<void> => {
    const found = await waitForClickableObject(page);
    await tapOrClick(page, found.x, found.y, hasTouch);
    await expect(panel).toBeVisible();
  };

  await select();
  await panel.getByRole('button', { name: 'Close object details' }).click();
  await expect(panel).toBeHidden();
  await expect(html).not.toHaveAttribute('data-selected');

  await select();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await select();
  const empty = await findEmptySpot(page);
  if (empty === null) {
    throw new Error('No empty spot was found');
  }
  await tapOrClick(page, empty.x, empty.y, hasTouch);
  await expect(panel).toBeHidden();
  await expect(html).not.toHaveAttribute('data-selected');
});

test('does not select anything when the globe is dragged', async ({ page }) => {
  await loadWithObjects(page);
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('Viewport size is unavailable');
  }
  const startX = viewport.width / 2;
  const startY = viewport.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 10, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('#object-panel')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-selected');
});
