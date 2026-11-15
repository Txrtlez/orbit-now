import { describe, expect, it } from 'vitest';
import { WGS84_A_KM, WGS84_B_KM } from '../geo/wgs84';
import { buildGraticulePositions } from './graticule';

describe('buildGraticulePositions', () => {
  it('produces the expected number of segments for a 30 degree grid sampled every 2 degrees', () => {
    const positions = buildGraticulePositions(30, 2);
    // 12 meridians x 90 segments + 5 parallels x 180 segments = 1980 segments,
    // each with 2 vertices of 3 coordinates.
    expect(positions.length).toBe(1980 * 2 * 3);
  });

  it('places every vertex on the ellipsoid, expressed in scene units', () => {
    const positions = buildGraticulePositions(30, 5);
    const polarRadiusScene = WGS84_B_KM / WGS84_A_KM;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] ?? Number.NaN;
      const y = positions[i + 1] ?? Number.NaN;
      const z = positions[i + 2] ?? Number.NaN;
      // Scene y is the polar axis, so it is the coordinate divided by b/a.
      const value = x * x + z * z + (y * y) / (polarRadiusScene * polarRadiusScene);
      // Float32 storage limits agreement to roughly 7 significant digits.
      expect(Math.abs(value - 1)).toBeLessThan(1e-6);
    }
  });

  it('includes the equator and reaches both poles', () => {
    const positions = buildGraticulePositions(30, 5);
    let maxY = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let equatorVertices = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1] ?? Number.NaN;
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
      if (y === 0) {
        equatorVertices += 1;
      }
    }
    const polarRadiusScene = WGS84_B_KM / WGS84_A_KM;
    expect(maxY).toBeCloseTo(polarRadiusScene, 6);
    expect(minY).toBeCloseTo(-polarRadiusScene, 6);
    // The equator parallel alone contributes 72 segments = 144 vertices.
    expect(equatorVertices).toBeGreaterThanOrEqual(144);
  });

  it('rejects steps that would leave gaps in the grid', () => {
    expect(() => buildGraticulePositions(0, 1)).toThrow(RangeError);
    expect(() => buildGraticulePositions(50, 5)).toThrow(RangeError);
    expect(() => buildGraticulePositions(30, 4)).toThrow(RangeError);
    expect(() => buildGraticulePositions(30, 2.5)).toThrow(RangeError);
  });
});
