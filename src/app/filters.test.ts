import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../catalog/categories';
import type { Catalog, CatalogRecord } from '../catalog/format';
import { buildObjectIndex } from '../catalog/objectIndex';
import {
  applyFilters,
  countFilterOptions,
  FILTER_GROUPS,
  isFilterActive,
  NO_FILTERS,
  type FilterState,
} from './filters';

/** A made-up catalog: names and designators imitate real ones; the elements are placeholders. */
function record(
  noradId: number,
  name: string,
  objectId: string,
  sourceMask: number,
  meanMotion = 15,
  eccentricity = 0.001,
): CatalogRecord {
  return {
    noradId,
    name,
    objectId,
    epochDay: 20_772,
    epochMicros: 0,
    meanMotion,
    eccentricity,
    inclination: 53,
    raan: 0,
    argPericenter: 0,
    meanAnomaly: 0,
    bstar: 0,
    sourceMask,
  };
}

const catalog: Catalog = {
  generatedAt: '2026-11-15T00:00:00.000Z',
  sources: [
    { id: 'fengyun-1c-debris', label: 'F', provider: 'TEST', fetchedAt: null, objectCount: 1 },
    { id: 'active', label: 'A', provider: 'TEST', fetchedAt: null, objectCount: 6 },
  ],
  records: [
    record(1, 'STARLINK-1', '2019-074A', 2), // 0: Starlink, LEO, 2019
    record(2, 'STARLINK-2', '2024-001A', 2), // 1: Starlink, LEO, 2024
    record(3, 'NAVSTAR 43 (USA 132)', '1997-035A', 2, 2.0057, 0.01), // 2: GPS, MEO, 1997
    record(4, 'GSAT0101 (GALILEO-PFM)', '2011-060A', 2, 1.7, 0.0003), // 3: Galileo, MEO, 2011
    record(5, 'FENGYUN 1C DEB', '1999-025AB', 1), // 4: debris, LEO, 1999
    record(6, 'SOMETHING GEO', '2015-010A', 2, 1.0027, 0.0002), // 5: other, GEO, 2015
    record(7, 'NO DESIGNATOR', '', 2), // 6: other, LEO, year unknown
  ],
};
const objects = buildObjectIndex(catalog, {
  periodMinutes: new Float32Array([96, 96, 718, 847, 100, 1436, 96]),
  apogeeKm: new Float32Array([550, 550, 20_400, 23_300, 860, 35_790, 500]),
  perigeeKm: new Float32Array([545, 545, 20_000, 23_200, 840, 35_780, 490]),
});

function passing(state: Partial<FilterState>): number[] {
  const out = new Uint8Array(objects.count);
  const count = applyFilters(objects, { ...NO_FILTERS, ...state }, out);
  const indices = [...out].flatMap((value, index) => (value === 1 ? [index] : []));
  expect(count).toBe(indices.length);
  return indices;
}

describe('FILTER_GROUPS', () => {
  it('covers every category exactly once', () => {
    const covered = FILTER_GROUPS.flatMap((group) => group.categoryIds).sort();
    expect(covered).toEqual(CATEGORIES.map((category) => category.id).sort());
  });
});

describe('applyFilters', () => {
  it('passes everything when nothing is asked for', () => {
    expect(passing({})).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(isFilterActive(NO_FILTERS)).toBe(false);
  });

  it('widens the selection when several families are ticked', () => {
    expect(passing({ groups: new Set(['starlink']) })).toEqual([0, 1]);
    expect(passing({ groups: new Set(['starlink', 'fengyun-1c-debris']) })).toEqual([0, 1, 4]);
  });

  it('treats the navigation button as covering every navigation system', () => {
    expect(passing({ groups: new Set(['navigation']) })).toEqual([2, 3]);
  });

  it('filters by orbit regime', () => {
    expect(passing({ regimes: new Set(['MEO']) })).toEqual([2, 3]);
    expect(passing({ regimes: new Set(['GEO', 'HEO']) })).toEqual([5]);
  });

  it('filters by launch year, inclusive at both ends, and excludes unknown years', () => {
    expect(passing({ yearFrom: 2015 })).toEqual([0, 1, 5]);
    expect(passing({ yearTo: 1999 })).toEqual([2, 4]);
    expect(passing({ yearFrom: 1999, yearTo: 2011 })).toEqual([3, 4]);
    expect(passing({ yearFrom: 2030 })).toEqual([]);
  });

  it('requires every question to be satisfied at once', () => {
    expect(
      passing({
        groups: new Set(['starlink', 'navigation']),
        regimes: new Set(['LEO']),
        yearFrom: 2020,
      }),
    ).toEqual([1]);
    expect(isFilterActive({ ...NO_FILTERS, yearTo: 2000 })).toBe(true);
  });

  it('rejects an output array of the wrong length', () => {
    expect(() => applyFilters(objects, NO_FILTERS, new Uint8Array(3))).toThrow(RangeError);
  });
});

describe('countFilterOptions', () => {
  it('counts the objects behind each button', () => {
    const counts = countFilterOptions(objects);
    expect(counts.groups.get('starlink')).toBe(2);
    expect(counts.groups.get('navigation')).toBe(2);
    expect(counts.groups.get('fengyun-1c-debris')).toBe(1);
    expect(counts.groups.get('other')).toBe(2);
    expect(counts.groups.get('oneweb')).toBe(0);
    expect(counts.regimes.get('LEO')).toBe(4);
    expect(counts.regimes.get('MEO')).toBe(2);
    expect(counts.regimes.get('GEO')).toBe(1);
    expect(counts.regimes.get('HEO')).toBe(0);
  });
});
