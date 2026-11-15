import { expect, test, type Page } from '@playwright/test';
import {
  DEBRIS_FIXTURE,
  FIXTURE_OBJECTS,
  fixtureCatalogGzip,
  openOverview,
  serveCatalog,
} from './fixtures';

const FENGYUN = DEBRIS_FIXTURE['fengyun-1c-debris'];
const COSMOS = DEBRIS_FIXTURE['cosmos-2251-debris'];
const IRIDIUM = DEBRIS_FIXTURE['iridium-33-debris'];

interface LoadOptions {
  /** Whether the catalog lists some objects under the three debris groups. Default true. */
  readonly debris?: boolean;
  /** Whether the viewer has asked for reduced motion. Default true, so that nothing moves by itself. */
  readonly reducedMotion?: boolean;
}

async function load(page: Page, options: LoadOptions = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({
    reducedMotion: options.reducedMotion === false ? 'no-preference' : 'reduce',
  });
  const now = Date.now();
  await serveCatalog(
    page,
    fixtureCatalogGzip({
      fetchedAt: new Date(now).toISOString(),
      epochAtMs: now,
      withDebrisGroups: options.debris !== false,
    }),
  );
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  await openOverview(page);
  return errors;
}

async function openEvents(page: Page): Promise<void> {
  await page.locator('#events > summary').click();
}

// --- Debris from three break-ups ---------------------------------------------

