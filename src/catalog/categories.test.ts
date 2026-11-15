import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOf, OTHER_CATEGORY } from './categories';

const idOf = (name: string, sources: readonly string[] = ['active']): string =>
  CATEGORIES[categoryOf(name, sources)]?.id ?? 'missing';

describe('categoryOf', () => {
  // Every name below was copied from the published catalog of 2026-11-15.
  it('recognises constellations by the published name', () => {
    expect(idOf('STARLINK-1008')).toBe('starlink');
    expect(idOf('ONEWEB-0012')).toBe('oneweb');
    expect(idOf('KUIPER-00008')).toBe('kuiper');
    expect(idOf('QIANFAN-1')).toBe('qianfan');
    expect(idOf('HULIANWANG DIGUI-01')).toBe('hulianwang');
    expect(idOf('HULIANWANG JISHU SHIYAN 1A')).toBe('hulianwang');
  });

  it('recognises the navigation systems', () => {
    expect(idOf('NAVSTAR 43 (USA 132)')).toBe('gps');
    expect(idOf('COSMOS 2433 [GLONASS-M]')).toBe('glonass');
    expect(idOf('GSAT0101 (GALILEO-PFM)')).toBe('galileo');
    expect(idOf('BEIDOU-2 IGSO-1')).toBe('beidou');
    expect(idOf('QZS-2 (MICHIBIKI-2)')).toBe('qzss');
    expect(idOf('IRNSS-1A')).toBe('navic');
    expect(idOf('NVS-01 (IRNSS-1J)')).toBe('navic');
  });

  it('recognises space station modules, and nothing that merely contains "ISS"', () => {
    expect(idOf('ISS (ZARYA)')).toBe('stations');
    expect(idOf('CSS (TIANHE)')).toBe('stations');
    expect(idOf('SWISSCUBE')).toBe('other');
    expect(idOf('AISSAT 4')).toBe('other');
    expect(idOf('ISS OBJECT YM')).toBe('other');
  });

  it('does not mistake similarly named satellites for members', () => {
    // Indian communications satellites, not Galileo ("GSAT0101 (GALILEO-PFM)").
    expect(idOf('GSAT-8')).toBe('other');
    // An ordinary Cosmos satellite, not GLONASS.
    expect(idOf('COSMOS 2251')).toBe('other');
  });

  it('puts debris-group membership ahead of the name', () => {
    expect(idOf('FENGYUN 1C DEB', ['fengyun-1c-debris'])).toBe('fengyun-1c-debris');
    expect(idOf('IRIDIUM 33', ['iridium-33-debris'])).toBe('iridium-33-debris');
    expect(idOf('COSMOS 2251 DEB', ['cosmos-2251-debris'])).toBe('cosmos-2251-debris');
    // The name alone is not evidence of being in the group.
    expect(idOf('FENGYUN 1C DEB', ['active'])).toBe('other');
  });

  it('falls back to the catch-all category', () => {
    expect(categoryOf('SOMETHING ELSE', [])).toBe(OTHER_CATEGORY);
    expect(CATEGORIES[OTHER_CATEGORY]?.id).toBe('other');
  });
});
