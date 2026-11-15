/**
 * The clock the whole scene runs on.
 *
 * Normally it is simply the real time. The viewer can also pause it, run it
 * faster, or move it a few days into the past or future. Everything that
 * depends on time (where the objects are, how the Earth is turned, where
 * the Sun is) asks this clock and nothing else, so all of it stays in step.
 */

/** The playback speeds offered, in simulated seconds per real second. */
export const SPEEDS: readonly number[] = [1, 10, 60, 600];

/** How far from the present the clock may be moved, in milliseconds: three days. */
export const TIME_SPAN_MS = 3 * 86_400_000;

/** The clock counts as showing the present if it is within this many milliseconds of it. */
const LIVE_TOLERANCE_MS = 1000;

export interface SimClock {
  /** The time being shown, in milliseconds since 1970-01-01 UTC. */
  now(): number;
  /** Simulated seconds per real second right now: the chosen speed, or 0 while paused. */
  rate(): number;
  /** The chosen speed, which is kept while paused. */
  speed(): number;
  playing(): boolean;
  /** True if the clock is following the real time: playing at normal speed, at the present. */
  isLive(): boolean;
  /** The time being shown minus the real time, in milliseconds. Positive means the future. */
  offsetMs(): number;
  setPlaying(playing: boolean): void;
  /** Change the speed. Takes effect at once if playing; otherwise when play resumes. */
  setSpeed(speed: number): void;
  /**
   * Jump to a time. It is limited to `TIME_SPAN_MS` either side of the present.
   * Whether the clock is playing, and how fast, is left as it was.
   */
  setTime(unixMs: number): void;
  /** Return to the present, playing at normal speed. */
  goLive(): void;
  /**
   * Keep the clock within its limits. Call regularly while it is running:
   * if it has reached three days from the present, it is stopped there.
   *
   * @returns true if the clock had to be stopped
   */
  enforceLimits(): boolean;
  /**
   * Be told whenever the clock is paused, resumed, changes speed or jumps.
   * (It is not called as time simply passes.) Returns a function that
   * cancels the subscription.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * @param wallNow returns the real time in milliseconds since 1970-01-01 UTC.
 *                Injected so that tests can control it.
 */
export function createClock(wallNow: () => number): SimClock {
  // The time shown is anchorSim + (real time - anchorWall) * rate. Each
  // change re-anchors at the present moment, so time never jumps except
  // when asked to.
  let anchorWall = wallNow();
  let anchorSim = anchorWall;
  let speed = 1;
  let playing = true;
  const listeners = new Set<() => void>();

  const rate = (): number => (playing ? speed : 0);
  const now = (): number => anchorSim + (wallNow() - anchorWall) * rate();
  const reanchor = (simMs: number): void => {
    anchorWall = wallNow();
    anchorSim = simMs;
  };
  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  const clamp = (simMs: number): number => {
    const wall = wallNow();
    return Math.min(wall + TIME_SPAN_MS, Math.max(wall - TIME_SPAN_MS, simMs));
  };

  return {
    now,
    rate,
    speed: () => speed,
    playing: () => playing,
    offsetMs: () => now() - wallNow(),
    isLive: () => playing && speed === 1 && Math.abs(now() - wallNow()) < LIVE_TOLERANCE_MS,
    setPlaying(next: boolean): void {
      if (next === playing) {
        return;
      }
      reanchor(now());
      playing = next;
      notify();
    },
    setSpeed(next: number): void {
      if (!(next > 0) || next === speed) {
        return;
      }
      reanchor(now());
      speed = next;
      notify();
    },
    setTime(unixMs: number): void {
      reanchor(clamp(unixMs));
      notify();
    },
    goLive(): void {
      speed = 1;
      playing = true;
      reanchor(wallNow());
      notify();
    },
    enforceLimits(): boolean {
      const current = now();
      const limited = clamp(current);
      if (limited === current) {
        return false;
      }
      reanchor(limited);
      playing = false;
      notify();
      return true;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * How far the clock is from the present, in words: "12 s behind",
 * "2 h 5 min ahead", "1 d 3 h behind", or "" within half a second of the
 * present.
 */
export function describeOffset(offsetMs: number): string {
  const seconds = Math.round(Math.abs(offsetMs) / 1000);
  if (seconds === 0) {
    return '';
  }
  const direction = offsetMs > 0 ? 'ahead' : 'behind';
  if (seconds < 60) {
    return `${String(seconds)} s ${direction}`;
  }
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  // The two largest units are enough; "1 d 3 h 12 min" is more than anyone reads.
  const parts =
    days > 0
      ? [`${String(days)} d`, hours > 0 ? `${String(hours)} h` : '']
      : hours > 0
        ? [`${String(hours)} h`, rest > 0 ? `${String(rest)} min` : '']
        : [`${String(rest)} min`];
  return `${parts.filter((part) => part !== '').join(' ')} ${direction}`;
}

/**
 * One line saying what the clock is doing: "Live", "Paused · 2 h behind",
 * "60× speed · 5 min ahead".
 */
export function describeClock(clock: SimClock): string {
  if (clock.isLive()) {
    return 'Live';
  }
  const parts = [
    clock.playing()
      ? clock.speed() === 1
        ? ''
        : `${String(clock.speed())}\u00d7 speed`
      : 'Paused',
    describeOffset(clock.offsetMs()),
  ].filter((part) => part !== '');
  // Playing at normal speed, less than half a second from the present, but
  // not quite on it: about to count as live again.
  return parts.length === 0 ? 'Live' : parts.join(' \u00b7 ');
}
