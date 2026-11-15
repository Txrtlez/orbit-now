import type { Catalog } from '../src/catalog/format';
import { fetchSource, type FetchFunction } from './fetch';
import { mergeCatalog, type SourceUpdate } from './merge';
import { parseOmmCsv, type RejectionReason } from './omm';
import type { SourceDefinition } from './sources';

/**
 * One run of the data pipeline: decide which sources may be requested,
 * request them, check what comes back, and merge the good parts into the
 * catalog.
 *
 * This module does no file or network access of its own. The caller passes
 * in the previous state and a `fetch` function, which is what makes every
 * rule below testable without contacting CelesTrak.
 */

/**
 * Minimum time between two requests for the same source. CelesTrak updates GP
 * data every 2 hours and refuses a second download inside that window, so
 * asking sooner can only produce an error. Five minutes are added so that a
 * run starting slightly early does not land just inside the window.
 */
export const MINIMUM_REQUEST_INTERVAL_MS = (2 * 60 + 5) * 60_000;

/** A source whose last successful download is older than this needs a human's attention. */
export const STALE_AFTER_MS = 48 * 3_600_000;

/**
 * Share of rows allowed to fail the format checks before the whole download
 * is distrusted. A handful of odd rows is normal; a large share means the
 * file is not what the parser thinks it is.
 */
const MAX_MALFORMED_FRACTION = 0.05;
/** The fraction rule is not applied below this many malformed rows, so one bad row in a tiny file is tolerated. */
const MIN_MALFORMED_ROWS_TO_DISTRUST = 5;

/** A download must not shrink a source below this fraction of its previous size... */
const MIN_FRACTION_OF_PREVIOUS = 0.75;
/** ...unless the source was small to begin with, where large relative swings are normal. */
const SHRINK_GUARD_MIN_PREVIOUS = 100;

/** Rejection reasons that point to a broken file, as opposed to a legitimately excluded object. */
const MALFORMED_REASONS: readonly RejectionReason[] = [
  'missing-field',
  'not-a-number',
  'bad-epoch',
  'future-epoch',
  'out-of-range',
];

/** Result of the most recent request for a source. */
export type RequestOutcome = 'ok' | 'not-updated' | 'refused' | 'network-error' | 'invalid';

/** What is remembered about a source from one run to the next. */
export interface SourceStatus {
  readonly id: string;
  /** When this source was last requested, whatever the result (ISO 8601, UTC). */
  readonly lastRequestAt: string | null;
  /** When this source was last downloaded and accepted (ISO 8601, UTC). */
  readonly lastSuccessAt: string | null;
  /** Result of the last request, or null if it has never been requested. */
  readonly lastOutcome: RequestOutcome | null;
  /** Human-readable detail about the last request, such as the server's refusal message. */
  readonly lastDetail: string;
  /** Rows in the last accepted download. */
  readonly rowCount: number;
  /** Element sets from the last accepted download that passed every check. */
  readonly acceptedCount: number;
  /** Rows left out of the last accepted download, by reason. */
  readonly rejected: Readonly<Partial<Record<RejectionReason, number>>>;
}

export const STATUS_FORMAT = 'orbit-now-pipeline-status';
export const STATUS_VERSION = 1;

/** The pipeline's memory between runs, published alongside the catalog. */
export interface PipelineStatus {
  readonly format: typeof STATUS_FORMAT;
  readonly version: typeof STATUS_VERSION;
  readonly generatedAt: string;
  readonly catalogObjectCount: number;
  readonly sources: readonly SourceStatus[];
}

/** What happened to a source during this run. */
export type RunAction =
  | 'updated'
  | 'not-updated'
  | 'refused'
  | 'network-error'
  | 'invalid'
  /** Not requested: the last request was less than the minimum interval ago. */
  | 'skipped-too-soon'
  /** Not requested: an earlier request in this run got a non-200 response, so the run stopped asking. */
  | 'skipped-after-stop';

export interface RunReportEntry {
  readonly id: string;
  readonly action: RunAction;
  readonly detail: string;
}

export interface RunResult {
  /** The new catalog, or null if no source was refreshed and the published catalog stands. */
  readonly catalog: Catalog | null;
  readonly status: PipelineStatus;
  readonly report: readonly RunReportEntry[];
  /** Number of HTTP requests made. */
  readonly requestsMade: number;
  /** Conditions a human should look at. Empty when everything is normal. */
  readonly alerts: readonly string[];
}

