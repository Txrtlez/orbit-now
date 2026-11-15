import './styles.css';
import { describeBuild } from './app/buildInfo';
import { renderCatalogStatus, summariseCatalog } from './app/catalogStatus';
import { createFrameStats } from './app/stats';
import { initTabs } from './app/tabs';
import { createExplorer, type Explorer } from './app/explorer';
import { CATALOG_URL, loadCatalog } from './catalog/load';
import { buildObjectIndex } from './catalog/objectIndex';
import { startPropagation } from './orbit/propagationClient';
import { createGlobe, type Globe } from './render/globe';
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
 * The time the scene shows. For now this is simply the present; Phase 4
 * replaces it with a clock the viewer can pause, speed up and scrub.
 */
const sceneClock = (): number => Date.now();

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
  const cards = [
    requireElement('overview', HTMLElement),
    requireElement('object-panel', HTMLElement),
    requireElement('whatif-card', HTMLElement),
  ];
  let first = true;
  const update = (): void => {
    let covered = 0;
    if (narrow.matches) {
      for (const card of cards) {
        const bounds = card.getBoundingClientRect();
        // A hidden card has no size.
        if (bounds.height > 0) {
          covered = Math.max(covered, window.innerHeight - bounds.top);
        }
      }
    }
    globe.setBottomInset(covered, !first && !reducedMotion.matches);
    first = false;
  };
  const observer = new ResizeObserver(update);
  for (const card of cards) {
    observer.observe(card);
  }
  narrow.addEventListener('change', update);
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
    const layer = createSatelliteLayer(catalog.records.length, colours, client, sceneClock);
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
    // A small hook for the end-to-end tests, which need to know where an
    // object is on screen in order to click it. It exposes nothing private.
    window.orbitNowDebug = {
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
void startCatalog(startGlobe());
