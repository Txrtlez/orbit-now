import { describe, expect, it } from 'vitest';
import { degToRad, geodeticToEcef } from '../geo/geodetic';
import { KM_PER_SCENE_UNIT } from '../geo/sceneFrame';
import { gmstRadians } from '../orbit/time';
import { liveStateFromScene } from './liveState';

/**
 * Build the scene-coordinate position of a point given by latitude,
 * longitude and height at a given instant, by the forward route: geodetic to
 * Earth-fixed, turn by +GMST into the inertial frame, then into scene axes
 * and units. `liveStateFromScene` has to undo all of it.
 */
function sceneFromGeodetic(
  latDeg: number,
  lonDeg: number,
  heightKm: number,
  unixMs: number,
): [number, number, number] {
  const fixed = geodeticToEcef(degToRad(latDeg), degToRad(lonDeg), heightKm);
  const gmst = gmstRadians(unixMs);
  const x = Math.cos(gmst) * fixed.x - Math.sin(gmst) * fixed.y;
  const y = Math.sin(gmst) * fixed.x + Math.cos(gmst) * fixed.y;
  return [x / KM_PER_SCENE_UNIT, fixed.z / KM_PER_SCENE_UNIT, -y / KM_PER_SCENE_UNIT];
}

describe('liveStateFromScene', () => {
  const when = Date.UTC(2026, 10, 15, 6, 41, 0);

  it('recovers latitude, longitude and height', () => {
    for (const [lat, lon, height] of [
      [0, 0, 400],
      [51.6, -0.1, 417],
      [-33.9, 151.2, 550],
      [78.2, 15.6, 800],
      [0.02, -75.1, 35_786],
      [-89, 120, 20_200],
    ] as const) {
      const live = liveStateFromScene(sceneFromGeodetic(lat, lon, height, when), [0, 0, 0], when);
      expect(live.latitudeDeg).toBeCloseTo(lat, 8);
      expect(live.longitudeDeg).toBeCloseTo(lon, 8);
      expect(live.altitudeKm).toBeCloseTo(height, 6);
    }
  });

  it('shows the ground track moving west as the Earth turns under a fixed inertial point', () => {
    const position = sceneFromGeodetic(10, 20, 500, when);
    const later = liveStateFromScene(position, [0, 0, 0], when + 3_600_000);
    // One hour of sidereal rotation is 15.04 degrees.
    expect(later.longitudeDeg).toBeCloseTo(20 - 15.041, 2);
    expect(later.latitudeDeg).toBeCloseTo(10, 6);
  });

  it('reports speed in kilometres per second', () => {
    // 7.5 km/s expressed in scene units per second, split across two axes.
    const component = 7.5 / KM_PER_SCENE_UNIT / Math.SQRT2;
    const live = liveStateFromScene([1.07, 0, 0], [0, component, -component], when);
    expect(live.speedKmPerSecond).toBeCloseTo(7.5, 12);
  });
});
