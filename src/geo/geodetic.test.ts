import { describe, expect, it } from 'vitest';
import { degToRad, ecefToGeodetic, geodeticToEcef, radToDeg } from './geodetic';
import { WGS84_A_KM, WGS84_B_KM, WGS84_E2 } from './wgs84';

/** One nanometre, expressed in kilometres. Used as a "numerically exact" tolerance. */
const TOLERANCE_KM = 1e-12 * WGS84_A_KM;

describe('geodeticToEcef', () => {
  it('places latitude 0, longitude 0 on the +x axis at the equatorial radius', () => {
    const p = geodeticToEcef(0, 0, 0);
    expect(p.x).toBeCloseTo(WGS84_A_KM, 9);
    expect(Math.abs(p.y)).toBeLessThan(TOLERANCE_KM);
    expect(Math.abs(p.z)).toBeLessThan(TOLERANCE_KM);
  });

  it('places 90 degrees east on the +y axis', () => {
    const p = geodeticToEcef(0, degToRad(90), 0);
    expect(Math.abs(p.x)).toBeLessThan(TOLERANCE_KM);
    expect(p.y).toBeCloseTo(WGS84_A_KM, 9);
    expect(Math.abs(p.z)).toBeLessThan(TOLERANCE_KM);
  });

  it('places the poles on the z axis at the polar radius', () => {
    const north = geodeticToEcef(degToRad(90), 0, 0);
    const south = geodeticToEcef(degToRad(-90), degToRad(123), 0);
    expect(north.z).toBeCloseTo(WGS84_B_KM, 9);
    expect(south.z).toBeCloseTo(-WGS84_B_KM, 9);
    expect(Math.hypot(north.x, north.y)).toBeLessThan(1e-9);
    expect(Math.hypot(south.x, south.y)).toBeLessThan(1e-9);
  });

  it('puts every zero-height point on the ellipsoid x^2/a^2 + y^2/a^2 + z^2/b^2 = 1', () => {
    for (let latDeg = -90; latDeg <= 90; latDeg += 7.5) {
      for (let lonDeg = -180; lonDeg < 180; lonDeg += 37) {
        const p = geodeticToEcef(degToRad(latDeg), degToRad(lonDeg), 0);
        const value =
          (p.x * p.x + p.y * p.y) / (WGS84_A_KM * WGS84_A_KM) +
          (p.z * p.z) / (WGS84_B_KM * WGS84_B_KM);
        expect(Math.abs(value - 1)).toBeLessThan(1e-12);
      }
    }
  });

  it('satisfies the geocentric/geodetic latitude identity tan(lat_c) = (1 - e^2) tan(lat)', () => {
    // This is an independent check: the identity is derived from the ellipse
    // equation, not from the conversion formulas used in the implementation.
    for (const latDeg of [-75, -30, 10, 45, 60, 85]) {
      const lat = degToRad(latDeg);
      const p = geodeticToEcef(lat, degToRad(20), 0);
      const geocentric = Math.atan2(p.z, Math.hypot(p.x, p.y));
      expect(Math.tan(geocentric)).toBeCloseTo((1 - WGS84_E2) * Math.tan(lat), 12);
    }
  });

  it('moves a point along the local vertical when height is added', () => {
    const lat = degToRad(34);
    const lon = degToRad(-84);
    const ground = geodeticToEcef(lat, lon, 0);
    const raised = geodeticToEcef(lat, lon, 400);

    // The straight-line separation equals the height...
    const dx = raised.x - ground.x;
    const dy = raised.y - ground.y;
    const dz = raised.z - ground.z;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(400, 9);

    // ...and its direction is the ellipsoid normal (cos lat cos lon, cos lat sin lon, sin lat).
    expect(dx / 400).toBeCloseTo(Math.cos(lat) * Math.cos(lon), 12);
    expect(dy / 400).toBeCloseTo(Math.cos(lat) * Math.sin(lon), 12);
    expect(dz / 400).toBeCloseTo(Math.sin(lat), 12);
  });
});

describe('degToRad', () => {
  it('converts the usual reference angles', () => {
    expect(degToRad(180)).toBe(Math.PI);
    expect(degToRad(-90)).toBe(-Math.PI / 2);
    expect(degToRad(0)).toBe(0);
  });
});

describe('ecefToGeodetic', () => {
  it('inverts geodeticToEcef from the surface to beyond geostationary height', () => {
    let worstAngle = 0;
    let worstHeightKm = 0;
    for (const heightKm of [0, 0.5, 400, 2000, 20_200, 35_786, 100_000]) {
      for (let latDeg = -90; latDeg <= 90; latDeg += 7.5) {
        for (let lonDeg = -172; lonDeg < 180; lonDeg += 31) {
          const p = geodeticToEcef(degToRad(latDeg), degToRad(lonDeg), heightKm);
          const g = ecefToGeodetic(p.x, p.y, p.z);
          worstAngle = Math.max(worstAngle, Math.abs(radToDeg(g.latitudeRad) - latDeg));
          if (Math.abs(latDeg) !== 90) {
            // Longitude has no meaning exactly at a pole.
            worstAngle = Math.max(worstAngle, Math.abs(radToDeg(g.longitudeRad) - lonDeg));
          }
          worstHeightKm = Math.max(worstHeightKm, Math.abs(g.heightKm - heightKm));
        }
      }
    }
    // 1e-9 degrees is about a tenth of a millimetre on the ground.
    expect(worstAngle).toBeLessThan(1e-9);
    // One micrometre.
    expect(worstHeightKm).toBeLessThan(1e-9);
  });

  it('gives the equatorial and polar radii as height zero', () => {
    expect(ecefToGeodetic(WGS84_A_KM, 0, 0).heightKm).toBeCloseTo(0, 9);
    const north = ecefToGeodetic(0, 0, WGS84_B_KM);
    expect(north.heightKm).toBeCloseTo(0, 9);
    expect(radToDeg(north.latitudeRad)).toBeCloseTo(90, 9);
    const south = ecefToGeodetic(0, 0, -WGS84_B_KM - 10);
    expect(south.heightKm).toBeCloseTo(10, 9);
    expect(radToDeg(south.latitudeRad)).toBeCloseTo(-90, 9);
  });

  it('measures height along the ellipsoid normal, not from the centre', () => {
    // At mid latitudes the surface lies between the polar and the equatorial
    // radius from the centre. A point 7000 km from the centre in the geocentric
    // 45 degree direction is therefore higher than 7000 - 6378.137 km and
    // lower than 7000 - 6356.752 km.
    const g = ecefToGeodetic(7000 * Math.SQRT1_2, 0, 7000 * Math.SQRT1_2);
    expect(g.heightKm).toBeGreaterThan(7000 - WGS84_A_KM);
    expect(g.heightKm).toBeLessThan(7000 - WGS84_B_KM);
    // Geodetic latitude exceeds geocentric latitude in the northern hemisphere.
    expect(radToDeg(g.latitudeRad)).toBeGreaterThan(45);
    expect(radToDeg(g.latitudeRad)).toBeLessThan(45.2);
  });
});
