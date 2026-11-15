/**
 * The catalog file format shared by the data pipeline (which writes it) and
 * the app (which reads it).
 *
 * REAL DATA. A catalog holds orbital element sets exactly as published by the
 * source. The pipeline removes fields the app does not use; it never rounds,
 * rescales or otherwise alters the numbers it keeps.
 *
 * Layout. The file is JSON, stored "column-wise": instead of one object per
 * satellite, there is one array per field, and position i in every array
 * belongs to the same satellite. This avoids repeating every field name
 * tens of thousands of times and compresses well.
 *
 * Numbers are exact. JSON.stringify writes each number with the fewest
 * digits that read back as the same 64-bit value, so decode(encode(x)) gives
 * back identical numbers. The tests assert this.
 */

/** Identifies the file type, so that a wrong file is rejected clearly. */
export const CATALOG_FORMAT = 'orbit-now-catalog';

/** Incremented whenever the layout changes in a way old readers cannot handle. */
export const CATALOG_VERSION = 1;

const MICROSECONDS_PER_DAY = 86_400_000_000;
const MILLISECONDS_PER_DAY = 86_400_000;

/** One object's element set, reduced to the fields this project uses. */
export interface CatalogRecord {
  /** Catalog number (NORAD_CAT_ID). May exceed 99 999. */
  readonly noradId: number;
  /** Object name as published (OBJECT_NAME). */
  readonly name: string;
  /** International designator as published (OBJECT_ID), e.g. "1998-067A". */
  readonly objectId: string;
  /** Whole days from 1970-01-01 to the UTC day of the element set's epoch. */
  readonly epochDay: number;
  /** Microseconds from the start of that UTC day to the epoch. */
  readonly epochMicros: number;
  /** Mean motion, revolutions per day (MEAN_MOTION). */
  readonly meanMotion: number;
  /** Eccentricity, dimensionless (ECCENTRICITY). */
  readonly eccentricity: number;
  /** Inclination, degrees (INCLINATION). */
  readonly inclination: number;
  /** Right ascension of the ascending node, degrees (RA_OF_ASC_NODE). */
  readonly raan: number;
  /** Argument of pericentre, degrees (ARG_OF_PERICENTER). */
  readonly argPericenter: number;
  /** Mean anomaly, degrees (MEAN_ANOMALY). */
  readonly meanAnomaly: number;
  /** SGP4 drag term B*, in units of 1/Earth radii (BSTAR). */
  readonly bstar: number;
  /**
   * Which source data sets list this object. Bit k is set if the object is in
   * the source at index k of the catalog's `sources` array.
   */
  readonly sourceMask: number;
}

/** Where part of a catalog came from, and when. */
export interface CatalogSource {
  /** Short stable identifier, e.g. "active". */
  readonly id: string;
  /** Human-readable description for the interface. */
  readonly label: string;
  /** Organisation that published the data. */
  readonly provider: string;
  /** When this source was last downloaded successfully (ISO 8601, UTC), or null if never. */
  readonly fetchedAt: string | null;
  /** Number of objects in the catalog that this source lists. */
  readonly objectCount: number;
}

export interface Catalog {
  /** When this file was written (ISO 8601, UTC). */
  readonly generatedAt: string;
  /** The data sets merged into this catalog. Order defines the bits of `sourceMask`. */
  readonly sources: readonly CatalogSource[];
  /** One record per object, in ascending order of catalog number. */
  readonly records: readonly CatalogRecord[];
}

/** The shape of the JSON document on disk. */
interface CatalogFile {
  format: string;
  version: number;
  generatedAt: string;
  sources: CatalogSource[];
  count: number;
  columns: {
    noradId: number[];
    name: string[];
    objectId: string[];
    epochDay: number[];
    epochMicros: number[];
    meanMotion: number[];
    eccentricity: number[];
    inclination: number[];
    raan: number[];
    argPericenter: number[];
    meanAnomaly: number[];
    bstar: number[];
    sourceMask: number[];
  };
}

const NUMBER_COLUMNS = [
  'noradId',
  'epochDay',
  'epochMicros',
  'meanMotion',
  'eccentricity',
  'inclination',
  'raan',
  'argPericenter',
  'meanAnomaly',
  'bstar',
  'sourceMask',
] as const;

const STRING_COLUMNS = ['name', 'objectId'] as const;

