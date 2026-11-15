import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { mergeCatalog } from '../pipeline/merge';
import { parseOmmCsv } from '../pipeline/omm';
import { encodeCatalog } from '../src/catalog/format';
import { verificationSetAsOmmCsv } from '../tests/pipeline/fixtureCsv';

/**
 * A catalog built by the real pipeline code from the published SGP4
 * verification element sets (31 objects after the pipeline's checks), as the
 * gzip-compressed file the deployed site serves.
 */
function fixtureCatalogGzip(fetchedAt: string): Buffer {
  const parsed = parseOmmCsv(verificationSetAsOmmCsv(), Date.parse(fetchedAt));
  const catalog = mergeCatalog(
    null,
    new Map([['fixture', { elementSets: parsed.elementSets, fetchedAt }]]),
    [
      {
        id: 'fixture',
        label: 'Verification element sets',
        provider: 'Test fixture',
        url: 'https://example.invalid/',
        minimumObjects: 1,
      },
    ],
    fetchedAt,
  );
  return gzipSync(encodeCatalog(catalog));
}

test('says plainly when the site has no orbital data', async ({ page }) => {
  // The build under test contains no data directory, as on a developer's machine.
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'missing');
  await expect(page.locator('#catalog-status')).toContainText('has no orbital data yet');
});

test('loads a compressed catalog and reports what it contains', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000 - 60_000).toISOString();
  await page.route('**/data/catalog.json.gz', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/gzip',
      body: fixtureCatalogGzip(threeHoursAgo),
    }),
  );
  await page.goto('./');

  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'loaded');
  const status = page.locator('#catalog-status');
  await expect(status).toContainText('Showing 31 objects');
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
  await page.route('**/data/catalog.json.gz', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/gzip',
      body: gzipSync('{"format":"nonsense"}'),
    }),
  );
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'error');
  await expect(page.locator('#catalog-status')).toContainText('could not be loaded');
  await expect(page.locator('html')).toHaveAttribute('data-renderer', 'ready');
});
