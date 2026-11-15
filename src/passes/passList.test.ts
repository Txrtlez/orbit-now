import { describe, expect, it } from 'vitest';
import {
  dayKey,
  describePass,
  endOfPass,
  formatDuration,
  formatSkyPosition,
  groupByDay,
  sortPasses,
  startOfPass,
  timeZoneAbbreviation,
  type ListedPass,
} from './passList';
import type { Pass, PassEvent } from './predict';
import type { PassTarget } from './targets';

const at = (timeMs: number, elevationDeg = 10, azimuthDeg = 0): PassEvent => ({
  timeMs,
  elevationDeg,
  azimuthDeg,
});

/** A pass that rises at `riseMs` and lasts six minutes. */
function pass(riseMs: number, visible: Pass['visible'] | 'whole' | null = null): Pass {
  const rise = at(riseMs, 10, 300);
  const culmination = at(riseMs + 180_000, 62.4, 30);
  const set = at(riseMs + 360_000, 10, 120);
  return {
    rise,
    culmination,
    set,
    visible: visible === 'whole' ? { start: rise, highest: culmination, end: set } : visible,
    notVisibleReason: visible === null ? 'in-shadow' : null,
    sunElevationDeg: -20,
  };
}

const ISS: PassTarget = {
  index: 0,
  noradId: 25544,
  name: 'International Space Station',
  kind: 'station',
};
const OTHER: PassTarget = { index: 1, noradId: 20580, name: 'HST', kind: 'bright' };

describe('startOfPass and endOfPass', () => {
  it('use the visible part when there is one', () => {
    const partly = pass(1_000_000, {
      start: at(1_060_000, 25),
      highest: at(1_180_000, 62.4),
      end: at(1_200_000, 55),
    });
    expect(startOfPass(partly)).toBe(1_060_000);
    expect(endOfPass(partly)).toBe(1_200_000);
    expect(startOfPass(pass(1_000_000))).toBe(1_000_000);
    expect(endOfPass(pass(1_000_000))).toBe(1_360_000);
  });
});

describe('sortPasses', () => {
  it('orders by time, with a station ahead of another satellite at the same moment', () => {
    const list: ListedPass[] = [
      { target: OTHER, pass: pass(5000) },
      { target: OTHER, pass: pass(1000) },
      { target: ISS, pass: pass(5000) },
    ];
    expect(sortPasses(list).map((entry) => [entry.target.noradId, entry.pass.rise.timeMs])).toEqual(
      [
        [20580, 1000],
        [25544, 5000],
        [20580, 5000],
      ],
    );
    // The input is left as it was.
    expect(list[0]?.pass.rise.timeMs).toBe(5000);
  });
});

describe('dayKey', () => {
  it('gives the date in the time zone asked for, not in UTC', () => {
    const instant = Date.UTC(2026, 10, 16, 2, 30); // 02:30 UTC on the 16th
    expect(dayKey(instant, 'UTC')).toBe('2026-11-16');
    expect(dayKey(instant, 'America/New_York')).toBe('2026-11-15');
    expect(dayKey(instant, 'Australia/Sydney')).toBe('2026-11-16');
  });
});