/** Serialise a catalog to JSON text. Records are written in ascending catalog-number order. */
export function encodeCatalog(catalog: Catalog): string {
  const records = [...catalog.records].sort((a, b) => a.noradId - b.noradId);
  const file: CatalogFile = {
    format: CATALOG_FORMAT,
    version: CATALOG_VERSION,
    generatedAt: catalog.generatedAt,
    sources: catalog.sources.map((source) => ({ ...source })),
    count: records.length,
    columns: {
      noradId: records.map((record) => record.noradId),
      name: records.map((record) => record.name),
      objectId: records.map((record) => record.objectId),
      epochDay: records.map((record) => record.epochDay),
      epochMicros: records.map((record) => record.epochMicros),
      meanMotion: records.map((record) => record.meanMotion),
      eccentricity: records.map((record) => record.eccentricity),
      inclination: records.map((record) => record.inclination),
      raan: records.map((record) => record.raan),
      argPericenter: records.map((record) => record.argPericenter),
      meanAnomaly: records.map((record) => record.meanAnomaly),
      bstar: records.map((record) => record.bstar),
      sourceMask: records.map((record) => record.sourceMask),
    },
  };
  return JSON.stringify(file);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumberColumn(columns: Record<string, unknown>, key: string, count: number): number[] {
  const column = columns[key];
  if (!Array.isArray(column) || column.length !== count) {
    throw new Error(`Catalog column "${key}" is missing or does not have ${String(count)} entries`);
  }
  const values: number[] = [];
  for (const value of column) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Catalog column "${key}" contains a value that is not a finite number`);
    }
    values.push(value);
  }
  return values;
}

function readStringColumn(columns: Record<string, unknown>, key: string, count: number): string[] {
  const column = columns[key];
  if (!Array.isArray(column) || column.length !== count) {
    throw new Error(`Catalog column "${key}" is missing or does not have ${String(count)} entries`);
  }
  const values: string[] = [];
  for (const value of column) {
    if (typeof value !== 'string') {
      throw new Error(`Catalog column "${key}" contains a value that is not text`);
    }
    values.push(value);
  }
  return values;
}

function readSource(value: unknown): CatalogSource {
  if (!isObject(value)) {
    throw new Error('Catalog source entry is not an object');
  }
  const { id, label, provider, fetchedAt, objectCount } = value;
  if (
    typeof id !== 'string' ||
    typeof label !== 'string' ||
    typeof provider !== 'string' ||
    !(typeof fetchedAt === 'string' || fetchedAt === null) ||
    typeof objectCount !== 'number'
  ) {
    throw new Error('Catalog source entry has missing or mistyped fields');
  }
  return { id, label, provider, fetchedAt, objectCount };
}

/**
 * Parse and check catalog JSON text. Throws a descriptive error if the text
 * is not a catalog this version of the code understands. Nothing from an
 * unchecked file is ever returned.
 */
export function decodeCatalog(text: string): Catalog {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || parsed.format !== CATALOG_FORMAT) {
    throw new Error('Not an Orbit Now catalog file');
  }
  if (parsed.version !== CATALOG_VERSION) {
    throw new Error(
      `Catalog file is version ${String(parsed.version)}, but this code reads version ${String(CATALOG_VERSION)}`,
    );
  }
  const { generatedAt, sources, count, columns } = parsed;
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    throw new Error('Catalog "generatedAt" is not a valid time');
  }
  if (!Array.isArray(sources)) {
    throw new Error('Catalog "sources" is not a list');
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new Error('Catalog "count" is not a non-negative whole number');
  }
  if (!isObject(columns)) {
    throw new Error('Catalog "columns" is missing');
  }

  const numbers = Object.fromEntries(
    NUMBER_COLUMNS.map((key) => [key, readNumberColumn(columns, key, count)]),
  ) as Record<(typeof NUMBER_COLUMNS)[number], number[]>;
  const strings = Object.fromEntries(
    STRING_COLUMNS.map((key) => [key, readStringColumn(columns, key, count)]),
  ) as Record<(typeof STRING_COLUMNS)[number], string[]>;

  const records: CatalogRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    // Every column was checked above to have exactly `count` entries, so each
    // lookup below is in range; the `?? ` fallbacks only satisfy the compiler.
    records.push({
      noradId: numbers.noradId[i] ?? 0,
      name: strings.name[i] ?? '',
      objectId: strings.objectId[i] ?? '',
      epochDay: numbers.epochDay[i] ?? 0,
      epochMicros: numbers.epochMicros[i] ?? 0,
      meanMotion: numbers.meanMotion[i] ?? 0,
      eccentricity: numbers.eccentricity[i] ?? 0,
      inclination: numbers.inclination[i] ?? 0,
      raan: numbers.raan[i] ?? 0,
      argPericenter: numbers.argPericenter[i] ?? 0,
      meanAnomaly: numbers.meanAnomaly[i] ?? 0,
      bstar: numbers.bstar[i] ?? 0,
      sourceMask: numbers.sourceMask[i] ?? 0,
    });
  }
  return { generatedAt, sources: sources.map(readSource), records };
}

/**
 * Split an OMM epoch string into a whole day number and microseconds into
 * that day. Returns null if the text is not a UTC date-time with at most six
 * decimal places of seconds (finer detail could not be stored exactly, so it
 * is refused instead of being silently rounded).
 *
 * Accepted: "2026-11-14T20:01:42", "2026-11-14T20:01:42.123456", either with
 * or without a trailing "Z".
 */
export function parseEpoch(text: string): { epochDay: number; epochMicros: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z?$/.exec(text);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute, second, fraction] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  if (h > 23 || mi > 59 || s > 59) {
    return null;
  }
  const dayStartMs = Date.UTC(y, mo - 1, d);
  // Date.UTC silently rolls impossible dates over (31 February becomes
  // 3 March). Converting back and comparing catches that.
  const check = new Date(dayStartMs);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  const fractionMicros = fraction === undefined ? 0 : Number(fraction.padEnd(6, '0'));
  return {
    epochDay: dayStartMs / MILLISECONDS_PER_DAY,
    epochMicros: (h * 3600 + mi * 60 + s) * 1_000_000 + fractionMicros,
  };
}

/** The epoch as an ISO 8601 UTC string with microseconds, e.g. "2026-11-14T20:01:42.123456". */
export function formatEpoch(epochDay: number, epochMicros: number): string {
  if (
    !Number.isInteger(epochDay) ||
    !Number.isInteger(epochMicros) ||
    epochMicros < 0 ||
    epochMicros >= MICROSECONDS_PER_DAY
  ) {
    throw new RangeError(
      'epochDay must be a whole number and epochMicros a whole number within one day',
    );
  }
  const date = new Date(epochDay * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
  const totalSeconds = Math.floor(epochMicros / 1_000_000);
  const micros = epochMicros % 1_000_000;
  const two = (value: number): string => String(value).padStart(2, '0');
  const hours = two(Math.floor(totalSeconds / 3600));
  const minutes = two(Math.floor((totalSeconds % 3600) / 60));
  const seconds = two(totalSeconds % 60);
  return `${date}T${hours}:${minutes}:${seconds}.${String(micros).padStart(6, '0')}`;
}

/** The epoch in milliseconds since 1970-01-01 UTC (the unit JavaScript's Date uses). */
export function epochToUnixMs(epochDay: number, epochMicros: number): number {
  return epochDay * MILLISECONDS_PER_DAY + epochMicros / 1000;
}

/**
 * The OMM fields SGP4 needs, in the form satellite.js's `json2satrec` accepts.
 *
 * Declared with `type`, not `interface`, on purpose: satellite.js's parameter
 * type allows arbitrary extra keys, and TypeScript only treats a `type` alias
 * as compatible with that.
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type OmmForSgp4 = {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: 0;
  CLASSIFICATION_TYPE: 'U';
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
};

/**
 * Rebuild an OMM record from a catalog record so that it can be handed to
 * the SGP4 propagator.
 *
 * Fields the catalog does not keep are filled with fixed values. That is
 * safe because SGP4 does not read them: the two mean-motion derivatives
 * belong to an older model (SGP), and the element-set and revolution numbers
 * are bookkeeping. `tests/validation/sgp4-vallado.test.ts` checks that
 * propagating from a record rebuilt this way still reproduces the published
 * reference states.
 */
export function recordToOmm(record: CatalogRecord): OmmForSgp4 {
  return {
    OBJECT_NAME: record.name,
    OBJECT_ID: record.objectId,
    EPOCH: formatEpoch(record.epochDay, record.epochMicros),
    MEAN_MOTION: record.meanMotion,
    ECCENTRICITY: record.eccentricity,
    INCLINATION: record.inclination,
    RA_OF_ASC_NODE: record.raan,
    ARG_OF_PERICENTER: record.argPericenter,
    MEAN_ANOMALY: record.meanAnomaly,
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: record.noradId,
    ELEMENT_SET_NO: 0,
    REV_AT_EPOCH: 0,
    BSTAR: record.bstar,
    MEAN_MOTION_DOT: 0,
    MEAN_MOTION_DDOT: 0,
  };
}
