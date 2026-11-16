import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_OBJECTS, fixtureCatalogGzip, openOverview, serveCatalog } from './fixtures';

/**
 * Phase 7: the guided tour, shareable links, the About page, the menu, and
 * accessibility checks that a machine can make.
 */

interface LoadOptions {
  readonly path?: string;
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
      withDebrisGroups: true,
    }),
  );
  await page.goto(options.path ?? './');
  await expect(page.locator('html')).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  return errors;
}

const menuButton = (page: Page) => page.getByRole('button', { name: /^Menu/ });

async function openMenu(page: Page): Promise<void> {
  await menuButton(page).click();
  await expect(page.locator('#more-list')).toBeVisible();
}

// --- The guided tour ----------------------------------------------------------

test.describe('on a first visit', () => {
  // No stored settings: this visitor has not seen the tour.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('starts the tour, which can be stepped through, left and taken again', async ({ page }) => {
    const errors = await load(page);
    const html = page.locator('html');
    const tour = page.locator('#tour');
    await expect(tour).toBeVisible();
    await expect(html).toHaveAttribute('data-tour', '1');
    await expect(tour).toContainText('Everything in orbit, right now');
    await expect(tour).toContainText(`There are ${String(FIXTURE_OBJECTS)} on this globe`);
    // Motion is reduced in this test, so the tour waits to be moved on.
    await expect(page.locator('#tour-pause')).toHaveText('Play');
    await expect(page.locator('#tour-back')).toBeDisabled();
    // The tracker's own cards are out of the way meanwhile.
    await expect(page.locator('#overview')).toBeHidden();

    // The stops that depend on the data name numbers counted from it.
    await page.locator('#tour-next').click();
    await expect(html).toHaveAttribute('data-tour', '2');
    await page.locator('#tour-back').click();
    await expect(html).toHaveAttribute('data-tour', '1');

    // Step to the last stop, which opens "What if?" and runs a collision.
    const stops = Number((await tour.locator('.tour-step').innerText()).split(' of ')[1]);
    expect(stops).toBeGreaterThanOrEqual(2);
    for (let step = 1; step < stops; step += 1) {
      await page.locator('#tour-next').click();
    }
    await expect(tour).toContainText('It is an illustration, not a prediction');
    await expect(page.getByRole('tab', { name: 'What if?' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(html).toHaveAttribute('data-whatif-trials', /\d+/, { timeout: 120_000 });
    await expect(page.locator('#tour-next')).toHaveText('Finish');
    // Finishing leaves the last stop on show.
    await page.locator('#tour-next').click();
    await expect(tour).toBeHidden();
    await expect(html).not.toHaveAttribute('data-tour');
    await expect(page.locator('#whatif-results')).toBeVisible();

    // It does not start by itself a second time, but it can be asked for.
    await page.reload();
    await expect(html).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
    await expect(tour).toBeHidden();
    await openMenu(page);
    await page.getByRole('button', { name: 'Take the one-minute tour' }).click();
    await expect(tour).toBeVisible();
    await expect(page.locator('#more-list')).toBeHidden();

    // Leaving part-way puts the site back as it opens.
    await page.locator('#tour-next').click();
    await page.locator('#tour-end').click();
    await expect(tour).toBeHidden();
    await expect(html).toHaveAttribute('data-shown', String(FIXTURE_OBJECTS));
    await expect(html).not.toHaveAttribute('data-selected');
    await expect(page.getByRole('tab', { name: 'Now' })).toHaveAttribute('aria-selected', 'true');
    expect(errors).toEqual([]);
  });

  test('moves on by itself when motion is allowed, and can be paused', async ({ page }) => {
    await load(page, { reducedMotion: false });
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-tour', '1');
    await expect(page.locator('#tour-pause')).toHaveText('Pause');
    await expect(html).toHaveAttribute('data-tour', '2', { timeout: 30_000 });
    await page.locator('#tour-pause').click();
    await expect(page.locator('#tour-pause')).toHaveText('Play');
    await page.keyboard.press('Escape');
    await expect(page.locator('#tour')).toBeHidden();
  });

  test('does not start the tour over a view that a link asked for', async ({ page }) => {
    await load(page, { path: './#o=28057' });
    await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
    await expect(page.locator('#tour')).toBeHidden();
  });
});

// --- Shareable links -----------------------------------------------------------

test('keeps the view in the address, and the address brings the view back', async ({
  page,
  context,
  browserName,
}) => {
  const errors = await load(page);
  const html = page.locator('html');
  expect(new URL(page.url()).hash).toBe('');

  // Filters first: on a phone they cannot be reached while an object is selected.
  await openOverview(page);
  await page.locator('#events > summary').click();
  await page.getByRole('button', { name: /Fengyun-1C/ }).click();
  await expect(html).toHaveAttribute('data-event', 'fengyun-1c');
  await expect.poll(() => new URL(page.url()).hash).toBe('#g=fengyun-1c-debris');

  const input = page.getByRole('combobox', { name: /^Search/ });
  await input.fill('28057');
  await input.press('Enter');
  await expect(html).toHaveAttribute('data-selected', '28057');
  await expect.poll(() => new URL(page.url()).hash).toBe('#o=28057&g=fengyun-1c-debris');
  const shown = await html.getAttribute('data-shown');

  // The menu copies the same address.
  // Chromium has to be told the page may use the clipboard. The other
  // engines do not know these names, and asking spoils the browser context.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await openMenu(page);
  await page.getByRole('button', { name: 'Copy a link to this view' }).click();
  await expect(page.locator('#share-status')).toHaveText(/Link copied\.|Copy the address below\./);
  const address = page.url();

  // Someone else opens it.
  const other = await context.newPage();
  const otherErrors = await load(other, { path: address });
  const otherHtml = other.locator('html');
  await expect(otherHtml).toHaveAttribute('data-selected', '28057');
  await expect(otherHtml).toHaveAttribute('data-shown', shown ?? '');
  await expect(otherHtml).toHaveAttribute('data-event', 'fengyun-1c');
  expect(new URL(other.url()).hash).toBe('#o=28057&g=fengyun-1c-debris');
  expect([...errors, ...otherErrors]).toEqual([]);
});

test('brings back a time, paused where it was shared', async ({ page }) => {
  const seconds = Math.round(Date.now() / 1000) + 3600;
  await load(page, { path: `./#t=${String(seconds)}` });
  const shownMs = await page.evaluate(() => window.orbitNowDebug?.displayedTimeMs() ?? 0);
  expect(Math.abs(shownMs - seconds * 1000)).toBeLessThan(1000);
  await expect(page.locator('#time-live')).toBeVisible();
  expect(new URL(page.url()).hash).toBe(`#t=${String(seconds)}`);
});

test('brings back a "What if?" run, the same cloud each time', async ({ page }) => {
  const link = './#m=whatif&s=stage-explosion&sun=quiet&run=2';
  const fragments: string[] = [];
  for (let visit = 0; visit < 2; visit += 1) {
    // A fresh page each time, as when the link is opened by someone else.
    await page.goto('about:blank');
    await load(page, { path: link });
    const html = page.locator('html');
    await expect(page.getByRole('tab', { name: 'What if?' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(html).toHaveAttribute('data-whatif', 'done', { timeout: 120_000 });
    await expect(page.locator('#whatif-preset')).toHaveValue('stage-explosion');
    await expect(page.locator('#whatif-sun')).toHaveValue('quiet');
    expect(new URL(page.url()).hash).toBe('#m=whatif&s=stage-explosion&sun=quiet&run=2');
    fragments.push(
      `${(await html.getAttribute('data-whatif-fragments')) ?? ''} ${await page.locator('#whatif-facts').innerText()}`,
    );
  }
  expect(fragments[1]).toBe(fragments[0]);
});

test('opens with a link it cannot fully understand, using what it can', async ({ page }) => {
  const errors = await load(page, {
    path: './#o=999999&g=nonsense.starlink&y=abc&zzz=%E0%A4%A&t=12',
  });
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-selected');
  await expect(html).toHaveAttribute('data-shown', String(FIXTURE_OBJECTS));
  expect(errors).toEqual([]);
});

// --- The About page and the menu -------------------------------------------------

test('explains the data, the models and their limits on the About page', async ({ page }) => {
  const errors = await load(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/about-[\w-]+\.js$/.test(new URL(request.url()).pathname)) {
      requests.push(request.url());
    }
  });
  await openMenu(page);
  await page.getByRole('button', { name: 'About the data and models' }).click();
  const dialog = page.getByRole('dialog', { name: 'About the data and models' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-about', 'ready');
  expect(requests).toHaveLength(1);
  for (const heading of [
    'The data',
    'The models',
    'Simplifications and limits',
    'Where “What if?” disagrees with what really happened',
    'Your place and your privacy',
    'Accessibility',
    'Credits',
    'The full record',
  ]) {
    await expect(
      dialog.getByRole('heading', {
        name: new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      }),
    ).toBeVisible();
  }
  await expect(dialog).toContainText(`This visit loaded ${String(FIXTURE_OBJECTS)} objects`);
  await expect(dialog).toContainText('CelesTrak');
  await expect(dialog).toContainText('is not a forecast of collisions');
  await expect(dialog.getByRole('link', { name: 'VALIDATION.md' })).toHaveAttribute(
    'href',
    /github\.com\/Txrtlez\/orbit-now/,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('lets the viewer turn motion down, and remembers it', async ({ page }) => {
  await load(page, { reducedMotion: false });
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-reduce-motion');
  await openMenu(page);
  await page.getByLabel('Reduce motion').check();
  await expect(html).toHaveAttribute('data-reduce-motion', 'true');
  await page.reload();
  await expect(html).toHaveAttribute('data-objects', String(FIXTURE_OBJECTS));
  await expect(html).toHaveAttribute('data-reduce-motion', 'true');
  await openMenu(page);
  await expect(page.getByLabel('Reduce motion')).toBeChecked();
  await page.getByLabel('Reduce motion').uncheck();
  await expect(html).not.toHaveAttribute('data-reduce-motion');
});

// --- Keyboard ------------------------------------------------------------------

test('can be worked from the keyboard: skip link, menu, and turning the globe', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'A phone has no keyboard to test');
  await load(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to search' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: /^Search/ })).toBeFocused();
  // Using the skip link leaves the address, and so the view, alone.
  expect(new URL(page.url()).hash).toBe('');

  // The menu opens and closes from the keyboard, and gives the focus back.
  await menuButton(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#more-list')).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Take the one-minute tour' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#more-list')).toBeHidden();
  await expect(menuButton(page)).toBeFocused();

  // Arrow keys turn the globe: something on it moves across the screen.
  const where = () =>
    page.evaluate(() => {
      const debug = window.orbitNowDebug;
      return (debug?.noradIds() ?? []).map((id) => debug?.screenPositionOf(id)?.x ?? null);
    });
  await page.locator('#globe').focus();
  const before = await where();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => JSON.stringify(await where())).not.toBe(JSON.stringify(before));
});

// --- Checks a machine can make ---------------------------------------------------

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function audit(page: Page, state: string): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${state}: ${violation.id} (${String(violation.nodes.length)}) ${violation.nodes[0]?.target.join(' ') ?? ''}`,
  );
}

test('passes an automated accessibility audit in its main states', async ({ page }) => {
  test.slow();
  await load(page);
  const found: string[] = [];
  await openOverview(page);
  found.push(...(await audit(page, 'tracker')));

  const input = page.getByRole('combobox', { name: /^Search/ });
  await input.fill('28057');
  await input.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-selected', '28057');
  found.push(...(await audit(page, 'object selected')));

  await openMenu(page);
  found.push(...(await audit(page, 'menu')));
  await page.getByRole('button', { name: 'About the data and models' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-about', 'ready');
  found.push(...(await audit(page, 'about')));
  await page.keyboard.press('Escape');

  await openMenu(page);
  await page.getByRole('button', { name: 'Take the one-minute tour' }).click();
  await expect(page.locator('#tour')).toBeVisible();
  found.push(...(await audit(page, 'tour')));
  await page.locator('#tour-end').click();

  await page.getByRole('tab', { name: 'What if?' }).click();
  await page.locator('#whatif-preset').selectOption('stage-explosion');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-whatif', 'done', { timeout: 120_000 });
  found.push(...(await audit(page, 'what if')));
  expect(found).toEqual([]);
});

test('has controls big enough to touch', async ({ page }) => {
  await load(page);
  await openOverview(page);
  await openMenu(page);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('button, select, input, summary, a[href], [role="tab"]')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && box.top >= 0;
      })
      .map((node) => {
        // A tick box is pressed through its label, which is the real target.
        const box = (node.closest('label') ?? node).getBoundingClientRect();
        return {
          what: `${node.tagName.toLowerCase()}#${node.id} ${node.textContent.trim().slice(0, 24)}`,
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      }),
  );
  expect(sizes.length).toBeGreaterThan(8);
  // WCAG 2.2 asks for 24 by 24 CSS pixels at least; this site aims for 44.
  const tooSmall = sizes.filter((size) => size.width < 24 || size.height < 24);
  expect(tooSmall).toEqual([]);
  const under44 = sizes.filter((size) => size.height < 44);
  expect(under44).toEqual([]);
});
