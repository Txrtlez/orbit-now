/**
 * Launch gate 4: J2 propagation matches the analytic secular nodal
 * precession rate. Also: the averaged drag theory against step-by-step
 * integration, and the geometry of a collision against a speed NASA gives.
 *
 * The simulator moves fragments with the analytic secular rates, because a
 * century of several thousand fragments cannot be integrated step by step
 * in a browser. The gate is therefore run the other way round from how it
 * reads: the equations of motion with J2 are integrated numerically, with
 * no formula for the node in them, and the drift of the node that comes out
 * is compared with the analytic rate the simulator uses.
 *
 * Results are recorded in VALIDATION.md, entries V6.2 and V6.3.
 */
import { describe, expect, it } from 'vitest';
import { averagedDragRates } from '../../src/sim/decay';
import { integrate } from '../../src/sim/numeric';
import {
  circularStateAtLatitude,
  EARTH_RADIUS_KM,
  elementsFromState,
  MU_KM3_S2,
  norm,
  secularRates,
  stateFromElements,
  type Elements,
} from '../../src/sim/orbit';
import { recordMeasurement } from './measurements';

const DEG = Math.PI / 180;
const DAY = 86_400;

/** Slope of a straight line fitted by least squares. */
function slope(t: readonly number[], y: readonly number[]): number {
  const n = t.length;
  const tMean = t.reduce((sum, value) => sum + value, 0) / n;
  const yMean = y.reduce((sum, value) => sum + value, 0) / n;
  let top = 0;
  let bottom = 0;
  for (let k = 0; k < n; k += 1) {
    top += ((t[k] ?? 0) - tMean) * ((y[k] ?? 0) - yMean);
    bottom += ((t[k] ?? 0) - tMean) ** 2;
  }
  return top / bottom;
}

/** Follow an angle through many turns without the jumps at plus and minus pi. */
function unwrap(angles: readonly number[]): number[] {
  const out: number[] = [];
  let offset = 0;
  angles.forEach((angle, k) => {
    const previous = angles[k - 1];
    if (previous !== undefined) {
      if (angle - previous > Math.PI) {
        offset -= 2 * Math.PI;
      } else if (angle - previous < -Math.PI) {
        offset += 2 * Math.PI;
      }
    }
    out.push(angle + offset);
  });
  return out;
}

/**
 * Integrate an orbit under gravity with J2 for some days and measure how
 * fast its node and perigee actually turn, with the averages of its
 * elements over that time.
 */
function measureTurning(
  start: Elements,
  days: number,
): {
  raanDot: number;
  argpDot: number;
  mean: { a: number; e: number; i: number };
} {
  const { r, v } = stateFromElements(start);
  const t: number[] = [];
  const raan: number[] = [];
  const argp: number[] = [];
  let a = 0;
  let e = 0;
  let i = 0;
  integrate(r, v, days * DAY, 10, { j2: true }, (time, position, velocity) => {
    if (Math.round(time) % 60 !== 0) {
      return;
    }
    const el = elementsFromState(position, velocity);
    t.push(time);
    raan.push(el.raan);
    argp.push(el.argp);
    a += el.a;
    e += el.e;
    i += el.i;
  });
  const n = t.length;
  return {
    raanDot: slope(t, unwrap(raan)),
    argpDot: slope(t, unwrap(argp)),
    mean: { a: a / n, e: e / n, i: i / n },
  };
}

