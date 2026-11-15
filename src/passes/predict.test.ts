import { describe, expect, it } from 'vitest';
import { degToRad, radToDeg } from '../geo/geodetic';
import { createObserver, lookAngles, type Observer } from '../geo/topocentric';
import { WGS84_A_KM } from '../geo/wgs84';
import { gmstRadians, sunDirection, temeToEarthFixed } from '../orbit/time';
import {
  DEFAULT_PASS_OPTIONS,
  isSunlit,
  predictPasses,
  sunElevationDeg,
  type Propagator,
} from './predict';

/** Rotation rate of the Earth relative to the stars, radians per second (one turn per sidereal day). */
const EARTH_RATE = (2 * Math.PI) / 86_164.0905;

const START = Date.UTC(2026, 10, 15, 0, 0, 0);

/**
 * A satellite on an exactly circular orbit in the plane of the equator,
 * going the same way as the Earth turns. Not a real object: an orbit simple
 * enough that its passes can be worked out with a pencil.
 *
 * @param altitudeKm  height above the equatorial radius
 * @param periodS     time for one revolution, seconds
 * @param phaseRad    angle from the inertial x axis at START
 */
function equatorialOrbit(altitudeKm: number, periodS: number, phaseRad: number): Propagator {
  const radius = WGS84_A_KM + altitudeKm;
  const rate = (2 * Math.PI) / periodS;
  return (unixMs) => {
    const angle = phaseRad + (rate * (unixMs - START)) / 1000;
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), z: 0 };
  };
}

const ALTITUDE_KM = 420;
const PERIOD_S = 5580; // 93 minutes
const equatorObserver = createObserver(0, 0, 0);

describe('predictPasses on an orbit that can be worked out by hand', () => {
  // Put the satellite 90 degrees behind the observer's meridian at START, so
  // that the first pass is well clear of both ends of the search.
  const propagate = equatorialOrbit(ALTITUDE_KM, PERIOD_S, gmstRadians(START) - Math.PI / 2);
  const passes = predictPasses(propagate, equatorObserver, START, START + 6 * 3_600_000);

  it('finds one pass per revolution relative to the turning Earth', () => {
    // The satellite laps the observer once every 1 / (1/T - 1/sidereal day).
    const lapSeconds = (2 * Math.PI) / ((2 * Math.PI) / PERIOD_S - EARTH_RATE);
    expect(passes.length).toBe(Math.floor((6 * 3600 - lapSeconds / 4) / lapSeconds) + 1);
    for (let i = 1; i < passes.length; i += 1) {
      const gap =
        ((passes[i]?.culmination.timeMs ?? 0) - (passes[i - 1]?.culmination.timeMs ?? 0)) / 1000;
      expect(gap).toBeCloseTo(lapSeconds, 0);
    }
  });

  it('times the first culmination correctly', () => {
    // It has a quarter of a lap to make up.
    const lapSeconds = (2 * Math.PI) / ((2 * Math.PI) / PERIOD_S - EARTH_RATE);
    const expected = START + (lapSeconds / 4) * 1000;
    expect(Math.abs((passes[0]?.culmination.timeMs ?? 0) - expected)).toBeLessThan(150);
  });

  it('passes through the zenith, rising in the west and setting in the east', () => {
    const pass = passes[0];
    expect(pass).toBeDefined();
    expect(pass?.culmination.elevationDeg).toBeGreaterThan(89.5);
    expect(pass?.rise.azimuthDeg).toBeCloseTo(270, 3);
    expect(pass?.set.azimuthDeg).toBeCloseTo(90, 3);
    expect(pass?.rise.elevationDeg).toBeCloseTo(10, 2);
    expect(pass?.set.elevationDeg).toBeCloseTo(10, 2);
  });

  it('lasts as long as the geometry says', () => {
    // In the plane of the orbit, a satellite at radius r is at elevation E
    // when the angle at the Earth's centre between it and the observer is
    // acos(R cos E / r) - E. The pass covers twice that angle at the rate
    // the satellite gains on the observer.
    const elevation = degToRad(10);
    const halfAngle =
      Math.acos((WGS84_A_KM * Math.cos(elevation)) / (WGS84_A_KM + ALTITUDE_KM)) - elevation;
    const expectedSeconds = (2 * halfAngle) / ((2 * Math.PI) / PERIOD_S - EARTH_RATE);
    const pass = passes[0];
    const measured = ((pass?.set.timeMs ?? 0) - (pass?.rise.timeMs ?? 0)) / 1000;
    expect(measured).toBeCloseTo(expectedSeconds, 0);
    expect(Math.abs(measured - expectedSeconds)).toBeLessThan(0.2);
    // Rise and set are symmetrical about the highest point.
    const middle = ((pass?.rise.timeMs ?? 0) + (pass?.set.timeMs ?? 0)) / 2;
    expect(Math.abs((pass?.culmination.timeMs ?? 0) - middle)).toBeLessThan(150);
  });
});

