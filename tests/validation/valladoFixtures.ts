import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OMMJsonObject } from 'satellite.js';

/** One reference state: time since epoch, then position and velocity in the TEME frame. */
export interface ReferenceState {
  /** Minutes since the element set's epoch. May be negative. */
  readonly tsinceMin: number;
  /** Position in kilometres: x, y, z. */
  readonly position: readonly [number, number, number];
  /** Velocity in kilometres per second: x, y, z. */
  readonly velocity: readonly [number, number, number];
}

/** One verification case: an element set and the states the reference code produced for it. */
export interface VerificationCase {
  /** Catalog number as printed in the reference output, e.g. "5" or "28872". */
  readonly id: string;
  /** First 69 characters of TLE line 1. */
  readonly line1: string;
  /** First 69 characters of TLE line 2. */
  readonly line2: string;
  /** Requested output step in minutes (from the extra columns after line 2). */
  readonly stepMin: number;
  /** Requested stop time in minutes since epoch. */
  readonly stopMin: number;
  /** The reference states, in file order. */
  readonly states: readonly ReferenceState[];
}

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/vallado-2006/', import.meta.url));

function requireNumber(text: string | undefined, what: string): number {
  const value = Number(text);
  if (text === undefined || text.trim() === '' || !Number.isFinite(value)) {
    throw new Error(`Could not read ${what} from "${String(text)}"`);
  }
  return value;
}

/** Read both fixture files and pair each element set with its block of reference states. */
export function loadVerificationCases(): VerificationCase[] {
  const tleLines = readFileSync(`${FIXTURE_DIR}SGP4-VER.TLE`, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
  if (tleLines.length % 2 !== 0) {
    throw new Error('SGP4-VER.TLE does not contain a whole number of two-line element sets');
  }

  // tcppver.out is a sequence of blocks. Each starts with a header line such as
  // "28872 xx" and continues with one line per output time.
  const blocks: { id: string; states: ReferenceState[] }[] = [];
  for (const line of readFileSync(`${FIXTURE_DIR}tcppver.out`, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const fields = line.trim().split(/\s+/);
    if (fields.length === 2 && fields[1] === 'xx') {
      blocks.push({ id: fields[0] ?? '', states: [] });
      continue;
    }
    const block = blocks.at(-1);
    if (block === undefined) {
      throw new Error('tcppver.out has a data line before the first header');
    }
    const n = (index: number): number => requireNumber(fields[index], `column ${String(index)}`);
    block.states.push({
      tsinceMin: n(0),
      position: [n(1), n(2), n(3)],
      velocity: [n(4), n(5), n(6)],
    });
  }

  const cases: VerificationCase[] = [];
  for (let i = 0; i < tleLines.length; i += 2) {
    const line1 = tleLines[i] ?? '';
    const line2 = tleLines[i + 1] ?? '';
    const block = blocks[i / 2];
    if (block === undefined) {
      throw new Error(`No reference block for element set ${String(i / 2 + 1)}`);
    }
    // The catalog number in the element set must match the block header
    // (the header drops leading zeros).
    if (Number(line2.slice(2, 7)) !== Number(block.id)) {
      throw new Error(`Element set ${line2.slice(2, 7)} is paired with block ${block.id}`);
    }
    const extra = line2.slice(69).trim().split(/\s+/);
    cases.push({
      id: block.id,
      line1: line1.slice(0, 69),
      line2: line2.slice(0, 69),
      stopMin: requireNumber(extra[1], 'stop time'),
      stepMin: requireNumber(extra[2], 'step'),
      states: block.states,
    });
  }
  if (cases.length !== blocks.length) {
    throw new Error('Different numbers of element sets and reference blocks');
  }
  return cases;
}

/**
 * Read a TLE field written in the format's compact exponent notation, in
 * which " 28098-4" means 0.28098e-4 and "-11606-4" means -0.11606e-4: an
 * assumed leading decimal point, five mantissa digits, then a signed exponent.
 */
function parseImpliedDecimal(field: string, what: string): number {
  const match = /^([ +-])(\d{5})([+-]\d)$/.exec(field);
  if (match === null) {
    throw new Error(`Could not read ${what} from "${field}"`);
  }
  const sign = match[1] === '-' ? '-' : '';
  return requireNumber(`${sign}0.${match[2] ?? ''}e${match[3] ?? ''}`, what);
}

/**
 * Re-express a two-line element set as an OMM record of the kind CelesTrak
 * serves as JSON. The conversion is exact: every number is carried over
 * digit for digit, and the epoch (given in a TLE as a day of year to 1e-8
 * day, which is exactly 864 microseconds) is written to the microsecond.
 *
 * Production code never sees TLEs. It receives OMM records, so the
 * validation has to cover the OMM entry point as well as the TLE one.
 */
export function tleToOmm(line1: string, line2: string): OMMJsonObject {
  const twoDigitYear = requireNumber(line1.slice(18, 20), 'epoch year');
  // The TLE convention: 57 to 99 mean 1957 to 1999, 00 to 56 mean 2000 to 2056.
  const year = twoDigitYear < 57 ? 2000 + twoDigitYear : 1900 + twoDigitYear;
  const dayOfYear = requireNumber(line1.slice(20, 23), 'epoch day of year');
  const dayFraction = line1.slice(24, 32);
  if (!/^\d{8}$/.test(dayFraction)) {
    throw new Error(`Could not read epoch day fraction from "${dayFraction}"`);
  }
  // 1e-8 day = 864 microseconds exactly, so this is integer arithmetic.
  const microsecondsIntoDay = Number(dayFraction) * 864;
  const wholeMilliseconds =
    Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + Math.floor(microsecondsIntoDay / 1000);
  const remainingMicroseconds = microsecondsIntoDay % 1000;
  const epoch =
    new Date(wholeMilliseconds).toISOString().slice(0, 23) +
    String(remainingMicroseconds).padStart(3, '0');

  return {
    OBJECT_NAME: `VERIFICATION ${line2.slice(2, 7)}`,
    OBJECT_ID: line1.slice(9, 17).trim(),
    EPOCH: epoch,
    MEAN_MOTION: requireNumber(line2.slice(52, 63), 'mean motion'),
    ECCENTRICITY: requireNumber(`0.${line2.slice(26, 33)}`, 'eccentricity'),
    INCLINATION: requireNumber(line2.slice(8, 16), 'inclination'),
    RA_OF_ASC_NODE: requireNumber(line2.slice(17, 25), 'right ascension of the ascending node'),
    ARG_OF_PERICENTER: requireNumber(line2.slice(34, 42), 'argument of pericentre'),
    MEAN_ANOMALY: requireNumber(line2.slice(43, 51), 'mean anomaly'),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: requireNumber(line2.slice(2, 7), 'catalog number'),
    ELEMENT_SET_NO: 999,
    REV_AT_EPOCH: 0,
    BSTAR: parseImpliedDecimal(line1.slice(53, 61), 'B*'),
    MEAN_MOTION_DOT: requireNumber(line1.slice(33, 43), 'mean motion first derivative'),
    MEAN_MOTION_DDOT: parseImpliedDecimal(line1.slice(44, 52), 'mean motion second derivative'),
  };
}
