import {
  formatApproximate,
  formatCountAt,
  formatMonth,
  GROWTH_EVENT_MARKS,
  GROWTH_KINDS,
  GROWTH_SOURCE,
  GROWTH_TOTAL,
  indexOfMonth,
  LAST_MONTH,
  tableMonths,
  unassignedAt,
  type GrowthSeries,
} from './series';

/**
 * The growth-of-orbit chart: NASA's monthly count of catalogued objects
 * since 1957, by kind, drawn as lines that can be played through like a
 * film or moved through by hand.
 *
 * This module and the data behind it are loaded only when the viewer opens
 * the chart, so they add nothing to the first download.
 *
 * Why lines and not stacked areas: the source is itself a chart of five
 * lines, a total and four kinds, and since 2018 its total runs above the
 * four kinds added together. Stacking the four would draw a top edge that
 * is not NASA's total. Five lines show exactly what the source shows.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The value at the top of the vertical axis, as in the source. */
const AXIS_TOP = 35_000;
/** Spacing of the horizontal gridlines, in objects. */
const GRID_STEP = 5_000;
/** How long the whole series takes to play, in milliseconds. */
const PLAY_DURATION_MS = 14_000;
/** Below this width the chart drops every other label. */
const NARROW_PX = 520;
/** Width kept clear beside the hairline for the names of the lines ("Mission-related debris" at 12px). */
const DIRECT_LABEL_ROOM_PX = 150;
/** Two direct labels closer together than this, vertically, would collide; the lower-priority one is dropped. */
const LABEL_CLEARANCE_PX = 14;

/** CSS custom properties holding each line's colour (see styles.css). */
const KIND_COLOURS: Readonly<Record<GrowthSeries['id'], string>> = {
  total: 'var(--growth-total)',
  spacecraft: 'var(--growth-1)',
  fragmentation: 'var(--growth-2)',
  rocketBodies: 'var(--growth-3)',
  missionRelated: 'var(--growth-4)',
};

/** Lines in drawing order: the total last, so that it is on top. */
const LINES: readonly GrowthSeries[] = [...GROWTH_KINDS, GROWTH_TOTAL];
/** Lines in the order direct labels are given room: the total first. */
const LABEL_PRIORITY: readonly GrowthSeries[] = [GROWTH_TOTAL, ...GROWTH_KINDS];

export interface GrowthChartOptions {
  /** Whether the viewer has asked for reduced motion. */
  readonly reducedMotion: () => boolean;
  /** Number of objects in this site's own catalog, to tell the two counts apart, or null if unknown. */
  readonly siteObjectCount: number | null;
}

export interface GrowthChart {
  /** Call when the chart comes into view: plays from 1957, or shows the last month if motion is reduced. */
  start(): void;
  /** Call when the chart is hidden: stops any animation. */
  stop(): void;
}

function html<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }
  return node;
}

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** The geometry of the plot for a given width. */
interface Layout {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly narrow: boolean;
}

function layoutFor(containerWidth: number): Layout {
  const width = Math.max(280, Math.round(containerWidth));
  const narrow = width < NARROW_PX;
  return {
    width,
    height: narrow ? 250 : 330,
    left: narrow ? 52 : 54,
    // On a wide plot the names of the lines stand in a margin to the right
    // of the last month; a narrow one has no room for that.
    right: narrow ? 12 : DIRECT_LABEL_ROOM_PX,
    // Room above the plot for two rows of event labels.
    top: 34,
    bottom: 24,
    narrow,
  };
}

/**
 * Build the chart inside `container`.
 *
 * Everything about the data that the picture shows is also available
 * without it: the legend carries the figures for the month in view, the
 * slider reaches every month from the keyboard, and a table gives the
 * figures decade by decade.
 */
