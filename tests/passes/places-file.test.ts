import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePlaces, searchPlaces } from '../../src/passes/places';

describe('the published places file', () => {
  const text = readFileSync(
    fileURLToPath(new URL('../../public/places.txt', import.meta.url)),
    'utf8',
  );
  const index = parsePlaces(text);

  it('parses completely and names its source', () => {
    expect(index.places.length).toBe(text.trim().split('\n').length - 2);
    expect(index.places.length).toBeGreaterThan(20_000);
    expect(index.attribution).toContain('GeoNames');
    expect(index.attribution).toContain('CC BY 4.0');
  });

  it('has only time zones this JavaScript engine knows', () => {
    const zones = new Set(index.places.map((place) => place.timeZone));
    for (const zone of zones) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: zone })).not.toThrow();
    }
  });

  it('puts well-known cities where they are', () => {
    // Coordinates to compare with are those used for the pass validation (VALIDATION.md, V4.2).
    const expectNear = (query: string, latitudeDeg: number, longitudeDeg: number): void => {
      const [place] = searchPlaces(index, query, (code) => code, 1);
      expect(place, query).toBeDefined();
      expect(Math.abs((place?.latitudeDeg ?? 0) - latitudeDeg), query).toBeLessThan(0.1);
      expect(Math.abs((place?.longitudeDeg ?? 0) - longitudeDeg), query).toBeLessThan(0.1);
    };
    expectNear('Atlanta', 33.749, -84.388);
    expectNear('London', 51.5074, -0.1278);
    expectNear('Sydney', -33.8688, 151.2093);
    expectNear('Singapore', 1.3521, 103.8198);
  });
});
