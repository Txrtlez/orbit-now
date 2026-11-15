/**
 * LAUNCH GATE 1: the SGP4 implementation this project uses (satellite.js)
 * reproduces the published verification set of Vallado, Crawford, Hujsak and
 * Kelso, "Revisiting Spacetrack Report #3" (AIAA 2006-6753).
 *
 * Results, tolerances and the one documented exception are recorded in
 * VALIDATION.md, entry V2.1. Provenance of the fixture files is in
 * tests/fixtures/vallado-2006/README.md.
 */
import { json2satrec, sgp4, twoline2satrec, type SatRec } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { parseOmmCsv } from '../../pipeline/omm';
import { decodeCatalog, encodeCatalog, recordToOmm } from '../../src/catalog/format';
import { verificationSetAsOmmCsv } from '../pipeline/fixtureCsv';
import { loadVerificationCases, tleToOmm, type VerificationCase } from './valladoFixtures';

/**
 * The reference file prints positions to 1e-8 km. Rounding therefore hides up
 * to 0.5e-8 km per coordinate, or sqrt(3) x 0.5e-8 = 0.87e-8 km in distance.
 * A correct implementation can differ from the printed value by that much, so
 * the tolerance is set just above it.
 */
const POSITION_TOLERANCE_KM = 1e-8;

/**
 * Velocities are printed to 1e-9 km/s; the same argument gives 0.87e-9 km/s.
 */
const VELOCITY_TOLERANCE_KM_S = 1e-9;

/**
 * One case propagates 3.5 years (1.8 million minutes) from its epoch. Over
 * that span, differences in the order of floating-point operations between
 * JavaScript and the reference C++ accumulate to about 1.2e-7 km (0.12 mm).
 * It gets its own, looser, position tolerance. See VALIDATION.md.
 */
const LONG_SPAN_MIN = 100_000;
const LONG_SPAN_POSITION_TOLERANCE_KM = 5e-7;

/**
 * Case 33334 is a deliberately impossible orbit (mean motion 0.00001
 * revolutions per day). The 2006 reference program printed a state for it at
 * time zero; satellite.js instead reports error 3 ("perturbed eccentricity
 * out of range") and returns nothing. That is the single reference state this
 * project does not reproduce.
 */
const INVALID_ORBIT_CASE = '33334';

/**
 * Cases whose reference output stops before the requested stop time, because
 * the reference code reported an error at the next step, with the error code
 * expected there. The codes are those of the SGP4 standard: 1 = mean
 * eccentricity out of range, 3 = perturbed eccentricity out of range,
 * 4 = semi-latus rectum below zero, 6 = orbit decayed.
 *
 * Case 20413 appears twice in the verification set; it is the second
 * occurrence (index 32) that ends early.
 */
const EXPECTED_ERRORS: readonly { index: number; id: string; code: number }[] = [
  { index: 11, id: '22312', code: 1 },
  { index: 22, id: '28350', code: 1 },
  { index: 25, id: '28872', code: 6 },
  { index: 26, id: '29141', code: 6 },
  { index: 29, id: '33333', code: 4 },
  { index: 30, id: '33334', code: 3 },
  { index: 32, id: '20413', code: 6 },
];

interface Worst {
  positionKm: number;
  velocityKmS: number;
  compared: number;
}

/** Propagate one case with the given satellite record and compare every reference state. */
function compareCase(
  testCase: VerificationCase,
  satrec: SatRec,
  tolerancePositionKm: number,
): Worst {
  const worst: Worst = { positionKm: 0, velocityKmS: 0, compared: 0 };
  for (const state of testCase.states) {
    const result = sgp4(satrec, state.tsinceMin);
    if (result === null) {
      throw new Error(
        `Case ${testCase.id}: no state at t = ${String(state.tsinceMin)} min (error ${String(satrec.error)})`,
      );
    }
    const positionError = Math.hypot(
      result.position.x - state.position[0],
      result.position.y - state.position[1],
      result.position.z - state.position[2],
    );
    const velocityError = Math.hypot(
      result.velocity.x - state.velocity[0],
      result.velocity.y - state.velocity[1],
      result.velocity.z - state.velocity[2],
    );
    const limit =
      Math.abs(state.tsinceMin) > LONG_SPAN_MIN
        ? LONG_SPAN_POSITION_TOLERANCE_KM
        : tolerancePositionKm;
    expect(positionError, `case ${testCase.id}, t = ${String(state.tsinceMin)} min`).toBeLessThan(
      limit,
    );
    expect(velocityError, `case ${testCase.id}, t = ${String(state.tsinceMin)} min`).toBeLessThan(
      VELOCITY_TOLERANCE_KM_S,
    );
    worst.positionKm = Math.max(worst.positionKm, positionError);
    worst.velocityKmS = Math.max(worst.velocityKmS, velocityError);
    worst.compared += 1;
  }
  return worst;
}

const cases = loadVerificationCases();
const comparable = cases.filter((testCase) => testCase.id !== INVALID_ORBIT_CASE);

