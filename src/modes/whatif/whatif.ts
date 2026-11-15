/**
 * Entry point for Mode B ("What if?").
 *
 * This module is loaded with a dynamic `import()` the first time the viewer
 * opens the tab, so the bundler emits it as a separate file. Nothing in here
 * is downloaded during the initial page load. In Phase 1 the module only
 * states honestly that the simulator does not exist yet; the point of having
 * it now is to establish and test the lazy-loading boundary that the
 * simulation code will live behind.
 */
export function mountWhatIf(panel: HTMLElement): void {
  const heading = document.createElement('h2');
  heading.textContent = 'What if?';

  const status = document.createElement('p');
  status.textContent =
    'The collision and debris-cascade simulator has not been built yet. It is scheduled for Phase 6 of the project.';

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent =
    'When it arrives, everything in this mode will be an illustrative model, not a prediction, and will be labelled that way.';

  panel.replaceChildren(heading, status, note);
}
