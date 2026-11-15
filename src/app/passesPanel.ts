import { TIME_SPAN_MS } from './clock';
import { formatLatLon } from './format';
import { initSearchBox, type Suggestion } from './searchBox';
import {
  forgetLocation,
  loadLocation,
  roundCoordinate,
  saveLocation,
  type LocationStorage,
  type ObserverLocation,
} from '../passes/location';
import {
  describePass,
  endOfPass,
  formatDuration,
  formatPassTime,
  formatSkyPosition,
  groupByDay,
  sortPasses,
  startOfPass,
  timeZoneAbbreviation,
  type ListedPass,
} from '../passes/passList';
import {
  describePlace,
  parseCoordinates,
  parsePlaces,
  searchPlaces,
  type PlaceIndex,
} from '../passes/places';
import type { Pass } from '../passes/predict';
import type { PassTarget, PassTargets } from '../passes/targets';

/**
 * The "Passes over you" panel: where the viewer is, and the list of
 * satellites that will pass over that place.
 */

/** How far ahead passes are listed, in days. */
export const PASS_HORIZON_DAYS = 5;
const HORIZON_MS = PASS_HORIZON_DAYS * 86_400_000;
/** Rows shown at first, and added by each press of "Show more". */
const ROWS_PER_PAGE = 20;
/** The most places suggested for what has been typed. */
const MAX_PLACE_SUGGESTIONS = 6;
/** Satellites worked out per request to the background thread: few enough that it stays responsive. */
const BATCH_SIZE = 8;
/** The list is worked out afresh once it is this old, in milliseconds. */
const RECOMPUTE_AFTER_MS = 30 * 60_000;
/** How often to drop passes that have ended, in milliseconds. */
const TIDY_EVERY_MS = 30_000;
/** A pass can be shown in the 3D view only if it starts this long before the end of the time slider's range. */
const SHOW_MARGIN_MS = 15 * 60_000;

export interface PassesPanelOptions {
  /** The element the panel is built in. */
  readonly container: HTMLElement;
  /** The satellites to predict for. */
  readonly targets: PassTargets;
  /**
   * Works out the passes of some satellites (by position in the catalog)
   * over a place (radians) between two instants: one list per satellite.
   */
  readonly requestPasses: (
    indices: readonly number[],
    latitudeRad: number,
    longitudeRad: number,
    fromMs: number,
    toMs: number,
  ) => Promise<readonly (readonly Pass[])[]>;
  /** Where the location is kept between visits; null if the browser offers nowhere. */
  readonly storage: LocationStorage | null;
  /** The device's own position service; null if the browser has none. */
  readonly geolocation: Pick<Geolocation, 'getCurrentPosition'> | null;
  /** Downloads the list of places as text. Called at most once, when the viewer starts typing one. */
  readonly loadPlaces: () => Promise<string>;
  /** The real time, in milliseconds since 1970-01-01 UTC. */
  readonly wallNow: () => number;
  /** Called when the place changes, including to none (null). */
  readonly onLocationChange: (location: ObserverLocation | null) => void;
  /** Called when the viewer asks to see a pass in the 3D view. */
  readonly onShowPass: (target: PassTarget, pass: Pass, location: ObserverLocation) => void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = '',
): HTMLElementTagNameMap[K] {
  const created = document.createElement(tag);
  if (className !== '') {
    created.className = className;
  }
  if (text !== '') {
    created.textContent = text;
  }
  return created;
}

