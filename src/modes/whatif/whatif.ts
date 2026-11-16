import type { SharedScenario } from '../../app/shareLink';
import type { Globe } from '../../render/globe';
import { SOLAR_SETTINGS } from '../../sim/atmosphere';
import { CATASTROPHIC_THRESHOLD_J_PER_G, type ParentKind } from '../../sim/breakupModel';
import { describeSpan, fractionOfMoment, momentAt } from '../../sim/cloud';
import { customScenario, fromScene, PRESETS, presetById, type Scenario } from '../../sim/scenario';
import type { RunMessage, SimReply } from '../../sim/sim.worker';
import {
  BAND_KM,
  collisionOf,
  LOWEST_BAND_KM,
  QUOTED_YEARS,
  spread,
  TYPICAL_OBJECT_MASS_KG,
  type EventKind,
  type SimFragment,
  type SimulationResult,
  type TrialSummary,
} from '../../sim/simulate';
import { createCloudLayer, CLOUD_COLOURS, type CloudLayer } from './cloudLayer';
import { mountSurvivalChart, percentWithRange } from './survivalChart';

/**
 * Mode B, "What if?": stage a break-up and see what the model makes of it.
 *
 * This module, the simulation it starts on a background thread and the
 * chart are loaded with a dynamic `import()` the first time the tab is
 * opened. Nothing here is part of the first page load.
 *
 * Everything this mode shows is an ILLUSTRATIVE MODEL, NOT A PREDICTION,
 * and the page says so wherever a number appears.
 */

/** The object selected in the tracker, where it is now. */
export interface SelectedObject {
  readonly name: string;
  readonly kind: ParentKind;
  /** Position in the tracker's drawing units and velocity in those units per second. */
  readonly position: readonly [number, number, number];
  readonly velocity: readonly [number, number, number];
}

export interface WhatIfContext {
  /** Null if the globe could not be started. The numbers are still worked out. */
  readonly globe: Globe | null;
  /** The tracker's Earth radius in kilometres. */
  readonly kmPerSceneUnit: number;
  readonly reducedMotion: () => boolean;
  /** The element shown and hidden with the tab. */
  readonly tabPanel: HTMLElement;
  /** The object selected in the tracker, or null. */
  readonly selected: () => SelectedObject | null;
  /**
   * The lowest and highest heights of every satellite and rocket stage in
   * the tracker's data, or null if the data has not arrived.
   */
  /** Called when the event set up, or the run on show, changes. */
  readonly onChange?: () => void;
  /** Draw the tracked objects faintly (true) or as usual (false). */
  readonly dimTracker: (dim: boolean) => void;
  readonly background: () => {
    readonly perigeeKm: ArrayLike<number>;
    readonly apogeeKm: ArrayLike<number>;
  } | null;
}

/** How many times each run is repeated with different random fragments. */
const TRIALS = 12;
/** Fragments smaller than this are not simulated, in metres: about what radar tracks. */
const SMALLEST_M = 0.1;
/** How long the Play button takes to run from a minute to a century. */
const PLAY_MS = 24_000;
/** Where the time control starts: six hours after the break-up. */
const FIRST_VIEW_YEARS = 0.25 / 365.25;
const SLIDER_STEPS = 1000;
const CUSTOM = 'selected-object';

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') {
    node.className = className;
  }
  if (text !== '') {
    node.textContent = text;
  }
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const wrap = make('label', 'whatif-field');
  wrap.append(make('span', 'whatif-label', label), control);
  return wrap;
}

function numberInput(value: number, min: number, max: number): HTMLInputElement {
  const input = make('input', 'owner-select');
  input.type = 'number';
  input.inputMode = 'decimal';
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  return input;
}

function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  const min = Number(input.min);
  const max = Number(input.max);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

const whole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

/** A small expected number, to two figures: "0.32", "1.4", "under 0.01". */
export function expectedNumber(value: number): string {
  if (value === 0) {
    return '0';
  }
  if (value < 0.01) {
    return 'under 0.01';
  }
  return value < 10 ? String(Number(value.toPrecision(2))) : whole.format(value);
}

/** The chance of at least one event when `expected` are expected on average. */
export function chanceOfAny(expected: number): string {
  const chance = 1 - Math.exp(-expected);
  if (chance > 0 && chance < 0.01) {
    return 'under 1%';
  }
  if (chance > 0.99) {
    return 'over 99%';
  }
  return `${String(Math.round(chance * 100))}%`;
}

