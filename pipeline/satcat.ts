import { parseCsv } from './csv';

/**
 * Reading and checking satellite catalog (SATCAT) records delivered as CSV.
 *
 * The SATCAT says what each object is: a payload, a rocket body or a piece
 * of debris; who owns it; when it was launched; whether it is working. The
 * format is CelesTrak's, documented at
 * https://celestrak.org/satcat/satcat-format.php (read 2026-11-15): RFC 4180
 * CSV with a header row naming the fields.
 *
 * As with orbital elements, every row is checked on its own; a row that
 * fails is left out and counted under the reason it failed, never
 * corrected. The values kept are stored exactly as published. Codes are
 * checked for shape, not against a list of known codes: if CelesTrak adds a
 * new owner or object type, it should appear on the site as published, not
 * be thrown away.
 */

/** The descriptive fields this project keeps for one object. */
export interface SatcatRecord {
  /** Catalog number (NORAD_CAT_ID). */
  readonly noradId: number;
  /** OBJECT_TYPE as published: "PAY", "R/B", "DEB" or "UNK". May be empty. */
  readonly objectType: string;
  /** OPS_STATUS_CODE as published, e.g. "+". May be empty. */
  readonly opsStatus: string;
  /** OWNER code as published, e.g. "US". May be empty. */
  readonly owner: string;
  /** LAUNCH_DATE as YYYY-MM-DD. May be empty. */
  readonly launchDate: string;
}

/** Why a row was left out. */
export type SatcatRejectionReason =
  /** The catalog number was empty. */
  | 'missing-field'
  /** The catalog number was not a whole number in the valid range. */
  | 'not-a-number'
  /** A code field contained something that cannot be a code (wrong characters or far too long). */
  | 'bad-code'
  /** The launch date was not a real calendar date written as YYYY-MM-DD. */
  | 'bad-date'
  /** The same catalog number appeared more than once; the first row was kept. */
  | 'duplicate';

export interface ParsedSatcat {
  /** Rows in the file, not counting the header. */
  readonly rowCount: number;
  /** Records that passed every check, at most one per catalog number, in catalog-number order. */
  readonly records: readonly SatcatRecord[];
  /** How many rows were left out, by reason. */
  readonly rejected: Readonly<Partial<Record<SatcatRejectionReason, number>>>;
}

/** The fields this project reads. Their absence from the header makes the whole file unusable. */
const REQUIRED_COLUMNS = [
  'NORAD_CAT_ID',
  'OBJECT_TYPE',
  'OPS_STATUS_CODE',
  'OWNER',
  'LAUNCH_DATE',
] as const;

type Column = (typeof REQUIRED_COLUMNS)[number];

/** An object type: capital letters, possibly with a slash, as in "R/B". */
const OBJECT_TYPE_SHAPE = /^[A-Z][A-Z/]{0,7}$/;
/** An operational status: one to three printable characters, as in "+", "-" or "?". */
const OPS_STATUS_SHAPE = /^[\x21-\x7e]{1,3}$/;
/** An owner: capital letters and digits, as in "US", "PRC" or "O3B". */
const OWNER_SHAPE = /^[A-Z0-9]{1,8}$/;

/**
 * Read a launch date. The documentation gives the form as year-month-day
 * and notes that the CSV format can also carry a time. Only the date is
 * kept: a time, if present, must follow a "T" or a space and is dropped.
 *
 * @returns the date as YYYY-MM-DD, or null if the text is not a real date in that form
 */
function readLaunchDate(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ][0-9:.]+Z?)?$/.exec(text);
  if (match === null) {
    return null;
  }
  const [, year = '', month = '', day = ''] = match;
  const at = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Date.UTC rolls impossible dates over (31 February becomes 3 March);
  // converting back and comparing catches that.
  if (
    at.getUTCFullYear() !== Number(year) ||
    at.getUTCMonth() !== Number(month) - 1 ||
    at.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Parse SATCAT CSV text into checked records.
 *
 * @throws if the document is not CSV with the expected header. That is a
 *         problem with the whole download, not with individual rows.
 */
export function parseSatcatCsv(text: string): ParsedSatcat {
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
      `The document does not have the expected SATCAT columns. Missing: ${missing.join(', ')}. ` +
        `First line was: ${header.join(',').slice(0, 200)}`,
    );
  }

  const rejected: Partial<Record<SatcatRejectionReason, number>> = {};
  const reject = (reason: SatcatRejectionReason): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };

  const byCatalogNumber = new Map<number, SatcatRecord>();
  const dataRows = rows.slice(1);

  for (const row of dataRows) {
    const field = (name: Column): string => (row[columnIndex.get(name) ?? -1] ?? '').trim();

    const numberText = field('NORAD_CAT_ID');
    if (numberText === '') {
      reject('missing-field');
      continue;
    }
    const noradId = /^\d{1,9}$/.test(numberText) ? Number(numberText) : 0;
    if (noradId < 1) {
      reject('not-a-number');
      continue;
    }

    const objectType = field('OBJECT_TYPE');
    const opsStatus = field('OPS_STATUS_CODE');
    const owner = field('OWNER');
    if (
      (objectType !== '' && !OBJECT_TYPE_SHAPE.test(objectType)) ||
      (opsStatus !== '' && !OPS_STATUS_SHAPE.test(opsStatus)) ||
      (owner !== '' && !OWNER_SHAPE.test(owner))
    ) {
      reject('bad-code');
      continue;
    }

    const launchText = field('LAUNCH_DATE');
    const launchDate = launchText === '' ? '' : readLaunchDate(launchText);
    if (launchDate === null) {
      reject('bad-date');
      continue;
    }

    if (byCatalogNumber.has(noradId)) {
      reject('duplicate');
      continue;
    }
    byCatalogNumber.set(noradId, { noradId, objectType, opsStatus, owner, launchDate });
  }

  return {
    rowCount: dataRows.length,
    records: [...byCatalogNumber.values()].sort((a, b) => a.noradId - b.noradId),
    rejected,
  };
}
