import { execSync } from 'node:child_process';
import { defineConfig } from 'vitest/config';

/**
 * Identify the exact source revision of a build so that a deployed page can be
 * matched to a commit. GitHub Actions provides GITHUB_SHA; locally we ask git.
 */
function resolveCommit(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi !== undefined && fromCi !== '') {
    return fromCi;
  }
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  // A relative base lets the same build work at https://<user>.github.io/<repo>/
  // and at a custom domain root, with no rebuild. The trade-off is that the app
  // must not use path-based routing; view state lives in the query string.
  base: './',
  define: {
    __BUILD_COMMIT__: JSON.stringify(resolveCommit()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // three.js's renderer alone is about 560 kB before compression, so Vite's
    // default 500 kB warning would fire on every build and teach us to ignore
    // it. The enforced limit is the gzip budget in scripts/check-bundle-size.mjs.
    chunkSizeWarningLimit: 700,
  },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
  },
});
