/**
 * The NASA Standard Breakup Model: how many fragments a break-up makes, how
 * big they are, how much area and mass each has, and how fast each is
 * thrown off.
 *
 * STANDARD MODEL, implemented as published in N. L. Johnson, P. H. Krisko,
 * J.-C. Liou and P. D. Anz-Meador, "NASA's new breakup model of EVOLVE 4.0",
 * Advances in Space Research 28(9), 1377-1384 (2001), with the treatment of
 * mass set out by P. Krisko in "Proper Implementation of the 1998 NASA
 * Breakup Model", Orbital Debris Quarterly News 15-4 (October 2011), pp. 4-5.
 *
 * WHERE EACH PART WAS CHECKED (2026-11-15; full record in VALIDATION.md, V6.1).
 * The 2001 paper itself could not be read: it is behind a publisher's
 * paywall. So:
 *
 * - Fragment counts, the mass that enters them, and the handling of leftover
 *   mass: read in NASA's own 2011 note (a primary source).
 * - Area-to-mass and delta-v coefficients, the area formula, the 40 J/g
 *   threshold and the density law: taken from two independent open-source
 *   implementations that cite the paper (ESA/TU Munich, and MIT's MOCAT),
 *   which agree with each other in all but one sign, and with my memory of
 *   the paper. Each such constant is marked "(secondary)" below.
 * - Three points where this file departs from one or both of those
 *   implementations are marked "CHOICE", with the reason.
 *
 * Everything here is deterministic given the random-number generator passed
 * in, so that a simulation can be repeated exactly.
 */

/** What kind of object the fragments come from. It selects the area-to-mass distribution. */
export type ParentKind = 'spacecraft' | 'rocketBody';

/** A source of random numbers uniform on [0, 1). */
export type Random = () => number;

/**
 * A small, fast, seedable random-number generator (mulberry32). Not for
 * cryptography; chosen so that a simulation can be replayed from its seed.
 */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A sample from the normal distribution with the given mean and standard deviation (Box-Muller). */
export function sampleNormal(random: Random, mean: number, sigma: number): number {
  // 1 - random() lies in (0, 1], so the logarithm is finite.
  const radius = Math.sqrt(-2 * Math.log(1 - random()));
  return mean + sigma * radius * Math.cos(2 * Math.PI * random());
}

// --- How many fragments, and how big ---------------------------------------------

/** Exponent of the cumulative size distribution for explosions (Krisko 2011, eq. 1). */
export const EXPLOSION_EXPONENT = -1.6;
/** Exponent of the cumulative size distribution for collisions (Krisko 2011, eq. 2). */
export const COLLISION_EXPONENT = -1.71;
/**
 * Specific energy above which a collision destroys both objects, in joules
 * per gram of the heavier one (secondary).
 */
export const CATASTROPHIC_THRESHOLD_J_PER_G = 40;
/** The power laws are stated to hold from 1 mm to over 1 m (Krisko 2011). */
export const LARGEST_POWER_LAW_FRAGMENT_M = 1;

/**
 * Number of explosion fragments of characteristic length `lengthM` metres or
 * larger: N = 6 S Lc^-1.6 (Krisko 2011, eq. 1).
 *
 * @param scale S, "an empirically derived unitless factor between 0.1 and 1
 *              that is dependent on explosive body type"
 */
export function explosionFragmentsLargerThan(lengthM: number, scale = 1): number {
  return 6 * scale * lengthM ** EXPLOSION_EXPONENT;
}

/**
 * Number of collision fragments of characteristic length `lengthM` metres or
 * larger: N = 0.1 M^0.75 Lc^-1.71 (Krisko 2011, eq. 2), with M from
 * `assessCollision`.
 */
export function collisionFragmentsLargerThan(lengthM: number, referenceMassKg: number): number {
  return 0.1 * referenceMassKg ** 0.75 * lengthM ** COLLISION_EXPONENT;
}

