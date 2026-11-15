/** Frame-rate figures over a window of recent frames. */
export interface FrameSummary {
  /** Average frames per second over the window. */
  readonly averageFps: number;
  /**
   * Frame rate corresponding to the slowest 1% of frames (at least one
   * frame). This is the number that reflects visible stutter: an average of
   * 60 can hide regular long frames.
   */
  readonly onePercentLowFps: number;
  /** Duration of the single longest frame, in milliseconds. */
  readonly worstFrameMs: number;
}

/**
 * Summarise a list of frame durations.
 *
 * @param frameTimesMs time between consecutive frames, in milliseconds
 * @returns null if no frames were recorded
 */
export function summariseFrameTimes(frameTimesMs: readonly number[]): FrameSummary | null {
  if (frameTimesMs.length === 0) {
    return null;
  }
  const total = frameTimesMs.reduce((sum, value) => sum + value, 0);
  const slowestFirst = [...frameTimesMs].sort((a, b) => b - a);
  const slowCount = Math.max(1, Math.round(frameTimesMs.length / 100));
  const slowTotal = slowestFirst.slice(0, slowCount).reduce((sum, value) => sum + value, 0);
  return {
    averageFps: (1000 * frameTimesMs.length) / total,
    onePercentLowFps: (1000 * slowCount) / slowTotal,
    worstFrameMs: slowestFirst[0] ?? 0,
  };
}

/** How many seconds of frames each reading covers. */
const WINDOW_MS = 5000;

/**
 * An on-screen frame-rate readout, shown only when the page address contains
 * `?stats`. It exists so that performance can be measured on a real phone,
 * where no developer tools are at hand.
 *
 * @returns a function to call once per rendered frame, or null if the readout is not enabled
 */
export function createFrameStats(
  container: HTMLElement,
  describeScene: () => string,
): (() => void) | null {
  if (!new URLSearchParams(window.location.search).has('stats')) {
    return null;
  }
  container.hidden = false;
  container.textContent = 'Measuring frame rate…';

  let frameTimes: number[] = [];
  let lastFrame = performance.now();
  let windowStart = lastFrame;

  return () => {
    const now = performance.now();
    frameTimes.push(now - lastFrame);
    lastFrame = now;
    if (now - windowStart < WINDOW_MS) {
      return;
    }
    const summary = summariseFrameTimes(frameTimes);
    if (summary !== null) {
      container.textContent =
        `${summary.averageFps.toFixed(0)} fps average · ` +
        `${summary.onePercentLowFps.toFixed(0)} fps in the slowest 1% · ` +
        `longest frame ${summary.worstFrameMs.toFixed(0)} ms · ${describeScene()}`;
      container.dataset.averageFps = summary.averageFps.toFixed(1);
    }
    frameTimes = [];
    windowStart = now;
  };
}
