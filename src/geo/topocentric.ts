import { geodeticToEcef } from './geodetic';

/**
 * Where something appears in the sky from a place on the ground.
 *
 * The "topocentric" frame has its origin at the observer, with axes
 * pointing east, north and straight up (up meaning perpendicular to the
 * WGS 84 ellipsoid, which is the direction a plumb line very nearly
 * hangs). Azimuth is the compass bearing, measured from north through
 * east; elevation is the angle above the horizontal plane.
 */

/** A place on the ground, with the quantities needed to look up from it worked out once. */
export interface Observer {
  /** Geodetic latitude in radians, north positive. */
  readonly latitudeRad: number;
  /** Longitude in radians, east positive. */
  readonly longitudeRad: number;
  /** Height above the ellipsoid in kilometres. */
  readonly heightKm: number;
  /** Position in the Earth-fixed frame, kilometres. */
  readonly ecef: { readonly x: number; readonly y: number; readonly z: number };
  /** Unit vectors of the local east, north and up directions, in the Earth-fixed frame. */
  readonly east: readonly [number, number, number];
  readonly north: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** Direction and distance of an object as seen by an observer. */
export interface LookAngles {
  /** Compass bearing in radians: 0 is north, pi/2 east, in the range 0 to 2 pi. */
  readonly azimuthRad: number;
  /** Angle above the horizontal in radians; negative means below the horizon. */
  readonly elevationRad: number;
  /** Straight-line distance in kilometres. */
  readonly rangeKm: number;
}

/**
 * Prepare an observer.
 *
 * STANDARD MODEL. For geodetic latitude phi and longitude lambda the local
 * axes, expressed in the Earth-fixed frame, are
 *
 *   east  = (-sin lambda,           cos lambda,          0)
 *   north = (-sin phi cos lambda,  -sin phi sin lambda,  cos phi)
 *   up    = ( cos phi cos lambda,   cos phi sin lambda,  sin phi)
 *
 * @param latitudeRad  geodetic latitude, radians, north positive
 * @param longitudeRad longitude, radians, east positive
 * @param heightKm     height above the WGS 84 ellipsoid, kilometres
 */
export function createObserver(
  latitudeRad: number,
  longitudeRad: number,
  heightKm: number,
): Observer {
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const sinLon = Math.sin(longitudeRad);
  const cosLon = Math.cos(longitudeRad);
  return {
    latitudeRad,
    longitudeRad,
    heightKm,
    ecef: geodeticToEcef(latitudeRad, longitudeRad, heightKm),
    east: [-sinLon, cosLon, 0],
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat],
    up: [cosLat * cosLon, cosLat * sinLon, sinLat],
  };
}

/**
 * Azimuth, elevation and range of a point given in the Earth-fixed frame.
 *
 * STANDARD MODEL: the vector from the observer to the point is resolved
 * along the local east, north and up axes; then
 * azimuth = atan2(east, north) and elevation = asin(up / range).
 *
 * SIMPLIFICATION: no allowance is made for the bending of light by the
 * atmosphere, which lifts objects near the horizon by about half a degree
 * and is negligible above ten degrees.
 *
 * @param x Earth-fixed coordinates of the point, kilometres
 */
export function lookAngles(observer: Observer, x: number, y: number, z: number): LookAngles {
  const dx = x - observer.ecef.x;
  const dy = y - observer.ecef.y;
  const dz = z - observer.ecef.z;
  const east = dx * observer.east[0] + dy * observer.east[1] + dz * observer.east[2];
  const north = dx * observer.north[0] + dy * observer.north[1] + dz * observer.north[2];
  const up = dx * observer.up[0] + dy * observer.up[1] + dz * observer.up[2];
  const rangeKm = Math.hypot(dx, dy, dz);
  const azimuth = Math.atan2(east, north);
  return {
    azimuthRad: azimuth < 0 ? azimuth + 2 * Math.PI : azimuth,
    elevationRad: rangeKm === 0 ? Math.PI / 2 : Math.asin(up / rangeKm),
    rangeKm,
  };
}

/** The sixteen compass points, clockwise from north. */
const COMPASS_POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** The nearest of the sixteen compass points to a bearing in degrees: 0 is "N", 100 is "E". */
export function compassPoint(azimuthDeg: number): (typeof COMPASS_POINTS)[number] {
  const turn = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(turn / 22.5) % 16] ?? 'N';
}
