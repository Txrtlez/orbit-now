/**
 * Validation of sidereal time, the TEME to Earth-fixed rotation, and the
 * Sun's direction, against worked examples in:
 *
 *   Vallado, D. A., "Fundamentals of Astrodynamics and Applications"
 *   (GMST: the example for 20 August 1992; Sun: the example for 2 April 2006)
 *   Vallado et al., "Revisiting Spacetrack Report #3", AIAA 2006-6753
 *   (the TEME to pseudo-Earth-fixed example for 6 April 2004)
 *
 * The expected numbers below were entered from memory of those examples, not
 * copied from the books, which were not available in the build environment.
 * The code reproduces every one of them to the last digit entered, which a
 * misremembered value would not do by chance. They should still be checked
 * against the printed sources; see VALIDATION.md, entry V3.1.
 */
import { describe, expect, it } from 'vitest';
import { gmstRadians, julianDate, sunDirection, temeToEarthFixed } from '../../src/orbit/time';

const degrees = (radians: number): number => (radians * 180) / Math.PI;

describe('julianDate', () => {
  it('matches two well-known reference instants', () => {
    // J2000.0, the standard astronomical epoch: 2000-01-01 12:00 = JD 2451545.0.
    expect(julianDate(Date.UTC(2000, 0, 1, 12))).toBe(2451545);
    expect(julianDate(0)).toBe(2440587.5);
  });
});

describe('gmstRadians', () => {
  it('gives 152.578787810 degrees for 1992-08-20 12:14:00 UT1', () => {
    const gmst = degrees(gmstRadians(Date.UTC(1992, 7, 20, 12, 14, 0)));
    expect(Math.abs(gmst - 152.57878781)).toBeLessThan(5e-10);
  });

  it('advances by one full turn plus about 0.9856 degrees per solar day', () => {
    // The Earth turns once relative to the stars in 23 h 56 min 4.09 s, so
    // after 24 hours it has turned 360.9856 degrees.
    const start = Date.UTC(2026, 10, 14);
    const turn = degrees(gmstRadians(start + 86_400_000) - gmstRadians(start));
    expect(((turn % 360) + 360) % 360).toBeCloseTo(0.98564736, 6);
  });

  it('stays within 0 to 2 pi', () => {
    for (let day = 0; day < 400; day += 13.37) {
      const gmst = gmstRadians(Date.UTC(2026, 0, 1) + day * 86_400_000);
      expect(gmst).toBeGreaterThanOrEqual(0);
      expect(gmst).toBeLessThan(2 * Math.PI);
    }
  });
});

describe('temeToEarthFixed', () => {
  // 2004-04-06 07:51:28.386009 UTC, with UT1 - UTC = -0.4399619 s.
  const utcMs = Date.UTC(2004, 3, 6, 7, 51, 28, 386) + 0.009;
  const ut1Ms = utcMs - 439.9619;
  const teme = [5094.1801621, 6127.6446595, 6380.3445327] as const;

  it('reproduces the published pseudo-Earth-fixed position when given UT1', () => {
    const fixed = temeToEarthFixed(...teme, gmstRadians(ut1Ms));
    expect(Math.abs(fixed.x - -1033.4750313)).toBeLessThan(5e-7);
    expect(Math.abs(fixed.y - 7901.3055856)).toBeLessThan(5e-7);
    expect(fixed.z).toBe(6380.3445327);
  });

  it('is off by a quarter of a kilometre in this example when UTC stands in for UT1', () => {
    // This is the size of the simplification the app makes. The bound in
    // general is 0.9 s of rotation; here UT1 - UTC is 0.44 s.
    const exact = temeToEarthFixed(...teme, gmstRadians(ut1Ms));
    const approximate = temeToEarthFixed(...teme, gmstRadians(utcMs));
    const offsetKm = Math.hypot(approximate.x - exact.x, approximate.y - exact.y);
    expect(offsetKm).toBeGreaterThan(0.2);
    expect(offsetKm).toBeLessThan(0.3);
  });

  it('is a pure rotation about the polar axis', () => {
    const fixed = temeToEarthFixed(...teme, 1.234);
    expect(Math.hypot(fixed.x, fixed.y, fixed.z)).toBeCloseTo(Math.hypot(...teme), 9);
    expect(fixed.z).toBe(teme[2]);
    expect(temeToEarthFixed(...teme, 0)).toEqual({ x: teme[0], y: teme[1], z: teme[2] });
    // A quarter turn of the Earth carries the inertial +y direction onto Greenwich.
    const quarter = temeToEarthFixed(0, 1, 0, Math.PI / 2);
    expect(quarter.x).toBeCloseTo(1, 12);
    expect(quarter.y).toBeCloseTo(0, 12);
  });
});

