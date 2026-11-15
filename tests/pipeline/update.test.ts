import { describe, expect, it } from 'vitest';
import type { FetchFunction } from '../../pipeline/fetch';
import { USER_AGENT } from '../../pipeline/fetch';
import type { SourceDefinition } from '../../pipeline/sources';
import {
  decodeStatus,
  MINIMUM_REQUEST_INTERVAL_MS,
  runUpdate,
  STALE_AFTER_MS,
  type RunOptions,
  type RunResult,
} from '../../pipeline/update';
import { FIXTURE_ACCEPTED, OMM_CSV_HEADER, verificationSetAsOmmCsv } from './fixtureCsv';
import { satcatDocument, satcatRow } from './satcatFixture';

const fullCsv = verificationSetAsOmmCsv();
const csvLines = fullCsv.trim().split('\r\n');
/** A valid document containing only the first `rows` element sets of the fixture. */
function firstRows(rows: number): string {
  return `${csvLines.slice(0, rows + 1).join('\n')}\n`;
}

const SMALL: SourceDefinition = {
  id: 'small',
  label: 'Small',
  provider: 'TEST',
  url: 'https://example.invalid/small',
  minimumObjects: 1,
};
const BIG: SourceDefinition = {
  id: 'big',
  label: 'Big',
  provider: 'TEST',
  url: 'https://example.invalid/big',
  minimumObjects: 20,
};
const DEFINITIONS = [SMALL, BIG];

type Reply = { status: number; body: string } | Error;

/** A stand-in for `fetch` that answers from a table and records what was asked. */
function fakeFetch(replies: Record<string, Reply>): {
  fetchImpl: FetchFunction;
  calls: string[];
  headers: Record<string, string>[];
} {
  const calls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: FetchFunction = (url, init) => {
    calls.push(url);
    headers.push(init.headers);
    const reply = replies[url];
    if (reply === undefined) {
      return Promise.reject(new Error(`Unexpected request for ${url}`));
    }
    if (reply instanceof Error) {
      return Promise.reject(reply);
    }
    return Promise.resolve({ status: reply.status, text: () => Promise.resolve(reply.body) });
  };
  return { fetchImpl, calls, headers };
}

const START = Date.UTC(2026, 10, 14, 3, 17);

async function run(
  replies: Record<string, Reply>,
  overrides: Partial<RunOptions> = {},
  atMs = START,
): Promise<{
  result: RunResult;
  calls: string[];
  pauses: number;
  headers: Record<string, string>[];
}> {
  const { fetchImpl, calls, headers } = fakeFetch(replies);
  let pauses = 0;
  const result = await runUpdate({
    previousCatalog: null,
    previousStatus: null,
    definitions: DEFINITIONS,
    fetchImpl,
    now: () => new Date(atMs),
    pauseBetweenRequests: () => {
      pauses += 1;
      return Promise.resolve();
    },
    ...overrides,
  });
  return { result, calls, pauses, headers };
}

const OK = {
  [SMALL.url]: { status: 200, body: firstRows(3) },
  [BIG.url]: { status: 200, body: fullCsv },
};
const NOT_UPDATED_BODY =
  'GP data has not updated since your last successful download of GROUP=big at 2026-11-14 02:10:22 UTC. Data is updated once every 2 hours.';

describe('runUpdate: normal operation', () => {
  it('downloads every source once, in order, and builds the catalog', async () => {
    const { result, calls, pauses, headers } = await run(OK);
    expect(calls).toEqual([SMALL.url, BIG.url]);
    expect(pauses).toBe(1); // one polite pause, between the two requests
    expect(headers[0]?.['User-Agent']).toBe(USER_AGENT);

    expect(result.report.map((entry) => entry.action)).toEqual(['updated', 'updated']);
    expect(result.requestsMade).toBe(2);
    expect(result.alerts).toEqual([]);
    expect(result.catalog?.records).toHaveLength(FIXTURE_ACCEPTED);
    expect(result.catalog?.sources.map((source) => source.objectCount)).toEqual([
      3,
      FIXTURE_ACCEPTED,
    ]);
    expect(result.status.catalogObjectCount).toBe(FIXTURE_ACCEPTED);
    expect(result.status.sources[1]).toMatchObject({
      id: 'big',
      lastOutcome: 'ok',
      lastRequestAt: new Date(START).toISOString(),
      lastSuccessAt: new Date(START).toISOString(),
      rowCount: 33,
      acceptedCount: FIXTURE_ACCEPTED,
      rejected: { 'sgp4-error': 1, duplicate: 1 },
    });
  });

  it('hands each raw download to the caller before parsing it', async () => {
    const seen: string[] = [];
    await run(OK, { onDownloaded: (id, body) => seen.push(`${id}:${String(body.length)}`) });
    expect(seen).toEqual([`small:${String(firstRows(3).length)}`, `big:${String(fullCsv.length)}`]);
  });

  it('writes a status that reads back unchanged', async () => {
    const { result } = await run(OK);
    expect(decodeStatus(JSON.stringify(result.status))).toEqual(result.status);
  });
});

