import type { CatalogRecord } from '../catalog/format';

/**
 * Finding objects by name, catalog number or international designator.
 *
 * The whole catalog is searched on every keystroke. With about 20 000
 * objects that is a fraction of a millisecond per letter typed, so nothing
 * cleverer (an index, a background thread) is needed.
 */

/** The catalog's searchable text, prepared once. */
export interface SearchIndex {
  /** Each object's name, normalised by `normaliseForSearch`. */
  readonly names: readonly string[];
  /** Each object's catalog number as text. */
  readonly numbers: readonly string[];
  /** Each object's international designator, normalised. */
  readonly designators: readonly string[];
}

/**
 * Reduce text to what matters for matching: upper case, with every run of
 * punctuation or spaces turned into one space. "Starlink-1008",
 * "starlink 1008" and "STARLINK  1008" all become "STARLINK 1008".
 */
export function normaliseForSearch(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function buildSearchIndex(records: readonly CatalogRecord[]): SearchIndex {
  return {
    names: records.map((record) => normaliseForSearch(record.name)),
    numbers: records.map((record) => String(record.noradId)),
    designators: records.map((record) => normaliseForSearch(record.objectId)),
  };
}

/**
 * How well an object matches, as a rank where lower is better, or -1 for
 * no match:
 *
 * 0  the query is exactly the catalog number
 * 1  the query is exactly the name
 * 2  the name starts with the query
 * 3  a later word of the name starts with the query
 * 4  the name contains the query anywhere
 * 5  the catalog number starts with the query
 * 6  the international designator starts with the query
 */
function rank(index: SearchIndex, i: number, query: string): number {
  const number = index.numbers[i] ?? '';
  if (number === query) {
    return 0;
  }
  const name = index.names[i] ?? '';
  const at = name.indexOf(query);
  if (at === 0) {
    return name.length === query.length ? 1 : 2;
  }
  if (at > 0) {
    return name.includes(` ${query}`) ? 3 : 4;
  }
  if (number.startsWith(query)) {
    return 5;
  }
  if ((index.designators[i] ?? '').startsWith(query)) {
    return 6;
  }
  return -1;
}

/**
 * The objects that best match a query, best first.
 *
 * Among equally ranked matches, shorter names come first (so "ISS (ZARYA)"
 * beats a longer name that also starts with "ISS"), then alphabetical
 * order with numbers compared as numbers, then catalog order.
 *
 * @param limit the most results to return
 * @returns positions in the catalog; empty if the query has no letters or digits
 */
export function searchObjects(index: SearchIndex, query: string, limit: number): number[] {
  const normalised = normaliseForSearch(query);
  if (normalised === '' || limit <= 0) {
    return [];
  }
  // The best matches found so far, in order. Kept to `limit` entries, so
  // the cost stays low even when thousands of objects match a short query.
  const best: { readonly i: number; readonly rank: number }[] = [];
  const comesBefore = (
    a: { readonly i: number; readonly rank: number },
    b: { readonly i: number; readonly rank: number },
  ): boolean => {
    if (a.rank !== b.rank) {
      return a.rank < b.rank;
    }
    const nameA = index.names[a.i] ?? '';
    const nameB = index.names[b.i] ?? '';
    if (nameA.length !== nameB.length) {
      return nameA.length < nameB.length;
    }
    const order = nameA.localeCompare(nameB, 'en', { numeric: true });
    return order !== 0 ? order < 0 : a.i < b.i;
  };

  for (let i = 0; i < index.names.length; i += 1) {
    const candidate = { i, rank: rank(index, i, normalised) };
    if (candidate.rank === -1) {
      continue;
    }
    const worst = best.at(-1);
    if (best.length === limit && worst !== undefined && !comesBefore(candidate, worst)) {
      continue;
    }
    let position = best.length;
    while (position > 0) {
      const ahead = best[position - 1];
      if (ahead === undefined || !comesBefore(candidate, ahead)) {
        break;
      }
      position -= 1;
    }
    best.splice(position, 0, candidate);
    if (best.length > limit) {
      best.pop();
    }
  }
  return best.map((entry) => entry.i);
}