describe('groupByDay', () => {
  const now = Date.UTC(2026, 10, 15, 20, 0); // 15:00 in New York
  const list: ListedPass[] = [
    { target: ISS, pass: pass(Date.UTC(2026, 10, 15, 22, 57)) }, // 17:57 on the 15th
    { target: OTHER, pass: pass(Date.UTC(2026, 10, 16, 3, 0)) }, // 22:00 on the 15th
    { target: ISS, pass: pass(Date.UTC(2026, 10, 16, 11, 0)) }, // 06:00 on the 16th
    { target: ISS, pass: pass(Date.UTC(2026, 10, 18, 11, 0)) }, // the 18th
  ];

  it('splits at local midnight and names today and tomorrow', () => {
    const days = groupByDay(list, 'America/New_York', now);
    expect(days.map((day) => [day.label, day.passes.length])).toEqual([
      ['Today, Sunday 15 November', 2],
      ['Tomorrow, Monday 16 November', 1],
      ['Wednesday 18 November', 1],
    ]);
  });

  it('uses the calendar of the place, so the same passes fall on other days elsewhere', () => {
    const days = groupByDay(list, 'Australia/Sydney', now);
    // In Sydney it is already the 16th.
    expect(days.map((day) => [day.label, day.passes.length])).toEqual([
      ['Today, Monday 16 November', 3],
      ['Wednesday 18 November', 1],
    ]);
  });

  it('finds tomorrow across a change of clocks', () => {
    // Clocks in New York go back on 1 November 2026; that day is 25 hours long.
    const beforeChange = Date.UTC(2026, 10, 1, 4, 30); // 00:30 EDT on 1 November
    const next = [{ target: ISS, pass: pass(Date.UTC(2026, 10, 2, 5, 30)) }]; // 00:30 EST on the 2nd
    expect(groupByDay(next, 'America/New_York', beforeChange)[0]?.label).toBe(
      'Tomorrow, Monday 2 November',
    );
  });

  it('returns nothing for no passes', () => {
    expect(groupByDay([], 'UTC', now)).toEqual([]);
  });
});

describe('formatting', () => {
  it('writes short passes in seconds and longer ones in minutes', () => {
    expect(formatDuration(44_400)).toBe('44 s');
    expect(formatDuration(89_000)).toBe('89 s');
    expect(formatDuration(241_000)).toBe('4 min');
    expect(formatDuration(390_000)).toBe('7 min');
  });

  it('writes a sky position in whole degrees and a compass point', () => {
    expect(formatSkyPosition(at(0, 14.8, 337))).toBe('15° NNW');
    expect(formatSkyPosition(at(0, 89.6, 181))).toBe('90° S');
  });

  it('names the time zone in force at that moment', () => {
    expect(timeZoneAbbreviation(Date.UTC(2026, 10, 15), 'America/New_York')).toBe('EST');
    expect(timeZoneAbbreviation(Date.UTC(2026, 6, 15), 'America/New_York')).toBe('EDT');
    expect(timeZoneAbbreviation(Date.UTC(2026, 10, 15), 'UTC')).toBe('UTC');
  });
});

describe('describePass', () => {
  it('describes a pass that is visible from end to end', () => {
    const description = describePass(pass(0, 'whole'));
    expect(description.status).toBe('Visible');
    expect(description.visible).toBe(true);
    expect(description.moments.map((moment) => moment.label)).toEqual([
      'Appears',
      'Highest',
      'Disappears',
    ]);
    expect(description.durationMs).toBe(360_000);
    expect(description.note).toBe('');
  });

  it('says when the satellite enters or leaves the shadow in mid-sky', () => {
    const fading = describePass(
      pass(0, { start: at(0, 10), highest: at(180_000, 62.4), end: at(200_000, 58) }),
    );
    expect(fading.note).toBe('Fades into the Earth’s shadow in mid-sky.');
    expect(fading.durationMs).toBe(200_000);
    expect(fading.moments[2].event.elevationDeg).toBe(58);

    const emerging = describePass(
      pass(0, { start: at(240_000, 40), highest: at(240_000, 40), end: at(360_000, 10) }),
    );
    expect(emerging.note).toBe('Comes out of the Earth’s shadow in mid-sky.');
  });

  it('describes passes that cannot be seen by their rise and set', () => {
    const shadowed = describePass(pass(0));
    expect(shadowed.status).toBe("In Earth's shadow");
    expect(shadowed.visible).toBe(false);
    expect(shadowed.moments.map((moment) => moment.label)).toEqual(['Rises', 'Highest', 'Sets']);

    const daylight = describePass({ ...pass(0), notVisibleReason: 'daylight' });
    expect(daylight.status).toBe('Daylight');
    expect(daylight.note).toBe('The sky is too bright to see it.');
  });
});
