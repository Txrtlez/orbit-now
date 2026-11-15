import { BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import type { Keyframe, PropagationClient } from '../orbit/propagationClient';

/**
 * Draws every object as a dot and moves all of them every frame.
 *
 * How the motion works. The background thread supplies "keyframes": every
 * object's position and velocity at one instant. Two keyframes, 5 seconds
 * apart, live on the graphics card at any time. For each frame, the vertex
 * shader places each dot on the cubic curve through its two keyframes (see
 * src/orbit/hermite.ts). The per-frame cost on the main thread is therefore
 * two numbers, however many objects there are, and everything is drawn in a
 * single draw call.
 *
 * When the clock passes the later keyframe, the next one (already computed
 * in the background) overwrites the earlier one. Because the interpolation
 * formula does not care which keyframe comes first in time, nothing has to
 * be swapped or re-uploaded beyond that one keyframe.
 */

/** Time between keyframes. The interpolation error at this spacing is measured in VALIDATION.md, V3.3. */
export const KEYFRAME_INTERVAL_MS = 5000;

/** If the clock gets this many intervals past the newest keyframe, the layer is restarted instead of extrapolating. */
const STALL_INTERVALS = 3;

/** Dot diameter in CSS pixels. */
const POINT_SIZE_CSS_PX = 2.4;

const VERTEX_SHADER = /* glsl */ `
  // Keyframe X is in the built-in "position" attribute plus aVelX;
  // keyframe Y is in aPosY and aVelY.
  attribute vec3 aVelX;
  attribute vec3 aPosY;
  attribute vec3 aVelY;
  attribute vec3 aColour;

  uniform float uS;         // fraction of the way from keyframe X to keyframe Y
  uniform float uDelta;     // seconds from keyframe X to keyframe Y (may be negative)
  uniform float uPointSize; // dot diameter in device pixels

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

    gl_Position = valid ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = uPointSize;
    vColour = aColour;
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

export interface SatelliteLayer {
  /** The drawable object to add to the scene (in the inertial frame, not attached to the rotating Earth). */
  readonly object: Points;
  /** Call once per frame, before rendering. */
  update(nowMs: number, pixelRatio: number): void;
  /** Number of objects the propagator could not place in the most recent keyframe. */
  readonly failures: () => number;
  /** Resolves when the first pair of keyframes is on the graphics card and dots are visible. */
  readonly ready: Promise<void>;
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
  geometry.setAttribute('position', posX);
  geometry.setAttribute('aVelX', velX);
  geometry.setAttribute('aPosY', posY);
  geometry.setAttribute('aVelY', velY);
  geometry.setAttribute('aColour', new BufferAttribute(colours, 3, true));

  const uniforms = {
    uS: { value: 0 },
    uDelta: { value: 1 },
    uPointSize: { value: POINT_SIZE_CSS_PX },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    depthWrite: false,
  });

  const points = new Points(geometry, material);
  // Positions are computed in the shader, so three.js cannot know where the
  // dots are and must not try to skip the layer when it thinks it is off-screen.
  points.frustumCulled = false;
  points.visible = false;

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
    points.visible = false;
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
    points.visible = true;
    requestNext();
  };

  const ready = restart();

  return {
    object: points,
    ready,
    failures: () => lastFailures,
    update(now: number, pixelRatio: number): void {
      if (!points.visible) {
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

      const spanMs = slots[1].timeMs - slots[0].timeMs;
      uniforms.uS.value = (now - slots[0].timeMs) / spanMs;
      uniforms.uDelta.value = spanMs / 1000;
      uniforms.uPointSize.value = POINT_SIZE_CSS_PX * pixelRatio;
    },
    dispose(): void {
      disposed = true;
      generation += 1;
      geometry.dispose();
      material.dispose();
    },
  };
}
