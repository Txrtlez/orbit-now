import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { fixtureCatalogGzip, openOverview, serveCatalog } from './fixtures';

test('says plainly when the site has no orbital data', async ({ page }) => {
  // The build under test contains no data directory, as on a developer's machine.
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'missing');
  await expect(page.locator('#catalog-headline')).toHaveText('No orbital data');
  await openOverview(page);
  await expect(page.locator('#catalog-status')).toContainText('has no orbital data yet');
});

test('loads a compressed catalog and reports what it contains', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000 - 60_000).toISOString();
  await serveCatalog(page, fixtureCatalogGzip({ fetchedAt: threeHoursAgo }));
  await page.goto('./');

  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'loaded');
  await expect(page.locator('#catalog-headline')).toHaveText('Showing 31 objects');
  await openOverview(page);
  const status = page.locator('#catalog-status');
  await expect(status).toContainText('not the full public catalog');

  await status.getByText('About this data').click();
  await expect(status).toContainText('Orbital elements published by Test fixture');
  await expect(status).toContainText('Verification element sets: 31');
  await expect(status).toContainText('Downloaded 3 hours ago or more recently.');

  // The background thread prepared SGP4 for every object and delivered the
  // first keyframes, so the objects are on the globe.
  await expect(page.locator('html')).toHaveAttribute('data-objects', '31');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');
  expect(errors).toEqual([]);
});

test('reports a damaged catalog instead of showing wrong numbers', async ({ page }) => {
  await serveCatalog(page, gzipSync('{"format":"nonsense"}'));
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'error');
  await expect(page.locator('#catalog-headline')).toHaveText('Orbital data unavailable');
  await openOverview(page);
  await expect(page.locator('#catalog-status')).toContainText('could not be loaded');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');
});

test('folds and unfolds the overview card', async ({ page }) => {
  await page.goto('./');
  const toggle = page.locator('#overview-toggle');
  const body = page.locator('#overview-body');
  await openOverview(page);
  await expect(body).toBeVisible();
  await toggle.click();
  await expect(body).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAccessibleName('Show details');
  // The title and the one-line summary stay in view.
  await expect(page.locator('#overview-title')).toBeVisible();
  await expect(page.locator('#catalog-headline')).toBeVisible();
});
