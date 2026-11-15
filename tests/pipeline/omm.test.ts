import { describe, expect, it } from 'vitest';
import { parseOmmCsv } from '../../pipeline/omm';
import {
  FIXTURE_ACCEPTED,
  FIXTURE_ROWS,
  OMM_CSV_HEADER,
  verificationSetAsOmmCsv,
} from './fixtureCsv';

/** A fixed "current time" for the tests: 2026-11-14T00:00:00Z. */
const NOW_MS = Date.UTC(2026, 10, 14);

const fixture = verificationSetAsOmmCsv();

/**
 * The first data row of the fixture (Vallado case 00005) with one column
 * replaced, as a complete two-line CSV document.
 */
function documentWithFirstRowChanged(
  column: (typeof OMM_CSV_HEADER)[number],
  value: string,
): string {
  const lines = fixture.split('\r\n');
  const fields = (lines[1] ?? '').split(',');
  fields[OMM_CSV_HEADER.indexOf(column)] = value;
  return `${lines[0] ?? ''}\r\n${fields.join(',')}\r\n`;
}

describe('parseOmmCsv on the published verification set', () => {
  const parsed = parseOmmCsv(fixture, NOW_MS);

  it('accepts 31 of the 33 element sets and says why the other two were left out', () => {
    expect(parsed.rowCount).toBe(FIXTURE_ROWS);
    expect(parsed.elementSets).toHaveLength(FIXTURE_ACCEPTED);
    // Case 33334 is an impossible orbit; case 20413 appears twice.
    expect(parsed.rejected).toEqual({ 'sgp4-error': 1, duplicate: 1 });
    expect(parsed.elementSets.some((set) => set.noradId === 33334)).toBe(false);
    expect(parsed.elementSets.filter((set) => set.noradId === 20413)).toHaveLength(1);
  });

  it('returns element sets in ascending catalog-number order', () => {
    const ids = parsed.elementSets.map((set) => set.noradId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0]).toBe(5);
  });

  it('carries every number over exactly', () => {
    // 1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
    // 2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667
    expect(parsed.elementSets[0]).toEqual({
      noradId: 5,
      name: 'VERIFICATION 00005',
      objectId: '1958-002B',
      // 2000-06-27 is 11 135 days after 1970-01-01.
      epochDay: 11135,
      // 18:50:19.733568 into the day.
      epochMicros: (18 * 3600 + 50 * 60 + 19) * 1_000_000 + 733_568,
      meanMotion: 10.82419157,
      eccentricity: 0.1859667,
      inclination: 34.2682,
      raan: 348.7242,
      argPericenter: 331.7664,
      meanAnomaly: 19.3264,
      bstar: 0.000028098,
    });
  });
});