export interface CollisionAssessment {
  /** Kinetic energy of the lighter object relative to the heavier, per gram of the heavier, in J/g. */
  readonly specificEnergyJPerG: number;
  /** Whether both objects are completely fragmented. */
  readonly catastrophic: boolean;
  /**
   * The mass M that enters the fragment count, in kilograms: both masses
   * together for a catastrophic collision (Krisko 2011, eq. 3); otherwise
   * the lighter object's mass in kilograms times the square of the impact
   * speed in km/s (eq. 4). The second is an empirical quantity that happens
   * to be written in kilograms, not a physical mass.
   */
  readonly referenceMassKg: number;
}

/**
 * Decide whether a collision is catastrophic, and the mass its fragment
 * count is based on.
 *
 * @param speedKmS relative speed at impact, in km/s
 */
export function assessCollision(
  heavierMassKg: number,
  lighterMassKg: number,
  speedKmS: number,
): CollisionAssessment {
  // (1/2) m v^2 in joules, per gram of the heavier object.
  const specificEnergyJPerG =
    (0.5 * lighterMassKg * (speedKmS * 1000) ** 2) / (heavierMassKg * 1000);
  const catastrophic = specificEnergyJPerG >= CATASTROPHIC_THRESHOLD_J_PER_G;
  return {
    specificEnergyJPerG,
    catastrophic,
    referenceMassKg: catastrophic ? heavierMassKg + lighterMassKg : lighterMassKg * speedKmS ** 2,
  };
}

/**
 * Draw a characteristic length from a power law N(>L) proportional to
 * L^exponent, between two lengths, by inverting its cumulative distribution.
 */
export function samplePowerLawLength(
  random: Random,
  exponent: number,
  smallestM: number,
  largestM: number,
): number {
  const a = smallestM ** exponent;
  const b = largestM ** exponent;
  return (a - random() * (a - b)) ** (1 / exponent);
}

// --- Area-to-mass ratio ---------------------------------------------------------------

/** A value that is constant below one size, constant above another, and linear in between. */
function ramp(
  lambda: number,
  from: number,
  to: number,
  below: number,
  above: number,
  between: (lambda: number) => number,
): number {
  if (lambda <= from) {
    return below;
  }
  if (lambda >= to) {
    return above;
  }
  return between(lambda);
}

/** The two-humped distribution of log10(A/M) for one size of large fragment. */
export interface AreaToMassParameters {
  /** Weight of the first normal distribution; the second has weight 1 - alpha. */
  readonly alpha: number;
  readonly mu1: number;
  readonly sigma1: number;
  readonly mu2: number;
  readonly sigma2: number;
}

/**
 * Parameters of the distribution of chi = log10(A/M in m^2/kg) for
 * fragments larger than 11 cm, as functions of lambda = log10(Lc in m)
 * (secondary). Every piecewise function below is continuous at its joins,
 * which `breakupModel.test.ts` checks; that check is what exposed a sign
 * error in one of the two implementations consulted (sigma2 for rocket
 * bodies, which must start at +0.28).
 */
export function areaToMassParameters(kind: ParentKind, lambda: number): AreaToMassParameters {
  if (kind === 'rocketBody') {
    return {
      alpha: ramp(lambda, -1.4, 0, 1, 0.5, (l) => 1 - 0.3571 * (l + 1.4)),
      mu1: ramp(lambda, -0.5, 0, -0.45, -0.9, (l) => -0.45 - 0.9 * (l + 0.5)),
      sigma1: 0.55,
      mu2: -0.9,
      sigma2: ramp(lambda, -1, 0.1, 0.28, 0.1, (l) => 0.28 - 0.1636 * (l + 1)),
    };
  }
  return {
    alpha: ramp(lambda, -1.95, 0.55, 0, 1, (l) => 0.3 + 0.4 * (l + 1.2)),
    mu1: ramp(lambda, -1.1, 0, -0.6, -0.95, (l) => -0.6 - 0.318 * (l + 1.1)),
    sigma1: ramp(lambda, -1.3, -0.3, 0.1, 0.3, (l) => 0.1 + 0.2 * (l + 1.3)),
    mu2: ramp(lambda, -0.7, -0.1, -1.2, -2, (l) => -1.2 - 1.333 * (l + 0.7)),
    sigma2: ramp(lambda, -0.5, -0.3, 0.5, 0.3, (l) => 0.5 - (l + 0.5)),
  };
}

