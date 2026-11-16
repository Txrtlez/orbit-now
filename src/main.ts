import './styles.css';
import { describeBuild } from './app/buildInfo';
import { renderCatalogStatus, summariseCatalog } from './app/catalogStatus';
import { createFrameStats } from './app/stats';
import { initTabs } from './app/tabs';
import { initTimeBar } from './app/timeBar';
import { createClock, TIME_SPAN_MS } from './app/clock';
import { createEventsPanel, type EventsPanel } from './app/eventsPanel';
import { createExplorer, type Explorer } from './app/explorer';
import { createFilterPanel } from './app/filterPanel';
import { countFilterOptions, isFilterActive, NO_FILTERS, type FilterState } from './app/filters';
import {
  decodeView,
  encodeView,
  isDefaultView,
  type SharedScenario,
  type SharedView,
} from './app/shareLink';
import type { Tour, TourContext } from './app/tour';
import type { AboutFacts } from './about/about';
import { createPassesPanel } from './app/passesPanel';
import { formatCount } from './app/format';
import { buildSearchIndex, searchObjects } from './app/search';
import { initSearchBox } from './app/searchBox';
import { CATALOG_URL, loadCatalog } from './catalog/load';
import { buildObjectIndex, categoryAt, type ObjectIndex } from './catalog/objectIndex';
import { geodeticToEcef } from './geo/geodetic';
import { ecefKmToScene, KM_PER_SCENE_UNIT } from './geo/sceneFrame';
import type { WhatIfContext, WhatIfControl } from './modes/whatif/whatif';
import { startPropagation } from './orbit/propagationClient';
import { gmstRadians } from './orbit/time';
import { startOfPass } from './passes/passList';
import { choosePassTargets } from './passes/targets';
import { createGlobe, type Globe } from './render/globe';
import { createObserverMarker } from './render/observerMarker';
import { createOrbitPathLayer } from './render/orbitPathLayer';
import { coloursForObjects } from './render/palette';
import { createSatelliteLayer } from './render/satelliteLayer';
import { createSelectionMarker } from './render/selectionMarker';

/**
 * Look up an element by id and check that it is the kind of element the code
 * expects. Failing loudly here is better than a confusing error later.
 */
function requireElement<T extends HTMLElement>(id: string, type: abstract new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Expected #${id} to be a ${type.name}`);
  }
  return element;
}

type RendererState = 'starting' | 'ready' | 'unsupported' | 'context-lost';

/**
 * Record the renderer's state on the <html> element. CSS uses it to show or
 * hide the status message, and the end-to-end tests use it to know when the
 * first frame has been drawn.
 */
function setRendererState(state: RendererState): void {
  document.documentElement.dataset.renderer = state;
}

/**
 * The clock the scene runs on. It starts as the real time; the viewer can
 * pause it, run it faster or move it up to three days either way.
 */
const clock = createClock(() => Date.now());
const sceneClock = (): number => clock.now();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Where the viewer's own "Reduce motion" choice and "has seen the tour" are kept in the browser. */
const MOTION_KEY = 'orbit-now:reduce-motion';
const TOUR_KEY = 'orbit-now:tour';

function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage is switched off; the choice lasts for this visit only.
  }
}

/** The viewer's own choice, made in the menu, on top of what the device asks for. */
let motionSetting = readSetting(MOTION_KEY) === '1';

/** Whether things should not move by themselves: the device asks for it, or the viewer has. */
const motionReduced = (): boolean => reducedMotion.matches || motionSetting;

/** Put a change of the motion setting into effect. Filled in when the globe exists. */
let applyMotion: () => void = () => undefined;

/** The view a link asked for, read once as the page starts. */
const sharedView = decodeView(window.location.hash);

/**
 * The part of the page that responds to taps on the globe. It can only be
 * created once the orbital data has arrived, which is after the globe has
 * started reporting taps, so the globe is given functions that look it up.
 */
let explorer: Explorer | null = null;

