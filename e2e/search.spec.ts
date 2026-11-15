import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, serveCatalog } from './fixtures';

async function loadWithObjects(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Reduced motion: camera moves happen at once, so positions can be checked immediately.
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

test('is switched off until there are objects to search', async ({ page }) => {
  // No catalog is served, as on a developer's machine.
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-catalog', 'missing');
  await expect(page.getByRole('combobox')).toBeDisabled();
});

test('suggests objects as the viewer types and selects one with the keyboard', async ({ page }) => {
  const errors = await loadWithObjects(page);
  const input = page.getByRole('combobox');
  const list = page.getByRole('listbox');
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('placeholder', 'Search 31 objects');

  await input.fill('verification 28');
  await expect(list).toBeVisible();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  const options = list.getByRole('option');
  // The fixture has catalog numbers 28057, 28129, 28350, 28623, 28626 and 28872.
  await expect(options).toHaveCount(6);
  await expect(options.first()).toContainText('VERIFICATION 28057');
  await expect(options.first()).toContainText('No. 28057');
  await expect(page.locator('#search-status')).toHaveText(/^6 suggestions/);

  // The arrow keys move a highlight; focus stays in the text field.
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute(
    'aria-activedescendant',
    (await options.nth(1).getAttribute('id')) ?? '',
  );
  await expect(input).toBeFocused();
  await input.press('ArrowUp');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');

  await input.press('Enter');
  await expect(list).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
  await expect(page.locator('#object-title')).toHaveText('VERIFICATION 28057');
  await expect(input).toHaveValue('VERIFICATION 28057');

  expect(errors).toEqual([]);
});

test('finds an object by catalog number and turns the camera to it', async ({ page }) => {
  await loadWithObjects(page);
  const input = page.getByRole('combobox');
  await input.fill('28057');
  await expect(page.getByRole('option').first()).toContainText('VERIFICATION 28057');
  // Enter with nothing highlighted takes the best match.
  await input.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');

  // The object now faces the viewer: it is drawn, and horizontally in the middle of the view.
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('Viewport size is unavailable');
  }
  await expect
    .poll(async () => {
      const position = await page.evaluate(
        () => window.orbitNowDebug?.screenPositionOf(28057) ?? null,
      );
      return position === null ? Infinity : Math.abs(position.x - viewport.width / 2);
    })
    .toBeLessThan(viewport.width * 0.06);
});

test('selects a suggestion that is clicked or tapped', async ({ page }) => {
  await loadWithObjects(page);
  await page.getByRole('combobox').fill('29238');
  await page.getByRole('option', { name: /VERIFICATION 29238/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-selected', '29238');
  await expect(page.getByRole('listbox')).toBeHidden();
});

test('Escape closes the suggestions first, and only then the object panel', async ({ page }) => {
  await loadWithObjects(page);
  const input = page.getByRole('combobox');
  const list = page.getByRole('listbox');
  const panel = page.locator('#object-panel');

  await input.fill('28057');
  await input.press('Enter');
  await expect(panel).toBeVisible();

  await input.fill('verification');
  await expect(list).toBeVisible();
  await input.press('Escape');
  await expect(list).toBeHidden();
  await expect(panel).toBeVisible();

  await input.press('Escape');
  await expect(panel).toBeHidden();
});

test('says so when nothing matches', async ({ page }) => {
  await loadWithObjects(page);
  await page.getByRole('combobox').fill('no such satellite');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.locator('#search-status')).toHaveText('No matching objects.');
});
