/**
 * Command-line entry point for the data pipeline.
 *
 *   npm run data:update -- --previous <dir> --out <dir> [--raw <dir>]
 *
 * --previous  directory holding the currently published `catalog.json.gz`
 *             and `status.json`, if any. It may be empty or missing.
 * --out       directory to write the new `catalog.json.gz` and `status.json`
 *             into. Always receives a complete, consistent pair.
 * --raw       optional directory to save each raw download into, so that a
 *             response the parser rejects can be inspected without
 *             requesting it again.
 *
 * WARNING: running this makes real requests to CelesTrak, which allows one
 * download of each data set per two hours per IP address. It is meant to be
 * run by the scheduled GitHub Actions workflow, not by hand while developing.
 * Use the tests, which substitute the network, for development.
 *
 * When run by GitHub Actions, three results are reported for later steps:
 *   publish  "true" if the files in --out differ from --previous
 *   deploy   "true" if the catalog itself changed, so the site should be rebuilt
 *   alert    "true" if something needs a human's attention
 *
 * The exit code is 0 whenever a consistent result was written, even if a
 * source was refused: what to do about that is the workflow's decision, and
 * it can only publish partial progress if this step succeeds. A non-zero
 * exit code means the pipeline itself could not run.
 */
import { runCli } from './run-cli';
import { SOURCES } from './sources';

/** Milliseconds to wait between two requests to the same server. */
const PAUSE_BETWEEN_REQUESTS_MS = 3000;

runCli({
  argv: process.argv.slice(2),
  githubOutputPath: process.env.GITHUB_OUTPUT,
  githubSummaryPath: process.env.GITHUB_STEP_SUMMARY,
  definitions: SOURCES,
  fetchImpl: (url, init) => fetch(url, init),
  now: () => new Date(),
  pauseBetweenRequests: () =>
    new Promise((resolve) => {
      setTimeout(resolve, PAUSE_BETWEEN_REQUESTS_MS);
    }),
  print: (text) => process.stdout.write(text),
}).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 2;
});
