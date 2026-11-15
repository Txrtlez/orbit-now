/**
 * Validation of the two steps between SGP4 and the screen:
 *
 * 1. `propagateAll`, which runs SGP4 for a whole catalog and stores the
 *    results as 32-bit floats in scene coordinates.
 * 2. Hermite interpolation between two such results, which is what the
 *    graphics card does for every frame in between.
 *
 * Results are recorded in VALIDATION.md, entries V3.2 and V3.3.
 */
import { json2satrec, sgp4 } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { parseOmmCsv } from '../../pipeline/omm';
import { epochToUnixMs, recordToOmm, type CatalogRecord } from '../../src/catalog/format';
import { KM_PER_SCENE_UNIT } from '../../src/geo/sceneFrame';
import { hermite, hermiteVelocity, interpolateState } from '../../src/orbit/hermite';
import { buildPropagationSet, propagateAll } from '../../src/orbit/propagate';
import { verificationSetAsOmmCsv } from '../pipeline/fixtureCsv';
import { recordMeasurement } from './measurements';
import { loadVerificationCases } from './valladoFixtures';

const records: CatalogRecord[] = parseOmmCsv(
  verificationSetAsOmmCsv(),
  Date.UTC(2026, 10, 14),
).elementSets.map((elementSet) => ({ ...elementSet, sourceMask: 1 }));
const set = buildPropagationSet(records);
const cases = loadVerificationCases();

/** Scene coordinates back to equatorial kilometres (the inverse of the mapping in propagate.ts). */
function sceneToKm(array: Float32Array, index: number): [number, number, number] {
  const x = array[index * 3] ?? 0;
  const y = array[index * 3 + 1] ?? 0;
  const z = array[index * 3 + 2] ?? 0;
  return [x * KM_PER_SCENE_UNIT, -z * KM_PER_SCENE_UNIT, y * KM_PER_SCENE_UNIT];
}

describe('propagateAll', () => {
  it('reproduces the published reference states to the precision of 32-bit floats', () => {
    const positions = new Float32Array(records.length * 3);
    const velocities = new Float32Array(records.length * 3);
    let compared = 0;
    let worstRelative = 0;

    records.forEach((record, index) => {
      // Case 20413 appears twice in the reference set; the first block is used.
      const testCase = cases.find((candidate) => Number(candidate.id) === record.noradId);
      if (testCase === undefined) {
        throw new Error(`No reference case for ${String(record.noradId)}`);
      }
      const epochMs = epochToUnixMs(record.epochDay, record.epochMicros);
      for (const state of testCase.states) {
        propagateAll(set, epochMs + state.tsinceMin * 60_000, positions, velocities);
        const [x, y, z] = sceneToKm(positions, index);
        const [vx, vy, vz] = sceneToKm(velocities, index);
        const radius = Math.hypot(...state.position);
        const speed = Math.hypot(...state.velocity);
        const positionError = Math.hypot(
          x - state.position[0],
          y - state.position[1],
          z - state.position[2],
        );
        const velocityError = Math.hypot(
          vx - state.velocity[0],
          vy - state.velocity[1],
          vz - state.velocity[2],
        );
        // A 32-bit float carries 24 bits, so each coordinate is rounded by up
        // to 2^-24 = 6e-8 of its size. Allow 2e-7 of the vector's length.
        expect(positionError / radius, `case ${testCase.id} position`).toBeLessThan(2e-7);
        expect(velocityError / speed, `case ${testCase.id} velocity`).toBeLessThan(2e-7);
        worstRelative = Math.max(worstRelative, positionError / radius);
        compared += 1;
      }
    });
    expect(compared).toBeGreaterThan(500);
    expect(worstRelative).toBeGreaterThan(0); // the rounding is real, not hidden
  });

  it('marks an object that cannot be propagated with the zero vector and counts it', () => {
    // Verification case 28872 decays: the reference output ends at 50 minutes
    // and SGP4 reports error 6 (decayed) at 55 minutes.
    const index = records.findIndex((record) => record.noradId === 28872);
    const record = records[index];
    if (record === undefined) {
      throw new Error('fixture');
    }
    const positions = new Float32Array(records.length * 3).fill(7);
    const velocities = new Float32Array(records.length * 3).fill(7);
    const atDecay = epochToUnixMs(record.epochDay, record.epochMicros) + 55 * 60_000;
    const failures = propagateAll(set, atDecay, positions, velocities);
    expect(failures).toBeGreaterThanOrEqual(1);
    expect(Array.from(positions.subarray(index * 3, index * 3 + 3))).toEqual([0, 0, 0]);
    expect(Array.from(velocities.subarray(index * 3, index * 3 + 3))).toEqual([0, 0, 0]);
  });

  it('refuses output arrays of the wrong size', () => {
    expect(() => propagateAll(set, 0, new Float32Array(3), new Float32Array(3))).toThrow(
      RangeError,
    );
  });
});

