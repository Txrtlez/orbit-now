import { describe, expect, it } from 'vitest';
import { degToRad } from '../../src/geo/geodetic';
import { compassPoint, createObserver } from '../../src/geo/topocentric';
import { predictPasses, type Pass } from '../../src/passes/predict';
import { loadHeavensAbove, loadIss, type ReferenceEvent, type ReferencePass } from './heavensAbove';
import { recordMeasurement } from './measurements';

/**
 * Launch-gate validation: predicted passes of the International Space
 * Station against an established source, for four places on Earth.
 *
 * REFERENCE: Heavens-Above (heavens-above.com), tables copied on
 * 2026-11-15 for the ten days 15 to 25 November 2026 (see the fixture file
 * for how). The four places were chosen to differ: a mid-northern latitude
 * (Atlanta), a high northern one near the edge of the station's reach
 * (London), a mid-southern one (Sydney) and one on the equator (Singapore).
 *
 * WHAT IS COMPARED: this project's predictor, given the station's element
 * set from this project's own published catalog of the same day. The two
 * calculations share nothing but the physics. Heavens-Above uses its own
 * copy of the elements (its page says "Epoch: 15 November"; ours is dated
 * 14 November 22:45 UTC), which is why the times drift apart by a few
 * seconds over the ten days.
 *
 * WHAT THE REFERENCE PRINTS: times to the second, altitudes to the degree,
 * directions as one of sixteen compass points. Agreement cannot be shown
 * more finely than that.
 */

const FROM_MS = Date.UTC(2026, 10, 15);
const TO_MS = Date.UTC(2026, 10, 25);
const DAY_MS = 86_400_000;

const reference = loadHeavensAbove();
const iss = loadIss();

/** The label Heavens-Above would give a pass of ours. */
function typeOf(pass: Pass): string {
  if (pass.visible !== null) {
    return 'visible';
  }
  return pass.notVisibleReason === 'daylight' ? 'daylight' : 'night (unlit)';
}

/** How far a bearing is from the nearest edge between two of the sixteen compass points, in degrees. */
function distanceToCompassEdge(azimuthDeg: number): number {
  const withinSector = (((azimuthDeg + 11.25) % 22.5) + 22.5) % 22.5;
  return Math.min(withinSector, 22.5 - withinSector);
}

const utc = (timeMs: number): string => new Date(timeMs).toISOString().slice(0, 19);

interface Comparison {
  /** Largest difference in any printed time, seconds. */
  worstTimeS: number;
  /** The same, for passes in the first three days only. */
  worstEarlyTimeS: number;
  /** Largest difference between our altitude and the printed whole degree. */
  worstAltitudeDeg: number;
  /** Points too nearly overhead for a compass bearing to be compared. */
  nearOverhead: number;
  /** Compass points that differ from the printed one. */
  compassMismatches: number;
  /** For those, the largest distance of our bearing from the edge of its compass sector. */
  worstCompassEdgeDeg: number;
}

function newComparison(): Comparison {
  return {
    worstTimeS: 0,
    worstEarlyTimeS: 0,
    worstAltitudeDeg: 0,
    nearOverhead: 0,
    compassMismatches: 0,
    worstCompassEdgeDeg: 0,
  };
}

function compareEvent(
  comparison: Comparison,
  ours: { timeMs: number; azimuthDeg: number; elevationDeg: number },
  theirs: ReferenceEvent,
): void {
  const timeS = Math.abs(ours.timeMs - theirs.timeMs) / 1000;
  comparison.worstTimeS = Math.max(comparison.worstTimeS, timeS);
  if (theirs.timeMs < FROM_MS + 3 * DAY_MS) {
    comparison.worstEarlyTimeS = Math.max(comparison.worstEarlyTimeS, timeS);
  }
  comparison.worstAltitudeDeg = Math.max(
    comparison.worstAltitudeDeg,
    Math.abs(ours.elevationDeg - theirs.altitudeDeg),
  );
  if (ours.elevationDeg > NEAR_OVERHEAD_DEG) {
    // Almost straight up, a compass bearing means little: it swings through
    // half the compass in a few seconds as the satellite goes over.
    comparison.nearOverhead += 1;
  } else if (compassPoint(ours.azimuthDeg) !== theirs.compass) {
    comparison.compassMismatches += 1;
    comparison.worstCompassEdgeDeg = Math.max(
      comparison.worstCompassEdgeDeg,
      distanceToCompassEdge(ours.azimuthDeg),
    );
  }
}

