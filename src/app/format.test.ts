import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDegrees,
  formatKm,
  formatLatLon,
  formatPeriod,
  formatSpeed,
} from './format';

describe('number formatting', () => {
  it('writes counts with thousands separators', () => {
    expect(formatCount(19560)).toBe('19,560');
    expect(formatCount(7)).toBe('7');
  });

  it('writes distances to the nearest kilometre', () => {
    expect(formatKm(416.6)).toBe('417 km');
    expect(formatKm(35786.02)).toBe('35,786 km');
    expect(formatKm(-0.2)).toBe('0 km');
  });

  it('writes speeds and angles to two decimals', () => {
    expect(formatSpeed(7.6612)).toBe('7.66 km/s');
    expect(formatDegrees(51.6323)).toBe('51.63°');
  });

  it('writes short periods in minutes and long ones in hours and minutes', () => {
    expect(formatPeriod(92.94)).toBe('92.9 min');
    expect(formatPeriod(119.94)).toBe('119.9 min');
    expect(formatPeriod(120)).toBe('2 h');
    expect(formatPeriod(717.9)).toBe('11 h 58 min');
    expect(formatPeriod(1436.07)).toBe('23 h 56 min');
  });

  it('writes positions with hemisphere letters', () => {
    expect(formatLatLon(12.34, -45.67)).toBe('12.3° N, 45.7° W');
    expect(formatLatLon(-33.02, 151.2)).toBe('33.0° S, 151.2° E');
    expect(formatLatLon(0.01, -0.04)).toBe('0.0°, 0.0°');
  });
});
