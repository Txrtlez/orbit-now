import type { CatalogRecord } from '../catalog/format';
import type { OrbitSummary } from './propagate';
import type { WorkerRequest, WorkerResponse } from './propagation.worker';

/** Every object's state at one instant, in scene coordinates. */
export interface Keyframe {
  /** The instant, in milliseconds since 1970-01-01 UTC. */
  readonly unixMs: number;
  /** x, y, z per object, in scene units. (0, 0, 0) marks an object that could not be propagated. */
  readonly positions: Float32Array;
  /** x, y, z per object, in scene units per second. */
  readonly velocities: Float32Array;
  /** How many objects could not be propagated. */
  readonly failures: number;
}

export interface PropagationClient {
  /** Period and highest and lowest altitude of every orbit, in catalog order. */
  readonly orbits: OrbitSummary;
  /** Ask the background thread for all states at `unixMs`. */
  requestKeyframe(unixMs: number): Promise<Keyframe>;
  /**
   * Ask the background thread for the path of one object over a single
   * revolution centred on `unixMs`: x, y, z per point in scene coordinates.
   * The result is empty if the object cannot be propagated that far.
   */
  requestOrbitPath(index: number, unixMs: number, segments: number): Promise<Float32Array>;
  /** Stop the background thread. Pending requests never resolve. */
  dispose(): void;
}

/** Start the background propagation thread for a catalog. Resolves once SGP4 is prepared for every object. */
export function startPropagation(records: readonly CatalogRecord[]): Promise<PropagationClient> {
  const worker = new Worker(new URL('./propagation.worker.ts', import.meta.url), {
    type: 'module',
  });
  const send = (request: WorkerRequest): void => {
    worker.postMessage(request);
  };

  return new Promise((resolve, reject) => {
    const pendingKeyframes = new Map<number, (keyframe: Keyframe) => void>();
    const pendingOrbits = new Map<number, (points: Float32Array) => void>();
    let nextId = 1;

    worker.onerror = (event) => {
      reject(new Error(`The propagation worker failed: ${event.message}`));
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.type === 'ready') {
        const { periodMinutes, apogeeKm, perigeeKm } = response;
        resolve({
          orbits: { periodMinutes, apogeeKm, perigeeKm },
          requestKeyframe: (unixMs) =>
            new Promise((resolveKeyframe) => {
              const id = nextId;
              nextId += 1;
              pendingKeyframes.set(id, resolveKeyframe);
              send({ type: 'propagate', id, unixMs });
            }),
          requestOrbitPath: (index, unixMs, segments) =>
            new Promise((resolveOrbit) => {
              const id = nextId;
              nextId += 1;
              pendingOrbits.set(id, resolveOrbit);
              send({ type: 'orbit', id, index, unixMs, segments });
            }),
          dispose: () => {
            worker.terminate();
            pendingKeyframes.clear();
            pendingOrbits.clear();
          },
        });
        return;
      }
      if (response.type === 'orbit') {
        pendingOrbits.get(response.id)?.(response.points);
        pendingOrbits.delete(response.id);
        return;
      }
      const { id, unixMs, positions, velocities, failures } = response;
      pendingKeyframes.get(id)?.({ unixMs, positions, velocities, failures });
      pendingKeyframes.delete(id);
    };
    send({ type: 'init', records });
  });
}
