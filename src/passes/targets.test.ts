import { describe, expect, it } from 'vitest';
import type { Catalog, CatalogRecord } from '../catalog/format';
import { choosePassTargets } from './targets';

function record(noradId: number, name: string, sourceMask: number): CatalogRecord {
  return {
    noradId,
    name,
    objectId: '1998-067A',
    epochDay: 20771,
    epochMicros: 0,
    meanMotion: 15.5,
    eccentricity: 0.001,
    inclination: 51.6,
    raan: 0,
    argPericenter: 0,
    meanAnomaly: 0,
    bstar: 0,
    sourceMask,
  };
}

function catalog(sourceIds: string[], records: CatalogRecord[]): Catalog {
  return {
    generatedAt: '2026-11-15T00:00:00.000Z',
    sources: sourceIds.map((id) => ({
      id,
      label: id,
      provider: 'TEST',
      url: 'https://example.invalid/',
      fetchedAt: '2026-11-15T00:00:00.000Z',
      objectCount: 1,
    })),
    records,
  };
}

describe('choosePassTargets', () => {
  it('finds the two stations by catalog number, one entry each, ISS first', () => {
    const targets = choosePassTargets(
      catalog(
        ['active'],
        [
          record(48274, 'CSS (TIANHE)', 1),
          record(53239, 'CSS (WENTIAN)', 1),
          record(25544, 'ISS (ZARYA)', 1),
          record(49044, 'ISS (NAUKA)', 1),
          record(20580, 'HST', 1),
        ],
      ),
    );
    expect(targets.stations).toEqual([
      { index: 2, noradId: 25544, name: 'International Space Station', kind: 'station' },
      { index: 0, noradId: 48274, name: 'Tiangong space station', kind: 'station' },
    ]);
    // Without the list of bright objects there are no others.
    expect(targets.bright).toEqual([]);
  });

  it('does not trust a catalog number whose published name is something else', () => {
    const targets = choosePassTargets(catalog(['active'], [record(25544, 'SOMETHING ELSE', 1)]));
    expect(targets.stations).toEqual([]);
  });

  it('takes the other bright objects from the "visual" source, leaving out station modules', () => {
    const targets = choosePassTargets(
      catalog(
        ['active', 'visual'],
        [
          record(25544, 'ISS (ZARYA)', 3),
          record(49044, 'ISS (NAUKA)', 3),
          record(20580, 'HST', 3),
          record(22285, 'SL-16 R/B', 2),
          record(44713, 'STARLINK-1007', 1),
          record(90000, '', 2),
        ],
      ),
    );
    expect(targets.stations.map((target) => target.noradId)).toEqual([25544]);
    expect(targets.bright).toEqual([
      { index: 2, noradId: 20580, name: 'HST', kind: 'bright' },
      { index: 3, noradId: 22285, name: 'SL-16 R/B', kind: 'bright' },
      { index: 5, noradId: 90000, name: 'Object 90000', kind: 'bright' },
    ]);
  });
});
