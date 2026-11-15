import {
  assessCollision,
  averageArea,
  CATASTROPHIC_THRESHOLD_J_PER_G,
  generateCloud,
  lengthOfMass,
  seededRandom,
  type CollisionAssessment,
  type Fragment,
  type ParentKind,
  type Random,
} from './breakupModel';
import { DRAG_COEFFICIENT, followDecay, type OrbitHistory } from './decay';
import { EARTH_RADIUS_KM, elementsFromState, MU_KM3_S2, norm, type Vec3 } from './orbit';

/**
 * One whole "What if?" run: make the fragments, follow each for a century,
 * and estimate how often they would go on to hit something else.
 *
 * ILLUSTRATIVE MODEL, NOT A PREDICTION. It strings together a standard
 * breakup model, a standard but simplified orbit theory, a crude
 * atmosphere and a kinetic-theory collision rate, with assumptions stated
 * where they are made. Its outputs are for seeing how such events behave,
 * and how much the answer depends on chance, not for forecasting.
 */

/** A body that breaks up. Position in km and velocity in km/s, in the tracker's inertial frame. */
export interface ParentBody {
  readonly label: string;
  readonly r: Vec3;
  readonly v: Vec3;
  readonly massKg: number;
  readonly kind: ParentKind;
}

export type EventKind = 'collision' | 'antiSatellite' | 'explosion';

export interface SimulationRequest {
  readonly event: EventKind;
  /** Two bodies for a collision, one otherwise. */
  readonly parents: readonly ParentBody[];
  /** Fragments smaller than this are not simulated, in metres. */
  readonly smallestLengthM: number;
  /** Multiplier on the air density (the solar setting). */
  readonly densityFactor: number;
  /** Lowest and highest heights, in km, of every object in the tracker's catalog. */
  readonly background: {
    readonly perigeeKm: ArrayLike<number>;
    readonly apogeeKm: ArrayLike<number>;
  };
  /** How many times to repeat the whole run with different random fragments. */
  readonly trials: number;
  readonly seed: number;
}

/** How long each fragment is followed, in years. */
export const HORIZON_YEARS = 100;
/** The times at which results are quoted, in years. */
export const QUOTED_YEARS = [1, 10, 100] as const;
/** Times, in years, at which the number still in orbit is recorded for the chart: 1 day to 100 years. */
export const CURVE_YEARS: readonly number[] = Array.from(
  { length: 33 },
  (_, k) => (1 / 365.25) * (100 * 365.25) ** (k / 32),
);

/** Height bands for the collision estimate: 50 km wide, 150 to 2,000 km. */
export const BAND_KM = 50;
export const LOWEST_BAND_KM = 150;
export const BAND_COUNT = 37;

/**
 * ASSUMPTION: the mass of a typical intact object in the catalog, in
 * kilograms. The orbital data gives no masses or sizes, so every
 * catalogued object is treated as one of this mass, with the size the
 * breakup model's own relations give it (about 2.8 m across and 4.4 m^2 in
 * cross-section). It is a round number, not a statistic.
 */
export const TYPICAL_OBJECT_MASS_KG = 500;

/** One fragment as the simulator follows it. */
export interface SimFragment {
  readonly lengthM: number;
  readonly massKg: number;
  readonly areaToMass: number;
  /** Which parent it came from: a position in the request's list. */
  readonly parent: number;
  readonly inclination: number;
  readonly history: OrbitHistory;
}

/** What one repetition of the run produced. */
export interface TrialSummary {
  /** Fragments generated at or above the smallest size. */
  readonly fragments: number;
  /** Of those, how many were thrown onto paths that leave the Earth or were already below the re-entry height. */
  readonly lostAtOnce: number;
  /** Fraction of the fragments still in orbit at each of `QUOTED_YEARS`. */
  readonly remaining: readonly number[];
  /** Fraction still in orbit at each of `CURVE_YEARS`. */
  readonly curve: readonly number[];
  /** Expected number of hits on catalogued objects by each of `QUOTED_YEARS`. */
  readonly hits: readonly number[];
  /** Of those, the hits energetic enough to destroy the typical object. */
  readonly destructiveHits: readonly number[];
  /** Expected hits within the horizon, by height band. */
  readonly hitsByBand: readonly number[];
}

