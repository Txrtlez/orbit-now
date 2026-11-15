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
 * src/render/satelliteLayer.ts contains the same expression; this function
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

/**
 * The rate of change of the Hermite curve: the velocity implied by the
 * interpolated positions, in position units per second.
 *
 * STANDARD MODEL: the derivative of the formula above with respect to time,
 * where time = s * dt:
 *
 *   v(s) = (h00' p0 + h01' p1) / dt + h10' v0 + h11' v1
 *   h00' = 6s^2 - 6s      h10' = 3s^2 - 4s + 1
 *   h01' = -6s^2 + 6s     h11' = 3s^2 - 2s
 *
 * Parameters are those of `hermite`. `dt` must not be zero.
 */
export function hermiteVelocity(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  dt: number,
  s: number,
): number {
  const s2 = s * s;
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  return (d00 * p0 + d01 * p1) / dt + d10 * v0 + d11 * v1;
}

/** A point in space or a velocity: three numbers. */
export type Triple = readonly [number, number, number];

/**
 * Position and velocity between two keyframes, for the figures shown about
 * a selected object.
 *
 * The position is the Hermite curve, exactly as the graphics card draws it.
 *
 * The velocity needs more care, because three obvious ways of getting it
 * are each wrong somewhere (measured against SGP4's own velocity over the
 * verification orbits; VALIDATION.md, V4.1):
 *
 * - The slope of the Hermite curve is off by up to 0.3% even with keyframes
 *   5 seconds apart, because SGP4's velocities are not exactly the slope of
 *   SGP4's positions.
 * - Blending the two keyframe velocities is right to a few parts in a
 *   million at 5 seconds, but reads 1.7% low when keyframes are 300 seconds
 *   apart, because the velocity turns through many degrees in between.
 * - Blending the two keyframe speeds is as good at 5 seconds and three
 *   times better at 300.
 *
 * So the speed is the blend of the two keyframe speeds, and the direction
 * is that of the curve's slope. SIMPLIFICATION: at the widest keyframe
 * spacing the speed can still be 0.6% out for an elongated orbit.
 *
 * @param dt seconds from the first keyframe to the second (may be negative, not zero)
 * @param s  fraction of the way from the first keyframe to the second
 */
export function interpolateState(
  p0: Triple,
  v0: Triple,
  p1: Triple,
  v1: Triple,
  dt: number,
  s: number,
): { position: [number, number, number]; velocity: [number, number, number] } {
  const position: [number, number, number] = [
    hermite(p0[0], v0[0], p1[0], v1[0], dt, s),
    hermite(p0[1], v0[1], p1[1], v1[1], dt, s),
    hermite(p0[2], v0[2], p1[2], v1[2], dt, s),
  ];
  const slope: [number, number, number] = [
    hermiteVelocity(p0[0], v0[0], p1[0], v1[0], dt, s),
    hermiteVelocity(p0[1], v0[1], p1[1], v1[1], dt, s),
    hermiteVelocity(p0[2], v0[2], p1[2], v1[2], dt, s),
  ];
  const slopeLength = Math.hypot(slope[0], slope[1], slope[2]);
  const speed0 = Math.hypot(v0[0], v0[1], v0[2]);
  const speed1 = Math.hypot(v1[0], v1[1], v1[2]);
  const speed = speed0 + (speed1 - speed0) * s;
  // An object that is not moving has no direction to give its velocity.
  const scale = slopeLength === 0 ? 0 : speed / slopeLength;
  return {
    position,
    velocity: [slope[0] * scale, slope[1] * scale, slope[2] * scale],
  };
}
