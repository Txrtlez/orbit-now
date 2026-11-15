import { degToRad, geodeticToEcef } from '../geo/geodetic';
import { ecefKmToScene } from '../geo/sceneFrame';

/**
 * Build the vertex positions of a latitude/longitude grid ("graticule") lying
 * on the WGS 84 ellipsoid, in scene coordinates.
 *
 * The result is laid out for three.js `LineSegments`: every consecutive pair
 * of vertices (six numbers) is one independent line segment.
 *
 * @param gridStepDeg   spacing between grid lines, in degrees. Must divide 180.
 * @param sampleStepDeg length of each straight segment along a line, in
 *                      degrees. Smaller is smoother. Must divide `gridStepDeg`.
 */
export function buildGraticulePositions(gridStepDeg: number, sampleStepDeg: number): Float32Array {
  if (!Number.isInteger(gridStepDeg) || gridStepDeg <= 0 || 180 % gridStepDeg !== 0) {
    throw new RangeError(
      `gridStepDeg must be a positive integer divisor of 180, got ${String(gridStepDeg)}`,
    );
  }
  if (!Number.isInteger(sampleStepDeg) || sampleStepDeg <= 0 || gridStepDeg % sampleStepDeg !== 0) {
    throw new RangeError(
      `sampleStepDeg must be a positive integer divisor of gridStepDeg, got ${String(sampleStepDeg)}`,
    );
  }

  const meridianCount = 360 / gridStepDeg;
  // Parallels at +90 and -90 degrees are single points (the poles), so skip them.
  const parallelCount = 180 / gridStepDeg - 1;
  const segmentsPerMeridian = 180 / sampleStepDeg;
  const segmentsPerParallel = 360 / sampleStepDeg;
  const segmentCount = meridianCount * segmentsPerMeridian + parallelCount * segmentsPerParallel;

  const positions = new Float32Array(segmentCount * 2 * 3);
  let cursor = 0;

  const writeVertex = (latDeg: number, lonDeg: number): void => {
    const p = geodeticToEcef(degToRad(latDeg), degToRad(lonDeg), 0);
    ecefKmToScene(p.x, p.y, p.z, positions, cursor);
    cursor += 3;
  };

  // Meridians: lines of constant longitude running pole to pole.
  for (let lonDeg = -180; lonDeg < 180; lonDeg += gridStepDeg) {
    for (let latDeg = -90; latDeg < 90; latDeg += sampleStepDeg) {
      writeVertex(latDeg, lonDeg);
      writeVertex(latDeg + sampleStepDeg, lonDeg);
    }
  }

  // Parallels: circles of constant latitude.
  for (let latDeg = -90 + gridStepDeg; latDeg < 90; latDeg += gridStepDeg) {
    for (let lonDeg = -180; lonDeg < 180; lonDeg += sampleStepDeg) {
      writeVertex(latDeg, lonDeg);
      writeVertex(latDeg, lonDeg + sampleStepDeg);
    }
  }

  return positions;
}
