/**
 * The data pipeline's command, as a function. `cli.ts` calls it with the real
 * network and clock; the tests call it with substitutes.
 */
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeCatalog, encodeCatalog, type Catalog } from '../src/catalog/format';
import type { FetchFunction } from './fetch';
import type { SourceDefinition } from './sources';
import { decodeStatus, runUpdate, type PipelineStatus, type RunResult } from './update';

const CATALOG_FILE = 'catalog.json.gz';
const STATUS_FILE = 'status.json';

/** Everything the command needs from the outside world, so that tests can substitute each part. */
export interface CliEnvironment {
  /** Command-line arguments, without the program name. */
  readonly argv: readonly string[];
  /** Path of the file GitHub Actions reads step outputs from, if any. */
  readonly githubOutputPath?: string | undefined;
  /** Path of the file GitHub Actions reads the step summary from, if any. */
  readonly githubSummaryPath?: string | undefined;
  readonly definitions: readonly SourceDefinition[];
  readonly fetchImpl: FetchFunction;
  readonly now: () => Date;
  readonly pauseBetweenRequests: () => Promise<void>;
  /** Receives the human-readable report. */
  readonly print: (text: string) => void;
}

function readPrevious(directory: string | undefined): {
  catalog: Catalog | null;
  status: PipelineStatus | null;
} {
  if (directory === undefined) {
    return { catalog: null, status: null };
  }
  const catalogPath = join(directory, CATALOG_FILE);
  const statusPath = join(directory, STATUS_FILE);
  // A file that exists but cannot be read is an error, not "no previous
  // data": carrying on would overwrite the published catalog with one built
  // from nothing.
  return {
    catalog: existsSync(catalogPath)
      ? decodeCatalog(gunzipSync(readFileSync(catalogPath)).toString('utf8'))
      : null,
    status: existsSync(statusPath) ? decodeStatus(readFileSync(statusPath, 'utf8')) : null,
  };
}

function summarise(result: RunResult): string {
  const lines = [
    '## Catalog update',
    '',
    `Requests made: ${String(result.requestsMade)}. Objects in catalog: ${String(result.status.catalogObjectCount)}.`,
    '',
    '| Source | This run | Detail | Last success (UTC) |',
    '| --- | --- | --- | --- |',
  ];
  for (const entry of result.report) {
    const status = result.status.sources.find((source) => source.id === entry.id);
    const detail = entry.detail.replace(/\|/g, '\\|');
    lines.push(
      `| ${entry.id} | ${entry.action} | ${detail} | ${status?.lastSuccessAt ?? 'never'} |`,
    );
  }
  const rejectedLines = result.status.sources
    .filter((source) => Object.keys(source.rejected).length > 0)
    .map(
      (source) =>
        `- ${source.id}: ${Object.entries(source.rejected)
          .map(([reason, count]) => `${reason} ${String(count)}`)
          .join(', ')}`,
    );
  if (rejectedLines.length > 0) {
    lines.push('', 'Rows left out of the last accepted downloads:', ...rejectedLines);
  }
  if (result.alerts.length > 0) {
    lines.push('', '### Needs attention', ...result.alerts.map((alert) => `- ${alert}`));
  }
  return `${lines.join('\n')}\n`;
}

/** Run one update and write its results. Returns what was decided, for the caller to act on or test. */
export async function runCli(environment: CliEnvironment): Promise<RunResult> {
  const { values } = parseArgs({
    args: [...environment.argv],
    options: {
      previous: { type: 'string' },
      out: { type: 'string' },
      raw: { type: 'string' },
    },
  });
  if (values.out === undefined) {
    throw new Error('Missing required option --out <directory>');
  }
  const outDirectory = values.out;
  const rawDirectory = values.raw;

  const previous = readPrevious(values.previous);
  if (rawDirectory !== undefined) {
    mkdirSync(rawDirectory, { recursive: true });
  }

  const result = await runUpdate({
    previousCatalog: previous.catalog,
    previousStatus: previous.status,
    definitions: environment.definitions,
    fetchImpl: environment.fetchImpl,
    now: environment.now,
    pauseBetweenRequests: environment.pauseBetweenRequests,
    onDownloaded: (sourceId, body) => {
      if (rawDirectory !== undefined) {
        writeFileSync(join(rawDirectory, `${sourceId}.csv`), body);
      }
    },
  });

  mkdirSync(outDirectory, { recursive: true });
  const outCatalogPath = join(outDirectory, CATALOG_FILE);
  if (result.catalog !== null) {
    // Check the new file reads back before anything depends on it.
    const encoded = encodeCatalog(result.catalog);
    const decoded = decodeCatalog(encoded);
    if (decoded.records.length !== result.catalog.records.length) {
      throw new Error('The encoded catalog did not read back with the same number of records');
    }
    writeFileSync(outCatalogPath, gzipSync(encoded, { level: 9 }));
  } else if (values.previous !== undefined && existsSync(join(values.previous, CATALOG_FILE))) {
    copyFileSync(join(values.previous, CATALOG_FILE), outCatalogPath);
  }
  writeFileSync(join(outDirectory, STATUS_FILE), `${JSON.stringify(result.status, null, 2)}\n`);

  const summary = summarise(result);
  const outputs = [
    `publish=${String(result.requestsMade > 0)}`,
    `deploy=${String(result.catalog !== null)}`,
    `alert=${String(result.alerts.length > 0)}`,
  ];
  environment.print(`${summary}${outputs.join('\n')}\n`);
  if (environment.githubOutputPath !== undefined) {
    appendFileSync(environment.githubOutputPath, `${outputs.join('\n')}\n`);
  }
  if (environment.githubSummaryPath !== undefined) {
    appendFileSync(environment.githubSummaryPath, summary);
  }
  return result;
}
