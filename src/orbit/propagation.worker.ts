/**
 * Background thread that runs SGP4, so that propagating thousands of
 * objects never makes the page stutter.
 *
 * Messages in:
 *   { type: 'init', records }        prepare SGP4 for a catalog
 *   { type: 'propagate', id, unixMs } compute all states at one instant
 * Messages out:
 *   { type: 'ready', count }
 *   { type: 'keyframe', id, unixMs, positions, velocities, failures }
 *
 * The result arrays are transferred, not copied: ownership of their memory
 * moves to the main thread at no cost.
 */
import type { CatalogRecord } from '../catalog/format';
import { buildPropagationSet, propagateAll, type PropagationSet } from './propagate';

export type WorkerRequest =
  | { readonly type: 'init'; readonly records: readonly CatalogRecord[] }
  | { readonly type: 'propagate'; readonly id: number; readonly unixMs: number };

export type WorkerResponse =
  | { readonly type: 'ready'; readonly count: number }
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
    scope.postMessage({ type: 'ready', count: set.satrecs.length }, []);
    return;
  }
  if (set === null) {
    throw new Error('The propagation worker was asked for a keyframe before it was initialised');
  }
  const positions = new Float32Array(set.satrecs.length * 3);
  const velocities = new Float32Array(set.satrecs.length * 3);
  const failures = propagateAll(set, request.unixMs, positions, velocities);
  scope.postMessage(
    { type: 'keyframe', id: request.id, unixMs: request.unixMs, positions, velocities, failures },
    [positions.buffer, velocities.buffer],
  );
};
