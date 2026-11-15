import { json2satrec, sgp4 } from 'satellite.js';
import { epochToUnixMs, parseEpoch, recordToOmm, type CatalogRecord } from '../src/catalog/format';
import { parseCsv } from './csv';

/**
 * Reading and checking OMM element sets delivered as CSV.
 *
 * OMM (Orbit Mean-elements Message) is the CCSDS standard that replaces the
 * two-line element set. CelesTrak serves it as CSV with one header row of
 * OMM keywords and one row per object.
 *
 * Every row is checked individually. A row that fails is left out and
 * counted under the reason it failed; it is never corrected. The counts are
 * published so that what was dropped, and why, is visible.
 */

/** A catalog record before it has been assigned to any source. */
export type ElementSet = Omit<CatalogRecord, 'sourceMask'>;

/** Why a row was left out. */
export type RejectionReason =
  /** A required field was empty. */
  | 'missing-field'
  /** A numeric field did not contain a plain decimal number. */
  | 'not-a-number'
  /** The epoch was not a UTC date-time with at most microsecond precision. */
  | 'bad-epoch'
  /** The epoch was more than 30 days in the future. */
  | 'future-epoch'
  /** The elements are for a propagator other than SGP4 (EPHEMERIS_TYPE is not 0). */
  | 'unsupported-ephemeris'
  /** An element was outside the range that is physically or mathematically possible. */
  | 'out-of-range'
  /** SGP4 itself reported an error when asked for the state at the epoch. */
  | 'sgp4-error'
  /** The same catalog number appeared more than once; the older element set was dropped. */
  | 'duplicate';

export interface ParsedElementSets {
  /** Rows in the file, not counting the header. */
  readonly rowCount: number;
  /** Element sets that passed every check, at most one per catalog number. */
  readonly elementSets: readonly ElementSet[];
  /** How many rows were left out, by reason. */
  readonly rejected: Readonly<Partial<Record<RejectionReason, number>>>;
}

/** The OMM keywords this project reads. Their absence from the header makes the whole file unusable. */
const REQUIRED_COLUMNS = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'NORAD_CAT_ID',
  'BSTAR',
] as const;

type Column = (typeof REQUIRED_COLUMNS)[number];

/** How far in the future an epoch may lie before it is treated as an error. */
const MAX_FUTURE_EPOCH_MS = 30 * 86_400_000;

/**
 * Upper limit on mean motion, in revolutions per day. A circular orbit
 * skimming the Earth's surface (radius 6378 km) has a period of about 84.5
 * minutes, which is 17.04 revolutions per day; nothing can orbit faster. The
 * limit is set a little above that to catch corrupt values without having to
 * decide here whether a nearly decayed object is still in orbit. SGP4 makes
 * that call (see 'sgp4-error').
 */
const MAX_MEAN_MOTION_REV_PER_DAY = 18;

/** A plain decimal number, optionally with an exponent. Nothing else is accepted as numeric. */
const DECIMAL_NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function readNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL_NUMBER.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse OMM CSV text into checked element sets.
 *
 * @param text  the CSV document
 * @param nowMs the current time in milliseconds since 1970-01-01 UTC, used
 *              only to detect epochs implausibly far in the future
 * @throws if the document is not CSV with the expected OMM header. That is a
 *         problem with the whole download, not with individual rows.
 */
