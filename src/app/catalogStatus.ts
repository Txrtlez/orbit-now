import type { Catalog } from '../catalog/format';

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
}

export function summariseCatalog(catalog: Catalog): CatalogSummary {
  const fetchTimes = catalog.sources.map((source) =>
    source.fetchedAt === null ? Number.NaN : Date.parse(source.fetchedAt),
  );
  const allKnown = fetchTimes.length > 0 && fetchTimes.every((time) => !Number.isNaN(time));
  return {
    objectCount: catalog.records.length,
    sources: catalog.sources
      .map(({ label, provider, objectCount }) => ({ label, provider, objectCount }))
      .sort((a, b) => b.objectCount - a.objectCount),
    oldestFetchMs: allKnown ? Math.min(...fetchTimes) : null,
  };
}

/** Whole numbers with thousands separators, e.g. 17,234. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * Fill the data-status area of the page.
 *
 * @param container element to render into; its existing content is replaced
 * @param summary   the catalog's summary, or null if this copy of the site has no catalog
 * @param nowMs     current time in milliseconds since 1970-01-01 UTC
 */
export function renderCatalogStatus(
  container: HTMLElement,
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
    container.replaceChildren(
      paragraph('This copy of the site has no orbital data yet, so there is nothing to show.'),
    );
    return;
  }

  const providers = [...new Set(summary.sources.map((source) => source.provider))].join(', ');
  const headline = paragraph(
    `Orbital data loaded for ${COUNT_FORMAT.format(summary.objectCount)} objects. This is not the full public catalog, and the objects are not drawn on the globe yet.`,
  );

  const list = document.createElement('ul');
  list.className = 'source-list';
  for (const source of summary.sources) {
    const item = document.createElement('li');
    item.textContent = `${source.label}: ${COUNT_FORMAT.format(source.objectCount)}`;
    list.append(item);
  }

  const age =
    summary.oldestFetchMs === null
      ? 'Download time unknown for part of this data.'
      : `Downloaded ${describeAge(nowMs - summary.oldestFetchMs)} ago or more recently.`;

  const details = document.createElement('details');
  details.className = 'details';
  const summaryElement = document.createElement('summary');
  summaryElement.textContent = 'About this data';
  details.append(
    summaryElement,
    paragraph(`Published by ${providers}. Only these groups are included:`, 'muted'),
    list,
    paragraph(age, 'muted'),
  );

  container.replaceChildren(headline, details);
}
