/**
 * Validation of the growth-of-orbit series, which was read from the lines
 * of a published NASA chart (src/growth/odqnFigure.ts) because NASA does
 * not publish the numbers behind it.
 *
 * Three kinds of check, none of which uses the chart itself:
 *
 * 1. The chart against itself. It draws a total and four kinds. Wherever
 *    the total is the sum of the four, five independently read lines must
 *    agree to within the rounding of the reading. This tests the reading,
 *    the calibration of the axis and the assignment of line to kind at once.
 * 2. The chart against counts NASA printed as numbers elsewhere: the three
 *    break-ups' catalogued debris, and the "Satellite Box Score" table in
 *    the same issue.
 * 3. The chart against the calendar: the months in which the three
 *    break-ups show.
 *
 * Results are recorded in VALIDATION.md, entry V5.1.
 */
import { describe, expect, it } from 'vitest';
import { DEBRIS_EVENTS } from '../../src/app/events';
import {
  FRAGMENTATION_DEBRIS,
  MISSION_RELATED_DEBRIS,
  ROCKET_BODIES,
  SPACECRAFT,
  TOTAL,
} from '../../src/growth/odqnFigure';
import {
  FIGURE_GRID_OBJECTS,
  GROWTH_KINDS,
  GROWTH_TOTAL,
  indexOfMonth,
  LAST_MONTH,
} from '../../src/growth/series';
import { recordMeasurement } from './measurements';

function kind(id: string): readonly number[] {
  const found = GROWTH_KINDS.find((series) => series.id === id);
  if (found === undefined) {
    throw new Error(`No series called ${id}`);
  }
  return found.counts;
}

const total = GROWTH_TOTAL.counts;
const spacecraft = kind('spacecraft');
const fragmentation = kind('fragmentation');
const rocketBodies = kind('rocketBodies');
const missionRelated = kind('missionRelated');

/** Total minus the four kinds, month by month. */
const leftover = total.map(
  (value, index) =>
    value -
    (spacecraft[index] ?? 0) -
    (fragmentation[index] ?? 0) -
    (rocketBodies[index] ?? 0) -
    (missionRelated[index] ?? 0),
);

/**
 * The last month in which the chart's total is still, to within the
 * reading's rounding, the sum of its four kinds. Found by inspection of the
 * leftover: it stays within 40 objects for 62 years and then climbs
 * steadily (66 in January 2019, 610 in January 2026).
 */
const LAST_MONTH_OF_AGREEMENT = indexOfMonth(2018, 11);

describe('the chart against itself', () => {
  it('reads five lines that agree: total = sum of the four kinds, for 62 years', () => {
    const span = leftover.slice(0, LAST_MONTH_OF_AGREEMENT + 1).map(Math.abs);
    const worst = Math.max(...span);
    const mean = span.reduce((sum, value) => sum + value, 0) / span.length;
    recordMeasurement('V5.1 total minus sum of kinds, Jan 1957 to Nov 2018', {
      months: span.length,
      worstObjects: worst,
      meanObjects: Number(mean.toFixed(1)),
    });
    // Five lines, each read to within half a grid step (about 7 objects):
    // the leftover cannot exceed five times that, and should usually be far less.
    expect(worst).toBeLessThanOrEqual(Math.ceil(2.5 * FIGURE_GRID_OBJECTS) + 3);
    expect(mean).toBeLessThan(12);
  });

  it('shows the total running above the four kinds from December 2018 onwards', () => {
    const atStartOf = (year: number): number => leftover[indexOfMonth(year, 1)] ?? 0;
    recordMeasurement('V5.1 total minus sum of kinds, each January', {
      y2019: atStartOf(2019),
      y2020: atStartOf(2020),
      y2021: atStartOf(2021),
      y2022: atStartOf(2022),
      y2023: atStartOf(2023),
      y2024: atStartOf(2024),
      y2025: atStartOf(2025),
      y2026: atStartOf(2026),
      lastMonth: leftover[LAST_MONTH] ?? 0,
    });
    expect(leftover[LAST_MONTH_OF_AGREEMENT + 1]).toBeGreaterThan(40);
    for (let year = 2019; year < 2026; year += 1) {
      expect(atStartOf(year + 1)).toBeGreaterThan(atStartOf(year));
    }
    expect(leftover[LAST_MONTH]).toBeGreaterThan(600);
  });

  it('was drawn on a grid: nearly every vertex sits on a multiple of 0.153125 points', () => {
    const offGrid = (values: readonly number[]): number =>
      values.filter((value) => {
        const steps = (value + 29) / 153.125;
        return value !== 0 && Math.abs(steps - Math.round(steps)) > 0.03;
      }).length;
    const counts = {
      total: offGrid(TOTAL),
      spacecraft: offGrid(SPACECRAFT),
      fragmentation: offGrid(FRAGMENTATION_DEBRIS),
      rocketBodies: offGrid(ROCKET_BODIES),
      missionRelated: offGrid(MISSION_RELATED_DEBRIS),
    };
    recordMeasurement('V5.1 vertices not on the drawing grid, of 833 per line', counts);
    // The four thinner lines are on the grid except at one peak each. The
    // heavier total line has more exceptions; they are still within a step.
    expect(counts.spacecraft + counts.fragmentation).toBeLessThanOrEqual(2);
    expect(counts.rocketBodies + counts.missionRelated).toBeLessThanOrEqual(2);
    expect(counts.total).toBeLessThan(100);
  });
});

