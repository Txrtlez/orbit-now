import { describe, expect, it } from 'vitest';
import { NO_FILTERS } from './filters';
import { decodeView, DEFAULT_VIEW, encodeView, isDefaultView, type SharedView } from './shareLink';

const FULL: SharedView = {
  mode: 'whatif',
  object: 25544,
  filters: {
    groups: new Set(['starlink', 'fengyun-1c-debris']),
    regimes: new Set(['LEO', 'GEO'] as const),
    types: new Set(['PAY', 'R/B']),
    owner: 'US',
    yearFrom: 2019,
    yearTo: null,
  },
  timeMs: 1_794_800_000_000,
  scenario: {
    preset: 'selected-object',
    sun: 'active',
    run: 3,
    event: 'collision',
    massKg: 3000,
    otherMassKg: 0.5,
    crossingDegrees: 60,
  },
};

describe('shareable links', () => {
  it('writes nothing for the view the site opens with', () => {
    expect(encodeView(DEFAULT_VIEW)).toBe('');
    expect(isDefaultView(decodeView(''))).toBe(true);
    expect(isDefaultView(decodeView('#'))).toBe(true);
    expect(decodeView('').filters).toEqual(NO_FILTERS);
  });

  it('brings back everything it wrote', () => {
    const text = encodeView(FULL);
    expect(decodeView(text)).toEqual(FULL);
    expect(decodeView(`#${text}`)).toEqual(FULL);
    // The same view always gives the same link, whatever order things were chosen in.
    const reordered = {
      ...FULL,
      filters: { ...FULL.filters, groups: new Set(['fengyun-1c-debris', 'starlink']) },
    };
    expect(encodeView(reordered)).toBe(text);
  });

  it('is readable, and uses only characters that are safe in an address', () => {
    expect(encodeView({ ...DEFAULT_VIEW, object: 25544 })).toBe('o=25544');
    expect(encodeView(FULL)).toMatch(/^[A-Za-z0-9=&./-]+$/);
    expect(encodeView(FULL)).toContain('y=2019-');
  });

  it('keeps the scenario only in "What if?" mode, and a run only if there was one', () => {
    const text = encodeView({ ...FULL, mode: 'now' });
    expect(text).not.toContain('s=');
    expect(decodeView(text).scenario).toBeNull();
    const unrun = encodeView({ ...FULL, scenario: { ...FULL.scenario, run: 0 } as never });
    expect(unrun).not.toContain('run=');
    expect(decodeView(unrun).scenario?.run).toBe(0);
  });

  it('ignores what it does not understand instead of failing', () => {
    const view = decodeView(
      '#o=abc&g=starlink.<script>.ok-id&r=LEO.MARS&y=1900-20261&t=-5&m=whatif&s=two satellites&zzz=1&broken&%E0%A4%A=1&mass=1e9',
    );
    expect(view.object).toBeNull();
    expect([...view.filters.groups]).toEqual(['starlink', 'ok-id']);
    expect([...view.filters.regimes]).toEqual(['LEO']);
    expect(view.filters.yearFrom).toBeNull();
    expect(view.filters.yearTo).toBeNull();
    expect(view.timeMs).toBeNull();
    expect(view.mode).toBe('whatif');
    expect(view.scenario).toBeNull();
  });

  it('reads an escaped address the same as a plain one', () => {
    expect(decodeView('#k=R%2FB.PAY').filters.types).toEqual(new Set(['R/B', 'PAY']));
  });
});