/** Mean and standard deviation of chi for fragments smaller than 8 cm (secondary). */
export function smallFragmentAreaToMass(lambda: number): { mu: number; sigma: number } {
  return {
    mu: ramp(lambda, -1.75, -1.25, -0.3, -1, (l) => -0.3 - 1.4 * (l + 1.75)),
    sigma: lambda <= -3.5 ? 0.2 : 0.2 + 0.1333 * (lambda + 3.5),
  };
}

/** Below this size the single small-fragment distribution applies, in metres. */
export const SMALL_FRAGMENT_LIMIT_M = 0.08;
/** Above this size the two-humped large-fragment distribution applies, in metres. */
export const LARGE_FRAGMENT_LIMIT_M = 0.11;

/**
 * Draw an area-to-mass ratio, in m^2/kg, for a fragment of the given
 * characteristic length.
 *
 * CHOICE 1: the large-fragment distribution is sampled as a mixture: with
 * probability alpha from the first normal distribution, otherwise from the
 * second. The paper writes the distribution as a weighted sum of two normal
 * densities, which is a mixture, and describes it as having two humps. Both
 * open implementations consulted instead add a sample of each, weighted,
 * which has one hump and a different spread. The mixture is used here
 * because it is what the formula says; this rests on my reading of the
 * formula from memory, since the paper could not be opened.
 *
 * CHOICE 2: between 8 cm and 11 cm the paper asks for a "bridging function"
 * and, as far as could be found, does not define one. Here the
 * large-fragment distribution is used with a probability that rises
 * linearly from 0 at 8 cm to 1 at 11 cm, and the small-fragment one
 * otherwise, as the ESA implementation does.
 */
export function sampleAreaToMass(random: Random, kind: ParentKind, lengthM: number): number {
  const lambda = Math.log10(lengthM);
  const useLarge =
    lengthM >= LARGE_FRAGMENT_LIMIT_M ||
    (lengthM > SMALL_FRAGMENT_LIMIT_M &&
      random() <
        (lengthM - SMALL_FRAGMENT_LIMIT_M) / (LARGE_FRAGMENT_LIMIT_M - SMALL_FRAGMENT_LIMIT_M));
  if (useLarge) {
    const { alpha, mu1, sigma1, mu2, sigma2 } = areaToMassParameters(kind, lambda);
    const chi =
      random() < alpha ? sampleNormal(random, mu1, sigma1) : sampleNormal(random, mu2, sigma2);
    return 10 ** chi;
  }
  const { mu, sigma } = smallFragmentAreaToMass(lambda);
  return 10 ** sampleNormal(random, mu, sigma);
}

/**
 * Average cross-sectional area of a fragment, in m^2, from its
 * characteristic length in metres (secondary).
 */
export function averageArea(lengthM: number): number {
  return lengthM < 0.00167 ? 0.540424 * lengthM ** 2 : 0.556945 * lengthM ** 2.0047077;
}

/**
 * Characteristic length, in metres, of an intact object of the given mass,
 * treating it as a sphere whose density falls with size as
 * 92.937 d^-0.74 kg/m^3 (secondary). Used for the large pieces that carry
 * leftover mass.
 */
export function lengthOfMass(massKg: number): number {
  return ((6 * massKg) / (92.937 * Math.PI)) ** (1 / 2.26);
}

// --- Speed -----------------------------------------------------------------------------

/** Standard deviation of log10(delta-v in m/s) (secondary). */
export const DELTA_V_SIGMA = 0.4;

