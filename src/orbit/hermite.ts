/**
 * Cubic Hermite interpolation: the unique cubic curve that passes through
 * two positions with two given velocities.
 *
 * Why it is used. Running SGP4 for every object on every frame would cost
 * about 20 000 propagations 60 times a second. Instead SGP4 runs every few
 * seconds, producing position AND velocity for each object ("keyframes"),
 * and the graphics card fills in the frames between with this formula. A
 * straight line between keyframes would cut the corner of the orbit; a
 * cubic that also matches the velocities follows the curve to well under a
 * metre over a few seconds (measured in VALIDATION.md, entry V3.3).
 *
 * STANDARD MODEL. With s running from 0 at the first keyframe to 1 at the
 * second, and dt the time between them:
 *
 *   p(s) = h00 p0 + h10 dt v0 + h01 p1 + h11 dt v1
 *   h00 = 2s^3 - 3s^2 + 1     h10 = s^3 - 2s^2 + s
 *   h01 = -2s^3 + 3s^2        h11 = s^3 - s^2
 *
 * The formula stays valid when dt is negative (the "second" keyframe is the
 * earlier one), which lets the renderer overwrite whichever keyframe is
 * older without swapping buffers. The vertex shader in
 * src/render/satellites.ts contains the same expression; this function
 * exists so the mathematics can be tested.
 *
 * @param p0 position at the first keyframe
 * @param v0 velocity at the first keyframe, in position units per second
 * @param p1 position at the second keyframe
 * @param v1 velocity at the second keyframe
 * @param dt time from the first keyframe to the second, in seconds (may be negative)
 * @param s  fraction of the way from the first keyframe to the second
 */
export function hermite(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  dt: number,
  s: number,
): number {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * dt * v0 + h01 * p1 + h11 * dt * v1;
}
