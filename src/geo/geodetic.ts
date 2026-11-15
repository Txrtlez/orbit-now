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

/** Radians to degrees. */
export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** A position given as latitude, longitude and height on the WGS 84 ellipsoid. */
export interface Geodetic {
  /** Geodetic latitude in radians, north positive. */
  readonly latitudeRad: number;
  /** Longitude in radians, east positive, between -pi and pi. */
  readonly longitudeRad: number;
  /** Height above the ellipsoid in kilometres. */
  readonly heightKm: number;
}

/**
 * Convert Earth-centred, Earth-fixed coordinates to geodetic latitude,
 * longitude and height on the WGS 84 ellipsoid: the inverse of
 * `geodeticToEcef`.
 *
 * STANDARD MODEL. There is no simple closed form, because the latitude
 * appears on both sides of the equation. The usual fixed-point iteration is
 * used: start from the latitude a sphere would give, then repeat
 *
 *   N   = a / sqrt(1 - e^2 sin^2(lat))
 *   lat = atan2(z + e^2 N sin(lat), sqrt(x^2 + y^2))
 *
 * until the latitude stops changing. For any point at or above the surface
 * this settles to better than a millimetre within a handful of rounds. The
 * tests check it against `geodeticToEcef` over the whole globe and from the
 * surface to beyond geostationary height.
 *
 * "Height" here is height above the ellipsoid, which is what a satellite's
 * altitude conventionally means. It is not height above the local terrain.
 */
export function ecefToGeodetic(xKm: number, yKm: number, zKm: number): Geodetic {
  const horizontal = Math.hypot(xKm, yKm);
  const longitudeRad = Math.atan2(yKm, xKm);

  /** Radius of curvature in the prime vertical at a given latitude. */
  const primeVerticalRadius = (latitude: number): number => {
    const sinLat = Math.sin(latitude);
    return WGS84_A_KM / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  };

  let latitudeRad = Math.atan2(zKm, horizontal * (1 - WGS84_E2));
  for (let round = 0; round < 12; round += 1) {
    const next = Math.atan2(
      zKm + WGS84_E2 * primeVerticalRadius(latitudeRad) * Math.sin(latitudeRad),
      horizontal,
    );
    const change = Math.abs(next - latitudeRad);
    latitudeRad = next;
    if (change < 1e-15) {
      break;
    }
  }

  // Two expressions for the height; each is ill-conditioned where the other
  // is not (near the poles cos(lat) approaches zero, near the equator sin(lat) does).
  const sinLat = Math.sin(latitudeRad);
  const cosLat = Math.cos(latitudeRad);
  const radius = primeVerticalRadius(latitudeRad);
  const heightKm =
    Math.abs(cosLat) > Math.abs(sinLat)
      ? horizontal / cosLat - radius
      : zKm / sinLat - radius * (1 - WGS84_E2);

  return { latitudeRad, longitudeRad, heightKm };
}
