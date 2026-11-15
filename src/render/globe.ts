import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WGS84_A_KM, WGS84_B_KM } from '../geo/wgs84';
import { gmstRadians, sunDirection } from '../orbit/time';
import { fitSphereDistance } from './camera';
import { buildGraticulePositions } from './graticule';

/** Full vertical field of view of the camera, in degrees. */
const VERTICAL_FOV_DEG = 45;
/** How much empty space to leave around the globe at the default zoom. */
const FIT_MARGIN = 1.3;
/** Cap on device pixel ratio. Above 2 the extra pixels cost far more than they add. */
const MAX_PIXEL_RATIO = 2;
/** How long the Earth imagery takes to fade in once it has loaded. */
const TEXTURE_FADE_MS = 600;

const EARTH_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

// What is real and what is not in this shader:
//
// REAL DATA      The day and night images are NASA's Blue Marble and Black
//                Marble. The Sun's direction is computed for the current time.
// SIMPLIFICATION The change from day to night is drawn as a smooth blend over
//                the band where the Sun is within 6 degrees of the horizon
//                (the conventional limit of civil twilight). There is no
//                model of the atmosphere, clouds or seasons, and the day
//                image is a single cloud-free composite from May 2004.
// DECORATION     The glow towards the edge of the globe.
const EARTH_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uDayMap;
  uniform sampler2D uNightMap;
  uniform float uTextureMix;       // 0 = imagery not loaded yet, 1 = fully shown
  uniform vec3 uSunDirectionView;  // unit vector towards the Sun, in camera space
  uniform vec3 uBaseColor;
  uniform vec3 uLimbColor;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDirection;

  void main() {
    vec3 normal = normalize(vNormal);
    float facing = clamp(dot(normal, normalize(vViewDirection)), 0.0, 1.0);
    float limb = pow(1.0 - facing, 3.0);

    // Cosine of the angle between "straight up" here and the Sun: positive
    // in daylight, zero on the day/night line, negative at night.
    float sunCosine = dot(normal, uSunDirectionView);
    // sin(6 degrees) = 0.105
    float daylight = smoothstep(-0.105, 0.105, sunCosine);

    vec3 day = texture2D(uDayMap, vUv).rgb * mix(0.45, 1.0, clamp(sunCosine, 0.0, 1.0));
    vec3 night = texture2D(uNightMap, vUv).rgb;
    vec3 textured = mix(night, day, daylight);
    vec3 untextured = uBaseColor;

    vec3 colour = mix(untextured, textured, uTextureMix);
    colour += uLimbColor * limb * mix(1.0, 0.45, uTextureMix) * mix(0.35, 1.0, daylight);
    gl_FragColor = vec4(colour, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Something drawn in the inertial frame that needs updating every frame. */
export interface SceneLayer {
  readonly object: Object3D;
  update(nowMs: number, pixelRatio: number): void;
}

export interface GlobeOptions {
  /** Canvas to draw into. Its displayed size is controlled by CSS. */
  readonly canvas: HTMLCanvasElement;
  /** Whether the camera should drift slowly around the Earth until the viewer interacts. */
  readonly autoRotate: boolean;
  /** Returns the time to display, in milliseconds since 1970-01-01 UTC. */
  readonly nowMs: () => number;
  /** Called once, after the first frame has been drawn. */
  readonly onFirstFrame: () => void;
  /** Called after every frame. Used for the optional frame-rate readout. */
  readonly onFrame?: (() => void) | undefined;
  /** Called if the browser takes the GPU context away (for example under memory pressure). */
  readonly onContextLost: () => void;
  /** Called when the browser hands the GPU context back. */
  readonly onContextRestored: () => void;
}

export interface Globe {
  /** Turn the idle camera drift on or off. */
  setAutoRotate(enabled: boolean): void;
  /** Add something to the inertial scene and keep it updated every frame. */
  addLayer(layer: SceneLayer): void;
  /** A short description of the graphics hardware in use, for the frame-rate readout. */
  describeRenderer(): string;
  /** Stop rendering and release all GPU resources and event listeners. */
  dispose(): void;
}

/**
 * Convert a direction from equatorial axes (z towards the north pole) to
 * scene axes (y towards the north pole). The same rotation as in
 * src/geo/sceneFrame.ts, without the change of units.
 */
function equatorialToScene(direction: { x: number; y: number; z: number }, out: Vector3): Vector3 {
  return out.set(direction.x, direction.z, -direction.y);
}

/**
 * Create the 3D view.
 *
 * The scene is in an inertial frame (SGP4's TEME frame): it does not turn
 * with the Earth. Satellites are placed in it directly. The Earth is a child
 * object that is rotated about its axis by the sidereal angle, so the ground
 * turns underneath the orbits once per sidereal day, as it really does.
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
  // Everything attached to the ground goes in this group. Its rotation about
  // the polar axis is set every frame to Greenwich sidereal time.
  const earthGroup = new Group();
  scene.add(earthGroup);

  // A unit sphere, squashed along the polar (y) axis by b/a: the WGS 84
  // ellipsoid in scene units. three.js lays the sphere's texture coordinates
  // out so that the left edge of an equirectangular image (longitude 180
  // degrees west) falls on -x and its centre (Greenwich) on +x, which is
  // exactly the Earth-fixed convention used here; no adjustment is needed.
  const earthGeometry = new SphereGeometry(1, 128, 64);
  const earthUniforms = {
    uDayMap: { value: null as Texture | null },
    uNightMap: { value: null as Texture | null },
    uTextureMix: { value: 0 },
    uSunDirectionView: { value: new Vector3(1, 0, 0) },
    uBaseColor: { value: new Color(0x0a1424) },
    uLimbColor: { value: new Color(0x2f6ea8) },
  };
  const earthMaterial = new ShaderMaterial({
    vertexShader: EARTH_VERTEX_SHADER,
    fragmentShader: EARTH_FRAGMENT_SHADER,
    uniforms: earthUniforms,
    // Push the surface very slightly away from the camera in the depth buffer
    // so that grid lines lying exactly on it are not hidden by rounding error.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const earth = new Mesh(earthGeometry, earthMaterial);
  earth.scale.set(1, WGS84_B_KM / WGS84_A_KM, 1);
  earthGroup.add(earth);

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
  earthGroup.add(new LineSegments(graticuleGeometry, graticuleMaterial));

  // --- Imagery ---------------------------------------------------------------
  // Loaded after the first frame so that it never delays the page appearing.
  // Until both images have arrived the globe keeps its plain appearance.
  const textures: Texture[] = [];
  let textureFadeStart: number | null = null;
  const loader = new TextureLoader();
  const loadTexture = (url: string): Promise<Texture> =>
    loader.loadAsync(url).then((texture) => {
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      textures.push(texture);
      return texture;
    });
  Promise.all([loadTexture('./textures/earth-day.jpg'), loadTexture('./textures/earth-night.jpg')])
    .then(([day, night]) => {
      earthUniforms.uDayMap.value = day;
      earthUniforms.uNightMap.value = night;
      textureFadeStart = performance.now();
    })
    .catch((error: unknown) => {
      // Not fatal: the globe simply stays untextured.
      console.warn('Orbit Now could not load the Earth imagery:', error);
    });

  // --- Camera control ------------------------------------------------------
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.15;
  controls.maxDistance = 40;
  controls.autoRotate = options.autoRotate;
  controls.autoRotateSpeed = 0.35;

  // Start on the daylit side, turned far enough that the day/night line is in
  // view, and slightly north of the equator.
  const sunScene = equatorialToScene(sunDirection(options.nowMs()), new Vector3());
  camera.position
    .copy(sunScene)
    .setY(0)
    .normalize()
    .applyAxisAngle(new Vector3(0, 1, 0), 0.9)
    .setY(0.35)
    .normalize();

  // Until the viewer zooms or rotates, keep the whole globe framed when the
  // window changes shape. After that, respect the viewer's chosen distance.
  let viewerHasInteracted = false;
  const onInteractionStart = (): void => {
    viewerHasInteracted = true;
    controls.autoRotate = false;
  };
  controls.addEventListener('start', onInteractionStart);

  let pixelRatio = 1;
  const applySize = (): void => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(pixelRatio);
    // `false`: do not let three.js overwrite the canvas's CSS size.
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!viewerHasInteracted) {
      camera.position.setLength(fitSphereDistance(1, VERTICAL_FOV_DEG, camera.aspect, FIT_MARGIN));
    }
  };
  applySize();
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(canvas);

  // --- Render loop ---------------------------------------------------------
  const layers: SceneLayer[] = [];
  const sunView = new Vector3();
  let frameRequest = 0;
  let running = false;
  let firstFramePending = true;

  const renderFrame = (): void => {
    frameRequest = window.requestAnimationFrame(renderFrame);
    const nowMs = options.nowMs();

    earthGroup.rotation.y = gmstRadians(nowMs);
    controls.update();
    camera.updateMatrixWorld();

    // The shader works in camera space, so the Sun's direction is converted
    // into it here, once per frame, instead of once per pixel.
    equatorialToScene(sunDirection(nowMs), sunView).transformDirection(camera.matrixWorldInverse);
    earthUniforms.uSunDirectionView.value.copy(sunView);

    if (textureFadeStart !== null) {
      const progress = Math.min(1, (performance.now() - textureFadeStart) / TEXTURE_FADE_MS);
      earthUniforms.uTextureMix.value = progress;
      graticuleMaterial.opacity = 0.35 - 0.23 * progress;
      if (progress === 1) {
        textureFadeStart = null;
      }
    }

    for (const layer of layers) {
      layer.update(nowMs, pixelRatio);
    }
    renderer.render(scene, camera);

    if (firstFramePending) {
      firstFramePending = false;
      options.onFirstFrame();
    }
    options.onFrame?.();
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
    addLayer(layer: SceneLayer): void {
      layers.push(layer);
      scene.add(layer.object);
    },
    describeRenderer(): string {
      const gl = renderer.getContext();
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const name: unknown =
        info === null
          ? gl.getParameter(gl.RENDERER)
          : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
      const size = `${String(renderer.domElement.width)}×${String(renderer.domElement.height)} px`;
      return `${typeof name === 'string' ? name : 'unknown GPU'} · ${size}`;
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
      for (const texture of textures) {
        texture.dispose();
      }
      renderer.dispose();
    },
  };
}
