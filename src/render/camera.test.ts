import { describe, expect, it } from 'vitest';
import { fitSphereDistance } from './camera';

describe('fitSphereDistance', () => {
  it('matches the closed form r / sin(fov / 2) when the vertical angle limits', () => {
    // 60 degree vertical field of view, landscape viewport: half-angle 30 degrees,
    // sin(30 degrees) = 1/2, so the unit sphere just fits at distance 2.
    expect(fitSphereDistance(1, 60, 16 / 9, 1)).toBeCloseTo(2, 12);
  });

  it('gives the same answer for a square viewport, where both angles are equal', () => {
    expect(fitSphereDistance(1, 60, 1, 1)).toBeCloseTo(2, 12);
  });

  it('moves the camera back on a portrait viewport, where the horizontal angle limits', () => {
    const landscape = fitSphereDistance(1, 45, 16 / 9, 1);
    const portrait = fitSphereDistance(1, 45, 9 / 16, 1);
    expect(portrait).toBeGreaterThan(landscape);

    // Independent check: at the returned distance the sphere's angular radius
    // equals the horizontal half field of view.
    const halfHorizontal = Math.atan((9 / 16) * Math.tan((45 * Math.PI) / 360));
    expect(Math.asin(1 / portrait)).toBeCloseTo(halfHorizontal, 12);
  });

  it('scales linearly with radius and margin', () => {
    const base = fitSphereDistance(1, 45, 1.5, 1);
    expect(fitSphereDistance(3, 45, 1.5, 1)).toBeCloseTo(3 * base, 12);
    expect(fitSphereDistance(1, 45, 1.5, 1.25)).toBeCloseTo(1.25 * base, 12);
  });

  it('rejects non-physical inputs', () => {
    expect(() => fitSphereDistance(0, 45, 1, 1)).toThrow(RangeError);
    expect(() => fitSphereDistance(1, 0, 1, 1)).toThrow(RangeError);
    expect(() => fitSphereDistance(1, 180, 1, 1)).toThrow(RangeError);
    expect(() => fitSphereDistance(1, 45, 0, 1)).toThrow(RangeError);
    expect(() => fitSphereDistance(1, 45, Number.NaN, 1)).toThrow(RangeError);
  });
});
