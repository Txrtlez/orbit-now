/**
 * Human-readable description of a build, shown in the page footer so that a
 * deployed copy of the site can be matched to an exact source revision.
 *
 * @param commit  full git commit hash, or "unknown" if it could not be determined
 * @param builtAt build time as an ISO 8601 string in UTC, e.g. "2026-11-14T20:01:00.000Z"
 */
export function describeBuild(commit: string, builtAt: string): string {
  const isHash = /^[0-9a-f]{7,40}$/.test(commit);
  const revision = isHash ? commit.slice(0, 7) : 'unknown revision';

  const time = new Date(builtAt);
  if (Number.isNaN(time.getTime())) {
    return `Build ${revision}`;
  }
  // "2026-11-14T20:01:00.000Z" -> "2026-11-14 20:01 UTC"
  const stamp = `${time.toISOString().slice(0, 10)} ${time.toISOString().slice(11, 16)} UTC`;
  return `Build ${revision} · ${stamp}`;
}
