/**
 * Accessible tabs, following the WAI-ARIA Authoring Practices "Tabs" pattern
 * with automatic activation:
 *
 * - Only the selected tab is in the page's Tab order ("roving tabindex").
 * - Left/Right arrows move between tabs and wrap around; Home/End jump to the
 *   first/last tab.
 * - Moving focus to a tab selects it and shows its panel.
 */

export interface TabDefinition {
  /** The button with role="tab". */
  readonly tab: HTMLButtonElement;
  /** The element with role="tabpanel" that this tab controls. */
  readonly panel: HTMLElement;
  /**
   * Called the first time the panel is shown. Used to load a mode's code on
   * demand instead of during the initial page load.
   */
  readonly onFirstShow?: () => void;
}

export function initTabs(definitions: readonly TabDefinition[]): void {
  const shown = new Set<TabDefinition>();

  const select = (target: TabDefinition, moveFocus: boolean): void => {
    for (const definition of definitions) {
      const isTarget = definition === target;
      definition.tab.setAttribute('aria-selected', isTarget ? 'true' : 'false');
      definition.tab.tabIndex = isTarget ? 0 : -1;
      definition.panel.hidden = !isTarget;
    }
    if (moveFocus) {
      target.tab.focus();
    }
    if (!shown.has(target)) {
      shown.add(target);
      target.onFirstShow?.();
    }
  };

  definitions.forEach((definition, index) => {
    definition.tab.addEventListener('click', () => {
      select(definition, false);
    });

    definition.tab.addEventListener('keydown', (event) => {
      const count = definitions.length;
      let nextIndex: number;
      switch (event.key) {
        case 'ArrowRight':
          nextIndex = (index + 1) % count;
          break;
        case 'ArrowLeft':
          nextIndex = (index - 1 + count) % count;
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = count - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const next = definitions[nextIndex];
      if (next !== undefined) {
        select(next, true);
      }
    });
  });

  // Establish a consistent initial state from the markup: whichever tab is
  // marked aria-selected="true" wins, otherwise the first one.
  const initial =
    definitions.find((definition) => definition.tab.getAttribute('aria-selected') === 'true') ??
    definitions[0];
  if (initial !== undefined) {
    select(initial, false);
  }
}
