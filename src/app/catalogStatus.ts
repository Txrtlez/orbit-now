import type { Catalog } from '../catalog/format';
import { cssColourOfGroup } from '../render/palette';
import { formatCount } from './format';

/**
 * Describe a length of time in words, rounded down to a whole unit:
 * "less than an hour", "1 hour", "7 hours", "1 day", "3 days".
 *
 * Rounded down, not to nearest, so that the data is never described as
 * fresher than it is.
 */
export function describeAge(milliseconds: number): string {
  if (!(milliseconds >= 0)) {
    // Negative or NaN: the clock on this device disagrees with the data's timestamp.
    return 'an unknown time';
  }
  const hours = Math.floor(milliseconds / 3_600_000);
  if (hours < 1) {
    return 'less than an hour';
  }
  if (hours < 48) {
    return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  }
  return `${String(Math.floor(hours / 24))} days`;
}

/** Facts about a catalog, worked out once and ready to display. */
export interface CatalogSummary {
  /** Number of distinct objects. */
  readonly objectCount: number;
  /** Each source with its object count, largest first. */
  readonly sources: readonly {
    readonly id: string;
    readonly label: string;
    readonly provider: string;
    readonly objectCount: number;
  }[];
  /**
   * Time of the least recent successful download among the sources, in
   * milliseconds since 1970-01-01 UTC, or null if any source has never been
   * downloaded. The oldest is used so that the stated age is true of all the data.
   */
  readonly oldestFetchMs: number | null;
  /**
   * Where the descriptive fields (object type, owner, launch date) come
   * from and when the least recent part was downloaded, or null if the
   * catalog carries none.
   */
  readonly metadata: { readonly providers: string; readonly oldestFetchMs: number | null } | null;
}

function summariseMetadata(catalog: Catalog): CatalogSummary['metadata'] {
  if (catalog.metadata === undefined) {
    return null;
  }
  // Only the sources that have actually been downloaded contribute fields.
  const times = catalog.metadata.sources.flatMap((source) =>
    source.fetchedAt === null ? [] : [Date.parse(source.fetchedAt)],
  );
  return {
    providers: [...new Set(catalog.metadata.sources.map((source) => source.provider))].join(', '),
    oldestFetchMs:
      times.length > 0 && times.every((time) => !Number.isNaN(time)) ? Math.min(...times) : null,
  };
}

export function summariseCatalog(catalog: Catalog): CatalogSummary {
  const fetchTimes = catalog.sources.map((source) =>
    source.fetchedAt === null ? Number.NaN : Date.parse(source.fetchedAt),
  );
  const allKnown = fetchTimes.length > 0 && fetchTimes.every((time) => !Number.isNaN(time));
  return {
    objectCount: catalog.records.length,
    sources: catalog.sources
      .map(({ id, label, provider, objectCount }) => ({ id, label, provider, objectCount }))
      .sort((a, b) => b.objectCount - a.objectCount),
    oldestFetchMs: allKnown ? Math.min(...fetchTimes) : null,
    metadata: summariseMetadata(catalog),
  };
}

/**
 * Fill the data-status areas of the page.
 *
 * @param headline element for the one-line summary that is always visible
 * @param details  element for the longer description; its existing content is replaced
 * @param summary  the catalog's summary, or null if this copy of the site has no catalog
 * @param nowMs    current time in milliseconds since 1970-01-01 UTC
 */
export function renderCatalogStatus(
  headline: HTMLElement,
  details: HTMLElement,
  summary: CatalogSummary | null,
  nowMs: number,
): void {
  const paragraph = (text: string, className?: string): HTMLParagraphElement => {
    const element = document.createElement('p');
    element.textContent = text;
    if (className !== undefined) {
      element.className = className;
    }
    return element;
  };

  if (summary === null) {
    headline.textContent = 'No orbital data';
    details.replaceChildren(
      paragraph('This copy of the site has no orbital data yet, so there is nothing to show.'),
    );
    return;
  }

  const providers = [...new Set(summary.sources.map((source) => source.provider))].join(', ');
  headline.textContent = `Showing ${formatCount(summary.objectCount)} objects`;

  const list = document.createElement('ul');
  list.className = 'source-list';
  for (const source of summary.sources) {
    const item = document.createElement('li');
    // A dot in the colour this group is drawn with on the globe.
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = cssColourOfGroup(source.id);
    swatch.setAttribute('aria-hidden', 'true');
    item.append(swatch, `${source.label}: ${formatCount(source.objectCount)}`);
    list.append(item);
  }

  const age =
    summary.oldestFetchMs === null
      ? 'Download time unknown for part of this data.'
      : `Downloaded ${describeAge(nowMs - summary.oldestFetchMs)} ago or more recently.`;

  const about = document.createElement('details');
  about.className = 'details';
  const summaryElement = document.createElement('summary');
  summaryElement.textContent = 'About this data';
  about.append(
    summaryElement,
    paragraph(
      `Orbital elements published by ${providers}. Only these groups are included:`,
      'muted',
    ),
    list,
    paragraph(age, 'muted'),
  );
  if (summary.metadata !== null) {
    const { providers: metadataProviders, oldestFetchMs } = summary.metadata;
    about.append(
      paragraph(
        `Kind, owner, status and launch date come from the satellite catalog published by ${metadataProviders}` +
          (oldestFetchMs === null
            ? '.'
            : `, downloaded ${describeAge(nowMs - oldestFetchMs)} ago or more recently.`) +
          ' Objects catalogued since then have none yet.',
        'muted',
      ),
    );
  }

  details.replaceChildren(
    paragraph(
      'Every dot is one object, where it is right now. This is not the full public catalog.',
    ),
    about,
  );
}
