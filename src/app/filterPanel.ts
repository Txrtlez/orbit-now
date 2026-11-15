import type { ObjectIndex } from '../catalog/objectIndex';
import { describeObjectType, OBJECT_TYPE_ORDER, OWNER_NAMES } from '../catalog/satcatCodes';
import { REGIME_DESCRIPTIONS, REGIMES, type Regime } from '../orbit/elements';
import {
  applyFilters,
  countFilterOptions,
  FILTER_GROUPS,
  isFilterActive,
  type FilterState,
} from './filters';
import { formatCount } from './format';

export interface FilterPanelOptions {
  /** The element to fill with the filter controls. */
  readonly container: HTMLElement;
  /** The heading of the collapsible section, which also reports whether filters are on. */
  readonly summary: HTMLElement;
  readonly objects: ObjectIndex;
  /**
   * Called whenever the filters change.
   *
   * @param passes for each object, 1 if it passes; null if no filter is active
   * @param shown  how many objects pass
   * @param state  what is being asked for, for anything that needs to
   *               recognise a particular combination
   */
  readonly onChange: (passes: Uint8Array | null, shown: number, state: FilterState) => void;
}

/** What other parts of the page may do to the filters. */
export interface FilterPanelControl {
  /**
   * Show only the objects behind these family buttons, clearing every
   * other filter, exactly as if the viewer had pressed "Clear filters"
   * and then those buttons.
   */
  showOnlyGroups(groupIds: readonly string[]): void;
  /** Clear every filter. */
  clear(): void;
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

/** A toggle button with a count, e.g. "Starlink 11,188". */
function chip(label: string, count: number, title?: string): HTMLButtonElement {
  const button = element('button', 'chip');
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  if (title !== undefined) {
    button.title = title;
  }
  button.append(label, ' ', element('span', 'chip-count', formatCount(count)));
  return button;
}

/** Read a year from a text field: a whole number, or null if the field is empty or not a year. */
function readYear(input: HTMLInputElement): number | null {
  const text = input.value.trim();
  if (!/^\d{4}$/.test(text)) {
    return null;
  }
  return Number(text);
}

/**
 * Build the filter controls: toggle buttons for families of objects and for
 * orbit regimes, and a range of launch years. Only options that match at
 * least one object in the catalog are offered.
 */
export function createFilterPanel(options: FilterPanelOptions): FilterPanelControl {
  const { container, objects } = options;
  const counts = countFilterOptions(objects);
  const groups = new Set<string>();
  const regimes = new Set<Regime>();
  const types = new Set<string>();
  const passes = new Uint8Array(objects.count);

  const result = element('p', 'filter-result');
  result.setAttribute('role', 'status');
  const reset = element('button', 'text-button', 'Clear filters');
  reset.type = 'button';

  let yearFromInput: HTMLInputElement | null = null;
  let yearToInput: HTMLInputElement | null = null;
  let ownerSelect: HTMLSelectElement | null = null;

  const currentState = (): FilterState => ({
    groups,
    regimes,
    types,
    owner: ownerSelect === null || ownerSelect.value === '' ? null : ownerSelect.value,
    yearFrom: yearFromInput === null ? null : readYear(yearFromInput),
    yearTo: yearToInput === null ? null : readYear(yearToInput),
  });

  const update = (): void => {
    const state = currentState();
    const active = isFilterActive(state);
    const shown = applyFilters(objects, state, passes);
    result.textContent = active
      ? `Showing ${formatCount(shown)} of ${formatCount(objects.count)} objects.`
      : `Showing all ${formatCount(objects.count)} objects.`;
    reset.disabled = !active;
    options.summary.textContent = active ? 'Filters (on)' : 'Filters';
    options.onChange(active ? passes : null, shown, state);
  };

  // The family buttons by identifier, so that they can be pressed from outside.
  const groupButtons = new Map<string, HTMLButtonElement>();

  const toggleSection = <T>(
    title: string,
    entries: readonly { key: T; label: string; count: number; title?: string }[],
    chosen: Set<T>,
    onButton?: (key: T, button: HTMLButtonElement) => void,
  ): HTMLElement | null => {
    const offered = entries.filter((entry) => entry.count > 0);
    // A question with a single possible answer is not worth asking.
    if (offered.length < 2) {
      return null;
    }
    const section = element('div', 'filter-section');
    const heading = element('h3', 'section-title', title);
    const row = element('div', 'chips');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', title);
    for (const entry of offered) {
      const button = chip(entry.label, entry.count, entry.title);
      button.addEventListener('click', () => {
        const pressed = !chosen.has(entry.key);
        if (pressed) {
          chosen.add(entry.key);
        } else {
          chosen.delete(entry.key);
        }
        button.setAttribute('aria-pressed', String(pressed));
        update();
      });
      onButton?.(entry.key, button);
      row.append(button);
    }
    section.append(heading, row);
    return section;
  };

  const sections: HTMLElement[] = [];
  const family = toggleSection(
    'Show only',
    FILTER_GROUPS.map((group) => ({
      key: group.id,
      label: group.label,
      count: counts.groups.get(group.id) ?? 0,
    })),
    groups,
    (id, button) => {
      groupButtons.set(id, button);
    },
  );
  if (family !== null) {
    sections.push(family);
  }
  const orbit = toggleSection(
    'Orbit',
    REGIMES.map((regime) => ({
      key: regime,
      label: regime,
      count: counts.regimes.get(regime) ?? 0,
      title: REGIME_DESCRIPTIONS[regime],
    })),
    regimes,
  );
  if (orbit !== null) {
    sections.push(orbit);
  }

  // Kind and owner come from the satellite catalog, which a data file may
  // not carry yet; the controls appear when it does.
  if (counts.types.size > 0) {
    // Known types in their usual order, then any code this site has not
    // seen before, then the objects with nothing on record.
    const codes = [
      ...OBJECT_TYPE_ORDER,
      ...[...counts.types.keys()].filter(
        (code) => code !== '' && !OBJECT_TYPE_ORDER.includes(code),
      ),
      '',
    ];
    const kind = toggleSection(
      'Kind',
      codes.map((code) => ({
        key: code,
        label: code === '' ? 'Not on record' : describeObjectType(code),
        count: counts.types.get(code) ?? 0,
      })),
      types,
    );
    if (kind !== null) {
      sections.push(kind);
    }
  }
  if (counts.owners.size > 1) {
    const section = element('div', 'filter-section');
    const heading = element('h3', 'section-title', 'Owner');
    heading.id = 'filter-owner-title';
    const select = element('select', 'owner-select');
    select.setAttribute('aria-labelledby', heading.id);
    const any = element('option', undefined, 'Any owner');
    any.value = '';
    select.append(any);
    // Most objects first.
    const ranked = [...counts.owners.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    for (const [code, count] of ranked) {
      const option = element(
        'option',
        undefined,
        `${OWNER_NAMES[code] ?? code} (${formatCount(count)})`,
      );
      option.value = code;
      select.append(option);
    }
    select.addEventListener('change', update);
    ownerSelect = select;
    section.append(heading, select);
    sections.push(section);
  }

  const range = objects.launchYearRange;
  if (range !== null && range[0] < range[1]) {
    const section = element('div', 'filter-section');
    const heading = element('h3', 'section-title', 'Launched');
    const row = element('div', 'year-range');
    const yearField = (
      label: string,
      spokenLabel: string,
      placeholder: number,
    ): HTMLInputElement => {
      const wrapper = element('label', 'year-field');
      const input = element('input');
      // A text field restricted to digits, not type="number": year fields
      // gain nothing from spinner arrows, and this brings up the number pad on phones.
      input.type = 'text';
      input.inputMode = 'numeric';
      input.maxLength = 4;
      input.placeholder = String(placeholder);
      input.autocomplete = 'off';
      // "From" and "To" are clear on screen, next to the heading; read out
      // on their own they are not, so screen readers get the full phrase.
      input.setAttribute('aria-label', spokenLabel);
      input.addEventListener('input', update);
      wrapper.append(element('span', undefined, label), input);
      row.append(wrapper);
      return input;
    };
    yearFromInput = yearField('From', 'Earliest launch year', range[0]);
    yearToInput = yearField('To', 'Latest launch year', range[1]);
    section.append(heading, row);
    sections.push(section);
  }

  /** Put every control back to "not asked", without announcing the change. */
  const resetControls = (): void => {
    groups.clear();
    regimes.clear();
    types.clear();
    if (ownerSelect !== null) {
      ownerSelect.value = '';
    }
    if (yearFromInput !== null) {
      yearFromInput.value = '';
    }
    if (yearToInput !== null) {
      yearToInput.value = '';
    }
    for (const button of container.querySelectorAll('.chip')) {
      button.setAttribute('aria-pressed', 'false');
    }
  };

  reset.addEventListener('click', () => {
    resetControls();
    update();
  });

  const footer = element('div', 'filter-footer');
  footer.append(result, reset);
  container.replaceChildren(...sections, footer);
  update();

  return {
    showOnlyGroups(groupIds): void {
      resetControls();
      for (const id of groupIds) {
        // A group with no objects has no button, and ticking it would hide
        // everything; it is left out.
        if ((counts.groups.get(id) ?? 0) > 0) {
          groups.add(id);
          groupButtons.get(id)?.setAttribute('aria-pressed', 'true');
        }
      }
      update();
    },
    clear(): void {
      resetControls();
      update();
    },
  };
}