describe('runUpdate: respecting the download limit', () => {
  it('makes no request for a source asked less than 2 hours 5 minutes ago', async () => {
    const first = await run(OK);
    const soon = START + MINIMUM_REQUEST_INTERVAL_MS - 60_000;
    const second = await run(
      {}, // any request at all would be "unexpected" and fail the test
      { previousCatalog: first.result.catalog, previousStatus: first.result.status },
      soon,
    );
    expect(second.calls).toEqual([]);
    expect(second.result.report.map((entry) => entry.action)).toEqual([
      'skipped-too-soon',
      'skipped-too-soon',
    ]);
    expect(second.result.catalog).toBeNull();
    expect(second.result.requestsMade).toBe(0);
    expect(second.result.status.sources).toEqual(first.result.status.sources);
  });

  it('asks again once the interval has passed', async () => {
    const first = await run(OK);
    const later = START + MINIMUM_REQUEST_INTERVAL_MS;
    const second = await run(
      OK,
      { previousCatalog: first.result.catalog, previousStatus: first.result.status },
      later,
    );
    expect(second.calls).toEqual([SMALL.url, BIG.url]);
  });

  it('also waits after a refusal, not only after a success', async () => {
    const first = await run({ [SMALL.url]: { status: 403, body: NOT_UPDATED_BODY } });
    const second = await run({}, { previousStatus: first.result.status }, START + 30 * 60_000);
    // "small" was asked 30 minutes ago and is skipped; "big" was never asked,
    // so it would be requested. The empty reply table makes that request fail,
    // which shows it was attempted exactly once.
    expect(second.calls).toEqual([BIG.url]);
    expect(second.result.report[0]?.action).toBe('skipped-too-soon');
  });
});

describe('runUpdate: when the server does not answer with HTTP 200', () => {
  it("treats CelesTrak's 'has not updated' reply as routine, keeps old data and stops asking", async () => {
    const first = await run(OK);
    const later = START + 8 * 3_600_000;
    const second = await run(
      { [SMALL.url]: { status: 403, body: NOT_UPDATED_BODY } },
      { previousCatalog: first.result.catalog, previousStatus: first.result.status },
      later,
    );
    expect(second.calls).toEqual([SMALL.url]); // "big" was not requested
    expect(second.result.report.map((entry) => entry.action)).toEqual([
      'not-updated',
      'skipped-after-stop',
    ]);
    expect(second.result.catalog).toBeNull(); // published catalog stands
    expect(second.result.alerts).toEqual([]); // routine: nobody is paged
    expect(second.result.status.sources[0]).toMatchObject({
      lastOutcome: 'not-updated',
      lastRequestAt: new Date(later).toISOString(),
      lastSuccessAt: new Date(START).toISOString(), // unchanged
      acceptedCount: 3, // unchanged
    });
    expect(second.result.status.sources[0]?.lastDetail).toContain('HTTP 403');
  });

  it('publishes what succeeded before a refusal', async () => {
    const { result, calls } = await run({
      [SMALL.url]: { status: 200, body: firstRows(3) },
      [BIG.url]: { status: 403, body: NOT_UPDATED_BODY },
    });
    expect(calls).toEqual([SMALL.url, BIG.url]);
    expect(result.report.map((entry) => entry.action)).toEqual(['updated', 'not-updated']);
    expect(result.catalog?.records).toHaveLength(3);
    // "big" has never been downloaded, which does need attention.
    expect(result.alerts).toEqual(['big: has never been downloaded successfully.']);
  });

  it.each([
    ['a plain 403', { status: 403, body: 'Forbidden' }, 'refused', 'HTTP 403: Forbidden'],
    ['a 404', { status: 404, body: 'No GP data found' }, 'refused', 'HTTP 404: No GP data found'],
    ['a redirect', { status: 301, body: '' }, 'refused', 'HTTP 301: '],
    ['a server error', { status: 503, body: 'Busy' }, 'refused', 'HTTP 503: Busy'],
    ['a network failure', new Error('connect ETIMEDOUT'), 'network-error', 'connect ETIMEDOUT'],
  ] as const)('raises an alert and stops after %s', async (_name, reply, action, detail) => {
    const { result, calls } = await run({ [SMALL.url]: reply });
    expect(calls).toEqual([SMALL.url]);
    expect(result.report.map((entry) => entry.action)).toEqual([action, 'skipped-after-stop']);
    expect(result.catalog).toBeNull();
    expect(result.alerts).toContain(`small: request failed (${detail})`);
    expect(result.status.sources[0]?.lastOutcome).toBe(action);
  });

  it('never retries a request', async () => {
    const { calls } = await run({ [SMALL.url]: { status: 503, body: 'Busy' } });
    expect(calls).toHaveLength(1);
  });
});

