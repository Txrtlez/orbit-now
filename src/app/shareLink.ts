import { REGIMES, type Regime } from '../orbit/elements';
import { NO_FILTERS, type FilterState } from './filters';

/**
 * Shareable links: the part of the address after "#" records what the
 * viewer is looking at, so that sending the address sends the view.
 *
 * It is the fragment and not the path or the query because the site is
 * served as plain files from a sub-folder (README, decision 2), and
 * because a fragment is never sent to the server: what someone is looking
 * at stays between the two browsers.
 *
 * The format is a list of `name=value` pairs joined by "&". Anything
 * missing means "as the site opens". Anything not understood is ignored,
 * so an old link never breaks the page.
 *
 *   o      catalog number of the selected object
 *   g      families shown, joined by "."
 *   r      orbit regimes shown, joined by "."
 *   k      kinds of object shown (PAY, R/B, DEB, UNK), joined by "."
 *   c      owner code
 *   y      launch years, "from-to", either side may be empty
 *   t      the time shown, in whole seconds since 1970 (absent: the present)
 *   m      "whatif" for that mode
 *   s      the event chosen in "What if?"
 *   sun    the Sun setting
 *   run    which run of the event is on show (absent: not run)
 *   ev, mass, other, angle   the choices made for the selected object
 */

/** What is set up in "What if?" mode. */
export interface SharedScenario {
  /** A preset's id, or "selected-object". */
  readonly preset: string;
  readonly sun: string;
  /** Which run is on show, counting from 1; 0 if the event has not been run. */
  readonly run: number;
  readonly event: string | null;
  readonly massKg: number | null;
  readonly otherMassKg: number | null;
  readonly crossingDegrees: number | null;
}

export interface SharedView {
  readonly mode: 'now' | 'whatif';
  /** Catalog number of the selected object, or null. */
  readonly object: number | null;
  readonly filters: FilterState;
  /** The time shown in milliseconds since 1970-01-01 UTC, or null for the present. */
  readonly timeMs: number | null;
  readonly scenario: SharedScenario | null;
}

export const DEFAULT_VIEW: SharedView = {
  mode: 'now',
  object: null,
  filters: NO_FILTERS,
  timeMs: null,
  scenario: null,
};

/** Identifiers are letters, digits, "/" and "-": nothing that needs escaping or could be markup. */
const SAFE_ID = /^[A-Za-z0-9/-]{1,40}$/;

function wholeNumber(text: string | null, min: number, max: number): number | null {
  if (text === null || !/^\d{1,15}$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function decimal(text: string | null, min: number, max: number): number | null {
  if (text === null || !/^\d{1,9}(\.\d{1,6})?$/.test(text)) {
    return null;
  }
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

function idList(text: string | null): string[] {
  return text === null ? [] : text.split('.').filter((id) => SAFE_ID.test(id));
}

/** The fragment for a view, without the "#". Empty for the view the site opens with. */
export function encodeView(view: SharedView): string {
  const parts: string[] = [];
  const add = (name: string, value: string): void => {
    parts.push(`${name}=${value}`);
  };
  if (view.object !== null) {
    add('o', String(view.object));
  }
  const { filters } = view;
  if (filters.groups.size > 0) {
    add('g', [...filters.groups].sort().join('.'));
  }
  if (filters.regimes.size > 0) {
    add('r', [...filters.regimes].sort().join('.'));
  }
  if (filters.types.size > 0) {
    add('k', [...filters.types].sort().join('.'));
  }
  if (filters.owner !== null) {
    add('c', filters.owner);
  }
  if (filters.yearFrom !== null || filters.yearTo !== null) {
    add('y', `${String(filters.yearFrom ?? '')}-${String(filters.yearTo ?? '')}`);
  }
  if (view.timeMs !== null) {
    add('t', String(Math.round(view.timeMs / 1000)));
  }
  if (view.mode === 'whatif') {
    add('m', 'whatif');
    const { scenario } = view;
    if (scenario !== null) {
      add('s', scenario.preset);
      add('sun', scenario.sun);
      if (scenario.run > 0) {
        add('run', String(scenario.run));
      }
      if (scenario.event !== null) {
        add('ev', scenario.event);
      }
      if (scenario.massKg !== null) {
        add('mass', String(scenario.massKg));
      }
      if (scenario.otherMassKg !== null) {
        add('other', String(scenario.otherMassKg));
      }
      if (scenario.crossingDegrees !== null) {
        add('angle', String(scenario.crossingDegrees));
      }
    }
  }
  // Every value is made of characters that are safe in a fragment as they
  // stand, except the "/" of "R/B", which is allowed there too.
  return parts.join('&');
}

/** Read a fragment (with or without its "#"). Never throws; what it cannot read it leaves at the default. */
export function decodeView(fragment: string): SharedView {
  const pairs = new Map<string, string>();
  for (const part of fragment.replace(/^#/, '').split('&')) {
    const cut = part.indexOf('=');
    if (cut > 0) {
      let value: string;
      try {
        value = decodeURIComponent(part.slice(cut + 1));
      } catch {
        continue;
      }
      pairs.set(part.slice(0, cut), value);
    }
  }
  const get = (name: string): string | null => pairs.get(name) ?? null;

  const regimes = new Set<Regime>();
  for (const id of idList(get('r'))) {
    const regime = REGIMES.find((known) => known === id);
    if (regime !== undefined) {
      regimes.add(regime);
    }
  }
  const years = /^(\d{4})?-(\d{4})?$/.exec(get('y') ?? '');
  const owner = get('c');
  const filters: FilterState = {
    groups: new Set(idList(get('g'))),
    regimes,
    types: new Set(idList(get('k'))),
    owner: owner !== null && SAFE_ID.test(owner) ? owner : null,
    yearFrom: wholeNumber(years?.[1] ?? null, 1957, 2200),
    yearTo: wholeNumber(years?.[2] ?? null, 1957, 2200),
  };

  const seconds = wholeNumber(get('t'), 0, 32_503_680_000);
  const mode = get('m') === 'whatif' ? 'whatif' : 'now';
  const preset = get('s');
  const sun = get('sun');
  const event = get('ev');
  const scenario: SharedScenario | null =
    mode === 'whatif' && preset !== null && SAFE_ID.test(preset)
      ? {
          preset,
          sun: sun !== null && SAFE_ID.test(sun) ? sun : 'average',
          run: wholeNumber(get('run'), 1, 9999) ?? 0,
          event: event !== null && SAFE_ID.test(event) ? event : null,
          massKg: decimal(get('mass'), 0.01, 500_000),
          otherMassKg: decimal(get('other'), 0.01, 500_000),
          crossingDegrees: decimal(get('angle'), 1, 180),
        }
      : null;

  return {
    mode,
    object: wholeNumber(get('o'), 1, 999_999_999),
    filters,
    timeMs: seconds === null ? null : seconds * 1000,
    scenario,
  };
}

/** Whether a view is the one the site opens with, so that there is nothing to restore. */
export function isDefaultView(view: SharedView): boolean {
  return encodeView(view) === '';
}
