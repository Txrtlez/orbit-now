// Fails the build if the files needed for the first paint grow past a budget.
//
// "Initial download" here means index.html plus every script and stylesheet
// that index.html references directly. Code loaded later with import() (such
// as the What if? mode) is deliberately not counted. Sizes are measured after
// gzip, because that is close to what actually travels over the network.
//
// Usage: node scripts/check-bundle-size.mjs   (after `npm run build`)

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Budget for the initial download, in bytes after gzip. */
const BUDGET_BYTES = 300 * 1024;

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = readFileSync(join(distDir, 'index.html'), 'utf8');

// Collect local script and stylesheet references such as "./assets/index-abc.js".
const references = new Set();
for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+\.(?:js|css))"/g)) {
  references.add(match[1]);
}
if (references.size === 0) {
  console.error('No script or stylesheet references found in dist/index.html.');
  process.exit(1);
}

const rows = [['index.html', gzipSync(html).length]];
for (const reference of references) {
  rows.push([reference, gzipSync(readFileSync(join(distDir, reference))).length]);
}

let total = 0;
for (const [name, bytes] of rows) {
  total += bytes;
  console.log(`${(bytes / 1024).toFixed(1).padStart(8)} kB  ${name}`);
}
console.log(`${(total / 1024).toFixed(1).padStart(8)} kB  total (gzip)`);
console.log(`${(BUDGET_BYTES / 1024).toFixed(1).padStart(8)} kB  budget`);

if (total > BUDGET_BYTES) {
  console.error('Initial download exceeds the budget.');
  process.exit(1);
}
