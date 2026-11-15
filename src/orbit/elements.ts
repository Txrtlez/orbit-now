/**
 * Quantities worked out from an object's orbital elements for display and
 * filtering: where its launch designator says it came from, and which
 * broad region of space its orbit lies in.
 */

/** The parts of an international designator such as "1998-067A". */
export interface LaunchDesignator {
  /** Year of launch. */
  readonly year: number;
  /** Which launch of that year, counting from 1. */
  readonly launchNumber: number;
  /** Which object from that launch: "A" is normally the main payload. */
  readonly piece: string;
  /** The part shared by every object from the same launch, e.g. "1998-067". */
  readonly launchId: string;
}

/**
 * Split an international designator into launch year, launch number and
 * piece.
 *
 * REAL DATA. The format is the one CelesTrak documents for the OBJECT_ID
 * field (https://celestrak.org/satcat/satcat-format.php, read 2026-11-15):
 * four-digit launch year, a hyphen, the three-digit number of the launch
 * within that year, and one to three letters identifying the piece.
 *
 * @returns null if the text is not in that format. Nothing is guessed.
 */
export function parseDesignator(objectId: string): LaunchDesignator | null {
  const match = /^(\d{4})-(\d{3})([A-Z]{1,3})$/.exec(objectId.trim());
  if (match === null) {
    return null;
  }
  const [, year = '', launch = '', piece = ''] = match;
  return {
    year: Number(year),
    launchNumber: Number(launch),
    piece,
    launchId: `${year}-${launch}`,
  };
}

/** The orbit regimes this site sorts objects into. */
export type Regime = 'LEO' | 'MEO' | 'GEO' | 'HEO';

/** The regimes in display order. The position in this list is the code stored per object. */
export const REGIMES: readonly Regime[] = ['LEO', 'MEO', 'GEO', 'HEO'];

/** Plain-language description of each regime, as this site defines it. */
export const REGIME_DESCRIPTIONS: Readonly<Record<Regime, string>> = {
  LEO: 'Low Earth orbit: never higher than 2,000 km',
  MEO: 'Medium Earth orbit: between low orbit and geosynchronous',
  GEO: 'Geosynchronous: goes round once per turn of the Earth',
  HEO: 'Highly elliptical: eccentricity 0.25 or more',
};

/** Upper edge of low Earth orbit, in kilometres of altitude. */
export const LEO_MAX_APOGEE_KM = 2000;
/** Eccentricity at and above which an orbit is called highly elliptical here. */
export const HEO_MIN_ECCENTRICITY = 0.25;
/** Range of mean motion, in revolutions per day, called geosynchronous here. */
export const GEO_MEAN_MOTION_RANGE: readonly [number, number] = [0.99, 1.01];

/**
 * Sort an orbit into one of four regimes.
 *
 * SIMPLIFICATION, and a convention. There is no single agreed definition of
 * these regimes; agencies draw the lines in slightly different places. The
 * rules used here, applied in this order, are:
 *
 * 1. HEO if the eccentricity is 0.25 or more.
 * 2. LEO if the highest point of the orbit is below 2,000 km. That altitude
 *    is the top of the low-Earth-orbit protected region in the Inter-Agency
 *    Space Debris Coordination Committee's mitigation guidelines.
 * 3. GEO if the object completes between 0.99 and 1.01 revolutions per day,
 *    which brackets one revolution per sidereal day (1.0027 per day). This
 *    includes inclined geosynchronous orbits, not only geostationary ones.
 * 4. MEO otherwise.
 *
 * The eccentricity and mean-motion thresholds follow the regime definitions
 * used by Space-Track.org's catalog queries. Those thresholds, and the IADC
 * figure, were written from memory and have not yet been checked against
 * the source documents; see VALIDATION.md, entry V3.7.
 *
 * @param eccentricity            dimensionless
 * @param apogeeAltitudeKm        highest point of the orbit above the Earth's equatorial radius
 * @param meanMotionRevPerDay     revolutions per day
 */
