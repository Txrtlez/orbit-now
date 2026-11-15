import { gzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { mergeCatalog } from '../pipeline/merge';
import { parseOmmCsv } from '../pipeline/omm';
import { encodeCatalog } from '../src/catalog/format';
import { verificationSetAsOmmCsv } from '../tests/pipeline/fixtureCsv';

/** Number of objects in the fixture catalog. */
export const FIXTURE_OBJECTS = 31;

export interface FixtureOptions {
  /** When the catalog claims to have been downloaded (ISO 8601). */
  readonly fetchedAt: string;
  /**
   * If given, every element set's epoch is moved to this instant
   * (milliseconds since 1970-01-01 UTC).
   *
   * The verification element sets date from 1980 to 2006. Propagated to the
   * present they are decades out of date and many end up in impossible
   * places. Moving the epoch makes them behave like freshly published
   * orbits, so that tests which need objects in sensible positions have
   * some. The result is a TEST FIXTURE, not real data: real elements with
   * an invented date. It is never shown outside the tests.
   */
  readonly epochAtMs?: number;
}

/**
 * A catalog built by the real pipeline code from the published SGP4
 * verification element sets (31 objects after the pipeline's checks), as the
 * gzip-compressed file the deployed site serves.
 */
export function fixtureCatalogGzip(options: FixtureOptions): Buffer {
  const parsed = parseOmmCsv(verificationSetAsOmmCsv(), Date.parse(options.fetchedAt));
  const { epochAtMs } = options;
  const elementSets =
    epochAtMs === undefined
      ? parsed.elementSets
      : parsed.elementSets.map((elementSet) => ({
          ...elementSet,
          epochDay: Math.floor(epochAtMs / 86_400_000),
          epochMicros: (epochAtMs % 86_400_000) * 1000,
        }));
  const catalog = mergeCatalog(
    null,
    new Map([['fixture', { elementSets, fetchedAt: options.fetchedAt }]]),
    [
      {
        id: 'fixture',
        label: 'Verification element sets',
        provider: 'Test fixture',
        url: 'https://example.invalid/',
        minimumObjects: 1,
      },
    ],
    options.fetchedAt,
  );
  return gzipSync(encodeCatalog(catalog));
}

/** Make the page under test receive the given catalog instead of a 404. */
export async function serveCatalog(page: Page, body: Buffer): Promise<void> {
  await page.route('**/data/catalog.json.gz', (route) =>
    route.fulfill({ status: 200, contentType: 'application/gzip', body }),
  );
}

/** Unfold the overview card if it is folded, as it is at first on a phone-sized screen. */
export async function openOverview(page: Page): Promise<void> {
  const toggle = page.locator('#overview-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}