/**
 * Mean of log10(delta-v in m/s) for a fragment with chi = log10(A/M):
 * 0.2 chi + 1.85 for explosions, 0.9 chi + 2.9 for collisions (secondary).
 */
export function meanLogDeltaV(event: 'explosion' | 'collision', chi: number): number {
  return event === 'explosion' ? 0.2 * chi + 1.85 : 0.9 * chi + 2.9;
}

/** Draw the speed at which a fragment leaves its parent, in m/s. */
export function sampleDeltaV(
  random: Random,
  event: 'explosion' | 'collision',
  areaToMass: number,
): number {
  return 10 ** sampleNormal(random, meanLogDeltaV(event, Math.log10(areaToMass)), DELTA_V_SIGMA);
}

/** A direction chosen uniformly over the sphere, as a unit vector. */
export function sampleDirection(random: Random): [number, number, number] {
  const z = 2 * random() - 1;
  const angle = 2 * Math.PI * random();
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(angle), r * Math.sin(angle), z];
}

// --- A whole cloud ----------------------------------------------------------------------

export interface Fragment {
  /** Characteristic length, in metres. */
  readonly lengthM: number;
  /** Area-to-mass ratio, in m^2/kg. */
  readonly areaToMass: number;
  /** Average cross-sectional area, in m^2. */
  readonly areaM2: number;
  /** Mass, in kilograms. */
  readonly massKg: number;
  /** Velocity relative to the parent, in m/s. */
  readonly deltaV: readonly [number, number, number];
  /** True for a large piece added to carry mass the power law did not account for. */
  readonly remnant: boolean;
}

export interface CloudRequest {
  readonly event: 'explosion' | 'collision';
  /** What the fragments come from. */
  readonly kind: ParentKind;
  /** Fragments smaller than this are not generated, in metres. */
  readonly smallestLengthM: number;
  /**
   * For an explosion: the factor S. For a collision: the mass M from
   * `assessCollision`, in kilograms.
   */
  readonly scaleOrReferenceMass: number;
  /** The mass that the fragments must add up to, in kilograms. */
  readonly massToConserveKg: number;
  /**
   * How many large pieces share any leftover mass. Krisko (2011) says two
   * to eight for explosions, "several" for catastrophic collisions and one,
   * the cratered target, for non-catastrophic ones.
   */
  readonly remnantCount: number;
  /**
   * The most mass the power-law fragments may take, in kilograms, if less
   * than the mass to conserve. For a collision that is not catastrophic
   * this is M itself (Krisko 2011): the rest stays in the cratered target.
   */
  readonly powerLawMassKg?: number;
  /**
   * If true the large pieces are left with no velocity of their own: for
   * the cratered target of a collision that did not destroy it.
   */
  readonly remnantsAtRest?: boolean;
}

/**
 * Generate the fragments of one break-up.
 *
 * Fragments are drawn from the size distribution between the smallest
 * length asked for and 1 m, and given an area-to-mass ratio, an area, a
 * mass (area divided by area-to-mass) and a velocity. Mass is then made to
 * balance as Krisko (2011) describes: fragments stop being added when the
 * mass to conserve is used up, and whatever is left over is placed in a few
 * large pieces.
 *
 * CHOICE 3: the order in which fragments are "deposited" is not specified
 * beyond "from 1 mm upward". Here they are drawn in random order and the
 * first one that would exceed the mass to conserve, and all after it, are
 * discarded. The large pieces share the leftover mass equally and move off
 * with speeds drawn like any other fragment's.
 */
