import { radToDeg } from '../geo/geodetic';
import { lookAngles, type Observer } from '../geo/topocentric';
import { WGS84_A_KM } from '../geo/wgs84';
import { gmstRadians, sunDirection, temeToEarthFixed } from '../orbit/time';

/**
 * Predicting when a satellite passes over an observer, and whether it can
 * be seen.
 *
 * A satellite is visible to the naked eye only when three things hold at
 * once: it is above the observer's horizon, it is in sunlight, and the
 * observer's own sky is dark. That happens for an hour or two after dusk
 * and before dawn, when the ground is in the Earth's shadow but a
 * satellite a few hundred kilometres up is not.
 */

/** A position in the inertial frame SGP4 reports in (TEME), kilometres. */
export interface InertialPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Gives a satellite's position at an instant (milliseconds since
 * 1970-01-01 UTC), or null if it cannot be computed.
 */
export type Propagator = (unixMs: number) => InertialPosition | null;

/** One moment of a pass. */
export interface PassEvent {
  /** Milliseconds since 1970-01-01 UTC. */
  readonly timeMs: number;
  /** Compass bearing in degrees, 0 = north, 90 = east. */
  readonly azimuthDeg: number;
  /** Angle above the horizon in degrees. */
  readonly elevationDeg: number;
}

/** Why a pass cannot be seen, if it cannot. */
export type NotVisibleReason =
  /** The observer's sky is not dark enough while the satellite is in view and sunlit. */
  | 'daylight'
  /** The satellite is in the Earth's shadow for the whole pass. */
  | 'in-shadow';

export interface Pass {
  /** The satellite climbs through the minimum elevation. */
  readonly rise: PassEvent;
  /** The highest point of the pass. */
  readonly culmination: PassEvent;
  /** The satellite sinks through the minimum elevation. */
  readonly set: PassEvent;
  /**
   * The part of the pass during which the satellite can be seen: the
   * stretch in which it is sunlit, if the observer's sky is dark during
   * it. Null if there is no such part. A pass often begins or ends in
   * mid-sky, where the satellite leaves or enters the Earth's shadow.
   */
  readonly visible: {
    readonly start: PassEvent;
    readonly highest: PassEvent;
    readonly end: PassEvent;
  } | null;
  /** If `visible` is null, why. */
  readonly notVisibleReason: NotVisibleReason | null;
  /** The Sun's elevation at the observer at culmination, in degrees (negative: below the horizon). */
  readonly sunElevationDeg: number;
}

export interface PassOptions {
  /**
   * A pass is counted from when the satellite climbs above this elevation
   * until it sinks below it, and only if it gets this high. Ten degrees is
   * the convention of NASA's Spot the Station and of Heavens-Above: lower
   * than that, buildings, trees and haze usually hide the satellite.
   */
  readonly minElevationDeg: number;
  /**
   * The sky counts as dark when the Sun is at least this far below the
   * horizon, in degrees (so the value is negative). Minus six is the end of
   * civil twilight, when the brightest stars and satellites show.
   */
  readonly maxSunElevationDeg: number;
}

export const DEFAULT_PASS_OPTIONS: PassOptions = {
  minElevationDeg: 10,
  maxSunElevationDeg: -6,
};

/** Step of the first sweep while the satellite is near or above the horizon, in milliseconds. */
const FINE_STEP_MS = 30_000;
/**
 * Step while it is far below the horizon (see `COARSE_BELOW_DEG`). Safe
 * because nothing in orbit can climb from 25 degrees below the horizon to
 * 10 degrees above it in so short a time: even a satellite only 200 km up,
 * passing straight overhead, needs about eleven minutes.
 */
const COARSE_STEP_MS = 120_000;
/** Below this elevation the coarse step is used. */
const COARSE_BELOW_DEG = -25;
/** Step of the sweep for sunlight within a pass, in milliseconds. */
const VISIBILITY_STEP_MS = 2000;
/** Rise, set and shadow times are refined until bracketed this closely, in milliseconds. */
const TIME_TOLERANCE_MS = 50;
/** How long before the requested start to begin looking, to catch a pass already under way. */
const LEAD_IN_MS = 20 * 60_000;

/**
 * Is a satellite in sunlight?
 *
 * SIMPLIFICATION: the Earth's shadow is treated as a cylinder of the
 * Earth's equatorial radius pointing directly away from the Sun. The real
 * shadow has a dark core that narrows slightly with distance and a
 * partly-lit fringe around it; at the height of the space station the
 * fringe is about 60 km across, which a satellite crosses in under ten
 * seconds. The cylinder's edge runs down the middle of that fringe, so
 * shadow times from this test are good to a few seconds. The flattening
 * of the Earth and the bending of sunlight by the atmosphere are ignored.
 *
 * @param position     the satellite, inertial frame, kilometres
 * @param sunDirection unit vector from the Earth's centre towards the Sun, same frame
 */
