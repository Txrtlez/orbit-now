import { BRIGHT_GROUP_ID } from '../catalog/brightGroup';
import type { Catalog } from '../catalog/format';

/**
 * Choosing which satellites to predict passes for.
 *
 * Predicting passes for all twenty thousand objects would be pointless:
 * nearly all are far too faint to see without a telescope. Two sets are
 * used instead.
 *
 * - The two space stations, by far the brightest satellites. Each is
 *   catalogued module by module, all on the same orbit; the first module
 *   launched stands for the whole station.
 * - REAL DATA: CelesTrak's list of the brightest objects, when the catalog
 *   includes it. This project does not judge brightness itself.
 */

export interface PassTarget {
  /** Position of the object in the catalog. */
  readonly index: number;
  readonly noradId: number;
  /** The name to show. */
  readonly name: string;
  readonly kind: 'station' | 'bright';
}

/**
 * The space stations. The catalog numbers and published names were read
 * from this project's catalog of 2026-11-15: 25544 is "ISS (ZARYA)" and
 * 48274 is "CSS (TIANHE)". A number is only used if the name published
 * with it still begins as expected.
 */
const STATIONS: readonly { noradId: number; publishedAs: RegExp; name: string }[] = [
  { noradId: 25544, publishedAs: /^ISS \(/, name: 'International Space Station' },
  { noradId: 48274, publishedAs: /^CSS \(/, name: 'Tiangong space station' },
];

/** Names of space-station modules, which are not listed again among the bright objects. */
const STATION_MODULE = /^(ISS|CSS) \(/;

export interface PassTargets {
  readonly stations: readonly PassTarget[];
  /** Other bright objects, in catalog order. Empty if the catalog does not include the list. */
  readonly bright: readonly PassTarget[];
}

export function choosePassTargets(catalog: Catalog): PassTargets {
  const stations: PassTarget[] = [];
  const bright: PassTarget[] = [];
  const brightBit = catalog.sources.findIndex((source) => source.id === BRIGHT_GROUP_ID);
  catalog.records.forEach((record, index) => {
    const station = STATIONS.find((candidate) => candidate.noradId === record.noradId);
    if (station?.publishedAs.test(record.name) === true) {
      stations.push({ index, noradId: record.noradId, name: station.name, kind: 'station' });
    } else if (
      brightBit !== -1 &&
      (record.sourceMask & (1 << brightBit)) !== 0 &&
      !STATION_MODULE.test(record.name)
    ) {
      bright.push({
        index,
        noradId: record.noradId,
        name: record.name === '' ? `Object ${String(record.noradId)}` : record.name,
        kind: 'bright',
      });
    }
  });
  // Stations in the order of the list above, whatever their order in the catalog.
  stations.sort(
    (a, b) =>
      STATIONS.findIndex((station) => station.noradId === a.noradId) -
      STATIONS.findIndex((station) => station.noradId === b.noradId),
  );
  return { stations, bright };
}
