import { classifyRegime, parseDesignator, REGIMES, type Regime } from '../orbit/elements';
import type { OrbitSummary } from '../orbit/propagate';
import { CATEGORIES, categoryOf, OTHER_CATEGORY, type Category } from './categories';
import { epochToUnixMs, type Catalog, type CatalogMetadata, type CatalogRecord } from './format';

/**
 * Everything the interface needs to know about each object beyond its
 * orbital elements, worked out once when the catalog is loaded and stored
 * in compact arrays (one entry per object, in catalog order), so that
 * filtering 20 000 objects is a single pass over a few bytes each.
 */
export interface ObjectIndex {
  readonly count: number;
  readonly records: readonly CatalogRecord[];
  /** Period and highest and lowest altitude of each orbit, from SGP4. */
  readonly orbits: OrbitSummary;
  /** Each object's category, as a position in `CATEGORIES`. */
  readonly category: Uint8Array;
  /** Each object's orbit regime, as a position in `REGIMES`. */
  readonly regime: Uint8Array;
  /** Launch year from the international designator, or 0 if it could not be read. */
  readonly launchYear: Uint16Array;
  /** Each element set's epoch, in milliseconds since 1970-01-01 UTC. */
  readonly epochMs: Float64Array;
  /**
   * Descriptive fields from the satellite catalog (object type, owner,
   * launch date, status), one entry per object, or null if this catalog
   * carries none. An empty string means nothing is known for that object.
   */
  readonly metadata: CatalogMetadata | null;
  /** Earliest and latest launch year present, or null if no designator could be read. */
  readonly launchYearRange: readonly [number, number] | null;
  /** Position of the object with this catalog number, or -1. */
  indexOfNoradId(noradId: number): number;
}

/**
 * @param catalog the loaded catalog
 * @param orbits  per-object orbit summary from the propagation thread, in the same order
 */
export function buildObjectIndex(catalog: Catalog, orbits: OrbitSummary): ObjectIndex {
  const { records } = catalog;
  const count = records.length;
  if (orbits.periodMinutes.length !== count) {
    throw new RangeError('The orbit summary does not match the catalog');
  }
  const sourceIds = catalog.sources.map((source) => source.id);
  // Work out the list of source identifiers for each distinct mask once.
  const sourcesOfMask = new Map<number, string[]>();
  const sourcesFor = (mask: number): string[] => {
    let ids = sourcesOfMask.get(mask);
    if (ids === undefined) {
      ids = sourceIds.filter((_, bit) => (mask & (1 << bit)) !== 0);
      sourcesOfMask.set(mask, ids);
    }
    return ids;
  };

  const category = new Uint8Array(count);
  const regime = new Uint8Array(count);
  const launchYear = new Uint16Array(count);
  const epochMs = new Float64Array(count);
  const byNoradId = new Map<number, number>();
  let firstYear = Infinity;
  let lastYear = -Infinity;

  records.forEach((record, index) => {
    category[index] = categoryOf(record.name, sourcesFor(record.sourceMask));
    regime[index] = REGIMES.indexOf(
      classifyRegime(record.eccentricity, orbits.apogeeKm[index] ?? 0, record.meanMotion),
    );
    const year = parseDesignator(record.objectId)?.year ?? 0;
    launchYear[index] = year;
    if (year > 0) {
      firstYear = Math.min(firstYear, year);
      lastYear = Math.max(lastYear, year);
    }
    epochMs[index] = epochToUnixMs(record.epochDay, record.epochMicros);
    byNoradId.set(record.noradId, index);
  });

  return {
    count,
    records,
    orbits,
    category,
    regime,
    launchYear,
    epochMs,
    metadata: catalog.metadata ?? null,
    launchYearRange: firstYear <= lastYear ? [firstYear, lastYear] : null,
    indexOfNoradId: (noradId) => byNoradId.get(noradId) ?? -1,
  };
}

/** The category of the object at `index`. */
export function categoryAt(objects: ObjectIndex, index: number): Category {
  const category = CATEGORIES[objects.category[index] ?? OTHER_CATEGORY];
  if (category === undefined) {
    throw new RangeError(`No object at index ${String(index)}`);
  }
  return category;
}

/** The orbit regime of the object at `index`. */
export function regimeAt(objects: ObjectIndex, index: number): Regime {
  return REGIMES[objects.regime[index] ?? 0] ?? 'LEO';
}

/** A set of objects that belong with a selected one, and why. */
export interface RelatedObjects {
  /** Positions of the related objects, not including the selected one. */
  readonly indices: readonly number[];
  /** What they are, for the interface: "Starlink satellites", "objects from the same launch". */
  readonly description: string;
}

/**
 * The objects that belong with the one at `index`: the rest of its
 * constellation, navigation system, station or debris cloud, or, failing
 * that, everything else catalogued from the same launch.
 *
 * @returns null if nothing else in the catalog is related
 */
export function relatedObjects(objects: ObjectIndex, index: number): RelatedObjects | null {
  const code = objects.category[index];
  const record = objects.records[index];
  if (code === undefined || record === undefined) {
    return null;
  }
  const indices: number[] = [];
  if (code !== OTHER_CATEGORY) {
    for (let i = 0; i < objects.count; i += 1) {
      if (i !== index && objects.category[i] === code) {
        indices.push(i);
      }
    }
    return indices.length === 0
      ? null
      : { indices, description: CATEGORIES[code]?.many ?? 'related objects' };
  }
  const launchId = parseDesignator(record.objectId)?.launchId;
  if (launchId === undefined) {
    return null;
  }
  objects.records.forEach((other, i) => {
    // Same launch: the designator starts with the same year and launch number.
    if (i !== index && other.objectId.startsWith(launchId)) {
      indices.push(i);
    }
  });
  return indices.length === 0 ? null : { indices, description: 'objects from the same launch' };
}
