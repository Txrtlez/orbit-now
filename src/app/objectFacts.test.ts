import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/format';
import { buildObjectIndex } from '../catalog/objectIndex';
import { describeElementAge, describeObject } from './objectFacts';

const EPOCH_DAY = 20_772; // 2026-11-15

/** A two-object made-up catalog; the figures are placeholders chosen to be easy to recognise. */
const catalog: Catalog = {
  generatedAt: '2026-11-15T12:00:00.000Z',
  sources: [
    { id: 'active', label: 'Active satellites', provider: 'TEST', fetchedAt: null, objectCount: 2 },
  ],
  records: [
    {
      noradId: 25544,
      name: 'ISS (ZARYA)',
      objectId: '1998-067A',
      epochDay: EPOCH_DAY,
      epochMicros: 0,
      meanMotion: 15.49,
      eccentricity: 0.0007,
      inclination: 51.6323,
      raan: 0,
      argPericenter: 0,
      meanAnomaly: 0,
      bstar: 0,
      sourceMask: 1,
    },
    {
      noradId: 90001,
      name: '',
      objectId: '',
      epochDay: EPOCH_DAY,
      epochMicros: 0,
      meanMotion: 2.0057,
      eccentricity: 0.01,
      inclination: 55,
      raan: 0,
      argPericenter: 0,
      meanAnomaly: 0,
      bstar: 0,
      sourceMask: 1,
    },
  ],
};
const objects = buildObjectIndex(catalog, {
  periodMinutes: new Float32Array([92.94, 717.97]),
  apogeeKm: new Float32Array([421.2, 20_400]),
  perigeeKm: new Float32Array([412.8, 20_000]),
});
const now = Date.UTC(2026, 10, 15, 14);

const valueOf = (facts: readonly { label: string; value: string }[], label: string): string =>
  facts.find((fact) => fact.label === label)?.value ?? 'missing';

describe('describeObject', () => {
  it('describes a named object in a recognised category', () => {
    const facts = describeObject(objects, 0, now);
    expect(facts.title).toBe('ISS (ZARYA)');
    expect(facts.subtitle).toBe('Space station module · LEO');
    expect(valueOf(facts.orbitFacts, 'Period')).toBe('92.9 min');
    expect(valueOf(facts.orbitFacts, 'Inclination')).toBe('51.63°');
    expect(valueOf(facts.orbitFacts, 'Lowest · highest')).toBe('413 km · 421 km');
    expect(valueOf(facts.orbitFacts, 'Regime')).toBe('LEO');
    expect(valueOf(facts.identityFacts, 'Catalog number')).toBe('25544');
    expect(valueOf(facts.identityFacts, 'Designator')).toBe('1998-067A');
    expect(valueOf(facts.identityFacts, 'Launched')).toBe('1998');
    expect(valueOf(facts.identityFacts, 'Orbit data')).toBe('14 hours old');
    expect(facts.identityFacts.find((fact) => fact.label === 'Designator')?.note).toBe(
      'International designator: piece A of launch 67 of 1998.',
    );
  });

  it('makes no claims it has no data for', () => {
    const facts = describeObject(objects, 1, now);
    expect(facts.title).toBe('Object 90001');
    expect(facts.subtitle).toBe('MEO · Medium Earth orbit');
    expect(facts.identityFacts.map((fact) => fact.label)).toEqual(['Catalog number', 'Orbit data']);
    expect(valueOf(facts.orbitFacts, 'Period')).toBe('11 h 58 min');
  });

  it('refuses an index that is not in the catalog', () => {
    expect(() => describeObject(objects, 2, now)).toThrow(RangeError);
  });
});

describe('describeElementAge', () => {
  it('describes past and future epochs', () => {
    expect(describeElementAge(30 * 60_000)).toBe('less than an hour old');
    expect(describeElementAge(3 * 86_400_000)).toBe('3 days old');
    expect(describeElementAge(-25 * 3_600_000)).toBe('Dated 25 hours ahead');
  });
});
