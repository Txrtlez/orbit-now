import {
  OBJECT_DIMMED,
  OBJECT_EMPHASISED,
  OBJECT_HIDDEN,
  OBJECT_NORMAL,
} from '../render/satelliteLayer';

export interface DisplayStateInput {
  /** Number of objects. */
  readonly count: number;
  /** For each object, non-zero if it passes the current filters. Null if no filter is active. */
  readonly passesFilter: Uint8Array | null;
  /** Position of the selected object, or -1. */
  readonly selected: number;
  /** Positions of the objects to make stand out, or null for none. */
  readonly highlighted: readonly number[] | null;
}

/**
 * Decide how every object should be drawn, from the filters and the
 * selection together.
 *
 * - An object that fails the filters is hidden.
 * - With a highlight active, the highlighted objects are drawn normally and
 *   everything else that is visible is dimmed. Dimming the rest, instead of
 *   enlarging the highlighted ones, keeps a constellation of thousands from
 *   turning into a solid mass.
 * - The selected object is always drawn, emphasised, even if the filters
 *   would hide it: making a selection disappear would be confusing.
 *
 * @param out receives one state per object
 */
export function composeDisplayStates(input: DisplayStateInput, out: Uint8Array): void {
  const { count, passesFilter, selected, highlighted } = input;
  const filterLength = passesFilter === null ? count : passesFilter.length;
  if (out.length !== count || filterLength !== count) {
    throw new RangeError('State arrays must hold exactly one entry per object');
  }
  const base = highlighted === null ? OBJECT_NORMAL : OBJECT_DIMMED;
  for (let i = 0; i < count; i += 1) {
    // With no filter active the lookup yields undefined, which is not 0: shown.
    out[i] = passesFilter?.[i] !== 0 ? base : OBJECT_HIDDEN;
  }
  if (highlighted !== null) {
    for (const index of highlighted) {
      if (out[index] === OBJECT_DIMMED) {
        out[index] = OBJECT_NORMAL;
      }
    }
  }
  if (selected >= 0 && selected < count) {
    out[selected] = OBJECT_EMPHASISED;
  }
}
