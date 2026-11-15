/**
 * The data sets the pipeline downloads.
 *
 * All come from CelesTrak (https://celestrak.org), which republishes the US
 * Space Force's general-perturbations (GP) orbital data. CelesTrak serves
 * that data in named groups. There is no group containing every catalogued
 * object, so this project's catalog is NOT the full public catalog: it is
 * the active satellites plus the debris of three breakup events for which
 * CelesTrak maintains groups. The app says so wherever it presents totals.
 *
 * Group names and the query form were read from
 * https://celestrak.org/NORAD/elements/ and
 * https://celestrak.org/NORAD/documentation/gp-data-formats.php on
 * 2026-11-14. CSV is requested because CelesTrak's usage policy recommends it.
 */

export interface SourceDefinition {
  /**
   * What the source provides. "gp" (the default) is orbital elements; the
   * objects it lists make up the catalog. "satcat" is descriptive data
   * (object type, owner, launch date) about objects already in the catalog;
   * it never adds or removes objects.
   */
  readonly kind?: 'gp' | 'satcat';
  /** Stable identifier. For orbital elements, also the CelesTrak group name. */
  readonly id: string;
  /** Description shown to viewers. Uses CelesTrak's own wording for the group. */
  readonly label: string;
  /** Organisation that publishes the data. */
  readonly provider: string;
  /** Address the data is downloaded from. */
  readonly url: string;
  /**
   * Fewest valid element sets a download must contain to be believed. A
   * response with fewer is treated as truncated or wrong and is not used.
   */
  readonly minimumObjects: number;
  /**
   * Shortest time between two requests for this source, in milliseconds.
   * Defaults to a little over 2 hours, the refresh interval of orbital
   * elements. Sources that change less often must say so here.
   */
  readonly minimumIntervalMs?: number;
  /**
   * A source whose last successful download is older than this, in
   * milliseconds, needs a human's attention. Defaults to 48 hours.
   */
  readonly staleAfterMs?: number;
}

function celestrakGroup(group: string): string {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=csv`;
}

/**
 * CelesTrak's satellite catalog (SATCAT) records for one of its groups.
 *
 * The query form is the one documented at
 * https://celestrak.org/satcat/satcat-format.php (read 2026-11-15):
 * `records.php?GROUP=<group>&FORMAT=CSV`, where the group is any of those on
 * the current-data page. Asking by group returns records only for objects
 * this project shows, in keeping with the usage policy's "download only the
 * data you need"; the alternative, the complete catalog file, is several
 * times larger and mostly objects that decayed long ago.
 *
 * NOT YET EXERCISED: this address was written from the documentation and
 * had not been requested when this was written (the build environment is
 * not allowed to contact CelesTrak). The first scheduled run is the test.
 */
function celestrakSatcatGroup(group: string): string {
  return `https://celestrak.org/satcat/records.php?GROUP=${group}&FORMAT=CSV`;
}

/**
 * How often descriptive data is requested. CelesTrak's usage policy
 * (https://celestrak.org/usage-policy.php, read 2026-11-15) says the SATCAT
 * is updated by hand once or twice a day and may be downloaded once per
 * update. With runs every 8 hours, a 22-hour minimum means one request a
 * day, at whichever run first falls a day after the last.
 */
const SATCAT_MINIMUM_INTERVAL_MS = 22 * 3_600_000;
/** Descriptive data changes slowly; four days without a refresh is the point at which to look. */
const SATCAT_STALE_AFTER_MS = 96 * 3_600_000;

function satcatSource(group: string, label: string, minimumObjects: number): SourceDefinition {
  return {
    kind: 'satcat',
    id: `satcat-${group}`,
    label,
    provider: 'CelesTrak',
    url: celestrakSatcatGroup(group),
    minimumObjects,
    minimumIntervalMs: SATCAT_MINIMUM_INTERVAL_MS,
    staleAfterMs: SATCAT_STALE_AFTER_MS,
  };
}

/**
 * Sources in the order they are requested: orbital elements first, because
 * the site cannot work without them and a refused request ends the run;
 * then descriptive data, which the site can do without for a day. Within
 * each kind, smallest first: if the response format ever changes, the
 * problem then shows up on a small download instead of the large one.
 *
 * The position of an orbital-elements source among the sources of that kind
 * is its bit in each record's `sourceMask`. Catalogs record source
 * identifiers alongside, and the merge step re-maps by identifier, so
 * reordering this list is safe.
 */
export const SOURCES: readonly SourceDefinition[] = [
  {
    id: 'iridium-33-debris',
    label: 'Iridium 33 debris',
    provider: 'CelesTrak',
    url: celestrakGroup('iridium-33-debris'),
    minimumObjects: 1,
  },
  {
    id: 'cosmos-2251-debris',
    label: 'Cosmos 2251 debris',
    provider: 'CelesTrak',
    url: celestrakGroup('cosmos-2251-debris'),
    minimumObjects: 1,
  },
  {
    id: 'fengyun-1c-debris',
    label: 'Fengyun-1C debris',
    provider: 'CelesTrak',
    url: celestrakGroup('fengyun-1c-debris'),
    minimumObjects: 1,
  },
  {
    id: 'active',
    label: 'Active satellites',
    provider: 'CelesTrak',
    url: celestrakGroup('active'),
    // CelesTrak's documentation describes this list as "10,000+ satellites".
    // Half of that is a deliberately loose floor that still catches a
    // truncated download.
    minimumObjects: 5000,
  },
  satcatSource('iridium-33-debris', 'Catalog records: Iridium 33 debris', 1),
  satcatSource('cosmos-2251-debris', 'Catalog records: Cosmos 2251 debris', 1),
  satcatSource('fengyun-1c-debris', 'Catalog records: Fengyun-1C debris', 1),
  satcatSource('active', 'Catalog records: active satellites', 5000),
];
