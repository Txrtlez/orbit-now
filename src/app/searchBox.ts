/**
 * The search field with its list of suggestions.
 *
 * Follows the WAI-ARIA Authoring Practices "combobox with list
 * autocomplete" pattern: keyboard focus stays in the text field the whole
 * time, the arrow keys move a highlight through the suggestions (announced
 * to screen readers through `aria-activedescendant`), Enter chooses the
 * highlighted one, and Escape closes the list.
 */

/** One suggestion to show. */
export interface Suggestion {
  /** Main text: the object's name. */
  readonly title: string;
  /** Secondary text: its catalog number and what it is. */
  readonly detail: string;
}

export interface SearchBoxOptions {
  readonly input: HTMLInputElement;
  /** The element with role="listbox" that receives the suggestions. */
  readonly list: HTMLElement;
  /** An element with role="status" that announces how many suggestions there are. */
  readonly status: HTMLElement;
  /** Returns the suggestions for a query, best first. Called on every keystroke. */
  readonly suggest: (query: string) => readonly Suggestion[];
  /** Called when the viewer chooses a suggestion, with its position in the list last returned. */
  readonly onChoose: (position: number) => void;
}

export function initSearchBox(options: SearchBoxOptions): void {
  const { input, list, status } = options;
  let suggestions: readonly Suggestion[] = [];
  // Position of the highlighted suggestion, or -1 if none is highlighted.
  let active = -1;

  const optionId = (position: number): string => `${list.id}-option-${String(position)}`;

  const setActive = (position: number): void => {
    active = position;
    Array.from(list.children).forEach((child, index) => {
      child.setAttribute('aria-selected', index === position ? 'true' : 'false');
    });
    if (position >= 0) {
      input.setAttribute('aria-activedescendant', optionId(position));
      list.children[position]?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  };

  const close = (): void => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  };

  const choose = (position: number): void => {
    const suggestion = suggestions[position];
    if (suggestion === undefined) {
      return;
    }
    input.value = suggestion.title;
    close();
    status.textContent = `Selected ${suggestion.title}.`;
    // On a touch screen, dismiss the on-screen keyboard so the result can be seen.
    if (window.matchMedia('(pointer: coarse)').matches) {
      input.blur();
    }
    options.onChoose(position);
  };

  const refresh = (): void => {
    const query = input.value.trim();
    suggestions = query === '' ? [] : options.suggest(query);
    const items = suggestions.map((suggestion, position) => {
      const item = document.createElement('li');
      item.id = optionId(position);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      const title = document.createElement('span');
      title.className = 'option-title';
      title.textContent = suggestion.title;
      const detail = document.createElement('span');
      detail.className = 'option-detail';
      detail.textContent = suggestion.detail;
      item.append(title, detail);
      item.addEventListener('click', () => {
        choose(position);
      });
      return item;
    });
    list.replaceChildren(...items);
    active = -1;
    input.removeAttribute('aria-activedescendant');

    if (query === '') {
      close();
      status.textContent = '';
      return;
    }
    if (suggestions.length === 0) {
      close();
      status.textContent = 'No matching objects.';
      return;
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    status.textContent =
      suggestions.length === 1
        ? '1 suggestion. Use the down arrow to reach it.'
        : `${String(suggestions.length)} suggestions. Use the down arrow to reach them.`;
  };

  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => {
    // Coming back to a field that still has text in it shows the suggestions again.
    if (input.value.trim() !== '' && list.hidden) {
      refresh();
    }
  });
  input.addEventListener('blur', close);

  input.addEventListener('keydown', (event) => {
    const open = !list.hidden;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) {
          refresh();
        } else {
          setActive((active + 1) % suggestions.length);
        }
        break;
      case 'ArrowUp':
        if (open) {
          event.preventDefault();
          setActive(active <= 0 ? suggestions.length - 1 : active - 1);
        }
        break;
      case 'Enter':
        if (open) {
          event.preventDefault();
          // With nothing highlighted, Enter takes the best match.
          choose(active >= 0 ? active : 0);
        }
        break;
      case 'Escape':
        if (open) {
          // Mark the key as used, so that it closes only the list and not
          // also whatever else Escape would close.
          event.preventDefault();
          close();
        }
        break;
      default:
        break;
    }
  });

  // Pressing on a suggestion must not take focus away from the text field:
  // that would close the list before the click could land.
  list.addEventListener('pointerdown', (event) => {
    event.preventDefault();
  });
}