/** Our pass whose highest point is nearest in time to the reference's, if within a minute. */
function matchPass(ours: readonly Pass[], theirs: ReferencePass): Pass | undefined {
  return ours.find((pass) => Math.abs(pass.culmination.timeMs - theirs.highest.timeMs) < 60_000);
}

/**
 * Tolerances, set from what was measured on 2026-11-15 (VALIDATION.md,
 * V4.2) with a little room: times agreed within 2 s in the first three
 * days and within 5 s over all ten; altitudes within 0.5 degrees of the
 * printed whole degree, which is all that rounding allows.
 */
const EARLY_TIME_TOLERANCE_S = 3;
const TIME_TOLERANCE_S = 7;
const ALTITUDE_TOLERANCE_DEG = 0.75;
/** Above this altitude compass points are not compared. */
const NEAR_OVERHEAD_DEG = 85;
/** A compass point may differ only where our bearing is this close to the edge of its sector. */
const COMPASS_EDGE_TOLERANCE_DEG = 2;

/**
 * Passes on which our label differs from the "pass type" column of
 * Heavens-Above's table of all passes, by the start time it prints. Every
 * one is explained in VALIDATION.md, V4.2. None of them is in
 * Heavens-Above's own table of visible passes, so on what can actually be
 * seen the two sources agree for all of them.
 */
const TYPE_COLUMN_DIFFERENCES: Readonly<Record<string, readonly string[]>> = {
  Atlanta: [],
  London: [
    // The station is in sunlight only below 10 degrees: it enters the
    // Earth's shadow before it climbs into the part of the sky we count.
    '2026-11-16T19:58:48',
    '2026-11-18T19:59:53',
    '2026-11-20T20:00:52',
    '2026-11-22T20:01:53',
    '2026-11-24T20:03:15',
  ],
  Sydney: [
    // Dawn, with the Sun between 5.8 and 4.6 degrees below the horizon: too bright by our rule.
    '2026-11-17T18:15:40',
    // In sunlight only below 10 degrees, as for London.
    '2026-11-18T15:53:27',
    '2026-11-21T15:04:46',
    '2026-11-24T14:16:55',
  ],
  Singapore: [],
};

/**
 * Passes we call visible that Heavens-Above's table of visible passes
 * leaves out. One: a low pass at dusk during which the Sun sinks from 5.5
 * to 6.3 degrees below the horizon, crossing our threshold of 6. Its table
 * of all passes labels the same pass "visible".
 */
const VISIBLE_ONLY_HERE: Readonly<Record<string, readonly string[]>> = {
  Atlanta: ['2026-11-16T22:57:36'],
  London: [],
  Sydney: [],
  Singapore: [],
};