function startGlobe(): Globe | null {
  const canvas = requireElement('globe', HTMLCanvasElement);
  const status = requireElement('render-status', HTMLElement);

  setRendererState('starting');
  try {
    // The readout needs the globe (for the GPU's name) and the globe needs
    // the readout (to call every frame), so the globe is filled in afterwards.
    let created: Globe | null = null;
    const recordFrame = createFrameStats(requireElement('stats', HTMLElement), () => {
      const objects = document.documentElement.dataset.objects ?? '0';
      return `${objects} objects · ${created?.describeRenderer() ?? ''}`;
    });
    const globe = createGlobe({
      canvas,
      autoRotate: !motionReduced(),
      nowMs: sceneClock,
      onFirstFrame: () => {
        setRendererState('ready');
      },
      onFrame: recordFrame ?? undefined,
      onTap: (x, y, kind) => {
        explorer?.handleTap(x, y, kind);
      },
      onHover: (position) => {
        explorer?.handleHover(position);
      },
      onContextLost: () => {
        status.textContent = 'The 3D view was paused by the browser. Trying to restore it…';
        setRendererState('context-lost');
      },
      onContextRestored: () => {
        status.textContent = '';
        setRendererState('ready');
      },
    });
    created = globe;
    applyMotion = () => {
      globe.setAutoRotate(!motionReduced());
    };
    reducedMotion.addEventListener('change', applyMotion);
    startInsetTracking(globe);
    return globe;
  } catch (error: unknown) {
    console.warn('Orbit Now could not start the 3D view:', error);
    status.textContent =
      'This browser or device could not start WebGL2, which the 3D view needs. Try a current version of Chrome, Safari, Firefox or Edge, and check that hardware acceleration is enabled.';
    setRendererState('unsupported');
    return null;
  }
}

/**
 * The overview card can be folded down to its title, so that on a phone it
 * does not cover the globe. It starts folded on narrow screens.
 */
function startOverviewToggle(): void {
  const button = requireElement('overview-toggle', HTMLButtonElement);
  const body = requireElement('overview-body', HTMLElement);
  const setExpanded = (expanded: boolean): void => {
    body.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Hide details' : 'Show details');
  };
  setExpanded(!window.matchMedia('(max-width: 719px)').matches);
  button.addEventListener('click', () => {
    setExpanded(body.hidden !== false);
  });
}

/**
 * On a narrow screen the cards are sheets across the bottom of the view.
 * Tell the globe how much of the view they cover, so that it keeps the
 * Earth centred in the part that can be seen. On a wide screen the cards
 * sit beside the Earth and nothing needs to move.
 */
function startInsetTracking(globe: Globe): void {
  const narrow = window.matchMedia('(max-width: 719px)');
  // Sheets across the bottom of a narrow screen...
  const sheets = [
    requireElement('overview', HTMLElement),
    requireElement('object-panel', HTMLElement),
    requireElement('whatif-card', HTMLElement),
  ];
  // ...and what runs across the top of it.
  const bars = [requireElement('topbar', HTMLElement), requireElement('top-stack', HTMLElement)];
  // The column at the top holds the time controls on any screen too narrow
  // to put them along the bottom, which is wider than "narrow" above.
  const crowdedTop = window.matchMedia('(max-width: 1239px)');
  let first = true;
  const update = (): void => {
    let top = 0;
    let bottom = 0;
    if (crowdedTop.matches) {
      // A hidden element has no size and is skipped.
      for (const bar of bars) {
        const bounds = bar.getBoundingClientRect();
        if (bounds.height > 0) {
          top = Math.max(top, bounds.bottom);
        }
      }
    }
    if (narrow.matches) {
      for (const sheet of sheets) {
        const bounds = sheet.getBoundingClientRect();
        if (bounds.height > 0) {
          bottom = Math.max(bottom, window.innerHeight - bounds.top);
        }
      }
    }
    globe.setInsets(top, bottom, !first && !motionReduced());
    first = false;
  };
  const observer = new ResizeObserver(update);
  for (const tracked of [...sheets, ...bars]) {
    observer.observe(tracked);
  }
  narrow.addEventListener('change', update);
  crowdedTop.addEventListener('change', update);
  window.addEventListener('resize', update);
  update();
}

/**
 * What the "What if?" mode needs from the tracker. That mode is loaded only
 * when its tab is first opened, by which time some or all of this exists;
 * each piece is filled in as it comes to exist.
 */
