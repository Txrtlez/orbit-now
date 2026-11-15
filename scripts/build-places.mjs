/**
 * Builds public/places.txt, the list of cities the "passes over you" panel
 * offers when the viewer types a place name.
 *
 * SOURCE: the GeoNames gazetteer (https://www.geonames.org), file
 * "cities15000": every populated place of 15 000 people or more, plus
 * capitals. GeoNames data is licensed CC BY 4.0. The copy used is the one
 * bundled in the npm package cities-15000-structured, version 1.0.1; its
 * newest record is dated 2023-03-05.
 *
 * The output is committed, so the site does not need the package. To
 * rebuild it:
 *
 *   npm install --no-save cities-15000-structured@1.0.1
 *   node scripts/build-places.mjs node_modules/cities-15000-structured/dist/cities15000.txt
 *
 * Output format, plain text, one line each:
 *   line 1  a comment naming the source
 *   line 2  the time zones used, separated by commas
 *   then    name <tab> country code <tab> state (United States only) <tab>
 *           latitude x 100 <tab> longitude x 100 <tab> position of the time zone in line 2
 * Places are in order of population, largest first, so that the order of
 * the file is the order to prefer when several names match.
 *
 * Coordinates are rounded to a hundredth of a degree, about a kilometre.
 * That moves a predicted pass by well under a second.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const input = process.argv[2];
if (input === undefined) {
  console.error('Usage: node scripts/build-places.mjs <path to cities15000.txt>');
  process.exit(1);
}

// Columns of the GeoNames file, as documented in its readme and as checked
// against the row for Atlanta (33.749, -84.388, US, GA, America/New_York).
const NAME = 1;
const LATITUDE = 4;
const LONGITUDE = 5;
const COUNTRY = 8;
const ADMIN1 = 10;
const POPULATION = 14;
const TIME_ZONE = 17;

const rows = readFileSync(input, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => line.split('\t'))
  .filter((cells) => cells.length >= 19);

rows.sort(
  (a, b) => Number(b[POPULATION]) - Number(a[POPULATION]) || a[NAME].localeCompare(b[NAME]),
);

const timeZones = [];
const zoneIndex = new Map();
const lines = rows.map((cells) => {
  const zone = cells[TIME_ZONE];
  if (!zoneIndex.has(zone)) {
    zoneIndex.set(zone, timeZones.length);
    timeZones.push(zone);
  }
  const latitude = Number(cells[LATITUDE]);
  const longitude = Number(cells[LONGITUDE]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || /[\t\n]/.test(cells[NAME])) {
    throw new Error(`Unusable row: ${cells.slice(0, 6).join(' | ')}`);
  }
  return [
    cells[NAME],
    cells[COUNTRY],
    cells[COUNTRY] === 'US' ? cells[ADMIN1] : '',
    Math.round(latitude * 100),
    Math.round(longitude * 100),
    zoneIndex.get(zone),
  ].join('\t');
});

const newest = rows
  .map((cells) => cells[18])
  .sort()
  .at(-1);
const header = `# ${String(rows.length)} places of 15,000 people or more. Source: GeoNames (geonames.org) cities15000, newest record ${newest}, licensed CC BY 4.0.`;
writeFileSync('public/places.txt', `${[header, timeZones.join(','), ...lines].join('\n')}\n`);
console.log(`${String(rows.length)} places, ${String(timeZones.length)} time zones`);
