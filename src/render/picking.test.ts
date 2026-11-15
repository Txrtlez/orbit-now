import { Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { pickObject, projectToScreen, segmentHitsSphere, type PickRequest } from './picking';

const WIDTH = 800;
const HEIGHT = 600;

/** A camera on the +z axis looking at the origin, as the app's camera looks at the Earth. */
function cameraAt(distance: number): { viewProjection: number[]; position: Vector3 } {
  const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.05, 500);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return { viewProjection: matrix.toArray(), position: camera.position.clone() };
}

function request(
  points: readonly (readonly [number, number, number])[],
  pointerX: number,
  pointerY: number,
  overrides: Partial<PickRequest> = {},
): PickRequest {
  const { viewProjection, position } = cameraAt(4);
  return {
    positions: new Float32Array(points.flat()),
    states: null,
    viewProjection,
    camera: position,
    width: WIDTH,
    height: HEIGHT,
    pointerX,
    pointerY,
    radiusPx: 10,
    occluderRadius: 1,
    ...overrides,
  };
}

describe('segmentHitsSphere', () => {
  const camera = { x: 0, y: 0, z: 4 };

  it('says a point on the far side of the sphere is hidden', () => {
    expect(segmentHitsSphere(camera, { x: 0, y: 0, z: -1.1 }, 1)).toBe(true);
    expect(segmentHitsSphere(camera, { x: 0.5, y: 0.2, z: -2 }, 1)).toBe(true);
  });

  it('says a point on the near side, or off to the side, is visible', () => {
    expect(segmentHitsSphere(camera, { x: 0, y: 0, z: 1.1 }, 1)).toBe(false);
    expect(segmentHitsSphere(camera, { x: 1.2, y: 0, z: 0 }, 1)).toBe(false);
    // Behind the sphere's centre plane but far enough out to be seen past the edge.
    expect(segmentHitsSphere(camera, { x: 2, y: 0, z: -1 }, 1)).toBe(false);
  });

  it('handles the line that just grazes the sphere', () => {
    // From (0,0,4) the edge of a unit sphere is seen along lines making
    // sin(angle) = 1/4 with the axis. A point just outside that cone is visible.
    const tangentSlope = Math.tan(Math.asin(1 / 4));
    expect(segmentHitsSphere(camera, { x: 6 * tangentSlope * 1.001, y: 0, z: -2 }, 1)).toBe(false);
    expect(segmentHitsSphere(camera, { x: 6 * tangentSlope * 0.999, y: 0, z: -2 }, 1)).toBe(true);
  });

  it('does not report a hit for a zero-length segment', () => {
    expect(segmentHitsSphere(camera, camera, 1)).toBe(false);
  });
});

describe('projectToScreen', () => {
  const { viewProjection } = cameraAt(4);

  it('agrees with three.js for points across the view', () => {
    const camera = new PerspectiveCamera(45, WIDTH / HEIGHT, 0.05, 500);
    camera.position.set(0, 0, 4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const [x, y, z] of [
      [0, 0, 0],
      [1.2, 0.3, 0.5],
      [-0.8, -1.1, 1.5],
      [0.1, 1.4, -2],
    ] as const) {
      const expected = new Vector3(x, y, z).project(camera);
      const screen = projectToScreen(x, y, z, viewProjection, WIDTH, HEIGHT);
      expect(screen).not.toBeNull();
      expect(screen?.x).toBeCloseTo((expected.x / 2 + 0.5) * WIDTH, 9);
      expect(screen?.y).toBeCloseTo((0.5 - expected.y / 2) * HEIGHT, 9);
    }
  });

  it('puts the point the camera looks at in the middle of the view', () => {
    const screen = projectToScreen(0, 0, 0, viewProjection, WIDTH, HEIGHT);
    expect(screen?.x).toBeCloseTo(WIDTH / 2, 9);
    expect(screen?.y).toBeCloseTo(HEIGHT / 2, 9);
  });

  it('puts points above the centre nearer the top of the screen', () => {
    const screen = projectToScreen(0, 1, 0, viewProjection, WIDTH, HEIGHT);
    expect(screen?.y).toBeLessThan(HEIGHT / 2);
  });

  it('returns null for a point behind the camera', () => {
    expect(projectToScreen(0, 0, 5, viewProjection, WIDTH, HEIGHT)).toBeNull();
  });
});

describe('pickObject', () => {
  it('picks the object under the pointer', () => {
    const points = [
      [1.2, 0, 0],
      [0, 1.2, 0],
      [-1.2, 0, 0],
    ] as const;
    const { viewProjection } = cameraAt(4);
    const target = projectToScreen(0, 1.2, 0, viewProjection, WIDTH, HEIGHT);
    expect(pickObject(request(points, target?.x ?? 0, target?.y ?? 0))).toBe(1);
  });

  it('returns -1 when nothing is within the pick radius', () => {
    expect(pickObject(request([[1.2, 0, 0]], 10, 10))).toBe(-1);
  });

  it('prefers the object closest to the pointer on screen', () => {
    const { viewProjection } = cameraAt(4);
    const a = projectToScreen(1.2, 0, 0, viewProjection, WIDTH, HEIGHT);
    const points = [
      [1.2, 0, 0],
      [1.22, 0, 0],
    ] as const;
    const ax = a?.x ?? 0;
    const ay = a?.y ?? 0;
    expect(pickObject(request(points, ax - 1, ay))).toBe(0);
    expect(pickObject(request(points, ax + 4, ay))).toBe(1);
  });

  it('prefers the nearer of two objects that coincide on screen', () => {
    // Both on the camera's axis, so both project to the centre of the view.
    const points = [
      [0, 0, 1.1],
      [0, 0, 2],
    ] as const;
    expect(pickObject(request(points, WIDTH / 2, HEIGHT / 2))).toBe(1);
    expect(pickObject(request([...points].reverse(), WIDTH / 2, HEIGHT / 2))).toBe(0);
  });

  it('ignores objects hidden behind the Earth', () => {
    const points = [[0.2, 0, -1.5]] as const;
    const { viewProjection } = cameraAt(4);
    const screen = projectToScreen(0.2, 0, -1.5, viewProjection, WIDTH, HEIGHT);
    const x = screen?.x ?? 0;
    const y = screen?.y ?? 0;
    expect(pickObject(request(points, x, y))).toBe(-1);
    // The same object is pickable if the sphere is too small to be in the way.
    expect(pickObject(request(points, x, y, { occluderRadius: 0.1 }))).toBe(0);
  });

  it('ignores objects that are filtered out, and objects with no position', () => {
    const points = [
      [0, 0, 1.5],
      [0, 0, 0],
    ] as const;
    expect(
      pickObject(request(points, WIDTH / 2, HEIGHT / 2, { states: new Uint8Array([0, 2]) })),
    ).toBe(-1);
    expect(
      pickObject(request(points, WIDTH / 2, HEIGHT / 2, { states: new Uint8Array([1, 2]) })),
    ).toBe(0);
  });

  it('ignores objects behind the camera', () => {
    expect(pickObject(request([[0, 0, 6]], WIDTH / 2, HEIGHT / 2))).toBe(-1);
  });
});
