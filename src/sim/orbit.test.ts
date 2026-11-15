import { constants } from 'satellite.js';
import { describe, expect, it } from 'vitest';
import { airDensity } from './atmosphere';
import { seededRandom } from './breakupModel';
import { averagedDragRates, elementsAt, followDecay, perigeeHeightKm } from './decay';
import {
  circularStateAtLatitude,
  cross,
  dot,
  EARTH_RADIUS_KM,
  elementsFromState,
  J2,
  MU_KM3_S2,
  norm,
  rotateAbout,
  secularRates,
  solveKepler,
  stateFromElements,
  type Elements,
} from './orbit';

const DEG = Math.PI / 180;

describe('constants', () => {
  it('are the ones SGP4 uses', () => {
    expect(MU_KM3_S2).toBe(constants.mu);
    expect(EARTH_RADIUS_KM).toBe(constants.earthRadius);
    expect(J2).toBe(constants.j2);
  });
});

describe('solveKepler', () => {
  it("satisfies Kepler's equation for small and large eccentricities", () => {
    for (const e of [0, 0.001, 0.3, 0.9]) {
      for (let m = -3; m <= 3; m += 0.37) {
        const big = solveKepler(m, e);
        expect(big - e * Math.sin(big)).toBeCloseTo(m, 11);
      }
    }
  });
});

describe('elements and state', () => {
  it('convert there and back for 300 random orbits', () => {
    const random = seededRandom(123);
    for (let k = 0; k < 300; k += 1) {
      const el: Elements = {
        a: 6600 + 30_000 * random(),
        e: 0.7 * random(),
        i: Math.PI * random(),
        raan: 2 * Math.PI * random() - Math.PI,
        argp: 2 * Math.PI * random() - Math.PI,
        m: 2 * Math.PI * random() - Math.PI,
      };
      const { r, v } = stateFromElements(el);
      const back = stateFromElements(elementsFromState(r, v));
      expect(norm([back.r[0] - r[0], back.r[1] - r[1], back.r[2] - r[2]])).toBeLessThan(1e-6);
      expect(norm([back.v[0] - v[0], back.v[1] - v[1], back.v[2] - v[2]])).toBeLessThan(1e-9);
      const found = elementsFromState(r, v);
      expect(found.a).toBeCloseTo(el.a, 5);
      expect(found.e).toBeCloseTo(el.e, 9);
      expect(found.i).toBeCloseTo(el.i, 9);
    }
  });

  it('copes with circular and equatorial orbits', () => {
    for (const el of [
      { a: 7000, e: 0, i: 1, raan: 0.5, argp: 0, m: 2 },
      { a: 7000, e: 0.1, i: 0, raan: 0, argp: 1, m: 2 },
      { a: 42_164, e: 0, i: 0, raan: 0, argp: 0, m: -1 },
    ]) {
      const { r, v } = stateFromElements(el);
      const back = stateFromElements(elementsFromState(r, v));
      expect(norm([back.r[0] - r[0], back.r[1] - r[1], back.r[2] - r[2]])).toBeLessThan(1e-6);
    }
  });

  it('reports an eccentricity of 1 or more for a path that escapes', () => {
    const { r, v } = stateFromElements({ a: 7000, e: 0, i: 1, raan: 0, argp: 0, m: 0 });
    expect(elementsFromState(r, [v[0] * 1.5, v[1] * 1.5, v[2] * 1.5]).e).toBeGreaterThan(1);
  });
});

describe('rotateAbout and circularStateAtLatitude', () => {
  it('turns a vector about an axis and keeps its length', () => {
    const turned = rotateAbout([1, 0, 0], [0, 0, 1], Math.PI / 2);
    expect(turned[0]).toBeCloseTo(0, 12);
    expect(turned[1]).toBeCloseTo(1, 12);
    expect(norm(rotateAbout([1, 2, 3], [0, 1, 0], 1.234))).toBeCloseTo(norm([1, 2, 3]), 12);
  });

  it('builds a circular orbit with the inclination, height and latitude asked for', () => {
    for (const northbound of [true, false]) {
      const { r, v } = circularStateAtLatitude(789, 86.4 * DEG, 72.5 * DEG, northbound);
      const el = elementsFromState(r, v);
      expect(el.i / DEG).toBeCloseTo(86.4, 9);
      expect(el.e).toBeLessThan(1e-12);
      expect(el.a - EARTH_RADIUS_KM).toBeCloseTo(789, 6);
      expect(Math.asin(r[2] / norm(r)) / DEG).toBeCloseTo(72.5, 9);
      expect(Math.sign(v[2])).toBe(northbound ? 1 : -1);
      expect(dot(r, v)).toBeCloseTo(0, 6);
      expect(norm(cross(r, v))).toBeGreaterThan(0);
    }
  });
});