export function isSunlit(
  position: InertialPosition,
  sunDirection: { readonly x: number; readonly y: number; readonly z: number },
): boolean {
  const along =
    position.x * sunDirection.x + position.y * sunDirection.y + position.z * sunDirection.z;
  if (along >= 0) {
    // On the Sun's side of the Earth.
    return true;
  }
  const distanceSquared =
    position.x * position.x + position.y * position.y + position.z * position.z;
  // Squared distance from the line through the Earth's centre along the Sun's direction.
  return distanceSquared - along * along > WGS84_A_KM * WGS84_A_KM;
}

/**
 * The Sun's elevation above an observer's horizon, in degrees.
 *
 * STANDARD MODEL for the Sun's direction (see `sunDirection`), turned into
 * the Earth-fixed frame and measured against the observer's "up".
 * SIMPLIFICATIONS: the Sun is treated as infinitely far away (an error of
 * under 0.003 degrees) and atmospheric refraction is ignored (it matters
 * only for the moment of sunrise and sunset, not for a threshold six
 * degrees below the horizon).
 */
export function sunElevationDeg(observer: Observer, unixMs: number): number {
  const sun = sunDirection(unixMs);
  const fixed = temeToEarthFixed(sun.x, sun.y, sun.z, gmstRadians(unixMs));
  const up = fixed.x * observer.up[0] + fixed.y * observer.up[1] + fixed.z * observer.up[2];
  return radToDeg(Math.asin(Math.max(-1, Math.min(1, up))));
}

/**
 * Find a satellite's passes over an observer in a span of time.
 *
 * Method. The satellite's elevation is sampled every 30 seconds (every two
 * minutes while it is far below the horizon). Wherever it crosses the
 * minimum elevation between two samples, the crossing is pinned down by
 * repeated halving; the highest point between rise and set is found by
 * golden-section search. Within each pass the sunlight and darkness
 * conditions are sampled every two seconds and their changes pinned down
 * the same way. Every position is an SGP4 position turned into the
 * observer's frame with sidereal time; nothing is interpolated.
 *
 * A pass already under way at `fromMs` is included, with its true rise
 * time. A pass still under way at `toMs` is left out.
 *
 * @returns passes in order of time
 */
