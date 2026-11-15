import { describe, expect, it } from 'vitest';
import { mergeCatalog, type SourceUpdate } from '../../pipeline/merge';
import { parseOmmCsv, type ElementSet } from '../../pipeline/omm';
import type { SourceDefinition } from '../../pipeline/sources';
import { verificationSetAsOmmCsv } from './fixtureCsv';

// Real element sets from the published verification set, in catalog-number order.
const all = parseOmmCsv(verificationSetAsOmmCsv(), Date.UTC(2026, 10, 14)).elementSets;

function pick(...noradIds: number[]): ElementSet[] {
  return noradIds.map((id) => {
    const found = all.find((set) => set.noradId === id);
    if (found === undefined) {
      throw new Error(`Fixture has no element set ${String(id)}`);
    }
    return found;
  });
}

function definition(id: string): SourceDefinition {
  return {
    id,
    label: id.toUpperCase(),
    provider: 'TEST',
    url: `https://example.invalid/${id}`,
    minimumObjects: 1,
  };
}

const A = definition('a');
const B = definition('b');
const T1 = '2026-11-14T00:00:00.000Z';
const T2 = '2026-11-14T08:00:00.000Z';

function updates(
  entries: Record<string, { sets: ElementSet[]; at: string }>,
): Map<string, SourceUpdate> {
  return new Map(
    Object.entries(entries).map(([id, entry]) => [
      id,
      { elementSets: entry.sets, fetchedAt: entry.at },
    ]),
  );
}

describe('mergeCatalog', () => {
  it('builds a first catalog, recording which source lists each object', () => {
    const catalog = mergeCatalog(
      null,
      updates({ a: { sets: pick(5, 4632), at: T1 }, b: { sets: pick(4632, 6251), at: T1 } }),
      [A, B],
      T1,
    );
    expect(catalog.records.map((record) => [record.noradId, record.sourceMask])).toEqual([
      [5, 0b01],
      [4632, 0b11],
      [6251, 0b10],
    ]);
    expect(catalog.sources).toEqual([
      { id: 'a', label: 'A', provider: 'TEST', fetchedAt: T1, objectCount: 2 },
      { id: 'b', label: 'B', provider: 'TEST', fetchedAt: T1, objectCount: 2 },
    ]);
    expect(catalog.generatedAt).toBe(T1);
  });

  it('replaces a refreshed source completely and leaves the other source untouched', () => {
    const first = mergeCatalog(
      null,
      updates({ a: { sets: pick(5, 4632), at: T1 }, b: { sets: pick(4632, 6251), at: T1 } }),
      [A, B],
      T1,
    );
    // Source "a" now lists 5 and 8195; it no longer lists 4632.
    const second = mergeCatalog(first, updates({ a: { sets: pick(5, 8195), at: T2 } }), [A, B], T2);
    expect(second.records.map((record) => [record.noradId, record.sourceMask])).toEqual([
      [5, 0b01],
      [4632, 0b10], // still listed by "b"
      [6251, 0b10],
      [8195, 0b01],
    ]);
    expect(
      second.sources.map((source) => [source.id, source.fetchedAt, source.objectCount]),
    ).toEqual([
      ['a', T2, 2],
      ['b', T1, 2], // not refreshed: keeps its earlier download time
    ]);
  });

  it('removes an object once no source lists it', () => {
    const first = mergeCatalog(null, updates({ a: { sets: pick(5, 4632), at: T1 } }), [A, B], T1);
    const second = mergeCatalog(first, updates({ a: { sets: pick(5), at: T2 } }), [A, B], T2);
    expect(second.records.map((record) => record.noradId)).toEqual([5]);
  });

  it('keeps the element set with the later epoch when two sources list the same object', () => {
    const [original] = pick(5);
    if (original === undefined) {
      throw new Error('missing fixture');
    }
    const later: ElementSet = { ...original, epochDay: original.epochDay + 1 };
    for (const [first, second] of [
      [original, later],
      [later, original],
    ] as const) {
      const catalog = mergeCatalog(
        null,
        updates({ a: { sets: [first], at: T1 }, b: { sets: [second], at: T1 } }),
        [A, B],
        T1,
      );
      expect(catalog.records).toHaveLength(1);
      expect(catalog.records[0]?.epochDay).toBe(original.epochDay + 1);
      expect(catalog.records[0]?.sourceMask).toBe(0b11);
    }
  });

  it('re-maps membership bits when the list of sources is reordered', () => {
    const first = mergeCatalog(
      null,
      updates({ a: { sets: pick(5), at: T1 }, b: { sets: pick(6251), at: T1 } }),
      [A, B],
      T1,
    );
    // Same sources, opposite order, nothing refreshed except "a".
    const second = mergeCatalog(first, updates({ a: { sets: pick(5), at: T2 } }), [B, A], T2);
    expect(second.sources.map((source) => source.id)).toEqual(['b', 'a']);
    expect(second.records.map((record) => [record.noradId, record.sourceMask])).toEqual([
      [5, 0b10], // "a" is now bit 1
      [6251, 0b01], // "b" is now bit 0
    ]);
  });

  it('drops memberships of a source that no longer exists', () => {
    const first = mergeCatalog(
      null,
      updates({ a: { sets: pick(5), at: T1 }, b: { sets: pick(5, 6251), at: T1 } }),
      [A, B],
      T1,
    );
    const second = mergeCatalog(first, updates({ a: { sets: pick(5), at: T2 } }), [A], T2);
    expect(second.records.map((record) => [record.noradId, record.sourceMask])).toEqual([[5, 0b1]]);
  });

  it('refuses an update for a source that is not defined', () => {
    expect(() => mergeCatalog(null, updates({ zzz: { sets: pick(5), at: T1 } }), [A], T1)).toThrow(
      /unknown source "zzz"/,
    );
  });
});
