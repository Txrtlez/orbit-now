import { isFilterActive, type FilterState } from './filters';

/**
 * The three documented break-ups whose debris clouds this site can single
 * out, and what is said about each.
 *
 * REAL DATA. Every date, time, height, mass and count below was read on
 * 2026-11-15 from the NASA publications named in `sources`, and the page
 * or table is given so that it can be checked. Nothing here is from memory.
 * Where two NASA publications give slightly different figures (a mass of
 * 950 or 960 kg, a height of 788.6 or "about 790" km), the text uses a
 * rounded value that both support. The record of the check is
 * VALIDATION.md, V5.2.
 */

/** A count of catalogued pieces that NASA published, and the date it applied to. */
export interface PublishedCount {
  /** Pieces catalogued up to that date, including those that had since re-entered. */
  readonly catalogued: number;
  /** Of those, how many were still in orbit on that date. */
  readonly inOrbit: number;
  /** The date the counts are for, as written in the interface. */
  readonly asOf: string;
}

export interface DebrisEvent {
  /** Stable identifier. */
  readonly id: string;
  /** Year of the break-up, shown on its button. */
  readonly year: number;
  /** Short name for the button. */
  readonly title: string;
  /** Date and time of the break-up (UTC). */
  readonly when: string;
  /** Height and place of the break-up. */
  readonly where: string;
  /** What happened, in a few sentences. */
  readonly story: readonly string[];
  /**
   * The filter groups (see `FILTER_GROUPS`) whose objects make up the
   * cloud. Empty if this site's data contains nothing of the cloud.
   */
  readonly groupIds: readonly string[];
  /** NASA's counts for each cloud of the event, most recent publication that gives both figures. */
  readonly counts: readonly { readonly cloud: string; readonly count: PublishedCount }[];
  /**
   * The launches the broken-up satellites came from, as the first eight
   * characters of an international designator ("1982-092"). Used to check
   * the catalog for objects of the event that no group lists.
   */
  readonly launchIds: readonly string[];
  /**
   * For an event with no group to show: why, stated plainly. What the
   * catalog itself holds from the launch is added by the interface, which
   * can look.
   */
  readonly absence?: readonly string[];
  /** The publications the statements above were checked against. */
  readonly sources: readonly string[];
}

const TOP_TEN_2023 =
  'NASA, Orbital Debris Quarterly News 27-1 (March 2023), p. 2, table of the ten worst break-ups';
const AS_OF_2023 = '31 January 2023';

export const DEBRIS_EVENTS: readonly DebrisEvent[] = [
  {
    id: 'fengyun-1c',
    year: 2007,
    title: 'Fengyun-1C anti-satellite test',
    when: '11 January 2007, 22:26 UTC',
    where: 'About 860 km up, at 35° N, 100° E',
    story: [
      'China destroyed one of its own weather satellites, the eight-year-old Fengyun-1C, by hitting it with an interceptor launched on a missile from Xichang. The satellite weighed a little under a tonne.',
      'No other break-up on NASA’s list has left as many catalogued pieces. Because it happened so high, where there is very little air to slow things down, NASA expected most of the debris to stay up for decades, some of it for centuries.',
    ],
    groupIds: ['fengyun-1c-debris'],
    launchIds: ['1999-025'],
    counts: [
      {
        cloud: 'Fengyun-1C',
        count: { catalogued: 3532, inOrbit: 2793, asOf: AS_OF_2023 },
      },
    ],
    sources: [
      'NASA, History of On-orbit Satellite Fragmentations, 16th edition (NASA/TP-20220019160, 2022), p. 456',
      'NASA, Orbital Debris Quarterly News 11-2 (April 2007), pp. 2-3, and 12-1 (January 2008), p. 2',
      TOP_TEN_2023,
    ],
  },
  {
    id: 'iridium-cosmos',
    year: 2009,
    title: 'Iridium 33 and Cosmos 2251 collision',
    when: '10 February 2009, 16:56 UTC',
    where: 'About 790 km up, over the far north of Siberia',
    story: [
      'Iridium 33, a working American communications satellite, and Cosmos 2251, a Russian communications satellite that was no longer in use, ran into each other at more than 11 km per second. Their orbits crossed almost at right angles.',
      'It was the first time two intact satellites had collided by accident. Each left its own cloud, and this site draws them in different colours: Cosmos 2251, the heavier of the two, produced more pieces.',
    ],
    groupIds: ['cosmos-2251-debris', 'iridium-33-debris'],
    launchIds: ['1993-036', '1997-051'],
    counts: [
      {
        cloud: 'Cosmos 2251',
        count: { catalogued: 1715, inOrbit: 1021, asOf: AS_OF_2023 },
      },
      {
        cloud: 'Iridium 33',
        count: { catalogued: 657, inOrbit: 300, asOf: AS_OF_2023 },
      },
    ],
    sources: [
      'NASA, Orbital Debris Quarterly News 13-2 (April 2009), pp. 1-2',
      'NASA, History of On-orbit Satellite Fragmentations, 16th edition (2022), pp. 404 and 440',
      TOP_TEN_2023,
    ],
  },
  {
    id: 'cosmos-1408',
    year: 2021,
    title: 'Cosmos 1408 anti-satellite test',
    when: '15 November 2021, 02:48 UTC',
    where: 'About 480 km up, at 70° N, 48° E',
    story: [
      'Russia destroyed Cosmos 1408, a Soviet electronic-intelligence satellite launched in 1982 and long out of use, with a missile fired from the ground.',
      'At that height there is still enough air to bring debris down within years. Only 364 of 1,785 catalogued pieces were still in orbit fourteen months later, and NASA found the cloud was coming down faster than first predicted, because the Sun had been more active than forecast.',
    ],
    groupIds: [],
    launchIds: ['1982-092'],
    counts: [
      {
        cloud: 'Cosmos 1408',
        count: { catalogued: 1785, inOrbit: 364, asOf: AS_OF_2023 },
      },
    ],
    absence: [
      'This cloud cannot be singled out here. CelesTrak, where this site gets its orbits, publishes no list for it (checked on 14 November 2026).',
      'How many pieces are still in orbit today was not established from a reliable source, so no number is given. The 2023 count above is the latest one from NASA that this site has checked.',
    ],
    sources: [
      'NASA, History of On-orbit Satellite Fragmentations, 16th edition (2022), pp. 228-229',
      TOP_TEN_2023,
      'NASA, Orbital Debris Quarterly News 28-2 (April 2024), pp. 2-4',
    ],
  },
];

