/**
 * Sorting objects into the families a viewer is likely to ask about:
 * the big constellations, navigation systems, space stations, and the
 * debris of particular break-ups.
 *
 * Two kinds of evidence are used, and they are not equally strong:
 *
 * - REAL DATA: membership of a debris group. CelesTrak maintains those
 *   lists, and the catalog records which list each object came from. Each
 *   list also contains what is left of the satellite that broke up.
 * - SIMPLIFICATION: membership of a constellation or navigation system is
 *   recognised from the object's published name (for example, a name
 *   beginning "STARLINK-"). A satellite published under an unexpected name
 *   is missed, and nothing here checks whether a satellite is still in
 *   service. The patterns were written against the names in the catalog
 *   of 2026-11-15; the counts they produced then are in VALIDATION.md, V3.7.
 */

/** Broad kind of category, used to group the filter buttons. */
export type CategoryFamily = 'constellation' | 'navigation' | 'station' | 'debris' | 'other';

export interface Category {
  /** Stable identifier. */
  readonly id: string;
  /** Short name for buttons and lists, e.g. "Starlink". */
  readonly label: string;
  readonly family: CategoryFamily;
  /** What one member is, for a sentence about a single object, e.g. "Starlink satellite". */
  readonly one: string;
  /** What several members are, e.g. "Starlink satellites". */
  readonly many: string;
}

interface CategoryRule extends Category {
  /** For debris categories: the identifier of the catalog source that lists the members. */
  readonly sourceId?: string;
  /** For name-based categories: the pattern a member's published name matches. */
  readonly namePattern?: RegExp;
}

/**
 * The categories, in order of precedence: an object belongs to the first
 * one it matches. The last entry matches everything.
 */
const RULES: readonly CategoryRule[] = [
  {
    id: 'fengyun-1c-debris',
    label: 'Fengyun-1C debris',
    family: 'debris',
    one: 'Fengyun-1C debris',
    many: 'pieces of Fengyun-1C debris',
    sourceId: 'fengyun-1c-debris',
  },
  {
    id: 'cosmos-2251-debris',
    label: 'Cosmos 2251 debris',
    family: 'debris',
    one: 'Cosmos 2251 debris',
    many: 'pieces of Cosmos 2251 debris',
    sourceId: 'cosmos-2251-debris',
  },
  {
    id: 'iridium-33-debris',
    label: 'Iridium 33 debris',
    family: 'debris',
    one: 'Iridium 33 debris',
    many: 'pieces of Iridium 33 debris',
    sourceId: 'iridium-33-debris',
  },
  {
    id: 'stations',
    label: 'Space stations',
    family: 'station',
    one: 'Space station module',
    many: 'space station modules',
    // The ISS and the Chinese space station are catalogued module by
    // module: "ISS (ZARYA)", "CSS (TIANHE)" and so on.
    namePattern: /^(ISS|CSS) \(/,
  },
  {
    id: 'gps',
    label: 'GPS',
    family: 'navigation',
    one: 'GPS navigation satellite',
    many: 'GPS satellites',
    namePattern: /^NAVSTAR /,
  },
  {
    id: 'glonass',
    label: 'GLONASS',
    family: 'navigation',
    one: 'GLONASS navigation satellite',
    many: 'GLONASS satellites',
    namePattern: /\[GLONASS/,
  },
  {
    id: 'galileo',
    label: 'Galileo',
    family: 'navigation',
    one: 'Galileo navigation satellite',
    many: 'Galileo satellites',
    namePattern: /\(GALILEO/,
  },
  {
    id: 'beidou',
    label: 'BeiDou',
    family: 'navigation',
    one: 'BeiDou navigation satellite',
    many: 'BeiDou satellites',
    namePattern: /^BEIDOU/,
  },
  {
    id: 'qzss',
    label: 'QZSS',
    family: 'navigation',
    one: 'QZSS navigation satellite',
    many: 'QZSS satellites',
    namePattern: /^QZS-/,
  },
  {
    id: 'navic',
    label: 'NavIC',
    family: 'navigation',
    one: 'NavIC (IRNSS) navigation satellite',
    many: 'NavIC satellites',
    namePattern: /^IRNSS-|\(IRNSS-/,
  },
  {
    id: 'starlink',
    label: 'Starlink',
    family: 'constellation',
    one: 'Starlink satellite',
    many: 'Starlink satellites',
    namePattern: /^STARLINK/,
  },
  {
    id: 'oneweb',
    label: 'OneWeb',
    family: 'constellation',
    one: 'OneWeb satellite',
    many: 'OneWeb satellites',
    namePattern: /^ONEWEB/,
  },
  {
    id: 'kuiper',
    label: 'Kuiper',
    family: 'constellation',
    one: 'Kuiper satellite',
    many: 'Kuiper satellites',
    namePattern: /^KUIPER/,
  },
  {
    id: 'qianfan',
    label: 'Qianfan',
    family: 'constellation',
    one: 'Qianfan satellite',
    many: 'Qianfan satellites',
    namePattern: /^QIANFAN/,
  },
  {
    id: 'hulianwang',
    label: 'Hulianwang',
    family: 'constellation',
    one: 'Hulianwang satellite',
    many: 'Hulianwang satellites',
    namePattern: /^HULIANWANG/,
  },
  {
    id: 'other',
    label: 'Everything else',
    family: 'other',
    one: 'Object',
    many: 'other objects',
  },
];

/** The categories, in order of precedence. The position in this list is the code stored per object. */
export const CATEGORIES: readonly Category[] = RULES.map(({ id, label, family, one, many }) => ({
  id,
  label,
  family,
  one,
  many,
}));

/** Code of the catch-all category. */
export const OTHER_CATEGORY = RULES.length - 1;

/**
 * The category an object belongs to, as a position in `CATEGORIES`.
 *
 * @param name      the object's published name
 * @param sourceIds identifiers of the catalog sources that list the object
 */
export function categoryOf(name: string, sourceIds: readonly string[]): number {
  const found = RULES.findIndex((rule) => {
    if (rule.sourceId !== undefined) {
      return sourceIds.includes(rule.sourceId);
    }
    if (rule.namePattern !== undefined) {
      return rule.namePattern.test(name);
    }
    return true;
  });
  return found === -1 ? OTHER_CATEGORY : found;
}