describe('sunDirection', () => {
  it('matches the published Sun position for 2006-04-02 00:00 UTC', () => {
    // Published vector, in astronomical units: (0.9771945, 0.1924424, 0.0834308).
    const expected = [0.9771945, 0.1924424, 0.0834308] as const;
    const length = Math.hypot(...expected);
    const sun = sunDirection(Date.UTC(2006, 3, 2));
    expect(Math.abs(sun.x - expected[0] / length)).toBeLessThan(1e-7);
    expect(Math.abs(sun.y - expected[1] / length)).toBeLessThan(1e-7);
    expect(Math.abs(sun.z - expected[2] / length)).toBeLessThan(1e-7);
  });

  it('returns a unit vector', () => {
    const sun = sunDirection(Date.UTC(2026, 10, 14, 20));
    expect(Math.hypot(sun.x, sun.y, sun.z)).toBeCloseTo(1, 12);
  });

  it('puts the Sun about 23.44 degrees north and south of the equator at the solstices', () => {
    // Independent of any worked example: the Sun's extreme declination equals
    // the tilt of the Earth's axis, 23.44 degrees.
    const june = degrees(Math.asin(sunDirection(Date.UTC(2026, 5, 21, 12)).z));
    const december = degrees(Math.asin(sunDirection(Date.UTC(2026, 11, 21, 12)).z));
    expect(june).toBeCloseTo(23.44, 1);
    expect(december).toBeCloseTo(-23.44, 1);
  });

  it('has the Sun cross the equator northwards on 20 March 2026', () => {
    const before = sunDirection(Date.UTC(2026, 2, 20, 0)).z;
    const after = sunDirection(Date.UTC(2026, 2, 21, 0)).z;
    expect(before).toBeLessThan(0);
    expect(after).toBeGreaterThan(0);
  });
});

describe('the Sun over the ground (sidereal time and Sun direction together)', () => {
  /**
   * Longitude of the point on the Earth directly beneath the Sun, in degrees
   * east. This uses every piece the day/night line depends on: the Sun's
   * inertial direction, sidereal time and the rotation into the Earth-fixed
   * frame.
   */
  function subsolarLongitudeDeg(unixMs: number): number {
    const sun = sunDirection(unixMs);
    const fixed = temeToEarthFixed(sun.x, sun.y, sun.z, gmstRadians(unixMs));
    return degrees(Math.atan2(fixed.y, fixed.x));
  }

  // These expectations come from the "equation of time", the well-known
  // difference between clock noon and the moment the Sun is actually due
  // south. It is independent of the worked examples used above.

  it('is over Greenwich at 12:00 UTC in mid-April, when sundials and clocks agree', () => {
    // The equation of time passes through zero around 15 April.
    expect(Math.abs(subsolarLongitudeDeg(Date.UTC(2026, 3, 15, 12)))).toBeLessThan(0.3);
  });

  it('is about 4.1 degrees west of Greenwich at 12:00 UTC on 3 November', () => {
    // In early November the Sun runs about 16.4 minutes ahead of the clock,
    // its largest lead of the year. At 15 degrees per hour that is 4.1 degrees.
    expect(subsolarLongitudeDeg(Date.UTC(2026, 10, 3, 12))).toBeCloseTo(-4.1, 0);
  });

  it('is about 3.6 degrees east of Greenwich at 12:00 UTC on 11 February', () => {
    // In mid-February the Sun runs about 14.2 minutes behind the clock.
    expect(subsolarLongitudeDeg(Date.UTC(2026, 1, 11, 12))).toBeCloseTo(3.6, 0);
  });

  it('moves westward by 15 degrees per hour', () => {
    const start = Date.UTC(2026, 5, 1, 6);
    const moved = subsolarLongitudeDeg(start + 3_600_000) - subsolarLongitudeDeg(start);
    expect(moved).toBeCloseTo(-15, 1);
  });
});
