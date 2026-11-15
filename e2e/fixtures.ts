import { gzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { mergeCatalog } from '../pipeline/merge';
import { parseOmmCsv } from '../pipeline/omm';
import { BRIGHT_GROUP_ID } from '../src/catalog/brightGroup';
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
  /**
   * If true, every object is given satellite-catalog fields (kind, status,
   * owner, launch date). THE VALUES ARE INVENTED for the tests: they use
   * the documented codes in rotation and have nothing to do with the real
   * objects the element sets belong to.
   */
  readonly withInventedMetadata?: boolean;
  /**
   * If true, the objects in low orbits are also listed under a second
   * source with the identifier of CelesTrak's group of bright objects, so
   * that the app predicts passes for them. A TEST FIXTURE: these objects
   * are not on the real list.
   */
  readonly withBrightGroup?: boolean;
}

/** Revolutions per day above which a fixture object counts as being in a low orbit. */
const LOW_ORBIT_MEAN_MOTION = 11;

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
  const bright = options.withBrightGroup === true;
  const catalog = mergeCatalog(
    null,
    new Map([
      ['fixture', { elementSets, fetchedAt: options.fetchedAt }],
      ...(bright
        ? ([
            [
              BRIGHT_GROUP_ID,
              {
                elementSets: elementSets.filter(
                  (elementSet) => elementSet.meanMotion > LOW_ORBIT_MEAN_MOTION,
                ),
                fetchedAt: options.fetchedAt,
              },
            ],
          ] as const)
        : []),
    ]),
    [
      {
        id: 'fixture',
        label: 'Verification element sets',
        provider: 'Test fixture',
        url: 'https://example.invalid/',
        minimumObjects: 1,
      },
      ...(bright
        ? [
            {
              id: BRIGHT_GROUP_ID,
              label: 'Pretend bright objects',
              provider: 'Test fixture',
              url: 'https://example.invalid/bright',
              minimumObjects: 1,
            },
          ]
        : []),
    ],
    options.fetchedAt,
    options.withInventedMetadata === true
      ? {
          definitions: [
            {
              kind: 'satcat',
              id: 'fixture-satcat',
              label: 'Invented catalog records',
              provider: 'Test fixture',
              url: 'https://example.invalid/satcat',
              minimumObjects: 1,
            },
          ],
          updates: new Map([
            [
              'fixture-satcat',
              {
                fetchedAt: options.fetchedAt,
                records: elementSets.map((elementSet, index) => ({
                  noradId: elementSet.noradId,
                  objectType: ['PAY', 'R/B', 'DEB'][index % 3] ?? '',
                  opsStatus: index % 3 === 0 ? '+' : '',
                  owner: ['US', 'CIS', 'PRC', 'ESA'][index % 4] ?? '',
                  launchDate: `${String(1990 + index)}-02-03`,
                })),
              },
            ],
          ]),
        }
      : undefined,
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
