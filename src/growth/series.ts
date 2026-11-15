import {
  AXIS_TOP_COUNT,
  AXIS_TOP_THOUSANDTHS,
  FIRST_YEAR,
  FRAGMENTATION_DEBRIS,
  MISSION_RELATED_DEBRIS,
  MONTH_COUNT,
  ROCKET_BODIES,
  SPACECRAFT,
  TOTAL,
} from './odqnFigure';

/**
 * The growth-of-orbit series: how many catalogued objects were in Earth
 * orbit each month since 1957, by kind.
 *
 * REAL DATA, read from a published figure. The source is one chart in
 * NASA's Orbital Debris Quarterly News (see `GROWTH_SOURCE`). NASA does not
 * publish the numbers behind it, so they were recovered from the positions
 * of the chart's lines in the PDF. That recovery has a known resolution:
 * the lines were drawn on a grid about 14.3 objects wide, so each count here
 * is within roughly ten objects of the one NASA plotted, and no better.
 * `formatApproximate` exists so that the interface never prints a figure
 * more exactly than that.
 */

/** Where the numbers come from, for citing in the interface. */
export const GROWTH_SOURCE = {
  publisher: 'NASA Orbital Debris Program Office',
  publication: 'Orbital Debris Quarterly News',
  issue: 'volume 30, issues 1 & 2',
  issueDate: 'July 2026',
  page: 9,
  figureTitle: 'Monthly Number of Cataloged Objects in Earth Orbit by Object Type',
  /** The date NASA gives for the data in the figure's caption. */
  dataAsOf: '3 May 2026',
  url: 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/pdfs/ODQNv30i1.pdf',
  /** When this project read the figure. */
  readOn: '2026-11-15',
} as const;

/** The four kinds of object the figure distinguishes, in the order they are listed here. */
export type GrowthKind = 'spacecraft' | 'fragmentation' | 'rocketBodies' | 'missionRelated';

export interface GrowthSeries {
  readonly id: GrowthKind | 'total';
  /** Name for legends and tables, in NASA's own words. */
  readonly label: string;
  /** What the kind includes, from the figure's caption where it says. */
  readonly description: string;
  /** Number of objects each month, January 1957 first. Never negative. */
  readonly counts: readonly number[];
}

/**
 * Turn positions along the figure's axis into object counts.
 *
 * The axis is linear: 0 objects at its zero line and 35,000 at its top
 * gridline. A line drawn a hair below zero (the drawing grid's nearest
 * point to a count of one or two) is taken as zero, since a count cannot be
 * negative.
 */
export function countsFromFigure(thousandths: readonly number[]): number[] {
  return thousandths.map((value) =>
    Math.max(0, Math.round((value * AXIS_TOP_COUNT) / AXIS_TOP_THOUSANDTHS)),
  );
}

/**
 * The resolution of the recovered counts: the spacing of the grid the
 * figure's lines were drawn on, in objects (0.153125 PDF points). A count
 * is within half of this of the value NASA plotted.
 */
export const FIGURE_GRID_OBJECTS = (153.125 * AXIS_TOP_COUNT) / AXIS_TOP_THOUSANDTHS;

export const GROWTH_TOTAL: GrowthSeries = {
  id: 'total',
  label: 'Total objects',
  description: 'Every object in Earth orbit catalogued by the US Space Surveillance Network.',
  counts: countsFromFigure(TOTAL),
};

/** The four kinds, in a fixed order that the chart's colours follow. */
export const GROWTH_KINDS: readonly GrowthSeries[] = [
  {
    id: 'spacecraft',
    label: 'Spacecraft',
    description: 'Satellites and other payloads, working or not.',
    counts: countsFromFigure(SPACECRAFT),
  },
  {
    id: 'fragmentation',
    label: 'Fragmentation debris',
    description: 'Pieces from satellite break-ups and from anomalous events.',
    counts: countsFromFigure(FRAGMENTATION_DEBRIS),
  },
  {
    id: 'rocketBodies',
    label: 'Rocket bodies',
    description: 'Spent rocket stages.',
    counts: countsFromFigure(ROCKET_BODIES),
  },
  {
    id: 'missionRelated',
    label: 'Mission-related debris',
    description: 'Objects dispensed, separated or released as part of a planned mission.',
    counts: countsFromFigure(MISSION_RELATED_DEBRIS),
  },
];

