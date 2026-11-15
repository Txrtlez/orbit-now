import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogRecord } from './format';
import { buildObjectIndex, categoryAt, regimeAt, relatedObjects } from './objectIndex';

/**
 * A small made-up catalog. The names and designators imitate real ones so
 * that the classification rules have something to act on, but the orbital
 * elements are placeholders: nothing here is propagated or shown.
 */
function record(
  noradId: number,
  name: string,
  objectId: string,
  sourceMask: number,
  overrides: Partial<CatalogRecord> = {},
): CatalogRecord {
  return {
    noradId,
    name,
    objectId,
    epochDay: 20_772,
    epochMicros: 43_200_000_000,
    meanMotion: 15,
    eccentricity: 0.001,
    inclination: 53,
    raan: 0,
    argPericenter: 0,
    meanAnomaly: 0,
    bstar: 0,
    sourceMask,
    ...overrides,
  };
}

const catalog: Catalog = {
  generatedAt: '2026-11-15T00:00:00.000Z',
  sources: [
    {
      id: 'fengyun-1c-debris',
      label: 'Fengyun-1C debris',
      provider: 'TEST',
      fetchedAt: null,
      objectCount: 2,
    },
    { id: 'active', label: 'Active satellites', provider: 'TEST', fetchedAt: null, objectCount: 6 },
  ],
  records: [
    record(100, 'STARLINK-1', '2019-074A', 2),
    record(101, 'STARLINK-2', '2019-074B', 2),
    record(102, 'STARLINK-3', '2020-001A', 2),
    record(200, 'FENGYUN 1C DEB', '1999-025AB', 1),
    record(201, 'FENGYUN 1C DEB', '1999-025AC', 1),
    record(300, 'RIDESHARE ONE', '2024-050A', 2),
    record(301, 'RIDESHARE TWO', '2024-050B', 2),
    record(400, 'LONER', 'not a designator', 2, { meanMotion: 1.0027, eccentricity: 0.0002 }),
  ],
};

const orbits = {
  periodMinutes: new Float32Array([96, 96, 96, 100, 100, 96, 96, 1436]),
  apogeeKm: new Float32Array([550, 550, 550, 860, 870, 520, 520, 35_790]),
  perigeeKm: new Float32Array([545, 545, 545, 840, 850, 510, 510, 35_780]),
};

const objects = buildObjectIndex(catalog, orbits);

describe('buildObjectIndex', () => {
  it('classifies every object', () => {
    expect(categoryAt(objects, 0).id).toBe('starlink');
    expect(categoryAt(objects, 3).id).toBe('fengyun-1c-debris');
    expect(categoryAt(objects, 5).id).toBe('other');
    expect(regimeAt(objects, 0)).toBe('LEO');
    expect(regimeAt(objects, 7)).toBe('GEO');
  });

  it('reads the launch year from the designator, and records 0 when it cannot', () => {
    expect([...objects.launchYear]).toEqual([2019, 2019, 2020, 1999, 1999, 2024, 2024, 0]);
    expect(objects.launchYearRange).toEqual([1999, 2024]);
  });

  it('converts each epoch to milliseconds', () => {
    // Day 20 772 after 1970-01-01 is 2026-11-15; half a day of microseconds is noon.
    expect(objects.epochMs[0]).toBe(Date.UTC(2026, 10, 15, 12));
  });

  it('finds objects by catalog number', () => {
    expect(objects.indexOfNoradId(201)).toBe(4);
    expect(objects.indexOfNoradId(999)).toBe(-1);
  });

  it('refuses an orbit summary of the wrong length', () => {
    expect(() =>
      buildObjectIndex(catalog, {
        periodMinutes: new Float32Array(1),
        apogeeKm: new Float32Array(1),
        perigeeKm: new Float32Array(1),
      }),
    ).toThrow(RangeError);
  });
});

describe('relatedObjects', () => {
  it('returns the rest of a constellation', () => {
    expect(relatedObjects(objects, 0)).toEqual({
      indices: [1, 2],
      description: 'Starlink satellites',
    });
  });

  it('returns the rest of a debris cloud', () => {
    expect(relatedObjects(objects, 4)).toEqual({
      indices: [3],
      description: 'pieces of Fengyun-1C debris',
    });
  });

  it('falls back to objects from the same launch', () => {
    expect(relatedObjects(objects, 5)).toEqual({
      indices: [6],
      description: 'objects from the same launch',
    });
  });

  it('returns null when nothing is related', () => {
    expect(relatedObjects(objects, 7)).toBeNull();
    expect(relatedObjects(objects, 99)).toBeNull();
  });
});
