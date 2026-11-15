import { ecefToGeodetic, radToDeg } from '../geo/geodetic';
import { KM_PER_SCENE_UNIT } from '../geo/sceneFrame';
import { gmstRadians, temeToEarthFixed } from '../orbit/time';

/** Where an object is at one instant, in the terms a viewer cares about. */
export interface LiveState {
  /** Height above the WGS 84 ellipsoid, in kilometres. */
  readonly altitudeKm: number;
  /** Speed in the inertial frame, in kilometres per second. */
  readonly speedKmPerSecond: number;
  /** Geodetic latitude of the point on the ground directly below, in degrees, north positive. */
  readonly latitudeDeg: number;
  /** Longitude of that point, in degrees, east positive, between -180 and 180. */
  readonly longitudeDeg: number;
}

/**
 * Convert an object's position and velocity in scene coordinates to its
 * altitude, speed, and the point on the ground beneath it.
 *
 * The chain is: scene coordinates back to the inertial frame SGP4 reports
 * in (undoing the rotation and scaling in src/geo/sceneFrame.ts), then a
 * turn by the sidereal angle into the Earth-fixed frame, then the
 * conversion to latitude, longitude and height on the WGS 84 ellipsoid.
 * Each step is a STANDARD MODEL tested on its own; the simplifications are
 * those of `gmstRadians` and `temeToEarthFixed` (UTC used for UT1, no polar
 * motion: together well under a kilometre on the ground).
 *
 * The speed is measured in the inertial frame, that is, relative to the
 * Earth's centre and not to the ground turning underneath. That is the
 * conventional meaning of orbital speed.
 *
 * @param position x, y, z in scene units
 * @param velocity x, y, z in scene units per second
 * @param unixMs   the instant, in milliseconds since 1970-01-01 UTC
 */
export function liveStateFromScene(
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
  unixMs: number,
): LiveState {
  // Inverse of the mapping in sceneFrame.ts: equatorial x = scene x,
  // equatorial y = -scene z, equatorial z (north) = scene y.
  const x = position[0] * KM_PER_SCENE_UNIT;
  const y = -position[2] * KM_PER_SCENE_UNIT;
  const z = position[1] * KM_PER_SCENE_UNIT;
  const fixed = temeToEarthFixed(x, y, z, gmstRadians(unixMs));
  const geodetic = ecefToGeodetic(fixed.x, fixed.y, fixed.z);
  return {
    altitudeKm: geodetic.heightKm,
    speedKmPerSecond: Math.hypot(velocity[0], velocity[1], velocity[2]) * KM_PER_SCENE_UNIT,
    latitudeDeg: radToDeg(geodetic.latitudeRad),
    longitudeDeg: radToDeg(geodetic.longitudeRad),
  };
}
