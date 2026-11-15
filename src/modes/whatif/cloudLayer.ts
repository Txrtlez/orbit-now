import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from 'three';
import type { FrameInfo, SceneLayer } from '../../render/globe';
import { cloudPositions } from '../../sim/cloud';
import type { SimFragment } from '../../sim/simulate';

/**
 * The simulated fragments, drawn over the globe.
 *
 * They are drawn larger than the tracker's dots and in two colours of
 * their own, one per parent body, so that nobody can take a simulated
 * fragment for a tracked object.
 */

/** One colour per parent body. Neither is used for anything in the tracker. */
export const CLOUD_COLOURS = ['#ffd84d', '#ff6fb1'] as const;

/** Width of a fragment's dot, in CSS pixels. */
const DOT_CSS_PX = 3;

export interface CloudLayer extends SceneLayer {
  /** Replace the cloud. Null removes it. */
  setCloud(fragments: readonly SimFragment[] | null): void;
  /**
   * Show the cloud as it is this long after the break-up.
   *
   * @returns how many fragments are still in orbit then
   */
  setMoment(years: number): number;
  setVisible(visible: boolean): void;
}

/**
 * @param kmPerSceneUnit the tracker's Earth radius in kilometres
 */
export function createCloudLayer(kmPerSceneUnit: number): CloudLayer {
  const geometry = new BufferGeometry();
  const material = new PointsMaterial({
    size: DOT_CSS_PX,
    sizeAttenuation: false,
    vertexColors: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  // After the tracker's own dots, so that fragments are not hidden under them.
  points.renderOrder = 5;

  const palette = CLOUD_COLOURS.map((css) => new Color(css));
  let cloud: readonly SimFragment[] = [];
  let positions = new Float32Array(0);
  let colours = new Float32Array(0);
  let parents = new Uint8Array(0);

  return {
    object: points,
    update(frame: FrameInfo): void {
      material.size = DOT_CSS_PX * frame.pixelRatio;
    },
    setCloud(fragments): void {
      cloud = fragments ?? [];
      positions = new Float32Array(cloud.length * 3);
      colours = new Float32Array(cloud.length * 3);
      parents = new Uint8Array(cloud.length);
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setAttribute('color', new BufferAttribute(colours, 3));
      geometry.setDrawRange(0, 0);
    },
    setMoment(years): number {
      const drawn = cloudPositions(cloud, years, kmPerSceneUnit, positions, parents);
      for (let k = 0; k < drawn; k += 1) {
        const colour = palette[parents[k] ?? 0] ?? palette[0];
        colours[k * 3] = colour?.r ?? 1;
        colours[k * 3 + 1] = colour?.g ?? 1;
        colours[k * 3 + 2] = colour?.b ?? 1;
      }
      geometry.setDrawRange(0, drawn);
      const position = geometry.getAttribute('position');
      const colour = geometry.getAttribute('color');
      position.needsUpdate = true;
      colour.needsUpdate = true;
      return drawn;
    },
    setVisible(visible): void {
      points.visible = visible;
    },
  };
}
