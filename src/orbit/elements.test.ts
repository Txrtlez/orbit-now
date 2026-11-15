import { describe, expect, it } from 'vitest';
import {
  classifyRegime,
  orbitSampleOffsetsMinutes,
  parseDesignator,
  solveKepler,
} from './elements';

describe('parseDesignator', () => {
  it('splits a designator into year, launch number and piece', () => {
    expect(parseDesignator('1998-067A')).toEqual({
      year: 1998,
      launchNumber: 67,
      piece: 'A',
      launchId: '1998-067',
    });
    expect(parseDesignator('2026-227DE')?.piece).toBe('DE');
    expect(parseDesignator(' 1964-063C ')?.launchId).toBe('1964-063');
  });

  it('returns null for anything else instead of guessing', () => {
    for (const text of ['', '98067A', '1998-67A', '1998-067', '1998-067a', '1998-067ABCD', 'x']) {
      expect(parseDesignator(text)).toBeNull();
    }
  });
});

describe('classifyRegime', () => {
  it('sorts representative orbits into the four regimes', () => {
    // A space-station-like orbit: nearly circular, about 420 km up, 15.5 revolutions a day.
    expect(classifyRegime(0.0005, 421, 15.5)).toBe('LEO');
    // A navigation-satellite-like orbit: circular, about 20,200 km up, 2 revolutions a day.
    expect(classifyRegime(0.01, 20_400, 2.0057)).toBe('MEO');
    // Geostationary: one revolution per sidereal day.
    expect(classifyRegime(0.0002, 35_800, 1.0027)).toBe('GEO');
    // Inclined geosynchronous with a mildly eccentric orbit still counts as GEO.
    expect(classifyRegime(0.075, 38_900, 1.0027)).toBe('GEO');
    // A Molniya-like orbit: very eccentric, 2 revolutions a day.
    expect(classifyRegime(0.72, 39_800, 2.006)).toBe('HEO');
  });

  it('applies the thresholds on the documented side of each line', () => {
    expect(classifyRegime(0.25, 500, 14)).toBe('HEO');
    expect(classifyRegime(0.2499, 1999.9, 12)).toBe('LEO');
    expect(classifyRegime(0, 2000, 11.5)).toBe('MEO');
    expect(classifyRegime(0, 35_786, 0.99)).toBe('GEO');
    expect(classifyRegime(0, 35_786, 1.01)).toBe('GEO');
    expect(classifyRegime(0, 36_500, 0.98)).toBe('MEO');
  });
});

describe('solveKepler', () => {
  it('satisfies M = E - e sin E for a spread of anomalies and eccentricities', () => {
    let worst = 0;
    for (const e of [0, 0.001, 0.1, 0.5, 0.74, 0.9, 0.97, 0.999]) {
      for (let m = -7; m <= 7; m += 0.173) {
        const big = solveKepler(m, e);
        worst = Math.max(worst, Math.abs(big - e * Math.sin(big) - m));
      }
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it('returns the mean anomaly itself for a circle', () => {
    expect(solveKepler(1.234, 0)).toBeCloseTo(1.234, 14);
  });
});

describe('orbitSampleOffsetsMinutes', () => {
  const meanMotion = (2 * Math.PI) / 92.9; // radians per minute, for a 92.9 minute orbit

  it('spans exactly one revolution, in increasing order, with "now" in the middle', () => {
    for (const e of [0, 0.01, 0.3, 0.72, 0.97]) {
      for (const meanAnomaly of [0, 1, 3, 5.5, -2, 40]) {
        const offsets = orbitSampleOffsetsMinutes(e, meanAnomaly, meanMotion, 256);
        expect(offsets).toHaveLength(257);
        expect((offsets[256] ?? 0) - (offsets[0] ?? 0)).toBeCloseTo(92.9, 9);
        expect(offsets[128]).toBeCloseTo(0, 9);
        for (let k = 1; k < offsets.length; k += 1) {
          expect(offsets[k] ?? 0).toBeGreaterThan(offsets[k - 1] ?? 0);
        }
      }
    }
  });

  it('gives equal time steps for a circular orbit', () => {
    const offsets = orbitSampleOffsetsMinutes(0, 2, meanMotion, 100);
    for (let k = 1; k < offsets.length; k += 1) {
      expect((offsets[k] ?? 0) - (offsets[k - 1] ?? 0)).toBeCloseTo(0.929, 9);
    }
  });

  it('puts samples closest together in time around the lowest point of an eccentric orbit', () => {
    // Start at the highest point (mean anomaly pi), so that the middle of
    // the revolution is the highest point and its two ends are the lowest.
    const offsets = orbitSampleOffsetsMinutes(0.7, Math.PI, meanMotion, 200);
    const stepAtLowest = (offsets[1] ?? 0) - (offsets[0] ?? 0);
    const stepAtHighest = (offsets[101] ?? 0) - (offsets[100] ?? 0);
    // Time per unit of eccentric anomaly is proportional to 1 - e cos E:
    // 0.3 at the lowest point and 1.7 at the highest.
    expect(stepAtHighest / stepAtLowest).toBeGreaterThan(5);
    expect(stepAtHighest / stepAtLowest).toBeLessThan(1.7 / 0.3 + 0.01);
  });

  it('rejects impossible inputs', () => {
    expect(() => orbitSampleOffsetsMinutes(1, 0, meanMotion, 10)).toThrow(RangeError);
    expect(() => orbitSampleOffsetsMinutes(0.1, 0, 0, 10)).toThrow(RangeError);
    expect(() => orbitSampleOffsetsMinutes(0.1, 0, meanMotion, 1)).toThrow(RangeError);
  });
});
