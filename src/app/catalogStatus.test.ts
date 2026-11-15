import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/format';
import { describeAge, summariseCatalog } from './catalogStatus';

const HOUR = 3_600_000;

describe('describeAge', () => {
  it('rounds down, so data is never described as fresher than it is', () => {
    expect(describeAge(0)).toBe('less than an hour');
    expect(describeAge(HOUR - 1)).toBe('less than an hour');
    expect(describeAge(HOUR)).toBe('1 hour');
    expect(describeAge(2 * HOUR - 1)).toBe('1 hour');
    expect(describeAge(7.9 * HOUR)).toBe('7 hours');
    expect(describeAge(47.9 * HOUR)).toBe('47 hours');
    expect(describeAge(48 * HOUR)).toBe('2 days');
    expect(describeAge(71.9 * HOUR)).toBe('2 days');
    expect(describeAge(240 * HOUR)).toBe('10 days');
  });

  it('does not invent an age when the clocks disagree', () => {
    expect(describeAge(-1)).toBe('an unknown time');
    expect(describeAge(Number.NaN)).toBe('an unknown time');
  });
});

describe('summariseCatalog', () => {
  const base: Catalog = {
    generatedAt: '2026-11-14T12:00:00.000Z',
    sources: [
      {
        id: 'small',
        label: 'Small group',
        provider: 'CelesTrak',
        fetchedAt: '2026-11-14T03:17:00.000Z',
        objectCount: 3,
      },
      {
        id: 'big',
        label: 'Big group',
        provider: 'CelesTrak',
        fetchedAt: '2026-11-14T11:17:00.000Z',
        objectCount: 40,
      },
    ],
    records: [],
  };

  it('lists sources largest first and reports the oldest download time', () => {
    const summary = summariseCatalog(base);
    expect(summary.sources.map((source) => source.label)).toEqual(['Big group', 'Small group']);
    expect(summary.oldestFetchMs).toBe(Date.parse('2026-11-14T03:17:00.000Z'));
    expect(summary.objectCount).toBe(0);
  });

  it('reports the download time as unknown if any source has none', () => {
    const [first, second] = base.sources;
    if (first === undefined || second === undefined) {
      throw new Error('fixture');
    }
    const summary = summariseCatalog({ ...base, sources: [first, { ...second, fetchedAt: null }] });
    expect(summary.oldestFetchMs).toBeNull();
    expect(summariseCatalog({ ...base, sources: [] }).oldestFetchMs).toBeNull();
  });
});
