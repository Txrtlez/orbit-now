import './styles.css';
import { describeBuild } from './app/buildInfo';
import { initTabs } from './app/tabs';
import { createGlobe } from './render/globe';

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

function startGlobe(): void {
  const canvas = requireElement('globe', HTMLCanvasElement);
  const status = requireElement('render-status', HTMLElement);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  setRendererState('starting');
  try {
    const globe = createGlobe({
      canvas,
      autoRotate: !reducedMotion.matches,
      onFirstFrame: () => {
        setRendererState('ready');
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
    reducedMotion.addEventListener('change', (event) => {
      globe.setAutoRotate(!event.matches);
    });
  } catch (error: unknown) {
    console.warn('Orbit Now could not start the 3D view:', error);
    status.textContent =
      'This browser or device could not start WebGL2, which the 3D view needs. Try a current version of Chrome, Safari, Firefox or Edge, and check that hardware acceleration is enabled.';
    setRendererState('unsupported');
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

requireElement('build-info', HTMLElement).textContent = describeBuild(
  __BUILD_COMMIT__,
  __BUILD_TIME__,
);
startTabs();
startGlobe();