/** The name of a country from its two-letter code, or the code itself if the browser cannot say. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function createPassesPanel(options: PassesPanelOptions): void {
  const { container, targets, wallNow } = options;

  let location = loadLocation(options.storage);
  let includeUnseen = false;
  // Off to begin with: the stations alone make a short list that is ready
  // at once, and the viewer can ask for the longer one.
  let includeBright = false;
  let rowsShown = ROWS_PER_PAGE;
  // Passes found so far for the current place, by position of the satellite in the catalog.
  const found = new Map<number, readonly Pass[]>();
  // Identifies the current calculation, so that an answer for a place the viewer has left is dropped.
  let generation = 0;
  let computedAtMs = 0;
  let progress: { done: number; total: number } | null = null;
  let places: PlaceIndex | null = null;
  let placesRequested = false;
  let message = '';

  // --- The parts that never change --------------------------------------------
  const intro = element(
    'p',
    'muted',
    'See when the space stations and other bright satellites will pass over you. Where you are stays in this browser: it is not sent anywhere.',
  );

  const placeForm = element('div', 'place-form');
  const locate = element('button', 'text-button', 'Use my location');
  locate.type = 'button';
  const field = element('div', 'place-field');
  const fieldLabel = element('label', 'visually-hidden', 'City, or latitude and longitude');
  fieldLabel.htmlFor = 'place-input';
  const input = element('input', '');
  input.id = 'place-input';
  input.type = 'search';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', 'place-results');
  input.setAttribute('aria-autocomplete', 'list');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.enterKeyHint = 'search';
  input.placeholder = 'City, or latitude, longitude';
  const results = element('ul', 'search-results place-results');
  results.id = 'place-results';
  results.setAttribute('role', 'listbox');
  results.hidden = true;
  const placeStatus = element('p', 'visually-hidden');
  placeStatus.setAttribute('role', 'status');
  field.append(fieldLabel, input, results, placeStatus);
  placeForm.append(locate, field);

  const notice = element('p', 'muted small passes-notice');
  notice.setAttribute('role', 'status');

  const where = element('div', 'passes-where');
  const controls = element('div', 'passes-controls');
  const summary = element('p', 'muted small passes-summary');
  summary.setAttribute('role', 'status');
  const list = element('div', 'pass-days');
  const more = element('button', 'text-button', 'Show more');
  more.type = 'button';

  const about = element('details', 'details');
  about.append(
    element('summary', '', 'How these are worked out'),
    element(
      'p',
      'muted',
      'Each satellite’s path is computed in your browser from its published orbital elements with the standard SGP4 model. A pass is counted while the satellite is at least 10° above your horizon: lower than that, buildings, trees and haze usually hide it.',
    ),
    element(
      'p',
      'muted',
      '“Visible” means the satellite is in sunlight while your sky is dark (the Sun at least 6° below your horizon), which happens after dusk and before dawn. Simplifications: the Earth’s shadow is treated as a plain cylinder, and nothing here knows about clouds, city lights, or how bright a satellite will look.',
    ),
    element(
      'p',
      'muted',
      'Times were checked against Heavens-Above for the International Space Station at four places and agreed within a few seconds. Passes several days ahead can shift, because orbits change and the published elements are updated. The other satellites are from CelesTrak’s list of the brightest objects. City names and positions: GeoNames (CC BY 4.0).',
    ),
  );

  container.replaceChildren(intro, where, placeForm, notice, controls, summary, list, more, about);

  // --- Choosing a place -------------------------------------------------------
  /** What the suggestions currently on screen stand for. */
  let suggested: ObserverLocation[] = [];
  const suggest = (query: string): Suggestion[] => {
    const coordinates = parseCoordinates(query);
    if (coordinates !== null) {
      const latitudeDeg = roundCoordinate(coordinates.latitudeDeg);
      const longitudeDeg = roundCoordinate(coordinates.longitudeDeg);
      const label = formatLatLon(latitudeDeg, longitudeDeg);
      suggested = [{ label, latitudeDeg, longitudeDeg, timeZone: null, source: 'coordinates' }];
      return [{ title: label, detail: 'Use these coordinates' }];
    }
    if (places === null) {
      suggested = [];
      return [];
    }
    const matches = searchPlaces(places, query, countryName, MAX_PLACE_SUGGESTIONS);
    suggested = matches.map((place) => ({
      label: describePlace(place, countryName),
      latitudeDeg: place.latitudeDeg,
      longitudeDeg: place.longitudeDeg,
      timeZone: place.timeZone,
      source: 'place',
    }));
    return matches.map((place) => ({
      title: place.name,
      detail: [place.state, countryName(place.countryCode)]
        .filter((part) => part !== '')
        .join(', '),
    }));
  };
  const placeBox = initSearchBox({
    input,
    list: results,
    status: placeStatus,
    suggest,
    onChoose: (position) => {
      const chosen = suggested[position];
      if (chosen !== undefined) {
        input.value = '';
        setLocation(chosen);
      }
    },
    noMatchText: 'No matching place. Try a larger city nearby, or type a latitude and longitude.',
  });
  const requestPlaces = (): void => {
    if (placesRequested) {
      return;
    }
    placesRequested = true;
    options
      .loadPlaces()
      .then((text) => {
        places = parsePlaces(text);
        placeBox.refresh();
      })
      .catch((error: unknown) => {
        console.warn('Orbit Now could not load its list of places:', error);
        // Allow another attempt, and say what still works.
        placesRequested = false;
        message =
          'The list of cities could not be loaded. You can still type a latitude and longitude, such as 33.75, -84.39.';
        render();
      });
  };
  input.addEventListener('focus', requestPlaces);
  input.addEventListener('input', requestPlaces);

  locate.addEventListener('click', () => {
    if (options.geolocation === null) {
      message = 'This browser cannot give a location. Type a city or coordinates instead.';
      render();
      return;
    }
    message = 'Asking your device where it is…';
    render();
    options.geolocation.getCurrentPosition(
      (position) => {
        const latitudeDeg = roundCoordinate(position.coords.latitude);
        const longitudeDeg = roundCoordinate(position.coords.longitude);
        message = '';
        setLocation({
          label: 'Your location',
          latitudeDeg,
          longitudeDeg,
          timeZone: null,
          source: 'device',
        });
      },
      (error) => {
        message =
          error.code === error.PERMISSION_DENIED
            ? 'Your browser did not allow this page to use your location. Type a city or coordinates instead.'
            : 'Your device could not work out where it is. Type a city or coordinates instead.';
        render();
      },
      // A rough, recent position is plenty: a kilometre moves a pass by under a second.
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 600_000 },
    );
  });

  // --- Working out the passes -------------------------------------------------
  const wantedTargets = (): readonly PassTarget[] =>
    includeBright ? [...targets.stations, ...targets.bright] : targets.stations;

  /** Work out passes for every wanted satellite not yet done, for the current place. */
  const compute = async (): Promise<void> => {
    const place = location;
    if (place === null) {
      return;
    }
    const mine = generation;
    const todo = wantedTargets().filter((target) => !found.has(target.index));
    if (todo.length === 0) {
      render();
      return;
    }
    if (found.size === 0) {
      computedAtMs = wallNow();
    }
    const fromMs = computedAtMs;
    const latitudeRad = (place.latitudeDeg * Math.PI) / 180;
    const longitudeRad = (place.longitudeDeg * Math.PI) / 180;
    const counting = { done: 0, total: todo.length };
    progress = counting;
    render();
    // The stations first and on their own, so that they can be shown at
    // once; then the rest a few at a time.
    const stations = todo.filter((target) => target.kind === 'station');
    const others = todo.filter((target) => target.kind !== 'station');
    const batches: PassTarget[][] = stations.length > 0 ? [stations] : [];
    for (let i = 0; i < others.length; i += BATCH_SIZE) {
      batches.push(others.slice(i, i + BATCH_SIZE));
    }
    for (const batch of batches) {
      const answers = await options.requestPasses(
        batch.map((target) => target.index),
        latitudeRad,
        longitudeRad,
        fromMs,
        fromMs + HORIZON_MS,
      );
      if (mine !== generation) {
        // The viewer has moved on to another place; this answer is for the old one.
        return;
      }
      batch.forEach((target, position) => {
        found.set(target.index, answers[position] ?? []);
      });
      counting.done += batch.length;
      if (counting.done >= counting.total) {
        progress = null;
        render();
      } else if (batch === stations) {
        render();
      } else {
        renderSummary();
      }
    }
  };

  const restart = (): void => {
    generation += 1;
    found.clear();
    progress = null;
    rowsShown = ROWS_PER_PAGE;
    void compute();
  };

  function setLocation(next: ObserverLocation | null): void {
    location = next;
    message = '';
    if (next === null) {
      forgetLocation(options.storage);
      generation += 1;
      found.clear();
      progress = null;
    } else {
      saveLocation(options.storage, next);
    }
    options.onLocationChange(next);
    if (next === null) {
      render();
    } else {
      restart();
    }
  }

  // --- Drawing ----------------------------------------------------------------
  /** The passes to list now: wanted satellites, not yet over, seen or not as chosen, in order. */
  const listed = (): ListedPass[] => {
    const now = wallNow();
    const all: ListedPass[] = [];
    for (const target of wantedTargets()) {
      for (const pass of found.get(target.index) ?? []) {
        if (endOfPass(pass) > now && (includeUnseen || pass.visible !== null)) {
          all.push({ target, pass });
        }
      }
    }
    return sortPasses(all);
  };

  const checkbox = (label: string, checked: boolean, onChange: (checked: boolean) => void) => {
    const wrapper = element('label', 'passes-option');
    const box = element('input', '');
    box.type = 'checkbox';
    box.checked = checked;
    box.addEventListener('change', () => {
      onChange(box.checked);
    });
    wrapper.append(box, document.createTextNode(` ${label}`));
    return wrapper;
  };

  const renderRow = (entry: ListedPass, place: ObserverLocation): HTMLElement => {
    const zone = place.timeZone ?? undefined;
    const description = describePass(entry.pass);
    const row = element('li', 'pass');
    row.dataset.norad = String(entry.target.noradId);
    row.dataset.visible = String(description.visible);
    row.dataset.kind = entry.target.kind;

    const head = element('div', 'pass-head');
    head.append(
      element('span', 'pass-name', entry.target.name),
      element(
        'span',
        'pass-status',
        `${description.status} · ${formatDuration(description.durationMs)}`,
      ),
    );
    const moments = element('dl', 'pass-moments');
    for (const moment of description.moments) {
      const cell = element('div', '');
      cell.append(
        element('dt', '', moment.label),
        element('dd', 'pass-time', formatPassTime(moment.event.timeMs, zone)),
        element('dd', '', formatSkyPosition(moment.event)),
      );
      moments.append(cell);
    }
    row.append(head, moments);
    if (description.note !== '') {
      row.append(element('p', 'muted small pass-note', description.note));
    }
    // The 3D view can only be moved three days from the present.
    if (startOfPass(entry.pass) < wallNow() + TIME_SPAN_MS - SHOW_MARGIN_MS) {
      const show = element('button', 'text-button pass-show', 'Show in 3D');
      show.type = 'button';
      show.setAttribute('aria-label', `Show this pass of ${entry.target.name} in the 3D view`);
      show.addEventListener('click', () => {
        options.onShowPass(entry.target, entry.pass, place);
      });
      row.append(show);
    }
    return row;
  };

  function renderSummary(): void {
    if (location === null) {
      summary.textContent = '';
      return;
    }
    const zone = location.timeZone ?? undefined;
    const abbreviation = timeZoneAbbreviation(wallNow(), zone);
    const zoneText =
      location.timeZone === null
        ? `Times are in your device’s time zone (${abbreviation}).`
        : `Times are local to the place (${abbreviation}).`;
    const working =
      progress === null
        ? ''
        : progress.total <= targets.stations.length
          ? ' Working out passes…'
          : ` Working out passes: ${String(progress.done)} of ${String(progress.total)} satellites…`;
    summary.textContent = `Next ${String(PASS_HORIZON_DAYS)} days. ${zoneText}${working}`;
  }

  function render(): void {
    notice.textContent = message;
    const place = location;
    intro.hidden = place !== null;
    placeForm.hidden = place !== null;
    where.hidden = place === null;
    controls.hidden = place === null;
    summary.hidden = place === null;
    list.hidden = place === null;
    about.hidden = place === null;
    container.dataset.located = String(place !== null);
    container.dataset.computing = String(progress !== null);
    if (place === null) {
      more.hidden = true;
      list.replaceChildren();
      return;
    }

    // Where, and a way to change it.
    const name = element('p', 'passes-place');
    name.append(element('strong', '', place.label));
    if (place.source !== 'coordinates') {
      name.append(
        document.createTextNode(` (${formatLatLon(place.latitudeDeg, place.longitudeDeg)})`),
      );
    }
    const change = element('button', 'text-button passes-change', 'Change place');
    change.type = 'button';
    change.addEventListener('click', () => {
      setLocation(null);
      input.focus();
    });
    where.replaceChildren(name, change);

    // Options.
    const optionRows = [
      checkbox('Include passes that cannot be seen', includeUnseen, (checked) => {
        includeUnseen = checked;
        rowsShown = ROWS_PER_PAGE;
        render();
      }),
    ];
    if (targets.bright.length > 0) {
      optionRows.push(
        checkbox(
          `Include ${String(targets.bright.length)} other bright satellites`,
          includeBright,
          (checked) => {
            includeBright = checked;
            rowsShown = ROWS_PER_PAGE;
            void compute();
            render();
          },
        ),
      );
    }
    controls.replaceChildren(...optionRows);

    renderSummary();

    // The list.
    const all = listed();
    container.dataset.passes = String(all.length);
    const shown = all.slice(0, rowsShown);
    const days = groupByDay(shown, place.timeZone ?? undefined, wallNow()).map((day) => {
      const section = element('section', 'pass-day');
      const items = element('ol', 'pass-list');
      items.append(...day.passes.map((entry) => renderRow(entry, place)));
      section.append(element('h3', 'pass-day-title', day.label), items);
      return section;
    });
    if (all.length === 0 && progress === null) {
      const who =
        targets.stations.length === 0 && !(includeBright && targets.bright.length > 0)
          ? null
          : includeBright
            ? 'the space stations or the other bright satellites'
            : 'the space stations';
      const empty = element(
        'p',
        'muted pass-empty',
        who === null
          ? 'The orbital data loaded does not include the space stations, so there is nothing to predict.'
          : includeUnseen
            ? `No passes of ${who} over this place in the next ${String(PASS_HORIZON_DAYS)} days. A place far enough north or south is never passed over.`
            : `No visible passes of ${who} in the next ${String(PASS_HORIZON_DAYS)} days. A station\u2019s visible passes come in runs, with gaps of days or weeks between. ${
                !includeBright && targets.bright.length > 0
                  ? 'Tick the box for other bright satellites to have more to look for, or the box for'
                  : 'Tick the box for'
              } passes that cannot be seen to list the daytime and shadowed ones.`,
      );
      list.replaceChildren(empty);
    } else {
      list.replaceChildren(...days);
    }
    more.hidden = all.length <= rowsShown;
    more.textContent = `Show more (${String(all.length - shown.length)} left)`;
  }

  more.addEventListener('click', () => {
    rowsShown += ROWS_PER_PAGE;
    render();
  });

  // Passes end as time goes by, and a list worked out long ago starts too early.
  window.setInterval(() => {
    if (location === null || progress !== null || document.hidden) {
      return;
    }
    if (wallNow() - computedAtMs > RECOMPUTE_AFTER_MS) {
      restart();
      return;
    }
    const first = listed()[0];
    const firstShown = list.querySelector('.pass');
    // Redraw only when the first row has changed, so that a list being read is left alone.
    if (
      firstShown instanceof HTMLElement &&
      (first === undefined || String(first.target.noradId) !== firstShown.dataset.norad)
    ) {
      render();
    }
  }, TIDY_EVERY_MS);

  options.onLocationChange(location);
  if (location === null) {
    render();
  } else {
    restart();
  }
}
