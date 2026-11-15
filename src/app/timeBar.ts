import { describeClock, SPEEDS, TIME_SPAN_MS, type SimClock } from './clock';

/** How often the displayed time and the slider are refreshed, in milliseconds. */
const REFRESH_MS = 200;
/** One step of the slider, in milliseconds: one minute. */
const SLIDER_STEP_MS = 60_000;

export interface TimeBarElements {
  /** The whole bar; `data-live` and `data-expanded` are kept on it for styling. */
  readonly bar: HTMLElement;
  readonly play: HTMLButtonElement;
  readonly speed: HTMLSelectElement;
  /** Shows the date and time being displayed. */
  readonly label: HTMLElement;
  /** Shows how far that is from the present, or "Live". */
  readonly offset: HTMLElement;
  /** Returns to the present. */
  readonly live: HTMLButtonElement;
  /** Shows or hides the slider on small screens. */
  readonly expand: HTMLButtonElement;
  readonly slider: HTMLInputElement;
}

/**
 * Write a time the way the viewer's own device does, in their own time
 * zone, with the zone named so that there is no doubt which it is.
 *
 * @param withSeconds seconds are shown only when they tick slowly enough to read
 */
function formatTime(unixMs: number, withSeconds: boolean): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    timeZoneName: 'short',
  }).format(unixMs);
}

/**
 * Connect the time controls to the clock: play and pause, speed, the slider
 * that moves up to three days either way, and the button that returns to
 * the present.
 *
 * @param wallNow returns the real time in milliseconds since 1970-01-01 UTC
 */
export function initTimeBar(
  elements: TimeBarElements,
  clock: SimClock,
  wallNow: () => number,
): void {
  const { bar, play, speed, label, offset, live, expand, slider } = elements;

  speed.replaceChildren(
    ...SPEEDS.map((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${String(value)}×`;
      return option;
    }),
  );
  slider.min = String(-TIME_SPAN_MS / SLIDER_STEP_MS);
  slider.max = String(TIME_SPAN_MS / SLIDER_STEP_MS);
  slider.step = '1';

  // While the viewer is holding the slider, the clock follows the slider,
  // not the other way round.
  let dragging = false;

  const refresh = (): void => {
    clock.enforceLimits();
    const now = clock.now();
    const offsetMs = clock.offsetMs();
    const isLive = clock.isLive();
    const playing = clock.playing();

    // Seconds are worth showing only while they tick at a readable pace.
    const text = formatTime(now, clock.rate() <= 10);
    if (label.textContent !== text) {
      label.textContent = text;
    }
    const offsetText = describeClock(clock);
    if (offset.textContent !== offsetText) {
      offset.textContent = offsetText;
    }
    bar.dataset.live = String(isLive);
    live.hidden = isLive;

    play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    play.dataset.playing = String(playing);
    if (speed.value !== String(clock.speed())) {
      speed.value = String(clock.speed());
    }
    if (!dragging) {
      slider.value = String(Math.round(offsetMs / SLIDER_STEP_MS));
    }
    // What a screen reader announces for the slider, instead of a bare number of minutes.
    slider.setAttribute('aria-valuetext', `${text}${isLive ? ', live' : `, ${offsetText}`}`);
  };

  play.addEventListener('click', () => {
    clock.setPlaying(!clock.playing());
  });
  speed.addEventListener('change', () => {
    clock.setSpeed(Number(speed.value));
  });
  live.addEventListener('click', () => {
    clock.goLive();
  });
  slider.addEventListener('input', () => {
    dragging = true;
    clock.setTime(wallNow() + Number(slider.value) * SLIDER_STEP_MS);
  });
  // "change" fires when the viewer lets go of the slider, or after each
  // keyboard step.
  slider.addEventListener('change', () => {
    dragging = false;
  });
  expand.addEventListener('click', () => {
    const expanded = bar.dataset.expanded !== 'true';
    bar.dataset.expanded = String(expanded);
    expand.setAttribute('aria-expanded', String(expanded));
    expand.setAttribute('aria-label', expanded ? 'Hide the time slider' : 'Show the time slider');
  });

  clock.subscribe(refresh);
  window.setInterval(refresh, REFRESH_MS);
  refresh();
}
