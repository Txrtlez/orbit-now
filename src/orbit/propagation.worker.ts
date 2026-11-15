/**
 * Background thread that runs SGP4, so that propagating thousands of
 * objects never makes the page stutter.
 *
 * Messages in:
 *   { type: 'init', records }                    prepare SGP4 for a catalog
 *   { type: 'propagate', id, unixMs }            compute all states at one instant
 *   { type: 'orbit', id, index, unixMs, segments } compute one object's path over a revolution
 *   { type: 'passes', id, indices, latitudeRad, longitudeRad, fromMs, toMs }
 *                                                find several objects' passes over a place
 * Messages out:
 *   { type: 'ready', count, periodMinutes, apogeeKm, perigeeKm }
 *   { type: 'keyframe', id, unixMs, positions, velocities, failures }
 *   { type: 'orbit', id, points }
 *   { type: 'passes', id, passes }
 *
 * The result arrays are transferred, not copied: ownership of their memory
 * moves to the main thread at no cost.
 */
import { sgp4 } from 'satellite.js';
import type { CatalogRecord } from '../catalog/format';
import { createObserver } from '../geo/topocentric';
import { predictPasses, type Pass } from '../passes/predict';
import {
  buildPropagationSet,
  propagateAll,
  sampleOrbitPath,
  summariseOrbits,
  type PropagationSet,
} from './propagate';

export type WorkerRequest =
  | { readonly type: 'init'; readonly records: readonly CatalogRecord[] }
  | { readonly type: 'propagate'; readonly id: number; readonly unixMs: number }
  | {
      readonly type: 'orbit';
      readonly id: number;
      readonly index: number;
      readonly unixMs: number;
      readonly segments: number;
    }
  | {
      readonly type: 'passes';
      readonly id: number;
      /** Positions in the catalog of the objects wanted. */
      readonly indices: readonly number[];
      /** The observer's geodetic latitude and longitude, radians. */
      readonly latitudeRad: number;
      readonly longitudeRad: number;
      readonly fromMs: number;
      readonly toMs: number;
    };

export type WorkerResponse =
  | {
      readonly type: 'ready';
      readonly count: number;
      readonly periodMinutes: Float32Array;
      readonly apogeeKm: Float32Array;
      readonly perigeeKm: Float32Array;
    }
  | { readonly type: 'orbit'; readonly id: number; readonly points: Float32Array }
  | {
      readonly type: 'passes';
      readonly id: number;
      /** One list of passes per object asked for, in the same order. */
      readonly passes: readonly (readonly Pass[])[];
    }
  | {
      readonly type: 'keyframe';
      readonly id: number;
      readonly unixMs: number;
      readonly positions: Float32Array;
      readonly velocities: Float32Array;
      readonly failures: number;
    };

/** The parts of the worker's global scope used here (the page's type definitions describe a window, not a worker). */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
}
const scope = self as unknown as WorkerScope;

let set: PropagationSet | null = null;

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'init') {
    set = buildPropagationSet(request.records);
    const { periodMinutes, apogeeKm, perigeeKm } = summariseOrbits(set);
    scope.postMessage(
      { type: 'ready', count: set.satrecs.length, periodMinutes, apogeeKm, perigeeKm },
      [periodMinutes.buffer, apogeeKm.buffer, perigeeKm.buffer],
    );
    return;
  }
  if (set === null) {
    throw new Error('The propagation worker was asked for results before it was initialised');
  }
  if (request.type === 'orbit') {
    const points = sampleOrbitPath(set, request.index, request.unixMs, request.segments);
    scope.postMessage({ type: 'orbit', id: request.id, points }, [points.buffer]);
    return;
  }
  if (request.type === 'passes') {
    const propagationSet = set;
    // SIMPLIFICATION: the observer is placed on the ellipsoid, at height
    // zero. A kilometre of height changes a pass time by well under a second.
    const observer = createObserver(request.latitudeRad, request.longitudeRad, 0);
    const passes = request.indices.map((index) => {
      const satrec = propagationSet.satrecs[index];
      const epochMs = propagationSet.epochMs[index] ?? 0;
      return satrec === undefined
        ? []
        : predictPasses(
            (unixMs) => sgp4(satrec, (unixMs - epochMs) / 60_000)?.position ?? null,
            observer,
            request.fromMs,
            request.toMs,
          );
    });
    scope.postMessage({ type: 'passes', id: request.id, passes }, []);
    return;
  }
  const positions = new Float32Array(set.satrecs.length * 3);
  const velocities = new Float32Array(set.satrecs.length * 3);
  const failures = propagateAll(set, request.unixMs, positions, velocities);
  scope.postMessage(
    { type: 'keyframe', id: request.id, unixMs: request.unixMs, positions, velocities, failures },
    [positions.buffer, velocities.buffer],
  );
};