export interface RunOptions {
  readonly previousCatalog: Catalog | null;
  readonly previousStatus: PipelineStatus | null;
  readonly definitions: readonly SourceDefinition[];
  readonly fetchImpl: FetchFunction;
  /** Returns the current time. Injected so that tests control the clock. */
  readonly now: () => Date;
  /** Waits politely between two requests. Injected so that tests do not actually wait. */
  readonly pauseBetweenRequests: () => Promise<void>;
  /** Called with the raw body of every HTTP 200 response, before it is parsed. */
  readonly onDownloaded?: (sourceId: string, body: string) => void;
}

function blankStatus(id: string): SourceStatus {
  return {
    id,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastOutcome: null,
    lastDetail: '',
    rowCount: 0,
    acceptedCount: 0,
    rejected: {},
  };
}

export async function runUpdate(options: RunOptions): Promise<RunResult> {
  const { definitions, previousCatalog, previousStatus } = options;
  const previousById = new Map(
    (previousStatus?.sources ?? []).map((source) => [source.id, source]),
  );

  const updates = new Map<string, SourceUpdate>();
  const statuses: SourceStatus[] = [];
  const report: RunReportEntry[] = [];
  const alerts: string[] = [];
  let requestsMade = 0;
  let stopped = false;

  for (const definition of definitions) {
    const previous = previousById.get(definition.id) ?? blankStatus(definition.id);

    if (stopped) {
      statuses.push(previous);
      report.push({
        id: definition.id,
        action: 'skipped-after-stop',
        detail: 'An earlier request in this run was not answered with HTTP 200.',
      });
      continue;
    }

    const nowMs = options.now().getTime();
    if (previous.lastRequestAt !== null) {
      const sinceLastMs = nowMs - Date.parse(previous.lastRequestAt);
      if (sinceLastMs < MINIMUM_REQUEST_INTERVAL_MS) {
        statuses.push(previous);
        report.push({
          id: definition.id,
          action: 'skipped-too-soon',
          detail: `Last requested ${String(Math.round(sinceLastMs / 60_000))} minutes ago.`,
        });
        continue;
      }
    }

    if (requestsMade > 0) {
      await options.pauseBetweenRequests();
    }
    const requestAt = options.now().toISOString();
    const outcome = await fetchSource(definition.url, options.fetchImpl);
    requestsMade += 1;

    if (outcome.kind !== 'ok') {
      // CelesTrak's policy: on any response other than 200, stop.
      stopped = true;
      const detail =
        outcome.kind === 'network-error'
          ? outcome.detail
          : `HTTP ${String(outcome.status)}: ${outcome.detail}`;
      statuses.push({
        ...previous,
        lastRequestAt: requestAt,
        lastOutcome: outcome.kind,
        lastDetail: detail,
      });
      report.push({ id: definition.id, action: outcome.kind, detail });
      if (outcome.kind !== 'not-updated') {
        alerts.push(`${definition.id}: request failed (${detail})`);
      }
      continue;
    }

    options.onDownloaded?.(definition.id, outcome.body);

    // Decide whether the download can be trusted.
    let problem: string | null = null;
    let parsed: ReturnType<typeof parseOmmCsv> | null = null;
    try {
      parsed = parseOmmCsv(outcome.body, Date.parse(requestAt));
    } catch (error: unknown) {
      problem = error instanceof Error ? error.message : String(error);
    }
    if (parsed !== null) {
      const rejectedCounts = parsed.rejected;
      const malformed = MALFORMED_REASONS.reduce(
        (sum, reason) => sum + (rejectedCounts[reason] ?? 0),
        0,
      );
      const accepted = parsed.elementSets.length;
      if (accepted < definition.minimumObjects) {
        problem = `Only ${String(accepted)} valid element sets; at least ${String(definition.minimumObjects)} expected.`;
      } else if (
        malformed >= MIN_MALFORMED_ROWS_TO_DISTRUST &&
        malformed > MAX_MALFORMED_FRACTION * parsed.rowCount
      ) {
        problem = `${String(malformed)} of ${String(parsed.rowCount)} rows failed the format checks.`;
      } else if (
        previous.acceptedCount >= SHRINK_GUARD_MIN_PREVIOUS &&
        accepted < MIN_FRACTION_OF_PREVIOUS * previous.acceptedCount
      ) {
        problem = `Valid element sets fell from ${String(previous.acceptedCount)} to ${String(accepted)}.`;
      }
    }

    if (problem !== null || parsed === null) {
      // The download succeeded but its content is not believable. Keep the
      // previous data for this source and stop: if the format has changed,
      // the remaining downloads would fail the same way.
      stopped = true;
      const detail = problem ?? 'Unknown problem';
      statuses.push({
        ...previous,
        lastRequestAt: requestAt,
        lastOutcome: 'invalid',
        lastDetail: detail,
      });
      report.push({ id: definition.id, action: 'invalid', detail });
      alerts.push(`${definition.id}: download rejected (${detail})`);
      continue;
    }

    updates.set(definition.id, { elementSets: parsed.elementSets, fetchedAt: requestAt });
    const detail = `${String(parsed.elementSets.length)} element sets accepted from ${String(parsed.rowCount)} rows.`;
    statuses.push({
      id: definition.id,
      lastRequestAt: requestAt,
      lastSuccessAt: requestAt,
      lastOutcome: 'ok',
      lastDetail: detail,
      rowCount: parsed.rowCount,
      acceptedCount: parsed.elementSets.length,
      rejected: parsed.rejected,
    });
    report.push({ id: definition.id, action: 'updated', detail });
  }

  const generatedAt = options.now().toISOString();
  const catalog =
    updates.size > 0 ? mergeCatalog(previousCatalog, updates, definitions, generatedAt) : null;

  // Staleness: even when nothing went wrong in this run, data that has not
  // been refreshed for a long time must not go unnoticed.
  const nowMs = options.now().getTime();
  for (const status of statuses) {
    if (status.lastSuccessAt === null) {
      alerts.push(`${status.id}: has never been downloaded successfully.`);
    } else if (nowMs - Date.parse(status.lastSuccessAt) > STALE_AFTER_MS) {
      const hours = Math.round((nowMs - Date.parse(status.lastSuccessAt)) / 3_600_000);
      alerts.push(`${status.id}: last successful download was ${String(hours)} hours ago.`);
    }
  }

  return {
    catalog,
    status: {
      format: STATUS_FORMAT,
      version: STATUS_VERSION,
      generatedAt,
      catalogObjectCount: (catalog ?? previousCatalog)?.records.length ?? 0,
      sources: statuses,
    },
    report,
    requestsMade,
    alerts,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const OUTCOMES: readonly RequestOutcome[] = [
  'ok',
  'not-updated',
  'refused',
  'network-error',
  'invalid',
];

function isOutcome(value: unknown): value is RequestOutcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

/**
 * Parse and check status JSON written by an earlier run. Throws if it is not
 * what this version wrote; the caller must not guess at corrupted state.
 */
export function decodeStatus(text: string): PipelineStatus {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || parsed.format !== STATUS_FORMAT || parsed.version !== STATUS_VERSION) {
    throw new Error('Not an Orbit Now pipeline status file of the expected version');
  }
  const { generatedAt, catalogObjectCount, sources } = parsed;
  if (
    typeof generatedAt !== 'string' ||
    typeof catalogObjectCount !== 'number' ||
    !Array.isArray(sources)
  ) {
    throw new Error('Pipeline status file has missing or mistyped fields');
  }
  const isTimeOrNull = (value: unknown): value is string | null =>
    value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));

  const decoded: SourceStatus[] = sources.map((source: unknown) => {
    if (!isObject(source)) {
      throw new Error('Pipeline status source entry is not an object');
    }
    const {
      id,
      lastRequestAt,
      lastSuccessAt,
      lastOutcome,
      lastDetail,
      rowCount,
      acceptedCount,
      rejected,
    } = source;
    if (
      typeof id !== 'string' ||
      !isTimeOrNull(lastRequestAt) ||
      !isTimeOrNull(lastSuccessAt) ||
      !(lastOutcome === null || isOutcome(lastOutcome)) ||
      typeof lastDetail !== 'string' ||
      typeof rowCount !== 'number' ||
      typeof acceptedCount !== 'number' ||
      !isObject(rejected)
    ) {
      throw new Error('Pipeline status source entry has missing or mistyped fields');
    }
    const rejectedCounts: Partial<Record<RejectionReason, number>> = {};
    for (const [reason, count] of Object.entries(rejected)) {
      if (typeof count === 'number') {
        rejectedCounts[reason as RejectionReason] = count;
      }
    }
    return {
      id,
      lastRequestAt,
      lastSuccessAt,
      lastOutcome,
      lastDetail,
      rowCount,
      acceptedCount,
      rejected: rejectedCounts,
    };
  });
  return {
    format: STATUS_FORMAT,
    version: STATUS_VERSION,
    generatedAt,
    catalogObjectCount,
    sources: decoded,
  };
}
