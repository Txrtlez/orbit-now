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
  /** Stable identifier. Also the CelesTrak group name. */
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
}

function celestrakGroup(group: string): string {
  return `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=csv`;
}

/**
 * Sources in the order they are requested, smallest first. If the response
 * format ever changes, the problem then shows up on a small download instead
 * of the large one.
 *
 * The position of a source in this list is its bit in each record's
 * `sourceMask`. Catalogs record source identifiers alongside, and the merge
 * step re-maps by identifier, so reordering this list is safe.
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
];