function countWithRange(values: readonly number[]): string {
  const { low, median, high } = spread(values);
  return low === high
    ? whole.format(median)
    : `${whole.format(median)} (${whole.format(low)} to ${whole.format(high)})`;
}

/** What the rest of the page can do with this mode once it is loaded. */
export interface WhatIfControl {
  /** Set the form as a link or the tour describes it, and run it if the description names a run. */
  apply(scenario: SharedScenario): void;
  /** The event and run on show, or, if nothing has been run, what the form holds. */
  current(): SharedScenario;
  /** Start the time control playing, if there is a cloud. */
  play(): void;
  /** Take away the cloud and the results. */
  clear(): void;
}

export function mountWhatIf(panel: HTMLElement, context: WhatIfContext): WhatIfControl {
  const root = document.documentElement;
  const layer: CloudLayer | null =
    context.globe === null ? null : createCloudLayer(context.kmPerSceneUnit);
  if (layer !== null) {
    context.globe?.addLayer(layer);
  }

  // The form.
  const heading = make('h2', '', 'What if?');
  const tagLine = make('p', 'tag-line');
  tagLine.append(make('span', 'tag', 'Illustrative model, not a prediction'));
  const intro = make(
    'p',
    'small',
    'Stage a break-up and see what a standard model says happens to the pieces over a hundred years.',
  );

  const presetSelect = make('select', 'owner-select');
  presetSelect.id = 'whatif-preset';
  for (const preset of PRESETS) {
    const option = make('option', '', preset.title);
    option.value = preset.id;
    presetSelect.append(option);
  }
  const customOption = make('option', '', 'The object selected in the tracker');
  customOption.value = CUSTOM;
  presetSelect.append(customOption);
  const presetNote = make('p', 'small muted');
  presetNote.id = 'whatif-preset-note';

  const custom = make('div', 'whatif-custom');
  custom.hidden = true;
  const eventSelect = make('select', 'owner-select');
  eventSelect.id = 'whatif-event';
  const eventChoices: readonly (readonly [EventKind, string])[] = [
    ['antiSatellite', 'It is destroyed by an interceptor'],
    ['collision', 'Something runs into it'],
    ['explosion', 'It explodes'],
  ];
  for (const [value, label] of eventChoices) {
    const option = make('option', '', label);
    option.value = value;
    eventSelect.append(option);
  }
  const massInput = numberInput(1000, 1, 500_000);
  massInput.id = 'whatif-mass';
  const otherMassInput = numberInput(100, 0.01, 500_000);
  otherMassInput.id = 'whatif-other-mass';
  const angleInput = numberInput(90, 1, 180);
  angleInput.id = 'whatif-angle';
  const collisionFields = make('div', 'whatif-pair');
  collisionFields.append(
    field('Mass of the other object, kg', otherMassInput),
    field('Angle between the two paths, degrees', angleInput),
  );
  custom.append(
    field('What happens to it', eventSelect),
    field('Its mass, kg (this site’s data has no masses)', massInput),
    collisionFields,
  );

  const sunSelect = make('select', 'owner-select');
  sunSelect.id = 'whatif-sun';
  for (const setting of SOLAR_SETTINGS) {
    const option = make('option', '', setting.label);
    option.value = setting.id;
    option.selected = setting.id === 'average';
    sunSelect.append(option);
  }

  const actions = make('div', 'card-actions');
  const runButton = make('button', 'text-button', 'Run');
  runButton.type = 'button';
  runButton.id = 'whatif-run';
  const clearButton = make('button', 'text-button', 'Clear');
  clearButton.type = 'button';
  clearButton.id = 'whatif-clear';
  clearButton.hidden = true;
  actions.append(runButton, clearButton);
  const status = make('p', 'small');
  status.id = 'whatif-status';
  status.setAttribute('role', 'status');

  // The results.
  const results = make('div', 'whatif-results');
  results.id = 'whatif-results';
  results.hidden = true;
  const resultsTitle = make('h3', 'section-title', 'What the model gives');
  const legend = make('p', 'small whatif-legend');
  const timeControls = make('div', 'growth-controls');
  const playButton = make('button', 'text-button growth-play', 'Play');
  playButton.type = 'button';
  playButton.id = 'whatif-play';
  const slider = make('input', 'growth-slider');
  slider.type = 'range';
  slider.id = 'whatif-time';
  slider.min = '0';
  slider.max = String(SLIDER_STEPS);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Time after the break-up');
  timeControls.append(playButton, slider);
  const momentLine = make('p', 'whatif-moment-line');
  momentLine.id = 'whatif-moment';
  const facts = make('dl', 'facts');
  facts.id = 'whatif-facts';
  const tableWrap = make('div', 'growth-table-scroll');
  tableWrap.tabIndex = 0;
  tableWrap.setAttribute('role', 'region');
  tableWrap.setAttribute('aria-label', 'Table: what is left, and hits, after 1, 10 and 100 years');
  const chartWrap = make('div');
  const chart = mountSurvivalChart(chartWrap);
  const caveat = make('p', 'small muted');
  caveat.id = 'whatif-caveat';
  const really = make('p', 'small');
  really.id = 'whatif-really';
  results.append(
    resultsTitle,
    legend,
    timeControls,
    momentLine,
    facts,
    tableWrap,
    caveat,
    chartWrap,
    really,
  );

  const about = make('details', 'details');
  about.id = 'whatif-about';
  about.append(make('summary', '', 'What this is made of, and what it leaves out'));
  const aboutBody = make('div');
  const aboutItem = (label: string, text: string): void => {
    const line = make('p', 'small');
    line.append(make('span', 'tag', label), ` ${text}`);
    aboutBody.append(line);
  };
  aboutItem(
    'Standard model',
    'How many fragments there are, and their sizes, weights and speeds, come from the NASA Standard Breakup Model (Johnson and others, 2001). Only pieces 10 cm across and larger are made, about the size radar can follow.',
  );
  aboutItem(
    'Standard physics, simplified',
    'Each fragment’s orbit is turned by the Earth’s bulge and shrunk by air drag, using formulas averaged over an orbit. They were checked against step-by-step calculation.',
  );
  aboutItem(
    'Simplification',
    'The air is one fixed table of density against height. The real upper air swells and thins with the Sun’s eleven-year cycle, which changes how fast debris comes down by a large factor; the Sun setting only makes the whole table three times thinner or thicker.',
  );
  aboutItem(
    'Assumption',
    `Hits are counted against the satellites and rocket stages in this site’s data, placed as they are today and each treated as a ${whole.format(TYPICAL_OBJECT_MASS_KG)} kg object about 2.8 m across. Nearly all of them are working satellites, which usually move out of the way of tracked debris. Dead satellites and spent rocket stages, which cannot, are mostly missing from this site’s data.`,
  );
  aboutItem(
    'Left out',
    'The pieces a later collision would make are not followed. This is the first step of a chain of collisions, not the chain. Fragments smaller than 10 cm, which are far more numerous and can still wreck a satellite, are left out too.',
  );
  aboutItem(
    'Chance',
    `Every run is repeated ${String(TRIALS)} times with different random fragments. A range in brackets is the lowest and highest of the repetitions.`,
  );
  about.append(aboutBody);

  panel.replaceChildren(
    heading,
    tagLine,
    intro,
    field('Event', presetSelect),
    presetNote,
    custom,
    field('The Sun', sunSelect),
    actions,
    status,
    results,
    about,
  );

  // State.
  let worker: Worker | null = null;
  let runId = 0;
  let runCount = 0;
  let cloud: readonly SimFragment[] = [];
  let made = 0;
  let trials: TrialSummary[] = [];
  let playing: number | null = null;
  let labels: readonly string[] = [];
  let hasBackground = false;
  /** The event whose results are on show, as a link would describe it. */
  let shown: SharedScenario | null = null;

  const formState = (runNumber: number): SharedScenario => {
    const isCustom = presetSelect.value === CUSTOM;
    const collides = isCustom && eventSelect.value === 'collision';
    return {
      preset: presetSelect.value,
      sun: sunSelect.value,
      run: runNumber,
      event: isCustom ? eventSelect.value : null,
      massKg: isCustom ? readNumber(massInput, 1000) : null,
      otherMassKg: collides ? readNumber(otherMassInput, 100) : null,
      crossingDegrees: collides ? readNumber(angleInput, 90) : null,
    };
  };

  /** Show the cloud, and fade the tracked objects behind it, only while this tab is open and there is a cloud. */
  const showCloud = (): void => {
    const show = !context.tabPanel.hidden && cloud.length > 0;
    layer?.setVisible(show);
    context.dimTracker(show && layer !== null);
  };

  const setPhase = (phase: 'idle' | 'running' | 'done' | 'failed'): void => {
    root.dataset.whatif = phase;
  };

  const describeSelected = (): void => {
    const isCustom = presetSelect.value === CUSTOM;
    custom.hidden = !isCustom;
    collisionFields.hidden = eventSelect.value !== 'collision';
    if (!isCustom) {
      presetNote.textContent = presetById(presetSelect.value)?.summary ?? '';
      return;
    }
    const selected = context.selected();
    presetNote.textContent =
      selected === null
        ? 'Nothing is selected. Go to the Now tab, pick an object, then come back.'
        : `${selected.name}, where it is at the time the tracker is showing.`;
  };

  const showMoment = (fraction: number): void => {
    const years = momentAt(fraction);
    const inOrbit = layer?.setMoment(years) ?? countInOrbit(years);
    momentLine.textContent = `${describeSpan(years)} after: ${whole.format(inOrbit)} of ${whole.format(made)} fragments in orbit`;
    slider.setAttribute('aria-valuetext', `${describeSpan(years)} after the break-up`);
    chart.setMoment(years);
    root.dataset.whatifInOrbit = String(inOrbit);
  };

  const countInOrbit = (years: number): number =>
    cloud.filter((f) => f.history.reentryYears === null || f.history.reentryYears > years).length;

  const stopPlaying = (): void => {
    if (playing !== null) {
      cancelAnimationFrame(playing);
      playing = null;
    }
    playButton.textContent = 'Play';
  };

  const play = (): void => {
    let from = Number(slider.value) / SLIDER_STEPS;
    if (from >= 1) {
      from = 0;
    }
    const started = performance.now();
    const duration = PLAY_MS * (1 - from);
    playButton.textContent = 'Pause';
    const tick = (now: number): void => {
      const f = Math.min(1, from + ((now - started) / duration) * (1 - from));
      slider.value = String(Math.round(f * SLIDER_STEPS));
      showMoment(f);
      if (f >= 1) {
        stopPlaying();
        return;
      }
      playing = requestAnimationFrame(tick);
    };
    playing = requestAnimationFrame(tick);
  };

  const addFact = (name: string, value: string): void => {
    const row = make('div', 'fact');
    row.append(make('dt', '', name), make('dd', '', value));
    facts.append(row);
  };

  const renderResults = (collision: SimulationResult['collision']): void => {
    facts.replaceChildren();
    addFact('Fragments 10 cm and larger', countWithRange(trials.map((t) => t.fragments)));
    addFact(
      'Thrown down into the air or away from the Earth at once',
      countWithRange(trials.map((t) => t.lostAtOnce)),
    );
    if (collision !== null) {
      addFact('Closing speed', `${collision.speedKmS.toFixed(1)} km/s`);
      addFact(
        'Outcome',
        collision.catastrophic
          ? `Both bodies destroyed (${whole.format(collision.specificEnergyJPerG)} J per gram, limit ${String(CATASTROPHIC_THRESHOLD_J_PER_G)})`
          : `The heavier body survives with a crater (${whole.format(collision.specificEnergyJPerG)} J per gram, limit ${String(CATASTROPHIC_THRESHOLD_J_PER_G)})`,
      );
    }

    const table = make('table', 'growth-table');
    const head = make('thead');
    const headRow = make('tr');
    const titles = hasBackground
      ? ['After', 'Still in orbit', 'Hits on satellites, if none dodged', 'Chance of at least one']
      : ['After', 'Still in orbit'];
    for (const title of titles) {
      const cell = make('th', '', title);
      cell.scope = 'col';
      headRow.append(cell);
    }
    head.append(headRow);
    const body = make('tbody');
    QUOTED_YEARS.forEach((years, index) => {
      const row = make('tr');
      const when = make('th', '', `${String(years)} ${years === 1 ? 'year' : 'years'}`);
      when.scope = 'row';
      row.append(when);
      row.append(make('td', '', percentWithRange(trials.map((t) => t.remaining[index] ?? 0))));
      if (hasBackground) {
        const hits = spread(trials.map((t) => t.hits[index] ?? 0));
        const range =
          expectedNumber(hits.low) === expectedNumber(hits.high)
            ? ''
            : ` (${expectedNumber(hits.low)} to ${expectedNumber(hits.high)})`;
        row.append(
          make('td', '', `${expectedNumber(hits.median)}${range}`),
          make('td', '', chanceOfAny(hits.median)),
        );
      }
      body.append(row);
    });
    table.append(head, body);
    tableWrap.replaceChildren(table);

    if (hasBackground) {
      const last = QUOTED_YEARS.length - 1;
      const destructive = spread(trials.map((t) => t.destructiveHits[last] ?? 0)).median;
      addFact(
        `Hits hard enough to destroy a ${whole.format(TYPICAL_OBJECT_MASS_KG)} kg satellite, in 100 years`,
        expectedNumber(destructive),
      );
      const total = spread(trials.map((t) => t.hits[last] ?? 0)).median;
      const byBand = (trials[0]?.hitsByBand ?? []).map(
        (_, band) => spread(trials.map((t) => t.hitsByBand[band] ?? 0)).median,
      );
      const busiest = byBand.indexOf(Math.max(...byBand));
      if (total > 0 && busiest >= 0) {
        const from = LOWEST_BAND_KM + busiest * BAND_KM;
        addFact(
          'Where most of the hits would be',
          `${whole.format(from)} to ${whole.format(from + BAND_KM)} km up (${String(Math.round(((byBand[busiest] ?? 0) / byBand.reduce((sum, v) => sum + v, 0)) * 100))}%)`,
        );
      }
      caveat.textContent =
        'A hit is counted whenever a fragment’s path and a satellite’s would cross, as if no satellite moved out of the way. Read it as how much dodging this cloud would cause, not as a count of collisions to come.';
    } else {
      caveat.textContent =
        'The orbital data has not loaded, so hits on other satellites could not be estimated.';
    }
    chart.setTrials(trials);
    root.dataset.whatifFragments = String(spread(trials.map((t) => t.fragments)).median);
    root.dataset.whatifTrials = String(trials.length);
  };

  const clear = (): void => {
    worker?.terminate();
    worker = null;
    runId += 1;
    stopPlaying();
    cloud = [];
    trials = [];
    layer?.setCloud(null);
    showCloud();
    results.hidden = true;
    clearButton.hidden = true;
    status.textContent = '';
    shown = null;
    delete root.dataset.whatifFragments;
    delete root.dataset.whatifTrials;
    delete root.dataset.whatifInOrbit;
    setPhase('idle');
    context.onChange?.();
  };

  const buildScenario = (): Scenario | string => {
    if (presetSelect.value !== CUSTOM) {
      return presetById(presetSelect.value)?.build() ?? 'That event is not available.';
    }
    const selected = context.selected();
    if (selected === null) {
      return 'Nothing is selected. Go to the Now tab, pick an object, then come back.';
    }
    const { r, v } = fromScene(selected.position, selected.velocity, context.kmPerSceneUnit);
    const event = eventChoices.find(([value]) => value === eventSelect.value)?.[0] ?? 'explosion';
    return customScenario(
      { label: selected.name, r, v, massKg: 1, kind: selected.kind },
      {
        event,
        massKg: readNumber(massInput, 1000),
        otherMassKg: readNumber(otherMassInput, 100),
        crossingDegrees: readNumber(angleInput, 90),
      },
    );
  };

  const run = (): void => {
    const scenario = buildScenario();
    if (typeof scenario === 'string') {
      status.textContent = scenario;
      return;
    }
    clear();
    runCount += 1;
    shown = formState(runCount);
    context.onChange?.();
    const id = runId;
    const background = context.background();
    hasBackground = background !== null;
    labels = scenario.parents.map((parent) => parent.label);
    const density = SOLAR_SETTINGS.find((setting) => setting.id === sunSelect.value)?.factor ?? 1;
    const message: RunMessage = {
      type: 'run',
      id,
      request: {
        ...scenario,
        smallestLengthM: SMALLEST_M,
        densityFactor: density,
        background: background ?? { perigeeKm: [], apogeeKm: [] },
        trials: TRIALS,
        seed: 20_261_115 + runCount,
      },
    };
    const preset = presetById(presetSelect.value);
    really.textContent = preset?.really ?? '';
    really.hidden = preset?.really === undefined;
    legend.replaceChildren();
    labels.forEach((label, index) => {
      const key = make('span', 'whatif-key');
      const swatch = make('span', 'swatch');
      swatch.style.background = CLOUD_COLOURS[index] ?? CLOUD_COLOURS[0];
      key.append(swatch, ` Pieces of: ${label}`);
      legend.append(key);
    });
    legend.hidden = layer === null;

    setPhase('running');
    status.textContent = `Working: repetition 1 of ${String(TRIALS)}…`;
    clearButton.hidden = false;
    const thread = new Worker(new URL('../../sim/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker = thread;
    const collision = collisionOf(scenario);
    thread.addEventListener('message', (event: MessageEvent<SimReply>) => {
      const reply = event.data;
      if (reply.id !== id || id !== runId) {
        return;
      }
      if (reply.type === 'failed') {
        status.textContent = `The simulation stopped with an error: ${reply.message}`;
        setPhase('failed');
        return;
      }
      if (reply.type === 'trial') {
        trials = [...trials, reply.summary];
        if (reply.fragments !== null) {
          cloud = reply.fragments;
          made = reply.summary.fragments;
          layer?.setCloud(cloud);
          showCloud();
          results.hidden = false;
          const start = fractionOfMoment(FIRST_VIEW_YEARS);
          slider.value = String(Math.round(start * SLIDER_STEPS));
          showMoment(start);
          const first = scenario.parents[0];
          if (first !== undefined && context.globe !== null) {
            const k = context.kmPerSceneUnit;
            const position = { x: first.r[0] / k, y: first.r[2] / k, z: -first.r[1] / k };
            context.globe.flyTo(
              position,
              Math.hypot(position.x, position.y, position.z),
              !context.reducedMotion(),
            );
          }
        }
        renderResults(collision);
        status.textContent =
          reply.done < reply.total
            ? `Working: repetition ${String(reply.done + 1)} of ${String(reply.total)}…`
            : '';
        return;
      }
      renderResults(collision);
      status.textContent = `Done: ${String(TRIALS)} repetitions.`;
      setPhase('done');
      thread.terminate();
      if (worker === thread) {
        worker = null;
      }
    });
    thread.addEventListener('error', () => {
      if (id === runId) {
        status.textContent = 'The simulation could not be started. Reload the page and try again.';
        setPhase('failed');
      }
    });
    thread.postMessage(message);
  };

  for (const control of [presetSelect, eventSelect, sunSelect]) {
    control.addEventListener('change', () => {
      describeSelected();
      context.onChange?.();
    });
  }
  runButton.addEventListener('click', run);
  clearButton.addEventListener('click', clear);
  slider.addEventListener('input', () => {
    stopPlaying();
    showMoment(Number(slider.value) / SLIDER_STEPS);
  });
  playButton.addEventListener('click', () => {
    if (playing === null) {
      play();
    } else {
      stopPlaying();
    }
  });

  // The cloud belongs to this tab: hide it, and stop the clock, when the tab is left.
  new MutationObserver(() => {
    const hidden = context.tabPanel.hidden;
    showCloud();
    if (hidden) {
      stopPlaying();
    } else {
      describeSelected();
    }
  }).observe(context.tabPanel, { attributes: true, attributeFilter: ['hidden'] });
  // The tracker records its selection on the page; follow it.
  new MutationObserver(describeSelected).observe(root, {
    attributes: true,
    attributeFilter: ['data-selected'],
  });

  describeSelected();
  setPhase('idle');

  const choose = (select: HTMLSelectElement, value: string | null): void => {
    if (value !== null && [...select.options].some((option) => option.value === value)) {
      select.value = value;
    }
  };
  return {
    apply(scenario): void {
      choose(presetSelect, scenario.preset);
      choose(sunSelect, scenario.sun);
      choose(eventSelect, scenario.event);
      if (scenario.massKg !== null) {
        massInput.value = String(scenario.massKg);
      }
      if (scenario.otherMassKg !== null) {
        otherMassInput.value = String(scenario.otherMassKg);
      }
      if (scenario.crossingDegrees !== null) {
        angleInput.value = String(scenario.crossingDegrees);
      }
      describeSelected();
      if (scenario.run > 0) {
        // The run's number decides its random fragments, so the same link shows the same cloud.
        runCount = scenario.run - 1;
        run();
      } else {
        context.onChange?.();
      }
    },
    current: () => shown ?? formState(0),
    play(): void {
      if (cloud.length > 0 && playing === null) {
        play();
      }
    },
    clear,
  };
}
