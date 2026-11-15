import { describe, expect, it } from 'vitest';
import {
  describePlace,
  normalisePlaceText,
  parseCoordinates,
  parsePlaces,
  searchPlaces,
} from './places';

const SAMPLE = [
  '# 7 places. Source: GeoNames, CC BY 4.0.',
  'Europe/London,America/New_York,America/Toronto,America/Sao_Paulo,America/Los_Angeles,Europe/Paris',
  'São Paulo\tBR\t\t-2355\t-4664\t3',
  'New York City\tUS\tNY\t4071\t-7401\t1',
  'London\tGB\t\t5151\t-13\t0',
  'Paris\tFR\t\t4885\t235\t5',
  'Portland\tUS\tOR\t4552\t-12268\t4',
  'London\tCA\t\t4298\t-8123\t2',
  'Portland\tUS\tME\t4366\t-7026\t1',
  'York\tGB\t\t5396\t-108\t0',
  'broken line',
  'Nowhere\tXX\t\t9999\t0\t0',
  'No Zone\tXX\t\t0\t0\t99',
  '',
].join('\n');

const NAMES: Record<string, string> = {
  BR: 'Brazil',
  US: 'United States',
  GB: 'United Kingdom',
  FR: 'France',
  CA: 'Canada',
};
const countryName = (code: string): string => NAMES[code] ?? code;

describe('normalisePlaceText', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalisePlaceText('São Paulo')).toBe('sao paulo');
    expect(normalisePlaceText('  SAO-PAULO ')).toBe('sao paulo');
    expect(normalisePlaceText("L'Aquila")).toBe('l aquila');
  });

  it('keeps letters of other scripts', () => {
    expect(normalisePlaceText('Москва')).toBe('москва');
  });
});

describe('parsePlaces', () => {
  const index = parsePlaces(SAMPLE);

  it('reads every well-formed line and skips the rest', () => {
    expect(index.places.map((place) => place.name)).toEqual([
      'São Paulo',
      'New York City',
      'London',
      'Paris',
      'Portland',
      'London',
      'Portland',
      'York',
    ]);
    expect(index.attribution).toBe('7 places. Source: GeoNames, CC BY 4.0.');
  });

  it('turns the stored hundredths into degrees and the zone number into a name', () => {
    expect(index.places[2]).toEqual({
      name: 'London',
      countryCode: 'GB',
      state: '',
      latitudeDeg: 51.51,
      longitudeDeg: -0.13,
      timeZone: 'Europe/London',
    });
  });
});

describe('searchPlaces', () => {
  const index = parsePlaces(SAMPLE);
  const find = (query: string, limit = 5): string[] =>
    searchPlaces(index, query, countryName, limit).map((place) =>
      describePlace(place, countryName),
    );

  it('puts the larger of two places with the same name first', () => {
    expect(find('london')).toEqual(['London, United Kingdom', 'London, Canada']);
  });

  it('finds a name typed without its accents', () => {
    expect(find('sao pau')).toEqual(['São Paulo, Brazil']);
  });

  it('prefers an exact name, then names that start with the text, then later words', () => {
    expect(find('york')).toEqual(['York, United Kingdom', 'New York City, NY, United States']);
    expect(find('new y')).toEqual(['New York City, NY, United States']);
  });

  it('does not match in the middle of a word', () => {
    expect(find('ondon')).toEqual([]);
  });

  it('narrows by country code, country name or US state after a comma', () => {
    expect(find('london, ca')).toEqual(['London, Canada']);
    expect(find('london, united k')).toEqual(['London, United Kingdom']);
    expect(find('portland, me')).toEqual(['Portland, ME, United States']);
    expect(find('portland, or')).toEqual(['Portland, OR, United States']);
    expect(find('paris, texas')).toEqual([]);
  });

  it('returns no more than asked for, and nothing for an empty query', () => {
    expect(find('p', 2)).toHaveLength(2);
    expect(find('  ')).toEqual([]);
    expect(find(', ca')).toEqual([]);
  });
});

describe('parseCoordinates', () => {
  it('reads two signed numbers, latitude first', () => {
    expect(parseCoordinates('33.75, -84.39')).toEqual({ latitudeDeg: 33.75, longitudeDeg: -84.39 });
    expect(parseCoordinates(' -33.87  151.21 ')).toEqual({
      latitudeDeg: -33.87,
      longitudeDeg: 151.21,
    });
    expect(parseCoordinates('0,0')).toEqual({ latitudeDeg: 0, longitudeDeg: 0 });
  });

  it('reads hemisphere letters and degree signs', () => {
    expect(parseCoordinates('33.75 N 84.39 W')).toEqual({
      latitudeDeg: 33.75,
      longitudeDeg: -84.39,
    });
    expect(parseCoordinates('33.87°S, 151.21°E')).toEqual({
      latitudeDeg: -33.87,
      longitudeDeg: 151.21,
    });
  });

  it('rejects anything else', () => {
    expect(parseCoordinates('Atlanta')).toBeNull();
    expect(parseCoordinates('33.75')).toBeNull();
    expect(parseCoordinates('91, 0')).toBeNull();
    expect(parseCoordinates('0, 181')).toBeNull();
    expect(parseCoordinates('-33 S, 10 E')).toBeNull();
    expect(parseCoordinates('1, 2, 3')).toBeNull();
    expect(parseCoordinates('')).toBeNull();
  });
});

describe('describePlace', () => {
  it('does not repeat a name that is also the country', () => {
    expect(
      describePlace(
        {
          name: 'Singapore',
          countryCode: 'SG',
          state: '',
          latitudeDeg: 1.29,
          longitudeDeg: 103.85,
          timeZone: 'Asia/Singapore',
        },
        () => 'Singapore',
      ),
    ).toBe('Singapore');
  });
});
