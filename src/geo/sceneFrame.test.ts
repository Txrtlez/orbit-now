import { describe, expect, it } from 'vitest';
import { ecefKmToScene, KM_PER_SCENE_UNIT } from './sceneFrame';
import { WGS84_A_KM } from './wgs84';

type Vec3 = [number, number, number];

function toScene(x: number, y: number, z: number): Vec3 {
  const out: Vec3 = [0, 0, 0];
  ecefKmToScene(x, y, z, out);
  return out;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

describe('ecefKmToScene', () => {
  it('uses the WGS 84 equatorial radius as the scene unit', () => {
    expect(KM_PER_SCENE_UNIT).toBe(WGS84_A_KM);
    expect(toScene(WGS84_A_KM, 0, 0)).toEqual([1, 0, 0]);
  });

  it('maps the north pole direction to scene +y (up)', () => {
    expect(toScene(0, 0, WGS84_A_KM)).toEqual([0, 1, 0]);
  });

  it('maps ECEF +y (90 degrees east) to scene -z', () => {
    expect(toScene(0, WGS84_A_KM, 0)).toEqual([0, 0, -1]);
  });

  it('preserves handedness, so prograde motion stays prograde', () => {
    // In ECEF, x cross y = z. A proper rotation must keep that relation true
    // for the mapped vectors; a mirror would give the negative.
    const x = toScene(WGS84_A_KM, 0, 0);
    const y = toScene(0, WGS84_A_KM, 0);
    const z = toScene(0, 0, WGS84_A_KM);
    const result = cross(x, y);
    expect(result[0]).toBeCloseTo(z[0], 12);
    expect(result[1]).toBeCloseTo(z[1], 12);
    expect(result[2]).toBeCloseTo(z[2], 12);
  });

  it('preserves lengths up to the unit scale', () => {
    const [sx, sy, sz] = toScene(1234.5, -6789.25, 4321.125);
    const lengthKm = Math.hypot(1234.5, -6789.25, 4321.125);
    expect(Math.hypot(sx, sy, sz) * KM_PER_SCENE_UNIT).toBeCloseTo(lengthKm, 9);
  });

  it('writes at the requested offset without touching other elements', () => {
    const out = new Float64Array([9, 9, 9, 9, 9, 9, 9]);
    ecefKmToScene(WGS84_A_KM, 2 * WGS84_A_KM, 3 * WGS84_A_KM, out, 3);
    expect(Array.from(out)).toEqual([9, 9, 9, 1, 3, -2, 9]);
  });
});
