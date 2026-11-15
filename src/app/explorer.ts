import { relatedObjects, type ObjectIndex, type RelatedObjects } from '../catalog/objectIndex';
import type { PropagationClient } from '../orbit/propagationClient';
import type { Globe, PointerKind } from '../render/globe';
import type { OrbitPathLayer } from '../render/orbitPathLayer';
import { pickObject, projectToScreen, segmentHitsSphere } from '../render/picking';
import { OBJECT_HIDDEN, type SatelliteLayer } from '../render/satelliteLayer';
import type { SelectionMarker } from '../render/selectionMarker';
import { composeDisplayStates } from './displayStates';
import { liveStateFromScene } from './liveState';
import { describeObject } from './objectFacts';
import { createObjectPanel } from './objectPanel';

/** How close to an object a tap or click must land, in CSS pixels, by kind of pointer. */
const PICK_RADIUS_PX: Readonly<Record<PointerKind, number>> = {
  mouse: 9,
  pen: 12,
  // A fingertip covers far more of the screen than a mouse pointer does.
  touch: 22,
};
/** How close the mouse must be for an object's name to appear, in CSS pixels. */
const HOVER_RADIUS_PX = 7;
/** Number of straight segments in a drawn orbit. */
const ORBIT_SEGMENTS = 512;
/** How often the altitude, speed and ground position are refreshed. */
const LIVE_UPDATE_MS = 250;
/** The drawn orbit is recomputed when the clock has moved this far from when it was made. */
const ORBIT_REFRESH_MS = 5 * 60_000;
/**
 * Radius of the sphere treated as hiding what is behind it, in Earth radii.
 * Slightly under 1 so that an object skimming the horizon of the flattened
 * Earth is not wrongly reported as hidden near the poles.
 */
const OCCLUDER_RADIUS = 0.996;

export interface ExplorerOptions {
  readonly globe: Globe;
  readonly layer: SatelliteLayer;
  readonly marker: SelectionMarker;
  readonly orbitPath: OrbitPathLayer;
  readonly client: PropagationClient;
  readonly objects: ObjectIndex;
  /** CSS colour of each object's dot, by position. */
  readonly colourOf: (index: number) => string;
  /** Returns the time being displayed. */
  readonly nowMs: () => number;
  /** Whether camera moves should be instant (the viewer asked for reduced motion). */
  readonly reducedMotion: () => boolean;
  /** The element that becomes the object panel. */
  readonly panelElement: HTMLElement;
  /** The small label that follows the mouse. */
  readonly hoverLabel: HTMLElement;
  /** The view itself, for changing the mouse cursor. */
  readonly canvas: HTMLElement;
  /** Called whenever the selection changes, with the selected position or -1. */
  readonly onSelectionChange?: (index: number) => void;
}

export interface Explorer {
  /** Handle a tap or click on the view. */
  handleTap(x: number, y: number, kind: PointerKind): void;
  /** Handle the mouse moving over the view, or leaving it (null). */
  handleHover(position: { x: number; y: number } | null): void;
  /**
   * Select the object at `index`, or clear the selection with -1.
   *
   * @param centre whether to turn the camera to the object
   */
  select(index: number, centre: boolean): void;
  /** Position of the selected object, or -1. */
  selected(): number;
  /**
   * Apply the result of filtering: for each object, non-zero if it should
   * be shown. Null removes all filtering.
   */
  setFilter(passes: Uint8Array | null): void;
  /**
   * Where an object currently appears in the view, in CSS pixels, or null
   * if it is not drawn, is off-screen or is behind the Earth.
   */
  screenPositionOf(index: number): { x: number; y: number } | null;
  dispose(): void;
}

/**
 * The interactive side of the "Now" mode: picking objects, showing the
 * selected one's details, orbit and marker, and deciding how every dot is
 * drawn given the filters and the selection.
 */
