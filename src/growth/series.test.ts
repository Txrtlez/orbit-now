import { describe, expect, it } from 'vitest';
import {
  CHECKSUMS,
  FRAGMENTATION_DEBRIS,
  MISSION_RELATED_DEBRIS,
  MONTH_COUNT,
  ROCKET_BODIES,
  SPACECRAFT,
  TOTAL,
} from './odqnFigure';
import {
  countsFromFigure,
  FIGURE_GRID_OBJECTS,
  formatApproximate,
  formatCountAt,
  formatMonth,
  GROWTH_EVENT_MARKS,
  GROWTH_KINDS,
  GROWTH_TOTAL,
  indexOfMonth,
  LAST_MONTH,
  monthAt,
  tableMonths,
  unassignedAt,
} from './series';

const MODULUS = 1_000_000_007;

/** The checksum described in odqnFigure.ts, in exact integer arithmetic. */
function checksum(values: readonly number[]): [number, number] {
  let sum = 0n;
  let weighted = 0n;
  const modulus = BigInt(MODULUS);
  values.forEach((value, index) => {
    const positive = ((BigInt(value) % modulus) + modulus) % modulus;
    sum = (sum + positive) % modulus;
    weighted = (weighted + positive * BigInt(index + 1)) % modulus;
  });
  return [Number(sum), Number(weighted)];
}

describe('the figure as read', () => {
  const arrays = {
    TOTAL,
    SPACECRAFT,
    FRAGMENTATION_DEBRIS,
    ROCKET_BODIES,
    MISSION_RELATED_DEBRIS,
  };

  it('has one value per month from January 1957 to May 2026', () => {
    for (const values of Object.values(arrays)) {
      expect(values).toHaveLength(MONTH_COUNT);
    }
    expect(MONTH_COUNT).toBe((2026 - 1957) * 12 + 5);
  });

  it('is unchanged since it was read: every checksum matches', () => {
    for (const [name, values] of Object.entries(arrays)) {
      expect(checksum(values), name).toEqual(CHECKSUMS[name]);
    }
  });
});

describe('countsFromFigure', () => {
  it('maps the axis linearly: zero to 0 and the top gridline to 35,000', () => {
    expect(countsFromFigure([0, 374_288, 187_144])).toEqual([0, 35_000, 17_500]);
  });

  it('never returns a negative count', () => {
    expect(countsFromFigure([-29])).toEqual([0]);
    for (const series of [GROWTH_TOTAL, ...GROWTH_KINDS]) {
      expect(Math.min(...series.counts)).toBeGreaterThanOrEqual(0);
    }
  });

  it('has a resolution of about 14 objects', () => {
    expect(FIGURE_GRID_OBJECTS).toBeGreaterThan(14.2);
    expect(FIGURE_GRID_OBJECTS).toBeLessThan(14.4);
  });
});

describe('months', () => {
  it('converts between positions and calendar months', () => {
    expect(monthAt(0)).toEqual({ year: 1957, month: 1 });
    expect(monthAt(LAST_MONTH)).toEqual({ year: 2026, month: 5 });
    expect(indexOfMonth(1957, 10)).toBe(9);
    expect(monthAt(indexOfMonth(2009, 2))).toEqual({ year: 2009, month: 2 });
    expect(formatMonth(indexOfMonth(2007, 1))).toBe('January 2007');
  });

  it('clamps to the series', () => {
    expect(monthAt(-5)).toEqual({ year: 1957, month: 1 });
    expect(monthAt(10_000)).toEqual({ year: 2026, month: 5 });
    expect(indexOfMonth(1900, 1)).toBe(0);
    expect(indexOfMonth(2100, 1)).toBe(LAST_MONTH);
  });

  it('lists every tenth January and the last month for the table', () => {
    expect(tableMonths().map((index) => formatMonth(index))).toEqual([
      'January 1960',
      'January 1970',
      'January 1980',
      'January 1990',
      'January 2000',
      'January 2010',
      'January 2020',
      'May 2026',
    ]);
  });

  it('marks the three break-ups in the months they happened', () => {
    expect(GROWTH_EVENT_MARKS.map((mark) => formatMonth(mark.index))).toEqual([
      'January 2007',
      'February 2009',
      'November 2021',
    ]);
    for (const mark of GROWTH_EVENT_MARKS) {
      expect(formatMonth(mark.index).endsWith(String(mark.year))).toBe(true);
    }
  });
});

describe('formatApproximate', () => {
  it('rounds to the nearest ten', () => {
    expect(formatApproximate(33_475)).toBe('33,480');
    expect(formatApproximate(1_816)).toBe('1,820');
    expect(formatApproximate(24)).toBe('20');
  });

  it('does not name a number the figure cannot resolve', () => {
    expect(formatApproximate(12)).toBe('under 20');
    expect(formatApproximate(0)).toBe('under 20');
    expect(formatApproximate(0, true)).toBe('0');
  });
});

describe('formatCountAt', () => {
  it('writes a true zero before anything had been launched, and "under 20" just after', () => {
    // The figure's lines leave zero in October 1957.
    expect(formatCountAt(GROWTH_TOTAL, indexOfMonth(1957, 9))).toBe('0');
    expect(formatCountAt(GROWTH_TOTAL, indexOfMonth(1957, 10))).toBe('under 20');
  });

  it('writes a true zero for fragmentation debris until the first break-up in the figure', () => {
    const fragmentation = GROWTH_KINDS.find((kind) => kind.id === 'fragmentation');
    if (fragmentation === undefined) {
      throw new Error('The fragmentation series is missing');
    }
    expect(formatCountAt(fragmentation, indexOfMonth(1961, 5))).toBe('0');
    expect(formatCountAt(fragmentation, indexOfMonth(1961, 6))).toBe('310');
  });
});

describe('the series as a whole', () => {
  it('ends at the values read from the right-hand end of the figure', () => {
    expect(GROWTH_TOTAL.counts[LAST_MONTH]).toBe(33_475);
    expect(GROWTH_KINDS.map((kind) => kind.counts[LAST_MONTH])).toEqual([
      17_954, 10_880, 2_145, 1_816,
    ]);
  });

  it('reports how far the total runs above the four kinds', () => {
    expect(Math.abs(unassignedAt(indexOfMonth(2000, 1)))).toBeLessThan(40);
    expect(unassignedAt(LAST_MONTH)).toBe(680);
  });
});