export interface SimulationResult {
  /** For a collision: its energy and whether it destroys both bodies. */
  readonly collision: (CollisionAssessment & { readonly speedKmS: number }) | null;
  /** The fragments of the first repetition, for drawing. */
  readonly display: readonly SimFragment[];
  readonly trials: readonly TrialSummary[];
  /** Catalogued objects per height band, counted by the share of its orbit each spends there. */
  readonly backgroundByBand: readonly number[];
}

/** The height band a height falls in, or -1 if it is outside all of them. */
export function bandOf(heightKm: number): number {
  const band = Math.floor((heightKm - LOWEST_BAND_KM) / BAND_KM);
  return band >= 0 && band < BAND_COUNT ? band : -1;
}

function bandVolumeKm3(band: number): number {
  const inner = EARTH_RADIUS_KM + LOWEST_BAND_KM + band * BAND_KM;
  return (4 / 3) * Math.PI * ((inner + BAND_KM) ** 3 - inner ** 3);
}

/** Points round an orbit at which its height is sampled to share it out between bands. */
const RESIDENCE_POINTS = 8;

/**
 * Add an orbit's presence to the height bands: `weight` in total, shared
 * out in proportion to the time spent in each band.
 */
export function addResidence(a: number, e: number, weight: number, bands: Float64Array): void {
  for (let k = 0; k < RESIDENCE_POINTS; k += 1) {
    const cosE = Math.cos(((k + 0.5) * 2 * Math.PI) / RESIDENCE_POINTS);
    const band = bandOf(a * (1 - e * cosE) - EARTH_RADIUS_KM);
    if (band >= 0) {
      // Time spent near eccentric anomaly E is in proportion to 1 - e cos E.
      bands[band] = (bands[band] ?? 0) + (weight * (1 - e * cosE)) / RESIDENCE_POINTS;
    }
  }
}

/**
 * Relative speed assumed for a fragment meeting an object in a band, km/s.
 *
 * SIMPLIFICATION: two objects on circular orbits of the same height whose
 * planes are tilted by an angle g meet at 2 v sin(g/2). If the planes are
 * oriented at random with respect to each other the average of that is
 * (4/3) v, about 10 km/s in low orbit.
 */
export function meetingSpeedKmS(band: number): number {
  const radius = EARTH_RADIUS_KM + LOWEST_BAND_KM + (band + 0.5) * BAND_KM;
  return (4 / 3) * Math.sqrt(MU_KM3_S2 / radius);
}

/** Make the fragments of one repetition. */
export function buildFragments(
  request: SimulationRequest,
  random: Random,
): { fragment: Fragment; parent: number }[] {
  const { parents, event, smallestLengthM } = request;
  const out: { fragment: Fragment; parent: number }[] = [];
  const emit = (parent: number, cloud: readonly Fragment[]): void => {
    for (const fragment of cloud) {
      out.push({ fragment, parent });
    }
  };
  const [first, second] = parents;
  if (first === undefined) {
    return out;
  }
  if (event === 'explosion') {
    emit(
      0,
      generateCloud(
        {
          event: 'explosion',
          kind: first.kind,
          smallestLengthM,
          scaleOrReferenceMass: 1,
          massToConserveKg: first.massKg,
          // "Two to eight" large pieces (Krisko 2011); which, is left to chance.
          remnantCount: 2 + Math.floor(random() * 7),
        },
        random,
      ),
    );
    return out;
  }
  if (event === 'antiSatellite' || second === undefined) {
    // SIMPLIFICATION: the interceptor's own mass is not known and is left out.
    emit(
      0,
      generateCloud(
        {
          event: 'collision',
          kind: first.kind,
          smallestLengthM,
          scaleOrReferenceMass: first.massKg,
          massToConserveKg: first.massKg,
          remnantCount: 3,
        },
        random,
      ),
    );
    return out;
  }
  const heavier = first.massKg >= second.massKg ? 0 : 1;
  const big = parents[heavier] ?? first;
  const small = parents[1 - heavier] ?? second;
  const assessment = assessCollision(big.massKg, small.massKg, norm(relative(first.v, second.v)));
  if (!assessment.catastrophic) {
    emit(
      heavier,
      generateCloud(
        {
          event: 'collision',
          kind: big.kind,
          smallestLengthM,
          scaleOrReferenceMass: assessment.referenceMassKg,
          massToConserveKg: big.massKg + small.massKg,
          powerLawMassKg: assessment.referenceMassKg,
          remnantCount: 1,
          remnantsAtRest: true,
        },
        random,
      ),
    );
    return out;
  }
  // CHOICE: the model gives one fragment count for the pair. It is shared
  // between the two bodies in proportion to their masses, and each body's
  // fragments start from that body's own velocity and add up to its mass.
  parents.forEach((parent, index) => {
    const share = parent.massKg / assessment.referenceMassKg;
    emit(
      index,
      generateCloud(
        {
          event: 'collision',
          kind: parent.kind,
          smallestLengthM,
          // 0.1 x^0.75 = share * 0.1 M^0.75 when x = M share^(4/3).
          scaleOrReferenceMass: assessment.referenceMassKg * share ** (4 / 3),
          massToConserveKg: parent.massKg,
          remnantCount: 3,
        },
        random,
      ),
    );
  });
  return out;
}

