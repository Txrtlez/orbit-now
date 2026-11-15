/**
 * Validation of the figures shown for a selected object's orbit (period,
 * highest and lowest altitude) and of the path drawn for it.
 *
 * Results are recorded in VALIDATION.md, entry V3.6.
 */
import { constants } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { parseOmmCsv } from '../../pipeline/omm';
import { epochToUnixMs, type CatalogRecord } from '../../src/catalog/format';
import { KM_PER_SCENE_UNIT } from '../../src/geo/sceneFrame';
import {
  buildPropagationSet,
  propagateAll,
  sampleOrbitPath,
  summariseOrbits,
} from '../../src/orbit/propagate';
import { verificationSetAsOmmCsv } from '../pipeline/fixtureCsv';
import { recordMeasurement } from './measurements';
import { loadVerificationCases } from './valladoFixtures';

const records: CatalogRecord[] = parseOmmCsv(
  verificationSetAsOmmCsv(),
  Date.UTC(2026, 10, 14),
).elementSets.map((elementSet) => ({ ...elementSet, sourceMask: 1 }));
const set = buildPropagationSet(records);
const summary = summariseOrbits(set);
const cases = loadVerificationCases();

/**
 * The verification set was chosen to stress SGP4, so several of its orbits
 * are not ones a description such as "period" or "highest altitude" can
 * sensibly apply to. They are left out of the comparisons below:
 */
/** Deliberately unphysical: eccentricity 0.995 with a low point far below the ground. */
const UNPHYSICAL = new Set([33333]);
/** In the act of re-entering: drag changes the orbit visibly within a day, and SGP4 stops within the reference span. */
const DECAYING = new Set([22312, 28350, 28872, 29141]);
/** Eccentricity 0.97 with a far point beyond the Moon's distance; SGP4 cannot run it half a revolution backwards. */
const EXTREME = new Set([23333]);
const NOT_DESCRIBABLE = new Set([...UNPHYSICAL, ...DECAYING, ...EXTREME]);

describe('summariseOrbits', () => {
  it("agrees with Kepler's third law to the size of the documented Kozai correction", () => {
    let worstRelative = 0;
    records.forEach((record, index) => {
      if (UNPHYSICAL.has(record.noradId)) {
        return;
      }
      // Kepler's third law with the published mean motion and SGP4's own
      // gravitational parameter: a^3 n^2 = mu.
      const meanMotionRadPerSec = (record.meanMotion * 2 * Math.PI) / 86_400;
      const keplerAKm = Math.cbrt(constants.mu / (meanMotionRadPerSec * meanMotionRadPerSec));
      const keplerPeriodMin = 1440 / record.meanMotion;
      const apogee = summary.apogeeKm[index] ?? 0;
      const perigee = summary.perigeeKm[index] ?? 0;
      const sgp4AKm = (apogee + perigee) / 2 + constants.earthRadius;
      worstRelative = Math.max(
        worstRelative,
        Math.abs(sgp4AKm / keplerAKm - 1),
        Math.abs((summary.periodMinutes[index] ?? 0) / keplerPeriodMin - 1),
      );
      // The two altitudes must describe the published eccentricity.
      const eccentricity = (apogee - perigee) / (2 * sgp4AKm);
      expect(eccentricity).toBeCloseTo(record.eccentricity, 5);
    });
    // The conversion SGP4 applies to the mean motion is of the order of the
    // Earth's oblateness coefficient J2 (about 0.001).
    recordMeasurement('kepler comparison', { worstRelative });
    expect(worstRelative).toBeGreaterThan(1e-4);
    expect(worstRelative).toBeLessThan(1e-3);
  });

  it('brackets the distances in the published reference states', () => {
    let compared = 0;
    let worstOutsideKm = 0;
    records.forEach((record, index) => {
      if (NOT_DESCRIBABLE.has(record.noradId)) {
        return;
      }
      const testCase = cases.find((candidate) => Number(candidate.id) === record.noradId);
      if (testCase === undefined) {
        throw new Error(`No reference case for ${String(record.noradId)}`);
      }
      const lowest = (summary.perigeeKm[index] ?? 0) + constants.earthRadius;
      const highest = (summary.apogeeKm[index] ?? 0) + constants.earthRadius;
      for (const state of testCase.states) {
        // Only the first day: the summary describes the orbit at its epoch.
        if (Math.abs(state.tsinceMin) > 1440) {
          continue;
        }
        const radius = Math.hypot(...state.position);
        worstOutsideKm = Math.max(worstOutsideKm, lowest - radius, radius - highest);
        compared += 1;
      }
    });
    expect(compared).toBeGreaterThan(200);
    // The true distance wanders outside the mean orbit's range by a few
    // kilometres, mostly because of the Earth's bulge. The summary is a
    // description of the orbit, not a bound on the distance.
    recordMeasurement('distance outside the summarised range', { worstOutsideKm, compared });
    expect(worstOutsideKm).toBeGreaterThan(0);
    expect(worstOutsideKm).toBeLessThan(15);
  });
});

