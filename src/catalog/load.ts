import { decodeCatalog, type Catalog } from './format';

/** Where the deployed site keeps the catalog, relative to the page. */
export const CATALOG_URL = './data/catalog.json.gz';

/** The part of a `fetch` response this module uses. Tests supply a fake. */
interface ResponseLike {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** gzip files begin with the bytes 0x1f 0x8b. */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Download and decode the catalog.
 *
 * The file is stored gzip-compressed and the browser decompresses it here.
 * Some web servers decompress `.gz` files themselves before sending them, so
 * the bytes are inspected first and only decompressed if they are still gzip.
 *
 * @returns the catalog, or null if this copy of the site has none (HTTP 404).
 *          A local development server, or a deployment made before the first
 *          data download, has no catalog; that is not an error.
 * @throws if the request fails for another reason, or the file is not a valid catalog.
 */
export async function loadCatalog(
  url: string,
  fetchImpl: (url: string) => Promise<ResponseLike>,
): Promise<Catalog | null> {
  const response = await fetchImpl(url);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`The catalog request failed with HTTP ${String(response.status)}`);
  }
  const buffer = await response.arrayBuffer();
  const text = isGzip(new Uint8Array(buffer))
    ? await gunzip(buffer)
    : new TextDecoder().decode(buffer);
  return decodeCatalog(text);
}
