import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { json2satrec, sgp4 } from 'satellite.js';
import { epochToUnixMs, recordToOmm, type CatalogRecord } from '../../src/catalog/format';
import type { Propagator } from '../../src/passes/predict';

/**
 * Loading the reference used to check pass predictions: tables of ISS
 * passes copied from Heavens-Above, and the ISS element set that was in
 * this project's published catalog on the same day.
 */

const FIXTURES = fileURLToPath(new URL('../fixtures/passes/', import.meta.url));

/** One moment of a pass as Heavens-Above prints it. */
export interface ReferenceEvent {
  readonly timeMs: number;
  /** Altitude in whole degrees, as printed. */
  readonly altitudeDeg: number;
  /** One of the sixteen compass points, as printed. */
  readonly compass: string;
}

export interface ReferencePass {
  readonly start: ReferenceEvent;
  readonly highest: ReferenceEvent;
  readonly end: ReferenceEvent;
  /** "visible", "daylight" or "night (unlit)". */
  readonly type: string;
  /** The row as it was copied from the page. */
  readonly row: string;
}

export interface ReferenceLocation {
  readonly name: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly allPasses: readonly ReferencePass[];
  readonly visiblePasses: readonly ReferencePass[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Read one row of a Heavens-Above table. The year is not printed; the tables are for 2026. */
function parseRow(row: string, year: number): ReferencePass {
  const cells = row.split('|');
  if (cells.length !== 12) {
    throw new Error(`Unexpected row: ${row}`);
  }
  const [date = '', , ...rest] = cells;
  const [dayText = '', monthText = ''] = date.split(' ');
  const midnight = Date.UTC(year, MONTHS.indexOf(monthText), Number(dayText));
  let previous = -1;
  const event = (offset: number): ReferenceEvent => {
    const [hours = 0, minutes = 0, seconds = 0] = (rest[offset] ?? '').split(':').map(Number);
    let timeMs = midnight + ((hours * 60 + minutes) * 60 + seconds) * 1000;
    // A time earlier than the one before it in the row is on the next day.
    while (timeMs < previous) {
      timeMs += 86_400_000;
    }
    previous = timeMs;
    return {
      timeMs,
      altitudeDeg: Number((rest[offset + 1] ?? '').replace('°', '')),
      compass: rest[offset + 2] ?? '',
    };
  };
  const start = event(0);
  const highest = event(3);
  const end = event(6);
  return { start, highest, end, type: rest[9] ?? '', row };
}

interface ReferenceFile {
  readonly retrievedAt: string;
  readonly locations: readonly {
    readonly name: string;
    readonly latitudeDeg: number;
    readonly longitudeDeg: number;
    readonly allPasses: readonly string[];
    readonly visiblePasses: readonly string[];
  }[];
}

export function loadHeavensAbove(): { retrievedAt: string; locations: ReferenceLocation[] } {
  const file = JSON.parse(
    readFileSync(`${FIXTURES}heavens-above-iss-2026-11-15.json`, 'utf8'),
  ) as ReferenceFile;
  return {
    retrievedAt: file.retrievedAt,
    locations: file.locations.map((location) => ({
      name: location.name,
      latitudeDeg: location.latitudeDeg,
      longitudeDeg: location.longitudeDeg,
      allPasses: location.allPasses.map((row) => parseRow(row, 2026)),
      visiblePasses: location.visiblePasses.map((row) => parseRow(row, 2026)),
    })),
  };
}

/** The ISS element set from the published catalog of 2026-11-15, and SGP4 set up for it. */
export function loadIss(): { record: CatalogRecord; epochMs: number; propagate: Propagator } {
  const file = JSON.parse(readFileSync(`${FIXTURES}iss-elements-2026-11-15.json`, 'utf8')) as {
    record: CatalogRecord;
  };
  const { record } = file;
  const satrec = json2satrec(recordToOmm(record));
  const epochMs = epochToUnixMs(record.epochDay, record.epochMicros);
  return {
    record,
    epochMs,
    propagate: (unixMs) => sgp4(satrec, (unixMs - epochMs) / 60_000)?.position ?? null,
  };
}
