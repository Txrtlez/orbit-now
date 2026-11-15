import { describe, expect, it } from 'vitest';
import { colourOfGroup, coloursForObjects, cssColourOfGroup } from './palette';

describe('palette', () => {
  it('gives each known group its own colour and unknown groups a neutral one', () => {
    const known = ['active', 'fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris'];
    const colours = known.map((id) => colourOfGroup(id).join(','));
    expect(new Set(colours).size).toBe(4);
    expect(colourOfGroup('something-new')).toEqual([150, 160, 175]);
    expect(cssColourOfGroup('fengyun-1c-debris')).toBe('rgb(230 159 0)');
  });

  it('colours each object by its group, three bytes per object', () => {
    const groups = ['iridium-33-debris', 'active'];
    const colours = coloursForObjects([0b10, 0b01, 0b00], groups);
    expect(Array.from(colours)).toEqual([
      ...colourOfGroup('active'),
      ...colourOfGroup('iridium-33-debris'),
      150,
      160,
      175, // belongs to no group
    ]);
  });

  it('lets a debris group take precedence over "active" when an object is in both', () => {
    const groups = ['active', 'cosmos-2251-debris'];
    expect(Array.from(coloursForObjects([0b11], groups))).toEqual([
      ...colourOfGroup('cosmos-2251-debris'),
    ]);
  });
});
