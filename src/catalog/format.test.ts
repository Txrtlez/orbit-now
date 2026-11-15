import { describe, expect, it } from 'vitest';
import {
  CATALOG_FORMAT,
  CATALOG_VERSION,
  decodeCatalog,
  encodeCatalog,
  epochToUnixMs,
  formatEpoch,
  parseEpoch,
  recordToOmm,
  type Catalog,
  type CatalogRecord,
} from './format';

/**
 * REAL DATA used as a fixture: the first element set of the Vallado et al.
 * (2006) SGP4 verification set, catalog number 5.
 *
 *   1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
 *   2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667
 */
const CASE_00005: CatalogRecord = {
  noradId: 5,
  name: 'VERIFICATION 00005',
  objectId: '58002B',
  epochDay: 11135, // 2000-06-27
  epochMicros: 67_819_733_568, // 18:50:19.733568
  meanMotion: 10.82419157,
  eccentricity: 0.1859667,
  inclination: 34.2682,
  raan: 348.7242,
  argPericenter: 331.7664,
  meanAnomaly: 19.3264,
  bstar: 0.000028098,
  sourceMask: 0b01,
};

/** The same element set under a six-digit catalog number, to exercise numbers above 99 999. */
const SIX_DIGIT: CatalogRecord = { ...CASE_00005, noradId: 101357, name: '', sourceMask: 0b11 };

const CATALOG: Catalog = {
  generatedAt: '2026-11-14T03:17:00.000Z',
  sources: [
    {
      id: 'a',
      label: 'Source A',
      provider: 'TEST',
      fetchedAt: '2026-11-14T03:16:00.000Z',
      objectCount: 2,
    },
    { id: 'b', label: 'Source B', provider: 'TEST', fetchedAt: null, objectCount: 1 },
  ],
  records: [SIX_DIGIT, CASE_00005], // deliberately out of order
};

describe('parseEpoch and formatEpoch', () => {
  it('splits an epoch into a day number and microseconds into the day', () => {
    expect(parseEpoch('1970-01-01T00:00:00')).toEqual({ epochDay: 0, epochMicros: 0 });
    expect(parseEpoch('2000-06-27T18:50:19.733568')).toEqual({
      epochDay: 11135,
      epochMicros: 67_819_733_568,
    });
  });

  it('accepts a trailing Z and fewer than six decimal places', () => {
    expect(parseEpoch('2026-11-14T20:01:42Z')).toEqual(parseEpoch('2026-11-14T20:01:42.000000'));
    expect(parseEpoch('2026-11-14T20:01:42.5')?.epochMicros).toBe(
      (20 * 3600 + 60 + 42) * 1e6 + 500_000,
    );
  });

  it('refuses anything it could not store exactly or that is not a real UTC time', () => {
    for (const text of [
      '',
      '2026-11-14',
      '2026-11-14 20:01:42',
      '2026-11-14T20:01:42.1234567', // finer than a microsecond
      '2026-11-14T20:01:42+01:00', // not UTC
      '2026-02-30T00:00:00', // no such day
      '2026-13-01T00:00:00',
      '2026-11-14T24:00:00',
      '2026-11-14T20:60:00',
      '2026-11-14T20:01:60',
    ]) {
      expect(parseEpoch(text), text).toBeNull();
    }
  });

  it('formats back to the same instant, always with six decimal places', () => {
    expect(formatEpoch(11135, 67_819_733_568)).toBe('2000-06-27T18:50:19.733568');
    expect(formatEpoch(0, 0)).toBe('1970-01-01T00:00:00.000000');
    expect(formatEpoch(20771, 86_399_999_999)).toBe('2026-11-14T23:59:59.999999');
  });

  it('round-trips at the limits of a day, including a leap day', () => {
    for (const text of [
      '2024-02-29T00:00:00.000000',
      '2024-02-29T23:59:59.999999',
      '1957-10-04T19:28:34.000001',
      '2026-12-31T12:00:00.500000',
    ]) {
      const parsed = parseEpoch(text);
      expect(parsed, text).not.toBeNull();
      if (parsed !== null) {
        expect(formatEpoch(parsed.epochDay, parsed.epochMicros)).toBe(text);
      }
    }
  });

  it('rejects values that are not a whole day and a time within it', () => {
    expect(() => formatEpoch(1.5, 0)).toThrow(RangeError);
    expect(() => formatEpoch(1, -1)).toThrow(RangeError);
    expect(() => formatEpoch(1, 86_400_000_000)).toThrow(RangeError);
    expect(() => formatEpoch(1, 0.5)).toThrow(RangeError);
  });

  it('converts to the millisecond clock JavaScript uses', () => {
    expect(epochToUnixMs(11135, 67_819_733_568)).toBeCloseTo(
      Date.UTC(2000, 5, 27, 18, 50, 19, 733) + 0.568,
      6,
    );
  });
});

