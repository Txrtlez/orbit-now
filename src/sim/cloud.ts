import { elementsAt } from './decay';
import { stateFromElements } from './orbit';
import type { SimFragment } from './simulate';

/**
 * Where every fragment of a cloud is at a time after the event, for
 * drawing.
 *
 * Positions are written in the tracker's drawing convention (y north,
 * lengths divided by `kmPerSceneUnit`), fragments still in orbit first.
 *
 * @param out     three numbers per fragment
 * @param parents which parent each written fragment came from, in the same order
 * @returns how many fragments are still in orbit, which is how many were written
 */
export function cloudPositions(
  fragments: readonly SimFragment[],
  years: number,
  kmPerSceneUnit: number,
  out: Float32Array,
  parents: Uint8Array,
): number {
  let written = 0;
  for (const fragment of fragments) {
    const { history } = fragment;
    if (history.reentryYears !== null && years >= history.reentryYears) {
      continue;
    }
    const { r } = stateFromElements(elementsAt(history, fragment.inclination, years));
    out[written * 3] = r[0] / kmPerSceneUnit;
    out[written * 3 + 1] = r[2] / kmPerSceneUnit;
    out[written * 3 + 2] = -r[1] / kmPerSceneUnit;
    parents[written] = fragment.parent;
    written += 1;
  }
  return written;
}

/** The shortest and longest times the time control covers, in years: one minute to a century. */
export const FIRST_MOMENT_YEARS = 1 / (365.25 * 1440);
export const LAST_MOMENT_YEARS = 100;

/** The time, in years, at a position along the time control (0 to 1), which is stretched evenly in ratio. */
export function momentAt(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return FIRST_MOMENT_YEARS * (LAST_MOMENT_YEARS / FIRST_MOMENT_YEARS) ** f;
}

/** The reverse of `momentAt`. */
export function fractionOfMoment(years: number): number {
  const clamped = Math.min(LAST_MOMENT_YEARS, Math.max(FIRST_MOMENT_YEARS, years));
  return Math.log(clamped / FIRST_MOMENT_YEARS) / Math.log(LAST_MOMENT_YEARS / FIRST_MOMENT_YEARS);
}

/** A span of time in words: "40 minutes", "3 hours", "12 days", "7 months", "25 years". */
export function describeSpan(years: number): string {
  const minutes = years * 365.25 * 1440;
  const say = (value: number, unit: string): string => {
    const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    return `${String(rounded)} ${unit}${rounded === 1 ? '' : 's'}`;
  };
  if (minutes < 90) {
    return say(Math.round(minutes), 'minute');
  }
  if (minutes < 36 * 60) {
    return say(minutes / 60, 'hour');
  }
  if (years < 60 / 365.25) {
    return say(minutes / 1440, 'day');
  }
  if (years < 1.5) {
    return say(years * 12, 'month');
  }
  return say(years, 'year');
}
