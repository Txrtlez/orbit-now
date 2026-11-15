import { describe, expect, it } from 'vitest';
import { encodeCatalog, type Catalog } from './format';
import { loadCatalog } from './load';

// The published Vallado et al. (2006) verification element set 00005; see format.test.ts.
const CATALOG: Catalog = {
  generatedAt: '2026-11-14T03:17:00.000Z',
  sources: [
    {
      id: 'a',
      label: 'Source A',
      provider: 'TEST',
      fetchedAt: '2026-11-14T03:16:00.000Z',
      objectCount: 1,
    },
  ],
  records: [
    {
      noradId: 5,
      name: 'VERIFICATION 00005',
      objectId: '58002B',
      epochDay: 11135,
      epochMicros: 67_819_733_568,
      meanMotion: 10.82419157,
      eccentricity: 0.1859667,
      inclination: 34.2682,
      raan: 348.7242,
      argPericenter: 331.7664,
      meanAnomaly: 19.3264,
      bstar: 0.000028098,
      sourceMask: 1,
    },
  ],
};

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function respondWith(status: number, body: ArrayBuffer) {
  return () =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: () => Promise.resolve(body),
    });
}

const plain = new TextEncoder().encode(encodeCatalog(CATALOG)).buffer;

describe('loadCatalog', () => {
  it('decompresses and decodes a gzip-compressed catalog', async () => {
    const compressed = await gzip(encodeCatalog(CATALOG));
    expect(new Uint8Array(compressed).slice(0, 2)).toEqual(new Uint8Array([0x1f, 0x8b]));
    expect(await loadCatalog('x', respondWith(200, compressed))).toEqual(CATALOG);
  });

  it('also accepts a catalog the server has already decompressed', async () => {
    expect(await loadCatalog('x', respondWith(200, plain))).toEqual(CATALOG);
  });

  it('requests the address it was given', async () => {
    const requested: string[] = [];
    await loadCatalog('./data/catalog.json.gz', (url) => {
      requested.push(url);
      return respondWith(200, plain)();
    });
    expect(requested).toEqual(['./data/catalog.json.gz']);
  });

  it('returns null when the site has no catalog', async () => {
    expect(await loadCatalog('x', respondWith(404, new ArrayBuffer(0)))).toBeNull();
  });

  it('reports other HTTP failures as errors', async () => {
    await expect(loadCatalog('x', respondWith(500, new ArrayBuffer(0)))).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it('rejects a file that is not a catalog', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>Not found</title>').buffer;
    await expect(loadCatalog('x', respondWith(200, html))).rejects.toThrow();
    const wrongJson = await gzip('{"format":"something-else"}');
    await expect(loadCatalog('x', respondWith(200, wrongJson))).rejects.toThrow(
      /Not an Orbit Now catalog/,
    );
  });
});