describe('parseOmmCsv row checks', () => {
  it.each([
    ['an empty required field', 'MEAN_MOTION', '', 'missing-field'],
    ['an empty epoch', 'EPOCH', '', 'missing-field'],
    ['text where a number belongs', 'INCLINATION', 'abc', 'not-a-number'],
    ['a hexadecimal number', 'NORAD_CAT_ID', '0x10', 'not-a-number'],
    ['the word Infinity', 'BSTAR', 'Infinity', 'not-a-number'],
    ['an epoch that is not a date', 'EPOCH', 'yesterday', 'bad-epoch'],
    ['an impossible calendar date', 'EPOCH', '2001-02-30T00:00:00', 'bad-epoch'],
    ['an epoch finer than a microsecond', 'EPOCH', '2000-06-27T18:50:19.7335681', 'bad-epoch'],
    ['an epoch far in the future', 'EPOCH', '2027-01-01T00:00:00', 'future-epoch'],
    ['elements for a different propagator', 'EPHEMERIS_TYPE', '4', 'unsupported-ephemeris'],
    ['an eccentricity of 1', 'ECCENTRICITY', '1', 'out-of-range'],
    ['a negative eccentricity', 'ECCENTRICITY', '-0.1', 'out-of-range'],
    ['an inclination above 180 degrees', 'INCLINATION', '180.5', 'out-of-range'],
    ['a mean motion of zero', 'MEAN_MOTION', '0', 'out-of-range'],
    ['a mean motion faster than any orbit', 'MEAN_MOTION', '25', 'out-of-range'],
    ['a fractional catalog number', 'NORAD_CAT_ID', '5.5', 'out-of-range'],
    ['a catalog number of zero', 'NORAD_CAT_ID', '0', 'out-of-range'],
  ] as const)('leaves out a row with %s', (_description, column, value, reason) => {
    const parsed = parseOmmCsv(documentWithFirstRowChanged(column, value), NOW_MS);
    expect(parsed.rowCount).toBe(1);
    expect(parsed.elementSets).toHaveLength(0);
    expect(parsed.rejected).toEqual({ [reason]: 1 });
  });

  it('accepts an epoch up to 30 days ahead, and one written with a trailing Z', () => {
    const parsed = parseOmmCsv(
      documentWithFirstRowChanged('EPOCH', '2026-12-01T12:00:00.5Z'),
      NOW_MS,
    );
    expect(parsed.elementSets).toHaveLength(1);
    expect(parsed.elementSets[0]?.epochMicros).toBe(12 * 3600 * 1_000_000 + 500_000);
  });

  it('accepts catalog numbers above 99 999', () => {
    const parsed = parseOmmCsv(documentWithFirstRowChanged('NORAD_CAT_ID', '101357'), NOW_MS);
    expect(parsed.elementSets[0]?.noradId).toBe(101357);
  });

  it('accepts an object published without a name', () => {
    const parsed = parseOmmCsv(documentWithFirstRowChanged('OBJECT_NAME', ''), NOW_MS);
    expect(parsed.elementSets[0]?.name).toBe('');
  });

  it('keeps the newer of two element sets with the same catalog number', () => {
    const lines = fixture.split('\r\n');
    const older = lines[1] ?? '';
    const fields = older.split(',');
    fields[OMM_CSV_HEADER.indexOf('EPOCH')] = '2000-06-28T00:00:00.000000';
    const newer = fields.join(',');
    for (const document of [
      `${lines[0] ?? ''}\n${older}\n${newer}\n`,
      `${lines[0] ?? ''}\n${newer}\n${older}\n`,
    ]) {
      const parsed = parseOmmCsv(document, NOW_MS);
      expect(parsed.elementSets).toHaveLength(1);
      expect(parsed.elementSets[0]?.epochDay).toBe(11136);
      expect(parsed.rejected).toEqual({ duplicate: 1 });
    }
  });
});

describe('parseOmmCsv document checks', () => {
  it('refuses a document without the OMM header, naming what is missing', () => {
    expect(() => parseOmmCsv('GP data has not updated since your last download\n', NOW_MS)).toThrow(
      /does not have the expected OMM columns\. Missing: OBJECT_NAME, OBJECT_ID/,
    );
  });

  it('refuses an empty document', () => {
    expect(() => parseOmmCsv('', NOW_MS)).toThrow(/empty/);
  });

  it('finds columns by name, whatever their order', () => {
    const lines = fixture.trim().split('\r\n').slice(0, 2);
    const reversed = lines.map((line) => line.split(',').reverse().join(',')).join('\n');
    const parsed = parseOmmCsv(reversed, NOW_MS);
    expect(parsed.elementSets[0]?.noradId).toBe(5);
    expect(parsed.elementSets[0]?.meanMotion).toBe(10.82419157);
  });

  it('accepts a header-only document as zero rows', () => {
    const parsed = parseOmmCsv(`${OMM_CSV_HEADER.join(',')}\n`, NOW_MS);
    expect(parsed.rowCount).toBe(0);
    expect(parsed.elementSets).toHaveLength(0);
  });
});