/**
 * Fixture orbits left out of the interpolation measurement because SGP4 itself
 * stops producing meaningful states for them within one revolution: 28872
 * decays after 50 minutes and 33333 fails after 20 minutes (see the SGP4
 * validation). Interpolating between states that are not valid measures nothing.
 */
const NOT_PROPAGATABLE_FOR_A_FULL_ORBIT = new Set([28872, 33333]);

/**
 * Verification case 23333 is an extreme orbit: eccentricity 0.97, with its
 * far point beyond the Moon's distance. It is reported separately because it
 * behaves differently from every orbit in the real catalog (see below).
 */
const EXTREME_ORBIT = 23333;

describe('Hermite interpolation between keyframes', () => {
  /**
   * Largest distance, in metres, between the interpolated position and a
   * direct SGP4 evaluation: over the chosen fixture orbits, twelve start
   * times around each orbit, and three points within the interval.
   */
  function worstErrorMetres(
    intervalSeconds: number,
    include: (noradId: number) => boolean,
  ): number {
    return worstErrors(intervalSeconds, include).metres;
  }

  /**
   * The same measurement, also reporting the largest error in the speed
   * derived from the interpolated curve, as a fraction of the true speed.
   */
  function worstErrors(
    intervalSeconds: number,
    include: (noradId: number) => boolean,
  ): { metres: number; speedFraction: number } {
    const a = { p: new Float32Array(records.length * 3), v: new Float32Array(records.length * 3) };
    const b = { p: new Float32Array(records.length * 3), v: new Float32Array(records.length * 3) };
    let worst = 0;
    let worstSpeedFraction = 0;
    records.forEach((record, index) => {
      if (NOT_PROPAGATABLE_FOR_A_FULL_ORBIT.has(record.noradId) || !include(record.noradId)) {
        return;
      }
      const satrec = json2satrec(recordToOmm(record));
      const epochMs = epochToUnixMs(record.epochDay, record.epochMicros);
      const periodMinutes = 1440 / record.meanMotion;
      // Twelve start times spread around one orbit, so that the closest
      // approach of each eccentric orbit, where it curves most, is included.
      for (let step = 0; step < 12; step += 1) {
        const startMs = epochMs + (step / 12) * periodMinutes * 60_000;
        propagateAll(set, startMs, a.p, a.v);
        propagateAll(set, startMs + intervalSeconds * 1000, b.p, b.v);
        for (const s of [0.25, 0.5, 0.75]) {
          const exact = sgp4(satrec, (startMs + s * intervalSeconds * 1000 - epochMs) / 60_000);
          if (exact === null) {
            throw new Error(`Case ${String(record.noradId)} could not be propagated`);
          }
          const exactScene = [
            exact.position.x / KM_PER_SCENE_UNIT,
            exact.position.z / KM_PER_SCENE_UNIT,
            -exact.position.y / KM_PER_SCENE_UNIT,
          ];
          const triple = (array: Float32Array): [number, number, number] => [
            array[index * 3] ?? 0,
            array[index * 3 + 1] ?? 0,
            array[index * 3 + 2] ?? 0,
          ];
          const state = interpolateState(
            triple(a.p),
            triple(a.v),
            triple(b.p),
            triple(b.v),
            intervalSeconds,
            s,
          );
          let squared = 0;
          for (let axis = 0; axis < 3; axis += 1) {
            // Math.fround reproduces the graphics card's 32-bit result.
            squared += (Math.fround(state.position[axis] ?? 0) - (exactScene[axis] ?? 0)) ** 2;
          }
          worst = Math.max(worst, Math.sqrt(squared) * KM_PER_SCENE_UNIT * 1000);
          const exactSpeed = Math.hypot(exact.velocity.x, exact.velocity.y, exact.velocity.z);
          worstSpeedFraction = Math.max(
            worstSpeedFraction,
            Math.abs((Math.hypot(...state.velocity) * KM_PER_SCENE_UNIT) / exactSpeed - 1),
          );
        }
      }
    });
    return { metres: worst, speedFraction: worstSpeedFraction };
  }

  /** Eccentricity of each fixture orbit, for telling near-circular orbits from elongated ones. */
  const eccentricityOf = new Map(records.map((record) => [record.noradId, record.eccentricity]));
  const nearCircular = (id: number): boolean => (eccentricityOf.get(id) ?? 1) < 0.25;
  const elongated = (id: number): boolean => !nearCircular(id) && id !== EXTREME_ORBIT;

  // Why the error is not simply "tiny". A cubic through two exact states of a
  // smooth orbit would be accurate to millimetres over 5 seconds. The measured
  // error is metres, and it grows in proportion to the interval, because the
  // velocity SGP4 reports is not exactly the rate of change of the position
  // SGP4 reports: the two differ by roughly 1 to 16 m/s for ordinary orbits.
  // The interpolation inherits that mismatch. It remains far below one pixel.

  it('stays within 15 metres of SGP4 over the 5 second interval the app uses', () => {
    expect(worstErrorMetres(5, (id) => id !== EXTREME_ORBIT)).toBeLessThan(15);
  });

  it('degrades in proportion to the interval: within 100 metres over 60 seconds', () => {
    const worst = worstErrorMetres(60, (id) => id !== EXTREME_ORBIT);
    expect(worst).toBeLessThan(100);
    expect(worst).toBeGreaterThan(15); // longer intervals really are worse
  });

  it('is within 200 metres over 5 seconds even for the extreme orbit beyond the Moon', () => {
    expect(worstErrorMetres(5, (id) => id === EXTREME_ORBIT)).toBeLessThan(200);
  });

  // When the clock runs fast, keyframes are spaced up to 300 seconds apart
  // (see keyframeIntervalMs in src/render/satelliteLayer.ts). Results are in
  // VALIDATION.md, entry V4.1.
  it('at the widest spacing used in fast-forward, stays within 1 km of SGP4', () => {
    const round = worstErrors(300, nearCircular);
    const long = worstErrors(300, elongated);
    recordMeasurement('interpolation at 300 s, eccentricity below 0.25', round);
    recordMeasurement('interpolation at 300 s, eccentricity 0.25 or more', long);
    expect(round.metres).toBeLessThan(1000);
    expect(long.metres).toBeLessThan(1000);
    // Really is worse than the 60 second case above.
    expect(round.metres).toBeGreaterThan(100);
  });

  it('gives the speed to a few parts in a million at the normal spacing, and within 1% at the widest', () => {
    const normal = worstErrors(5, (id) => id !== EXTREME_ORBIT);
    recordMeasurement('interpolation at 5 s, all but the extreme orbit', normal);
    expect(normal.speedFraction).toBeLessThan(1e-5);
    expect(worstErrors(300, nearCircular).speedFraction).toBeLessThan(0.01);
    expect(worstErrors(300, elongated).speedFraction).toBeLessThan(0.01);
  });

  it('passes through both keyframes exactly and matches their velocities', () => {
    expect(hermite(1, 9, 2, -4, 5, 0)).toBe(1);
    expect(hermite(1, 9, 2, -4, 5, 1)).toBe(2);
    const h = 1e-6;
    const slopeAtStart = (hermite(1, 9, 2, -4, 5, h) - hermite(1, 9, 2, -4, 5, 0)) / (h * 5);
    const slopeAtEnd = (hermite(1, 9, 2, -4, 5, 1) - hermite(1, 9, 2, -4, 5, 1 - h)) / (h * 5);
    expect(slopeAtStart).toBeCloseTo(9, 3);
    expect(slopeAtEnd).toBeCloseTo(-4, 3);
  });

  it('gives the same curve when the two keyframes are named in the opposite order', () => {
    // Forward: from (p=1, v=9) to (p=2, v=-4) over +5 s. Backward: the same
    // two keyframes swapped, over -5 s. The renderer relies on this.
    for (const s of [0, 0.2, 0.5, 0.9, 1]) {
      expect(hermite(2, -4, 1, 9, -5, 1 - s)).toBeCloseTo(hermite(1, 9, 2, -4, 5, s), 12);
    }
  });

  it('reproduces uniform motion exactly', () => {
    // Constant velocity 3 units/s for 4 s: position 10 -> 22.
    for (const s of [0, 0.3, 0.5, 1]) {
      expect(hermite(10, 3, 22, 3, 4, s)).toBeCloseTo(10 + 12 * s, 12);
      expect(hermiteVelocity(10, 3, 22, 3, 4, s)).toBeCloseTo(3, 12);
    }
  });

  it('has a velocity that is the slope of the position curve', () => {
    const h = 1e-6;
    for (const s of [0, 0.1, 0.5, 0.8, 1 - h]) {
      const slope = (hermite(1, 9, 2, -4, 5, s + h) - hermite(1, 9, 2, -4, 5, s)) / (h * 5);
      expect(hermiteVelocity(1, 9, 2, -4, 5, s)).toBeCloseTo(slope, 4);
    }
    // At the keyframes it is exactly the keyframe velocity.
    expect(hermiteVelocity(1, 9, 2, -4, 5, 0)).toBe(9);
    expect(hermiteVelocity(1, 9, 2, -4, 5, 1)).toBe(-4);
  });
});