test('singles out one debris cloud, tells its story, and puts everything back', async ({
  page,
}) => {
  const errors = await load(page);
  await openEvents(page);
  const headline = page.locator('#catalog-headline');
  const fengyun = page.getByRole('button', { name: /^2007 Fengyun-1C anti-satellite test/ });
  await expect(fengyun).toContainText(`${String(FENGYUN)} objects in today’s data`);
  await expect(fengyun).toHaveAttribute('aria-expanded', 'false');

  await fengyun.click();
  await expect(fengyun).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-event', 'fengyun-1c');
  await expect(headline).toHaveText(
    `Showing ${String(FENGYUN)} of ${String(FIXTURE_OBJECTS)} objects`,
  );
  await expect(page.locator('html')).toHaveAttribute('data-shown', String(FENGYUN));

  // The story is there, labelled for what it is, with where it came from.
  const body = page.locator('#event-fengyun-1c');
  await expect(body).toBeVisible();
  await expect(body.locator('.tag')).toHaveText('Real data');
  await expect(body).toContainText('11 January 2007, 22:26 UTC');
  await expect(body).toContainText('About 860 km up');
  await expect(body).toContainText('3,532, of which 2,793 were still in orbit on 31 January 2023');
  await body.getByText('Sources', { exact: true }).click();
  await expect(body).toContainText('History of On-orbit Satellite Fragmentations');

  // The filters are what did it, and they say so.
  await expect(page.locator('#filters-summary')).toHaveText('Filters (on)');
  await page.locator('#filters-summary').click();
  await expect(page.getByRole('button', { name: /^Fengyun-1C debris \d+$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await body.getByRole('button', { name: 'Show everything again' }).click();
  await expect(headline).toHaveText(`Showing ${String(FIXTURE_OBJECTS)} objects`);
  await expect(fengyun).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-event');
  await expect(page.locator('#filters-summary')).toHaveText('Filters');
  expect(errors).toEqual([]);
});

test('shows both clouds of the 2009 collision together', async ({ page }) => {
  await load(page);
  await openEvents(page);
  const collision = page.getByRole('button', {
    name: /^2009 Iridium 33 and Cosmos 2251 collision/,
  });
  await expect(collision).toContainText(`${String(COSMOS + IRIDIUM)} objects in today’s data`);
  await collision.click();
  await expect(page.locator('#catalog-headline')).toHaveText(
    `Showing ${String(COSMOS + IRIDIUM)} of ${String(FIXTURE_OBJECTS)} objects`,
  );
  const body = page.locator('#event-iridium-cosmos');
  await expect(body).toContainText('10 February 2009, 16:56 UTC');
  await expect(body).toContainText(`${String(COSMOS)} objects: Cosmos 2251 debris`);
  await expect(body).toContainText(`${String(IRIDIUM)} objects: Iridium 33 debris`);

  // Pressing the open event again closes it and brings everything back.
  await collision.click();
  await expect(collision).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#catalog-headline')).toHaveText(
    `Showing ${String(FIXTURE_OBJECTS)} objects`,
  );
});

test('moving from one event to another swaps the cloud on the globe', async ({ page }) => {
  await load(page);
  await openEvents(page);
  await page.getByRole('button', { name: /^2007 Fengyun-1C/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-shown', String(FENGYUN));
  await page.getByRole('button', { name: /^2009 Iridium 33/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-shown', String(COSMOS + IRIDIUM));
  await expect(page.locator('html')).toHaveAttribute('data-event', 'iridium-cosmos');
  await expect(page.locator('#event-fengyun-1c')).toBeHidden();
});

test('says plainly that none of the Cosmos 1408 cloud can be drawn, and hides nothing', async ({
  page,
}) => {
  await load(page);
  await openEvents(page);
  // Start with another event's cloud on the globe.
  await page.getByRole('button', { name: /^2007 Fengyun-1C/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-shown', String(FENGYUN));

  const cosmos = page.getByRole('button', { name: /^2021 Cosmos 1408 anti-satellite test/ });
  await expect(cosmos).toContainText('Nothing left in today’s data');
  await cosmos.click();
  await expect(cosmos).toHaveAttribute('aria-expanded', 'true');
  // The other event's cloud does not stay up beside this event's story.
  await expect(page.locator('#catalog-headline')).toHaveText(
    `Showing ${String(FIXTURE_OBJECTS)} objects`,
  );
  const body = page.locator('#event-cosmos-1408');
  await expect(body).toContainText('15 November 2021, 02:48 UTC');
  await expect(body).toContainText('publishes no list for it');
  await expect(body).toContainText('Today’s data contains no object from that launch either.');
  await expect(body).toContainText('so no number is given');
  await expect(body.getByRole('button', { name: 'Show everything again' })).toHaveCount(0);
});

test('follows the filters when the viewer changes them by hand', async ({ page }) => {
  await load(page);
  await openEvents(page);
  await page.locator('#filters-summary').click();
  const chip = page.getByRole('button', { name: /^Fengyun-1C debris \d+$/ });
  const event = page.getByRole('button', { name: /^2007 Fengyun-1C/ });

  // Asking for exactly one event's debris with the filter buttons opens that event.
  await chip.click();
  await expect(event).toHaveAttribute('aria-expanded', 'true');

  // Asking for something more means the globe no longer shows just that cloud.
  await page.getByRole('button', { name: /^Everything else \d+$/ }).click();
  await expect(event).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-event');
  // The viewer's own filters are left alone.
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('offers the stories even when the data holds none of the debris', async ({ page }) => {
  const errors = await load(page, { debris: false });
  await openEvents(page);
  const fengyun = page.getByRole('button', { name: /^2007 Fengyun-1C/ });
  await expect(fengyun).toContainText('Nothing left in today’s data');
  await fengyun.click();
  await expect(page.locator('#event-fengyun-1c')).toContainText('11 January 2007');
  await expect(page.locator('#catalog-headline')).toHaveText(
    `Showing ${String(FIXTURE_OBJECTS)} objects`,
  );
  expect(errors).toEqual([]);
});

// --- Growth of orbit ---------------------------------------------------------------

async function openGrowth(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Growth of orbit since 1957' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-growth', 'ready');
}

test('opens the growth chart on demand and cites where its numbers come from', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const errors = await load(page);
  // Neither the chart's code nor its data is part of the first download.
  expect(requested.filter((url) => url.includes('growthChart'))).toEqual([]);

  await openGrowth(page);
  expect(requested.filter((url) => url.includes('growthChart'))).toHaveLength(1);
  const dialog = page.getByRole('dialog', { name: 'Growth of orbit' });
  await expect(dialog).toBeVisible();

  // With reduced motion the chart is shown complete, at its last month.
  await expect(dialog.locator('.growth-month')).toHaveText('May 2026');
  await expect(dialog.locator('.growth-total')).toHaveText('33,480 objects');
  await expect(dialog.locator('#growth-body')).toHaveAttribute('data-playing', 'false');

  // The source is on the chart itself, with the label for real data.
  await expect(dialog.locator('.tag').first()).toHaveText('Real data');
  await expect(dialog).toContainText('NASA Orbital Debris Program Office');
  await expect(dialog).toContainText('volume 30, issues 1 & 2 (July 2026), page 9');
  await expect(dialog).toContainText('Counts as of 3 May 2026');
  await expect(dialog.getByRole('link', { name: 'Orbital Debris Quarterly News' })).toHaveAttribute(
    'href',
    /orbitaldebris\.jsc\.nasa\.gov/,
  );

  // Every kind is named with its figure, without relying on colour.
  const legend = dialog.locator('.growth-legend');
  await expect(legend.locator('li')).toHaveCount(5);
  await expect(legend).toContainText('Spacecraft17,950');
  await expect(legend).toContainText('Fragmentation debris10,880');
  await expect(legend).toContainText('Rocket bodies2,150');
  await expect(legend).toContainText('Mission-related debris1,820');

  // Five lines are drawn.
  await expect(dialog.locator('polyline.growth-line')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('moves through the months with the slider, by keyboard and by value', async ({ page }) => {
  await load(page);
  await openGrowth(page);
  const dialog = page.getByRole('dialog', { name: 'Growth of orbit' });
  const slider = dialog.getByRole('slider', { name: /^Month shown/ });

  await slider.focus();
  await slider.press('Home');
  await expect(dialog.locator('.growth-month')).toHaveText('January 1957');
  await expect(dialog.locator('.growth-total')).toHaveText('nothing in orbit yet');
  await expect(slider).toHaveAttribute('aria-valuetext', 'January 1957: 0 objects');

  await slider.press('ArrowRight');
  await expect(dialog.locator('.growth-month')).toHaveText('February 1957');

  // February 2009, the month of the collision: the step is in the figures.
  await slider.fill(String((2009 - 1957) * 12));
  await expect(dialog.locator('.growth-month')).toHaveText('January 2009');
  const before = await dialog.locator('.growth-legend li').nth(2).innerText();
  await slider.fill(String((2009 - 1957) * 12 + 1));
  await expect(dialog.locator('.growth-month')).toHaveText('February 2009');
  const after = await dialog.locator('.growth-legend li').nth(2).innerText();
  const count = (text: string): number => Number(text.replace(/\D+/g, ''));
  expect(count(after) - count(before)).toBeGreaterThan(2000);
  await expect(dialog.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('plays from 1957 when motion is allowed, and can be paused', async ({ page }) => {
  await load(page, { reducedMotion: false });
  await openGrowth(page);
  const body = page.locator('#growth-body');
  await expect(body).toHaveAttribute('data-playing', 'true');
  const monthShown = async (): Promise<number> => Number(await body.getAttribute('data-month'));
  await expect.poll(monthShown).toBeGreaterThan(24);
  expect(await monthShown()).toBeLessThan(832);

  // A mouse that happens to be over the plot does not stop the film. (The
  // dialog opens under the pointer, which a browser reports as a movement.)
  const dialog = page.getByRole('dialog', { name: 'Growth of orbit' });
  const plot = await dialog.locator('.growth-plot svg').boundingBox();
  if (plot === null) {
    throw new Error('The plot has no size');
  }
  await page.mouse.move(plot.x + plot.width * 0.3, plot.y + plot.height * 0.5);
  await page.mouse.move(plot.x + plot.width * 0.32, plot.y + plot.height * 0.5);
  await expect(body).toHaveAttribute('data-playing', 'true');

  // The page behind the dialog has a Pause button of its own (for the clock).
  await dialog.getByRole('button', { name: 'Pause' }).click();
  await expect(body).toHaveAttribute('data-playing', 'false');
  const paused = await monthShown();
  await page.waitForTimeout(400);
  expect(await monthShown()).toBe(paused);
  await expect(dialog.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

  // Once it has stopped, pointing at the plot shows the month pointed at.
  await page.mouse.move(plot.x + plot.width * 0.5, plot.y + plot.height * 0.5);
  await expect.poll(monthShown).not.toBe(paused);
  await expect(body).toHaveAttribute('data-playing', 'false');
});

test('gives the same figures as a table, and explains their limits', async ({ page }) => {
  await load(page);
  await openGrowth(page);
  const dialog = page.getByRole('dialog', { name: 'Growth of orbit' });
  await dialog.getByText('The numbers, decade by decade').click();
  const rows = dialog.locator('.growth-table tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(rows.first().locator('th')).toHaveText('January 1960');
  await expect(rows.last().locator('th')).toHaveText('May 2026');
  await expect(rows.last().locator('td').last()).toHaveText('33,480');

  await dialog.getByText('How these numbers were obtained, and their limits').click();
  await expect(dialog).toContainText('NASA publishes this chart but not the numbers behind it');
  await expect(dialog).toContainText('this site does not guess');
  await expect(dialog).toContainText(`${String(FIXTURE_OBJECTS)} objects this site draws`);
});

test('fits the screen and closes without disturbing a selection', async ({ page }) => {
  const errors = await load(page);
  const input = page.getByRole('combobox', { name: /^Search/ });
  await input.fill('28057');
  await input.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
  // On a phone the object's details take the overview's place; the chart is
  // opened from the overview, so the test reaches it through the page itself.
  await page.evaluate(() => {
    document.getElementById('growth-open')?.click();
  });
  await expect(page.locator('html')).toHaveAttribute('data-growth', 'ready');
  const dialog = page.getByRole('dialog', { name: 'Growth of orbit' });
  await expect(dialog).toBeVisible();

  // Nothing in the dialog is wider than the dialog, and the dialog is on screen.
  const fit = await dialog.evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    right: element.getBoundingClientRect().right,
    left: element.getBoundingClientRect().left,
    viewport: window.innerWidth,
  }));
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.left).toBeGreaterThanOrEqual(0);
  expect(fit.right).toBeLessThanOrEqual(fit.viewport);

  // Escape closes the dialog and only the dialog.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');

  // The close button works too, and the chart can be opened again.
  await page.evaluate(() => {
    document.getElementById('growth-open')?.click();
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});