describe('sampleOrbitPath', () => {
  const SEGMENTS = 256;

  it('passes through the object and nearly closes on itself', () => {
    const positions = new Float32Array(records.length * 3);
    const velocities = new Float32Array(records.length * 3);
    let checked = 0;
    let worstMiddleKm = 0;
    let worstGapFraction = 0;
    let worstSegmentFraction = 0;

    records.forEach((record, index) => {
      if (NOT_DESCRIBABLE.has(record.noradId)) {
        return;
      }
      // An hour after the epoch, so that "now" is not a special instant.
      const nowMs = epochToUnixMs(record.epochDay, record.epochMicros) + 3_600_000;
      const path = sampleOrbitPath(set, index, nowMs, SEGMENTS);
      expect(path).toHaveLength((SEGMENTS + 1) * 3);
      propagateAll(set, nowMs, positions, velocities);

      const point = (k: number): [number, number, number] => [
        (path[k * 3] ?? 0) * KM_PER_SCENE_UNIT,
        (path[k * 3 + 1] ?? 0) * KM_PER_SCENE_UNIT,
        (path[k * 3 + 2] ?? 0) * KM_PER_SCENE_UNIT,
      ];
      const distance = (a: readonly number[], b: readonly number[]): number =>
        Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0));

      // The middle sample is the object's own position right now.
      const here = [
        (positions[index * 3] ?? 0) * KM_PER_SCENE_UNIT,
        (positions[index * 3 + 1] ?? 0) * KM_PER_SCENE_UNIT,
        (positions[index * 3 + 2] ?? 0) * KM_PER_SCENE_UNIT,
      ];
      worstMiddleKm = Math.max(worstMiddleKm, distance(point(SEGMENTS / 2), here));

      // Size of the orbit, for expressing the other checks as fractions.
      const semiMajorKm =
        ((summary.apogeeKm[index] ?? 0) + (summary.perigeeKm[index] ?? 0)) / 2 +
        constants.earthRadius;
      worstGapFraction = Math.max(
        worstGapFraction,
        distance(point(0), point(SEGMENTS)) / semiMajorKm,
      );
      for (let k = 1; k <= SEGMENTS; k += 1) {
        worstSegmentFraction = Math.max(
          worstSegmentFraction,
          distance(point(k - 1), point(k)) / semiMajorKm,
        );
      }
      checked += 1;
    });

    expect(checked).toBe(records.length - NOT_DESCRIBABLE.size);
    // Limited by 32-bit rounding of scene coordinates (see V3.2).
    expect(worstMiddleKm).toBeLessThan(0.05);
    // One revolution later an orbit has turned slightly: the ends miss by well under 2% of its size.
    expect(worstGapFraction).toBeLessThan(0.02);
    // With exactly equal steps of eccentric anomaly no segment could exceed
    // 2 pi / 256 = 0.0245 of the semi-major axis. The sample times assume a
    // steadily advancing mean anomaly, which is slightly off for eccentric
    // high orbits disturbed by the Sun and Moon, so some segments are longer.
    expect(worstSegmentFraction).toBeLessThan(0.04);
    recordMeasurement('orbit path', { worstMiddleKm, worstGapFraction, worstSegmentFraction });
  });

  it('returns nothing, instead of a partial path, for an object that decays within the revolution', () => {
    const index = records.findIndex((record) => record.noradId === 28872);
    expect(index).toBeGreaterThanOrEqual(0);
    const record = records[index];
    if (record === undefined) {
      throw new Error('fixture missing');
    }
    // Case 28872 stops propagating about 50 minutes after its epoch.
    const path = sampleOrbitPath(
      set,
      index,
      epochToUnixMs(record.epochDay, record.epochMicros) + 40 * 60_000,
      SEGMENTS,
    );
    expect(path).toHaveLength(0);
  });

  it('refuses an index that is not in the set', () => {
    expect(() => sampleOrbitPath(set, records.length, 0, SEGMENTS)).toThrow(RangeError);
  });
});
