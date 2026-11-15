import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, serveCatalog } from './fixtures';

/**
 * Mode B, "What if?". These tests run the real simulation on its
 * background thread, with the small test catalog standing in for the
 * tracker's data. They check that the mode works and says what it should,
 * not that its numbers are right: that is the job of the validation tests.
 */

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

async function openWhatIf(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'What if?' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-whatif', 'idle');
}

async function runAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-whatif', 'done', { timeout: 120_000 });
}

test('runs an explosion and reports what the model gives, labelled as a model', async ({
  page,
}) => {
  const errors = await load(page);
  await openWhatIf(page);
  const card = page.locator('#whatif-card');
  await expect(card).toContainText('Illustrative model, not a prediction');
  await expect(page.locator('#whatif-results')).toBeHidden();

  await page.locator('#whatif-preset').selectOption('stage-explosion');
  await expect(page.locator('#whatif-preset-note')).toContainText('Made up');
  await runAndWait(page);

  await expect(page.locator('#whatif-status')).toHaveText('Done: 12 repetitions.');
  await expect(page.locator('html')).toHaveAttribute('data-whatif-trials', '12');
  // The model's own formula gives 239 pieces of 10 cm and more for this event.
  const fragments = Number(await page.locator('html').getAttribute('data-whatif-fragments'));
  expect(fragments).toBeGreaterThan(200);
  expect(fragments).toBeLessThan(260);
  const results = page.locator('#whatif-results');
  await expect(results).toContainText('Fragments 10 cm and larger');
  await expect(results.getByRole('columnheader', { name: 'Still in orbit' }).first()).toBeVisible();
  await expect(results).toContainText('if none dodged');
  await expect(page.locator('#whatif-caveat')).toContainText('not as a count of collisions');
  // An explosion has no closing speed, and a made-up event has no history to compare with.
  await expect(results).not.toContainText('Closing speed');
  await expect(page.locator('#whatif-really')).toBeHidden();
  // The chart describes itself and has a table behind it.
  await expect(results.getByRole('img')).toHaveAttribute('aria-label', /still in orbit/);
  await results.getByText('The chart as a table').click();
  await expect(results.locator('.whatif-chart tbody tr')).toHaveCount(9);
  expect(errors).toEqual([]);
});

test('moves the cloud through time, and fewer fragments are left as time passes', async ({
  page,
}) => {
  await load(page);
  await openWhatIf(page);
  await page.locator('#whatif-preset').selectOption('stage-explosion');
  await runAndWait(page);

  const html = page.locator('html');
  const moment = page.locator('#whatif-moment');
  const slider = page.locator('#whatif-time');
  await expect(moment).toContainText('6 hours after');
  const early = Number(await html.getAttribute('data-whatif-in-orbit'));

  await slider.fill('1000');
  await expect(moment).toContainText('100 years after');
  // From 600 km nearly everything has come down within a century.
  expect(Number(await html.getAttribute('data-whatif-in-orbit'))).toBeLessThan(early / 10);
  await slider.fill('0');
  await expect(moment).toContainText('1 minute after');
  expect(Number(await html.getAttribute('data-whatif-in-orbit'))).toBeGreaterThanOrEqual(early);

  // Play runs the clock forward by itself and can be paused.
  const play = page.locator('#whatif-play');
  await play.click();
  await expect(play).toHaveText('Pause');
  await expect(moment).not.toContainText('1 minute after');
  await play.click();
  await expect(play).toHaveText('Play');

  // Clear takes the results away.
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.locator('#whatif-results')).toBeHidden();
  await expect(html).toHaveAttribute('data-whatif', 'idle');
  await expect(html).not.toHaveAttribute('data-whatif-fragments');
});

test('says what a collision does and compares a history-like event with what really happened', async ({
  page,
}) => {
  test.slow();
  const errors = await load(page);
  await openWhatIf(page);
  await page.locator('#whatif-preset').selectOption('two-satellites');
  await page.locator('#whatif-sun').selectOption('active');
  await runAndWait(page);
  const results = page.locator('#whatif-results');
  await expect(results).toContainText('Closing speed');
  await expect(results).toContainText('11.6 km/s');
  await expect(results).toContainText('Both bodies destroyed');
  await expect(results).toContainText('Pieces of: Lighter satellite');
  await expect(results).toContainText('Pieces of: Heavier satellite');
  await expect(page.locator('#whatif-really')).toContainText('2,372 catalogued pieces');
  expect(errors).toEqual([]);
});

test('breaks up the object selected in the tracker', async ({ page }) => {
  const errors = await load(page);
  await openWhatIf(page);
  await page.locator('#whatif-preset').selectOption('selected-object');
  const note = page.locator('#whatif-preset-note');
  await expect(note).toContainText('Nothing is selected');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('#whatif-status')).toContainText('Nothing is selected');
  await expect(page.locator('html')).toHaveAttribute('data-whatif', 'idle');

  // Pick an object in the tracker and come back.
  await page.getByRole('tab', { name: 'Now' }).click();
  const input = page.getByRole('combobox', { name: /^Search/ });
  await input.fill('28057');
  await input.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
  await page.getByRole('tab', { name: 'What if?' }).click();
  await expect(note).toContainText('where it is at the time the tracker is showing');

  // Something light runs into it: too little energy to destroy it.
  await page.locator('#whatif-event').selectOption('collision');
  await page.locator('#whatif-mass').fill('3000');
  await page.locator('#whatif-other-mass').fill('0.5');
  await page.locator('#whatif-angle').fill('60');
  await runAndWait(page);
  await expect(page.locator('#whatif-results')).toContainText('The heavier body survives');

  // An explosion needs neither of the collision's fields.
  await page.locator('#whatif-event').selectOption('explosion');
  await expect(page.locator('#whatif-other-mass')).toBeHidden();
  await runAndWait(page);
  await expect(page.locator('#whatif-results')).not.toContainText('Closing speed');
  expect(errors).toEqual([]);
});

test('hides the cloud when the tab is left and keeps the results for the return', async ({
  page,
}) => {
  await load(page);
  await openWhatIf(page);
  await page.locator('#whatif-preset').selectOption('stage-explosion');
  await runAndWait(page);
  await page.getByRole('tab', { name: 'Now' }).click();
  await expect(page.locator('#whatif-card')).toBeHidden();
  await page.getByRole('tab', { name: 'What if?' }).click();
  await expect(page.locator('#whatif-results')).toBeVisible();
  await expect(page.locator('#whatif-moment')).toContainText('fragments in orbit');
});