describe('ISS passes against Heavens-Above, 15 to 25 November 2026', () => {
  it('covers four places and at least 150 passes', () => {
    expect(reference.locations.map((location) => location.name)).toEqual([
      'Atlanta',
      'London',
      'Sydney',
      'Singapore',
    ]);
    const total = reference.locations.reduce((sum, l) => sum + l.allPasses.length, 0);
    expect(total).toBeGreaterThanOrEqual(150);
    // The element set must be from before the period, as a real prediction's would be.
    expect(iss.epochMs).toBeLessThan(FROM_MS);
    expect(FROM_MS - iss.epochMs).toBeLessThan(DAY_MS);
  });

  for (const location of reference.locations) {
    describe(location.name, () => {
      const observer = createObserver(
        degToRad(location.latitudeDeg),
        degToRad(location.longitudeDeg),
        0,
      );
      const ours = predictPasses(iss.propagate, observer, FROM_MS, TO_MS);

      it('finds the same passes, one for one', () => {
        expect(ours).toHaveLength(location.allPasses.length);
        const matched = new Set<Pass>();
        for (const theirs of location.allPasses) {
          const pass = matchPass(ours, theirs);
          expect(pass, theirs.row).toBeDefined();
          if (pass !== undefined) {
            matched.add(pass);
          }
        }
        expect(matched.size).toBe(ours.length);
      });

      it('agrees on when and where each pass starts, peaks and ends', () => {
        const comparison = newComparison();
        for (const theirs of location.allPasses) {
          const pass = matchPass(ours, theirs);
          if (pass === undefined) {
            continue;
          }
          compareEvent(comparison, pass.rise, theirs.start);
          compareEvent(comparison, pass.culmination, theirs.highest);
          compareEvent(comparison, pass.set, theirs.end);
        }
        recordMeasurement(`ISS passes, ${location.name}, all passes`, {
          passes: location.allPasses.length,
          worstTimeFirstThreeDaysS: comparison.worstEarlyTimeS,
          worstTimeS: comparison.worstTimeS,
          worstAltitudeDeg: Number(comparison.worstAltitudeDeg.toFixed(2)),
          compassMismatches: comparison.compassMismatches,
          compassPointsCompared: location.allPasses.length * 3 - comparison.nearOverhead,
          nearOverheadNotCompared: comparison.nearOverhead,
          worstCompassEdgeDeg: Number(comparison.worstCompassEdgeDeg.toFixed(2)),
        });
        expect(comparison.worstEarlyTimeS).toBeLessThanOrEqual(EARLY_TIME_TOLERANCE_S);
        expect(comparison.worstTimeS).toBeLessThanOrEqual(TIME_TOLERANCE_S);
        expect(comparison.worstAltitudeDeg).toBeLessThanOrEqual(ALTITUDE_TOLERANCE_DEG);
        expect(comparison.worstCompassEdgeDeg).toBeLessThanOrEqual(COMPASS_EDGE_TOLERANCE_DEG);
      });

      it('agrees on which passes can be seen', () => {
        const visibleHere: string[] = [];
        const visibleThereOnly: string[] = [];
        const comparison = newComparison();
        let compared = 0;
        for (const theirs of location.allPasses) {
          const pass = matchPass(ours, theirs);
          if (pass === undefined) {
            continue;
          }
          // The row of the visible-passes table that falls within this pass, if any.
          const row = location.visiblePasses.find(
            (candidate) =>
              candidate.start.timeMs >= theirs.start.timeMs - 10_000 &&
              candidate.end.timeMs <= theirs.end.timeMs + 10_000,
          );
          if (pass.visible !== null && row !== undefined) {
            compared += 1;
            compareEvent(comparison, pass.visible.start, row.start);
            compareEvent(comparison, pass.visible.highest, row.highest);
            compareEvent(comparison, pass.visible.end, row.end);
          } else if (pass.visible !== null) {
            visibleHere.push(utc(theirs.start.timeMs));
          } else if (row !== undefined) {
            visibleThereOnly.push(utc(theirs.start.timeMs));
          }
        }
        recordMeasurement(`ISS passes, ${location.name}, visible passes`, {
          inReference: location.visiblePasses.length,
          compared,
          visibleOnlyHere: visibleHere.length,
          visibleOnlyInReference: visibleThereOnly.length,
          worstTimeS: comparison.worstTimeS,
          worstAltitudeDeg: Number(comparison.worstAltitudeDeg.toFixed(2)),
          compassMismatches: comparison.compassMismatches,
          worstCompassEdgeDeg: Number(comparison.worstCompassEdgeDeg.toFixed(2)),
        });
        // Every row of the reference's table is a pass we also call visible.
        expect(compared).toBe(location.visiblePasses.length);
        expect(visibleThereOnly).toEqual([]);
        expect(visibleHere).toEqual(VISIBLE_ONLY_HERE[location.name]);
        expect(comparison.worstTimeS).toBeLessThanOrEqual(TIME_TOLERANCE_S);
        expect(comparison.worstAltitudeDeg).toBeLessThanOrEqual(ALTITUDE_TOLERANCE_DEG);
        expect(comparison.worstCompassEdgeDeg).toBeLessThanOrEqual(COMPASS_EDGE_TOLERANCE_DEG);
      });

      it('gives each pass the same label, apart from the documented cases', () => {
        const different: string[] = [];
        for (const theirs of location.allPasses) {
          const pass = matchPass(ours, theirs);
          if (pass !== undefined && typeOf(pass) !== theirs.type) {
            different.push(utc(theirs.start.timeMs));
          }
        }
        recordMeasurement(`ISS passes, ${location.name}, pass type`, {
          passes: location.allPasses.length,
          labelledDifferently: different.length,
        });
        expect(different).toEqual(TYPE_COLUMN_DIFFERENCES[location.name]);
      });
    });
  }
});
