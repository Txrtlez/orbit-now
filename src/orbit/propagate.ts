import { constants, json2satrec, sgp4, type SatRec } from 'satellite.js';
import { epochToUnixMs, recordToOmm, type CatalogRecord } from '../catalog/format';
import { KM_PER_SCENE_UNIT } from '../geo/sceneFrame';
import { orbitSampleOffsetsMinutes } from './elements';

/** Everything needed to propagate a set of objects repeatedly. */
export interface PropagationSet {
  /** One SGP4 state per object, in catalog order. */
  readonly satrecs: readonly SatRec[];
  /** Each object's element-set epoch, in milliseconds since 1970-01-01 UTC. */
  readonly epochMs: Float64Array;
}

/** Prepare SGP4 for every record. Done once per catalog; takes a few hundred milliseconds for 20 000 objects. */
export function buildPropagationSet(records: readonly CatalogRecord[]): PropagationSet {
  const epochMs = new Float64Array(records.length);
  const satrecs = records.map((record, index) => {
    epochMs[index] = epochToUnixMs(record.epochDay, record.epochMicros);
    return json2satrec(recordToOmm(record));
  });
  return { satrecs, epochMs };
}

/**
 * Compute every object's position and velocity at one instant.
 *
 * Results are written in scene coordinates (see src/geo/sceneFrame.ts): one
 * unit is the Earth's equatorial radius, +y is north, and the frame is
 * SGP4's inertial TEME frame, not the rotating Earth. Velocities are in
 * scene units per second. Three numbers per object.
 *
 * An object SGP4 cannot propagate at this time (typically because it has
 * decayed) gets position and velocity (0, 0, 0). The centre of the Earth is
 * not a possible satellite position, so the renderer uses it as the signal
 * to draw nothing.
 *
 * @returns the number of objects that could not be propagated
 */
export function propagateAll(
  set: PropagationSet,
  unixMs: number,
  positions: Float32Array,
  velocities: Float32Array,
): number {
  const count = set.satrecs.length;
  if (positions.length !== count * 3 || velocities.length !== count * 3) {
    throw new RangeError('Output arrays must hold exactly three numbers per object');
  }
  let failures = 0;
  for (let i = 0; i < count; i += 1) {
    const satrec = set.satrecs[i];
    const offset = i * 3;
    // SGP4 takes time as minutes since the element set's epoch.
    const minutesSinceEpoch = (unixMs - (set.epochMs[i] ?? 0)) / 60_000;
    const state = satrec === undefined ? null : sgp4(satrec, minutesSinceEpoch);
    if (state === null) {
      failures += 1;
      positions.fill(0, offset, offset + 3);
      velocities.fill(0, offset, offset + 3);
      continue;
    }
    // Equatorial (x, y, z-north) to scene (x, y-north, z): a rotation, as in sceneFrame.ts.
    positions[offset] = state.position.x / KM_PER_SCENE_UNIT;
    positions[offset + 1] = state.position.z / KM_PER_SCENE_UNIT;
    positions[offset + 2] = -state.position.y / KM_PER_SCENE_UNIT;
    velocities[offset] = state.velocity.x / KM_PER_SCENE_UNIT;
    velocities[offset + 1] = state.velocity.z / KM_PER_SCENE_UNIT;
    velocities[offset + 2] = -state.velocity.y / KM_PER_SCENE_UNIT;
  }
  return failures;
}

/** Size and timing of every orbit in a set, as SGP4 itself works them out. */
export interface OrbitSummary {
  /** Time for one revolution, in minutes. */
  readonly periodMinutes: Float32Array;
  /** Highest point of the orbit above SGP4's Earth radius, in kilometres. */
  readonly apogeeKm: Float32Array;
  /** Lowest point of the orbit above SGP4's Earth radius, in kilometres. */
  readonly perigeeKm: Float32Array;
}

/**
 * Read each orbit's period and its highest and lowest altitudes from SGP4's
 * own initialisation.
 *
 * STANDARD MODEL. Published element sets give the mean motion in a
 * convention ("Kozai") that SGP4 converts to its own ("Brouwer") before
 * doing anything else; the semi-major axis follows from the converted
 * value. Taking the numbers from SGP4's state, instead of re-deriving them
 * with Kepler's third law, means the figures shown agree with the model
 * that produces the positions. The difference between the two is a few
 * kilometres in low orbit.
 *
 * SIMPLIFICATION. These are altitudes of the mean orbit above a sphere of
 * SGP4's Earth radius (6378.135 km, the WGS 72 value), not heights above
 * the ground at a particular moment. The real height varies by tens of
 * kilometres around each revolution because the Earth is not a sphere and
 * the orbit is not exactly an ellipse. The live altitude shown for a
 * selected object is computed separately, from its actual position.
 */
export function summariseOrbits(set: PropagationSet): OrbitSummary {
  const count = set.satrecs.length;
  const periodMinutes = new Float32Array(count);
  const apogeeKm = new Float32Array(count);
  const perigeeKm = new Float32Array(count);
  set.satrecs.forEach((satrec, index) => {
    // `no` is the converted mean motion in radians per minute; `a` the
    // semi-major axis in Earth radii.
    periodMinutes[index] = (2 * Math.PI) / satrec.no;
    apogeeKm[index] = (satrec.a * (1 + satrec.ecco) - 1) * constants.earthRadius;
    perigeeKm[index] = (satrec.a * (1 - satrec.ecco) - 1) * constants.earthRadius;
  });
  return { periodMinutes, apogeeKm, perigeeKm };
}

/**
 * Compute the points of one revolution of an object's orbit, for drawing
 * its path. The revolution is centred on `unixMs`, so the object's present
 * position is half-way along the returned line.
 *
 * Every point is an SGP4 position (REAL DATA propagated with the STANDARD
 * MODEL); only the choice of sample times is approximate (see
 * `orbitSampleOffsetsMinutes`). The path is in the inertial frame, where an
 * orbit is very nearly a closed ellipse.
 *
 * @returns x, y, z per point in scene coordinates. Empty if SGP4 cannot
 *          propagate the object over the whole revolution, in which case no
 *          path should be drawn.
 */
export function sampleOrbitPath(
  set: PropagationSet,
  index: number,
  unixMs: number,
  segments: number,
): Float32Array {
  const satrec = set.satrecs[index];
  const epochMs = set.epochMs[index];
  if (satrec === undefined || epochMs === undefined) {
    throw new RangeError(`No object at index ${String(index)}`);
  }
  const minutesSinceEpoch = (unixMs - epochMs) / 60_000;
  // `mo` is the mean anomaly at the epoch and `mdot` its rate of change,
  // including the steady effect of the Earth's bulge.
  const meanAnomalyNow = satrec.mo + satrec.mdot * minutesSinceEpoch;
  const offsets = orbitSampleOffsetsMinutes(satrec.ecco, meanAnomalyNow, satrec.mdot, segments);
  const points = new Float32Array(offsets.length * 3);
  for (let k = 0; k < offsets.length; k += 1) {
    const state = sgp4(satrec, minutesSinceEpoch + (offsets[k] ?? 0));
    if (state === null) {
      return new Float32Array(0);
    }
    points[k * 3] = state.position.x / KM_PER_SCENE_UNIT;
    points[k * 3 + 1] = state.position.z / KM_PER_SCENE_UNIT;
    points[k * 3 + 2] = -state.position.y / KM_PER_SCENE_UNIT;
  }
  return points;
}