describe('the chart against the calendar and NASA’s printed counts', () => {
  /**
   * The rise in fragmentation debris from the month before to the month
   * of an event.
   */
  const stepAt = (year: number, month: number): number => {
    const index = indexOfMonth(year, month);
    return (fragmentation[index] ?? 0) - (fragmentation[index - 1] ?? 0);
  };

  it('has its three largest steps in the months of the three break-ups', () => {
    const steps = fragmentation
      .map((value, index) => ({ index, rise: value - (fragmentation[index - 1] ?? value) }))
      .sort((a, b) => b.rise - a.rise)
      .slice(0, 3)
      .map((step) => step.index);
    expect(steps).toEqual([indexOfMonth(2007, 1), indexOfMonth(2009, 2), indexOfMonth(2021, 11)]);
  });

  it('steps by about as many pieces as NASA catalogued from each break-up', () => {
    const catalogued = (eventId: string): number => {
      const event = DEBRIS_EVENTS.find((candidate) => candidate.id === eventId);
      if (event === undefined) {
        throw new Error(`No event called ${eventId}`);
      }
      return event.counts.reduce((sum, { count }) => sum + count.catalogued, 0);
    };
    const comparisons = [
      { name: 'Fengyun-1C', step: stepAt(2007, 1), nasa: catalogued('fengyun-1c') },
      {
        name: 'Iridium 33 and Cosmos 2251',
        step: stepAt(2009, 2),
        nasa: catalogued('iridium-cosmos'),
      },
      { name: 'Cosmos 1408', step: stepAt(2021, 11), nasa: catalogued('cosmos-1408') },
    ];
    for (const { name, step, nasa } of comparisons) {
      recordMeasurement(`V5.1 step in fragmentation debris, ${name}`, {
        stepInChart: step,
        cataloguedPerNasa2023: nasa,
        differencePercent: Number((((step - nasa) / nasa) * 100).toFixed(1)),
      });
      // The printed counts are of 31 January 2023 and the chart's of May
      // 2026, and other debris came and went in the same months, so exact
      // agreement is not expected. A wrong axis or a wrong line would be
      // out by far more than this.
      expect(Math.abs(step - nasa) / nasa).toBeLessThan(0.03);
    }
  });

  it('ends near the Satellite Box Score printed in the same issue', () => {
    // Orbital Debris Quarterly News 30-1&2 (July 2026), p. 14: totals as
    // catalogued on 4 May 2026. Read on 2026-11-15.
    const boxScore = { spacecraft: 18_189, rocketBodiesAndDebris: 14_909, total: 33_098 };
    const chart = {
      spacecraft: spacecraft[LAST_MONTH] ?? 0,
      total: total[LAST_MONTH] ?? 0,
    };
    recordMeasurement('V5.1 last month of the chart against the box score', {
      chartTotal: chart.total,
      boxScoreTotal: boxScore.total,
      totalDifferencePercent: Number(
        (((chart.total - boxScore.total) / boxScore.total) * 100).toFixed(2),
      ),
      chartSpacecraft: chart.spacecraft,
      boxScoreSpacecraft: boxScore.spacecraft,
      spacecraftDifferencePercent: Number(
        (((chart.spacecraft - boxScore.spacecraft) / boxScore.spacecraft) * 100).toFixed(2),
      ),
      chartEverythingElse: chart.total - chart.spacecraft,
      boxScoreEverythingElse: boxScore.rocketBodiesAndDebris,
    });
    // The two are different products of the same office, a day apart, and
    // do not agree exactly; the size of the disagreement is recorded, not
    // explained. A misread axis would be out by far more than 2%.
    expect(Math.abs(chart.total - boxScore.total) / boxScore.total).toBeLessThan(0.02);
    expect(Math.abs(chart.spacecraft - boxScore.spacecraft) / boxScore.spacecraft).toBeLessThan(
      0.02,
    );
  });

  it('leaves zero in October 1957, and not before', () => {
    expect(TOTAL.findIndex((value) => value !== 0)).toBe(indexOfMonth(1957, 10));
    expect(SPACECRAFT.findIndex((value) => value !== 0)).toBe(indexOfMonth(1957, 10));
  });
});
