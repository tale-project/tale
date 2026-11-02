/** The id of the app's `<main>`: where the skip link leads. */
export const MAIN_CONTENT_ID = 'main-content';

/**
 * Gives the keyboard to the main area (it takes focus by script, not by Tab):
 * the last place for it to go when the page it was on has left and nothing
 * named a better one. Without it the keyboard falls to the top of the document.
 */
export function focusMainArea(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true });
}
