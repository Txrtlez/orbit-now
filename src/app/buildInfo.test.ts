import { describe, expect, it } from 'vitest';
import { describeBuild } from './buildInfo';

describe('describeBuild', () => {
  it('shortens the commit hash and formats the time in UTC', () => {
    expect(
      describeBuild('0123456789abcdef0123456789abcdef01234567', '2026-11-14T20:01:42.123Z'),
    ).toBe('Build 0123456 · 2026-11-14 20:01 UTC');
  });

  it('converts times with an offset to UTC', () => {
    expect(describeBuild('abcdef0', '2026-11-14T20:01:00-05:00')).toBe(
      'Build abcdef0 · 2026-11-15 01:01 UTC',
    );
  });

  it('does not present a non-hash value as a revision', () => {
    expect(describeBuild('unknown', '2026-11-14T20:01:00Z')).toBe(
      'Build unknown revision · 2026-11-14 20:01 UTC',
    );
    expect(describeBuild('', '2026-11-14T20:01:00Z')).toBe(
      'Build unknown revision · 2026-11-14 20:01 UTC',
    );
  });

  it('omits the time when it cannot be parsed', () => {
    expect(describeBuild('abcdef0', 'not a date')).toBe('Build abcdef0');
  });
});