export function classifyRegime(
  eccentricity: number,
  apogeeAltitudeKm: number,
  meanMotionRevPerDay: number,
): Regime {
  if (eccentricity >= HEO_MIN_ECCENTRICITY) {
    return 'HEO';
  }
  if (apogeeAltitudeKm < LEO_MAX_APOGEE_KM) {
    return 'LEO';
  }
  if (
    meanMotionRevPerDay >= GEO_MEAN_MOTION_RANGE[0] &&
    meanMotionRevPerDay <= GEO_MEAN_MOTION_RANGE[1]
  ) {
    return 'GEO';
  }
  return 'MEO';
}

/**
 * Solve Kepler's equation M = E - e sin(E) for the eccentric anomaly E.
 *
 * STANDARD MODEL. Newton's method, started from E = M (or pi for very
 * eccentric orbits, where starting from M can overshoot). Converges to
 * machine precision in a few rounds for any eccentricity below 1.
 *
 * @param meanAnomaly  M, in radians (any value; the result is on the same turn)
 * @param eccentricity e, with 0 <= e < 1
 */
export function solveKepler(meanAnomaly: number, eccentricity: number): number {
  const turns = Math.floor((meanAnomaly + Math.PI) / (2 * Math.PI));
  const reduced = meanAnomaly - turns * 2 * Math.PI; // now within [-pi, pi)
  let eccentricAnomaly = eccentricity < 0.8 ? reduced : Math.PI * Math.sign(reduced || 1);
  for (let round = 0; round < 50; round += 1) {
    const residual = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - reduced;
    const step = residual / (1 - eccentricity * Math.cos(eccentricAnomaly));
    eccentricAnomaly -= step;
    if (Math.abs(step) < 1e-14) {
      break;
    }
  }
  return eccentricAnomaly + turns * 2 * Math.PI;
}

/**
 * Choose the instants at which to compute positions for drawing one full
 * revolution of an orbit.
 *
 * Why not simply equal steps in time. An object on an eccentric orbit moves
 * fastest at its lowest point, exactly where the path bends most sharply.
 * Equal time steps would put the fewest points there and the drawn line
 * would show corners. Equal steps in eccentric anomaly (the angle that
 * parametrises an ellipse from its centre) space the points evenly around
 * the shape instead. For a circular orbit the two are the same.
 *
 * The revolution is arranged so that the object's present position is in
 * the middle of it. An orbit is not exactly closed (the Earth's bulge turns
 * it slowly), so the two ends of the drawn line do not quite meet; putting
 * the object in the middle places that small gap on the far side of the
 * orbit from the object.
 *
 * STANDARD MODEL for the geometry (Kepler's equation). SIMPLIFICATION: the
 * sample times assume the mean anomaly advances at a constant rate. That
 * only affects how the points are spaced along the path, not where the path
 * is: every position is still computed by SGP4.
 *
 * @param eccentricity          e, with 0 <= e < 1
 * @param meanAnomalyNow        mean anomaly at the present instant, radians
 * @param meanMotionRadPerMin   rate of change of mean anomaly, radians per minute
 * @param segments              number of line segments; the result has one more entry
 * @returns offsets from the present instant, in minutes, strictly increasing,
 *          spanning exactly one revolution
 */
export function orbitSampleOffsetsMinutes(
  eccentricity: number,
  meanAnomalyNow: number,
  meanMotionRadPerMin: number,
  segments: number,
): Float64Array {
  if (!(eccentricity >= 0 && eccentricity < 1)) {
    throw new RangeError('eccentricity must be at least 0 and below 1');
  }
  if (!(meanMotionRadPerMin > 0)) {
    throw new RangeError('meanMotionRadPerMin must be positive');
  }
  if (!Number.isInteger(segments) || segments < 2) {
    throw new RangeError('segments must be a whole number of at least 2');
  }
  const eccentricAnomalyNow = solveKepler(meanAnomalyNow, eccentricity);
  const meanAnomalyAtNow = eccentricAnomalyNow - eccentricity * Math.sin(eccentricAnomalyNow);
  const offsets = new Float64Array(segments + 1);
  for (let k = 0; k <= segments; k += 1) {
    const eccentricAnomaly = eccentricAnomalyNow - Math.PI + (2 * Math.PI * k) / segments;
    const meanAnomaly = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly);
    offsets[k] = (meanAnomaly - meanAnomalyAtNow) / meanMotionRadPerMin;
  }
  return offsets;
}
