/**
 * Distance from the centre of a sphere at which a perspective camera sees the
 * whole sphere, with some margin, whatever the shape of the viewport.
 *
 * Geometry: a sphere of radius r seen from distance d subtends a half-angle
 * of asin(r / d). For the sphere to fit, that half-angle must not exceed the
 * camera's half field of view, so d >= r / sin(halfFov). A perspective camera
 * has a fixed vertical field of view; the horizontal one follows from the
 * aspect ratio via tan(halfH) = aspect * tan(halfV). On a portrait phone the
 * horizontal angle is the smaller of the two, so it is the one that limits.
 *
 * @param radius         sphere radius, in scene units
 * @param verticalFovDeg full vertical field of view, in degrees
 * @param aspect         viewport width divided by height
 * @param margin         multiplier above the exact fit (1 = touching the edges)
 */
export function fitSphereDistance(
  radius: number,
  verticalFovDeg: number,
  aspect: number,
  margin: number,
): number {
  if (!(radius > 0) || !(aspect > 0) || !(margin > 0)) {
    throw new RangeError('radius, aspect and margin must all be positive');
  }
  if (!(verticalFovDeg > 0 && verticalFovDeg < 180)) {
    throw new RangeError('verticalFovDeg must be between 0 and 180 degrees');
  }
  const halfVertical = (verticalFovDeg * Math.PI) / 360;
  const halfHorizontal = Math.atan(aspect * Math.tan(halfVertical));
  const limitingHalfAngle = Math.min(halfVertical, halfHorizontal);
  return (radius * margin) / Math.sin(limitingHalfAngle);
}