function relative(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** The fraction of the values at or below each of the times, for re-entry times with null meaning never. */
function fractionRemaining(
  reentry: readonly (number | null)[],
  times: readonly number[],
): number[] {
  const n = Math.max(1, reentry.length);
  return times.map((time) => reentry.filter((at) => at === null || at > time).length / n);
}

/** Run one repetition. */
export function runTrial(
  request: SimulationRequest,
  backgroundByBand: Float64Array,
  random: Random,
): { summary: TrialSummary; fragments: SimFragment[] } {
  const objectAreaKm2 = averageArea(lengthOfMass(TYPICAL_OBJECT_MASS_KG)) * 1e-6;
  // Expected hits per second for one fragment wholly in a band.
  const ratePerSecond = Array.from(
    { length: BAND_COUNT },
    (_, band) =>
      ((backgroundByBand[band] ?? 0) / bandVolumeKm3(band)) * objectAreaKm2 * meetingSpeedKmS(band),
  );
  const secondsPerYear = 365.25 * 86_400;
  const hits = QUOTED_YEARS.map(() => 0);
  const destructive = QUOTED_YEARS.map(() => 0);
  const hitsByBand = new Float64Array(BAND_COUNT);
  const share = new Float64Array(BAND_COUNT);
  const reentry: (number | null)[] = [];
  const fragments: SimFragment[] = [];
  let lostAtOnce = 0;

  for (const { fragment, parent } of buildFragments(request, random)) {
    const body = request.parents[parent];
    if (body === undefined) {
      continue;
    }
    const velocity: Vec3 = [
      body.v[0] + fragment.deltaV[0] / 1000,
      body.v[1] + fragment.deltaV[1] / 1000,
      body.v[2] + fragment.deltaV[2] / 1000,
    ];
    const elements = elementsFromState(body.r, velocity);
    if (!(elements.e < 1) || !(elements.a > 0)) {
      // Thrown fast enough to leave the Earth: not in orbit, and not followed.
      lostAtOnce += 1;
      reentry.push(0);
      continue;
    }
    const history = followDecay(
      elements,
      DRAG_COEFFICIENT * fragment.areaToMass,
      request.densityFactor,
      HORIZON_YEARS,
    );
    if (history.reentryYears === 0) {
      lostAtOnce += 1;
    }
    reentry.push(history.reentryYears);
    fragments.push({
      lengthM: fragment.lengthM,
      massKg: fragment.massKg,
      areaToMass: fragment.areaToMass,
      parent,
      inclination: elements.i,
      history,
    });
    // Add up the chance of hitting something, interval by interval.
    for (let k = 0; k + 1 < history.years.length; k += 1) {
      const from = history.years[k] ?? 0;
      const to = history.years[k + 1] ?? from;
      share.fill(0);
      addResidence(history.a[k] ?? 0, history.e[k] ?? 0, 1, share);
      for (let band = 0; band < BAND_COUNT; band += 1) {
        const presence = share[band] ?? 0;
        if (presence === 0) {
          continue;
        }
        const perYear = presence * (ratePerSecond[band] ?? 0) * secondsPerYear;
        // Energy of this fragment at the meeting speed, per gram of the typical object.
        const energy =
          (0.5 * fragment.massKg * (meetingSpeedKmS(band) * 1000) ** 2) /
          (TYPICAL_OBJECT_MASS_KG * 1000);
        QUOTED_YEARS.forEach((limit, index) => {
          const span = Math.max(0, Math.min(to, limit) - from);
          hits[index] = (hits[index] ?? 0) + perYear * span;
          if (energy >= CATASTROPHIC_THRESHOLD_J_PER_G) {
            destructive[index] = (destructive[index] ?? 0) + perYear * span;
          }
        });
        hitsByBand[band] = (hitsByBand[band] ?? 0) + perYear * (to - from);
      }
    }
  }

  return {
    summary: {
      fragments: reentry.length,
      lostAtOnce,
      remaining: fractionRemaining(reentry, QUOTED_YEARS),
      curve: fractionRemaining(reentry, CURVE_YEARS),
      hits,
      destructiveHits: destructive,
      hitsByBand: [...hitsByBand],
    },
    fragments,
  };
}

/** For a collision: how fast the two bodies meet, the energy, and whether both are destroyed. Otherwise null. */
export function collisionOf(
  request: Pick<SimulationRequest, 'event' | 'parents'>,
): SimulationResult['collision'] {
  const [first, second] = request.parents;
  if (request.event !== 'collision' || first === undefined || second === undefined) {
    return null;
  }
  const speedKmS = norm(relative(first.v, second.v));
  return {
    ...assessCollision(
      Math.max(first.massKg, second.massKg),
      Math.min(first.massKg, second.massKg),
      speedKmS,
    ),
    speedKmS,
  };
}

/**
 * Run the whole simulation: every repetition, with the first one's
 * fragments kept for drawing.
 *
 * @param onTrial called after each repetition with its position, its summary and its fragments
 */
export function runSimulation(
  request: SimulationRequest,
  onTrial?: (index: number, summary: TrialSummary, fragments: readonly SimFragment[]) => void,
): SimulationResult {
  if (!(request.densityFactor > 0) || !(request.smallestLengthM > 0)) {
    throw new Error(
      'The air density setting and the smallest fragment size must be positive numbers.',
    );
  }
  const backgroundByBand = new Float64Array(BAND_COUNT);
  const { perigeeKm, apogeeKm } = request.background;
  for (let k = 0; k < perigeeKm.length; k += 1) {
    const low = EARTH_RADIUS_KM + (perigeeKm[k] ?? 0);
    const high = EARTH_RADIUS_KM + (apogeeKm[k] ?? 0);
    if (high >= low && low > EARTH_RADIUS_KM) {
      addResidence((low + high) / 2, (high - low) / (high + low), 1, backgroundByBand);
    }
  }
  const collision = collisionOf(request);

  const trials: TrialSummary[] = [];
  let display: SimFragment[] = [];
  const total = Math.max(1, Math.round(request.trials));
  for (let trial = 0; trial < total; trial += 1) {
    const { summary, fragments } = runTrial(
      request,
      backgroundByBand,
      seededRandom(request.seed + trial * 7919),
    );
    trials.push(summary);
    if (trial === 0) {
      display = fragments;
    }
    onTrial?.(trial, summary, fragments);
  }
  return { collision, display, trials, backgroundByBand: [...backgroundByBand] };
}

/** The smallest, middle and largest of some numbers. */
export function spread(values: readonly number[]): { low: number; median: number; high: number } {
  const sorted = [...values].sort((x, y) => x - y);
  const n = sorted.length;
  if (n === 0) {
    return { low: 0, median: 0, high: 0 };
  }
  const middle =
    n % 2 === 1
      ? (sorted[(n - 1) / 2] ?? 0)
      : ((sorted[n / 2 - 1] ?? 0) + (sorted[n / 2] ?? 0)) / 2;
  return { low: sorted[0] ?? 0, median: middle, high: sorted[n - 1] ?? 0 };
}
