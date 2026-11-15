/**
 * Working out which object, if any, is under the pointer.
 *
 * Done on the main thread in plain arithmetic, not by reading pixels back
 * from the graphics card: with about 20 000 objects it takes well under a
 * millisecond, it gives exactly the same answer on every device, and it can
 * be unit-tested without a browser.
 */

/** A point in scene coordinates. */
export interface ScenePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Does the straight line from `from` to `to` pass through a sphere of the
 * given radius centred on the origin?
 *
 * Used to decide whether the Earth hides an object from the camera. Points
 * on the line are from + t (to - from); substituting into |p|^2 = r^2 gives
 * a quadratic in t, and the Earth is in the way if its nearer root lies
 * strictly between the two end points.
 */
export function segmentHitsSphere(from: ScenePoint, to: ScenePoint, radius: number): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const a = dx * dx + dy * dy + dz * dz;
  if (a === 0) {
    return false;
  }
  const b = 2 * (from.x * dx + from.y * dy + from.z * dz);
  const c = from.x * from.x + from.y * from.y + from.z * from.z - radius * radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return false;
  }
  const nearRoot = (-b - Math.sqrt(discriminant)) / (2 * a);
  return nearRoot > 0 && nearRoot < 1;
}

/** Where a scene point falls on the screen. */
export interface ScreenPoint {
  /** Pixels from the left edge of the view. */
  readonly x: number;
  /** Pixels from the top edge of the view. */
  readonly y: number;
  /** Distance in front of the camera, in the units of the projection (larger is farther). */
  readonly depth: number;
}

/**
 * Project a scene point to view coordinates in pixels.
 *
 * @param viewProjection the camera's projection matrix multiplied by its
 *                       view matrix: 16 numbers in column-major order, as
 *                       three.js and WebGL store matrices
 * @returns null if the point is behind the camera or outside the depth
 *          range the camera draws
 */
export function projectToScreen(
  x: number,
  y: number,
  z: number,
  viewProjection: ArrayLike<number>,
  width: number,
  height: number,
): ScreenPoint | null {
  const m = viewProjection;
  const clipW = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
  if (!(clipW > 0)) {
    return null;
  }
  const clipZ = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
  if (clipZ < -clipW || clipZ > clipW) {
    return null;
  }
  const clipX = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
  const clipY = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
  return {
    x: (clipX / clipW / 2 + 0.5) * width,
    // Screen y runs downwards; the projection's y runs upwards.
    y: (0.5 - clipY / clipW / 2) * height,
    depth: clipW,
  };
}

export interface PickRequest {
  /** x, y, z per object in scene coordinates. (0, 0, 0) marks an object with no position. */
  readonly positions: Float32Array;
  /**
   * One number per object; an object whose entry is 0 is not drawn and
   * cannot be picked. Pass null if every object is drawn.
   */
  readonly states: Uint8Array | null;
  /** Projection matrix times view matrix, column-major. */
  readonly viewProjection: ArrayLike<number>;
  /** Camera position in scene coordinates. */
  readonly camera: ScenePoint;
  /** Size of the view in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Pointer position in CSS pixels from the view's top-left corner. */
  readonly pointerX: number;
  readonly pointerY: number;
  /** How far from the pointer an object may be and still count, in CSS pixels. */
  readonly radiusPx: number;
  /** Radius of the sphere that hides objects behind it (the Earth), in scene units. */
  readonly occluderRadius: number;
}

/**
 * Find the object nearest the pointer on screen.
 *
 * An object qualifies if it is drawn, in front of the camera, within
 * `radiusPx` of the pointer, and not hidden behind the Earth. Among those,
 * the one closest to the pointer wins; if two are equally close, the one
 * nearer the camera wins, because that is the one drawn on top.
 *
 * @returns the object's index, or -1 if nothing qualifies
 */
export function pickObject(request: PickRequest): number {
  const { positions, states, viewProjection, camera, width, height, pointerX, pointerY } = request;
  const count = Math.floor(positions.length / 3);
  const radiusSquared = request.radiusPx * request.radiusPx;

  let best = -1;
  let bestDistanceSquared = Infinity;
  let bestDepth = Infinity;

  for (let i = 0; i < count; i += 1) {
    if (states !== null && states[i] === 0) {
      continue;
    }
    const x = positions[i * 3] ?? 0;
    const y = positions[i * 3 + 1] ?? 0;
    const z = positions[i * 3 + 2] ?? 0;
    // The propagator writes the origin for an object it could not place.
    if (x * x + y * y + z * z < 0.25) {
      continue;
    }
    const screen = projectToScreen(x, y, z, viewProjection, width, height);
    if (screen === null) {
      continue;
    }
    const dx = screen.x - pointerX;
    const dy = screen.y - pointerY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > radiusSquared) {
      continue;
    }
    const better =
      distanceSquared < bestDistanceSquared ||
      (distanceSquared === bestDistanceSquared && screen.depth < bestDepth);
    if (!better) {
      continue;
    }
    // The comparatively expensive test is left until last, so it runs only
    // for the few objects that are near the pointer.
    if (segmentHitsSphere(camera, { x, y, z }, request.occluderRadius)) {
      continue;
    }
    best = i;
    bestDistanceSquared = distanceSquared;
    bestDepth = screen.depth;
  }
  return best;
}