describe('predictPasses: edges of the search', () => {
  const propagate = equatorialOrbit(ALTITUDE_KM, PERIOD_S, gmstRadians(START) - Math.PI / 2);
  const all = predictPasses(propagate, equatorObserver, START, START + 6 * 3_600_000);
  const first = all[0];
  if (first === undefined) {
    throw new Error('fixture produced no passes');
  }

  it('includes a pass already under way at the start, with its true rise time', () => {
    const passes = predictPasses(
      propagate,
      equatorObserver,
      first.culmination.timeMs,
      first.culmination.timeMs + 600_000,
    );
    expect(passes).toHaveLength(1);
    expect(Math.abs((passes[0]?.rise.timeMs ?? 0) - first.rise.timeMs)).toBeLessThan(150);
  });

  it('leaves out a pass that has not finished by the end', () => {
    const passes = predictPasses(propagate, equatorObserver, START, first.culmination.timeMs);
    expect(passes).toHaveLength(0);
  });

  it('leaves out a pass that finished before the start', () => {
    const passes = predictPasses(
      propagate,
      equatorObserver,
      first.set.timeMs + 1000,
      first.set.timeMs + 600_000,
    );
    expect(passes).toHaveLength(0);
  });

  it('returns nothing, without failing, for a satellite that cannot be propagated', () => {
    expect(predictPasses(() => null, equatorObserver, START, START + 3_600_000)).toEqual([]);
  });

  it('returns nothing for a satellite that never rises high enough', () => {
    // From 60 degrees north an equatorial satellite 420 km up is always below the horizon.
    const northern = createObserver(degToRad(60), 0, 0);
    expect(predictPasses(propagate, northern, START, START + 6 * 3_600_000)).toEqual([]);
  });
});