const whatIfSource: {
  globe: Globe | null;
  selected: WhatIfContext['selected'];
  background: WhatIfContext['background'];
  dimTracker: WhatIfContext['dimTracker'];
} = {
  globe: null,
  selected: () => null,
  background: () => null,
  dimTracker: () => undefined,
};

/** How bright the tracked objects are drawn while a simulated cloud is on show. */
const TRACKER_BRIGHTNESS_BEHIND_A_CLOUD = 0.35;

/** The "What if?" mode's controls, once it has been loaded. */
let whatIfControl: WhatIfControl | null = null;
let whatIfLoading: Promise<WhatIfControl> | null = null;

/** Load "What if?" mode, once, and fill its card. */
function loadWhatIf(): Promise<WhatIfControl> {
  if (whatIfLoading === null) {
    const whatIfPanel = requireElement('whatif-card', HTMLElement);
    whatIfPanel.textContent = 'Loading…';
    whatIfLoading = import('./modes/whatif/whatif').then(({ mountWhatIf }) => {
      const control = mountWhatIf(whatIfPanel, {
        globe: whatIfSource.globe,
        kmPerSceneUnit: KM_PER_SCENE_UNIT,
        reducedMotion: motionReduced,
        tabPanel: requireElement('panel-whatif', HTMLElement),
        selected: () => whatIfSource.selected(),
        background: () => whatIfSource.background(),
        dimTracker: (dim) => {
          whatIfSource.dimTracker(dim);
        },
        onChange: syncAddress,
      });
      whatIfControl = control;
      return control;
    });
  }
  return whatIfLoading;
}

/** Switch to "What if?" mode and, if an event is given, set it up there. */
function openWhatIf(scenario: SharedScenario | null): Promise<WhatIfControl | null> {
  requireElement('tab-whatif', HTMLButtonElement).click();
  return loadWhatIf().then(
    (control) => {
      if (scenario !== null) {
        control.apply(scenario);
      }
      return control;
    },
    () => null,
  );
}

// --- Shareable links ----------------------------------------------------------

/** The filters as they now stand, kept for the address. */
let lastFilters: FilterState = NO_FILTERS;
/** False until the view a link asked for has been restored, so that it is not overwritten first. */
let addressReady = false;

function currentView(): SharedView {
  const whatIf = !requireElement('panel-whatif', HTMLElement).hidden;
  const selected = Number(document.documentElement.dataset.selected);
  return {
    mode: whatIf ? 'whatif' : 'now',
    object: Number.isFinite(selected) && selected > 0 ? selected : null,
    filters: lastFilters,
    timeMs: clock.isLive() ? null : clock.now(),
    scenario: whatIf ? (whatIfControl?.current() ?? null) : null,
  };
}

