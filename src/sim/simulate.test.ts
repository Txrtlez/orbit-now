import { describe, expect, it } from 'vitest';
import { seededRandom } from './breakupModel';
import { cloudPositions, describeSpan, fractionOfMoment, momentAt } from './cloud';
import { EARTH_RADIUS_KM, norm } from './orbit';
import { crossingBody, customScenario, fromScene, PRESETS, presetById } from './scenario';
import {
  addResidence,
  BAND_COUNT,
  bandOf,
  buildFragments,
  meetingSpeedKmS,
  runSimulation,
  spread,
  type SimFragment,
  type SimulationRequest,
} from './simulate';

function request(id: string, extra: Partial<SimulationRequest> = {}): SimulationRequest {
  const preset = presetById(id);
  if (preset === undefined) {
    throw new Error(`no preset ${id}`);
  }
  // 400 stand-in objects on circular orbits between 500 and 900 km.
  const heights = Array.from({ length: 400 }, (_, k) => 500 + k);
  return {
    ...preset.build(),
    smallestLengthM: 0.1,
    densityFactor: 1,
    background: { perigeeKm: heights, apogeeKm: heights },
    trials: 2,
    seed: 7,
    ...extra,
  };
}

describe('height bands', () => {
  it('puts a circular orbit wholly in its own band', () => {
    const bands = new Float64Array(BAND_COUNT);
    addResidence(EARTH_RADIUS_KM + 810, 0, 1, bands);
    expect(bands[bandOf(810)]).toBeCloseTo(1, 12);
    expect(bands.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 12);
  });

  it('shares an eccentric orbit out, with more of it near the top', () => {
    const bands = new Float64Array(BAND_COUNT);
    // 400 km by 1,400 km.
    const a = EARTH_RADIUS_KM + 900;
    addResidence(a, 500 / a, 1, bands);
    expect(bands.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 12);
    const low = bands.slice(0, bandOf(900)).reduce((sum, v) => sum + v, 0);
    expect(low).toBeLessThan(0.5);
    expect(low).toBeGreaterThan(0.3);
  });

  it('counts nothing for an orbit outside every band', () => {
    const bands = new Float64Array(BAND_COUNT);
    addResidence(42_164, 0, 1, bands);
    expect(bands.every((v) => v === 0)).toBe(true);
    expect(bandOf(149)).toBe(-1);
    expect(bandOf(2000)).toBe(-1);
  });

  it('assumes a meeting speed of four thirds of the orbital speed', () => {
    // 7.45 km/s at about 800 km.
    expect(meetingSpeedKmS(bandOf(800))).toBeCloseTo((4 / 3) * 7.45, 1);
  });
});

describe('making the fragments', () => {
  it('gives each body of a destructive collision fragments adding up to its own mass', () => {
    const scenario = presetById('two-satellites')?.build();
    const made = buildFragments(request('two-satellites'), seededRandom(3));
    for (const index of [0, 1]) {
      const mass = made
        .filter((entry) => entry.parent === index)
        .reduce((sum, entry) => sum + entry.fragment.massKg, 0);
      expect(mass).toBeCloseTo(scenario?.parents[index]?.massKg ?? 0, 6);
    }
    // The heavier body makes more pieces.
    const count = (index: number): number => made.filter((entry) => entry.parent === index).length;
    expect(count(1)).toBeGreaterThan(count(0));
  });

  it('leaves the target in one piece when the collision is too weak to destroy it', () => {
    const target = presetById('rocket-and-satellite')?.build().parents[0];
    if (target === undefined) {
      throw new Error('no target');
    }
    // One kilogram at about 10.5 km/s into three tonnes: 18 J/g, under the 40 J/g threshold.
    const scenario = customScenario(target, {
      event: 'collision',
      massKg: 3000,
      otherMassKg: 1,
      crossingDegrees: 90,
    });
    const made = buildFragments(
      { ...request('rocket-and-satellite'), ...scenario },
      seededRandom(5),
    );
    const remnants = made.filter((entry) => entry.fragment.remnant);
    expect(remnants).toHaveLength(1);
    expect(remnants[0]?.fragment.massKg).toBeGreaterThan(2900);
    expect(remnants[0]?.fragment.deltaV).toEqual([0, 0, 0]);
    expect(made.reduce((sum, entry) => sum + entry.fragment.massKg, 0)).toBeCloseTo(3001, 6);
    expect(made.every((entry) => entry.parent === 0)).toBe(true);
  });
});

