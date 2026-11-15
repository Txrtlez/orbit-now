/**
 * Sanity checks of the whole "What if?" simulation against what really
 * happened after three break-ups, and against what NASA says its own
 * breakup model gives for one of them.
 *
 * These are checks of an ILLUSTRATIVE MODEL. The limits asserted here are
 * wide on purpose: they catch the model going badly wrong, and the numbers
 * actually measured, with the disagreements, are in VALIDATION.md (V6.4 and
 * V6.5).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOLAR_SETTINGS } from '../../src/sim/atmosphere';
import { PRESETS, presetById } from '../../src/sim/scenario';
import {
  BAND_COUNT,
  BAND_KM,
  LOWEST_BAND_KM,
  QUOTED_YEARS,
  runSimulation,
  spread,
  type SimFragment,
  type SimulationRequest,
} from '../../src/sim/simulate';
import { recordMeasurement } from './measurements';

interface Bands {
  readonly intact: readonly number[];
}
const bands = JSON.parse(
  readFileSync(new URL('../fixtures/sim/leo-bands-2026-11-15.json', import.meta.url), 'utf8'),
) as Bands;

/** Stand-ins for the real catalog: the right number of objects in each height band, on circular orbits. */
function background(): SimulationRequest['background'] {
  const perigeeKm: number[] = [];
  const apogeeKm: number[] = [];
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const height = LOWEST_BAND_KM + (band + 0.5) * BAND_KM;
    for (let k = 0; k < Math.round(bands.intact[band] ?? 0); k += 1) {
      perigeeKm.push(height);
      apogeeKm.push(height);
    }
  }
  return { perigeeKm, apogeeKm };
}

function run(id: string, densityFactor: number, trials: number) {
  const preset = presetById(id);
  if (preset === undefined) {
    throw new Error(`no preset ${id}`);
  }
  const clouds: (readonly SimFragment[])[] = [];
  const result = runSimulation(
    {
      ...preset.build(),
      smallestLengthM: 0.1,
      densityFactor,
      background: background(),
      trials,
      seed: 20261115,
    },
    (_index, _summary, fragments) => clouds.push(fragments),
  );
  /** Fraction of all fragments made that are still in orbit after `years`, in each repetition. */
  const inOrbitAt = (years: number): number[] =>
    clouds.map((cloud, k) => {
      const up = cloud.filter(
        (f) => f.history.reentryYears === null || f.history.reentryYears > years,
      ).length;
      return up / (result.trials[k]?.fragments ?? 1);
    });
  return { result, inOrbitAt };
}

const median = (values: readonly number[]): number => spread(values).median;
const round = (value: number, places = 3): number => Number(value.toFixed(places));

/** What really happened, from NASA (VALIDATION.md, V5.3): years after the event, and the share of catalogued pieces still up. */
const HISTORY = [
  { id: 'weather-satellite', years: 16.05, catalogued: 3532, inOrbit: 2793 },
  { id: 'two-satellites', years: 13.97, catalogued: 2372, inOrbit: 1321 },
  { id: 'low-satellite', years: 1.21, catalogued: 1785, inOrbit: 364 },
] as const;

describe('the simulation against three real break-ups', () => {
  for (const event of HISTORY) {
    it(`${event.id}: fragments made and still in orbit`, { timeout: 120_000 }, () => {
      const real = event.inOrbit / event.catalogued;
      const values: Record<string, number> = {
        realCatalogued: event.catalogued,
        realShare: round(real),
      };
      for (const setting of SOLAR_SETTINGS) {
        const { result, inOrbitAt } = run(event.id, setting.factor, 6);
        const day = inOrbitAt(1 / 365.25);
        const then = inOrbitAt(event.years);
        if (setting.id === 'average') {
          values.fragments = median(result.trials.map((t) => t.fragments));
          values.inOrbitAfterOneDay = Math.round(median(day) * values.fragments);
        }
        // Compared with the real share of CATALOGUED pieces: a piece has to
        // stay up for weeks at least to be catalogued, so the model's share is
        // taken of those still up after a month.
        const month = inOrbitAt(1 / 12);
        values[`${setting.id}ShareOfAll`] = round(median(then));
        values[`${setting.id}ShareOfThoseUpAfterAMonth`] = round(
          median(then.map((v, k) => v / (month[k] ?? 1))),
        );
      }
      recordMeasurement(`V6.4 ${event.id} at ${String(event.years)} years`, values);
      expect(values.fragments).toBeGreaterThan(0);
      // The model's share still in orbit, for some solar setting, is within 0.25 of the real one.
      const shares = SOLAR_SETTINGS.map(
        (s) => values[`${s.id}ShareOfThoseUpAfterAMonth`] ?? Number.NaN,
      );
      expect(Math.min(...shares.map((s) => Math.abs(s - real)))).toBeLessThan(0.25);
      // More air means fewer left.
      expect(shares[0]).toBeGreaterThanOrEqual(shares[1] ?? 0);
      expect(shares[1]).toBeGreaterThanOrEqual(shares[2] ?? 0);
    });
  }

  it('makes about as many pieces of a Fengyun-1C as NASA says its model does', () => {
    // Johnson et al., IAC-07-A6.3.01: the standard model "would predict about
    // 1000 debris of that size remaining in orbit after the first day".
    const { result, inOrbitAt } = run('weather-satellite', 1, 6);
    const made = median(result.trials.map((t) => t.fragments));
    const afterADay = median(inOrbitAt(1 / 365.25)) * made;
    recordMeasurement('V6.4 Fengyun-1C-like, against NASA\'s "about 1000 after the first day"', {
      made,
      afterADay: Math.round(afterADay),
    });
    expect(afterADay).toBeGreaterThan(700);
    expect(afterADay).toBeLessThan(1100);
  });
});

describe('every preset', () => {
  it('runs, and debris lasts longer the higher it starts', { timeout: 180_000 }, () => {
    const tenYears: Record<string, number> = {};
    for (const preset of PRESETS) {
      const { result } = run(preset.id, 1, 6);
      const at = (index: number): number =>
        median(result.trials.map((t) => t.remaining[index] ?? 0));
      const hits = result.trials.map((t) => t.hits[2] ?? 0);
      const destructive = result.trials.map((t) => t.destructiveHits[2] ?? 0);
      tenYears[preset.id] = at(1);
      recordMeasurement(`V6.5 ${preset.id}`, {
        fragments: median(result.trials.map((t) => t.fragments)),
        lostAtOnce: median(result.trials.map((t) => t.lostAtOnce)),
        after1: round(at(0)),
        after10: round(at(1)),
        after100: round(at(2)),
        hitsIn100Years: round(median(hits), 4),
        hitsLow: round(spread(hits).low, 4),
        hitsHigh: round(spread(hits).high, 4),
        destructiveIn100Years: round(median(destructive), 4),
        speedKmS: round(result.collision?.speedKmS ?? 0, 2),
        energyJPerG: Math.round(result.collision?.specificEnergyJPerG ?? 0),
      });
      expect(result.trials).toHaveLength(6);
      expect(QUOTED_YEARS).toHaveLength(3);
    }
    // 480 km, 600 km, 790 km, 860 km.
    expect(tenYears['low-satellite']).toBeLessThan(tenYears['stage-explosion'] ?? 0);
    expect(tenYears['stage-explosion']).toBeLessThan(tenYears['two-satellites'] ?? 0);
    expect(tenYears['low-satellite']).toBeLessThan(0.2);
    expect(tenYears['weather-satellite']).toBeGreaterThan(0.5);
  });
});