export function mountGrowthChart(container: HTMLElement, options: GrowthChartOptions): GrowthChart {
  // --- Source, stated first -------------------------------------------------
  const sourceLine = html('p', 'tag-line');
  const sourceLink = html('a', undefined, GROWTH_SOURCE.publication);
  sourceLink.href = GROWTH_SOURCE.url;
  sourceLink.rel = 'noopener';
  sourceLink.target = '_blank';
  sourceLine.append(
    html('span', 'tag', 'Real data'),
    ` ${GROWTH_SOURCE.publisher}, `,
    sourceLink,
    `, ${GROWTH_SOURCE.issue} (${GROWTH_SOURCE.issueDate}), page ${String(GROWTH_SOURCE.page)}. Counts as of ${GROWTH_SOURCE.dataAsOf}, read from the published chart.`,
  );

  // --- The month in view, and the legend that doubles as its readout ----------
  const now = html('p', 'growth-now');
  now.setAttribute('aria-live', 'off');
  const nowMonth = html('span', 'growth-month');
  const nowTotal = html('span', 'growth-total');
  now.append(nowMonth, nowTotal);

  const legend = html('ul', 'growth-legend');
  const legendValues = new Map<GrowthSeries['id'], HTMLElement>();
  for (const series of LABEL_PRIORITY) {
    const item = html('li');
    item.title = series.description;
    const key = html('span', 'growth-key');
    key.style.background = KIND_COLOURS[series.id];
    if (series.id === 'total') {
      key.classList.add('growth-key-total');
    }
    const value = html('span', 'growth-value');
    legendValues.set(series.id, value);
    item.append(key, html('span', 'growth-name', series.label), value);
    legend.append(item);
  }

  // --- The plot ---------------------------------------------------------------
  const plot = html('div', 'growth-plot');
  const picture = svg('svg', { role: 'img', focusable: 'false' });
  picture.setAttribute(
    'aria-label',
    'Line chart of catalogued objects in Earth orbit from 1957 to 2026: the total, and spacecraft, fragmentation debris, rocket bodies and mission-related debris. The figures are in the legend above and in the table below.',
  );
  plot.append(picture);

  // --- Controls ---------------------------------------------------------------
  const controls = html('div', 'growth-controls');
  const playButton = html('button', 'text-button growth-play');
  playButton.type = 'button';
  const slider = html('input', 'growth-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(LAST_MONTH);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Month shown, from January 1957 to May 2026');
  controls.append(playButton, slider);

  // --- The same figures as a table --------------------------------------------
  const tableDetails = html('details', 'details');
  tableDetails.append(html('summary', undefined, 'The numbers, decade by decade'));
  const table = html('table', 'growth-table');
  const caption = html(
    'caption',
    'visually-hidden',
    'Catalogued objects in Earth orbit at the start of each decade and in the last month of the series',
  );
  const head = html('tr');
  head.append(html('th', undefined, 'Month'));
  for (const series of LINES) {
    const cell = html('th', undefined, series.label);
    cell.scope = 'col';
    head.append(cell);
  }
  const thead = html('thead');
  thead.append(head);
  const tbody = html('tbody');
  for (const index of tableMonths()) {
    const row = html('tr');
    const month = html('th', undefined, formatMonth(index));
    month.scope = 'row';
    row.append(month);
    for (const series of LINES) {
      row.append(html('td', undefined, formatCountAt(series, index)));
    }
    tbody.append(row);
  }
  table.append(caption, thead, tbody);
  const tableScroll = html('div', 'growth-table-scroll');
  tableScroll.append(table);
  tableDetails.append(tableScroll);

  // --- What the figures are, and are not ---------------------------------------
  const notes = html('details', 'details');
  notes.append(html('summary', undefined, 'How these numbers were obtained, and their limits'));
  const unassigned = formatApproximate(unassignedAt(LAST_MONTH));
  const noteTexts = [
    'NASA publishes this chart but not the numbers behind it. They were recovered from the positions of the chart’s lines in the published file. Each is within roughly ten objects of what NASA plotted, which is why they are shown rounded to the nearest ten and why counts below 20 are not named.',
    'Only catalogued objects are counted: those the US Space Surveillance Network tracks and has identified. Smaller pieces, which are far more numerous, are not on this chart.',
    'The debris of a break-up appears in the month of the break-up, although cataloguing its pieces took months or years. That is why the events of 2007, 2009 and 2021 show as sudden steps.',
    `From late 2018 the total runs above the four kinds added together, by about ${unassigned} objects in the last month. The chart does not say what the difference is, and this site does not guess.`,
    `The last point is for ${GROWTH_SOURCE.dataAsOf}, three days into its month.`,
    options.siteObjectCount === null
      ? 'This is a different count from the one this site draws on the globe, which leaves out most debris and spent rocket stages.'
      : `This is a different count from the ${WHOLE.format(options.siteObjectCount)} objects this site draws on the globe, which leave out most debris and spent rocket stages.`,
  ];
  for (const text of noteTexts) {
    notes.append(html('p', 'muted', text));
  }

  container.replaceChildren(sourceLine, now, legend, plot, controls, tableDetails, notes);

  // --- State --------------------------------------------------------------------
  /** The month in view. Fractional while playing, so that the reveal is smooth. */
  let position = LAST_MONTH;
  let playing = false;
  let frame = 0;
  let lastFrameMs = 0;
  let layout = layoutFor(plot.clientWidth);

  // Parts of the picture that move with the month in view; rebuilt with the picture.
  let clipRect: SVGRectElement | null = null;
  let cursor: SVGLineElement | null = null;
  const dots = new Map<GrowthSeries['id'], SVGCircleElement>();
  const labels = new Map<GrowthSeries['id'], SVGTextElement>();

  const xOf = (index: number): number =>
    layout.left + ((layout.width - layout.left - layout.right) * index) / LAST_MONTH;
  const yOf = (count: number): number =>
    layout.top + (layout.height - layout.top - layout.bottom) * (1 - count / AXIS_TOP);

  const buildPicture = (): void => {
    const { width, height, left, right, top, bottom, narrow } = layout;
    picture.setAttribute('viewBox', `0 0 ${String(width)} ${String(height)}`);
    picture.setAttribute('width', String(width));
    picture.setAttribute('height', String(height));
    const plotRight = width - right;
    const baseline = height - bottom;
    const children: SVGElement[] = [];

    // Horizontal gridlines and the values they stand for.
    for (let value = 0; value <= AXIS_TOP; value += GRID_STEP) {
      const y = yOf(value);
      children.push(
        svg('line', {
          class: value === 0 ? 'growth-axis' : 'growth-grid',
          x1: left,
          x2: plotRight,
          y1: y,
          y2: y,
        }),
      );
      if (!narrow || value % (2 * GRID_STEP) === 0) {
        const label = svg('text', { class: 'growth-tick', x: left - 8, y: y + 4 });
        label.setAttribute('text-anchor', 'end');
        label.textContent = WHOLE.format(value);
        children.push(label);
      }
    }

    // Years along the bottom.
    const yearStep = narrow ? 20 : 10;
    for (let year = 1960; year <= 2020; year += yearStep) {
      const x = xOf(indexOfMonth(year, 1));
      children.push(
        svg('line', { class: 'growth-axis', x1: x, x2: x, y1: baseline, y2: baseline + 4 }),
      );
      const label = svg('text', { class: 'growth-tick', x, y: baseline + 18 });
      label.setAttribute('text-anchor', 'middle');
      label.textContent = String(year);
      children.push(label);
    }

    // The three break-ups this site has layers for. The first is named to
    // the left of its line and the other two to the right, and the middle
    // one sits a row lower, because 2007 and 2009 are too close together to
    // be named side by side.
    GROWTH_EVENT_MARKS.forEach((mark, order) => {
      const x = xOf(mark.index);
      const lowerRow = order === 1;
      const before = order === 0 || (narrow && order === 2);
      const labelY = top - 8 - (lowerRow ? 0 : 14);
      children.push(
        svg('line', { class: 'growth-event', x1: x, x2: x, y1: labelY - 9, y2: baseline }),
      );
      const label = svg('text', {
        class: 'growth-event-label',
        x: before ? x - 5 : x + 5,
        y: labelY,
      });
      label.setAttribute('text-anchor', before ? 'end' : 'start');
      label.textContent = narrow ? String(mark.year) : `${mark.label}, ${String(mark.year)}`;
      children.push(label);
    });

    // The lines, revealed up to the month in view by a clipping rectangle.
    const clipId = 'growth-reveal';
    const clip = svg('clipPath', { id: clipId });
    clipRect = svg('rect', { x: 0, y: 0, width: 0, height });
    clip.append(clipRect);
    const defs = svg('defs');
    defs.append(clip);
    const lines = svg('g', { 'clip-path': `url(#${clipId})` });
    for (const series of LINES) {
      const points = series.counts
        .map((count, index) => `${xOf(index).toFixed(1)},${yOf(count).toFixed(1)}`)
        .join(' ');
      const line = svg('polyline', {
        class: series.id === 'total' ? 'growth-line growth-line-total' : 'growth-line',
        points,
      });
      line.style.stroke = KIND_COLOURS[series.id];
      lines.append(line);
    }
    children.push(defs, lines);

    // The month in view: a hairline, a dot on each line, and a few names.
    cursor = svg('line', { class: 'growth-cursor', y1: top, y2: baseline });
    children.push(cursor);
    dots.clear();
    labels.clear();
    for (const series of LINES) {
      const dot = svg('circle', { class: 'growth-dot', r: 4 });
      dot.style.fill = KIND_COLOURS[series.id];
      dots.set(series.id, dot);
      children.push(dot);
    }
    for (const series of LINES) {
      const label = svg('text', { class: 'growth-direct-label' });
      label.textContent = series.label;
      labels.set(series.id, label);
      children.push(label);
    }

    picture.replaceChildren(...children);
  };

  /** A line's value at a position between two months. */
  const valueAt = (series: GrowthSeries, at: number): number => {
    const lower = Math.floor(at);
    const upper = Math.min(LAST_MONTH, lower + 1);
    const a = series.counts[lower] ?? 0;
    const b = series.counts[upper] ?? a;
    return a + (b - a) * (at - lower);
  };

  const renderPosition = (): void => {
    const month = Math.round(position);
    const x = xOf(position);
    clipRect?.setAttribute('width', String(x + 1));
    cursor?.setAttribute('x1', String(x));
    cursor?.setAttribute('x2', String(x));

    // Names stand to the right of the hairline, where nothing has been
    // drawn yet. Where the edge of the picture leaves no room for them they
    // are left out, and the legend above carries the names alone: a name
    // laid over the lines would be harder to read than no name.
    const room = x + DIRECT_LABEL_ROOM_PX <= layout.width;
    const placed: number[] = [];
    for (const series of LABEL_PRIORITY) {
      const y = yOf(valueAt(series, position));
      const dot = dots.get(series.id);
      dot?.setAttribute('cx', String(x));
      dot?.setAttribute('cy', String(y));
      const label = labels.get(series.id);
      if (label !== undefined) {
        const clear = room && placed.every((other) => Math.abs(other - y) >= LABEL_CLEARANCE_PX);
        label.style.display = clear ? '' : 'none';
        if (clear) {
          placed.push(y);
          label.setAttribute('x', String(x + 9));
          label.setAttribute('y', String(y + 4));
        }
      }
    }

    nowMonth.textContent = formatMonth(month);
    const total = formatCountAt(GROWTH_TOTAL, month);
    nowTotal.textContent = total === '0' ? 'nothing in orbit yet' : `${total} objects`;
    for (const series of LABEL_PRIORITY) {
      const value = legendValues.get(series.id);
      if (value !== undefined) {
        value.textContent = formatCountAt(series, month);
      }
    }
    slider.value = String(month);
    slider.setAttribute('aria-valuetext', `${formatMonth(month)}: ${total} objects`);
    container.dataset.month = String(month);
  };

  const renderPlaying = (): void => {
    playButton.textContent = playing ? 'Pause' : position >= LAST_MONTH ? 'Play again' : 'Play';
    container.dataset.playing = String(playing);
  };

  const stop = (): void => {
    playing = false;
    window.cancelAnimationFrame(frame);
    frame = 0;
    renderPlaying();
  };

  const step = (timeMs: number): void => {
    const elapsed = lastFrameMs === 0 ? 0 : timeMs - lastFrameMs;
    lastFrameMs = timeMs;
    position = Math.min(LAST_MONTH, position + (elapsed * LAST_MONTH) / PLAY_DURATION_MS);
    renderPosition();
    if (position >= LAST_MONTH) {
      stop();
      return;
    }
    frame = window.requestAnimationFrame(step);
  };

  const play = (): void => {
    if (position >= LAST_MONTH) {
      position = 0;
    }
    playing = true;
    lastFrameMs = 0;
    renderPlaying();
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(step);
  };

  /** Show one month, as asked for by the viewer: stops any animation. */
  const show = (index: number): void => {
    stop();
    position = Math.min(LAST_MONTH, Math.max(0, Math.round(index)));
    renderPosition();
    renderPlaying();
  };

  playButton.addEventListener('click', () => {
    if (playing) {
      stop();
    } else {
      play();
    }
  });
  slider.addEventListener('input', () => {
    show(Number(slider.value));
  });

  // Pointing at the plot shows the month under the pointer: the hairline
  // finds the month, so nobody has to aim at a two-pixel line.
  const showAtPointer = (event: PointerEvent): void => {
    const bounds = picture.getBoundingClientRect();
    if (bounds.width === 0) {
      return;
    }
    const x = ((event.clientX - bounds.left) * layout.width) / bounds.width;
    const span = layout.width - layout.left - layout.right;
    show(((x - layout.left) / span) * LAST_MONTH);
  };
  picture.addEventListener('pointerdown', showAtPointer);
  picture.addEventListener('pointermove', (event) => {
    // A mouse shows the month it hovers over; a finger must be down.
    if (event.pointerType === 'mouse' || event.buttons !== 0) {
      showAtPointer(event);
    }
  });

  const observer = new ResizeObserver(() => {
    const next = layoutFor(plot.clientWidth);
    if (next.width !== layout.width && plot.clientWidth > 0) {
      layout = next;
      buildPicture();
      renderPosition();
    }
  });
  observer.observe(plot);

  buildPicture();
  renderPosition();
  renderPlaying();

  return {
    start(): void {
      // The container may have had no size when the chart was built.
      const next = layoutFor(plot.clientWidth);
      if (next.width !== layout.width && plot.clientWidth > 0) {
        layout = next;
        buildPicture();
      }
      if (options.reducedMotion()) {
        position = LAST_MONTH;
        renderPosition();
        renderPlaying();
      } else {
        position = 0;
        renderPosition();
        play();
      }
    },
    stop,
  };
}