describe('a whole run', { timeout: 60_000 }, () => {
  it('gives the same answer for the same seed and a different one for another', () => {
    const first = runSimulation(request('stage-explosion'));
    const again = runSimulation(request('stage-explosion'));
    const other = runSimulation(request('stage-explosion', { seed: 8 }));
    expect(again.trials).toEqual(first.trials);
    expect(other.trials).not.toEqual(first.trials);
    expect(first.trials[0]).not.toEqual(first.trials[1]);
  });

  it('counts hits in proportion to how many objects there are to hit', () => {
    const one = runSimulation(request('stage-explosion'));
    const heights = [...one.backgroundByBand].length;
    expect(heights).toBe(BAND_COUNT);
    const base = request('stage-explosion');
    const doubled = runSimulation({
      ...base,
      background: {
        perigeeKm: [
          ...Array.from(base.background.perigeeKm),
          ...Array.from(base.background.perigeeKm),
        ],
        apogeeKm: [
          ...Array.from(base.background.apogeeKm),
          ...Array.from(base.background.apogeeKm),
        ],
      },
    });
    const none = runSimulation({ ...base, background: { perigeeKm: [], apogeeKm: [] } });
    const hits = (result: typeof one): number => result.trials[0]?.hits[2] ?? Number.NaN;
    expect(hits(one)).toBeGreaterThan(0);
    expect(hits(doubled) / hits(one)).toBeCloseTo(2, 9);
    expect(hits(none)).toBe(0);
  });

  it('reports hits that only grow with time, and destructive ones as a part of them', () => {
    const [trial] = runSimulation(request('two-satellites', { trials: 1 })).trials;
    const hits = trial?.hits ?? [];
    expect(hits[0]).toBeLessThanOrEqual(hits[1] ?? 0);
    expect(hits[1]).toBeLessThanOrEqual(hits[2] ?? 0);
    trial?.destructiveHits.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(hits[index] ?? 0);
    });
    expect(trial?.hitsByBand.reduce((sum, v) => sum + v, 0)).toBeCloseTo(hits[2] ?? 0, 9);
    // The curve of what is left never rises.
    const curve = trial?.curve ?? [];
    curve.forEach((value, index) => {
      expect(value).toBeLessThanOrEqual(curve[index - 1] ?? 1);
    });
  });

  it('says whether a collision destroys both bodies', () => {
    const result = runSimulation(request('two-satellites', { trials: 1 }));
    expect(result.collision?.catastrophic).toBe(true);
    expect(result.collision?.speedKmS).toBeCloseTo(11.57, 1);
    expect(runSimulation(request('stage-explosion', { trials: 1 })).collision).toBeNull();
  });

  it('refuses a density setting that is not a positive number', () => {
    expect(() =>
      runSimulation(request('stage-explosion', { densityFactor: Number.NaN })),
    ).toThrow();
  });

  it('finds the smallest, middle and largest of some numbers', () => {
    expect(spread([3, 1, 2])).toEqual({ low: 1, median: 2, high: 3 });
    expect(spread([4, 1, 2, 3]).median).toBe(2.5);
    expect(spread([])).toEqual({ low: 0, median: 0, high: 0 });
  });
});