describe('launch gate 4: the node turns at the analytic secular rate', () => {
  const cases = [
    { name: 'Fengyun-1C-like, 860 km, 98.65 deg', a: EARTH_RADIUS_KM + 860, e: 0.0014, i: 98.65 },
    { name: 'station-like, 420 km, 51.6 deg', a: EARTH_RADIUS_KM + 420, e: 0.001, i: 51.6 },
    { name: 'Cosmos 2251-like, 789 km, 74.0 deg', a: EARTH_RADIUS_KM + 789, e: 0.0016, i: 74.0 },
    { name: 'Cosmos 1408-like, 480 km, 82.56 deg', a: EARTH_RADIUS_KM + 480, e: 0.0018, i: 82.56 },
    { name: 'eccentric, 8,000 km semi-major axis, e 0.1, 30 deg', a: 8000, e: 0.1, i: 30 },
  ];

  for (const { name, a, e, i } of cases) {
    it(name, () => {
      const measured = measureTurning({ a, e, i: i * DEG, raan: 1, argp: 0.5, m: 0.2 }, 5);
      const analytic = secularRates(measured.mean.a, measured.mean.e, measured.mean.i);
      const perDay = (rate: number): number => Number(((rate / DEG) * DAY).toFixed(5));
      const error = Math.abs(measured.raanDot / analytic.raanDot - 1);
      recordMeasurement(`V6.2 node, ${name}`, {
        integratedDegPerDay: perDay(measured.raanDot),
        analyticDegPerDay: perDay(analytic.raanDot),
        differencePercent: Number((error * 100).toFixed(3)),
      });
      // First-order theory neglects terms of order J2, about 0.1%.
      expect(error).toBeLessThan(0.005);
    });
  }

  it('the perigee of an eccentric orbit turns at the analytic rate too', () => {
    const measured = measureTurning(
      { a: 8000, e: 0.1, i: 30 * DEG, raan: 1, argp: 0.5, m: 0.2 },
      5,
    );
    const analytic = secularRates(measured.mean.a, measured.mean.e, measured.mean.i);
    const error = Math.abs(measured.argpDot / analytic.argpDot - 1);
    recordMeasurement('V6.2 perigee, eccentric orbit', {
      integratedDegPerDay: Number(((measured.argpDot / DEG) * DAY).toFixed(5)),
      analyticDegPerDay: Number(((analytic.argpDot / DEG) * DAY).toFixed(5)),
      differencePercent: Number((error * 100).toFixed(3)),
    });
    expect(error).toBeLessThan(0.01);
  });

  it('gives a Sun-synchronous rate for an orbit known to be Sun-synchronous', () => {
    // Fengyun-1C was a Sun-synchronous weather satellite: its node should turn
    // once a year, 360 degrees in 365.2422 days.
    const rate =
      (secularRates(EARTH_RADIUS_KM + 852.5, 0.00135, 98.6464 * DEG).raanDot / DEG) * DAY;
    recordMeasurement('V6.2 node of the Fengyun-1C orbit', {
      analyticDegPerDay: Number(rate.toFixed(4)),
      sunSynchronousDegPerDay: Number((360 / 365.2422).toFixed(4)),
    });
    expect(rate).toBeGreaterThan(0.93);
    expect(rate).toBeLessThan(1.04);
  });
});

describe('the averaged drag theory against step-by-step integration', () => {
  const cases = [
    { name: 'near-circular at 400 km', a: EARTH_RADIUS_KM + 400, e: 0.001, areaToMass: 0.05 },
    {
      name: 'eccentric, 350 by 900 km',
      a: EARTH_RADIUS_KM + 625,
      e: 275 / (EARTH_RADIUS_KM + 625),
      areaToMass: 0.1,
    },
    { name: 'near-circular at 800 km', a: EARTH_RADIUS_KM + 800, e: 0.002, areaToMass: 1 },
  ];
  for (const { name, a, e, areaToMass } of cases) {
    it(name, () => {
      const ballistic = 2.2 * areaToMass;
      const start = stateFromElements({ a, e, i: 1.2, raan: 0, argp: 0, m: 0 });
      // Without J2, so that the orbit's size changes through drag alone.
      const seconds = 2 * DAY;
      const end = integrate(start.r, start.v, seconds, 5, { j2: false, ballistic });
      const after = elementsFromState(end.r, end.v);
      const rates = averagedDragRates(a, e, ballistic, 1);
      const integrated = after.a - a;
      const predicted = rates.aDot * seconds;
      recordMeasurement(`V6.3 fall in semi-major axis over two days, ${name}`, {
        integratedKm: Number(integrated.toFixed(4)),
        averagedTheoryKm: Number(predicted.toFixed(4)),
        differencePercent: Number(((predicted / integrated - 1) * 100).toFixed(2)),
        integratedChangeInE: Number((after.e - e).toExponential(3)),
        theoryChangeInE: Number((rates.eDot * seconds).toExponential(3)),
      });
      expect(integrated).toBeLessThan(0);
      // The theory uses the rate at the start; over two days the orbit has
      // sunk a little into thicker air, so the integration falls slightly further.
      expect(Math.abs(predicted / integrated - 1)).toBeLessThan(0.05);
    });
  }
});

describe('the geometry of the 2009 collision', () => {
  it('gives the relative speed NASA reported, from the two inclinations and the latitude', () => {
    // 788.6 km up at 72.5 N (NASA, History of On-orbit Satellite
    // Fragmentations, 16th ed., pp. 404 and 440), inclinations 86.40 and
    // 74.04 degrees. One satellite must have been going north and the other south.
    const iridium = circularStateAtLatitude(788.6, 86.3996 * DEG, 72.5 * DEG, true);
    const cosmos = circularStateAtLatitude(788.6, 74.0355 * DEG, 72.5 * DEG, false);
    const speed = norm([
      iridium.v[0] - cosmos.v[0],
      iridium.v[1] - cosmos.v[1],
      iridium.v[2] - cosmos.v[2],
    ]);
    const circular = Math.sqrt(MU_KM3_S2 / (EARTH_RADIUS_KM + 788.6));
    recordMeasurement('V6.2 relative speed of Iridium 33 and Cosmos 2251', {
      computedKmS: Number(speed.toFixed(2)),
      nasaKmS: 11.6,
      orbitalSpeedKmS: Number(circular.toFixed(3)),
    });
    expect(speed).toBeGreaterThan(11.3);
    expect(speed).toBeLessThan(11.9);
  });
});
