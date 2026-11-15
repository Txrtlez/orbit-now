import { airDensity } from './atmosphere';
import { EARTH_RADIUS_KM, MU_KM3_S2, secularRates, type Elements } from './orbit';

/**
 * How an orbit shrinks under air drag over months to a century, and how it
 * turns under J2 meanwhile.
 *
 * STANDARD MODEL with stated SIMPLIFICATIONS. Drag acts against the
 * velocity with acceleration (1/2) rho (Cd A/m) v^2. Its effect on the
 * orbit's size and shape is averaged over one revolution (the method of
 * averaging, as in King-Hele's theory of drag), which lets the simulator
 * take steps of days or years instead of seconds. The average is done by
 * numerical quadrature, not by King-Hele's series, so it holds for any
 * eccentricity. Simplifications: the air does not turn with the Earth, the
 * Earth is a sphere for the purpose of height, the density is the
 * exponential table, and the elements a fragment starts with are used as if
 * they were mean elements. The averaged rates are checked against a
 * step-by-step integration in VALIDATION.md, V6.3.
 */

/** Drag coefficient. 2.2 is the conventional value for a satellite of unknown shape; from memory, not a measurement. */
export const DRAG_COEFFICIENT = 2.2;
/** A fragment whose lowest point is below this height is counted as having re-entered. A convention. */
export const REENTRY_HEIGHT_KM = 120;
/** Points round the orbit at which drag is sampled for the average. */
const QUADRATURE_POINTS = 32;
const SECONDS_PER_YEAR = 365.25 * 86_400;

/**
 * Average rates of change of the semi-major axis (km/s) and eccentricity
 * (1/s) under drag.
 *
 * At each point: da/dt = -rho B v^3 a^2 / mu and de/dt = -rho B v (e + cos nu),
 * with B = Cd A/m. The time average over a revolution is the average over
 * eccentric anomaly E weighted by (1 - e cos E).
 *
 * @param ballistic Cd A/m in m^2/kg
 * @param densityFactor multiplier on the air density (the solar setting)
 */
export function averagedDragRates(
  a: number,
  e: number,
  ballistic: number,
  densityFactor: number,
): { aDot: number; eDot: number } {
  let aDot = 0;
  let eDot = 0;
  for (let k = 0; k < QUADRATURE_POINTS; k += 1) {
    const big = ((k + 0.5) * 2 * Math.PI) / QUADRATURE_POINTS;
    const cosE = Math.cos(big);
    const shape = 1 - e * cosE;
    const radius = a * shape;
    const speed = Math.sqrt(MU_KM3_S2 * (2 / radius - 1 / a));
    // kg/m^3 times m^2/kg is 1/m; times 1000 gives 1/km.
    const perKm = airDensity(radius - EARTH_RADIUS_KM) * densityFactor * ballistic * 1000;
    const cosNu = (cosE - e) / shape;
    aDot -= ((perKm * speed ** 3 * a * a) / MU_KM3_S2) * shape;
    eDot -= perKm * speed * (e + cosNu) * shape;
  }
  return { aDot: aDot / QUADRATURE_POINTS, eDot: eDot / QUADRATURE_POINTS };
}

/** One fragment's orbit through time: values at a series of instants, to be joined by straight lines. */
export interface OrbitHistory {
  /** Years since the break-up at each instant. */
  readonly years: number[];
  readonly a: number[];
  readonly e: number[];
  /** The three angles, not wrapped to a circle, so that they can be interpolated. */
  readonly raan: number[];
  readonly argp: number[];
  readonly m: number[];
  /** Years after the break-up at which the fragment re-entered, or null if it was still up at the end. */
  readonly reentryYears: number | null;
}

export function perigeeHeightKm(a: number, e: number): number {
  return a * (1 - e) - EARTH_RADIUS_KM;
}

/**
 * Follow one fragment until it re-enters or `horizonYears` have passed.
 *
 * The step is adaptive: short enough that drag changes the orbit's size by
 * only a small part of the remaining height, and never longer than two
 * years, so that the slow turning of the orbit is recorded too.
 */
export function followDecay(
  start: Elements,
  ballistic: number,
  densityFactor: number,
  horizonYears: number,
): OrbitHistory {
  const history: OrbitHistory & { reentryYears: number | null } = {
    years: [0],
    a: [start.a],
    e: [start.e],
    raan: [start.raan],
    argp: [start.argp],
    m: [start.m],
    reentryYears: null,
  };
  let { a, e, raan, argp, m } = start;
  let t = 0;
  const horizon = horizonYears * SECONDS_PER_YEAR;
  if (perigeeHeightKm(a, e) < REENTRY_HEIGHT_KM) {
    return { ...history, reentryYears: 0 };
  }
  for (let step = 0; step < 20_000 && t < horizon; step += 1) {
    const first = averagedDragRates(a, e, ballistic, densityFactor);
    const margin = perigeeHeightKm(a, e) - 100;
    const target = Math.min(10, Math.max(0.2, 0.05 * margin));
    let dt = Math.min(2 * SECONDS_PER_YEAR, target / Math.max(1e-30, -first.aDot));
    dt = Math.min(dt, horizon - t);
    // Midpoint rule: rates at the middle of the step, from a half step with the first rates.
    const aMid = a + 0.5 * dt * first.aDot;
    const eMid = Math.max(0, e + 0.5 * dt * first.eDot);
    const mid = averagedDragRates(aMid, eMid, ballistic, densityFactor);
    const turn = secularRates(aMid, eMid, start.i);
    a += dt * mid.aDot;
    e = Math.max(0, e + dt * mid.eDot);
    raan += dt * turn.raanDot;
    argp += dt * turn.argpDot;
    m += dt * turn.mDot;
    t += dt;
    history.years.push(t / SECONDS_PER_YEAR);
    history.a.push(a);
    history.e.push(e);
    history.raan.push(raan);
    history.argp.push(argp);
    history.m.push(m);
    if (perigeeHeightKm(a, e) < REENTRY_HEIGHT_KM) {
      return { ...history, reentryYears: t / SECONDS_PER_YEAR };
    }
  }
  return history;
}

/** The elements of a fragment at a time, by joining the recorded instants with straight lines. */
export function elementsAt(history: OrbitHistory, inclination: number, years: number): Elements {
  const times = history.years;
  let hi = 1;
  while (hi < times.length - 1 && (times[hi] ?? 0) < years) {
    hi += 1;
  }
  const lo = hi - 1;
  const t0 = times[lo] ?? 0;
  const t1 = times[hi] ?? t0;
  const f = t1 > t0 ? Math.min(1, Math.max(0, (years - t0) / (t1 - t0))) : 0;
  const mix = (values: readonly number[]): number => {
    const v0 = values[lo] ?? 0;
    return v0 + ((values[hi] ?? v0) - v0) * f;
  };
  return {
    a: mix(history.a),
    e: mix(history.e),
    i: inclination,
    raan: mix(history.raan),
    argp: mix(history.argp),
    m: mix(history.m),
  };
}
