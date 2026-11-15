import { BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import type { FrameInfo, SceneLayer } from './globe';

/** Outer diameter of the ring in CSS pixels. */
const MARKER_SIZE_CSS_PX = 26;

const VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

// DECORATION. A ring, so that the object's own dot stays visible in the middle.
const FRAGMENT_SHADER = /* glsl */ `
  void main() {
    // 0 at the centre of the point, 1 at the edge of the inscribed circle.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float ring = smoothstep(0.58, 0.66, r) * (1.0 - smoothstep(0.88, 0.98, r));
    if (ring < 0.02) {
      discard;
    }
    gl_FragColor = vec4(1.0, 0.82, 0.4, ring);
  }
`;

export interface SelectionMarker extends SceneLayer {
  /** Show the ring and keep it at the position `locate` returns; pass null to hide it. */
  follow(locate: ((nowMs: number) => readonly [number, number, number] | null) | null): void;
  dispose(): void;
}

/**
 * A ring drawn around the selected object. It is hidden behind the Earth
 * like the object itself, so it never suggests the object can be seen
 * through the planet.
 */
export function createSelectionMarker(): SelectionMarker {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  const uniforms = { uPointSize: { value: MARKER_SIZE_CSS_PX } };
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  // The vertex is at the object's origin and the object is moved instead, so
  // three.js's own visibility test uses the right place.
  points.frustumCulled = false;
  points.renderOrder = 3;
  points.visible = false;

  let locate: ((nowMs: number) => readonly [number, number, number] | null) | null = null;

  return {
    object: points,
    follow(next): void {
      locate = next;
      if (next === null) {
        points.visible = false;
      }
    },
    update({ nowMs, pixelRatio }: FrameInfo): void {
      const position = locate === null ? null : locate(nowMs);
      points.visible = position !== null;
      if (position !== null) {
        points.position.set(position[0], position[1], position[2]);
        uniforms.uPointSize.value = MARKER_SIZE_CSS_PX * pixelRatio;
      }
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
