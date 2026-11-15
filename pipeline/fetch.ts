/**
 * Downloading one data set, following CelesTrak's usage policy
 * (http://celestrak.org/usage-policy.php, read 2026-11-14):
 *
 * - Accept only HTTP 200. On anything else, stop and report to a human.
 * - Do not retry. Repeating a refused request cannot succeed and counts
 *   against the address the request came from.
 * - Do not follow redirects. CelesTrak counts a 301 as an error, and a
 *   client that silently follows one never learns its address is out of date.
 */

export type FetchOutcome =
  /** HTTP 200 with a body. */
  | { readonly kind: 'ok'; readonly body: string }
  /**
   * CelesTrak's rationing reply: HTTP 403 with a message saying the data has
   * not updated since the last successful download from this address. On a
   * shared address (such as a hosted CI runner) the earlier download may
   * have been someone else's.
   */
  | { readonly kind: 'not-updated'; readonly status: number; readonly detail: string }
  /** Any other response that is not HTTP 200. */
  | { readonly kind: 'refused'; readonly status: number; readonly detail: string }
  /** No HTTP response at all: DNS failure, timeout, connection reset. */
  | { readonly kind: 'network-error'; readonly detail: string };

/** The part of the standard `fetch` function this module uses. Tests supply a fake. */
export type FetchFunction = (
  url: string,
  init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>;

/** Identifies this client to the server, with a link a human can follow. */
export const USER_AGENT = 'orbit-now-pipeline/1 (+https://github.com/Txrtlez/orbit-now)';

const TIMEOUT_MS = 120_000;

/** Shorten a response body for a log line, on one line. */
function summarise(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Make exactly one request for `url` and classify the result. Never throws. */
export async function fetchSource(url: string, fetchImpl: FetchFunction): Promise<FetchOutcome> {
  let status: number;
  let body: string;
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    status = response.status;
    body = await response.text();
  } catch (error: unknown) {
    return {
      kind: 'network-error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (status === 200) {
    return { kind: 'ok', body };
  }
  if (status === 403 && /has not updated/i.test(body)) {
    return { kind: 'not-updated', status, detail: summarise(body) };
  }
  return { kind: 'refused', status, detail: summarise(body) };
}
