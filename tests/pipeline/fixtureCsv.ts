import { loadVerificationCases, tleToOmm } from '../validation/valladoFixtures';

/**
 * Column order of CelesTrak's OMM CSV, as recalled from its documentation.
 * The parser locates columns by name, so the order here does not matter to
 * the code under test; it only makes the fixture resemble a real download.
 */
export const OMM_CSV_HEADER = [
  'OBJECT_NAME',
  'OBJECT_ID',
  'EPOCH',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'EPHEMERIS_TYPE',
  'CLASSIFICATION_TYPE',
  'NORAD_CAT_ID',
  'ELEMENT_SET_NO',
  'REV_AT_EPOCH',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

/**
 * The 33 element sets of the Vallado et al. (2006) verification set,
 * rewritten as OMM CSV.
 *
 * REAL DATA, used as a test fixture: these are published element sets, not
 * invented ones, so tests that parse and propagate them can be checked
 * against the published reference states. They are historical (epochs from
 * 1980 to 2006) and are never shown in the app.
 *
 * Two of the 33 are expected to be left out by the pipeline's checks: case
 * 33334 is a deliberately impossible orbit that SGP4 refuses, and case 20413
 * appears twice with the same catalog number.
 */
export function verificationSetAsOmmCsv(): string {
  const lines = [OMM_CSV_HEADER.join(',')];
  for (const testCase of loadVerificationCases()) {
    const omm = tleToOmm(testCase.line1, testCase.line2);
    lines.push(OMM_CSV_HEADER.map((column) => String(omm[column])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Number of data rows in the fixture, and how many the pipeline should accept. */
export const FIXTURE_ROWS = 33;
export const FIXTURE_ACCEPTED = 31;
