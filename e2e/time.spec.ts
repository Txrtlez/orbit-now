import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, serveCatalog } from './fixtures';

async function load(page: Page): Promise<string[]> {
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

/** The time the scene is showing minus the real time, in seconds. */
async function offsetSeconds(page: Page): Promise<number> {
  return page.evaluate(() => ((window.orbitNowDebug?.displayedTimeMs() ?? 0) - Date.now()) / 1000);
}

/** Show the slider if it is folded away, as it is on narrower screens. */
async function showSlider(page: Page): Promise<void> {
  const expand = page.locator('#time-expand');
  if ((await expand.isVisible()) && (await expand.getAttribute('aria-expanded')) === 'false') {
    await expand.click();
  }
  await expect(page.locator('#time-slider')).toBeVisible();
}

const HOUR = 3600;

test('starts on the present and says so', async ({ page }) => {
  await load(page);
  await expect(page.locator('#time-offset')).toHaveText('Live');
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Now', exact: true })).toBeHidden();
  expect(Math.abs(await offsetSeconds(page))).toBeLessThan(1);
  // A date, a time with seconds, and a time zone.
  await expect(page.locator('#time-label')).toHaveText(/\d{1,2}:\d{2}:\d{2}/);
});

test('pauses and resumes', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.locator('#time-offset')).toHaveText(/^Paused/);
  const before = await page.evaluate(() => window.orbitNowDebug?.displayedTimeMs());
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => window.orbitNowDebug?.displayedTimeMs())).toBe(before);

  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.orbitNowDebug?.displayedTimeMs())).toBeGreaterThan(
    before ?? Infinity,
  );
  // It resumed from where it stopped, so it now trails the present.
  await expect(page.locator('#time-offset')).toHaveText(/behind$/);
});

test('runs fast, keeps the objects on screen, and returns to the present', async ({ page }) => {
  const errors = await load(page);
  await page.getByLabel('Playback speed').selectOption('600');
  // 600 times normal speed is ten minutes a second.
  await expect.poll(() => offsetSeconds(page), { timeout: 15_000 }).toBeGreaterThan(20 * 60);
  await expect(page.locator('#time-offset')).toHaveText(/^600× speed · .+ ahead$/);
  // The objects are still being drawn somewhere on the screen.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const debug = window.orbitNowDebug;
        return debug === undefined
          ? 0
          : debug.noradIds().filter((id) => debug.screenPositionOf(id) !== null).length;
      }),
    )
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('#time-offset')).toHaveText('Live');
  await expect(page.getByLabel('Playback speed')).toHaveValue('1');
  expect(Math.abs(await offsetSeconds(page))).toBeLessThan(1);
  expect(errors).toEqual([]);
});

test('moves through time with the slider, by pointer value and by keyboard', async ({ page }) => {
  await load(page);
  await showSlider(page);
  const slider = page.locator('#time-slider');

  // The slider counts in minutes from the present.
  await slider.fill('360');
  expect(Math.abs((await offsetSeconds(page)) - 6 * HOUR)).toBeLessThan(5);
  await expect(page.locator('#time-offset')).toHaveText('6 h ahead');
  await expect(slider).toHaveAttribute('aria-valuetext', /6 h ahead$/);
  // The warning about accuracy appears only away from the present.
  await expect(page.locator('.time-note')).toBeVisible();

  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(Math.abs((await offsetSeconds(page)) - (6 * HOUR - 120))).toBeLessThan(5);

  await page.keyboard.press('Home');
  await expect(page.locator('#time-offset')).toHaveText('3 d behind');
  expect(Math.abs((await offsetSeconds(page)) + 72 * HOUR)).toBeLessThan(5);

  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await expect(page.locator('#time-offset')).toHaveText('Live');
  await expect(slider).toHaveValue('0');
  await expect(page.locator('.time-note')).toBeHidden();
});

test('moves the objects when the time is moved', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Pause' }).click();
  // Select something so that its live readout can be compared before and after.
  await page.getByRole('combobox', { name: /Search/ }).fill('28057');
  await page.getByRole('combobox', { name: /Search/ }).press('Enter');
  const above = page.locator('#object-panel .facts-live .fact').nth(2).locator('dd');
  await expect(above).toHaveText(/°/);
  const before = await above.innerText();

  await showSlider(page);
  await page.locator('#time-slider').fill('20');
  // Twenty minutes is a fifth of this object's orbit: it is over somewhere else.
  await expect(above).not.toHaveText(before);
  await expect(above).toHaveText(/°/);
});

test('stops at the limit instead of running on', async ({ page }) => {
  await load(page);
  await showSlider(page);
  await page.locator('#time-slider').fill('4315'); // five minutes short of three days ahead
  await page.getByLabel('Playback speed').selectOption('600');
  await expect(page.locator('#time-offset')).toHaveText('Paused · 3 d ahead', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});
