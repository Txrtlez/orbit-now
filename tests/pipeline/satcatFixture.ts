/**
 * The header of CelesTrak's SATCAT CSV, in the order its documentation
 * lists the fields (https://celestrak.org/satcat/satcat-format.php, read
 * 2026-11-15). The parser finds columns by name, so the order only makes
 * the fixture resemble a real download.
 */
export const SATCAT_CSV_HEADER =
  'OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,' +
  'DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE';

/**
 * One row of SATCAT CSV.
 *
 * ROWS BUILT WITH THIS ARE INVENTED for the tests. They follow the
 * documented format, and the codes used are ones the documentation lists,
 * but they are not copied from the real catalog and describe no real
 * object: no real SATCAT download was available when the tests were
 * written, because the build environment is not allowed to contact CelesTrak.
 */
export function satcatRow(
  noradId: string | number,
  type: string,
  status: string,
  owner: string,
  launch: string,
  name = 'TEST OBJECT',
): string {
  return `${name},2020-001A,${String(noradId)},${type},${status},${owner},${launch},AFETR,,95.5,53.0,550,540,,,EA,ORB`;
}

/** A complete document: the header, then the given rows. */
export function satcatDocument(...rows: string[]): string {
  return `${[SATCAT_CSV_HEADER, ...rows].join('\r\n')}\r\n`;
}
