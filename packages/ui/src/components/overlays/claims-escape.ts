/**
 * Widgets that use Escape themselves — a code editor closing its completion
 * list, then arming "leave" — sit inside dialogs, sheets and popovers whose
 * layer closes on Escape. Radix hears Escape first (it listens on the
 * document in the capture phase), so without a convention the first Escape
 * in a sheet closed the whole sheet under an open list.
 *
 * The convention: while a widget needs Escape, an element around the focus
 * carries `data-claims-escape`. Every `@tale/ui` overlay passes its
 * `onEscapeKeyDown` through `respectEscapeClaims`, which cancels the layer's
 * dismissal for a claimed Escape; the widget handles the key, and once it
 * drops the claim the next Escape closes the layer as usual.
 */

export const CLAIMS_ESCAPE_ATTRIBUTE = 'data-claims-escape';

/** Whether a widget around the event's target has claimed Escape. */
export function isEscapeClaimed(event: Event): boolean {
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(`[${CLAIMS_ESCAPE_ATTRIBUTE}]`) !== null
  );
}

/**
 * Wraps an overlay's `onEscapeKeyDown`: a claimed Escape is cancelled (the
 * layer stays open, `handler` does not run); any other reaches `handler`.
 */
export function respectEscapeClaims<E extends Event>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (isEscapeClaimed(event)) {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}
