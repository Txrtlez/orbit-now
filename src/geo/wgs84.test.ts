import { describe, expect, it } from 'vitest';
import { WGS84_A_KM, WGS84_B_KM, WGS84_E2, WGS84_F, WGS84_INVERSE_FLATTENING } from './wgs84';

describe('WGS 84 ellipsoid constants', () => {
  it('uses the WGS 84 defining parameters published by the NGA', () => {
    expect(WGS84_A_KM).toBe(6378.137);
    expect(WGS84_INVERSE_FLATTENING).toBe(298.257223563);
  });

  it('derives the published semi-minor axis, 6 356 752.3142 m', () => {
    // Published listings quote b to 0.1 mm; compare to within 0.05 mm (5e-8 km).
    expect(Math.abs(WGS84_B_KM - 6356.7523142)).toBeLessThan(5e-8);
  });

  it('derives the published first eccentricity squared, 6.69437999014e-3', () => {
    expect(Math.abs(WGS84_E2 - 6.69437999014e-3)).toBeLessThan(5e-15);
  });

  it('keeps the derived quantities mutually consistent', () => {
    // e^2 can also be written 1 - b^2 / a^2; both forms must agree.
    const fromAxes = 1 - (WGS84_B_KM * WGS84_B_KM) / (WGS84_A_KM * WGS84_A_KM);
    expect(Math.abs(fromAxes - WGS84_E2)).toBeLessThan(1e-15);
    expect(WGS84_F).toBeGreaterThan(0);
    expect(WGS84_F).toBeLessThan(0.01);
  });
});
