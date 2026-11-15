import type { ParentKind } from './breakupModel';
import { circularStateAtLatitude, cross, norm, rotateAbout, scale, type Vec3 } from './orbit';
import type { EventKind, ParentBody } from './simulate';

/**
 * The events the "What if?" mode can stage.
 *
 * The first three are set up LIKE three real events: the same masses,
 * heights and orbit tilts as NASA's records give (VALIDATION.md, V5.3),
 * on circular orbits. They are not reconstructions. The model is then left
 * to do what it does, and how far its answer falls from what really
 * happened is recorded in VALIDATION.md and on the page.
 */

const DEGREES = Math.PI / 180;

export interface Scenario {
  readonly event: EventKind;
  readonly parents: readonly ParentBody[];
}

export interface Preset {
  readonly id: string;
  readonly title: string;
  /** One line under the title. */
  readonly summary: string;
  /** Whether it is set up like a real event or is made up. */
  readonly basis: 'history' | 'invented';
  /** For presets set up like a real event: what really happened, for comparison. */
  readonly really?: string;
  build(): Scenario;
}

function body(
  label: string,
  massKg: number,
  kind: ParentKind,
  heightKm: number,
  tiltDegrees: number,
  latitudeDegrees: number,
  northbound: boolean,
): ParentBody {
  const { r, v } = circularStateAtLatitude(
    heightKm,
    tiltDegrees * DEGREES,
    latitudeDegrees * DEGREES,
    northbound,
  );
  return { label, r, v, massKg, kind };
}

/**
 * A second body at the same place as `target`, moving at the same speed
 * in a direction turned by `angle` (radians) about the line from the
 * Earth's centre. Two bodies on circular orbits of the same height always
 * meet like this, and they close at 2 v sin(angle / 2).
 */
export function crossingBody(
  target: ParentBody,
  label: string,
  massKg: number,
  kind: ParentKind,
  angle: number,
): ParentBody {
  const up = scale(target.r, 1 / norm(target.r));
  // Only the part of the velocity that is level is turned; any climb or descent is kept.
  const level = cross(up, cross(target.v, up));
  const vertical: Vec3 = [target.v[0] - level[0], target.v[1] - level[1], target.v[2] - level[2]];
  const turned = rotateAbout(level, up, angle);
  return {
    label,
    r: target.r,
    v: [turned[0] + vertical[0], turned[1] + vertical[1], turned[2] + vertical[2]],
    massKg,
    kind,
  };
}

/**
 * Turn a position and velocity from the tracker's drawing (Earth radii,
 * y north) back into kilometres and km/s with z north.
 *
 * @param kmPerSceneUnit the tracker's Earth radius in kilometres
 */
export function fromScene(
  position: readonly [number, number, number],
  velocity: readonly [number, number, number],
  kmPerSceneUnit: number,
): { r: Vec3; v: Vec3 } {
  const k = kmPerSceneUnit;
  return {
    r: [position[0] * k, -position[2] * k, position[1] * k],
    v: [velocity[0] * k, -velocity[2] * k, velocity[1] * k],
  };
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'weather-satellite',
    title: 'A weather satellite hit by an interceptor',
    summary: '950 kg, 860 km up, set up like Fengyun-1C in 2007',
    basis: 'history',
    really:
      'The real event left 3,532 catalogued pieces, about four times what this model makes, and 2,793 of them were still in orbit sixteen years later. NASA found that Fengyun-1C made more pieces, and more light ones, than its model gives.',
    build: () => ({
      event: 'antiSatellite',
      parents: [body('Weather satellite', 950, 'spacecraft', 860, 98.65, 35, false)],
    }),
  },
  {
    id: 'two-satellites',
    title: 'Two satellites collide',
    summary: '560 kg and 900 kg, 790 km up, set up like Iridium 33 and Cosmos 2251 in 2009',
    basis: 'history',
    really:
      'The real collision left 2,372 catalogued pieces (657 and 1,715), about twice what this model makes, and 1,321 of them were still in orbit fourteen years later.',
    build: () => ({
      event: 'collision',
      parents: [
        body('Lighter satellite', 560, 'spacecraft', 788.6, 86.3996, 72.5, true),
        body('Heavier satellite', 900, 'spacecraft', 788.6, 74.0355, 72.5, false),
      ],
    }),
  },
  {
    id: 'low-satellite',
    title: 'A low satellite hit by an interceptor',
    summary: '1,750 kg, 480 km up, set up like Cosmos 1408 in 2021',
    basis: 'history',
    really:
      'The real event left 1,785 catalogued pieces, about a third more than this model makes, and only 364 of them were still in orbit fourteen months later.',
    build: () => ({
      event: 'antiSatellite',
      parents: [body('Low satellite', 1750, 'spacecraft', 479.5, 82.56, 70.25, true)],
    }),
  },
  {
    id: 'rocket-and-satellite',
    title: 'A spent rocket stage and a dead satellite collide',
    summary: '3,000 kg and 1,000 kg, 850 km up, crossing at right angles. Made up.',
    basis: 'invented',
    build: () => {
      const stage = body('Rocket stage', 3000, 'rocketBody', 850, 71, 30, true);
      return {
        event: 'collision',
        parents: [stage, crossingBody(stage, 'Dead satellite', 1000, 'spacecraft', Math.PI / 2)],
      };
    },
  },
  {
    id: 'stage-explosion',
    title: 'A spent rocket stage explodes',
    summary: '1,400 kg, 600 km up. Made up.',
    basis: 'invented',
    build: () => ({
      event: 'explosion',
      parents: [body('Rocket stage', 1400, 'rocketBody', 600, 65, 20, true)],
    }),
  },
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** What the viewer has chosen to do to an object picked from the tracker. */
export interface CustomChoice {
  readonly event: EventKind;
  readonly massKg: number;
  /** For a collision: the other object's mass, in kilograms. */
  readonly otherMassKg: number;
  /** For a collision: the angle between the two paths, in degrees (0 to 180). */
  readonly crossingDegrees: number;
}

/** A scenario built round a real object's present position and velocity. */
export function customScenario(target: ParentBody, choice: CustomChoice): Scenario {
  const first: ParentBody = { ...target, massKg: choice.massKg };
  if (choice.event !== 'collision') {
    return { event: choice.event, parents: [first] };
  }
  return {
    event: 'collision',
    parents: [
      first,
      crossingBody(
        first,
        'The other object',
        choice.otherMassKg,
        'spacecraft',
        choice.crossingDegrees * DEGREES,
      ),
    ],
  };
}
