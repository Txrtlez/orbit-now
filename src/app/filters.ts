import { CATEGORIES } from '../catalog/categories';
import type { ObjectIndex } from '../catalog/objectIndex';
import { REGIMES, type Regime } from '../orbit/elements';

/**
 * Deciding which objects the viewer has asked to see.
 *
 * There are several independent questions (which family? which orbit?
 * launched when?). Within one question, ticking several answers widens the
 * selection ("Starlink or OneWeb"); across questions the answers must all
 * hold ("...and in low Earth orbit, and launched since 2020"). A question
 * with nothing ticked is not asked at all.
 */

/** A button in the "family" question. It may cover several categories. */
export interface FilterGroup {
  readonly id: string;
  readonly label: string;
  /** Identifiers of the categories (see src/catalog/categories.ts) this button covers. */
  readonly categoryIds: readonly string[];
}

/** The family buttons, in display order. */
export const FILTER_GROUPS: readonly FilterGroup[] = [
  { id: 'starlink', label: 'Starlink', categoryIds: ['starlink'] },
  { id: 'oneweb', label: 'OneWeb', categoryIds: ['oneweb'] },
  { id: 'kuiper', label: 'Kuiper', categoryIds: ['kuiper'] },
  { id: 'qianfan', label: 'Qianfan', categoryIds: ['qianfan'] },
  { id: 'hulianwang', label: 'Hulianwang', categoryIds: ['hulianwang'] },
  {
    id: 'navigation',
    label: 'Navigation',
    categoryIds: ['gps', 'glonass', 'galileo', 'beidou', 'qzss', 'navic'],
  },
  { id: 'stations', label: 'Space stations', categoryIds: ['stations'] },
  { id: 'fengyun-1c-debris', label: 'Fengyun-1C debris', categoryIds: ['fengyun-1c-debris'] },
  { id: 'cosmos-2251-debris', label: 'Cosmos 2251 debris', categoryIds: ['cosmos-2251-debris'] },
  { id: 'iridium-33-debris', label: 'Iridium 33 debris', categoryIds: ['iridium-33-debris'] },
  { id: 'other', label: 'Everything else', categoryIds: ['other'] },
];

/** What the viewer has asked for. */
export interface FilterState {
  /** Identifiers of the ticked family buttons. Empty means any family. */
  readonly groups: ReadonlySet<string>;
  /** The ticked orbit regimes. Empty means any regime. */
  readonly regimes: ReadonlySet<Regime>;
  /** Earliest launch year wanted, or null for no lower limit. */
  readonly yearFrom: number | null;
  /** Latest launch year wanted, or null for no upper limit. */
  readonly yearTo: number | null;
}

/** The state in which nothing is filtered. */
export const NO_FILTERS: FilterState = {
  groups: new Set(),
  regimes: new Set(),
  yearFrom: null,
  yearTo: null,
};

/** Whether the state filters anything out at all. */
export function isFilterActive(state: FilterState): boolean {
  return (
    state.groups.size > 0 ||
    state.regimes.size > 0 ||
    state.yearFrom !== null ||
    state.yearTo !== null
  );
}

/** For each category code, the identifier of the family button that covers it. */
function groupOfCategory(): readonly (string | undefined)[] {
  return CATEGORIES.map(
    (category) => FILTER_GROUPS.find((group) => group.categoryIds.includes(category.id))?.id,
  );
}

/**
 * Work out which objects pass the filters.
 *
 * An object whose launch year could not be read from its designator fails
 * any launch-year limit: it cannot be shown to be inside the range.
 *
 * @param out receives 1 for each object that passes and 0 for each that does not
 * @returns how many objects pass
 */
export function applyFilters(objects: ObjectIndex, state: FilterState, out: Uint8Array): number {
  if (out.length !== objects.count) {
    throw new RangeError('The output array must hold exactly one entry per object');
  }
  // Turn each question into a table lookup by code, done once, not once per object.
  const groupOf = groupOfCategory();
  const categoryPasses = groupOf.map(
    (groupId) => state.groups.size === 0 || (groupId !== undefined && state.groups.has(groupId)),
  );
  const regimePasses = REGIMES.map(
    (regime) => state.regimes.size === 0 || state.regimes.has(regime),
  );
  const yearLimited = state.yearFrom !== null || state.yearTo !== null;
  const from = state.yearFrom ?? -Infinity;
  const to = state.yearTo ?? Infinity;

  let passing = 0;
  for (let i = 0; i < objects.count; i += 1) {
    const year = objects.launchYear[i] ?? 0;
    const passes =
      categoryPasses[objects.category[i] ?? 0] === true &&
      regimePasses[objects.regime[i] ?? 0] === true &&
      (!yearLimited || (year !== 0 && year >= from && year <= to));
    out[i] = passes ? 1 : 0;
    if (passes) {
      passing += 1;
    }
  }
  return passing;
}

/** How many objects each family button and each regime covers, for labelling the buttons. */
export function countFilterOptions(objects: ObjectIndex): {
  readonly groups: ReadonlyMap<string, number>;
  readonly regimes: ReadonlyMap<Regime, number>;
} {
  const groupOf = groupOfCategory();
  const groups = new Map<string, number>(FILTER_GROUPS.map((group) => [group.id, 0]));
  const regimes = new Map<Regime, number>(REGIMES.map((regime) => [regime, 0]));
  for (let i = 0; i < objects.count; i += 1) {
    const groupId = groupOf[objects.category[i] ?? 0];
    if (groupId !== undefined) {
      groups.set(groupId, (groups.get(groupId) ?? 0) + 1);
    }
    const regime = REGIMES[objects.regime[i] ?? 0];
    if (regime !== undefined) {
      regimes.set(regime, (regimes.get(regime) ?? 0) + 1);
    }
  }
  return { groups, regimes };
}