describe('SGP4 against the Vallado et al. (2006) verification set', () => {
  it('reads the complete verification set: 33 element sets and 667 reference states', () => {
    expect(cases).toHaveLength(33);
    expect(cases.reduce((sum, testCase) => sum + testCase.states.length, 0)).toBe(667);
  });

  it('reproduces 666 of the 667 reference states from two-line element sets', () => {
    let compared = 0;
    for (const testCase of comparable) {
      const satrec = twoline2satrec(testCase.line1, testCase.line2);
      compared += compareCase(testCase, satrec, POSITION_TOLERANCE_KM).compared;
    }
    expect(compared).toBe(666);
  });

  it('reproduces the same 666 states from OMM records, the format used in production', () => {
    let compared = 0;
    for (const testCase of comparable) {
      const satrec = json2satrec(tleToOmm(testCase.line1, testCase.line2));
      compared += compareCase(testCase, satrec, POSITION_TOLERANCE_KM).compared;
    }
    expect(compared).toBe(666);
  });

  it('reproduces the same 666 states after the elements have been through the whole data pipeline', () => {
    // The route real data takes: OMM CSV -> pipeline checks -> catalog file
    // -> decoded in the browser -> rebuilt OMM record -> SGP4. The catalog
    // drops fields SGP4 does not read, so this also shows that dropping them
    // changes nothing.
    const parsed = parseOmmCsv(verificationSetAsOmmCsv(), Date.UTC(2026, 10, 14));
    const catalog = decodeCatalog(
      encodeCatalog({
        generatedAt: '2026-11-14T00:00:00.000Z',
        sources: [],
        records: parsed.elementSets.map((elementSet) => ({ ...elementSet, sourceMask: 0 })),
      }),
    );
    const byId = new Map(catalog.records.map((record) => [String(record.noradId), record]));

    let compared = 0;
    for (const testCase of comparable) {
      const record = byId.get(testCase.id);
      expect(record, `case ${testCase.id} should be in the catalog`).toBeDefined();
      if (record === undefined) {
        continue;
      }
      const satrec = json2satrec(recordToOmm(record));
      compared += compareCase(testCase, satrec, POSITION_TOLERANCE_KM).compared;
    }
    expect(compared).toBe(666);
    // The pipeline itself leaves out the impossible orbit.
    expect(byId.has(INVALID_ORBIT_CASE)).toBe(false);
  });

  it('reports an error for the impossible orbit of case 33334 instead of a state', () => {
    const testCase = cases.find((candidate) => candidate.id === INVALID_ORBIT_CASE);
    expect(testCase).toBeDefined();
    if (testCase === undefined) {
      return;
    }
    expect(testCase.states).toHaveLength(1);
    const satrec = twoline2satrec(testCase.line1, testCase.line2);
    expect(sgp4(satrec, 0)).toBeNull();
    expect(satrec.error).toBe(3);
  });

  it('stops with the standard error code exactly where the reference output stops', () => {
    for (const expected of EXPECTED_ERRORS) {
      const testCase = cases[expected.index];
      expect(testCase?.id).toBe(expected.id);
      if (testCase === undefined) {
        continue;
      }
      const lastState = testCase.states.at(-1);
      if (lastState === undefined) {
        throw new Error(`Case ${testCase.id} has no reference states`);
      }
      // The reference output for this case ends early...
      expect(lastState.tsinceMin).toBeLessThan(testCase.stopMin);

      // ...and one step later (or at time zero for the impossible orbit) the
      // implementation reports the expected error.
      const satrec = twoline2satrec(testCase.line1, testCase.line2);
      const failingTime =
        testCase.id === INVALID_ORBIT_CASE ? 0 : lastState.tsinceMin + testCase.stepMin;
      expect(sgp4(satrec, failingTime), `case ${testCase.id}`).toBeNull();
      expect(satrec.error, `case ${testCase.id}`).toBe(expected.code);
    }
  });

  it('completes every other case through its requested stop time', () => {
    const endsEarly = new Set(EXPECTED_ERRORS.map((expected) => expected.index));
    cases.forEach((testCase, index) => {
      if (endsEarly.has(index)) {
        return;
      }
      const lastState = testCase.states.at(-1);
      expect(lastState?.tsinceMin, `case ${testCase.id}`).toBe(testCase.stopMin);
    });
  });
});

describe('tleToOmm (test helper)', () => {
  it('converts the first verification element set digit for digit', () => {
    // 1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753
    // 2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667
    const first = cases[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    const omm = tleToOmm(first.line1, first.line2);
    expect(omm.NORAD_CAT_ID).toBe(5);
    expect(omm.OBJECT_ID).toBe('58002B');
    // Day 179 of 2000 is 27 June; 0.78495062 day = 18:50:19.733568.
    expect(omm.EPOCH).toBe('2000-06-27T18:50:19.733568');
    expect(omm.MEAN_MOTION).toBe(10.82419157);
    expect(omm.ECCENTRICITY).toBe(0.1859667);
    expect(omm.INCLINATION).toBe(34.2682);
    expect(omm.RA_OF_ASC_NODE).toBe(348.7242);
    expect(omm.ARG_OF_PERICENTER).toBe(331.7664);
    expect(omm.MEAN_ANOMALY).toBe(19.3264);
    expect(omm.BSTAR).toBe(0.28098e-4);
    expect(omm.MEAN_MOTION_DOT).toBe(0.00000023);
    expect(omm.MEAN_MOTION_DDOT).toBe(0);
  });
});