describe('scenarios', () => {
  it('builds every preset on an orbit at the height it says', () => {
    for (const preset of PRESETS) {
      const { parents, event } = preset.build();
      expect(parents).toHaveLength(event === 'collision' ? 2 : 1);
      for (const parent of parents) {
        const height = norm(parent.r) - EARTH_RADIUS_KM;
        expect(height).toBeGreaterThan(450);
        expect(height).toBeLessThan(900);
        expect(norm(parent.v)).toBeGreaterThan(7.3);
        expect(norm(parent.v)).toBeLessThan(7.7);
      }
      if (parents.length === 2) {
        expect(parents[1]?.r).toEqual(parents[0]?.r);
      }
    }
    expect(new Set(PRESETS.map((preset) => preset.id)).size).toBe(PRESETS.length);
  });

  it('makes two crossing bodies close at twice the speed times the sine of half the angle', () => {
    const target = presetById('stage-explosion')?.build().parents[0];
    if (target === undefined) {
      throw new Error('no target');
    }
    for (const degrees of [0, 30, 90, 180]) {
      const other = crossingBody(target, 'x', 10, 'spacecraft', (degrees * Math.PI) / 180);
      const closing = norm([
        other.v[0] - target.v[0],
        other.v[1] - target.v[1],
        other.v[2] - target.v[2],
      ]);
      expect(closing).toBeCloseTo(2 * norm(target.v) * Math.sin((degrees * Math.PI) / 360), 9);
      expect(norm(other.v)).toBeCloseTo(norm(target.v), 9);
    }
  });

  it("reads a position from the tracker's drawing", () => {
    // The drawing has y north and is in Earth radii: (x, y, z) there is (x, -z, y) here.
    const { r, v } = fromScene([1, 2, 3], [0.1, 0.2, 0.3], 1000);
    expect(r).toEqual([1000, -3000, 2000]);
    expect(v[0]).toBeCloseTo(100, 9);
    expect(v[1]).toBeCloseTo(-300, 9);
    expect(v[2]).toBeCloseTo(200, 9);
  });
});

describe('drawing the cloud', { timeout: 60_000 }, () => {
  const cloud: SimFragment[] = [];
  const result = runSimulation(request('stage-explosion', { trials: 1 }), (_i, _s, fragments) => {
    cloud.push(...fragments);
  });

  it('starts every fragment at the place of the break-up', () => {
    const out = new Float32Array(cloud.length * 3);
    const parents = new Uint8Array(cloud.length);
    const parent = presetById('stage-explosion')?.build().parents[0];
    const drawn = cloudPositions(cloud, 0, 1, out, parents);
    expect(drawn).toBe(cloud.filter((f) => f.history.reentryYears !== 0).length);
    for (let k = 0; k < drawn; k += 1) {
      expect(out[k * 3]).toBeCloseTo(parent?.r[0] ?? 0, 0);
      expect(out[k * 3 + 1]).toBeCloseTo(parent?.r[2] ?? 0, 0);
      expect(out[k * 3 + 2]).toBeCloseTo(-(parent?.r[1] ?? 0), 0);
    }
  });

  it('leaves out fragments that have come down, in step with the summary', () => {
    const out = new Float32Array(cloud.length * 3);
    const parents = new Uint8Array(cloud.length);
    const drawn = cloudPositions(cloud, 10, 6378.137, out, parents);
    expect(drawn / (result.trials[0]?.fragments ?? 1)).toBeCloseTo(
      result.trials[0]?.remaining[1] ?? Number.NaN,
      9,
    );
    // Whatever is drawn is above the ground.
    for (let k = 0; k < drawn; k += 1) {
      expect(Math.hypot(out[k * 3] ?? 0, out[k * 3 + 1] ?? 0, out[k * 3 + 2] ?? 0)).toBeGreaterThan(
        1.01,
      );
    }
  });

  it('stretches the time control evenly in ratio, from a minute to a century', () => {
    expect(momentAt(0) * 365.25 * 1440).toBeCloseTo(1, 9);
    expect(momentAt(1)).toBeCloseTo(100, 9);
    expect(fractionOfMoment(momentAt(0.37))).toBeCloseTo(0.37, 9);
    expect(momentAt(-1)).toBe(momentAt(0));
  });

  it('puts spans of time into words', () => {
    const minute = 1 / (365.25 * 1440);
    expect(describeSpan(minute)).toBe('1 minute');
    expect(describeSpan(45 * minute)).toBe('45 minutes');
    expect(describeSpan(180 * minute)).toBe('3 hours');
    expect(describeSpan(12 / 365.25)).toBe('12 days');
    expect(describeSpan(0.5)).toBe('6 months');
    expect(describeSpan(7.5)).toBe('7.5 years');
    expect(describeSpan(100)).toBe('100 years');
  });
});
