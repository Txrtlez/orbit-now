import { describe, expect, it } from 'vitest';
import {
  areaToMassParameters,
  assessCollision,
  averageArea,
  collisionFragmentsLargerThan,
  explosionFragmentsLargerThan,
  generateCloud,
  lengthOfMass,
  meanLogDeltaV,
  momentumOf,
  sampleAreaToMass,
  sampleDirection,
  sampleNormal,
  samplePowerLawLength,
  seededRandom,
  smallFragmentAreaToMass,
  withoutNetMomentum,
  type ParentKind,
} from './breakupModel';

describe('seededRandom and sampleNormal', () => {
  it('repeats exactly from the same seed and differs from another', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const c = seededRandom(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('draws normal samples with the mean and spread asked for', () => {
    const random = seededRandom(7);
    const samples = Array.from({ length: 40_000 }, () => sampleNormal(random, -1.5, 0.4));
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
    expect(mean).toBeCloseTo(-1.5, 2);
    expect(Math.sqrt(variance)).toBeCloseTo(0.4, 2);
  });
});

describe('fragment counts', () => {
  it('follows N = 6 S Lc^-1.6 for explosions', () => {
    expect(explosionFragmentsLargerThan(1)).toBeCloseTo(6, 12);
    expect(explosionFragmentsLargerThan(0.1)).toBeCloseTo(6 * 10 ** 1.6, 9);
    expect(explosionFragmentsLargerThan(0.1, 0.1)).toBeCloseTo(0.6 * 10 ** 1.6, 9);
  });

  it('follows N = 0.1 M^0.75 Lc^-1.71 for collisions', () => {
    expect(collisionFragmentsLargerThan(1, 1)).toBeCloseTo(0.1, 12);
    expect(collisionFragmentsLargerThan(0.1, 1000)).toBeCloseTo(0.1 * 1000 ** 0.75 * 10 ** 1.71, 9);
  });
});

describe('assessCollision', () => {
  it("computes the lighter object's kinetic energy per gram of the heavier", () => {
    // 1 kg at 10 km/s is 5e7 J; over 1,000,000 g that is 50 J/g.
    const result = assessCollision(1000, 1, 10);
    expect(result.specificEnergyJPerG).toBeCloseTo(50, 9);
    expect(result.catastrophic).toBe(true);
    expect(result.referenceMassKg).toBe(1001);
  });

  it('uses the lighter mass times speed squared below the 40 J/g threshold', () => {
    const result = assessCollision(1000, 0.5, 10);
    expect(result.specificEnergyJPerG).toBeCloseTo(25, 9);
    expect(result.catastrophic).toBe(false);
    expect(result.referenceMassKg).toBeCloseTo(50, 9);
  });

  it('treats exactly 40 J/g as catastrophic', () => {
    expect(assessCollision(1000, 0.8, 10).catastrophic).toBe(true);
  });
});

describe('samplePowerLawLength', () => {
  it('stays within its limits and reproduces the cumulative distribution', () => {
    const random = seededRandom(11);
    const lengths = Array.from({ length: 50_000 }, () =>
      samplePowerLawLength(random, -1.71, 0.05, 1),
    );
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(0.05);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(1);
    // Fraction above 0.1 m, from N(>L) ~ L^-1.71 cut off at 1 m.
    const expected = (0.1 ** -1.71 - 1) / (0.05 ** -1.71 - 1);
    const measured = lengths.filter((length) => length > 0.1).length / lengths.length;
    expect(measured).toBeCloseTo(expected, 2);
  });
});

describe('area-to-mass parameters', () => {
  const kinds: ParentKind[] = ['spacecraft', 'rocketBody'];

  it('are continuous in size: no parameter jumps at a join', () => {
    for (const kind of kinds) {
      let previous = areaToMassParameters(kind, -2.5);
      for (let lambda = -2.5; lambda <= 1; lambda += 0.001) {
        const current = areaToMassParameters(kind, lambda);
        for (const key of ['alpha', 'mu1', 'sigma1', 'mu2', 'sigma2'] as const) {
          // Steepest slope is 1.4 per unit of lambda; a step of 0.001 moves nothing by more than 0.002.
          expect(
            Math.abs(current[key] - previous[key]),
            `${kind} ${key} at ${String(lambda)}`,
          ).toBeLessThan(0.002);
        }
        previous = current;
      }
    }
    let previous = smallFragmentAreaToMass(-4);
    for (let lambda = -4; lambda <= -1; lambda += 0.001) {
      const current = smallFragmentAreaToMass(lambda);
      expect(Math.abs(current.mu - previous.mu)).toBeLessThan(0.002);
      expect(Math.abs(current.sigma - previous.sigma)).toBeLessThan(0.002);
      previous = current;
    }
  });

  it('keep every weight between 0 and 1 and every spread positive', () => {
    for (const kind of kinds) {
      for (let lambda = -3; lambda <= 1.5; lambda += 0.01) {
        const { alpha, sigma1, sigma2 } = areaToMassParameters(kind, lambda);
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
        expect(sigma1).toBeGreaterThan(0);
        expect(sigma2).toBeGreaterThan(0);
      }
    }
  });

  it('have the published end values', () => {
    expect(areaToMassParameters('rocketBody', -2)).toEqual({
      alpha: 1,
      mu1: -0.45,
      sigma1: 0.55,
      mu2: -0.9,
      sigma2: 0.28,
    });
    expect(areaToMassParameters('rocketBody', 0.5)).toEqual({
      alpha: 0.5,
      mu1: -0.9,
      sigma1: 0.55,
      mu2: -0.9,
      sigma2: 0.1,
    });
    expect(areaToMassParameters('spacecraft', -2)).toEqual({
      alpha: 0,
      mu1: -0.6,
      sigma1: 0.1,
      mu2: -1.2,
      sigma2: 0.5,
    });
    expect(areaToMassParameters('spacecraft', 0.6)).toEqual({
      alpha: 1,
      mu1: -0.95,
      sigma1: 0.3,
      mu2: -2,
      sigma2: 0.3,
    });
    expect(smallFragmentAreaToMass(-4)).toEqual({ mu: -0.3, sigma: 0.2 });
    expect(smallFragmentAreaToMass(-1)).toEqual({ mu: -1, sigma: 0.2 + 0.1333 * 2.5 });
  });
});

describe('sampleAreaToMass', () => {
  it('draws small fragments around the single published mean', () => {
    const random = seededRandom(3);
    // 1 cm: lambda = -2, below every join, so mu = -0.3.
    const chi = Array.from({ length: 20_000 }, () =>
      Math.log10(sampleAreaToMass(random, 'spacecraft', 0.01)),
    );
    const mean = chi.reduce((sum, value) => sum + value, 0) / chi.length;
    expect(mean).toBeCloseTo(-0.3, 1);
  });

  it('draws large spacecraft fragments from two humps in the stated proportion', () => {
    const random = seededRandom(5);
    // 1 m: lambda = 0. alpha = 0.3 + 0.4 * 1.2 = 0.78; the humps are at -0.95 and -2.0, each 0.3 wide.
    const { alpha, mu1, mu2 } = areaToMassParameters('spacecraft', 0);
    expect(alpha).toBeCloseTo(0.78, 12);
    const chi = Array.from({ length: 30_000 }, () =>
      Math.log10(sampleAreaToMass(random, 'spacecraft', 1)),
    );
    const nearFirst = chi.filter((value) => Math.abs(value - mu1) < Math.abs(value - mu2)).length;
    expect(nearFirst / chi.length).toBeGreaterThan(alpha - 0.05);
    expect(nearFirst / chi.length).toBeLessThan(alpha + 0.05);
    // The second hump is really there. A mixture puts 0.22 x 26% = 5.7% of
    // samples within 0.1 of its centre; adding a weighted sample of each
    // distribution instead (see CHOICE 1 in the model) would put about 0.1% there.
    const nearSecond = chi.filter((value) => Math.abs(value - mu2) < 0.1).length / chi.length;
    expect(nearSecond).toBeGreaterThan(0.045);
    expect(nearSecond).toBeLessThan(0.07);
  });
});

describe('area, size and speed', () => {
  it('computes the average area from the characteristic length', () => {
    expect(averageArea(0.001)).toBeCloseTo(0.540424e-6, 12);
    expect(averageArea(1)).toBeCloseTo(0.556945, 9);
    // The two formulas agree closely where they meet.
    expect(averageArea(0.00167)).toBeCloseTo(0.540424 * 0.00167 ** 2, 8);
  });

  it('inverts the sphere-with-size-dependent-density relation', () => {
    const length = lengthOfMass(1000);
    const density = 92.937 * length ** -0.74;
    expect((Math.PI / 6) * length ** 3 * density).toBeCloseTo(1000, 6);
  });

  it('gives collisions a steeper dependence of speed on area-to-mass than explosions', () => {
    expect(meanLogDeltaV('explosion', -1)).toBeCloseTo(1.65, 12);
    expect(meanLogDeltaV('collision', -1)).toBeCloseTo(2, 12);
  });

  it('draws directions of unit length with no preferred side', () => {
    const random = seededRandom(9);
    const sum = [0, 0, 0];
    for (let i = 0; i < 20_000; i += 1) {
      const [x, y, z] = sampleDirection(random);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
      sum[0] = (sum[0] ?? 0) + x;
      sum[1] = (sum[1] ?? 0) + y;
      sum[2] = (sum[2] ?? 0) + z;
    }
    for (const component of sum) {
      expect(Math.abs(component / 20_000)).toBeLessThan(0.02);
    }
  });
});

describe('generateCloud', () => {
  const request = {
    event: 'collision' as const,
    kind: 'spacecraft' as const,
    smallestLengthM: 0.1,
    scaleOrReferenceMass: 1460,
    massToConserveKg: 1460,
    remnantCount: 4,
  };

  it('is repeatable from its seed', () => {
    expect(generateCloud(request, seededRandom(1))).toEqual(
      generateCloud(request, seededRandom(1)),
    );
  });

  it('conserves mass exactly, using large pieces for what the power law leaves over', () => {
    const cloud = generateCloud(request, seededRandom(2));
    const total = cloud.reduce((sum, fragment) => sum + fragment.massKg, 0);
    expect(total).toBeCloseTo(1460, 6);
    const remnants = cloud.filter((fragment) => fragment.remnant);
    expect(remnants.length === 0 || remnants.length === 4).toBe(true);
    for (const fragment of cloud) {
      expect(fragment.massKg).toBeGreaterThan(0);
      expect(fragment.areaM2 / fragment.areaToMass).toBeCloseTo(fragment.massKg, 9);
      if (!fragment.remnant) {
        expect(fragment.lengthM).toBeGreaterThanOrEqual(0.1);
        expect(fragment.lengthM).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never exceeds the mass to conserve, however little there is', () => {
    const cloud = generateCloud({ ...request, massToConserveKg: 5 }, seededRandom(4));
    const total = cloud.reduce((sum, fragment) => sum + fragment.massKg, 0);
    expect(total).toBeCloseTo(5, 9);
  });

  it('can have its net momentum removed without changing mass or count', () => {
    const cloud = generateCloud(request, seededRandom(6));
    const balanced = withoutNetMomentum(cloud);
    expect(balanced).toHaveLength(cloud.length);
    expect(momentumOf(balanced).net).toBeLessThan(1e-6 * momentumOf(balanced).gross);
    expect(withoutNetMomentum([])).toEqual([]);
  });
});
