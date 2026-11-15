import { categoryAt, regimeAt, type ObjectIndex } from '../catalog/objectIndex';
import { parseDesignator, REGIME_DESCRIPTIONS } from '../orbit/elements';
import { describeAge } from './catalogStatus';
import { formatDegrees, formatKm, formatPeriod } from './format';

/** One labelled figure in the object panel. */
export interface Fact {
  readonly label: string;
  readonly value: string;
  /** Optional explanation, shown as a tooltip and read out by screen readers. */
  readonly note?: string;
}

/** Everything about an object that does not change from second to second. */
export interface ObjectFacts {
  /** The published name, or a stand-in if the object was published without one. */
  readonly title: string;
  /** One line saying what kind of thing it is. */
  readonly subtitle: string;
  /** Figures describing the orbit. */
  readonly orbitFacts: readonly Fact[];
  /** Figures identifying the object and its data. */
  readonly identityFacts: readonly Fact[];
}

/**
 * How old an element set is, in words.
 *
 * An epoch in the future is unusual but real: a few element sets are
 * published for an instant slightly ahead of the present.
 */
export function describeElementAge(ageMs: number): string {
  if (ageMs < 0) {
    return `Dated ${describeAge(-ageMs)} ahead`;
  }
  return `${describeAge(ageMs)} old`;
}

/**
 * Describe the object at `index` for the information panel.
 *
 * Every figure is either REAL DATA from the element set (catalog number,
 * designator, inclination, epoch) or comes from the STANDARD MODEL's own
 * initialisation (period, lowest and highest altitude; see
 * `summariseOrbits`). The regime label is this site's convention (see
 * `classifyRegime`).
 *
 * @param nowMs the present time, used only to state the age of the element set
 */
export function describeObject(objects: ObjectIndex, index: number, nowMs: number): ObjectFacts {
  const record = objects.records[index];
  if (record === undefined) {
    throw new RangeError(`No object at index ${String(index)}`);
  }
  const category = categoryAt(objects, index);
  const regime = regimeAt(objects, index);
  const designator = parseDesignator(record.objectId);

  const subtitle =
    category.id === 'other'
      ? `${regime} · ${REGIME_DESCRIPTIONS[regime].split(':')[0] ?? regime}`
      : `${category.one} · ${regime}`;

  const orbitFacts: Fact[] = [
    {
      label: 'Period',
      value: formatPeriod(objects.orbits.periodMinutes[index] ?? 0),
      note: 'Time to go once around the Earth.',
    },
    {
      label: 'Inclination',
      value: formatDegrees(record.inclination),
      note: 'Tilt of the orbit relative to the equator. It is also the highest latitude the object passes over.',
    },
    {
      label: 'Lowest · highest',
      value: `${formatKm(objects.orbits.perigeeKm[index] ?? 0)} · ${formatKm(objects.orbits.apogeeKm[index] ?? 0)}`,
      note: 'Lowest and highest points of the average orbit, measured from the equatorial radius. The live altitude above differs from these by up to tens of kilometres because the Earth is not a perfect sphere.',
    },
    {
      label: 'Regime',
      value: regime,
      note: `${REGIME_DESCRIPTIONS[regime]}. These boundaries are this site's convention; definitions vary.`,
    },
  ];

  const identityFacts: Fact[] = [
    {
      label: 'Catalog number',
      value: String(record.noradId),
      note: 'The number given to the object in the US satellite catalog, often called its NORAD number.',
    },
  ];
  if (record.objectId !== '') {
    identityFacts.push({
      label: 'Designator',
      value: record.objectId,
      note:
        designator === null
          ? 'International designator.'
          : `International designator: piece ${designator.piece} of launch ${String(designator.launchNumber)} of ${String(designator.year)}.`,
    });
  }
  if (designator !== null) {
    identityFacts.push({
      label: 'Launched',
      value: String(designator.year),
      note: 'Launch year, from the international designator.',
    });
  }
  identityFacts.push({
    label: 'Orbit data',
    value: describeElementAge(nowMs - (objects.epochMs[index] ?? nowMs)),
    note: 'Age of the measurements this position is computed from. The older they are, the less accurate the position.',
  });

  return {
    title: record.name === '' ? `Object ${String(record.noradId)}` : record.name,
    subtitle,
    orbitFacts,
    identityFacts,
  };
}
