import { describe, expect, it } from 'vitest';
import { summariseFrameTimes } from './stats';

describe('summariseFrameTimes', () => {
  it('reports 60 fps for steady 16.67 ms frames', () => {
    const summary = summariseFrameTimes(new Array<number>(300).fill(1000 / 60));
    expect(summary?.averageFps).toBeCloseTo(60, 6);
    expect(summary?.onePercentLowFps).toBeCloseTo(60, 6);
    expect(summary?.worstFrameMs).toBeCloseTo(16.6667, 3);
  });

  it('exposes stutter that the average hides', () => {
    // 297 smooth frames and 3 long ones of 100 ms.
    const frames = [...new Array<number>(297).fill(1000 / 60), 100, 100, 100];
    const summary = summariseFrameTimes(frames);
    expect(summary?.averageFps).toBeGreaterThan(55);
    expect(summary?.onePercentLowFps).toBeCloseTo(10, 6); // the slowest 1% are the three 100 ms frames
    expect(summary?.worstFrameMs).toBe(100);
  });

  it('uses at least one frame for the slowest 1%', () => {
    expect(summariseFrameTimes([20, 40])?.onePercentLowFps).toBeCloseTo(25, 6);
  });

  it('returns null when there is nothing to summarise', () => {
    expect(summariseFrameTimes([])).toBeNull();
  });
});
