import { BufferAttribute, BufferGeometry, Group, Points, ShaderMaterial } from 'three';
import { geodeticToEcef } from '../geo/geodetic';
import { ecefKmToScene } from '../geo/sceneFrame';
import { gmstRadians } from '../orbit/time';
import type { FrameInfo, SceneLayer } from './globe';

/** Diameter of the marker in CSS pixels. */
const MARKER_SIZE_CSS_PX = 18;
/**
 * The marker floats this far above the ground, in kilometres, so that it is
 * not half-buried in the surface it is drawn on. DECORATION: the height
 * means nothing.
 */
const MARKER_HEIGHT_KM = 30;

const VERTEX_SHADER = /* glsl */ `
  uniform float uPointSize;

  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize;
  }
`;

// DECORATION. A filled dot inside a ring, in a colour no object group uses.
const FRAGMENT_SHADER = /* glsl */ `
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float dot = 1.0 - smoothstep(0.30, 0.40, r);
    float ring = smoothstep(0.62, 0.70, r) * (1.0 - smoothstep(0.90, 0.98, r));
    float alpha = max(dot, ring);
    if (alpha < 0.02) {
      discard;
    }
    gl_FragColor = vec4(0.45, 1.0, 0.72, alpha);
  }
`;

export interface ObserverMarker extends SceneLayer {
  /** Show the marker at a place (degrees, north and east positive), or hide it with null. */
  setPlace(place: { readonly latitudeDeg: number; readonly longitudeDeg: number } | null): void;
  dispose(): void;
}

/**
 * A mark on the Earth where the viewer has said they are. It turns with
 * the Earth, and is hidden when it is on the far side.
 */
export function createObserverMarker(): ObserverMarker {
  const geometry = new BufferGeometry();
  const position = new Float32Array(3);
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  const uniforms = { uPointSize: { value: MARKER_SIZE_CSS_PX } };
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 3;
  // The point is placed in Earth-fixed coordinates; the group is turned
  // with the Earth every frame, exactly as the globe's own surface is.
  const group = new Group();
  group.add(points);
  group.visible = false;

  return {
    object: group,
    setPlace(place): void {
      group.visible = place !== null;
      if (place === null) {
        return;
      }
      const ecef = geodeticToEcef(
        (place.latitudeDeg * Math.PI) / 180,
        (place.longitudeDeg * Math.PI) / 180,
        MARKER_HEIGHT_KM,
      );
      ecefKmToScene(ecef.x, ecef.y, ecef.z, position);
      const attribute = geometry.getAttribute('position');
      attribute.needsUpdate = true;
    },
    update({ nowMs, pixelRatio }: FrameInfo): void {
      group.rotation.y = gmstRadians(nowMs);
      uniforms.uPointSize.value = MARKER_SIZE_CSS_PX * pixelRatio;
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
