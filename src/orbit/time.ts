import { gstime, sunPos } from 'satellite.js';

/** Julian date of 1970-01-01T00:00:00 UTC, the zero point of JavaScript's clock. */
const UNIX_EPOCH_JULIAN_DATE = 2440587.5;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Convert JavaScript time (milliseconds since 1970-01-01 UTC) to a Julian
 * date: a continuous count of days used throughout astronomy, which avoids
 * calendar arithmetic.
 *
 * A 64-bit float holds a present-day Julian date to about 40 microseconds,
 * which is far finer than anything in this project needs.
 */
export function julianDate(unixMs: number): number {
  return unixMs / MILLISECONDS_PER_DAY + UNIX_EPOCH_JULIAN_DATE;
}

/**
 * Greenwich Mean Sidereal Time, in radians: the angle between the vernal
 * equinox direction and the Greenwich meridian, measured eastward along the
 * equator. In plain terms, how far the Earth has turned relative to the stars.
 *
 * STANDARD MODEL: the IAU 1982 expression, as implemented in the SGP4
 * reference code (`gstime`). It is the definition the TEME frame is paired
 * with, so it is the right one to use with SGP4 output.
 *
 * SIMPLIFICATION: the formula is defined for UT1, the time scale that follows
 * the Earth's actual rotation. This project supplies UTC, which is kept
 * within 0.9 seconds of UT1. The Earth turns 15 arcseconds per second, so
 * the resulting error is at most 13.5 arcseconds: up to 0.42 km on the
 * ground at the equator. See VALIDATION.md, entry V3.1.
 */
export function gmstRadians(unixMs: number): number {
  return gstime(julianDate(unixMs));
}

/**
 * Unit vector from the Earth's centre towards the Sun, in the equatorial
 * inertial frame (x towards the vernal equinox, z towards the north pole).
 *
 * STANDARD MODEL: the low-precision solar position series from Vallado,
 * "Fundamentals of Astrodynamics and Applications" (Algorithm 29), as
 * implemented in satellite.js. Its stated accuracy is about 0.01 degrees,
 * ample for drawing the day/night line.
 *
 * SIMPLIFICATION: the result is used as if it were in the TEME frame that
 * SGP4 uses. The two frames differ by well under 0.01 degrees.
 */
export function sunDirection(unixMs: number): { x: number; y: number; z: number } {
  const { rsun } = sunPos(julianDate(unixMs));
  const length = Math.hypot(rsun.x, rsun.y, rsun.z);
  return { x: rsun.x / length, y: rsun.y / length, z: rsun.z / length };
}

/**
 * Rotate a position from the TEME frame (inertial, the frame SGP4 reports
 * in) to the Earth-fixed frame, given Greenwich sidereal time.
 *
 * The Earth-fixed x axis (through the Greenwich meridian) sits at angle
 * `gmst` from the inertial x axis, so Earth-fixed coordinates are the
 * inertial ones rotated by -gmst about the polar (z) axis.
 *
 * SIMPLIFICATION: polar motion (the wander of the rotation axis over the
 * crust, about 10 metres) is ignored. The result is what the literature
 * calls the pseudo-Earth-fixed (PEF) frame.
 */
export function temeToEarthFixed(
  x: number,
  y: number,
  z: number,
  gmst: number,
): { x: number; y: number; z: number } {
  const cos = Math.cos(gmst);
  const sin = Math.sin(gmst);
  return { x: cos * x + sin * y, y: -sin * x + cos * y, z };
}
