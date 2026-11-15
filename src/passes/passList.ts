import { compassPoint } from '../geo/topocentric';
import type { Pass, PassEvent } from './predict';
import type { PassTarget } from './targets';

/**
 * Turning predicted passes into what the list shows: their order, the day
 * each belongs to, and the words and figures of each row.
 */

/** One pass of one satellite. */
export interface ListedPass {
  readonly target: PassTarget;
  readonly pass: Pass;
}

/** The moment a row is about: when the satellite can first be seen, or when it rises if it cannot be. */
export function startOfPass(pass: Pass): number {
  return (pass.visible?.start ?? pass.rise).timeMs;
}

/** The moment a row stops mattering: when the satellite is last seen, or sets. */
export function endOfPass(pass: Pass): number {
  return (pass.visible?.end ?? pass.set).timeMs;
}

/** Passes in order of time; at equal times, stations first. */
export function sortPasses(passes: readonly ListedPass[]): ListedPass[] {
  return [...passes].sort(
    (a, b) =>
      startOfPass(a.pass) - startOfPass(b.pass) ||
      Number(a.target.kind !== 'station') - Number(b.target.kind !== 'station') ||
      a.target.noradId - b.target.noradId,
  );
}

/** The calendar date of an instant in a time zone, as "2026-11-15". */
export function dayKey(timeMs: number, timeZone: string | undefined): string {
  // The Swedish locale writes dates as year-month-day.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(timeMs);
}

export interface PassDay {
  /** "Today", "Tomorrow" or a date such as "Tuesday 17 November". */
  readonly label: string;
  readonly passes: readonly ListedPass[];
}

/**
 * Split passes, already in order of time, into the days they start on.
 *
 * @param timeZone the time zone whose calendar to use; undefined for the browser's own
 * @param nowMs    the present, for calling days "Today" and "Tomorrow"
 */
export function groupByDay(
  passes: readonly ListedPass[],
  timeZone: string | undefined,
  nowMs: number,
): PassDay[] {
  const today = dayKey(nowMs, timeZone);
  // A day is not always 24 hours long (clocks change), so "tomorrow" is
  // found by stepping forward until the date changes.
  let tomorrowMs = nowMs;
  while (dayKey(tomorrowMs, timeZone) === today) {
    tomorrowMs += 3_600_000;
  }
  const tomorrow = dayKey(tomorrowMs, timeZone);
  const dateLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const days: { key: string; label: string; passes: ListedPass[] }[] = [];
  for (const listed of passes) {
    const start = startOfPass(listed.pass);
    const key = dayKey(start, timeZone);
    let day = days.at(-1);
    if (day?.key !== key) {
      const date = dateLabel.format(start);
      day = {
        key,
        label: key === today ? `Today, ${date}` : key === tomorrow ? `Tomorrow, ${date}` : date,
        passes: [],
      };
      days.push(day);
    }
    day.passes.push(listed);
  }
  return days.map(({ label, passes: inDay }) => ({ label, passes: inDay }));
}

/** A time of day with seconds, in a time zone, written the way the viewer's own settings write times. */
export function formatPassTime(timeMs: number, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timeMs);
}

/** The short name of a time zone at an instant, such as "EST" or "GMT+8". */
export function timeZoneAbbreviation(timeMs: number, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    timeZoneName: 'short',
  }).formatToParts(timeMs);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/** A length of time for a pass: "45 s", "4 min", "6 min". */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 90) {
    return `${String(seconds)} s`;
  }
  return `${String(Math.round(seconds / 60))} min`;
}

/** How high and in which direction: "15° NNW". Whole degrees: the prediction is not good to a tenth. */
export function formatSkyPosition(event: PassEvent): string {
  return `${String(Math.round(event.elevationDeg))}° ${compassPoint(event.azimuthDeg)}`;
}

/** One of the three moments shown for a pass. */
export interface PassMoment {
  /** "Appears", "Highest", "Rises" and so on. */
  readonly label: string;
  readonly event: PassEvent;
}

export interface PassDescription {
  /** "Visible", "Daylight" or "In Earth's shadow". */
  readonly status: string;
  readonly visible: boolean;
  /** The beginning, highest point and end of what the row describes. */
  readonly moments: readonly [PassMoment, PassMoment, PassMoment];
  /** How long that lasts, in milliseconds. */
  readonly durationMs: number;
  /** A sentence about anything unusual, or "". */
  readonly note: string;
}

/** The visible part counts as starting or ending in mid-sky if it differs from the rise or set by more than this. */
const MID_SKY_MS = 3000;

/**
 * What to say about one pass.
 *
 * For a pass that can be seen, the three moments are those of the part
 * that can be seen, which may begin or end in mid-sky where the satellite
 * leaves or enters the Earth's shadow. For one that cannot, they are when
 * it climbs above the minimum elevation, peaks and sinks below it again.
 */
export function describePass(pass: Pass): PassDescription {
  if (pass.visible === null) {
    return {
      status: pass.notVisibleReason === 'daylight' ? 'Daylight' : "In Earth's shadow",
      visible: false,
      moments: [
        { label: 'Rises', event: pass.rise },
        { label: 'Highest', event: pass.culmination },
        { label: 'Sets', event: pass.set },
      ],
      durationMs: pass.set.timeMs - pass.rise.timeMs,
      note:
        pass.notVisibleReason === 'daylight'
          ? 'The sky is too bright to see it.'
          : 'It is in the Earth’s shadow, so it does not shine.',
    };
  }
  const { start, highest, end } = pass.visible;
  const emerges = start.timeMs - pass.rise.timeMs > MID_SKY_MS;
  const fades = pass.set.timeMs - end.timeMs > MID_SKY_MS;
  const notes: string[] = [];
  if (emerges) {
    notes.push('Comes out of the Earth’s shadow in mid-sky.');
  }
  if (fades) {
    notes.push('Fades into the Earth’s shadow in mid-sky.');
  }
  return {
    status: 'Visible',
    visible: true,
    moments: [
      { label: 'Appears', event: start },
      { label: 'Highest', event: highest },
      { label: 'Disappears', event: end },
    ],
    durationMs: end.timeMs - start.timeMs,
    note: notes.join(' '),
  };
}