describe('secularRates', () => {
  it('turns the node westward for a prograde orbit, eastward for a retrograde one, not at all for a polar one', () => {
    expect(secularRates(7000, 0.001, 51.6 * DEG).raanDot).toBeLessThan(0);
    expect(secularRates(7000, 0.001, 98 * DEG).raanDot).toBeGreaterThan(0);
    expect(Math.abs(secularRates(7000, 0.001, 90 * DEG).raanDot)).toBeLessThan(1e-20);
  });

  it('leaves the perigee still at the critical inclination of 63.43 degrees', () => {
    const critical = Math.acos(Math.sqrt(1 / 5));
    expect(critical / DEG).toBeCloseTo(63.43, 2);
    expect(Math.abs(secularRates(26_600, 0.7, critical).argpDot)).toBeLessThan(1e-18);
  });
});

describe('air density', () => {
  it('reproduces the table at its base heights and falls with height', () => {
    expect(airDensity(0)).toBe(1.225);
    expect(airDensity(400)).toBeCloseTo(3.725e-12, 20);
    expect(airDensity(1000)).toBeCloseTo(3.019e-15, 22);
    let previous = airDensity(100);
    for (let h = 105; h <= 1500; h += 5) {
      const current = airDensity(h);
      // The table's bands do not join exactly; allow for the small steps between them.
      expect(current).toBeLessThan(previous * 1.03);
      previous = current;
    }
  });
});

describe('drag', () => {
  it('shrinks the orbit, and rounds an eccentric one', () => {
    const rates = averagedDragRates(6778, 0.02, 0.05, 1);
    expect(rates.aDot).toBeLessThan(0);
    expect(rates.eDot).toBeLessThan(0);
  });

  it('is in proportion to the area-to-mass ratio and to the density factor', () => {
    const base = averagedDragRates(6878, 0.01, 0.01, 1);
    expect(averagedDragRates(6878, 0.01, 0.02, 1).aDot).toBeCloseTo(2 * base.aDot, 15);
    expect(averagedDragRates(6878, 0.01, 0.01, 3).aDot).toBeCloseTo(3 * base.aDot, 15);
  });

  it('brings a low fragment down within years and leaves a high one up for a century', () => {
    const low = followDecay(
      { a: EARTH_RADIUS_KM + 400, e: 0.001, i: 1, raan: 0, argp: 0, m: 0 },
      0.2,
      1,
      100,
    );
    expect(low.reentryYears).not.toBeNull();
    expect(low.reentryYears ?? 0).toBeLessThan(3);
    const last = low.a.length - 1;
    expect(perigeeHeightKm(low.a[last] ?? 0, low.e[last] ?? 0)).toBeLessThan(120);
    const high = followDecay(
      { a: EARTH_RADIUS_KM + 1200, e: 0.001, i: 1, raan: 0, argp: 0, m: 0 },
      0.2,
      1,
      100,
    );
    expect(high.reentryYears).toBeNull();
    expect(high.years[high.years.length - 1]).toBeCloseTo(100, 9);
  });

  it('counts a fragment that starts below the re-entry height as down at once', () => {
    const history = followDecay(
      { a: EARTH_RADIUS_KM + 300, e: 0.05, i: 1, raan: 0, argp: 0, m: 0 },
      0.1,
      1,
      100,
    );
    expect(history.reentryYears).toBe(0);
  });

  it('interpolates the recorded history', () => {
    const start = { a: EARTH_RADIUS_KM + 800, e: 0.01, i: 1.2, raan: 0.3, argp: 0.4, m: 0.5 };
    const history = followDecay(start, 0.05, 1, 100);
    expect(elementsAt(history, start.i, 0)).toEqual(start);
    const later = elementsAt(history, start.i, 50);
    expect(later.a).toBeLessThan(start.a);
    expect(later.a).toBeGreaterThan(EARTH_RADIUS_KM);
    // The node has been carried round many times by J2.
    expect(Math.abs(later.raan - start.raan)).toBeGreaterThan(2 * Math.PI);
  });
});
