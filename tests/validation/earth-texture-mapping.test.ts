/**
 * Checks the one assumption that ties the Earth imagery to the coordinate
 * frames: where three.js puts each part of an image on its sphere.
 *
 * The images are equirectangular with longitude 180 W at the left edge,
 * Greenwich in the centre and north at the top (confirmed by looking at
 * them). For the picture to sit correctly on the globe, the centre of the
 * image must land on scene +x (Greenwich on the equator), the point three
 * quarters of the way across on scene -z (90 E), and the top on scene +y
 * (the north pole). See src/geo/sceneFrame.ts for the scene axes.
 */
import { SphereGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { degToRad, geodeticToEcef } from '../../src/geo/geodetic';
import { ecefKmToScene } from '../../src/geo/sceneFrame';

/** The position on a unit sphere where three.js draws texture coordinate (u, v). */
function positionOfUv(u: number, v: number): [number, number, number] {
  // 360 by 180 segments puts a vertex at every whole degree.
  const geometry = new SphereGeometry(1, 360, 180);
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i += 1) {
    if (Math.abs(uv.getX(i) - u) < 1e-6 && Math.abs(uv.getY(i) - v) < 1e-6) {
      return [position.getX(i), position.getY(i), position.getZ(i)];
    }
  }
  throw new Error(`No vertex at uv (${String(u)}, ${String(v)})`);
}

/** Where the geodesy code puts a longitude/latitude, as a unit vector in scene axes. */
function sceneDirection(latDeg: number, lonDeg: number): [number, number, number] {
  const p = geodeticToEcef(degToRad(latDeg), degToRad(lonDeg), 0);
  const out: [number, number, number] = [0, 0, 0];
  ecefKmToScene(p.x, p.y, p.z, out);
  const length = Math.hypot(...out);
  return [out[0] / length, out[1] / length, out[2] / length];
}

describe('placement of an equirectangular image on the three.js sphere', () => {
  it.each([
    ['Greenwich on the equator (image centre)', 0.5, 0.5, 0, 0],
    ['90 degrees east on the equator', 0.75, 0.5, 0, 90],
    ['90 degrees west on the equator', 0.25, 0.5, 0, -90],
    ['the antimeridian (image left edge)', 0, 0.5, 0, 180],
  ] as const)('puts %s where the geodesy code expects it', (_name, u, v, latDeg, lonDeg) => {
    const fromTexture = positionOfUv(u, v);
    const fromGeodesy = sceneDirection(latDeg, lonDeg);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(fromTexture[axis]).toBeCloseTo(fromGeodesy[axis] ?? Number.NaN, 6);
    }
  });

  it('puts 45 degrees north three quarters of the way up the image, towards scene +y', () => {
    // On a sphere, v maps linearly to latitude: v = 0.75 is 45 degrees north.
    // (The poles themselves are not tested: three.js shifts the u coordinate
    // of the pole vertices by half a segment, so no vertex sits at exactly
    // u = 0.5 there. Every pole vertex is at the same point anyway.)
    const [x, y, z] = positionOfUv(0.5, 0.75);
    expect(y).toBeCloseTo(Math.sin(degToRad(45)), 6);
    expect(x).toBeCloseTo(Math.cos(degToRad(45)), 6);
    expect(z).toBeCloseTo(0, 6);
  });
});