export function parseOmmCsv(text: string, nowMs: number): ParsedElementSets {
  const rows = parseCsv(text);
  const header = rows[0];
  if (header === undefined) {
    throw new Error('The document is empty');
  }
  const columnIndex = new Map<string, number>();
  header.forEach((name, index) => columnIndex.set(name.trim(), index));
  const missing = REQUIRED_COLUMNS.filter((name) => !columnIndex.has(name));
  if (missing.length > 0) {
    throw new Error(
      `The document does not have the expected OMM columns. Missing: ${missing.join(', ')}. ` +
        `First line was: ${header.join(',').slice(0, 200)}`,
    );
  }
  const indexOf = (name: Column): number => columnIndex.get(name) ?? -1;

  const rejected: Partial<Record<RejectionReason, number>> = {};
  const reject = (reason: RejectionReason): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  const byCatalogNumber = new Map<number, ElementSet>();
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const text_ = (name: Column): string => (row[indexOf(name)] ?? '').trim();

    // Text fields. An empty name is allowed (some objects are published
    // without one); the identifying catalog number is not optional.
    const name = text_('OBJECT_NAME');
    const objectId = text_('OBJECT_ID');

    const numericNames = [
      'NORAD_CAT_ID',
      'MEAN_MOTION',
      'ECCENTRICITY',
      'INCLINATION',
      'RA_OF_ASC_NODE',
      'ARG_OF_PERICENTER',
      'MEAN_ANOMALY',
      'EPHEMERIS_TYPE',
      'BSTAR',
    ] as const;
    if (text_('EPOCH') === '' || numericNames.some((column) => text_(column) === '')) {
      reject('missing-field');
      continue;
    }
    const numbers = numericNames.map((column) => readNumber(text_(column)));
    if (numbers.some((value) => value === null)) {
      reject('not-a-number');
      continue;
    }
    const [
      noradId = 0,
      meanMotion = 0,
      eccentricity = 0,
      inclination = 0,
      raan = 0,
      argPericenter = 0,
      meanAnomaly = 0,
      ephemerisType = 0,
      bstar = 0,
    ] = numbers.map((value) => value ?? 0);

    const epoch = parseEpoch(text_('EPOCH'));
    if (epoch === null) {
      reject('bad-epoch');
      continue;
    }
    if (epochToUnixMs(epoch.epochDay, epoch.epochMicros) > nowMs + MAX_FUTURE_EPOCH_MS) {
      reject('future-epoch');
      continue;
    }

    // EPHEMERIS_TYPE 0 means the elements are meant for SGP4. Other values
    // (for example 4, used for the US Space Force's SGP4-XP) need a different
    // propagator and would give wrong positions if fed to SGP4.
    if (ephemerisType !== 0) {
      reject('unsupported-ephemeris');
      continue;
    }

    const inRange =
      Number.isInteger(noradId) &&
      noradId >= 1 &&
      noradId <= 999_999_999 &&
      meanMotion > 0 &&
      meanMotion <= MAX_MEAN_MOTION_REV_PER_DAY &&
      eccentricity >= 0 &&
      eccentricity < 1 &&
      inclination >= 0 &&
      inclination <= 180 &&
      raan >= 0 &&
      raan <= 360 &&
      argPericenter >= 0 &&
      argPericenter <= 360 &&
      meanAnomaly >= 0 &&
      meanAnomaly <= 360;
    if (!inRange) {
      reject('out-of-range');
      continue;
    }

    const elementSet: ElementSet = {
      noradId,
      name,
      objectId,
      epochDay: epoch.epochDay,
      epochMicros: epoch.epochMicros,
      meanMotion,
      eccentricity,
      inclination,
      raan,
      argPericenter,
      meanAnomaly,
      bstar,
    };

    // Final check: can the propagator the app uses actually produce a state
    // from these elements at their own epoch? This catches element sets that
    // pass the range checks individually but describe no valid orbit (for
    // example an object that has already decayed).
    const satrec = json2satrec(recordToOmm({ ...elementSet, sourceMask: 0 }));
    if (sgp4(satrec, 0) === null) {
      reject('sgp4-error');
      continue;
    }

    const existing = byCatalogNumber.get(noradId);
    if (existing !== undefined) {
      reject('duplicate');
      const existingMs = epochToUnixMs(existing.epochDay, existing.epochMicros);
      const candidateMs = epochToUnixMs(elementSet.epochDay, elementSet.epochMicros);
      if (candidateMs <= existingMs) {
        continue;
      }
    }
    byCatalogNumber.set(noradId, elementSet);
  }

  return {
    rowCount: dataRows.length,
    elementSets: [...byCatalogNumber.values()].sort((a, b) => a.noradId - b.noradId),
    rejected,
  };
}
