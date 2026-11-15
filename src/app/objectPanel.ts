import { formatCount, formatKm, formatLatLon, formatSpeed } from './format';
import type { LiveState } from './liveState';
import type { Fact, ObjectFacts } from './objectFacts';

/** What the panel needs in order to show an object. */
export interface ObjectPanelContent {
  readonly facts: ObjectFacts;
  /** CSS colour of the object's dot on the globe. */
  readonly colour: string;
  /** How many other objects are related to this one, and what they are; null if none. */
  readonly related: { readonly count: number; readonly description: string } | null;
  /** Whether the related objects are currently highlighted. */
  readonly highlightRelated: boolean;
}

export interface ObjectPanelCallbacks {
  /** The viewer closed the panel. */
  onClose(): void;
  /** The viewer asked for the camera to turn to the object. */
  onCentre(): void;
  /** The viewer switched highlighting of related objects on or off. */
  onHighlightChange(enabled: boolean): void;
}

export interface ObjectPanel {
  /** Show the panel for an object, replacing whatever it showed before. */
  show(content: ObjectPanelContent): void;
  /** Update the figures that change from second to second. Null means the position is unknown. */
  setLive(live: LiveState | null): void;
  /** Hide the panel. */
  hide(): void;
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

/** A definition list of labelled figures. Returns the list and the value element of each row, by label. */
function factList(facts: readonly Fact[]): {
  list: HTMLDListElement;
  values: Map<string, HTMLElement>;
} {
  const list = element('dl', 'facts');
  const values = new Map<string, HTMLElement>();
  for (const fact of facts) {
    const row = element('div', 'fact');
    const term = element('dt', undefined, fact.label);
    const value = element('dd', undefined, fact.value);
    if (fact.note !== undefined) {
      // Shown as a tooltip on hover; the row is one unit for a screen reader,
      // which reads the label, the value and then this description.
      row.title = fact.note;
    }
    row.append(term, value);
    list.append(row);
    values.set(fact.label, value);
  }
  return { list, values };
}

/**
 * The card that describes the selected object.
 *
 * @param container the element to fill; it is shown and hidden with its `hidden` attribute
 */
export function createObjectPanel(
  container: HTMLElement,
  callbacks: ObjectPanelCallbacks,
): ObjectPanel {
  let liveValues: Map<string, HTMLElement> | null = null;

  return {
    show(content: ObjectPanelContent): void {
      const { facts } = content;

      const header = element('header', 'card-header');
      const titles = element('div', 'card-titles');
      const title = element('h2');
      title.id = 'object-title';
      const swatch = element('span', 'swatch');
      swatch.style.backgroundColor = content.colour;
      swatch.setAttribute('aria-hidden', 'true');
      title.append(swatch, facts.title);
      titles.append(title, element('p', 'headline', facts.subtitle));
      const close = element('button', 'icon-button');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close object details');
      close.textContent = '×';
      close.addEventListener('click', () => {
        callbacks.onClose();
      });
      header.append(titles, close);

      const live = factList([
        { label: 'Altitude', value: '…', note: 'Height above the Earth right now.' },
        {
          label: 'Speed',
          value: '…',
          note: 'Speed right now, relative to the centre of the Earth.',
        },
        { label: 'Above', value: '…', note: 'The point on the ground directly underneath.' },
      ]);
      live.list.classList.add('facts-live');
      // Announce nothing as these tick: a screen reader user can read them on demand.
      live.list.setAttribute('aria-live', 'off');
      liveValues = live.values;

      const orbit = factList(facts.orbitFacts);
      const identity = factList(facts.identityFacts);

      const actions = element('div', 'card-actions');
      const centre = element('button', 'text-button', 'Centre view on it');
      centre.type = 'button';
      centre.addEventListener('click', () => {
        callbacks.onCentre();
      });
      actions.append(centre);

      const sections: HTMLElement[] = [
        header,
        element('h3', 'section-title', 'Right now'),
        live.list,
        element('h3', 'section-title', 'Orbit'),
        orbit.list,
        element('h3', 'section-title', 'Identity'),
        identity.list,
      ];

      if (content.related !== null) {
        const label = element('label', 'check');
        const box = element('input');
        box.type = 'checkbox';
        box.checked = content.highlightRelated;
        box.addEventListener('change', () => {
          callbacks.onHighlightChange(box.checked);
        });
        label.append(
          box,
          `Highlight the ${formatCount(content.related.count)} other ${content.related.description}`,
        );
        sections.push(label);
      }
      sections.push(
        actions,
        element(
          'p',
          'muted small',
          'Worked out in your browser from published orbit data with the standard SGP4 model. The blue line is its path over one orbit.',
        ),
      );

      container.replaceChildren(...sections);
      container.hidden = false;
    },
    setLive(live: LiveState | null): void {
      if (liveValues === null) {
        return;
      }
      const set = (label: string, text: string): void => {
        const node = liveValues?.get(label);
        if (node !== undefined && node.textContent !== text) {
          node.textContent = text;
        }
      };
      if (live === null) {
        set('Altitude', 'Not available');
        set('Speed', 'Not available');
        set('Above', 'Not available');
        return;
      }
      set('Altitude', formatKm(live.altitudeKm));
      set('Speed', formatSpeed(live.speedKmPerSecond));
      set('Above', formatLatLon(live.latitudeDeg, live.longitudeDeg));
    },
    hide(): void {
      liveValues = null;
      container.hidden = true;
      container.replaceChildren();
    },
  };
}