/** The event with this identifier, or undefined. */
export function eventById(id: string | null): DebrisEvent | undefined {
  return DEBRIS_EVENTS.find((event) => event.id === id);
}

/**
 * The groups of an event that have at least one object in the catalog.
 * These, and only these, are what isolating the event ticks: a cloud that
 * has decayed completely, or that a data file happens to lack, has no
 * button to tick.
 *
 * @param groupCounts objects behind each family button (from `countFilterOptions`)
 */
export function groupsWithObjects(
  event: DebrisEvent,
  groupCounts: ReadonlyMap<string, number>,
): string[] {
  return event.groupIds.filter((id) => (groupCounts.get(id) ?? 0) > 0);
}

/**
 * Which event's cloud the filters are currently isolating, if any: the
 * family buttons ticked are exactly that event's groups (those that have
 * objects), and no other question (orbit, kind, owner, launch year) is
 * being asked.
 */
export function eventIsolatedBy(
  state: FilterState,
  groupCounts: ReadonlyMap<string, number>,
): DebrisEvent | undefined {
  if (
    state.regimes.size > 0 ||
    state.types.size > 0 ||
    state.owner !== null ||
    state.yearFrom !== null ||
    state.yearTo !== null ||
    !isFilterActive(state)
  ) {
    return undefined;
  }
  return DEBRIS_EVENTS.find((event) => {
    const groups = groupsWithObjects(event, groupCounts);
    return (
      groups.length > 0 &&
      groups.length === state.groups.size &&
      groups.every((id) => state.groups.has(id))
    );
  });
}

/**
 * How many of an event's objects are in the catalog, cloud by cloud and in
 * all.
 *
 * @param groupCounts objects behind each family button (from `countFilterOptions`)
 */
export function objectsInData(
  event: DebrisEvent,
  groupCounts: ReadonlyMap<string, number>,
): { readonly total: number; readonly perGroup: readonly number[] } {
  const perGroup = event.groupIds.map((id) => groupCounts.get(id) ?? 0);
  return { total: perGroup.reduce((sum, count) => sum + count, 0), perGroup };
}

/**
 * How many objects in the catalog were launched with the satellites of an
 * event, going by their international designators.
 */
export function objectsFromLaunches(event: DebrisEvent, designators: readonly string[]): number {
  let count = 0;
  for (const designator of designators) {
    if (event.launchIds.some((launchId) => designator.startsWith(launchId))) {
      count += 1;
    }
  }
  return count;
}
