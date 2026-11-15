import { describe, expect, it } from 'vitest';
import { createClock, describeClock, describeOffset, TIME_SPAN_MS } from './clock';

const START = Date.UTC(2026, 10, 15, 15, 0, 0);

/** A clock whose "real time" the test moves by hand. */
function testClock(): { clock: ReturnType<typeof createClock>; advance: (ms: number) => void } {
  let wall = START;
  return {
    clock: createClock(() => wall),
    advance: (ms) => {
      wall += ms;
    },
  };
}

describe('createClock', () => {
  it('starts as the real time and follows it', () => {
    const { clock, advance } = testClock();
    expect(clock.now()).toBe(START);
    expect(clock.isLive()).toBe(true);
    advance(12_345);
    expect(clock.now()).toBe(START + 12_345);
    expect(clock.offsetMs()).toBe(0);
    expect(clock.rate()).toBe(1);
  });

  it('stands still while paused and carries on from the same instant', () => {
    const { clock, advance } = testClock();
    advance(1000);
    clock.setPlaying(false);
    advance(60_000);
    expect(clock.now()).toBe(START + 1000);
    expect(clock.rate()).toBe(0);
    expect(clock.isLive()).toBe(false);
    expect(clock.offsetMs()).toBe(-60_000);
    clock.setPlaying(true);
    advance(500);
    expect(clock.now()).toBe(START + 1500);
  });

  it('runs faster without jumping when the speed changes', () => {
    const { clock, advance } = testClock();
    advance(2000);
    clock.setSpeed(60);
    expect(clock.now()).toBe(START + 2000);
    advance(1000);
    expect(clock.now()).toBe(START + 2000 + 60_000);
    clock.setSpeed(10);
    advance(1000);
    expect(clock.now()).toBe(START + 2000 + 60_000 + 10_000);
    expect(clock.isLive()).toBe(false);
  });

  it('remembers the chosen speed while paused', () => {
    const { clock, advance } = testClock();
    clock.setPlaying(false);
    clock.setSpeed(600);
    expect(clock.rate()).toBe(0);
    expect(clock.speed()).toBe(600);
    advance(1000);
    expect(clock.now()).toBe(START);
    clock.setPlaying(true);
    advance(1000);
    expect(clock.now()).toBe(START + 600_000);
  });

  it('ignores a speed that is not positive', () => {
    const { clock } = testClock();
    clock.setSpeed(0);
    clock.setSpeed(-5);
    clock.setSpeed(Number.NaN);
    expect(clock.speed()).toBe(1);
  });

  it('jumps to a chosen time and keeps playing from there', () => {
    const { clock, advance } = testClock();
    clock.setTime(START + 7_200_000);
    expect(clock.now()).toBe(START + 7_200_000);
    expect(clock.offsetMs()).toBe(7_200_000);
    advance(1000);
    expect(clock.now()).toBe(START + 7_201_000);
    expect(clock.isLive()).toBe(false);
  });

  it('will not be moved more than three days from the present', () => {
    const { clock } = testClock();
    clock.setTime(START + 10 * 86_400_000);
    expect(clock.now()).toBe(START + TIME_SPAN_MS);
    clock.setTime(START - 10 * 86_400_000);
    expect(clock.now()).toBe(START - TIME_SPAN_MS);
  });

  it('stops when fast-forward reaches the limit', () => {
    const { clock, advance } = testClock();
    clock.setSpeed(600);
    advance(60_000); // 10 hours of simulated time
    expect(clock.enforceLimits()).toBe(false);
    advance(10 * 60_000); // far beyond three days ahead
    expect(clock.enforceLimits()).toBe(true);
    expect(clock.playing()).toBe(false);
    // Three days ahead of the real time at the moment it was stopped.
    expect(clock.offsetMs()).toBe(TIME_SPAN_MS);
  });

  it('is eventually stopped when paused in the past for long enough to fall out of range', () => {
    const { clock, advance } = testClock();
    clock.setTime(START - TIME_SPAN_MS + 60_000);
    clock.setPlaying(false);
    advance(120_000);
    expect(clock.enforceLimits()).toBe(true);
    expect(clock.offsetMs()).toBe(-TIME_SPAN_MS);
  });

  it('returns to the present at normal speed', () => {
    const { clock, advance } = testClock();
    clock.setSpeed(600);
    clock.setPlaying(false);
    clock.setTime(START - 3_600_000);
    advance(5000);
    clock.goLive();
    expect(clock.now()).toBe(START + 5000);
    expect(clock.isLive()).toBe(true);
    expect(clock.speed()).toBe(1);
  });

  it('tells subscribers about every change, and only about changes', () => {
    const { clock, advance } = testClock();
    let calls = 0;
    const unsubscribe = clock.subscribe(() => {
      calls += 1;
    });
    advance(1000);
    expect(calls).toBe(0);
    clock.setPlaying(true); // already playing
    clock.setSpeed(1); // already 1
    expect(calls).toBe(0);
    clock.setPlaying(false);
    clock.setSpeed(10);
    clock.setTime(START);
    clock.goLive();
    expect(calls).toBe(4);
    unsubscribe();
    clock.setPlaying(false);
    expect(calls).toBe(4);
  });
});

describe('describeOffset', () => {
  it('says nothing within half a second of the present', () => {
    expect(describeOffset(0)).toBe('');
    expect(describeOffset(400)).toBe('');
    expect(describeOffset(-400)).toBe('');
  });

  it('uses seconds below a minute', () => {
    expect(describeOffset(12_300)).toBe('12 s ahead');
    expect(describeOffset(-59_400)).toBe('59 s behind');
  });

  it('uses the two largest units and says which way', () => {
    expect(describeOffset(5 * 60_000)).toBe('5 min ahead');
    expect(describeOffset(-125 * 60_000)).toBe('2 h 5 min behind');
    expect(describeOffset(120 * 60_000)).toBe('2 h ahead');
    expect(describeOffset((27 * 60 + 12) * 60_000)).toBe('1 d 3 h ahead');
    expect(describeOffset(-TIME_SPAN_MS)).toBe('3 d behind');
  });
});

describe('describeClock', () => {
  it('describes each state in one line', () => {
    const { clock, advance } = testClock();
    expect(describeClock(clock)).toBe('Live');
    clock.setPlaying(false);
    expect(describeClock(clock)).toBe('Paused');
    advance(90_000);
    expect(describeClock(clock)).toBe('Paused \u00b7 2 min behind');
    clock.setPlaying(true);
    expect(describeClock(clock)).toBe('2 min behind');
    clock.setSpeed(60);
    advance(5000);
    expect(describeClock(clock)).toBe('60\u00d7 speed \u00b7 3 min ahead');
    clock.goLive();
    expect(describeClock(clock)).toBe('Live');
  });
});
