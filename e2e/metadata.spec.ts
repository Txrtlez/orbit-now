import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, openOverview, serveCatalog } from './fixtures';

/**
 * These tests use a catalog that carries satellite-catalog fields. The
 * values are invented (see `withInventedMetadata` in fixtures.ts): the
 * first object, catalog number 5, is given kind "PAY", status "+", owner
 * "US" and launch date 1990-02-03.
 */
async function load(page: Page, withInventedMetadata: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const now = Date.now();
  await serveCatalog(
    page,
    fixtureCatalogGzip({
      fetchedAt: new Date(now - 5 * 3_600_000).toISOString(),
      epochAtMs: now,
      withInventedMetadata,
    }),
  );
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
}

test('shows kind, status, owner and launch date when the catalog carries them', async ({
  page,
}) => {
  await load(page, true);
  await page.getByRole('combobox', { name: /^Search/ }).fill('5');
  await page.getByRole('combobox', { name: /^Search/ }).press('Enter');
  const panel = page.locator('#object-panel');
  await expect(panel.locator('#object-title')).toHaveText('VERIFICATION 00005');
  await expect(panel).toContainText('Payload');
  await expect(panel).toContainText('Operational');
  await expect(panel).toContainText('United States (US)');
  await expect(panel).toContainText('1990-02-03');
});

test('works without those fields, falling back to the launch year from the designator', async ({
  page,
}) => {
  await load(page, false);
  await page.getByRole('combobox', { name: /^Search/ }).fill('5');
  await page.getByRole('combobox', { name: /^Search/ }).press('Enter');
  const panel = page.locator('#object-panel');
  await expect(panel.locator('#object-title')).toHaveText('VERIFICATION 00005');
  // Catalog number 5 has the designator 1958-002B.
  await expect(panel).toContainText('1958');
  await expect(panel).not.toContainText('Owner');
  await expect(panel).not.toContainText('Kind');

  await page.keyboard.press('Escape');
  await openOverview(page);
  await page.locator('#filters-summary').click();
  await expect(page.getByRole('group', { name: 'Kind' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Owner' })).toHaveCount(0);
});

test('filters by kind and by owner', async ({ page }) => {
  await load(page, true);
  await openOverview(page);
  await page.locator('#filters-summary').click();
  const headline = page.locator('#catalog-headline');

  // 31 objects with kinds assigned in rotation: 11 payloads, 10 rocket bodies, 10 debris.
  await page.getByRole('button', { name: /^Debris 10$/ }).click();
  await expect(headline).toHaveText('Showing 10 of 31 objects');
  await page.getByRole('button', { name: /^Rocket body 10$/ }).click();
  await expect(headline).toHaveText('Showing 20 of 31 objects');

  // Owners are assigned in a rotation of four; the list shows names and counts.
  const owner = page.getByRole('combobox', { name: 'Owner' });
  await expect(owner.locator('option').nth(1)).toHaveText(/^.+ \(8\)$/);
  await owner.selectOption('ESA');
  await expect(headline).toHaveText(/^Showing \d of 31 objects$/);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(headline).toHaveText('Showing 31 objects');
  await expect(owner).toHaveValue('');
});

test('says where the descriptive fields come from', async ({ page }) => {
  await load(page, true);
  await openOverview(page);
  await page.locator('#catalog-status').getByText('About this data').click();
  await expect(page.locator('#catalog-status')).toContainText(
    'Kind, owner, status and launch date come from the satellite catalog published by Test fixture, downloaded 5 hours ago or more recently.',
  );
});
