import { describe, expect, it } from 'vitest';
import type { CatalogRecord } from '../catalog/format';
import { buildSearchIndex, normaliseForSearch, searchObjects } from './search';

/** Names and numbers as they appear in the published catalog; the elements are irrelevant here. */
const ENTRIES: readonly (readonly [number, string, string])[] = [
  [25544, 'ISS (ZARYA)', '1998-067A'],
  [49044, 'ISS (NAUKA)', '1998-067SV'],
  [35932, 'SWISSCUBE', '2009-051B'],
  [56186, 'AISSAT 4', '2023-054AE'],
  [44713, 'STARLINK-1008', '2019-074B'],
  [44714, 'STARLINK-1012', '2019-074C'],
  [68554, 'STARLINK-37255', '2026-070N'],
  [24946, 'IRIDIUM 33', '1997-051C'],
  [33773, 'IRIDIUM 33 DEB', '1997-051N'],
  [22675, 'COSMOS 2251', '1993-036A'],
  [2551, 'SOMETHING OLD', '1966-110A'],
];

const records: CatalogRecord[] = ENTRIES.map(([noradId, name, objectId]) => ({
  noradId,
  name,
  objectId,
  epochDay: 0,
  epochMicros: 0,
  meanMotion: 15,
  eccentricity: 0,
  inclination: 0,
  raan: 0,
  argPericenter: 0,
  meanAnomaly: 0,
  bstar: 0,
  sourceMask: 1,
}));
const index = buildSearchIndex(records);
const names = (query: string, limit = 8): string[] =>
  searchObjects(index, query, limit).map((i) => records[i]?.name ?? '?');

describe('normaliseForSearch', () => {
  it('ignores case, punctuation and repeated spaces', () => {
    expect(normaliseForSearch('  Starlink-1008 ')).toBe('STARLINK 1008');
    expect(normaliseForSearch('ISS (ZARYA)')).toBe('ISS ZARYA');
    expect(normaliseForSearch('---')).toBe('');
  });
});

describe('searchObjects', () => {
  it('puts names that start with the query ahead of names that merely contain it', () => {
    expect(names('iss')).toEqual(['ISS (NAUKA)', 'ISS (ZARYA)', 'AISSAT 4', 'SWISSCUBE']);
  });

  it('matches a later word of the name', () => {
    expect(names('zarya')).toEqual(['ISS (ZARYA)']);
    expect(names('33')[0]).toBe('IRIDIUM 33');
  });

  it('does not care how the query is punctuated', () => {
    expect(names('starlink 1008')).toEqual(['STARLINK-1008']);
    expect(names('STARLINK-10')).toEqual(['STARLINK-1008', 'STARLINK-1012']);
    expect(names('iss zarya')).toEqual(['ISS (ZARYA)']);
  });

  it('puts an exact catalog number first, ahead of names containing those digits', () => {
    expect(names('2551')).toEqual(['SOMETHING OLD']);
    expect(names('2251')).toEqual(['COSMOS 2251']);
    expect(names('25544')).toEqual(['ISS (ZARYA)']);
  });

  it('matches the start of a catalog number', () => {
    expect(names('4471')).toEqual(['STARLINK-1008', 'STARLINK-1012']);
  });

  it('matches an international designator, with or without the hyphen', () => {
    expect(names('1998-067')).toEqual(['ISS (NAUKA)', 'ISS (ZARYA)']);
    expect(names('1997 051n')).toEqual(['IRIDIUM 33 DEB']);
  });

  it('orders equal matches by length, then by name with numbers compared as numbers', () => {
    expect(names('starlink')).toEqual(['STARLINK-1008', 'STARLINK-1012', 'STARLINK-37255']);
    expect(names('iridium')).toEqual(['IRIDIUM 33', 'IRIDIUM 33 DEB']);
  });

  it('returns at most the requested number of results, keeping the best', () => {
    expect(names('s', 2)).toEqual(['SWISSCUBE', 'SOMETHING OLD']);
    expect(names('s', 0)).toEqual([]);
  });

  it('returns nothing for an empty or punctuation-only query, or when nothing matches', () => {
    expect(names('')).toEqual([]);
    expect(names(' - ')).toEqual([]);
    expect(names('hubble')).toEqual([]);
  });
});
