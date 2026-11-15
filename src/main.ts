import './styles.css';
import { describeBuild } from './app/buildInfo';
import { renderCatalogStatus, summariseCatalog } from './app/catalogStatus';
import { createFrameStats } from './app/stats';
import { initTabs } from './app/tabs';
import { CATALOG_URL, loadCatalog } from './catalog/load';
import { startPropagation } from './orbit/propagationClient';
import { createGlobe, type Globe } from './render/globe';
import { coloursForObjects } from './render/palette';
import { createSatelliteLayer } from './render/satelliteLayer';

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

function startGlobe(): Globe | null {
  const canvas = requireElement('globe', HTMLCanvasElement);
  const status = requireElement('render-status', HTMLElement);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
    return globe;
  } catch (error: unknown) {
    console.warn('Orbit Now could not start the 3D view:', error);
    status.textContent =
      'This browser or device could not start WebGL2, which the 3D view needs. Try a current version of Chrome, Safari, Firefox or Edge, and check that hardware acceleration is enabled.';
    setRendererState('unsupported');
    return null;
  }
}

function startTabs(): void {
  const whatIfPanel = requireElement('panel-whatif', HTMLElement);

  initTabs([
    {
      tab: requireElement('tab-now', HTMLButtonElement),
      panel: requireElement('panel-now', HTMLElement),
    },
    {
      tab: requireElement('tab-whatif', HTMLButtonElement),
      panel: whatIfPanel,
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
  const container = requireElement('catalog-status', HTMLElement);
  let catalog;
  try {
    catalog = await loadCatalog(CATALOG_URL, (url) => fetch(url));
    renderCatalogStatus(container, catalog === null ? null : summariseCatalog(catalog), Date.now());
    setCatalogState(catalog === null ? 'missing' : 'loaded');
  } catch (error: unknown) {
    console.warn('Orbit Now could not load its orbital data:', error);
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
    globe.addLayer(layer);
    await layer.ready;
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
startTabs();
void startCatalog(startGlobe());
