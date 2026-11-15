import { BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial } from 'three';
import { hermite } from '../orbit/hermite';
import type { Keyframe, PropagationClient } from '../orbit/propagationClient';
import type { FrameInfo, SceneLayer } from './globe';

/**
 * Draws every object as a dot and moves all of them every frame.
 *
 * How the motion works. The background thread supplies "keyframes": every
 * object's position and velocity at one instant. Two keyframes, 5 seconds
 * apart, live on the graphics card at any time. For each frame, the vertex
 * shader places each dot on the cubic curve through its two keyframes (see
 * src/orbit/hermite.ts). The per-frame cost on the main thread is therefore
 * two numbers, however many objects there are.
 *
 * When the clock passes the later keyframe, the next one (already computed
 * in the background) overwrites the earlier one. Because the interpolation
 * formula does not care which keyframe comes first in time, nothing has to
 * be swapped or re-uploaded beyond that one keyframe.
 *
 * How filtering and highlighting work. Each object carries one small number,
 * its display state: hidden, dimmed, normal or emphasised. Changing a
 * filter or a selection rewrites that one array of bytes; the positions are
 * untouched. The dots are drawn in two passes over the same data, dimmed
 * ones first and the rest second, so that a dimmed dot can never cover a
 * bright one.
 */

/** Time between keyframes. The interpolation error at this spacing is measured in VALIDATION.md, V3.3. */
export const KEYFRAME_INTERVAL_MS = 5000;

/** If the clock gets this many intervals past the newest keyframe, the layer is restarted instead of extrapolating. */
const STALL_INTERVALS = 3;

/** Dot diameter in CSS pixels on a view at least `FULL_SIZE_VIEW_CSS_PX` across. */
const POINT_SIZE_CSS_PX = 2.4;
/**
 * On a smaller view the Earth is drawn smaller, so dots of the same size
 * would crowd together. They are shrunk in proportion, down to this fraction.
 */
const MIN_POINT_SCALE = 0.7;
const FULL_SIZE_VIEW_CSS_PX = 700;

/** Display state: not drawn, and cannot be picked. */
export const OBJECT_HIDDEN = 0;
/** Display state: drawn smaller and darker, behind everything else. */
export const OBJECT_DIMMED = 1;
/** Display state: drawn normally. */
export const OBJECT_NORMAL = 2;
/** Display state: drawn larger, to stand out. */
export const OBJECT_EMPHASISED = 3;

const VERTEX_SHADER = /* glsl */ `
  // Keyframe X is in the built-in "position" attribute plus aVelX;
  // keyframe Y is in aPosY and aVelY.
  attribute vec3 aVelX;
  attribute vec3 aPosY;
  attribute vec3 aVelY;
  attribute vec3 aColour;
  attribute float aState;   // 0 hidden, 1 dimmed, 2 normal, 3 emphasised

  uniform float uS;         // fraction of the way from keyframe X to keyframe Y
  uniform float uDelta;     // seconds from keyframe X to keyframe Y (may be negative)
  uniform float uPointSize; // dot diameter in device pixels
  uniform float uPass;      // 0: draw only dimmed dots; 1: draw normal and emphasised dots

  varying vec3 vColour;

  void main() {
    float s2 = uS * uS;
    float s3 = s2 * uS;
    float h00 = 2.0 * s3 - 3.0 * s2 + 1.0;
    float h10 = s3 - 2.0 * s2 + uS;
    float h01 = -2.0 * s3 + 3.0 * s2;
    float h11 = s3 - s2;
    vec3 p = h00 * position + h10 * uDelta * aVelX + h01 * aPosY + h11 * uDelta * aVelY;

    // The propagator writes (0, 0, 0) for an object it could not propagate.
    // Nothing real is within half an Earth radius of the centre.
    bool valid = dot(position, position) > 0.25 && dot(aPosY, aPosY) > 0.25;
    bool dimmed = aState > 0.5 && aState < 1.5;
    bool inThisPass = uPass < 0.5 ? dimmed : aState > 1.5;

    gl_Position = valid && inThisPass
      ? projectionMatrix * modelViewMatrix * vec4(p, 1.0)
      : vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = uPointSize * (aState > 2.5 ? 1.7 : (dimmed ? 0.8 : 1.0));
    vColour = aColour * (dimmed ? 0.3 : 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColour;

  void main() {
    // Points are drawn as squares; keep only the inscribed disc.
    vec2 fromCentre = gl_PointCoord - 0.5;
    if (dot(fromCentre, fromCentre) > 0.25) {
      discard;
    }
    gl_FragColor = vec4(vColour, 1.0);
  }
`;

