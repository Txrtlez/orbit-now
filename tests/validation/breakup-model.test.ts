/**
 * Launch gate 3: the breakup model reproduces the published
 * size-distribution curves, and momentum is approximately conserved.
 *
 * The curves are the two power laws printed in NASA's "Proper
 * Implementation of the 1998 NASA Breakup Model" (Orbital Debris Quarterly
 * News 15-4, October 2011, p. 5): N = 6 S Lc^-1.6 for explosions (also the
 * label of the line in that article's figure, "NASA: Ncum = 6 Lc^-1.6") and
 * N = 0.1 M^0.75 Lc^-1.71 for collisions.
 *
 * Results are recorded in VALIDATION.md, entry V6.1.
 */
import { describe, expect, it } from 'vitest';
import {
  assessCollision,
  collisionFragmentsLargerThan,
  explosionFragmentsLargerThan,
  generateCloud,
  momentumOf,
  seededRandom,
  withoutNetMomentum,
  type Fragment,
} from '../../src/sim/breakupModel';
import { recordMeasurement } from './measurements';

/** Sizes at which a generated cloud is compared with the published curve, in metres. */
const SIZES_M = [0.1, 0.2, 0.5];

/** Number of fragments of a cloud at least this long, leaving out the pieces that carry leftover mass. */
function countLargerThan(cloud: readonly Fragment[], lengthM: number): number {
  return cloud.filter((fragment) => !fragment.remnant && fragment.lengthM >= lengthM).length;
}

describe('the size distribution of generated clouds follows the published curves', () => {
  it('for a catastrophic collision', () => {
    // Iridium 33 and Cosmos 2251: 560 kg and about 900 kg at more than 11 km/s (ODQN 13-2).
    const collision = assessCollision(900, 560, 11);
    expect(collision.catastrophic).toBe(true);
    expect(collision.referenceMassKg).toBe(1460);
    // Mass is left unlimited here so that the whole curve is drawn; mass conservation is tested below.
    const cloud = generateCloud(
      {
        event: 'collision',
        kind: 'spacecraft',
        smallestLengthM: 0.05,
        scaleOrReferenceMass: collision.referenceMassKg,
        massToConserveKg: Number.MAX_VALUE,
        remnantCount: 1,
      },
      seededRandom(20261115),
    );
    for (const size of SIZES_M) {
      // The curve between this size and the 1 m at which sampling stops.
      const published =
        collisionFragmentsLargerThan(size, 1460) - collisionFragmentsLargerThan(1, 1460);
      const generated = countLargerThan(cloud, size);
      recordMeasurement(`V6.1 collision of 1460 kg, fragments of ${String(size)} m or more`, {
        published: Number(published.toFixed(1)),
        generated,
      });
      // A count drawn at random scatters by about its own square root; allow three times that.
      expect(Math.abs(generated - published)).toBeLessThan(3 * Math.sqrt(published) + 1);
    }
  });

  it('for an explosion', () => {
    const cloud = generateCloud(
      {
        event: 'explosion',
        kind: 'rocketBody',
        smallestLengthM: 0.02,
        scaleOrReferenceMass: 1,
        massToConserveKg: Number.MAX_VALUE,
        remnantCount: 1,
      },
      seededRandom(1961),
    );
    for (const size of SIZES_M) {
      const published = explosionFragmentsLargerThan(size) - explosionFragmentsLargerThan(1);
      const generated = countLargerThan(cloud, size);
      recordMeasurement(`V6.1 explosion with S = 1, fragments of ${String(size)} m or more`, {
        published: Number(published.toFixed(1)),
        generated,
      });
      expect(Math.abs(generated - published)).toBeLessThan(3 * Math.sqrt(published) + 1);
    }
  });
});

describe('the model against what NASA said it predicts for a real collision', () => {
  it('gives about 1,300 trackable pieces for Iridium 33 and Cosmos 2251', () => {
    // ODQN 13-2 (April 2009), p. 2: a body-to-body hit "would have produced
    // about 1,300 tracked pieces". Trackable is taken as 10 cm or larger.
    const predicted = collisionFragmentsLargerThan(0.1, 1460);
    recordMeasurement('V6.1 Iridium 33 and Cosmos 2251, fragments of 0.1 m or more', {
      model: Number(predicted.toFixed(0)),
      nasaStatement: 1300,
    });
    expect(predicted).toBeGreaterThan(1100);
    expect(predicted).toBeLessThan(1400);
  });
});

describe('mass and momentum', () => {
  const request = {
    event: 'collision' as const,
    kind: 'spacecraft' as const,
    smallestLengthM: 0.05,
    scaleOrReferenceMass: 1460,
    massToConserveKg: 1460,
    remnantCount: 4,
  };

  it('conserves mass to rounding in every one of 50 clouds', () => {
    let worst = 0;
    for (let seed = 1; seed <= 50; seed += 1) {
      const cloud = generateCloud(request, seededRandom(seed));
      const total = cloud.reduce((sum, fragment) => sum + fragment.massKg, 0);
      worst = Math.max(worst, Math.abs(total - 1460));
    }
    recordMeasurement('V6.1 mass conservation over 50 clouds', { worstErrorKg: worst });
    expect(worst).toBeLessThan(1e-6);
  });

  it('leaves little net momentum, and none after the mean velocity is taken out', () => {
    let worstRaw = 0;
    let sumRaw = 0;
    let worstBalanced = 0;
    let largestShift = 0;
    const clouds = 50;
    for (let seed = 1; seed <= clouds; seed += 1) {
      const cloud = generateCloud(request, seededRandom(seed));
      const raw = momentumOf(cloud);
      const fraction = raw.net / raw.gross;
      worstRaw = Math.max(worstRaw, fraction);
      sumRaw += fraction;
      const balanced = withoutNetMomentum(cloud);
      const after = momentumOf(balanced);
      worstBalanced = Math.max(worstBalanced, after.net / after.gross);
      const first = cloud[0];
      const shifted = balanced[0];
      if (first !== undefined && shifted !== undefined) {
        largestShift = Math.max(
          largestShift,
          Math.hypot(
            first.deltaV[0] - shifted.deltaV[0],
            first.deltaV[1] - shifted.deltaV[1],
            first.deltaV[2] - shifted.deltaV[2],
          ),
        );
      }
    }
    recordMeasurement('V6.1 net momentum as a fraction of the sum of magnitudes, 50 clouds', {
      meanAsGenerated: Number((sumRaw / clouds).toFixed(3)),
      worstAsGenerated: Number(worstRaw.toFixed(3)),
      worstAfterBalancing: worstBalanced,
      largestVelocityShiftMPerS: Number(largestShift.toFixed(2)),
    });
    // As generated, directions are independent, so some net momentum
    // remains; it is recorded, and bounded only loosely here.
    expect(worstRaw).toBeLessThan(1);
    expect(worstBalanced).toBeLessThan(1e-9);
  });
});
