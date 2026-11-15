import { describe, expect, it } from 'vitest';
import {
  OBJECT_DIMMED,
  OBJECT_EMPHASISED,
  OBJECT_HIDDEN,
  OBJECT_NORMAL,
} from '../render/satelliteLayer';
import { composeDisplayStates } from './displayStates';

function compose(
  passesFilter: number[] | null,
  selected: number,
  highlighted: number[] | null,
  count = 5,
): number[] {
  const out = new Uint8Array(count);
  composeDisplayStates(
    {
      count,
      passesFilter: passesFilter === null ? null : new Uint8Array(passesFilter),
      selected,
      highlighted,
    },
    out,
  );
  return [...out];
}

const H = OBJECT_HIDDEN;
const D = OBJECT_DIMMED;
const N = OBJECT_NORMAL;
const E = OBJECT_EMPHASISED;

describe('composeDisplayStates', () => {
  it('draws everything normally when nothing is filtered or selected', () => {
    expect(compose(null, -1, null)).toEqual([N, N, N, N, N]);
  });

  it('hides objects that fail the filters', () => {
    expect(compose([1, 0, 1, 0, 1], -1, null)).toEqual([N, H, N, H, N]);
  });

  it('emphasises the selection without dimming anything else', () => {
    expect(compose(null, 2, null)).toEqual([N, N, E, N, N]);
  });

  it('draws highlighted objects normally and dims the rest', () => {
    expect(compose(null, 0, [1, 3])).toEqual([E, N, D, N, D]);
  });

  it('never un-hides a highlighted object that the filters hide', () => {
    expect(compose([1, 0, 1, 1, 1], 0, [1, 3])).toEqual([E, H, D, N, D]);
  });

  it('keeps the selected object visible even when the filters would hide it', () => {
    expect(compose([0, 0, 0, 0, 0], 4, null)).toEqual([H, H, H, H, E]);
  });

  it('rejects arrays of the wrong length', () => {
    expect(() => {
      composeDisplayStates(
        { count: 3, passesFilter: null, selected: -1, highlighted: null },
        new Uint8Array(2),
      );
    }).toThrow(RangeError);
  });
});
