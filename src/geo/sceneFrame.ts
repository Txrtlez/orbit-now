import { WGS84_A_KM } from './wgs84';

/**
 * Mapping between physical coordinates and the 3D scene.
 *
 * Two conventions differ and must be reconciled in exactly one place:
 *
 * 1. Units. Physics code works in kilometres. The GPU works in 32-bit floats,
 *    which carry only about 7 significant digits, so the scene uses Earth
 *    radii: one scene unit is the WGS 84 equatorial radius. A satellite in
 *    geostationary orbit is then at about 6.6 units instead of 42 164.
 *
 * 2. Axes. Earth-fixed (ECEF) coordinates put the north pole on +z. three.js
 *    treats +y as "up". The scene therefore uses
 *
 *        scene x =  ECEF x
 *        scene y =  ECEF z   (north pole is up)
 *        scene z = -ECEF y
 *
 *    This is a rotation by -90 degrees about the x axis. It is a pure
 *    rotation (determinant +1), so it preserves handedness: orbits that are
 *    prograde in reality stay prograde on screen. Simply swapping y and z
 *    would mirror the scene and make everything orbit backwards.
 */

/** Kilometres represented by one scene unit. */
export const KM_PER_SCENE_UNIT = WGS84_A_KM;

/**
 * Write the scene-frame equivalent of an ECEF position into `out`, starting at
 * index `offset`. Writing into a caller-supplied array avoids allocating an
 * object per point, which matters once tens of thousands of positions are
 * converted every frame.
 */
export function ecefKmToScene(
  xKm: number,
  yKm: number,
  zKm: number,
  out: Float32Array | Float64Array | number[],
  offset = 0,
): void {
  out[offset] = xKm / KM_PER_SCENE_UNIT;
  out[offset + 1] = zKm / KM_PER_SCENE_UNIT;
  // `0 - y` rather than `-y` so that an input of 0 yields +0 instead of -0.
  out[offset + 2] = (0 - yKm) / KM_PER_SCENE_UNIT;
}