/** One object's position and velocity at an instant, in scene coordinates. */
export interface SceneState {
  /** x, y, z in scene units (Earth radii, inertial frame, y north). */
  readonly position: readonly [number, number, number];
  /** x, y, z in scene units per second. */
  readonly velocity: readonly [number, number, number];
}

export interface SatelliteLayer extends SceneLayer {
  /** Number of objects the propagator could not place in the most recent keyframe. */
  readonly failures: () => number;
  /** Resolves when the first pair of keyframes is on the graphics card and dots are visible. */
  readonly ready: Promise<void>;
  /**
   * Set every object's display state (OBJECT_HIDDEN, OBJECT_DIMMED,
   * OBJECT_NORMAL or OBJECT_EMPHASISED). The array is copied.
   */
  setStates(states: Uint8Array): void;
  /** The display states currently in effect. Do not modify the returned array. */
  states(): Uint8Array;
  /**
   * Compute where every object is drawn at `nowMs`, with the same formula
   * the graphics card uses, into `out` (three numbers per object).
   *
   * @returns false if there are no keyframes yet, in which case `out` is untouched
   */
  positionsAt(nowMs: number, out: Float32Array): boolean;
  /** One object's position and velocity at `nowMs`, or null if it has no position. */
  stateAt(index: number, nowMs: number): SceneState | null;
  dispose(): void;
}

/**
 * @param count   number of objects
 * @param colours red, green, blue (0 to 255) per object
 * @param client  the background propagation thread, already initialised for these objects
 * @param nowMs   returns the current time; injected so that it can later be a controllable clock
 */
