import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WGS84_A_KM, WGS84_B_KM } from '../geo/wgs84';
import { fitSphereDistance } from './camera';
import { buildGraticulePositions } from './graticule';

/** Full vertical field of view of the camera, in degrees. */
const VERTICAL_FOV_DEG = 45;
/** How much empty space to leave around the globe at the default zoom. */
const FIT_MARGIN = 1.3;
/** Cap on device pixel ratio. Above 2 the extra pixels cost far more than they add. */
const MAX_PIXEL_RATIO = 2;

const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// The fragment shader brightens the globe towards its visible edge (its
// "limb"). It is a purely decorative effect that gives the untextured
// ellipsoid some depth. It is deliberately NOT a day/night terminator: real
// sunlight is added in Phase 3 from the computed position of the Sun.
const EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uLimbColor;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    float facing = clamp(dot(normalize(vNormal), normalize(vViewDirection)), 0.0, 1.0);
    float limb = pow(1.0 - facing, 3.0);
    gl_FragColor = vec4(mix(uBaseColor, uLimbColor, limb), 1.0);
    #include <colorspace_fragment>
  }
`;

export interface GlobeOptions {
  /** Canvas to draw into. Its displayed size is controlled by CSS. */
  readonly canvas: HTMLCanvasElement;
  /** Whether the camera should drift slowly around the Earth until the viewer interacts. */
  readonly autoRotate: boolean;
  /** Called once, after the first frame has been drawn. */
  readonly onFirstFrame: () => void;
  /** Called if the browser takes the GPU context away (for example under memory pressure). */
  readonly onContextLost: () => void;
  /** Called when the browser hands the GPU context back. */
  readonly onContextRestored: () => void;
}

export interface Globe {
  /** Turn the idle camera drift on or off. */
  setAutoRotate(enabled: boolean): void;
  /** Stop rendering and release all GPU resources and event listeners. */
  dispose(): void;
}

/**
 * Create the 3D view: an untextured WGS 84 ellipsoid with a latitude/longitude
 * grid, an orbiting camera, and a render loop.
 *
 * @throws if the browser cannot provide a WebGL2 context. The caller is
 * expected to catch this and show a fallback message.
 */
export function createGlobe(options: GlobeOptions): Globe {
  const { canvas } = options;

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(new Color(0x05070d), 1);

  const scene = new Scene();
  const camera = new PerspectiveCamera(VERTICAL_FOV_DEG, 1, 0.05, 500);

  // --- Earth ---------------------------------------------------------------
  // A unit sphere, squashed along the polar (scene y) axis by b/a so that it
  // is the WGS 84 ellipsoid in scene units. The squash is about 0.34 percent:
  // invisible to the eye, but it keeps surface features and ground-station
  // positions consistent with the geodesy code in later phases.
  const earthGeometry = new SphereGeometry(1, 96, 48);
  const earthMaterial = new ShaderMaterial({
    vertexShader: EARTH_VERTEX_SHADER,
    fragmentShader: EARTH_FRAGMENT_SHADER,
    uniforms: {
      uBaseColor: { value: new Color(0x0a1424) },
      uLimbColor: { value: new Color(0x2f6ea8) },
    },
    // Push the surface very slightly away from the camera in the depth buffer
    // so that grid lines lying exactly on it are not hidden by rounding error
    // ("z-fighting").
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const earth = new Mesh(earthGeometry, earthMaterial);
  earth.scale.set(1, WGS84_B_KM / WGS84_A_KM, 1);
  scene.add(earth);

  // --- Latitude/longitude grid ---------------------------------------------
  const graticuleGeometry = new BufferGeometry();
  graticuleGeometry.setAttribute(
    'position',
    new BufferAttribute(buildGraticulePositions(30, 2), 3),
  );
  const graticuleMaterial = new LineBasicMaterial({
    color: 0x7cc4ff,
    transparent: true,
    opacity: 0.35,
  });
  const graticule = new LineSegments(graticuleGeometry, graticuleMaterial);
  scene.add(graticule);

  // --- Camera control ------------------------------------------------------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.15;
  controls.maxDistance = 40;
  controls.autoRotate = options.autoRotate;
  controls.autoRotateSpeed = 0.35;

  // Start looking at the Earth from slightly north of the equator.
  camera.position.set(0.25, 0.35, 1).normalize();

  // Until the viewer zooms or rotates, keep the whole globe framed when the
  // window changes shape. After that, respect the viewer's chosen distance.
  let viewerHasInteracted = false;
  const onInteractionStart = (): void => {
    viewerHasInteracted = true;
    controls.autoRotate = false;
  };
  controls.addEventListener('start', onInteractionStart);

  const applySize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    // `false`: do not let three.js overwrite the canvas's CSS size.
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!viewerHasInteracted) {
      const distance = fitSphereDistance(1, VERTICAL_FOV_DEG, camera.aspect, FIT_MARGIN);
      camera.position.setLength(distance);
    }
  };
  applySize();
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(canvas);

  // --- Render loop ---------------------------------------------------------
  let frameRequest = 0;
  let running = false;
  let firstFramePending = true;

  const renderFrame = (): void => {
    frameRequest = window.requestAnimationFrame(renderFrame);
    controls.update();
    renderer.render(scene, camera);
    if (firstFramePending) {
      firstFramePending = false;
      options.onFirstFrame();
    }
  };
  const start = (): void => {
    if (!running) {
      running = true;
      frameRequest = window.requestAnimationFrame(renderFrame);
    }
  };
  const stop = (): void => {
    if (running) {
      running = false;
      window.cancelAnimationFrame(frameRequest);
    }
  };

  // Do no work while the tab is in the background.
  let contextLost = false;
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      stop();
    } else if (!contextLost) {
      start();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  const onContextLost = (event: Event): void => {
    // Calling preventDefault tells the browser we intend to recover, which is
    // required for the matching "restored" event to be delivered at all.
    event.preventDefault();
    contextLost = true;
    stop();
    options.onContextLost();
  };
  const onContextRestored = (): void => {
    contextLost = false;
    options.onContextRestored();
    if (!document.hidden) {
      start();
    }
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  if (!document.hidden) {
    start();
  }

  return {
    setAutoRotate(enabled: boolean): void {
      // Never restart the drift after the viewer has taken control.
      controls.autoRotate = enabled && !viewerHasInteracted;
    },
    dispose(): void {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onInteractionStart);
      controls.dispose();
      earthGeometry.dispose();
      earthMaterial.dispose();
      graticuleGeometry.dispose();
      graticuleMaterial.dispose();
      renderer.dispose();
    },
  };
}
