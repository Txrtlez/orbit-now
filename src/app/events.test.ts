import { describe, expect, it } from 'vitest';
import {
  DEBRIS_EVENTS,
  eventById,
  eventIsolatedBy,
  groupsWithObjects,
  objectsFromLaunches,
  objectsInData,
} from './events';
import { FILTER_GROUPS, NO_FILTERS, type FilterState } from './filters';

function withGroups(...ids: string[]): FilterState {
  return { ...NO_FILTERS, groups: new Set(ids) };
}

describe('DEBRIS_EVENTS', () => {
  it('lists the three break-ups in the order they happened', () => {
    expect(DEBRIS_EVENTS.map((event) => event.year)).toEqual([2007, 2009, 2021]);
    expect(DEBRIS_EVENTS.map((event) => event.id)).toEqual([
      'fengyun-1c',
      'iridium-cosmos',
      'cosmos-1408',
    ]);
  });

  it('refers only to family buttons that exist', () => {
    const known = new Set(FILTER_GROUPS.map((group) => group.id));
    for (const event of DEBRIS_EVENTS) {
      for (const id of event.groupIds) {
        expect(known.has(id), `${event.id} names ${id}`).toBe(true);
      }
    }
  });

  it('gives every event a date, a place, a story, counts and sources', () => {
    for (const event of DEBRIS_EVENTS) {
      expect(event.when).toMatch(new RegExp(`${String(event.year)}, \\d\\d:\\d\\d UTC$`));
      expect(event.where).toMatch(/^About \d+ km up/);
      expect(event.story.length).toBeGreaterThan(0);
      expect(event.counts.length).toBeGreaterThan(0);
      expect(event.sources.length).toBeGreaterThanOrEqual(2);
      for (const { count } of event.counts) {
        expect(count.inOrbit).toBeLessThanOrEqual(count.catalogued);
      }
    }
  });

  it('explains itself wherever there is nothing to draw, and only there', () => {
    for (const event of DEBRIS_EVENTS) {
      expect(event.absence !== undefined, event.id).toBe(event.groupIds.length === 0);
    }
  });
});

describe('eventById', () => {
  it('finds an event, and nothing for an unknown or missing identifier', () => {
    expect(eventById('iridium-cosmos')?.year).toBe(2009);
    expect(eventById('nonsense')).toBeUndefined();
    expect(eventById(null)).toBeUndefined();
  });
});

/** Every debris group has objects, as in the real catalog. */
const ALL_PRESENT = new Map([
  ['fengyun-1c-debris', 1988],
  ['cosmos-2251-debris', 581],
  ['iridium-33-debris', 109],
]);

describe('eventIsolatedBy', () => {
  it('recognises the filter state that shows exactly one event', () => {
    expect(eventIsolatedBy(withGroups('fengyun-1c-debris'), ALL_PRESENT)?.id).toBe('fengyun-1c');
    expect(
      eventIsolatedBy(withGroups('iridium-33-debris', 'cosmos-2251-debris'), ALL_PRESENT)?.id,
    ).toBe('iridium-cosmos');
  });

  it('is not fooled by part of an event, more than an event, or no filter at all', () => {
    expect(eventIsolatedBy(NO_FILTERS, ALL_PRESENT)).toBeUndefined();
    expect(eventIsolatedBy(withGroups('iridium-33-debris'), ALL_PRESENT)).toBeUndefined();
    expect(
      eventIsolatedBy(withGroups('fengyun-1c-debris', 'starlink'), ALL_PRESENT),
    ).toBeUndefined();
    expect(eventIsolatedBy(withGroups('starlink'), ALL_PRESENT)).toBeUndefined();
  });

  it('is not an isolated event once any other question is asked', () => {
    const base = withGroups('fengyun-1c-debris');
    expect(eventIsolatedBy({ ...base, regimes: new Set(['LEO']) }, ALL_PRESENT)).toBeUndefined();
    expect(eventIsolatedBy({ ...base, types: new Set(['DEB']) }, ALL_PRESENT)).toBeUndefined();
    expect(eventIsolatedBy({ ...base, owner: 'PRC' }, ALL_PRESENT)).toBeUndefined();
    expect(eventIsolatedBy({ ...base, yearFrom: 1999 }, ALL_PRESENT)).toBeUndefined();
    expect(eventIsolatedBy({ ...base, yearTo: 1999 }, ALL_PRESENT)).toBeUndefined();
  });

  it("goes by the clouds that have objects when one of an event's two is missing", () => {
    const cosmosOnly = new Map([['cosmos-2251-debris', 581]]);
    expect(eventIsolatedBy(withGroups('cosmos-2251-debris'), cosmosOnly)?.id).toBe(
      'iridium-cosmos',
    );
    expect(eventIsolatedBy(withGroups('cosmos-2251-debris'), ALL_PRESENT)).toBeUndefined();
  });

  it('never reports an event none of whose objects are in the catalog', () => {
    expect(eventIsolatedBy(withGroups('fengyun-1c-debris'), new Map())).toBeUndefined();
  });
});

describe('groupsWithObjects', () => {
  it("keeps the groups that have at least one object, in the event's own order", () => {
    const collision = eventById('iridium-cosmos');
    if (collision === undefined) {
      throw new Error('The event is missing');
    }
    expect(groupsWithObjects(collision, ALL_PRESENT)).toEqual([
      'cosmos-2251-debris',
      'iridium-33-debris',
    ]);
    expect(groupsWithObjects(collision, new Map([['iridium-33-debris', 0]]))).toEqual([]);
  });
});

describe('objectsInData', () => {
  it('adds up the groups of an event, counting a missing group as none', () => {
    const counts = new Map([
      ['cosmos-2251-debris', 581],
      ['fengyun-1c-debris', 1988],
    ]);
    const collision = eventById('iridium-cosmos');
    const test2021 = eventById('cosmos-1408');
    if (collision === undefined || test2021 === undefined) {
      throw new Error('An event is missing');
    }
    expect(objectsInData(collision, counts)).toEqual({ total: 581, perGroup: [581, 0] });
    expect(objectsInData(test2021, counts)).toEqual({ total: 0, perGroup: [] });
  });
});

describe('objectsFromLaunches', () => {
  it("counts the objects whose designators begin with one of the event's launches", () => {
    const collision = eventById('iridium-cosmos');
    const test2021 = eventById('cosmos-1408');
    if (collision === undefined || test2021 === undefined) {
      throw new Error('An event is missing');
    }
    const designators = ['1993-036A', '1993-036BXC', '1997-051C', '1997-052A', '1982-092A', ''];
    expect(objectsFromLaunches(collision, designators)).toBe(3);
    expect(objectsFromLaunches(test2021, designators)).toBe(1);
    expect(objectsFromLaunches(test2021, ['1982-093A', '1999-025A'])).toBe(0);
  });
});