export function predictPasses(
  propagate: Propagator,
  observer: Observer,
  fromMs: number,
  toMs: number,
  options: PassOptions = DEFAULT_PASS_OPTIONS,
): Pass[] {
  /** Where the satellite is in the observer's sky, or null if it cannot be computed. */
  const look = (unixMs: number): { elevationDeg: number; azimuthDeg: number } | null => {
    const position = propagate(unixMs);
    if (position === null) {
      return null;
    }
    const fixed = temeToEarthFixed(position.x, position.y, position.z, gmstRadians(unixMs));
    const angles = lookAngles(observer, fixed.x, fixed.y, fixed.z);
    return {
      elevationDeg: radToDeg(angles.elevationRad),
      azimuthDeg: radToDeg(angles.azimuthRad),
    };
  };
  /** Elevation only; a position that cannot be computed counts as far below the horizon. */
  const elevation = (unixMs: number): number => look(unixMs)?.elevationDeg ?? -90;
  const event = (unixMs: number): PassEvent => {
    const at = look(unixMs);
    return {
      timeMs: Math.round(unixMs),
      azimuthDeg: at?.azimuthDeg ?? 0,
      elevationDeg: at?.elevationDeg ?? -90,
    };
  };

  /**
   * Pin down the instant between `lowMs` and `highMs` at which `test`
   * changes from its value at `lowMs` to its value at `highMs`.
   */
  const transition = (test: (unixMs: number) => boolean, lowMs: number, highMs: number): number => {
    const startValue = test(lowMs);
    let low = lowMs;
    let high = highMs;
    while (high - low > TIME_TOLERANCE_MS) {
      const middle = (low + high) / 2;
      if (test(middle) === startValue) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return (low + high) / 2;
  };

  /** The instant of greatest elevation between two times that bracket a single peak. */
  const peak = (lowMs: number, highMs: number): number => {
    const ratio = (Math.sqrt(5) - 1) / 2;
    let low = lowMs;
    let high = highMs;
    let inner1 = high - ratio * (high - low);
    let inner2 = low + ratio * (high - low);
    let value1 = elevation(inner1);
    let value2 = elevation(inner2);
    while (high - low > TIME_TOLERANCE_MS) {
      if (value1 < value2) {
        low = inner1;
        inner1 = inner2;
        value1 = value2;
        inner2 = low + ratio * (high - low);
        value2 = elevation(inner2);
      } else {
        high = inner2;
        inner2 = inner1;
        value2 = value1;
        inner1 = high - ratio * (high - low);
        value1 = elevation(inner1);
      }
    }
    return (low + high) / 2;
  };

  const above = (unixMs: number): boolean => elevation(unixMs) >= options.minElevationDeg;

  const passes: Pass[] = [];
  const addPass = (riseMs: number, setMs: number): void => {
    if (setMs < fromMs || setMs > toMs) {
      return;
    }
    const culminationMs = peak(riseMs, setMs);
    passes.push({
      rise: event(riseMs),
      culmination: event(culminationMs),
      set: event(setMs),
      sunElevationDeg: sunElevationDeg(observer, culminationMs),
      ...findVisiblePart(riseMs, setMs, culminationMs),
    });
  };

  /**
   * Work out which part of a pass, if any, can be seen.
   *
   * The satellite can be seen while it is sunlit, provided the sky is dark.
   * Darkness is judged once for each sunlit stretch, not instant by instant:
   * if the Sun is far enough down at any moment of the stretch, the whole
   * stretch is reported. Twilight changes slowly and a bright satellite
   * does not vanish when the Sun climbs past a threshold, so cutting a
   * stretch at that instant would report a disappearance in mid-sky that
   * nobody would observe. Heavens-Above's tables behave the same way (see
   * VALIDATION.md, V4.2).
   */
  const findVisiblePart = (
    riseMs: number,
    setMs: number,
    culminationMs: number,
  ): Pick<Pass, 'visible' | 'notVisibleReason'> => {
    const dark = (unixMs: number): boolean =>
      sunElevationDeg(observer, unixMs) <= options.maxSunElevationDeg;
    const lit = (unixMs: number): boolean => {
      const position = propagate(unixMs);
      return position !== null && isSunlit(position, sunDirection(unixMs));
    };

    interface Stretch {
      start: number;
      end: number;
      /** Whether the sky was dark at any sampled moment of the stretch. */
      dark: boolean;
    }
    // The longest unbroken sunlit stretch of the pass that has a dark sky.
    let best: Stretch | null = null;
    const finish = (stretch: Stretch): void => {
      if (stretch.dark && (best === null || stretch.end - stretch.start > best.end - best.start)) {
        best = stretch;
      }
    };
    let current: Stretch | null = null;
    let everDark = false;
    let everLit = false;
    let previousMs = riseMs;
    let previousLit = lit(riseMs);
    if (previousLit) {
      current = { start: riseMs, end: riseMs, dark: false };
    }
    for (let at = riseMs; at <= setMs;) {
      const nowDark = dark(at);
      everDark ||= nowDark;
      // The last sample is exactly the end of the pass.
      const next = at === setMs ? Infinity : Math.min(setMs, at + VISIBILITY_STEP_MS);
      const nowLit = lit(at);
      everLit ||= nowLit;
      if (nowLit !== previousLit) {
        const changeMs = transition(lit, previousMs, at);
        if (nowLit) {
          current = { start: changeMs, end: at, dark: nowDark };
        } else if (current !== null) {
          current.end = changeMs;
          finish(current);
          current = null;
        }
      } else if (nowLit && current !== null) {
        current.end = at;
        current.dark ||= nowDark;
      }
      previousMs = at;
      previousLit = nowLit;
      at = next;
    }
    if (current !== null) {
      finish(current);
    }

    // `best` is assigned inside `finish`, which the compiler cannot follow.
    const chosen = best as Stretch | null;
    if (chosen === null) {
      // Sunlit but never against a dark sky: daylight. Never sunlit: in the
      // Earth's shadow, which can only happen on the night side.
      return { visible: null, notVisibleReason: everLit || !everDark ? 'daylight' : 'in-shadow' };
    }
    // The elevation rises to the culmination and falls after it, so the
    // highest visible point is the culmination itself if it is within the
    // visible stretch, and otherwise the end of the stretch nearer to it.
    const highestMs = Math.min(chosen.end, Math.max(chosen.start, culminationMs));
    return {
      visible: { start: event(chosen.start), highest: event(highestMs), end: event(chosen.end) },
      notVisibleReason: null,
    };
  };

  // --- The sweep -------------------------------------------------------------
  let previousMs = fromMs - LEAD_IN_MS;
  let previousElevation = elevation(previousMs);
  // The time the satellite climbed above the minimum, while a pass is in progress.
  let riseMs: number | null = previousElevation >= options.minElevationDeg ? previousMs : null;
  // The sample before the previous one, for spotting a peak between samples.
  let beforeMs = previousMs;
  let beforeElevation = previousElevation;

  while (previousMs < toMs) {
    const step = previousElevation < COARSE_BELOW_DEG ? COARSE_STEP_MS : FINE_STEP_MS;
    const at = previousMs + step;
    const currentElevation = elevation(at);

    if (riseMs === null && currentElevation >= options.minElevationDeg) {
      riseMs = transition(above, previousMs, at);
    } else if (riseMs !== null && currentElevation < options.minElevationDeg) {
      addPass(riseMs, transition(above, previousMs, at));
      riseMs = null;
    } else if (
      riseMs === null &&
      previousElevation > beforeElevation &&
      previousElevation > currentElevation &&
      previousElevation > options.minElevationDeg - 3
    ) {
      // The elevation peaked just under the minimum at a sample. The true
      // peak lies between the neighbouring samples and may be over it: a
      // pass so short that it fits between two samples.
      const peakMs = peak(beforeMs, at);
      if (above(peakMs)) {
        addPass(transition(above, beforeMs, peakMs), transition(above, peakMs, at));
      }
    }

    beforeMs = previousMs;
    beforeElevation = previousElevation;
    previousMs = at;
    previousElevation = currentElevation;
  }
  return passes;
}
