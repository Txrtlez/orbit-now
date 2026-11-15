import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { SceneLayer } from './globe';

/** Line thickness in CSS pixels. */
const LINE_WIDTH_CSS_PX = 1.75;

export interface OrbitPathLayer extends SceneLayer {
  /**
   * Draw a path through the given points (x, y, z per point, scene
   * coordinates), replacing any path already shown. An array with fewer
   * than two points removes the path.
   */
  setPath(points: Float32Array): void;
  dispose(): void;
}

/**
 * The orbit of the selected object, drawn as a line in the inertial frame.
 *
 * three.js's "wide line" objects are used because plain WebGL lines are
 * always exactly one device pixel wide, which is a hairline on a phone
 * screen. The line is tested against the depth buffer like everything else,
 * so the half of the orbit behind the Earth is hidden, which is what makes
 * the path read as going around the planet.
 */
export function createOrbitPathLayer(): OrbitPathLayer {
  const material = new LineMaterial({
    color: 0x7cc4ff,
    linewidth: LINE_WIDTH_CSS_PX,
    depthWrite: false,
  });
  let geometry = new LineGeometry();
  const line = new Line2(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 2;
  line.visible = false;

  return {
    object: line,
    setPath(points: Float32Array): void {
      // A LineGeometry cannot grow once it has been drawn, so a new path gets a new one.
      geometry.dispose();
      geometry = new LineGeometry();
      line.geometry = geometry;
      if (points.length < 6) {
        line.visible = false;
        return;
      }
      geometry.setPositions(points);
      line.visible = true;
    },
    update(): void {
      // Nothing changes from frame to frame: the path is fixed in the
      // inertial frame, and three.js keeps the line's pixel width up to date.
    },
    dispose(): void {
      geometry.dispose();
      material.dispose();
    },
  };
}
