import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, openOverview, serveCatalog } from './fixtures';

/**
 * The "Passes over you" panel. The fixture catalog has no space stations,
 * so these tests use its low-orbit objects, listed under a pretend group of
 * bright objects. Whether the predicted times are right is checked
 * elsewhere, against Heavens-Above (tests/validation/iss-passes.test.ts);
 * here the question is whether the page works.
 */

async function load(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = Date.now();
  await serveCatalog(
    page,
    fixtureCatalogGzip({
      fetchedAt: new Date(now).toISOString(),
      epochAtMs: now,
      withBrightGroup: true,
    }),
  );
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  return errors;
}

async function openPasses(page: Page): Promise<void> {
  await openOverview(page);
  await page.locator('#passes > summary').click();
  await expect(page.locator('#passes-panel')).toBeVisible();
}

const placeField = (page: Page) => page.getByRole('combobox', { name: /^City/ });

/** Give a place by typing coordinates, and wait for the passes to be worked out. */
async function chooseCoordinates(page: Page, text: string): Promise<void> {
  await placeField(page).fill(text);
  await expect(page.getByRole('option', { name: /Use these coordinates/ })).toBeVisible();
  await placeField(page).press('Enter');
  await expect(page.locator('#passes-panel')).toHaveAttribute('data-located', 'true');
  await expect(page.locator('#passes-panel')).toHaveAttribute('data-computing', 'false');
}

test('explains itself and asks for a place before listing anything', async ({ page }) => {
  const errors = await load(page);
  await openPasses(page);
  const panel = page.locator('#passes-panel');
  await expect(panel).toContainText('stays in this browser');
  await expect(panel).toContainText('not sent anywhere');
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
  await expect(placeField(page)).toBeVisible();
  await expect(panel.locator('.pass')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-observer', /./);
  expect(errors).toEqual([]);
});

test('finds a city by name without sending what was typed anywhere', async ({ page }) => {
  await load(page);
  await openPasses(page);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await placeField(page).fill('atlan');
  const option = page.getByRole('option', { name: /^Atlanta/ }).first();
  await expect(option).toBeVisible();
  await expect(option).toContainText('GA, United States');
  await option.click();

  await expect(page.locator('.passes-place')).toContainText('Atlanta, GA, United States');
  await expect(page.locator('html')).toHaveAttribute('data-observer', '33.75,-84.39');
  // A city from the list brings its own time zone.
  await expect(page.locator('.passes-summary')).toContainText(/local to the place \(E[SD]T\)/);

  // The only thing fetched was the list of places, from this site itself.
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) {
    expect(new URL(url).origin).toBe(new URL(page.url()).origin);
    expect(url.toLowerCase()).not.toContain('atlan');
  }
  expect(requests.some((url) => url.endsWith('/places.txt'))).toBe(true);
});

test('remembers the place on the next visit and forgets it when asked', async ({ page }) => {
  await load(page);
  await openPasses(page);
  await chooseCoordinates(page, '30, 0');
  await expect(page.locator('.passes-place')).toContainText('30.0° N, 0.0°');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  await expect(page.locator('html')).toHaveAttribute('data-observer', '30,0');
  await openPasses(page);
  await expect(page.locator('.passes-place')).toContainText('30.0° N');

  await page.getByRole('button', { name: 'Change place' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-observer', /./);
  await expect(placeField(page)).toBeVisible();
  expect(await page.evaluate(() => window.localStorage.length)).toBe(0);
});

test('lists passes with their three moments, and more of them when asked', async ({ page }) => {
  const errors = await load(page);
  await openPasses(page);
  await chooseCoordinates(page, '30, 0');
  const panel = page.locator('#passes-panel');

  // The fixture has no space stations, and the other satellites are not asked for yet.
  await expect(panel.locator('.pass')).toHaveCount(0);
  await expect(panel).toContainText('does not include the space stations');

  await page.getByLabel(/other bright satellites/).check();
  await expect(panel).toHaveAttribute('data-computing', 'false');
  await page.getByLabel('Include passes that cannot be seen').check();
  const total = Number(await panel.getAttribute('data-passes'));
  expect(total).toBeGreaterThan(20);

  // Twenty rows at first, then twenty more.
  await expect(panel.locator('.pass')).toHaveCount(20);
  await page.getByRole('button', { name: /^Show more/ }).click();
  await expect(panel.locator('.pass')).toHaveCount(Math.min(40, total));

  const first = panel.locator('.pass').first();
  await expect(first.locator('.pass-status')).toHaveText(
    /^(Visible|Daylight|In Earth's shadow) · \d+ (s|min)$/,
  );
  await expect(first.locator('dt')).toHaveText([
    /^(Appears|Rises)$/,
    'Highest',
    /^(Disappears|Sets)$/,
  ]);
  await expect(first.locator('.pass-time')).toHaveText([
    /\d{1,2}:\d{2}:\d{2}/,
    /\d{1,2}:\d{2}:\d{2}/,
    /\d{1,2}:\d{2}:\d{2}/,
  ]);
  // Elevation and compass point; nothing is listed below ten degrees.
  const highest = await first.locator('dl > div').nth(1).locator('dd').nth(1).textContent();
  expect(highest).toMatch(/^\d{1,2}° [NESW]{1,3}$/);
  expect(Number((highest ?? '').split('°')[0])).toBeGreaterThanOrEqual(10);
  // Days are headed, starting with today or tomorrow.
  await expect(panel.locator('.pass-day-title').first()).toHaveText(/^(Today|Tomorrow), /);

  // Leaving out the passes that cannot be seen shortens the list.
  await page.getByLabel('Include passes that cannot be seen').uncheck();
  expect(Number(await panel.getAttribute('data-passes'))).toBeLessThan(total);
  for (const row of await panel.locator('.pass').all()) {
    await expect(row).toHaveAttribute('data-visible', 'true');
  }
  expect(errors).toEqual([]);
});

test('shows a pass in the 3D view: moves the clock to it and selects the satellite', async ({
  page,
}) => {
  const errors = await load(page);
  await openPasses(page);
  await chooseCoordinates(page, '30, 0');
  await page.getByLabel(/other bright satellites/).check();
  await page.getByLabel('Include passes that cannot be seen').check();
  const panel = page.locator('#passes-panel');
  await expect(panel).toHaveAttribute('data-computing', 'false');

  // A pass far enough ahead that jumping to it is unmistakable.
  const row = panel.locator('.pass').nth(5);
  const noradId = await row.getAttribute('data-norad');
  await row.getByRole('button', { name: /^Show this pass/ }).click();

  await expect(page.locator('html')).toHaveAttribute('data-selected', noradId ?? '');
  const offsetSeconds = await page.evaluate(
    () => ((window.orbitNowDebug?.displayedTimeMs() ?? 0) - Date.now()) / 1000,
  );
  expect(offsetSeconds).toBeGreaterThan(60);
  await expect(page.locator('#time-offset')).toHaveText(/ahead$/);
  expect(errors).toEqual([]);
});

test('uses the device position when allowed', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278 });
  await load(page);
  await openPasses(page);
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.locator('.passes-place')).toContainText('Your location');
  // Kept to a hundredth of a degree, no finer.
  await expect(page.locator('html')).toHaveAttribute('data-observer', '51.51,-0.13');
  await expect(page.locator('.passes-summary')).toContainText('your device’s time zone');
});

test('says what to do when the device position is refused', async ({ page }) => {
  await load(page);
  await openPasses(page);
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.locator('.passes-notice')).toContainText(
    /Type a city or coordinates instead\.$/,
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-observer', /./);
  await expect(placeField(page)).toBeVisible();
});
