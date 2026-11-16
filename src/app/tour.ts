/**
 * The guided tour: five stops in about a minute, for someone who has just
 * arrived. It drives the same controls a viewer would use (the filters,
 * the selection, the mode tabs, the "What if?" form), so nothing it shows
 * is staged: every number in its text is counted from the data on the
 * page.
 *
 * It can be paused, stepped by hand, left at any stop and taken again.
 * When motion is reduced it does not move on by itself.
 *
 * Loaded when the tour is first started, not with the site.
 */

/** What the tour needs to know and to be able to do. */
export interface TourContext {
  readonly container: HTMLElement;
  readonly reducedMotion: () => boolean;
  /** Objects on the globe. */
  readonly objectCount: number;
  /** Objects behind each family button of the filters. */
  readonly groupCounts: ReadonlyMap<string, number>;
  /** The Space Station's height in km and time for one revolution in minutes, or null if it is not in the data. */
  readonly station: { readonly heightKm: number; readonly periodMinutes: number } | null;
  /** Back to the site as it opens: Now mode, nothing selected, no filters, the present time. */
  readonly reset: () => void;
  readonly showOnlyGroups: (groupIds: readonly string[]) => void;
  readonly selectStation: () => void;
  /** Open "What if?" and run the collision of two satellites. */
  readonly runCollision: () => void;
  /** Called when the tour ends, however it ends. */
  readonly onEnd: () => void;
}

export interface Tour {
  /** End the tour and put the site back as it opens. */
  stop(): void;
}

/** How long each stop stays before the tour moves on, in milliseconds. */
export const STOP_MS = 12_000;

interface Stop {
  readonly title: string;
  readonly text: string;
  readonly go: () => void;
}

const count = new Intl.NumberFormat('en-GB');

/** The stops, leaving out any whose subject is not in the data. */
export function tourStops(context: TourContext): Stop[] {
  const stops: Stop[] = [];
  const starlink = context.groupCounts.get('starlink') ?? 0;
  const fengyun = context.groupCounts.get('fengyun-1c-debris') ?? 0;
  stops.push({
    title: 'Everything in orbit, right now',
    text: `Each dot is a real, tracked object, drawn where it is at this moment. There are ${count.format(context.objectCount)} on this globe: the working satellites and three clouds of debris. With dead satellites and other debris, NASA counted more than 33,000 catalogued objects in orbit in May 2026.`,
    go: context.reset,
  });
  if (starlink > 0) {
    const share = Math.round((starlink / context.objectCount) * 100);
    stops.push({
      title: 'One constellation',
      text: `These ${count.format(starlink)} dots, ${String(share)}% of everything on this globe, are the satellites of a single network, Starlink. They fly in rings, one behind another; a newly launched batch climbs in a line, which is what people see as a “Starlink train”.`,
      go: () => {
        context.reset();
        context.showOnlyGroups(['starlink']);
      },
    });
  }
  if (context.station !== null) {
    const { heightKm, periodMinutes } = context.station;
    stops.push({
      title: 'The Space Station, and when you can see it',
      text: `The ring marks the International Space Station, about ${count.format(Math.round(heightKm / 10) * 10)} km up and round the Earth every ${String(Math.round(periodMinutes))} minutes. It is bright enough to see without a telescope. After the tour, open “Passes over you”, give your place, and the site lists when it will cross your sky.`,
      go: () => {
        context.reset();
        context.selectStation();
      },
    });
  }
  if (fengyun > 0) {
    stops.push({
      title: 'Debris that is still up there',
      text: `In 2007 a missile test destroyed one weather satellite, Fengyun-1C. NASA catalogued 3,532 pieces of it. These ${count.format(fengyun)} are what today’s tracking data still lists, spread right round the Earth.`,
      go: () => {
        context.reset();
        context.showOnlyGroups(['fengyun-1c-debris']);
      },
    });
  }
  stops.push({
    title: 'What if?',
    text: 'What if two satellites collided, as two did in 2009? This is a standard model’s answer: two clumps of fragments that stretch into rings and, over years, into a shell. It is an illustration, not a prediction. You can stage your own in this tab.',
    go: context.runCollision,
  });
  return stops;
}

export function startTour(context: TourContext): Tour {
  const { container } = context;
  const stops = tourStops(context);
  let index = 0;
  let timer: number | null = null;
  let paused = context.reducedMotion();
  let ended = false;

  const progress = document.createElement('div');
  progress.className = 'tour-progress';
  const bar = document.createElement('div');
  bar.className = 'tour-bar';
  progress.append(bar);
  const step = document.createElement('p');
  step.className = 'tour-step small muted';
  const title = document.createElement('h2');
  title.className = 'tour-title';
  title.id = 'tour-title';
  title.tabIndex = -1;
  const text = document.createElement('p');
  text.className = 'tour-text';
  const live = document.createElement('div');
  live.setAttribute('aria-live', 'polite');
  live.append(step, title, text);
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  const button = (label: string, id: string): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'text-button';
    node.id = id;
    node.textContent = label;
    actions.append(node);
    return node;
  };
  const back = button('Back', 'tour-back');
  const pause = button('Pause', 'tour-pause');
  const next = button('Next', 'tour-next');
  const end = button('End tour', 'tour-end');
  container.replaceChildren(progress, live, actions);
  container.hidden = false;
  document.documentElement.dataset.tour = '0';

  const clearTimer = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const finish = (restore: boolean): void => {
    if (ended) {
      return;
    }
    ended = true;
    clearTimer();
    container.hidden = true;
    container.replaceChildren();
    delete document.documentElement.dataset.tour;
    if (restore) {
      context.reset();
    }
    context.onEnd();
  };

  const schedule = (): void => {
    clearTimer();
    // Restart the bar's animation from empty.
    bar.classList.remove('tour-bar-running');
    bar.getBoundingClientRect();
    pause.textContent = paused ? 'Play' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
    if (paused) {
      return;
    }
    bar.classList.add('tour-bar-running');
    timer = window.setTimeout(() => {
      if (index + 1 < stops.length) {
        show(index + 1);
      } else {
        // The tour ends on its last stop and leaves it on show.
        finish(false);
      }
    }, STOP_MS);
  };

  function show(target: number): void {
    index = Math.min(stops.length - 1, Math.max(0, target));
    const stop = stops[index];
    if (stop === undefined) {
      return;
    }
    step.textContent = `Tour, stop ${String(index + 1)} of ${String(stops.length)}`;
    title.textContent = stop.title;
    text.textContent = stop.text;
    back.disabled = index === 0;
    next.textContent = index + 1 === stops.length ? 'Finish' : 'Next';
    document.documentElement.dataset.tour = String(index + 1);
    stop.go();
    schedule();
  }

  back.addEventListener('click', () => {
    show(index - 1);
  });
  next.addEventListener('click', () => {
    if (index + 1 < stops.length) {
      show(index + 1);
    } else {
      finish(false);
    }
  });
  pause.addEventListener('click', () => {
    paused = !paused;
    schedule();
  });
  end.addEventListener('click', () => {
    finish(true);
  });
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      finish(true);
    }
  });

  show(0);
  next.focus({ preventScroll: true });
  return {
    stop(): void {
      finish(true);
    },
  };
}