describe('runUpdate: when a download cannot be trusted', () => {
  it('rejects a 200 response that is not OMM CSV, keeps old data and stops', async () => {
    const first = await run(OK);
    const later = START + 8 * 3_600_000;
    const second = await run(
      { [SMALL.url]: { status: 200, body: '<html>Maintenance</html>' } },
      { previousCatalog: first.result.catalog, previousStatus: first.result.status },
      later,
    );
    expect(second.calls).toEqual([SMALL.url]);
    expect(second.result.report.map((entry) => entry.action)).toEqual([
      'invalid',
      'skipped-after-stop',
    ]);
    expect(second.result.catalog).toBeNull();
    expect(second.result.alerts[0]).toMatch(
      /^small: download rejected \(The document does not have the expected OMM columns/,
    );
    expect(second.result.status.sources[0]).toMatchObject({
      lastOutcome: 'invalid',
      acceptedCount: 3,
    });
  });

  it('rejects a download with fewer objects than the source requires', async () => {
    const { result } = await run({
      [SMALL.url]: { status: 200, body: firstRows(3) },
      [BIG.url]: { status: 200, body: firstRows(10) }, // "big" requires 20
    });
    expect(result.report[1]).toEqual({
      id: 'big',
      action: 'invalid',
      detail: 'Only 10 valid element sets; at least 20 expected.',
    });
    expect(result.catalog?.sources.map((source) => source.objectCount)).toEqual([3, 0]);
  });

  it('rejects a download that shrank to under three quarters of its previous size', async () => {
    const previousStatus = (await run(OK)).result.status;
    // Pretend "big" held 100 objects last time; 31 now is far under 75.
    const inflated = {
      ...previousStatus,
      sources: previousStatus.sources.map((source) =>
        source.id === 'big' ? { ...source, acceptedCount: 100 } : source,
      ),
    };
    const { result } = await run(OK, { previousStatus: inflated }, START + 8 * 3_600_000);
    expect(result.report[1]?.action).toBe('invalid');
    expect(result.report[1]?.detail).toBe('Valid element sets fell from 100 to 31.');
  });

  it('rejects a download in which many rows fail the format checks', async () => {
    // Blank the mean-motion field in 6 of 20 rows.
    const column = OMM_CSV_HEADER.indexOf('MEAN_MOTION');
    const damaged = csvLines
      .slice(0, 21)
      .map((line, index) => {
        if (index === 0 || index > 6) {
          return line;
        }
        const fields = line.split(',');
        fields[column] = '';
        return fields.join(',');
      })
      .join('\n');
    const { result } = await run({ [SMALL.url]: { status: 200, body: damaged } });
    expect(result.report[0]).toEqual({
      id: 'small',
      action: 'invalid',
      detail: '6 of 20 rows failed the format checks.',
    });
  });

  it('tolerates a few malformed rows', async () => {
    const column = OMM_CSV_HEADER.indexOf('MEAN_MOTION');
    const fields = (csvLines[1] ?? '').split(',');
    fields[column] = '';
    const body = [csvLines[0], fields.join(','), ...csvLines.slice(2, 6)].join('\n');
    const { result } = await run({
      [SMALL.url]: { status: 200, body },
      [BIG.url]: { status: 200, body: fullCsv },
    });
    expect(result.report[0]?.action).toBe('updated');
    expect(result.status.sources[0]?.rejected).toEqual({ 'missing-field': 1 });
  });
});

describe('runUpdate: staleness', () => {
  it('raises an alert when a source has not been refreshed for more than 48 hours', async () => {
    const first = await run(OK);
    const muchLater = START + STALE_AFTER_MS + 3_600_000;
    const second = await run(
      { [SMALL.url]: { status: 403, body: NOT_UPDATED_BODY } },
      { previousCatalog: first.result.catalog, previousStatus: first.result.status },
      muchLater,
    );
    expect(second.result.alerts).toEqual([
      'small: last successful download was 49 hours ago.',
      'big: last successful download was 49 hours ago.',
    ]);
  });
});

describe('runUpdate: descriptive data (SATCAT)', () => {
  const HOUR = 3_600_000;
  const META: SourceDefinition = {
    kind: 'satcat',
    id: 'meta',
    label: 'Catalog records',
    provider: 'TEST',
    url: 'https://example.invalid/meta',
    minimumObjects: 2,
    minimumIntervalMs: 22 * HOUR,
    staleAfterMs: 96 * HOUR,
  };
  const WITH_META = [SMALL, BIG, META];
  // Invented rows: three objects that are in the fixture catalog and one that is not.
  const META_BODY = satcatDocument(
    satcatRow(5, 'PAY', '+', 'US', '1958-03-17'),
    satcatRow(4632, 'R/B', '', 'US', '1970-11-06'),
    satcatRow(6251, 'DEB', '', 'US', '1962-06-19'),
    satcatRow(99999, 'PAY', '-', 'PRC', '2020-01-07'),
  );
  const OK_WITH_META = { ...OK, [META.url]: { status: 200, body: META_BODY } };
  const ownerOf = (result: RunResult, noradId: number): string | undefined => {
    const index = result.catalog?.records.findIndex((record) => record.noradId === noradId) ?? -1;
    return result.catalog?.metadata?.owner[index];
  };
  const typeOf = (result: RunResult, noradId: number): string | undefined => {
    const index = result.catalog?.records.findIndex((record) => record.noradId === noradId) ?? -1;
    return result.catalog?.metadata?.objectType[index];
  };

  it('is requested after the orbital elements and attached to the objects it describes', async () => {
    const { result, calls } = await run(OK_WITH_META, { definitions: WITH_META });
    expect(calls).toEqual([SMALL.url, BIG.url, META.url]);
    expect(result.alerts).toEqual([]);
    // The catalog's objects are exactly those of the orbital elements.
    expect(result.catalog?.records).toHaveLength(FIXTURE_ACCEPTED);
    expect(result.catalog?.sources.map((source) => source.id)).toEqual(['small', 'big']);
    expect(typeOf(result, 5)).toBe('PAY');
    expect(typeOf(result, 4632)).toBe('R/B');
    expect(typeOf(result, 6251)).toBe('DEB');
    // An object the descriptive data does not cover has blank fields.
    expect(typeOf(result, 8195)).toBe('');
    expect(result.catalog?.metadata?.sources).toEqual([
      {
        id: 'meta',
        label: 'Catalog records',
        provider: 'TEST',
        fetchedAt: new Date(START).toISOString(),
        objectCount: 4,
      },
    ]);
    expect(result.status.sources[2]).toMatchObject({
      id: 'meta',
      lastOutcome: 'ok',
      lastDetail: '4 catalog records accepted from 4 rows.',
      acceptedCount: 4,
    });
  });

  it('is requested at most once in 22 hours, while orbital elements are requested every time', async () => {
    const first = await run(OK_WITH_META, { definitions: WITH_META });
    const carry = (previous: RunResult): Partial<RunOptions> => ({
      definitions: WITH_META,
      previousCatalog: previous.catalog,
      previousStatus: previous.status,
    });

    const eightHoursOn = await run(OK, carry(first.result), START + 8 * HOUR);
    expect(eightHoursOn.calls).toEqual([SMALL.url, BIG.url]);
    expect(eightHoursOn.result.report[2]).toMatchObject({ id: 'meta', action: 'skipped-too-soon' });
    // The fields downloaded earlier are carried into the new catalog.
    expect(ownerOf(eightHoursOn.result, 5)).toBe('US');
    expect(eightHoursOn.result.alerts).toEqual([]);

    const sixteenHoursOn = await run(OK, carry(eightHoursOn.result), START + 16 * HOUR);
    expect(sixteenHoursOn.calls).toEqual([SMALL.url, BIG.url]);

    const aDayOn = await run(OK_WITH_META, carry(sixteenHoursOn.result), START + 24 * HOUR);
    expect(aDayOn.calls).toEqual([SMALL.url, BIG.url, META.url]);
  });

  it('does not hold back the orbital elements when it is refused', async () => {
    const first = await run(OK_WITH_META, { definitions: WITH_META });
    const second = await run(
      { ...OK, [META.url]: { status: 403, body: 'Forbidden' } },
      {
        definitions: WITH_META,
        previousCatalog: first.result.catalog,
        previousStatus: first.result.status,
      },
      START + 24 * HOUR,
    );
    // New orbital elements are published, with the descriptive fields kept from before.
    expect(second.result.catalog?.generatedAt).toBe(new Date(START + 24 * HOUR).toISOString());
    expect(second.result.catalog?.records).toHaveLength(FIXTURE_ACCEPTED);
    expect(ownerOf(second.result, 5)).toBe('US');
    expect(second.result.catalog?.metadata?.sources[0]?.fetchedAt).toBe(
      new Date(START).toISOString(),
    );
    expect(second.result.alerts).toEqual(['meta: request failed (HTTP 403: Forbidden)']);
    expect(second.result.status.sources[2]).toMatchObject({
      lastOutcome: 'refused',
      lastSuccessAt: new Date(START).toISOString(),
    });
  });

  it('is not requested at all once an earlier request in the run has been refused', async () => {
    const { result, calls } = await run(
      { [SMALL.url]: { status: 403, body: NOT_UPDATED_BODY } },
      { definitions: WITH_META },
    );
    expect(calls).toEqual([SMALL.url]);
    expect(result.report[2]).toMatchObject({ id: 'meta', action: 'skipped-after-stop' });
    // It has not been asked for yet, which is not a fault in itself.
    expect(result.alerts.some((alert) => alert.startsWith('meta:'))).toBe(false);
  });

  it('rejects a reply that is not SATCAT CSV, and says so', async () => {
    const { result } = await run(
      { ...OK, [META.url]: { status: 200, body: '[{"OBJECT_NAME":"X","NORAD_CAT_ID":5}]' } },
      { definitions: WITH_META },
    );
    expect(result.catalog?.records).toHaveLength(FIXTURE_ACCEPTED);
    expect(result.catalog?.metadata).toBeUndefined();
    expect(result.status.sources[2]?.lastOutcome).toBe('invalid');
    expect(result.alerts).toEqual([
      expect.stringMatching(/^meta: download rejected \(/),
      'meta: has never been downloaded successfully.',
    ]);
  });

  it('rejects a download with fewer records than the source requires', async () => {
    const { result } = await run(
      {
        ...OK,
        [META.url]: { status: 200, body: satcatDocument(satcatRow(5, 'PAY', '+', 'US', '')) },
      },
      { definitions: WITH_META },
    );
    expect(result.status.sources[2]?.lastDetail).toBe(
      'Only 1 valid catalog records; at least 2 expected.',
    );
    expect(result.catalog?.metadata).toBeUndefined();
  });

  it('refreshes the fields on their own when the orbital elements are not due', async () => {
    const first = await run(OK, { definitions: [SMALL, BIG] });
    // An hour later the descriptive source is added. The elements were asked
    // for an hour ago and must not be asked for again.
    const second = await run(
      { [META.url]: { status: 200, body: META_BODY } },
      {
        definitions: WITH_META,
        previousCatalog: first.result.catalog,
        previousStatus: first.result.status,
      },
      START + HOUR,
    );
    expect(second.calls).toEqual([META.url]);
    expect(second.result.catalog?.records).toEqual(first.result.catalog?.records);
    expect(second.result.catalog?.sources).toEqual(first.result.catalog?.sources);
    expect(ownerOf(second.result, 5)).toBe('US');
  });

  it('is allowed to go four days without a refresh before anyone is alerted', async () => {
    const first = await run(OK_WITH_META, { definitions: WITH_META });
    const carry = {
      definitions: WITH_META,
      previousCatalog: first.result.catalog,
      previousStatus: first.result.status,
    };
    const refusal = { ...OK, [META.url]: { status: 403, body: NOT_UPDATED_BODY } };
    const threeDaysOn = await run(refusal, carry, START + 72 * HOUR);
    expect(threeDaysOn.result.alerts).toEqual([]);
    const fiveDaysOn = await run(refusal, carry, START + 120 * HOUR);
    expect(fiveDaysOn.result.alerts).toEqual(['meta: last successful download was 120 hours ago.']);
  });
});

describe('decodeStatus', () => {
  it('refuses anything that is not a status file of this version', () => {
    expect(() => decodeStatus('{}')).toThrow(/Not an Orbit Now pipeline status file/);
    expect(() => decodeStatus('{"format":"orbit-now-pipeline-status","version":2}')).toThrow();
    expect(() =>
      decodeStatus(
        JSON.stringify({
          format: 'orbit-now-pipeline-status',
          version: 1,
          generatedAt: 'x',
          catalogObjectCount: 0,
          sources: [{ id: 'a' }],
        }),
      ),
    ).toThrow(/missing or mistyped/);
  });
});
