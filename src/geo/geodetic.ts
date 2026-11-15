import { WGS84_A_KM, WGS84_E2 } from './wgs84';

/** A position in the Earth-centred, Earth-fixed frame, in kilometres. */
export interface EcefKm {
  /** Towards the intersection of the equator and the prime meridian. */
  readonly x: number;
  /** Towards the equator at 90 degrees east longitude. */
  readonly y: number;
  /** Towards the north pole, along the rotation axis. */
  readonly z: number;
}

/**
 * Convert geodetic coordinates on the WGS 84 ellipsoid to Earth-centred,
 * Earth-fixed (ECEF) Cartesian coordinates.
 *
 * STANDARD MODEL. "Geodetic" latitude is the angle between the equatorial
 * plane and the line perpendicular to the ellipsoid's surface. This is the
 * latitude printed on maps. It differs from "geocentric" latitude (the angle
 * measured at the Earth's centre) by up to about 0.19 degrees.
 *
 * Formulas (closed form, exact for the ellipsoid):
 *
 *   N = a / sqrt(1 - e^2 sin^2(lat))      radius of curvature in the prime vertical
 *   x = (N + h) cos(lat) cos(lon)
 *   y = (N + h) cos(lat) sin(lon)
 *   z = (N (1 - e^2) + h) sin(lat)
 *
 * @param latitudeRad  geodetic latitude in radians, north positive
 * @param longitudeRad longitude in radians, east positive
 * @param heightKm     height above the ellipsoid in kilometres
 */
export function geodeticToEcef(
  latitudeRad: number,
  longitudeRad: number,
  heightKm: number,
): EcefKm {
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const primeVerticalRadius = WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);

  const horizontal = (primeVerticalRadius + heightKm) * cosLat;
  return {
    x: horizontal * Math.cos(longitudeRad),
    y: horizontal * Math.sin(longitudeRad),
    z: (primeVerticalRadius * (1 - WGS84_E2) + heightKm) * sinLat,
  };
}

/** Degrees to radians. */
export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