describe('encodeCatalog and decodeCatalog', () => {
  it('reads back exactly what was written, sorted by catalog number', () => {
    const decoded = decodeCatalog(encodeCatalog(CATALOG));
    expect(decoded).toEqual({ ...CATALOG, records: [CASE_00005, SIX_DIGIT] });
  });

  it('preserves every number bit for bit', () => {
    const [record] = decodeCatalog(encodeCatalog(CATALOG)).records;
    expect(record).toBeDefined();
    for (const key of [
      'meanMotion',
      'eccentricity',
      'inclination',
      'raan',
      'argPericenter',
      'meanAnomaly',
      'bstar',
    ] as const) {
      expect(Object.is(record?.[key], CASE_00005[key]), key).toBe(true);
    }
  });

  it('labels the file with its format name and version', () => {
    const file = JSON.parse(encodeCatalog(CATALOG)) as Record<string, unknown>;
    expect(file.format).toBe(CATALOG_FORMAT);
    expect(file.version).toBe(CATALOG_VERSION);
    expect(file.count).toBe(2);
  });

  it('handles an empty catalog', () => {
    const empty: Catalog = { generatedAt: CATALOG.generatedAt, sources: [], records: [] };
    expect(decodeCatalog(encodeCatalog(empty))).toEqual(empty);
  });

  it('refuses files that are not catalogs of this version', () => {
    const good = JSON.parse(encodeCatalog(CATALOG)) as Record<string, unknown>;
    const corrupt = (change: (file: Record<string, unknown>) => void): string => {
      const copy = structuredClone(good);
      change(copy);
      return JSON.stringify(copy);
    };
    const columnsOf = (file: Record<string, unknown>): Record<string, unknown[]> =>
      file.columns as Record<string, unknown[]>;

    expect(() => decodeCatalog('[]')).toThrow(/Not an Orbit Now catalog/);
    expect(() => decodeCatalog(corrupt((file) => (file.format = 'something-else')))).toThrow(
      /Not an Orbit Now catalog/,
    );
    expect(() => decodeCatalog(corrupt((file) => (file.version = 2)))).toThrow(/version 2/);
    expect(() => decodeCatalog(corrupt((file) => (file.generatedAt = 'soon')))).toThrow(
      /generatedAt/,
    );
    expect(() => decodeCatalog(corrupt((file) => (file.count = 3)))).toThrow(
      /does not have 3 entries/,
    );
    expect(() => decodeCatalog(corrupt((file) => delete columnsOf(file).bstar))).toThrow(
      /"bstar" is missing/,
    );
    expect(() =>
      decodeCatalog(corrupt((file) => (columnsOf(file).meanMotion = ['fast', 1]))),
    ).toThrow(/not a finite number/);
    expect(() => decodeCatalog(corrupt((file) => (columnsOf(file).name = [1, 2])))).toThrow(
      /not text/,
    );
    expect(() => decodeCatalog(corrupt((file) => (file.sources = [{ id: 'a' }])))).toThrow(
      /source entry/,
    );
    expect(() => decodeCatalog('not json')).toThrow();
  });
});

describe('recordToOmm', () => {
  it('rebuilds the OMM fields SGP4 reads, with the epoch to the microsecond', () => {
    expect(recordToOmm(CASE_00005)).toEqual({
      OBJECT_NAME: 'VERIFICATION 00005',
      OBJECT_ID: '58002B',
      EPOCH: '2000-06-27T18:50:19.733568',
      MEAN_MOTION: 10.82419157,
      ECCENTRICITY: 0.1859667,
      INCLINATION: 34.2682,
      RA_OF_ASC_NODE: 348.7242,
      ARG_OF_PERICENTER: 331.7664,
      MEAN_ANOMALY: 19.3264,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: 'U',
      NORAD_CAT_ID: 5,
      ELEMENT_SET_NO: 0,
      REV_AT_EPOCH: 0,
      BSTAR: 0.000028098,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
    });
  });
});