export function createExplorer(options: ExplorerOptions): Explorer {
  const { globe, layer, marker, orbitPath, client, objects, nowMs } = options;
  const positions = new Float32Array(objects.count * 3);
  const states = new Uint8Array(objects.count);

  let selected = -1;
  let related: RelatedObjects | null = null;
  let highlightRelated = true;
  let passesFilter: Uint8Array | null = null;
  // Identifies the most recent orbit request, so that a late answer for a
  // previous selection is ignored.
  let orbitRequest = 0;
  let orbitComputedFor = Number.NaN;
  let liveTimer: number | undefined;
  let hoverFrame = 0;
  let pendingHover: { x: number; y: number } | null = null;

  const applyStates = (): void => {
    composeDisplayStates(
      {
        count: objects.count,
        passesFilter,
        selected,
        highlighted: selected >= 0 && highlightRelated && related !== null ? related.indices : null,
      },
      states,
    );
    layer.setStates(states);
  };

  const pickAt = (x: number, y: number, radiusPx: number): number => {
    if (!layer.positionsAt(nowMs(), positions)) {
      return -1;
    }
    const view = globe.view();
    return pickObject({
      positions,
      states: layer.states(),
      viewProjection: view.viewProjection,
      camera: view.camera,
      width: view.width,
      height: view.height,
      pointerX: x,
      pointerY: y,
      radiusPx,
      occluderRadius: OCCLUDER_RADIUS,
    });
  };

  const requestOrbit = (): void => {
    if (selected < 0) {
      return;
    }
    orbitRequest += 1;
    const request = orbitRequest;
    const at = nowMs();
    orbitComputedFor = at;
    void client.requestOrbitPath(selected, at, ORBIT_SEGMENTS).then((points) => {
      if (request === orbitRequest) {
        orbitPath.setPath(points);
      }
    });
  };

  const panel = createObjectPanel(options.panelElement, {
    onClose: () => {
      select(-1, false);
    },
    onCentre: () => {
      centreOn(selected);
    },
    onHighlightChange: (enabled) => {
      highlightRelated = enabled;
      applyStates();
    },
  });

  const updateLive = (): void => {
    if (selected < 0) {
      return;
    }
    const now = nowMs();
    const state = layer.stateAt(selected, now);
    panel.setLive(state === null ? null : liveStateFromScene(state.position, state.velocity, now));
    if (Math.abs(now - orbitComputedFor) > ORBIT_REFRESH_MS) {
      requestOrbit();
    }
  };

  function centreOn(index: number): void {
    const state = layer.stateAt(index, nowMs());
    if (state === null) {
      return;
    }
    const [x, y, z] = state.position;
    globe.flyTo({ x, y, z }, Math.hypot(x, y, z), !options.reducedMotion());
  }

  function select(index: number, centre: boolean): void {
    const next = index >= 0 && index < objects.count ? index : -1;
    if (next === selected) {
      if (centre && next >= 0) {
        centreOn(next);
      }
      return;
    }
    selected = next;
    window.clearInterval(liveTimer);
    liveTimer = undefined;
    // Any orbit still being computed belongs to the previous selection.
    orbitRequest += 1;
    orbitPath.setPath(new Float32Array(0));

    if (selected < 0) {
      related = null;
      marker.follow(null);
      panel.hide();
    } else {
      const chosen = selected;
      related = relatedObjects(objects, chosen);
      marker.follow((now) => layer.stateAt(chosen, now)?.position ?? null);
      panel.show({
        facts: describeObject(objects, chosen, nowMs()),
        colour: options.colourOf(chosen),
        related:
          related === null
            ? null
            : { count: related.indices.length, description: related.description },
        highlightRelated,
      });
      requestOrbit();
      updateLive();
      liveTimer = window.setInterval(updateLive, LIVE_UPDATE_MS);
      if (centre) {
        centreOn(chosen);
      }
    }
    applyStates();
    options.onSelectionChange?.(selected);
  }

  const showHover = (): void => {
    hoverFrame = 0;
    const label = options.hoverLabel;
    const hit =
      pendingHover === null ? -1 : pickAt(pendingHover.x, pendingHover.y, HOVER_RADIUS_PX);
    const record = objects.records[hit];
    if (pendingHover === null || record === undefined) {
      label.hidden = true;
      options.canvas.style.cursor = '';
      return;
    }
    label.textContent = record.name === '' ? `Object ${String(record.noradId)}` : record.name;
    label.style.transform = `translate(${String(Math.round(pendingHover.x + 14))}px, ${String(Math.round(pendingHover.y + 14))}px)`;
    label.hidden = false;
    options.canvas.style.cursor = 'pointer';
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    // Escape closes the object panel, unless something else (such as the
    // search suggestions) has already used the key.
    if (event.key === 'Escape' && !event.defaultPrevented && selected >= 0) {
      select(-1, false);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  return {
    handleTap(x, y, kind): void {
      // Tapping empty space clears the selection.
      select(pickAt(x, y, PICK_RADIUS_PX[kind]), false);
    },
    handleHover(position): void {
      pendingHover = position;
      // At most one pick per frame, however fast the mouse reports.
      if (hoverFrame === 0) {
        hoverFrame = window.requestAnimationFrame(showHover);
      }
    },
    select,
    selected: () => selected,
    setFilter(passes): void {
      passesFilter = passes;
      applyStates();
    },
    screenPositionOf(index): { x: number; y: number } | null {
      if (layer.states()[index] === OBJECT_HIDDEN) {
        return null;
      }
      const state = layer.stateAt(index, nowMs());
      if (state === null) {
        return null;
      }
      const [x, y, z] = state.position;
      const view = globe.view();
      const screen = projectToScreen(x, y, z, view.viewProjection, view.width, view.height);
      if (
        screen === null ||
        screen.x < 0 ||
        screen.y < 0 ||
        screen.x > view.width ||
        screen.y > view.height ||
        segmentHitsSphere(view.camera, { x, y, z }, OCCLUDER_RADIUS)
      ) {
        return null;
      }
      return { x: screen.x, y: screen.y };
    },
    dispose(): void {
      window.clearInterval(liveTimer);
      window.cancelAnimationFrame(hoverFrame);
      document.removeEventListener('keydown', onKeyDown);
    },
  };
}
