/**
 * Finding a place on the Earth from what the viewer types: the name of a
 * city, or a latitude and longitude.
 *
 * REAL DATA: the city list is from the GeoNames gazetteer (geonames.org,
 * licensed CC BY 4.0): every populated place of 15 000 people or more.
 * `scripts/build-places.mjs` describes the file and how it was made. It is
 * downloaded only when the viewer starts typing a place, and searched in
 * the browser: what is typed is never sent anywhere.
 *
 * SIMPLIFICATION: each place has one name, the one GeoNames lists first
 * (usually the English one). A city typed under another of its names is
 * not found; its coordinates can be typed instead.
 */

export interface Place {
  /** The place's name, e.g. "Atlanta". */
  readonly name: string;
  /** Two-letter country code (ISO 3166), e.g. "US". */
  readonly countryCode: string;
  /** For places in the United States, the state's postal abbreviation; otherwise empty. */
  readonly state: string;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  /** IANA time zone, e.g. "America/New_York". */
  readonly timeZone: string;
}

export interface PlaceIndex {
  /** Places in order of population, largest first. */
  readonly places: readonly Place[];
  /** Each place's name, normalised by `normalisePlaceText`. */
  readonly keys: readonly string[];
  /** The line of the file that names its source. */
  readonly attribution: string;
}

/**
 * Reduce text to what matters for matching: lower case, accents removed,
 * every run of punctuation or spaces turned into one space. "São Paulo",
 * "sao paulo" and "SAO-PAULO" all become "sao paulo".
 */
export function normalisePlaceText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Read the places file (see scripts/build-places.mjs for its format). */
export function parsePlaces(text: string): PlaceIndex {
  const lines = text.split('\n');
  const attribution = (lines[0] ?? '').replace(/^#\s*/, '');
  const timeZones = (lines[1] ?? '').split(',');
  const places: Place[] = [];
  const keys: string[] = [];
  for (let i = 2; i < lines.length; i += 1) {
    const cells = (lines[i] ?? '').split('\t');
    if (cells.length !== 6) {
      continue;
    }
    const [name = '', countryCode = '', state = '', latitude, longitude, zone] = cells;
    const latitudeDeg = Number(latitude) / 100;
    const longitudeDeg = Number(longitude) / 100;
    const timeZone = timeZones[Number(zone)];
    if (
      name === '' ||
      timeZone === undefined ||
      !Number.isFinite(latitudeDeg) ||
      !Number.isFinite(longitudeDeg) ||
      Math.abs(latitudeDeg) > 90 ||
      Math.abs(longitudeDeg) > 180
    ) {
      continue;
    }
    places.push({ name, countryCode, state, latitudeDeg, longitudeDeg, timeZone });
    keys.push(normalisePlaceText(name));
  }
  return { places, keys, attribution };
}

/**
 * The places that best match what was typed, best first.
 *
 * The text before the first comma is matched against place names: an exact
 * match first, then names that start with it, then names in which a later
 * word starts with it. Anything after a comma narrows the result to a
 * country or a US state: "london, ca", "portland, or", "paris, france".
 * Among equally good matches the more populous place comes first.
 *
 * @param countryName gives the name of a country from its code, for matching "france" to FR
 * @param limit       the most results to return
 */
export function searchPlaces(
  index: PlaceIndex,
  query: string,
  countryName: (code: string) => string,
  limit: number,
): Place[] {
  const [first = '', ...rest] = query.split(',');
  const wanted = normalisePlaceText(first);
  const qualifier = normalisePlaceText(rest.join(' '));
  if (wanted === '' || limit <= 0) {
    return [];
  }
  const qualifies = (place: Place): boolean => {
    if (qualifier === '') {
      return true;
    }
    return (
      place.countryCode.toLowerCase() === qualifier ||
      place.state.toLowerCase() === qualifier ||
      normalisePlaceText(countryName(place.countryCode)).startsWith(qualifier)
    );
  };
  // Three ranks, each filled in order of population because the file is.
  const ranks: Place[][] = [[], [], []];
  for (let i = 0; i < index.places.length; i += 1) {
    const key = index.keys[i] ?? '';
    const at = key.indexOf(wanted);
    if (at === -1) {
      continue;
    }
    let rank: number;
    if (at === 0) {
      rank = key.length === wanted.length ? 0 : 1;
    } else if (key.includes(` ${wanted}`)) {
      rank = 2;
    } else {
      continue;
    }
    const place = index.places[i];
    const bucket = ranks[rank];
    if (place !== undefined && bucket !== undefined && bucket.length < limit && qualifies(place)) {
      bucket.push(place);
    }
  }
  return ranks.flat().slice(0, limit);
}

/**
 * Read a latitude and longitude typed as two numbers, latitude first:
 * "33.75, -84.39", "33.75 -84.39", "33.75 N 84.39 W", "33.75°N, 84.39°W".
 * Without letters, north and east are positive.
 *
 * @returns null if the text is not two numbers in range
 */
export function parseCoordinates(
  text: string,
): { latitudeDeg: number; longitudeDeg: number } | null {
  const match =
    /^\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSns])?\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EWew])?\s*$/.exec(
      text,
    );
  if (match === null) {
    return null;
  }
  const [, latitudeText = '', northSouth, longitudeText = '', eastWest] = match;
  let latitudeDeg = Number(latitudeText);
  let longitudeDeg = Number(longitudeText);
  // A hemisphere letter and a minus sign together would be ambiguous.
  if (
    (northSouth !== undefined && latitudeDeg < 0) ||
    (eastWest !== undefined && longitudeDeg < 0)
  ) {
    return null;
  }
  if (northSouth?.toUpperCase() === 'S') {
    latitudeDeg = -latitudeDeg;
  }
  if (eastWest?.toUpperCase() === 'W') {
    longitudeDeg = -longitudeDeg;
  }
  if (Math.abs(latitudeDeg) > 90 || Math.abs(longitudeDeg) > 180) {
    return null;
  }
  return { latitudeDeg, longitudeDeg };
}

/** A place's name with what is needed to tell it from others of the same name: "Atlanta, GA, United States". */
export function describePlace(place: Place, countryName: (code: string) => string): string {
  const country = countryName(place.countryCode);
  return [place.name, place.state, country === place.name ? '' : country]
    .filter((part) => part !== '')
    .join(', ');
}