/** The address that brings back the present view. */
function viewAddress(): string {
  const fragment = encodeView(currentView());
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}${fragment === '' ? '' : `#${fragment}`}`;
}

/** Keep the address bar in step with the view, without adding to the browser's history. */
function syncAddress(): void {
  if (addressReady) {
    window.history.replaceState(null, '', viewAddress());
  }
}

// --- The menu: tour, sharing, motion, about ----------------------------------

/** What the tour needs from the tracker; null until the objects are on the globe. */
let tourSource: Omit<TourContext, 'container' | 'reducedMotion' | 'onEnd'> | null = null;
let tour: Tour | null = null;
let aboutFacts: AboutFacts = { objectCount: null, generatedAt: null };

function startTour(): void {
  if (tour !== null) {
    return;
  }
  const source = tourSource;
  if (source === null) {
    requireElement('share-status', HTMLElement).textContent =
      'The tour needs the orbital data, which has not loaded.';
    return;
  }
  writeSetting(TOUR_KEY, 'seen');
  import('./app/tour')
    .then(({ startTour: begin }) => {
      tour = begin({
        ...source,
        container: requireElement('tour', HTMLElement),
        reducedMotion: motionReduced,
        onEnd: () => {
          tour = null;
        },
      });
    })
    .catch((error: unknown) => {
      console.error('Failed to load the tour:', error);
    });
}

function startAbout(): () => void {
  const dialog = requireElement('about-dialog', HTMLDialogElement);
  const body = requireElement('about-body', HTMLElement);
  requireElement('about-close', HTMLButtonElement).addEventListener('click', () => {
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  return () => {
    dialog.showModal();
    if (body.childElementCount === 0) {
      body.textContent = 'Loading…';
    }
    import('./about/about')
      .then(({ mountAbout }) => {
        mountAbout(body, aboutFacts);
        document.documentElement.dataset.about = 'ready';
      })
      .catch((error: unknown) => {
        console.error('Failed to load the About page:', error);
        body.textContent =
          'This page could not be loaded. Check your connection, close this and try again.';
      });
  };
}

function startMenu(): void {
  const wrap = requireElement('more-button', HTMLButtonElement).parentElement;
  const button = requireElement('more-button', HTMLButtonElement);
  const list = requireElement('more-list', HTMLElement);
  const status = requireElement('share-status', HTMLElement);
  const field = requireElement('share-url', HTMLInputElement);
  const motion = requireElement('motion-reduce', HTMLInputElement);
  const openAbout = startAbout();

  const isOpen = (): boolean => button.getAttribute('aria-expanded') === 'true';
  const setOpen = (open: boolean): void => {
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) {
      status.textContent = '';
      field.hidden = true;
    }
  };
  button.addEventListener('click', () => {
    setOpen(!isOpen());
  });
  document.addEventListener('pointerdown', (event) => {
    if (isOpen() && event.target instanceof Node && wrap?.contains(event.target) !== true) {
      setOpen(false);
    }
  });
  wrap?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      // Closing the menu is all Escape should do here; the tracker also listens for it.
      event.stopPropagation();
      setOpen(false);
      button.focus();
    }
  });

  requireElement('tour-start', HTMLButtonElement).addEventListener('click', () => {
    setOpen(tourSource === null);
    startTour();
  });
  requireElement('about-open', HTMLButtonElement).addEventListener('click', () => {
    setOpen(false);
    openAbout();
  });
  requireElement('share-copy', HTMLButtonElement).addEventListener('click', () => {
    const address = viewAddress();
    window.history.replaceState(null, '', address);
    const showField = (): void => {
      field.value = address;
      field.hidden = false;
      field.focus();
      field.select();
      status.textContent = 'Copy the address below.';
    };
    // Not every browser lets a page write to the clipboard; the address itself is the fallback.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (clipboard === undefined) {
      showField();
      return;
    }
    clipboard.writeText(address).then(() => {
      status.textContent = 'Link copied.';
      document.documentElement.dataset.shared = address;
    }, showField);
  });

  motion.checked = motionSetting;
  const showMotion = (): void => {
    if (motionSetting) {
      document.documentElement.dataset.reduceMotion = 'true';
    } else {
      delete document.documentElement.dataset.reduceMotion;
    }
  };
  showMotion();
  motion.addEventListener('change', () => {
    motionSetting = motion.checked;
    writeSetting(MOTION_KEY, motionSetting ? '1' : null);
    showMotion();
    applyMotion();
  });
}

function startTabs(): void {
  const whatIfPanel = requireElement('whatif-card', HTMLElement);

  initTabs([
    {
      tab: requireElement('tab-now', HTMLButtonElement),
      panel: requireElement('panel-now', HTMLElement),
    },
    {
      tab: requireElement('tab-whatif', HTMLButtonElement),
      panel: requireElement('panel-whatif', HTMLElement),
      onFirstShow: () => {
        loadWhatIf().catch((error: unknown) => {
          console.error('Failed to load the What if? mode:', error);
          whatIfPanel.textContent =
            'This mode could not be loaded. Check your connection and reload the page.';
        });
      },
    },
  ]);
}

/** The most suggestions shown under the search field. */
const MAX_SUGGESTIONS = 8;

/** Switch the search field on, now that there are objects to find. */
function startSearch(objects: ObjectIndex, select: (index: number) => void): void {
  const input = requireElement('search-input', HTMLInputElement);
  const searchIndex = buildSearchIndex(objects.records);
  // Positions in the catalog of the suggestions currently on screen.
  let shown: number[] = [];
  initSearchBox({
    input,
    list: requireElement('search-results', HTMLElement),
    status: requireElement('search-status', HTMLElement),
    suggest: (query) => {
      shown = searchObjects(searchIndex, query, MAX_SUGGESTIONS);
      return shown.map((index) => {
        const record = objects.records[index];
        const category = categoryAt(objects, index);
        const number = record === undefined ? '' : `No. ${String(record.noradId)}`;
        return {
          title:
            record === undefined || record.name === ''
              ? `Object ${String(record?.noradId ?? '')}`
              : record.name,
          detail: category.id === 'other' ? number : `${category.label} · ${number}`,
        };
      });
    },
    onChoose: (position) => {
      const index = shown[position];
      if (index !== undefined) {
        select(index);
      }
    },
  });
  input.placeholder = `Search ${formatCount(objects.count)} objects`;
  input.disabled = false;
}

/** When a pass is shown in the 3D view, the clock is set this long before the satellite appears. */
const SHOW_PASS_LEAD_MS = 20_000;
/** ...and slowed to this speed if it was running faster, so the pass does not flash by. */
const SHOW_PASS_MAX_SPEED = 10;

/** The browser's storage for this site, or null where the browser refuses it. */
/** Whether the browser will keep a setting, so that the tour is not started on every visit. */
function storageWorks(): boolean {
  writeSetting('orbit-now:probe', '1');
  const kept = readSetting('orbit-now:probe') === '1';
  writeSetting('orbit-now:probe', null);
  return kept;
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The direction from the Earth's centre to a place on the ground, in the
 * scene's frame (which does not turn with the Earth), at an instant.
 */
function inertialDirectionOf(
  latitudeDeg: number,
  longitudeDeg: number,
  unixMs: number,
): { x: number; y: number; z: number } {
  const ecef = geodeticToEcef((latitudeDeg * Math.PI) / 180, (longitudeDeg * Math.PI) / 180, 0);
  const fixed = [0, 0, 0];
  ecefKmToScene(ecef.x, ecef.y, ecef.z, fixed);
  const [x = 0, y = 0, z = 0] = fixed;
  // Turn about the scene's north axis by the sidereal angle, as the globe turns the Earth.
  const angle = gmstRadians(unixMs);
  return {
    x: x * Math.cos(angle) + z * Math.sin(angle),
    y,
    z: -x * Math.sin(angle) + z * Math.cos(angle),
  };
}

/**
 * The growth-of-orbit chart opens in a dialog. Its code and its data are
 * fetched the first time it is opened, not with the page. It does not
 * depend on the orbital data, so it works even if that fails to load.
 */
function startGrowthChart(): void {
  const dialog = requireElement('growth-dialog', HTMLDialogElement);
  const body = requireElement('growth-body', HTMLElement);
  let chart: { start(): void; stop(): void } | null = null;
  let loading = false;

  const begin = (): void => {
    if (dialog.open) {
      chart?.start();
    }
  };

  requireElement('growth-open', HTMLButtonElement).addEventListener('click', () => {
    dialog.showModal();
    if (chart !== null) {
      begin();
      return;
    }
    if (loading) {
      return;
    }
    loading = true;
    body.textContent = 'Loading…';
    import('./growth/growthChart')
      .then(({ mountGrowthChart }) => {
        const objects = Number(document.documentElement.dataset.objects);
        chart = mountGrowthChart(body, {
          reducedMotion: motionReduced,
          siteObjectCount: Number.isFinite(objects) && objects > 0 ? objects : null,
        });
        document.documentElement.dataset.growth = 'ready';
        begin();
      })
      .catch((error: unknown) => {
        console.error('Failed to load the growth chart:', error);
        loading = false;
        body.textContent =
          'The chart could not be loaded. Check your connection, close this and try again.';
      });
  });
  requireElement('growth-close', HTMLButtonElement).addEventListener('click', () => {
    dialog.close();
  });
  // A click on the dimmed area around the dialog closes it. The dialog's
  // own box is covered by its children, so only the surround reports the
  // dialog itself as the target.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    chart?.stop();
  });
}

type CatalogState = 'loading' | 'loaded' | 'missing' | 'error';

/** Record the catalog's state on the <html> element, for the end-to-end tests. */
function setCatalogState(state: CatalogState): void {
  document.documentElement.dataset.catalog = state;
}

/**
 * Download the orbital data, report what was received, and put the objects on
 * the globe.
 */
async function startCatalog(globe: Globe | null): Promise<void> {
  const headline = requireElement('catalog-headline', HTMLElement);
  const container = requireElement('catalog-status', HTMLElement);
  /** Whether the objects ended up on the globe. */
  const outcome = { ready: false };
  let catalog;
  try {
    await placeCatalog();
  } finally {
    // With or without the data, "What if?" can still be opened from a link.
    if (sharedView.mode === 'whatif') {
      void openWhatIf(sharedView.scenario);
    }
    addressReady = true;
    syncAddress();
    // Someone who has not been here before, and did not arrive by a link to
    // a particular view, is shown round.
    if (
      outcome.ready &&
      isDefaultView(sharedView) &&
      readSetting(TOUR_KEY) === null &&
      storageWorks()
    ) {
      startTour();
    }
  }

  async function placeCatalog(): Promise<void> {
    try {
      catalog = await loadCatalog(CATALOG_URL, (url) => fetch(url));
      aboutFacts = {
        objectCount: catalog?.records.length ?? null,
        generatedAt: catalog?.generatedAt ?? null,
      };
      renderCatalogStatus(
        headline,
        container,
        catalog === null ? null : summariseCatalog(catalog),
        Date.now(),
      );
      setCatalogState(catalog === null ? 'missing' : 'loaded');
    } catch (error: unknown) {
      console.warn('Orbit Now could not load its orbital data:', error);
      headline.textContent = 'Orbital data unavailable';
      const message = document.createElement('p');
      message.textContent = 'The orbital data could not be loaded. Reload the page to try again.';
      container.replaceChildren(message);
      setCatalogState('error');
      return;
    }
    if (catalog === null || globe === null || catalog.records.length === 0) {
      return;
    }

    try {
      const client = await startPropagation(catalog.records);
      const colours = coloursForObjects(
        catalog.records.map((record) => record.sourceMask),
        catalog.sources.map((source) => source.id),
      );
      const layer = createSatelliteLayer(catalog.records.length, colours, client, clock);
      // A change of speed, a pause or a jump in time needs keyframes spaced for the new situation.
      clock.subscribe(() => {
        layer.resync();
      });
      const orbitPath = createOrbitPathLayer();
      const marker = createSelectionMarker();
      globe.addLayer(layer);
      globe.addLayer(orbitPath);
      globe.addLayer(marker);
      await layer.ready;

      const objects = buildObjectIndex(catalog, client.orbits);
      // Satellites and rocket stages: the things a simulated fragment could hit.
      // Without the descriptive fields every object is counted.
      const intact = { perigeeKm: [] as number[], apogeeKm: [] as number[] };
      for (let index = 0; index < objects.count; index += 1) {
        const type = objects.metadata?.objectType[index];
        if (type === undefined || type === 'PAY' || type === 'R/B') {
          intact.perigeeKm.push(objects.orbits.perigeeKm[index] ?? 0);
          intact.apogeeKm.push(objects.orbits.apogeeKm[index] ?? 0);
        }
      }
      whatIfSource.background = () => intact;
      whatIfSource.dimTracker = (dim) => {
        layer.setBrightness(dim ? TRACKER_BRIGHTNESS_BEHIND_A_CLOUD : 1);
      };
      whatIfSource.selected = () => {
        const index = explorer?.selected() ?? -1;
        const record = objects.records[index];
        const state = record === undefined ? null : layer.stateAt(index, clock.now());
        if (record === undefined || state === null) {
          return null;
        }
        return {
          name: record.name,
          kind: objects.metadata?.objectType[index] === 'R/B' ? 'rocketBody' : 'spacecraft',
          position: state.position,
          velocity: state.velocity,
        };
      };
      const created = createExplorer({
        globe,
        layer,
        marker,
        orbitPath,
        client,
        objects,
        colourOf: (index) =>
          `rgb(${String(colours[index * 3] ?? 0)} ${String(colours[index * 3 + 1] ?? 0)} ${String(colours[index * 3 + 2] ?? 0)})`,
        nowMs: sceneClock,
        reducedMotion: motionReduced,
        panelElement: requireElement('object-panel', HTMLElement),
        hoverLabel: requireElement('hover-label', HTMLElement),
        canvas: requireElement('globe', HTMLCanvasElement),
        onSelectionChange: (index) => {
          // For the stylesheet (which rearranges the cards on a phone when
          // something is selected) and for the end-to-end tests.
          const record = objects.records[index];
          if (record === undefined) {
            delete document.documentElement.dataset.selected;
          } else {
            document.documentElement.dataset.selected = String(record.noradId);
          }
          syncAddress();
        },
      });
      explorer = created;
      startSearch(objects, (index) => {
        created.select(index, true);
      });
      // The events panel is made after the filters it drives, and the filters
      // report their first state as they are made, so it is looked up when needed.
      let eventsPanel: EventsPanel | null = null;
      const filterControl = createFilterPanel({
        container: requireElement('filter-panel', HTMLElement),
        summary: requireElement('filters-summary', HTMLElement),
        objects,
        onChange: (passes, shown, state) => {
          created.setFilter(passes);
          headline.textContent =
            passes === null
              ? `Showing ${formatCount(objects.count)} objects`
              : `Showing ${formatCount(shown)} of ${formatCount(objects.count)} objects`;
          document.documentElement.dataset.shown = String(shown);
          eventsPanel?.syncWithFilters(state);
          lastFilters = state;
          syncAddress();
        },
      });
      const groupCounts = countFilterOptions(objects).groups;
      eventsPanel = createEventsPanel({
        container: requireElement('events-panel', HTMLElement),
        groupCounts,
        designators: objects.records.map((record) => record.objectId),
        showOnlyGroups: (groupIds) => {
          filterControl.showOnlyGroups(groupIds);
        },
        clearFilters: () => {
          filterControl.clear();
        },
        onOpenChange: (eventId) => {
          // For the end-to-end tests.
          if (eventId === null) {
            delete document.documentElement.dataset.event;
          } else {
            document.documentElement.dataset.event = eventId;
          }
        },
      });
      requireElement('events', HTMLElement).hidden = false;
      requireElement('filters', HTMLElement).hidden = false;

      const observerMarker = createObserverMarker();
      globe.addLayer(observerMarker);
      createPassesPanel({
        container: requireElement('passes-panel', HTMLElement),
        targets: choosePassTargets(catalog),
        requestPasses: (indices, latitudeRad, longitudeRad, fromMs, toMs) =>
          client.requestPasses(indices, latitudeRad, longitudeRad, fromMs, toMs),
        storage: browserStorage(),
        geolocation: 'geolocation' in navigator ? navigator.geolocation : null,
        loadPlaces: async () => {
          const response = await fetch('./places.txt');
          if (!response.ok) {
            throw new Error(`The list of places answered ${String(response.status)}`);
          }
          return response.text();
        },
        wallNow: () => Date.now(),
        onLocationChange: (place) => {
          observerMarker.setPlace(place);
          // For the end-to-end tests.
          if (place === null) {
            delete document.documentElement.dataset.observer;
          } else {
            document.documentElement.dataset.observer = `${String(place.latitudeDeg)},${String(place.longitudeDeg)}`;
          }
        },
        onShowPass: (target, pass, place) => {
          // Start a little before the satellite appears, at a speed at which
          // a pass of a few minutes can be followed.
          clock.setTime(startOfPass(pass) - SHOW_PASS_LEAD_MS);
          if (clock.speed() > SHOW_PASS_MAX_SPEED) {
            clock.setSpeed(SHOW_PASS_MAX_SPEED);
          }
          clock.setPlaying(true);
          created.select(target.index, false);
          globe.flyTo(
            inertialDirectionOf(place.latitudeDeg, place.longitudeDeg, clock.now()),
            1.1,
            !motionReduced(),
          );
        },
      });
      requireElement('passes', HTMLElement).hidden = false;

      // What the tour drives. The Space Station is catalog number 25544.
      const stationIndex = objects.indexOfNoradId(25544);
      tourSource = {
        objectCount: objects.count,
        groupCounts,
        station:
          stationIndex < 0
            ? null
            : {
                heightKm:
                  ((objects.orbits.perigeeKm[stationIndex] ?? 0) +
                    (objects.orbits.apogeeKm[stationIndex] ?? 0)) /
                  2,
                periodMinutes: objects.orbits.periodMinutes[stationIndex] ?? 0,
              },
        reset: () => {
          whatIfControl?.clear();
          requireElement('tab-now', HTMLButtonElement).click();
          filterControl.clear();
          created.select(-1, false);
          clock.goLive();
        },
        showOnlyGroups: (groupIds) => {
          filterControl.showOnlyGroups(groupIds);
        },
        selectStation: () => {
          created.select(stationIndex, true);
        },
        runCollision: () => {
          filterControl.clear();
          created.select(-1, false);
          void openWhatIf({
            preset: 'two-satellites',
            sun: 'average',
            run: 1,
            event: null,
            massKg: null,
            otherMassKg: null,
            crossingDegrees: null,
          }).then((control) => {
            // Set the cloud moving once there is one, unless motion is reduced.
            const started = Date.now();
            const wait = (): void => {
              if (tour === null || motionReduced() || Date.now() - started > 60_000) {
                return;
              }
              if (document.documentElement.dataset.whatifTrials === undefined) {
                window.setTimeout(wait, 250);
              } else {
                control?.play();
              }
            };
            wait();
          });
        },
      };

      // Restore the view a link asked for. What the catalog no longer has, or
      // a time now out of reach, is quietly left out.
      if (isFilterActive(sharedView.filters)) {
        filterControl.setState(sharedView.filters);
      }
      if (sharedView.timeMs !== null && Math.abs(sharedView.timeMs - Date.now()) <= TIME_SPAN_MS) {
        clock.setTime(sharedView.timeMs);
        clock.setPlaying(false);
      }
      if (sharedView.object !== null) {
        const index = objects.indexOfNoradId(sharedView.object);
        if (index >= 0) {
          created.select(index, true);
        }
      }
      outcome.ready = true;
      // A small hook for the end-to-end tests, which need to know where an
      // object is on screen in order to click it. It exposes nothing private.
      window.orbitNowDebug = {
        displayedTimeMs: sceneClock,
        noradIds: () => objects.records.map((record) => record.noradId),
        screenPositionOf: (noradId) => created.screenPositionOf(objects.indexOfNoradId(noradId)),
      };
      // For the end-to-end tests and the frame-rate readout.
      document.documentElement.dataset.objects = String(catalog.records.length);
      document.documentElement.dataset.propagationFailures = String(layer.failures());
    } catch (error: unknown) {
      console.error('Orbit Now could not start propagating the objects:', error);
      const message = document.createElement('p');
      message.textContent = 'The objects could not be placed on the globe in this browser.';
      container.append(message);
    }
  }
}

requireElement('build-info', HTMLElement).textContent = describeBuild(
  __BUILD_COMMIT__,
  __BUILD_TIME__,
);
startOverviewToggle();
startTabs();
startMenu();
startGrowthChart();
// The address follows the mode and the clock as well as the selection and filters.
new MutationObserver(syncAddress).observe(requireElement('panel-whatif', HTMLElement), {
  attributes: true,
  attributeFilter: ['hidden'],
});
clock.subscribe(syncAddress);
// An address typed or pasted over this one is a new view: start again from it.
window.addEventListener('hashchange', () => {
  window.location.reload();
});
initTimeBar(
  {
    bar: requireElement('time-bar', HTMLElement),
    play: requireElement('time-play', HTMLButtonElement),
    speed: requireElement('time-speed', HTMLSelectElement),
    label: requireElement('time-label', HTMLElement),
    offset: requireElement('time-offset', HTMLElement),
    live: requireElement('time-live', HTMLButtonElement),
    expand: requireElement('time-expand', HTMLButtonElement),
    slider: requireElement('time-slider', HTMLInputElement),
  },
  clock,
  () => Date.now(),
);
const globe = startGlobe();
whatIfSource.globe = globe;
void startCatalog(globe);
