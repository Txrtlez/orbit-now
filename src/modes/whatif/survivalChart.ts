import { describeSpan } from '../../sim/cloud';
import { CURVE_YEARS, spread, type TrialSummary } from '../../sim/simulate';

/**
 * The chart of how much of a cloud is still in orbit as time passes.
 *
 * One line (the middle of the repetitions) with a band behind it from the
 * lowest repetition to the highest. Time runs on a stretched scale, each
 * step ten or so times the one before, because a cloud changes as much
 * between a day and a month as between ten years and a hundred.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 328;
const HEIGHT = 190;
const MARGIN = { left: 40, right: 12, top: 10, bottom: 26 };

const TICKS: readonly { readonly years: number; readonly label: string }[] = [
  { years: 1 / 365.25, label: '1 day' },
  { years: 30 / 365.25, label: '1 month' },
  { years: 1, label: '1 year' },
  { years: 10, label: '10 yr' },
  { years: 100, label: '100 yr' },
];

const FIRST = CURVE_YEARS[0] ?? 1 / 365.25;
const LAST = CURVE_YEARS[CURVE_YEARS.length - 1] ?? 100;

function xOf(years: number): number {
  const clamped = Math.min(LAST, Math.max(FIRST, years));
  const f = Math.log(clamped / FIRST) / Math.log(LAST / FIRST);
  return MARGIN.left + f * (WIDTH - MARGIN.left - MARGIN.right);
}

function yOf(fraction: number): number {
  return MARGIN.top + (1 - fraction) * (HEIGHT - MARGIN.top - MARGIN.bottom);
}

function element(name: string, attributes: Readonly<Record<string, string | number>>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

export function percent(fraction: number): string {
  const value = fraction * 100;
  if (value > 0 && value < 1) {
    return 'under 1%';
  }
  return `${String(Math.round(value))}%`;
}

/** "62%", or "62% (58 to 66%)" when the repetitions differ. */
export function percentWithRange(values: readonly number[]): string {
  const { low, median, high } = spread(values);
  const middle = percent(median);
  if (Math.round(low * 100) === Math.round(high * 100)) {
    return middle;
  }
  return `${middle} (${String(Math.round(low * 100))} to ${String(Math.round(high * 100))}%)`;
}

export interface SurvivalChart {
  /** Draw the repetitions finished so far. */
  setTrials(trials: readonly TrialSummary[]): void;
  /** Mark the time the globe is showing, in years after the break-up. */
  setMoment(years: number): void;
}

