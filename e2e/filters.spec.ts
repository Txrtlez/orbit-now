import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, openOverview, serveCatalog } from './fixtures';

async function loadWithFiltersOpen(page: Page): Promise<string[]> {
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
  await openOverview(page);
  await page.locator('#filters-summary').click();
  return errors;
}

/** How many objects are currently drawn, according to the page itself. */
async function drawnCount(page: Page): Promise<number> {
  return Number(await page.locator('html').getAttribute('data-shown'));
}

test('filters by orbit regime and reports how many objects remain', async ({ page }) => {
  const errors = await loadWithFiltersOpen(page);
  const headline = page.locator('#catalog-headline');
  await expect(headline).toHaveText('Showing 31 objects');

  // Each button carries the number of objects behind it.
  const leo = page.getByRole('button', { name: /^LEO \d+$/ });
  const heo = page.getByRole('button', { name: /^HEO \d+$/ });
  const leoCount = Number((await leo.innerText()).replace(/\D+/g, ''));
  const heoCount = Number((await heo.innerText()).replace(/\D+/g, ''));
  expect(leoCount).toBeGreaterThan(0);
  expect(heoCount).toBeGreaterThan(0);
  expect(leoCount + heoCount).toBeLessThan(FIXTURE_OBJECTS);

  await heo.click();
  await expect(heo).toHaveAttribute('aria-pressed', 'true');
  await expect(headline).toHaveText(`Showing ${String(heoCount)} of 31 objects`);
  await expect(page.locator('#filters-summary')).toHaveText('Filters (on)');
  expect(await drawnCount(page)).toBe(heoCount);

  // Ticking a second regime widens the selection.
  await leo.click();
  await expect(headline).toHaveText(`Showing ${String(heoCount + leoCount)} of 31 objects`);

  await heo.click();
  await expect(heo).toHaveAttribute('aria-pressed', 'false');
  await expect(headline).toHaveText(`Showing ${String(leoCount)} of 31 objects`);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(headline).toHaveText('Showing 31 objects');
  await expect(leo).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('filters by launch year', async ({ page }) => {
  await loadWithFiltersOpen(page);
  const headline = page.locator('#catalog-headline');

  // The verification element sets were launched between 1958 and 2006.
  await page.getByLabel('Earliest launch year').fill('2000');
  await expect(headline).toHaveText(/^Showing \d+ of 31 objects$/);
  const since2000 = await drawnCount(page);
  expect(since2000).toBeGreaterThan(0);
  expect(since2000).toBeLessThan(FIXTURE_OBJECTS);

  await page.getByLabel('Latest launch year').fill('1999');
  await expect(headline).toHaveText('Showing 0 of 31 objects');

  await page.getByLabel('Earliest launch year').fill('');
  await expect(headline).not.toHaveText('Showing 0 of 31 objects');
  const upTo1999 = await drawnCount(page);
  expect(upTo1999).toBeGreaterThan(0);
  // The two ranges do not overlap. They need not add up to everything: an
  // object whose designator cannot be read has no known launch year, and
  // is left out of both.
  expect(upTo1999 + since2000).toBeLessThanOrEqual(FIXTURE_OBJECTS);

  // A half-typed year is not treated as a limit.
  await page.getByLabel('Latest launch year').fill('19');
  await expect(headline).toHaveText('Showing 31 objects');
});

test('hides filtered-out objects from the globe but keeps the selected one', async ({ page }) => {
  await loadWithFiltersOpen(page);
  // Before filtering, a low-orbit object is drawn somewhere (possibly behind
  // the Earth, so only "is it hidden by the filter" is checked below).
  await page.getByRole('button', { name: /^HEO \d+$/ }).click();
  await expect(page.locator('#catalog-headline')).toHaveText(/^Showing \d+ of 31 objects$/);

  // Catalog number 28057 is in low Earth orbit, so the filter hides it; the
  // search still finds it, and selecting it brings it back into view.
  await page.getByRole('combobox', { name: /^Search/ }).fill('28057');
  await page.getByRole('combobox', { name: /^Search/ }).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
  await expect(page.locator('#object-title')).toHaveText('VERIFICATION 28057');
  await expect
    .poll(() => page.evaluate(() => window.orbitNowDebug?.screenPositionOf(28057) ?? null))
    .not.toBeNull();

  // Another low-orbit object stays hidden, wherever it is.
  expect(
    await page.evaluate(() => window.orbitNowDebug?.screenPositionOf(29238) ?? null),
  ).toBeNull();
});