/** Position of the last month in every series. */
export const LAST_MONTH = MONTH_COUNT - 1;

/** The calendar month at a position in the series. `month` runs from 1 to 12. */
export function monthAt(index: number): { year: number; month: number } {
  const clamped = Math.min(LAST_MONTH, Math.max(0, Math.round(index)));
  return { year: FIRST_YEAR + Math.floor(clamped / 12), month: (clamped % 12) + 1 };
}

/** The position in the series of a calendar month (`month` from 1 to 12), clamped to the series. */
export function indexOfMonth(year: number, month: number): number {
  return Math.min(LAST_MONTH, Math.max(0, (year - FIRST_YEAR) * 12 + (month - 1)));
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** A position in the series as words: "May 2026". */
export function formatMonth(index: number): string {
  const { year, month } = monthAt(index);
  return `${MONTH_NAMES[month - 1] ?? ''} ${String(year)}`;
}

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * A recovered count as text, no more exact than the recovery allows.
 *
 * - Rounded to the nearest ten: the figure cannot support the last digit.
 * - Below 20 the figure cannot tell 3 objects from 15, so the text says
 *   "under 20" instead of naming a number.
 * - Zero is only written as "0" when the caller knows it is a true zero
 *   (`exactZero`): nothing of that kind had been launched or created yet.
 */
export function formatApproximate(count: number, exactZero = false): string {
  if (exactZero) {
    return '0';
  }
  if (count < 20) {
    return 'under 20';
  }
  return WHOLE.format(Math.round(count / 10) * 10);
}

/**
 * For each series, the first month at which the figure's line leaves the
 * axis's zero. Before it the count is a true zero; from it on, a small
 * count is "a few", not "none". Worked out from the raw positions, because
 * rounding to counts hides the difference.
 */
function firstNonZero(thousandths: readonly number[]): number {
  const found = thousandths.findIndex((value) => value !== 0);
  return found === -1 ? thousandths.length : found;
}

const FIRST_NON_ZERO: Readonly<Record<GrowthSeries['id'], number>> = {
  total: firstNonZero(TOTAL),
  spacecraft: firstNonZero(SPACECRAFT),
  fragmentation: firstNonZero(FRAGMENTATION_DEBRIS),
  rocketBodies: firstNonZero(ROCKET_BODIES),
  missionRelated: firstNonZero(MISSION_RELATED_DEBRIS),
};

/** The text for one series at one month. */
export function formatCountAt(series: GrowthSeries, index: number): string {
  const clamped = Math.min(LAST_MONTH, Math.max(0, Math.round(index)));
  return formatApproximate(series.counts[clamped] ?? 0, clamped < FIRST_NON_ZERO[series.id]);
}

/**
 * How far the figure's total line runs above its four kinds added
 * together, in objects, at a month. Close to zero until 2018 (the leftover
 * is rounding), then growing: see `README.md`.
 */
export function unassignedAt(index: number): number {
  const clamped = Math.min(LAST_MONTH, Math.max(0, Math.round(index)));
  const kinds = GROWTH_KINDS.reduce((sum, kind) => sum + (kind.counts[clamped] ?? 0), 0);
  return (GROWTH_TOTAL.counts[clamped] ?? 0) - kinds;
}

/** The months shown in the table of numbers: every tenth January, then the last month. */
export function tableMonths(): number[] {
  const months: number[] = [];
  for (let year = 1960; indexOfMonth(year, 1) < LAST_MONTH; year += 10) {
    months.push(indexOfMonth(year, 1));
  }
  months.push(LAST_MONTH);
  return months;
}

/**
 * The three break-ups this site has layers for, as positions in the series
 * (the month each happened), for marking on the chart. The dates are
 * verified in `src/app/events.ts`.
 */
export const GROWTH_EVENT_MARKS: readonly {
  readonly index: number;
  readonly year: number;
  readonly label: string;
}[] = [
  { index: indexOfMonth(2007, 1), year: 2007, label: 'Fengyun-1C test' },
  { index: indexOfMonth(2009, 2), year: 2009, label: 'Collision' },
  { index: indexOfMonth(2021, 11), year: 2021, label: 'Cosmos 1408 test' },
];
