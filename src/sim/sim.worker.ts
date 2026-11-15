/// <reference lib="webworker" />
import {
  runSimulation,
  type SimFragment,
  type SimulationRequest,
  type SimulationResult,
  type TrialSummary,
} from './simulate';

/**
 * The simulation runs here, on a background thread, so that the page and
 * the globe stay responsive while it works.
 */

export interface RunMessage {
  readonly type: 'run';
  /** Echoed on every reply, so that replies to a superseded run can be ignored. */
  readonly id: number;
  readonly request: SimulationRequest;
}

export type SimReply =
  | {
      readonly type: 'trial';
      readonly id: number;
      readonly done: number;
      readonly total: number;
      readonly summary: TrialSummary;
      /** The fragments, for the first repetition only. */
      readonly fragments: readonly SimFragment[] | null;
    }
  | {
      readonly type: 'done';
      readonly id: number;
      readonly result: Omit<SimulationResult, 'display'>;
    }
  | { readonly type: 'failed'; readonly id: number; readonly message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<RunMessage>) => {
  const { id, request } = event.data;
  const reply = (message: SimReply): void => {
    scope.postMessage(message);
  };
  try {
    const total = Math.max(1, Math.round(request.trials));
    const result = runSimulation(request, (index, summary, fragments) => {
      reply({
        type: 'trial',
        id,
        done: index + 1,
        total,
        summary,
        fragments: index === 0 ? fragments : null,
      });
    });
    reply({
      type: 'done',
      id,
      result: {
        collision: result.collision,
        trials: result.trials,
        backgroundByBand: result.backgroundByBand,
      },
    });
  } catch (error: unknown) {
    reply({ type: 'failed', id, message: error instanceof Error ? error.message : String(error) });
  }
});