export function createSatelliteLayer(
  count: number,
  colours: Uint8Array,
  client: PropagationClient,
  nowMs: () => number,
): SatelliteLayer {
  const geometry = new BufferGeometry();
  const posX = new BufferAttribute(new Float32Array(count * 3), 3);
  const velX = new BufferAttribute(new Float32Array(count * 3), 3);
  const posY = new BufferAttribute(new Float32Array(count * 3), 3);
  const velY = new BufferAttribute(new Float32Array(count * 3), 3);
  const stateAttribute = new BufferAttribute(new Uint8Array(count).fill(OBJECT_NORMAL), 1);
  geometry.setAttribute('position', posX);
  geometry.setAttribute('aVelX', velX);
  geometry.setAttribute('aPosY', posY);
  geometry.setAttribute('aVelY', velY);
  geometry.setAttribute('aColour', new BufferAttribute(colours, 3, true));
  geometry.setAttribute('aState', stateAttribute);

  // The two passes share these, so one assignment per frame updates both.
  const shared = {
    uS: { value: 0 },
    uDelta: { value: 1 },
    uPointSize: { value: POINT_SIZE_CSS_PX },
  };
  const makePass = (pass: 0 | 1): { points: Points; material: ShaderMaterial } => {
    const material = new ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { ...shared, uPass: { value: pass } },
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    // Positions are computed in the shader, so three.js cannot know where the
    // dots are and must not try to skip the layer when it thinks it is off-screen.
    points.frustumCulled = false;
    points.renderOrder = pass;
    return { points, material };
  };
  const dimmedPass = makePass(0);
  const mainPass = makePass(1);

  const group = new Group();
  group.add(dimmedPass.points, mainPass.points);
  group.visible = false;

  const slots = [
    { position: posX, velocity: velX, timeMs: Number.NaN },
    { position: posY, velocity: velY, timeMs: Number.NaN },
  ] satisfies [unknown, unknown];
  type SlotIndex = 0 | 1;

  let newer: SlotIndex = 1;
  let next: Keyframe | null = null;
  let lastFailures = 0;
  let disposed = false;
  // Incremented on every restart so that answers to requests made before the
  // restart are recognised as out of date and ignored.
  let generation = 0;

  const write = (index: SlotIndex, keyframe: Keyframe): void => {
    const slot = slots[index];
    slot.position.array.set(keyframe.positions);
    slot.velocity.array.set(keyframe.velocities);
    slot.position.needsUpdate = true;
    slot.velocity.needsUpdate = true;
    slot.timeMs = keyframe.unixMs;
    lastFailures = keyframe.failures;
  };

  const requestNext = (): void => {
    const requestGeneration = generation;
    void client.requestKeyframe(slots[newer].timeMs + KEYFRAME_INTERVAL_MS).then((keyframe) => {
      if (requestGeneration === generation && !disposed) {
        next = keyframe;
      }
    });
  };

  /** Fetch a fresh pair of keyframes around the current time and show the dots when they arrive. */
  const restart = async (): Promise<void> => {
    generation += 1;
    const requestGeneration = generation;
    group.visible = false;
    next = null;
    const start = nowMs();
    const [first, second] = await Promise.all([
      client.requestKeyframe(start),
      client.requestKeyframe(start + KEYFRAME_INTERVAL_MS),
    ]);
    if (requestGeneration !== generation || disposed) {
      return;
    }
    write(0, first);
    write(1, second);
    newer = 1;
    group.visible = true;
    requestNext();
  };

  const ready = restart();

  /** The interpolation parameters for an instant: the same two numbers the shader receives. */
  const interpolationAt = (now: number): { s: number; deltaSeconds: number } => {
    const spanMs = slots[1].timeMs - slots[0].timeMs;
    return { s: (now - slots[0].timeMs) / spanMs, deltaSeconds: spanMs / 1000 };
  };

  return {
    object: group,
    ready,
    failures: () => lastFailures,
    update({ nowMs: now, pixelRatio, viewMinCssPx }: FrameInfo): void {
      if (!group.visible) {
        return;
      }
      const newestMs = slots[newer].timeMs;
      const older: SlotIndex = newer === 1 ? 0 : 1;

      // The page was in the background, the device slept, or the clock was
      // changed: the keyframes no longer bracket "now". Start again.
      if (
        now > newestMs + STALL_INTERVALS * KEYFRAME_INTERVAL_MS ||
        now < slots[older].timeMs - KEYFRAME_INTERVAL_MS
      ) {
        void restart();
        return;
      }

      if (now >= newestMs && next !== null) {
        write(older, next);
        newer = older;
        next = null;
        requestNext();
      }

      const { s, deltaSeconds } = interpolationAt(now);
      shared.uS.value = s;
      shared.uDelta.value = deltaSeconds;
      const scale = Math.min(1, Math.max(MIN_POINT_SCALE, viewMinCssPx / FULL_SIZE_VIEW_CSS_PX));
      shared.uPointSize.value = POINT_SIZE_CSS_PX * scale * pixelRatio;
    },
    setStates(states: Uint8Array): void {
      if (states.length !== count) {
        throw new RangeError('There must be exactly one display state per object');
      }
      stateAttribute.array.set(states);
      stateAttribute.needsUpdate = true;
    },
    states: () => stateAttribute.array as Uint8Array,
    positionsAt(now: number, out: Float32Array): boolean {
      if (!group.visible) {
        return false;
      }
      if (out.length !== count * 3) {
        throw new RangeError('The output array must hold exactly three numbers per object');
      }
      const { s, deltaSeconds } = interpolationAt(now);
      const p0 = posX.array;
      const v0 = velX.array;
      const p1 = posY.array;
      const v1 = velY.array;
      // The same cubic as the vertex shader, with the weights worked out once.
      const s2 = s * s;
      const s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1;
      const h10 = (s3 - 2 * s2 + s) * deltaSeconds;
      const h01 = -2 * s3 + 3 * s2;
      const h11 = (s3 - s2) * deltaSeconds;
      for (let i = 0; i < out.length; i += 1) {
        out[i] = h00 * (p0[i] ?? 0) + h10 * (v0[i] ?? 0) + h01 * (p1[i] ?? 0) + h11 * (v1[i] ?? 0);
      }
      return true;
    },
    stateAt(index: number, now: number): SceneState | null {
      if (!group.visible || index < 0 || index >= count) {
        return null;
      }
      const { s, deltaSeconds } = interpolationAt(now);
      const component = (axis: 0 | 1 | 2): { position: number; velocity: number } => {
        const offset = index * 3 + axis;
        const p0 = posX.array[offset] ?? 0;
        const v0 = velX.array[offset] ?? 0;
        const p1 = posY.array[offset] ?? 0;
        const v1 = velY.array[offset] ?? 0;
        return {
          position: hermite(p0, v0, p1, v1, deltaSeconds, s),
          // Over five seconds the velocity changes almost linearly, and it is
          // only displayed to three figures.
          velocity: v0 + (v1 - v0) * s,
        };
      };
      const x = component(0);
      const y = component(1);
      const z = component(2);
      const startRadiusSquared =
        (posX.array[index * 3] ?? 0) ** 2 +
        (posX.array[index * 3 + 1] ?? 0) ** 2 +
        (posX.array[index * 3 + 2] ?? 0) ** 2;
      const endRadiusSquared =
        (posY.array[index * 3] ?? 0) ** 2 +
        (posY.array[index * 3 + 1] ?? 0) ** 2 +
        (posY.array[index * 3 + 2] ?? 0) ** 2;
      // Same rule as the shader: the origin marks an object that could not be propagated.
      if (startRadiusSquared <= 0.25 || endRadiusSquared <= 0.25) {
        return null;
      }
      return {
        position: [x.position, y.position, z.position],
        velocity: [x.velocity, y.velocity, z.velocity],
      };
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      geometry.dispose();
      dimmedPass.material.dispose();
      mainPass.material.dispose();
    },
  };
}
