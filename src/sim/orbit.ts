/**
 * Orbits for the "What if?" simulator: constants, conversion between
 * position-and-velocity and orbital elements, and the slow turning of an
 * orbit caused by the Earth's flattening.
 *
 * STANDARD MODEL throughout: two-body motion, and the first-order secular
 * effect of the J2 term of the Earth's gravity field. The formulas are the
 * textbook ones (for example Vallado, "Fundamentals of Astrodynamics and
 * Applications", sections 2.2, 2.5 and 9.6). They were written from memory
 * and then tested: the conversions against each other, and the J2 rates
 * against a direct numerical integration of the equations of motion
 * (VALIDATION.md, V6.2, launch gate 4).
 *
 * Lengths are in kilometres, times in seconds, angles in radians.
 */

/**
 * The constants SGP4 uses (WGS 72), so that the simulator and the tracker
 * agree about the Earth. A test checks them against satellite.js.
 */
export const MU_KM3_S2 = 398_600.8;
export const EARTH_RADIUS_KM = 6378.135;
export const J2 = 0.001082616;

export type Vec3 = readonly [number, number, number];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Turn `v` about the unit vector `axis` by `angle` (Rodrigues' formula). */
export function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

export interface Elements {
  /** Semi-major axis, km. */
  readonly a: number;
  /** Eccentricity. */
  readonly e: number;
  /** Inclination. */
  readonly i: number;
  /** Right ascension of the ascending node. */
  readonly raan: number;
  /** Argument of perigee. */
  readonly argp: number;
  /** Mean anomaly. */
  readonly m: number;
}

/** Solve Kepler's equation M = E - e sin E for the eccentric anomaly E (Newton's method). */
export function solveKepler(meanAnomaly: number, e: number): number {
  let big = meanAnomaly + e * Math.sin(meanAnomaly);
  for (let k = 0; k < 12; k += 1) {
    const step = (big - e * Math.sin(big) - meanAnomaly) / (1 - e * Math.cos(big));
    big -= step;
    if (Math.abs(step) < 1e-13) {
      break;
    }
  }
  return big;
}

/**
 * Orbital elements from a position (km) and velocity (km/s).
 *
 * For a circular orbit the perigee is undefined and for an equatorial one
 * the node is; in those cases the missing direction is taken along the node
 * or the x axis respectively, which still reproduces the position.
 * Returns an eccentricity of 1 or more for a path that does not come back.
 */
export function elementsFromState(r: Vec3, v: Vec3): Elements {
  const radius = norm(r);
  const h = cross(r, v);
  const hHat = scale(h, 1 / norm(h));
  const eVec = add(scale(cross(v, h), 1 / MU_KM3_S2), scale(r, -1 / radius));
  const e = norm(eVec);
  const a = 1 / (2 / radius - dot(v, v) / MU_KM3_S2);
  const i = Math.acos(Math.min(1, Math.max(-1, hHat[2])));
  const nodeLength = Math.hypot(h[0], h[1]);
  const nodeHat: Vec3 =
    nodeLength < 1e-10 * norm(h) ? [1, 0, 0] : [-h[1] / nodeLength, h[0] / nodeLength, 0];
  const raan = Math.atan2(nodeHat[1], nodeHat[0]);
  // Angle from the node to the object, measured in the orbit plane.
  const along = cross(hHat, nodeHat);
  const u = Math.atan2(dot(r, along), dot(r, nodeHat));
  const nu = e > 1e-10 ? Math.atan2(dot(r, cross(hHat, eVec)), dot(r, eVec)) : u;
  const argp = u - nu;
  let m = nu;
  if (e < 1) {
    const big =
      2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    m = big - e * Math.sin(big);
  }
  return { a, e, i, raan, argp, m };
}

/** Position (km) and velocity (km/s) from orbital elements. */
export function stateFromElements(el: Elements): { r: Vec3; v: Vec3 } {
  const big = solveKepler(el.m, el.e);
  const cosE = Math.cos(big);
  const sinE = Math.sin(big);
  const root = Math.sqrt(1 - el.e * el.e);
  // In the orbit plane, x toward perigee.
  const x = el.a * (cosE - el.e);
  const y = el.a * root * sinE;
  const rate = Math.sqrt(MU_KM3_S2 * el.a) / (el.a * (1 - el.e * cosE));
  const vx = -rate * sinE;
  const vy = rate * root * cosE;
  const cO = Math.cos(el.raan);
  const sO = Math.sin(el.raan);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const cw = Math.cos(el.argp);
  const sw = Math.sin(el.argp);
  const p: Vec3 = [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si];
  const q: Vec3 = [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si];
  return { r: add(scale(p, x), scale(q, y)), v: add(scale(p, vx), scale(q, vy)) };
}

/** Mean motion, rad/s, of an orbit with semi-major axis `a` km. */
export function meanMotion(a: number): number {
  return Math.sqrt(MU_KM3_S2 / (a * a * a));
}

/**
 * The steady rates at which J2 turns an orbit, in rad/s: the node, the
 * perigee, and the mean anomaly (which includes the ordinary motion round
 * the orbit).
 */
export function secularRates(
  a: number,
  e: number,
  i: number,
): { raanDot: number; argpDot: number; mDot: number } {
  const n = meanMotion(a);
  const p = a * (1 - e * e);
  const k = J2 * (EARTH_RADIUS_KM / p) ** 2;
  const cosI = Math.cos(i);
  return {
    raanDot: -1.5 * n * k * cosI,
    argpDot: 0.75 * n * k * (5 * cosI * cosI - 1),
    mDot: n * (1 + 0.75 * k * Math.sqrt(1 - e * e) * (3 * cosI * cosI - 1)),
  };
}

/**
 * Acceleration, km/s^2, from the Earth's gravity with its J2 term, at a
 * position in km. Used only by the numerical integrator that the faster
 * methods are checked against.
 */
export function gravityWithJ2(r: Vec3): Vec3 {
  const radius = norm(r);
  const base = -MU_KM3_S2 / radius ** 3;
  const k = 1.5 * J2 * (EARTH_RADIUS_KM / radius) ** 2;
  const z2 = (r[2] / radius) ** 2;
  return [
    base * r[0] * (1 + k * (1 - 5 * z2)),
    base * r[1] * (1 + k * (1 - 5 * z2)),
    base * r[2] * (1 + k * (3 - 5 * z2)),
  ];
}

/**
 * Position and velocity of a circular orbit of the given height and
 * inclination, at the moment it crosses a latitude going north or south.
 * The crossing is put on the x-z plane; where it is around the Earth does
 * not matter to anything the simulator reports.
 */
export function circularStateAtLatitude(
  altitudeKm: number,
  inclination: number,
  latitude: number,
  northbound: boolean,
): { r: Vec3; v: Vec3 } {
  const radius = EARTH_RADIUS_KM + altitudeKm;
  const speed = Math.sqrt(MU_KM3_S2 / radius);
  // Azimuth of the velocity, from north toward east: cos i = cos(lat) sin(az).
  const sinAz = Math.min(1, Math.max(-1, Math.cos(inclination) / Math.cos(latitude)));
  const az = northbound ? Math.asin(sinAz) : Math.PI - Math.asin(sinAz);
  const north: Vec3 = [-Math.sin(latitude), 0, Math.cos(latitude)];
  const east: Vec3 = [0, 1, 0];
  return {
    r: [radius * Math.cos(latitude), 0, radius * Math.sin(latitude)],
    v: add(scale(north, speed * Math.cos(az)), scale(east, speed * Math.sin(az))),
  };
}
