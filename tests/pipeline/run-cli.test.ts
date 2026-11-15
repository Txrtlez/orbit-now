import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchFunction } from '../../pipeline/fetch';
import { runCli, type CliEnvironment } from '../../pipeline/run-cli';
import type { SourceDefinition } from '../../pipeline/sources';
import { decodeStatus } from '../../pipeline/update';
import { decodeCatalog } from '../../src/catalog/format';
import { FIXTURE_ACCEPTED, verificationSetAsOmmCsv } from './fixtureCsv';

const DEFINITIONS: SourceDefinition[] = [
  {
    id: 'only',
    label: 'Only source',
    provider: 'TEST',
    url: 'https://example.invalid/only',
    minimumObjects: 20,
  },
];
const csv = verificationSetAsOmmCsv();
const START = Date.UTC(2026, 10, 14, 3, 17);

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'orbit-now-cli-'));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function environment(
  argv: string[],
  reply: { status: number; body: string },
  atMs: number,
): { env: CliEnvironment; printed: string[]; requests: string[] } {
  const printed: string[] = [];
  const requests: string[] = [];
  const fetchImpl: FetchFunction = (url) => {
    requests.push(url);
    return Promise.resolve({ status: reply.status, text: () => Promise.resolve(reply.body) });
  };
  return {
    env: {
      argv,
      githubOutputPath: join(work, 'github-output.txt'),
      githubSummaryPath: join(work, 'github-summary.md'),
      definitions: DEFINITIONS,
      fetchImpl,
      now: () => new Date(atMs),
      pauseBetweenRequests: () => Promise.resolve(),
      print: (text) => printed.push(text),
    },
    printed,
    requests,
  };
}

describe('runCli', () => {
  it('on a first run writes the catalog, the status, the raw download and the step outputs', async () => {
    const out = join(work, 'next');
    const raw = join(work, 'raw');
    const { env, printed } = environment(
      ['--previous', join(work, 'does-not-exist'), '--out', out, '--raw', raw],
      { status: 200, body: csv },
      START,
    );
    await runCli(env);

    const catalog = decodeCatalog(
      gunzipSync(readFileSync(join(out, 'catalog.json.gz'))).toString('utf8'),
    );
    expect(catalog.records).toHaveLength(FIXTURE_ACCEPTED);
    expect(catalog.sources[0]?.fetchedAt).toBe(new Date(START).toISOString());

    const status = decodeStatus(readFileSync(join(out, 'status.json'), 'utf8'));
    expect(status.catalogObjectCount).toBe(FIXTURE_ACCEPTED);

    expect(readFileSync(join(raw, 'only.csv'), 'utf8')).toBe(csv);
    expect(readFileSync(join(work, 'github-output.txt'), 'utf8')).toBe(
      'publish=true\ndeploy=true\nalert=false\n',
    );
    expect(readFileSync(join(work, 'github-summary.md'), 'utf8')).toContain('| only | updated |');
    expect(printed.join('')).toContain('Rows left out of the last accepted downloads:');
    expect(printed.join('')).toContain('- only: sgp4-error 1, duplicate 1');
  });

  it('on a run that comes too soon makes no request and carries the catalog forward unchanged', async () => {
    const first = join(work, 'first');
    await runCli(environment(['--out', first], { status: 200, body: csv }, START).env);
    const firstBytes = readFileSync(join(first, 'catalog.json.gz'));
    writeFileSync(join(work, 'github-output.txt'), '');

    const second = join(work, 'second');
    const { env, requests } = environment(
      ['--previous', first, '--out', second],
      { status: 500, body: 'must not be requested' },
      START + 60 * 60_000,
    );
    await runCli(env);

    expect(requests).toEqual([]);
    expect(readFileSync(join(second, 'catalog.json.gz')).equals(firstBytes)).toBe(true);
    expect(readFileSync(join(work, 'github-output.txt'), 'utf8')).toBe(
      'publish=false\ndeploy=false\nalert=false\n',
    );
  });

  it('after a refusal keeps the published catalog, records the refusal and asks for attention', async () => {
    const first = join(work, 'first');
    await runCli(environment(['--out', first], { status: 200, body: csv }, START).env);
    const firstBytes = readFileSync(join(first, 'catalog.json.gz'));
    writeFileSync(join(work, 'github-output.txt'), '');

    const second = join(work, 'second');
    const later = START + 8 * 3_600_000;
    await runCli(
      environment(['--previous', first, '--out', second], { status: 503, body: 'Busy' }, later).env,
    );

    expect(readFileSync(join(second, 'catalog.json.gz')).equals(firstBytes)).toBe(true);
    const status = decodeStatus(readFileSync(join(second, 'status.json'), 'utf8'));
    expect(status.sources[0]).toMatchObject({
      lastOutcome: 'refused',
      lastRequestAt: new Date(later).toISOString(),
      lastSuccessAt: new Date(START).toISOString(),
    });
    expect(readFileSync(join(work, 'github-output.txt'), 'utf8')).toBe(
      'publish=true\ndeploy=false\nalert=true\n',
    );
    expect(readFileSync(join(work, 'github-summary.md'), 'utf8')).toContain('### Needs attention');
  });

  it('writes no catalog when there has never been a successful download', async () => {
    const out = join(work, 'next');
    await runCli(environment(['--out', out], { status: 403, body: 'Forbidden' }, START).env);
    expect(existsSync(join(out, 'catalog.json.gz'))).toBe(false);
    expect(existsSync(join(out, 'status.json'))).toBe(true);
  });

  it('refuses to run over previous data it cannot read, instead of starting from nothing', async () => {
    const previous = join(work, 'first');
    await runCli(environment(['--out', previous], { status: 200, body: csv }, START).env);
    writeFileSync(join(previous, 'catalog.json.gz'), 'this is not gzip');
    const { env, requests } = environment(
      ['--previous', previous, '--out', join(work, 'next')],
      { status: 200, body: csv },
      START + 8 * 3_600_000,
    );
    await expect(runCli(env)).rejects.toThrow();
    expect(requests).toEqual([]); // failed before contacting the server
  });

  it('requires an output directory', async () => {
    await expect(runCli(environment([], { status: 200, body: csv }, START).env)).rejects.toThrow(
      /--out/,
    );
  });
});