describe('predictPasses: a pass shorter than the sampling step', () => {
  /** Highest elevation the equatorial satellite reaches from a given latitude on the meridian. */
  const maxElevationFrom = (observer: Observer): number => {
    // Directly south of the observer, in the equatorial plane, at the observer's longitude.
    const angles = lookAngles(observer, WGS84_A_KM + ALTITUDE_KM, 0, 0);
    return radToDeg(angles.elevationRad);
  };
  // Find the latitude from which the satellite only just clears 10 degrees.
  let low = 5;
  let high = 20;
  for (let i = 0; i < 60; i += 1) {
    const middle = (low + high) / 2;
    if (maxElevationFrom(createObserver(degToRad(middle), 0, 0)) > 10.004) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const observer = createObserver(degToRad(low), 0, 0);
  const propagate = equatorialOrbit(ALTITUDE_KM, PERIOD_S, gmstRadians(START) - Math.PI / 2);
  const passes = predictPasses(propagate, observer, START, START + 6 * 3_600_000);

  it('is still found', () => {
    expect(maxElevationFrom(observer)).toBeCloseTo(10.004, 3);
    expect(passes.length).toBe(4);
    for (const pass of passes) {
      const seconds = (pass.set.timeMs - pass.rise.timeMs) / 1000;
      // Shorter than the 30 second sampling step, so it can fall between two samples.
      expect(seconds).toBeGreaterThan(1);
      expect(seconds).toBeLessThan(30);
      expect(pass.culmination.elevationDeg).toBeCloseTo(10.004, 2);
      expect(pass.culmination.azimuthDeg).toBeCloseTo(180, 1);
    }
  });
});

describe('predictPasses: which part of a pass can be seen', () => {
  const propagate = equatorialOrbit(ALTITUDE_KM, PERIOD_S, gmstRadians(START) - Math.PI / 2);
  const passes = predictPasses(propagate, equatorObserver, START, START + 24 * 3_600_000);
  const lit = (unixMs: number): boolean => {
    const position = propagate(unixMs);
    return position !== null && isSunlit(position, sunDirection(unixMs));
  };

  it('finds daylight passes, visible passes and passes in shadow in one day', () => {
    expect(passes.some((pass) => pass.visible !== null)).toBe(true);
    expect(passes.some((pass) => pass.notVisibleReason === 'daylight')).toBe(true);
    expect(passes.some((pass) => pass.notVisibleReason === 'in-shadow')).toBe(true);
  });

  it('gives every pass either a visible part or a reason, never both', () => {
    for (const pass of passes) {
      expect(pass.visible === null).toBe(pass.notVisibleReason !== null);
    }
  });

  it('reports a visible part that lies within the pass, is sunlit throughout and has a dark sky', () => {
    for (const pass of passes) {
      if (pass.visible === null) {
        continue;
      }
      const { start, highest, end } = pass.visible;
      expect(start.timeMs).toBeGreaterThanOrEqual(pass.rise.timeMs);
      expect(end.timeMs).toBeLessThanOrEqual(pass.set.timeMs);
      expect(highest.timeMs).toBeGreaterThanOrEqual(start.timeMs);
      expect(highest.timeMs).toBeLessThanOrEqual(end.timeMs);
      expect(highest.elevationDeg).toBeGreaterThanOrEqual(start.elevationDeg - 1e-6);
      expect(highest.elevationDeg).toBeGreaterThanOrEqual(end.elevationDeg - 1e-6);
      let darkest = 90;
      for (let at = start.timeMs + 500; at < end.timeMs; at += 1000) {
        expect(lit(at)).toBe(true);
        darkest = Math.min(darkest, sunElevationDeg(equatorObserver, at));
      }
      expect(darkest).toBeLessThanOrEqual(DEFAULT_PASS_OPTIONS.maxSunElevationDeg + 0.01);
    }
  });

  it('calls a pass with the Sun up "daylight" and a pass never in sunlight "in-shadow"', () => {
    for (const pass of passes) {
      if (pass.sunElevationDeg > 0) {
        expect(pass.notVisibleReason).toBe('daylight');
      }
      if (pass.notVisibleReason === 'in-shadow') {
        for (let at = pass.rise.timeMs; at <= pass.set.timeMs; at += 1000) {
          expect(lit(at)).toBe(false);
        }
      }
    }
  });

  it('follows the darkness threshold it is given', () => {
    const search = (maxSunElevationDeg: number) =>
      predictPasses(propagate, equatorObserver, START, START + 24 * 3_600_000, {
        minElevationDeg: 10,
        maxSunElevationDeg,
      });
    // A sky that is never dark enough: nothing can be seen.
    expect(search(-91).every((pass) => pass.visible === null)).toBe(true);
    // A sky that always counts as dark: every pass that is sunlit at all can be seen.
    const anySky = search(91);
    expect(anySky.filter((pass) => pass.visible !== null).length).toBeGreaterThan(
      passes.filter((pass) => pass.visible !== null).length,
    );
    expect(anySky.every((pass) => pass.notVisibleReason !== 'daylight')).toBe(true);
  });
});

describe('isSunlit', () => {
  const sun = { x: 1, y: 0, z: 0 };
  const low = WGS84_A_KM + 400;

  it('is true anywhere on the side of the Earth facing the Sun', () => {
    expect(isSunlit({ x: low, y: 0, z: 0 }, sun)).toBe(true);
    expect(isSunlit({ x: 1, y: low, z: 0 }, sun)).toBe(true);
    expect(isSunlit({ x: 0, y: 0, z: low }, sun)).toBe(true);
  });

  it('is false directly behind the Earth', () => {
    expect(isSunlit({ x: -low, y: 0, z: 0 }, sun)).toBe(false);
    expect(isSunlit({ x: -low, y: 3000, z: -3000 }, sun)).toBe(false);
  });

  it('is true behind the Earth but outside the shadow', () => {
    expect(isSunlit({ x: -3000, y: WGS84_A_KM + 1, z: 0 }, sun)).toBe(true);
    expect(isSunlit({ x: -3000, y: WGS84_A_KM - 1, z: 0 }, sun)).toBe(false);
    // Geostationary height, a quarter of a degree outside the shadow's edge.
    expect(isSunlit({ x: -41_000, y: 0, z: 6600 }, sun)).toBe(true);
  });
});

describe('sunElevationDeg', () => {
  /** The point on the ground directly under the Sun, from the same Sun model, by a separate route. */
  const subsolar = (unixMs: number): { lat: number; lon: number } => {
    const s = sunDirection(unixMs);
    const fixed = temeToEarthFixed(s.x, s.y, s.z, gmstRadians(unixMs));
    return {
      // Geocentric latitude, which is what "directly under" means for a direction.
      lat: radToDeg(Math.asin(fixed.z)),
      lon: radToDeg(Math.atan2(fixed.y, fixed.x)),
    };
  };

  it('is close to 90 degrees under the Sun and -90 degrees opposite it', () => {
    for (const when of [START, START + 5 * 3_600_000, Date.UTC(2026, 5, 21, 12)]) {
      const under = subsolar(when);
      // Within a quarter of a degree: the observer's "up" is perpendicular to
      // the ellipsoid, which differs slightly from the direction to the centre.
      expect(
        sunElevationDeg(createObserver(degToRad(under.lat), degToRad(under.lon), 0), when),
      ).toBeGreaterThan(89.75);
      expect(
        sunElevationDeg(createObserver(degToRad(-under.lat), degToRad(under.lon + 180), 0), when),
      ).toBeLessThan(-89.75);
    }
  });

  it('puts the Sun over the Tropic of Cancer at the June solstice and near the equator at an equinox', () => {
    expect(subsolar(Date.UTC(2026, 5, 21, 12)).lat).toBeCloseTo(23.44, 1);
    expect(Math.abs(subsolar(Date.UTC(2026, 2, 20, 14, 46)).lat)).toBeLessThan(0.05);
  });

  it('is near zero a quarter of the way round the Earth from the point under the Sun', () => {
    const under = subsolar(START);
    const edge = createObserver(0, degToRad(under.lon + 90), 0);
    expect(Math.abs(sunElevationDeg(edge, START))).toBeLessThan(0.01);
  });
});

describe('default options', () => {
  it('are the conventional ten degrees and the end of civil twilight', () => {
    expect(DEFAULT_PASS_OPTIONS).toEqual({ minElevationDeg: 10, maxSunElevationDeg: -6 });
  });
});