export function generateCloud(request: CloudRequest, random: Random): Fragment[] {
  const { event, kind, smallestLengthM, scaleOrReferenceMass, massToConserveKg } = request;
  const exponent = event === 'explosion' ? EXPLOSION_EXPONENT : COLLISION_EXPONENT;
  const larger = (lengthM: number): number =>
    event === 'explosion'
      ? explosionFragmentsLargerThan(lengthM, scaleOrReferenceMass)
      : collisionFragmentsLargerThan(lengthM, scaleOrReferenceMass);
  const count = Math.max(
    0,
    Math.round(larger(smallestLengthM) - larger(LARGEST_POWER_LAW_FRAGMENT_M)),
  );

  const make = (lengthM: number, massKg: number | null, remnant: boolean): Fragment => {
    const areaM2 = averageArea(lengthM);
    const areaToMass = massKg === null ? sampleAreaToMass(random, kind, lengthM) : areaM2 / massKg;
    const speed = sampleDeltaV(random, event, areaToMass);
    const [x, y, z] = sampleDirection(random);
    return {
      lengthM,
      areaToMass,
      areaM2,
      massKg: massKg ?? areaM2 / areaToMass,
      deltaV: [x * speed, y * speed, z * speed],
      remnant,
    };
  };

  const fragments: Fragment[] = [];
  let usedKg = 0;
  for (let i = 0; i < count; i += 1) {
    const fragment = make(
      samplePowerLawLength(random, exponent, smallestLengthM, LARGEST_POWER_LAW_FRAGMENT_M),
      null,
      false,
    );
    if (usedKg + fragment.massKg > Math.min(massToConserveKg, request.powerLawMassKg ?? Infinity)) {
      break;
    }
    usedKg += fragment.massKg;
    fragments.push(fragment);
  }

  const leftoverKg = massToConserveKg - usedKg;
  const remnants = Math.max(1, Math.round(request.remnantCount));
  if (leftoverKg > 0) {
    const each = leftoverKg / remnants;
    for (let i = 0; i < remnants; i += 1) {
      const piece = make(lengthOfMass(each), each, true);
      fragments.push(request.remnantsAtRest === true ? { ...piece, deltaV: [0, 0, 0] } : piece);
    }
  }
  return fragments;
}

/** Total momentum of a cloud relative to its parent, in kg m/s, and the sum of the fragments' own magnitudes. */
export function momentumOf(fragments: readonly Fragment[]): {
  readonly net: number;
  readonly gross: number;
} {
  let x = 0;
  let y = 0;
  let z = 0;
  let gross = 0;
  for (const { massKg, deltaV } of fragments) {
    x += massKg * deltaV[0];
    y += massKg * deltaV[1];
    z += massKg * deltaV[2];
    gross += massKg * Math.hypot(deltaV[0], deltaV[1], deltaV[2]);
  }
  return { net: Math.hypot(x, y, z), gross };
}

/**
 * Shift every fragment's velocity by the same amount so that the cloud as a
 * whole has no momentum relative to its parent.
 *
 * SIMPLIFICATION, not part of the published model. The model throws each
 * fragment in an independent random direction, so a finite cloud ends up
 * with some net momentum that the real break-up could not have had:
 * typically 9% of the sum of the fragments' own momenta, and up to 23% in
 * the clouds of VALIDATION.md, V6.1. Taking out the mass-weighted mean
 * velocity restores the balance exactly. It moves every fragment's velocity
 * by the same amount, up to about 15 m/s in those clouds, which is small
 * beside the tens to hundreds of metres per second the fragments are
 * thrown off at, but is not nothing.
 */
export function withoutNetMomentum(fragments: readonly Fragment[]): Fragment[] {
  let mass = 0;
  const mean = [0, 0, 0];
  for (const fragment of fragments) {
    mass += fragment.massKg;
    mean[0] = (mean[0] ?? 0) + fragment.massKg * fragment.deltaV[0];
    mean[1] = (mean[1] ?? 0) + fragment.massKg * fragment.deltaV[1];
    mean[2] = (mean[2] ?? 0) + fragment.massKg * fragment.deltaV[2];
  }
  if (mass === 0) {
    return [...fragments];
  }
  const [mx = 0, my = 0, mz = 0] = mean.map((component) => component / mass);
  return fragments.map((fragment) => ({
    ...fragment,
    deltaV: [fragment.deltaV[0] - mx, fragment.deltaV[1] - my, fragment.deltaV[2] - mz],
  }));
}
