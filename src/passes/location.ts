/**
 * The place the viewer is watching from.
 *
 * It is used only inside the browser, to work out which satellites pass
 * overhead. It is kept in the browser's own storage so that it does not
 * have to be given again on the next visit, and is never sent anywhere:
 * this project has no server that could receive it.
 */

export interface ObserverLocation {
  /** What to call the place: "Atlanta, GA, United States", or "Your location". */
  readonly label: string;
  /** Geodetic latitude in degrees, north positive. */
  readonly latitudeDeg: number;
  /** Longitude in degrees, east positive. */
  readonly longitudeDeg: number;
  /**
   * The place's IANA time zone if known (it is for a city from the list),
   * or null to use the time zone the viewer's device is set to.
   */
  readonly timeZone: string | null;
  /** How the place was given: by the device, by choosing a city, or by typing coordinates. */
  readonly source: 'device' | 'place' | 'coordinates';
}

/** The key the location is stored under. The number changes if the stored form ever does. */
export const LOCATION_STORAGE_KEY = 'orbit-now.location.v1';

/**
 * Round a coordinate to a hundredth of a degree, about a kilometre. Nothing
 * here needs a location more exactly than that (it moves a predicted pass
 * by well under a second), so nothing more exact is kept.
 */
export function roundCoordinate(degrees: number): number {
  return Math.round(degrees * 100) / 100;
}

function isLocation(value: unknown): value is ObserverLocation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const { label, latitudeDeg, longitudeDeg, timeZone, source } = candidate;
  return (
    typeof label === 'string' &&
    label !== '' &&
    typeof latitudeDeg === 'number' &&
    Number.isFinite(latitudeDeg) &&
    Math.abs(latitudeDeg) <= 90 &&
    typeof longitudeDeg === 'number' &&
    Number.isFinite(longitudeDeg) &&
    Math.abs(longitudeDeg) <= 180 &&
    (timeZone === null || (typeof timeZone === 'string' && isTimeZone(timeZone))) &&
    (source === 'device' || source === 'place' || source === 'coordinates')
  );
}

/** Whether this browser recognises a time zone name. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The parts of the browser's storage used here. */
export type LocationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The location kept from an earlier visit, or null if there is none or it
 * cannot be read. Storage can be unavailable (some private-browsing modes
 * refuse it), which is treated the same as having nothing stored.
 */
export function loadLocation(storage: LocationStorage | null): ObserverLocation | null {
  try {
    const text = storage?.getItem(LOCATION_STORAGE_KEY) ?? null;
    if (text === null) {
      return null;
    }
    const value: unknown = JSON.parse(text);
    return isLocation(value) ? value : null;
  } catch {
    return null;
  }
}

/** Keep a location for the next visit. Does nothing if storage is unavailable. */
export function saveLocation(storage: LocationStorage | null, location: ObserverLocation): void {
  try {
    storage?.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
  } catch {
    // The location still works for this visit; it just will not be remembered.
  }
}

/** Remove the kept location. */
export function forgetLocation(storage: LocationStorage | null): void {
  try {
    storage?.removeItem(LOCATION_STORAGE_KEY);
  } catch {
    // Nothing was stored, or storage is unavailable: either way nothing is kept.
  }
}