export function mountSurvivalChart(container: HTMLElement): SurvivalChart {
  const figure = document.createElement('figure');
  figure.className = 'whatif-chart';
  const caption = document.createElement('figcaption');
  caption.className = 'section-title';
  caption.textContent = 'Share of the fragments still in orbit';
  const plot = document.createElement('div');
  plot.className = 'growth-plot';
  const readout = document.createElement('p');
  readout.className = 'small muted whatif-readout';

  const svg = element('svg', {
    viewBox: `0 0 ${String(WIDTH)} ${String(HEIGHT)}`,
    width: WIDTH,
    height: HEIGHT,
    role: 'img',
  });
  const grid = element('g', {});
  for (const share of [0, 0.25, 0.5, 0.75, 1]) {
    grid.append(
      element('line', {
        class: share === 0 ? 'growth-axis' : 'growth-grid',
        x1: MARGIN.left,
        x2: WIDTH - MARGIN.right,
        y1: yOf(share),
        y2: yOf(share),
      }),
    );
    const label = element('text', {
      class: 'growth-tick',
      x: MARGIN.left - 6,
      y: yOf(share) + 4,
      'text-anchor': 'end',
    });
    label.textContent = `${String(share * 100)}%`;
    grid.append(label);
  }
  TICKS.forEach((tick, index) => {
    const label = element('text', {
      class: 'growth-tick',
      x: xOf(tick.years),
      y: HEIGHT - 8,
      'text-anchor': index === 0 ? 'start' : index === TICKS.length - 1 ? 'end' : 'middle',
    });
    label.textContent = tick.label;
    grid.append(
      element('line', {
        class: 'growth-grid',
        x1: xOf(tick.years),
        x2: xOf(tick.years),
        y1: yOf(1),
        y2: yOf(0) + 4,
      }),
      label,
    );
  });
  const band = element('path', { class: 'whatif-band' });
  const line = element('path', { class: 'whatif-line' });
  const moment = element('line', { class: 'whatif-moment', y1: yOf(1), y2: yOf(0) });
  const cursor = element('line', { class: 'growth-cursor', y1: yOf(1), y2: yOf(0) });
  const dot = element('circle', { class: 'whatif-dot', r: 4 });
  cursor.setAttribute('visibility', 'hidden');
  dot.setAttribute('visibility', 'hidden');
  moment.setAttribute('visibility', 'hidden');
  svg.append(grid, band, line, moment, cursor, dot);
  plot.append(svg);

  const table = document.createElement('details');
  table.className = 'details';
  const tableSummary = document.createElement('summary');
  tableSummary.textContent = 'The chart as a table';
  const tableScroll = document.createElement('div');
  tableScroll.className = 'growth-table-scroll';
  table.append(tableSummary, tableScroll);

  figure.append(caption, plot, readout, table);
  container.append(figure);

  let curves: { low: number; median: number; high: number }[] = [];
  let momentYears: number | null = null;
  let hovering = false;

  const describe = (index: number): string => {
    const point = curves[index];
    const years = CURVE_YEARS[index] ?? 0;
    if (point === undefined) {
      return '';
    }
    const range =
      Math.round(point.low * 100) === Math.round(point.high * 100)
        ? ''
        : ` (${String(Math.round(point.low * 100))} to ${String(Math.round(point.high * 100))}% across the repetitions)`;
    return `After ${describeSpan(years)}: ${percent(point.median)} still in orbit${range}.`;
  };

  /** The recorded instant nearest a time. */
  const nearest = (years: number): number => {
    let best = 0;
    CURVE_YEARS.forEach((value, index) => {
      if (
        Math.abs(Math.log(value / years)) < Math.abs(Math.log((CURVE_YEARS[best] ?? 1) / years))
      ) {
        best = index;
      }
    });
    return best;
  };

  const showDefaultReadout = (): void => {
    if (curves.length === 0) {
      readout.textContent = '';
      return;
    }
    readout.textContent = describe(nearest(Math.max(FIRST, momentYears ?? 1)));
  };

  const hover = (clientX: number): void => {
    if (curves.length === 0) {
      return;
    }
    const box = svg.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * WIDTH;
    const f = (x - MARGIN.left) / (WIDTH - MARGIN.left - MARGIN.right);
    const index = nearest(FIRST * (LAST / FIRST) ** Math.min(1, Math.max(0, f)));
    const point = curves[index];
    if (point === undefined) {
      return;
    }
    hovering = true;
    const at = xOf(CURVE_YEARS[index] ?? FIRST);
    cursor.setAttribute('x1', String(at));
    cursor.setAttribute('x2', String(at));
    cursor.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', String(at));
    dot.setAttribute('cy', String(yOf(point.median)));
    dot.setAttribute('visibility', 'visible');
    readout.textContent = describe(index);
  };
  svg.addEventListener('pointermove', (event) => {
    hover(event.clientX);
  });
  svg.addEventListener('pointerdown', (event) => {
    hover(event.clientX);
  });
  svg.addEventListener('pointerleave', () => {
    hovering = false;
    cursor.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    showDefaultReadout();
  });

  return {
    setTrials(trials): void {
      curves = CURVE_YEARS.map((_, index) =>
        spread(trials.map((trial) => trial.curve[index] ?? 0)),
      );
      if (curves.length === 0 || trials.length === 0) {
        curves = [];
        band.setAttribute('d', '');
        line.setAttribute('d', '');
        tableScroll.replaceChildren();
        showDefaultReadout();
        return;
      }
      const path = (
        pick: (point: { low: number; median: number; high: number }) => number,
      ): string =>
        curves
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'}${xOf(CURVE_YEARS[index] ?? FIRST).toFixed(1)} ${yOf(pick(point)).toFixed(1)}`,
          )
          .join(' ');
      const back = [...curves]
        .map(
          (point, index) =>
            `L${xOf(CURVE_YEARS[index] ?? FIRST).toFixed(1)} ${yOf(point.low).toFixed(1)}`,
        )
        .reverse()
        .join(' ');
      band.setAttribute('d', `${path((point) => point.high)} ${back} Z`);
      line.setAttribute(
        'd',
        path((point) => point.median),
      );
      svg.setAttribute(
        'aria-label',
        `Chart: the share of the fragments still in orbit, from one day to a hundred years after the break-up. ${describe(nearest(1))} ${describe(nearest(10))} ${describe(nearest(100))}`,
      );

      const grid2 = document.createElement('table');
      grid2.className = 'growth-table';
      const head = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const title of ['After', 'Still in orbit', 'Lowest', 'Highest']) {
        const cell = document.createElement('th');
        cell.scope = 'col';
        cell.textContent = title;
        headRow.append(cell);
      }
      head.append(headRow);
      const body = document.createElement('tbody');
      curves.forEach((point, index) => {
        if (index % 4 !== 0) {
          return;
        }
        const row = document.createElement('tr');
        const when = document.createElement('th');
        when.scope = 'row';
        when.textContent = describeSpan(CURVE_YEARS[index] ?? 0);
        row.append(when);
        for (const value of [point.median, point.low, point.high]) {
          const cell = document.createElement('td');
          cell.textContent = percent(value);
          row.append(cell);
        }
        body.append(row);
      });
      grid2.append(head, body);
      tableScroll.replaceChildren(grid2);
      if (!hovering) {
        showDefaultReadout();
      }
    },
    setMoment(years): void {
      momentYears = years;
      if (years < FIRST) {
        moment.setAttribute('visibility', 'hidden');
      } else {
        moment.setAttribute('x1', String(xOf(years)));
        moment.setAttribute('x2', String(xOf(years)));
        moment.setAttribute('visibility', 'visible');
      }
      if (!hovering) {
        showDefaultReadout();
      }
    },
  };
}
