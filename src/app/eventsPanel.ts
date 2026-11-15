import { cssColourOfGroup } from '../render/palette';
import {
  DEBRIS_EVENTS,
  eventById,
  eventIsolatedBy,
  groupsWithObjects,
  objectsFromLaunches,
  objectsInData,
  type DebrisEvent,
} from './events';
import { FILTER_GROUPS, type FilterState } from './filters';
import { formatCount } from './format';

export interface EventsPanelOptions {
  /** The element to fill. */
  readonly container: HTMLElement;
  /** Objects behind each family button of the filters (from `countFilterOptions`). */
  readonly groupCounts: ReadonlyMap<string, number>;
  /** The international designator of every object in the catalog. */
  readonly designators: readonly string[];
  /** Show only the objects in these groups, clearing every other filter. */
  readonly showOnlyGroups: (groupIds: readonly string[]) => void;
  /** Show every object again. */
  readonly clearFilters: () => void;
  /** Called when an event is opened or closed, with its identifier or null. */
  readonly onOpenChange?: (eventId: string | null) => void;
}

export interface EventsPanel {
  /**
   * Tell the panel what the filters now are, however they came to be so,
   * so that the event shown as open is always the one whose cloud is on
   * the globe.
   */
  syncWithFilters(state: FilterState): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
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

/** One row of a description list. */
function fact(term: string, ...description: (string | Node)[]): HTMLElement {
  const row = element('div', 'fact');
  const value = element('dd');
  value.append(...description);
  row.append(element('dt', undefined, term), value);
  return row;
}

function objectsWord(count: number): string {
  return count === 1 ? '1 object' : `${formatCount(count)} objects`;
}

/** The part of an event that unfolds under its button. */
function describeEvent(
  event: DebrisEvent,
  groupCounts: ReadonlyMap<string, number>,
  designators: readonly string[],
  onShowAll: () => void,
): HTMLElement {
  const body = element('div', 'event-body');
  const inData = objectsInData(event, groupCounts);

  const tag = element('p', 'tag-line');
  tag.append(
    element('span', 'tag', 'Real data'),
    inData.total > 0
      ? ' Dates, heights and counts are NASA’s; the objects on the globe are CelesTrak’s.'
      : ' Dates, heights and counts are NASA’s.',
  );
  body.append(tag);

  for (const paragraph of event.story) {
    body.append(element('p', undefined, paragraph));
  }

  const facts = element('dl', 'facts event-facts');
  facts.append(fact('When', event.when), fact('Where', event.where));
  for (const { cloud, count } of event.counts) {
    const label = event.counts.length > 1 ? `${cloud}: pieces catalogued` : 'Pieces catalogued';
    facts.append(
      fact(
        label,
        `${formatCount(count.catalogued)}, of which ${formatCount(count.inOrbit)} were still in orbit on ${count.asOf} (NASA)`,
      ),
    );
  }
  if (inData.total > 0) {
    const value: (string | Node)[] = [];
    event.groupIds.forEach((groupId, position) => {
      const count = inData.perGroup[position] ?? 0;
      if (count === 0) {
        return;
      }
      if (value.length > 0) {
        value.push(element('br'));
      }
      const swatch = element('span', 'swatch');
      swatch.style.background = cssColourOfGroup(groupId);
      const name = FILTER_GROUPS.find((group) => group.id === groupId)?.label ?? groupId;
      value.push(
        swatch,
        event.groupIds.length > 1 ? `${objectsWord(count)}: ${name}` : objectsWord(count),
      );
    });
    facts.append(fact('In this site’s data today', ...value));
  } else {
    facts.append(fact('In this site’s data today', 'Nothing'));
  }
  body.append(facts);

  if (inData.total > 0) {
    body.append(
      element(
        'p',
        'muted small',
        'Today’s figure is what CelesTrak’s list for the cloud holds now, including what is left of the satellite itself. It is not NASA’s count of pieces still in orbit, which was made in a different way on a different date.',
      ),
    );
  }
  if (event.absence !== undefined) {
    const [first = '', ...rest] = event.absence;
    // What the catalog holds from the launch is looked up, not assumed: the
    // data changes three times a day and this sentence must stay true.
    const fromLaunch = objectsFromLaunches(event, designators);
    const found =
      fromLaunch === 0
        ? 'Today’s data contains no object from that launch either.'
        : `Today’s data does contain ${objectsWord(fromLaunch)} from that launch, but nothing in it says whether they are debris of this event.`;
    body.append(element('p', undefined, `${first} ${found}`));
    for (const paragraph of rest) {
      body.append(element('p', undefined, paragraph));
    }
  }

  if (inData.total > 0) {
    const showAll = element('button', 'text-button', 'Show everything again');
    showAll.type = 'button';
    showAll.addEventListener('click', onShowAll);
    const actions = element('div', 'card-actions');
    actions.append(showAll);
    body.append(actions);
  }

  const sources = element('details', 'details event-sources');
  sources.append(element('summary', undefined, 'Sources'));
  const list = element('ul', 'muted small');
  for (const source of event.sources) {
    list.append(element('li', undefined, source));
  }
  sources.append(list);
  body.append(sources);

  return body;
}

/**
 * The "Debris from three break-ups" section: one button per event. Opening
 * an event tells its story and, where the catalog holds any of its debris,
 * leaves only that debris on the globe, by setting the filters. The
 * filters stay the single record of what is shown: if the viewer changes
 * them by hand, this panel follows.
 */
export function createEventsPanel(options: EventsPanelOptions): EventsPanel {
  const { container, groupCounts } = options;
  let openId: string | null = null;
  // Set while this panel is itself changing the filters, so that the echo
  // of its own change is not mistaken for the viewer's.
  let applying = false;

  const rows = new Map<string, { button: HTMLButtonElement; body: HTMLElement }>();

  const render = (): void => {
    for (const [id, row] of rows) {
      const open = id === openId;
      row.button.setAttribute('aria-expanded', String(open));
      row.body.hidden = !open;
    }
    options.onOpenChange?.(openId);
  };

  const applyFilters = (change: () => void): void => {
    applying = true;
    try {
      change();
    } finally {
      applying = false;
    }
  };

  /** Whether the globe is currently showing only the debris of the open event. */
  let isolatedId: string | null = null;

  const close = (): void => {
    const wasIsolated = openId !== null && isolatedId === openId;
    openId = null;
    if (wasIsolated) {
      applyFilters(options.clearFilters);
    }
    render();
  };

  const open = (event: DebrisEvent): void => {
    openId = event.id;
    const groups = groupsWithObjects(event, groupCounts);
    if (groups.length > 0) {
      applyFilters(() => {
        options.showOnlyGroups(groups);
      });
    } else if (isolatedId !== null) {
      // Nothing of this event can be drawn. Leaving another event's cloud
      // on the globe beside this event's story would mislead.
      applyFilters(options.clearFilters);
    }
    render();
  };

  const list = element('ul', 'event-list');
  for (const event of DEBRIS_EVENTS) {
    const inData = objectsInData(event, groupCounts).total;
    const item = element('li', 'event');
    const button = element('button', 'event-button');
    button.type = 'button';
    const bodyId = `event-${event.id}`;
    button.setAttribute('aria-controls', bodyId);
    button.setAttribute('aria-expanded', 'false');
    const titles = element('span', 'event-titles');
    titles.append(
      element('span', 'event-title', event.title),
      element(
        'span',
        'event-count',
        inData > 0 ? `${objectsWord(inData)} in today’s data` : 'Nothing left in today’s data',
      ),
    );
    button.append(element('span', 'event-year', String(event.year)), titles);
    button.addEventListener('click', () => {
      if (openId === event.id) {
        close();
      } else {
        open(event);
      }
    });
    const body = describeEvent(event, groupCounts, options.designators, close);
    body.id = bodyId;
    body.hidden = true;
    item.append(button, body);
    list.append(item);
    rows.set(event.id, { button, body });
  }

  const intro = element(
    'p',
    'muted',
    'Three well-documented break-ups. Choose one to read what happened and to leave only what remains of its cloud on the globe.',
  );
  container.replaceChildren(intro, list);

  return {
    syncWithFilters(state): void {
      const isolated = eventIsolatedBy(state, groupCounts);
      isolatedId = isolated?.id ?? null;
      if (applying) {
        return;
      }
      // The viewer changed the filters directly.
      if (isolated !== undefined) {
        // They have, by hand, asked for exactly one event's cloud.
        if (openId !== isolated.id) {
          openId = isolated.id;
          render();
        }
        return;
      }
      const current = eventById(openId);
      if (current !== undefined && groupsWithObjects(current, groupCounts).length > 0) {
        // The open event's cloud is no longer what the globe shows.
        openId = null;
        render();
      }
    },
  };
}
