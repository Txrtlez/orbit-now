import { describe, expect, it } from 'vitest';
import {
  forgetLocation,
  isTimeZone,
  loadLocation,
  LOCATION_STORAGE_KEY,
  roundCoordinate,
  saveLocation,
  type LocationStorage,
  type ObserverLocation,
} from './location';

function fakeStorage(initial: Record<string, string> = {}): LocationStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const ATLANTA: ObserverLocation = {
  label: 'Atlanta, GA, United States',
  latitudeDeg: 33.75,
  longitudeDeg: -84.39,
  timeZone: 'America/New_York',
  source: 'place',
};

describe('saving and loading a location', () => {
  it('gives back what was saved', () => {
    const storage = fakeStorage();
    saveLocation(storage, ATLANTA);
    expect(loadLocation(storage)).toEqual(ATLANTA);
  });

  it('gives null when nothing is stored, or after forgetting', () => {
    const storage = fakeStorage();
    expect(loadLocation(storage)).toBeNull();
    saveLocation(storage, ATLANTA);
    forgetLocation(storage);
    expect(loadLocation(storage)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('ignores stored text that is not a usable location', () => {
    const stored = (value: unknown): ObserverLocation | null =>
      loadLocation(fakeStorage({ [LOCATION_STORAGE_KEY]: JSON.stringify(value) }));
    expect(loadLocation(fakeStorage({ [LOCATION_STORAGE_KEY]: 'not json' }))).toBeNull();
    expect(stored(null)).toBeNull();
    expect(stored({ ...ATLANTA, latitudeDeg: 91 })).toBeNull();
    expect(stored({ ...ATLANTA, longitudeDeg: '10' })).toBeNull();
    expect(stored({ ...ATLANTA, label: '' })).toBeNull();
    expect(stored({ ...ATLANTA, timeZone: 'Mars/Olympus_Mons' })).toBeNull();
    expect(stored({ ...ATLANTA, source: 'guess' })).toBeNull();
    expect(stored({ ...ATLANTA, timeZone: null, source: 'device' })).not.toBeNull();
  });

  it('carries on when storage is missing or refuses', () => {
    const refusing: LocationStorage = {
      getItem: () => {
        throw new Error('refused');
      },
      setItem: () => {
        throw new Error('refused');
      },
      removeItem: () => {
        throw new Error('refused');
      },
    };
    expect(loadLocation(null)).toBeNull();
    expect(loadLocation(refusing)).toBeNull();
    expect(() => {
      saveLocation(refusing, ATLANTA);
      forgetLocation(refusing);
      saveLocation(null, ATLANTA);
      forgetLocation(null);
    }).not.toThrow();
  });
});

describe('helpers', () => {
  it('rounds coordinates to a hundredth of a degree', () => {
    expect(roundCoordinate(33.74899)).toBe(33.75);
    expect(roundCoordinate(-84.38798)).toBe(-84.39);
  });

  it('recognises real time zones only', () => {
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Nowhere/Special')).toBe(false);
  });
});
