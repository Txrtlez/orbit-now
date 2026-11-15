import './styles.css';
import { describeBuild } from './app/buildInfo';
import { renderCatalogStatus, summariseCatalog } from './app/catalogStatus';
import { createFrameStats } from './app/stats';
import { initTabs } from './app/tabs';
import { initTimeBar } from './app/timeBar';
import { createClock } from './app/clock';
import { createEventsPanel, type EventsPanel } from './app/eventsPanel';
import { createExplorer, type Explorer } from './app/explorer';
import { createFilterPanel } from './app/filterPanel';
import { countFilterOptions } from './app/filters';
import { createPassesPanel } from './app/passesPanel';
import { formatCount } from './app/format';
import { buildSearchIndex, searchObjects } from './app/search';
import { initSearchBox } from './app/searchBox';
import { CATALOG_URL, loadCatalog } from './catalog/load';
import { buildObjectIndex, categoryAt, type ObjectIndex } from './catalog/objectIndex';
import { geodeticToEcef } from './geo/geodetic';
import { ecefKmToScene } from './geo/sceneFrame';
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
      autoRotate: !reducedMotion.matches,
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
    reducedMotion.addEventListener('change', (event) => {
      globe.setAutoRotate(!event.matches);
    });
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
    globe.setInsets(top, bottom, !first && !reducedMotion.matches);
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
        whatIfPanel.textContent = 'Loading…';
        import('./modes/whatif/whatif')
          .then(({ mountWhatIf }) => {
            mountWhatIf(whatIfPanel);
          })
          .catch((error: unknown) => {
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
          reducedMotion: () => reducedMotion.matches,
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
  let catalog;
  try {
    catalog = await loadCatalog(CATALOG_URL, (url) => fetch(url));
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
      reducedMotion: () => reducedMotion.matches,
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
      },
    });
    eventsPanel = createEventsPanel({
      container: requireElement('events-panel', HTMLElement),
      groupCounts: countFilterOptions(objects).groups,
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
          !reducedMotion.matches,
        );
      },
    });
    requireElement('passes', HTMLElement).hidden = false;
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

requireElement('build-info', HTMLElement).textContent = describeBuild(
  __BUILD_COMMIT__,
  __BUILD_TIME__,
);
startOverviewToggle();
startTabs();
startGrowthChart();
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
void startCatalog(startGlobe());
