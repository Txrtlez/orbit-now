import { json2satrec, sgp4, type SatRec } from 'satellite.js';
import { epochToUnixMs, recordToOmm, type CatalogRecord } from '../catalog/format';
import { KM_PER_SCENE_UNIT } from '../geo/sceneFrame';

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
